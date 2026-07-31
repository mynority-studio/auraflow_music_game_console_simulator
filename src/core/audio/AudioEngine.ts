/**
 * AudioEngine — 音频引擎单例(Q+N 主链路)
 *
 * App 层与 Dream 5504 EK MIDI 输出系统的总入口:
 *   ① 正式播放:playMusicGeneration(result) —— MusicalIR → musicalIrToMidi → globalMidiScheduler(+ 视觉事件驱动 LedMatrix)
 *   ② 当前状态:getCurrentMusicGeneration()(唯一真源,UI 读 uiSnapshot)+ getCurrentBeat/Tick/Bpm/Ppq
 *   ③ MIDI 通道工具:muteChannel / setPartMute(Q+N PartName→channel)/ injectMidiEvent / get|replaceChannelEvents
 *   ④ 实时演奏 + 视觉监听转发(gameplay / LedMatrix)
 *
 * MusicalIR 音符即绝对空间,播放不再额外做 keyOffset 转置。
 */

import { VisualEvent, PartName } from './playbackTypes';
import {
    globalMidiScheduler,
    type MidiEvent,
    type MidiNoteRange,
    type MidiNoteTarget,
} from './MidiScheduler';
import { musicalIRToMidiEvents, roomWetFor } from './musicalIrToMidi';
import { applyPopFiveTrackMidiGuard } from './popFiveTrackMidiGuard';
import type { MusicalIR } from '../generation/newEngine/ir/MusicalIR';
import type { MusicGenerationResult } from '../generation/musicGeneration/types';
import {
    applyCurrentSongVoiceOverride,
    type CurrentSongVoiceSelection,
} from '../generation/musicGeneration/currentSongVoiceOverride';
import { Dream5504MidiOutput } from './Dream5504MidiOutput';
import {
    DREAM5504_HINT,
    DREAM5504_LABEL,
    DREAM5504_TARGET_ID,
    mapProgramToDream5504,
} from '../sound/GMBK5X128Voices';

export const SOUND_FONT_BANKS = [
    {
        id: DREAM5504_TARGET_ID,
        label: DREAM5504_LABEL,
        sizeLabel: '5504硬件',
        bankManagerId: DREAM5504_TARGET_ID,
        hint: DREAM5504_HINT,
    },
] as const;

export type SoundFontBank = typeof SOUND_FONT_BANKS[number];
export type SoundFontBankId = SoundFontBank['id'];
export type AudioPlaybackKind = 'generated' | 'uploaded' | null;
export const UPLOADED_MIDI_TAKEOVER_GAIN_SCALE = 0.9;

const soundFontListeners = new Set<() => void>();
const notifySoundFontBank = (): void => {
    soundFontListeners.forEach(listener => {
        try { listener(); } catch { /* ignore */ }
    });
};
export const getSelectedSoundFontBank = (): SoundFontBank => SOUND_FONT_BANKS[0];
export const getLoadedSoundFontBank = (): SoundFontBank => SOUND_FONT_BANKS[0];
export const subscribeSoundFontBank = (listener: () => void): (() => void) => {
    soundFontListeners.add(listener);
    return () => { soundFontListeners.delete(listener); };
};

const midiOnlyAudioContext = {
    get currentTime() { return performance.now() / 1000; },
    state: 'running',
    resume: async () => undefined,
} as unknown as AudioContext;

export async function startAudioContext(): Promise<void> {
    Dream5504MidiOutput.requireReady('Dream 5504 MIDI 输出');
}

export function getAudioContext(): AudioContext {
    return midiOnlyAudioContext;
}

// ★ Q+N 角色 → LedMatrix VisualEvent 类型(qn_main_engine_takeover §5.3)。pad 暂归 accomp(无专属 atmosphere 视觉)。
const ROLE_VISUAL_TYPE: Record<string, VisualEvent['type']> = {
    lead: 'melody', comp: 'accomp', bass: 'bass', drum: 'drums', pad: 'accomp',
};
const ROLE_CHANNEL_VIS: Record<string, number> = { lead: 1, comp: 2, bass: 3, pad: 4, drum: 9 };
class AudioEngineSystem {
    private visualsMode: 'all' | 'gameplay-only' = 'all';
    // ★ Q+N 主链路:当前音乐生成结果(唯一正式 state;PipelineMonitor/AuraBar/AuraJam 读 uiSnapshot)。
    private currentMusicGeneration: MusicGenerationResult | null = null;
    private currentPlaybackKind: AudioPlaybackKind = null;
    private uploadedMidiChannels = new Set<number>();
    private uploadedMidiGainScale = 1;
    private schedulerVisualWired = false;

    // 并发互斥 — 快速连点 Play 时，仅最后一次触发的会话能完成 loadSong/play
    private playSessionId: number = 0;

    private visualListeners: Set<VisualEventListener> = new Set();
    private rawVisualListeners: Set<VisualEventListener> = new Set();

    public init(): void {
        // ★ Q+N 播放视觉:scheduler 派发的 'visual' MidiEvent → AudioEngine 视觉监听(LedMatrix)。只接一次。
        if (!this.schedulerVisualWired) {
            this.schedulerVisualWired = true;
            globalMidiScheduler.addVisualListener((data: unknown) => {
                const ev = data as VisualEvent;
                this.rawVisualListeners.forEach(l => l(ev));
                if (this.visualsMode === 'gameplay-only' && ev.source === 'playback') return;
                this.visualListeners.forEach(l => l(ev));
            });
        }
    }

    /**
     * ★ Q+N 主链路正式播放入口(qn_main_engine_takeover §5):直接播 MusicalIR。
     *   原生基线只下发 Bank/Program/Note；踏板、mix、表情等仍留在 IR，不进入 5504。
     *   另注入角色 visual 事件(LedMatrix)。
     */
    /** 返回本次【实际启动】的播放会话 id；failed(无 ir) 或起播前被其它源超越(startAudioContext
     *  await 期间 session 被 bump)则返回 null——调用方据此决定是否注册曲终 listener（防 superseded-start
     *  race：早退时全局 currentPlaybackId() 已是别人的会话，事后快照会错绑）。 */
    public async playMusicGeneration(result: MusicGenerationResult): Promise<number | null> {
        if (!result.ir) return null; // failed → 不播
        this.init();
        const currentSession = ++this.playSessionId;
        if (!Dream5504MidiOutput.requireReady('播放生成音乐')) {
            this.stop();
            throw new Error('未连接 Dream 5504 EK MIDI 输出，已静音');
        }
        if (currentSession !== this.playSessionId) return null;
        const events = applyPopFiveTrackMidiGuard(
            musicalIRToMidiEvents(result.ir, roomWetFor(result.styleHint), result.styleHint),
            result.styleHint,
        );
        const visuals = this.buildVisualEvents(result.ir);
        this.resetUploadedMidiBus();
        globalMidiScheduler.stop();
        Dream5504MidiOutput.panic();
        // Generated playback owns a distinct logical bus. Always establish
        // the Firm5504 power-up Master before loading it; never inherit an
        // uploaded file's controller/NRPN state or takeover backing gain.
        Dream5504MidiOutput.applyDefaultMasterVolume();

        globalMidiScheduler.loadTrack([...events, ...visuals], result.bpm, undefined, result.ir.durationTicks);
        globalMidiScheduler.start();

        this.currentMusicGeneration = result; // UI 读 getCurrentMusicGeneration().uiSnapshot
        this.currentPlaybackKind = 'generated';
        return currentSession; // 本次实际启动的会话 id（onTrackEnd 守卫绑它，防跨源劫持）
    }

    /** 上传 MIDI 播放（上传播放批）：smfParser 产出的 MidiEvent[]（PPQ480 已重标定）直喂
     *  独立 uploaded bus，再共享最终 Dream 5504 物理输出。无 LED visual（无 role 语义）。 */
    public async playUploadedMidi(events: MidiEvent[], bpm: number): Promise<void> {
        this.init();
        const currentSession = ++this.playSessionId;
        if (!Dream5504MidiOutput.isReady()) {
            await Dream5504MidiOutput.enableOutput();
        }
        if (!Dream5504MidiOutput.requireReady('播放上传 MIDI')) {
            this.stop();
            throw new Error('未连接 Dream 5504 EK MIDI 输出，已静音');
        }
        if (currentSession !== this.playSessionId) return;
        globalMidiScheduler.stop();
        Dream5504MidiOutput.panic();
        Dream5504MidiOutput.applyDefaultMasterVolume();
        // SMF channels are zero-based; generated roles ultimately claim the
        // same 1..16 hardware channels through midiEventToRoutedMessage.
        const uploadedEvents = events.map((event) => ({
            ...event,
            outputChannel: Math.max(1, Math.min(16, Math.round(event.channel) + 1)),
        }));
        this.uploadedMidiChannels.forEach((channel) =>
            globalMidiScheduler.setChannelVelocityScale(channel, 1));
        this.uploadedMidiChannels = new Set(
            uploadedEvents
                .filter((event) => event.type !== 'visual')
                .map((event) => event.channel),
        );
        this.uploadedMidiGainScale = 1;
        this.uploadedMidiChannels.forEach((channel) =>
            globalMidiScheduler.setChannelVelocityScale(channel, 1));
        globalMidiScheduler.loadTrack(uploadedEvents, bpm);
        globalMidiScheduler.onTrackEnd(() => {
            if (this.playSessionId === currentSession) {
                this.setUploadedMidiGainScale(1);
                this.uploadedMidiChannels.clear();
                this.currentPlaybackKind = null;
            }
        });
        globalMidiScheduler.start();
        this.currentMusicGeneration = null;   /* 非生成曲：清 UI 快照 */
        this.currentPlaybackKind = 'uploaded';
    }

    /** IR 每个音的 onset → 'visual' MidiEvent(角色 → LedMatrix 类型;source=playback)。 */
    private buildVisualEvents(ir: MusicalIR): MidiEvent[] {
        const out: MidiEvent[] = [];
        for (const track of ir.tracks) {
            const vtype = ROLE_VISUAL_TYPE[track.role]; if (!vtype) continue;
            const ch = ROLE_CHANNEL_VIS[track.role] ?? 0;
            for (const n of track.notes) {
                out.push({ ticks: n.startTick as number, type: 'visual', channel: ch, data1: 0, data2: 0, visualData: { type: vtype, midiNote: n.pitch as number, velocity: n.velocity, source: 'playback' } });
            }
        }
        return out;
    }

    public getCurrentMusicGeneration(): MusicGenerationResult | null { return this.currentMusicGeneration; }
    public getCurrentPlaybackKind(): AudioPlaybackKind { return this.currentPlaybackKind; }

    public setUploadedMidiGainScale(scale: number): void {
        // Stale takeover actions must never attenuate the generated-music bus.
        if (this.currentPlaybackKind !== 'uploaded') {
            this.uploadedMidiGainScale = 1;
            return;
        }
        const normalized = Math.max(0, Math.min(1, Number.isFinite(scale) ? scale : 1));
        this.uploadedMidiGainScale = normalized;
        this.uploadedMidiChannels.forEach((channel) =>
            globalMidiScheduler.setChannelVelocityScale(channel, normalized));
    }

    public getUploadedMidiGainScale(): number {
        return this.uploadedMidiGainScale;
    }

    /**
     * Revoice one channel of the already generated score. This is intentionally
     * a playback-local override: it neither regenerates nor mutates Arranger's
     * seed decisions. The channel score is replaced in place, while the
     * scheduler cursor stays at the current song position. Keeping the updated
     * history is essential: later mute/unmute recovery must not resurrect the
     * outgoing program or controller state.
     */
    public overrideCurrentGenerationVoice(selection: CurrentSongVoiceSelection): MusicGenerationResult | null {
        const current = this.currentMusicGeneration;
        if (!current?.ir) return null;
        const updated = applyCurrentSongVoiceOverride(current, selection);
        const changedTrack = updated.ir.tracks.find((track) => track.role === selection.role);
        const channel = ROLE_CHANNEL_VIS[selection.role];
        if (!changedTrack || channel === undefined) return null;

        const currentTick = Math.max(0, Math.ceil(globalMidiScheduler.getCurrentTick()));
        const scoreEvents = applyPopFiveTrackMidiGuard(
            musicalIRToMidiEvents(updated.ir, roomWetFor(updated.styleHint), updated.styleHint),
            updated.styleHint,
        );
        const visuals = this.buildVisualEvents(updated.ir);
        const channelEvents = [...scoreEvents, ...visuals]
            .filter((event) => event.channel === channel);
        globalMidiScheduler.replaceChannelEvents(channel, 0, channelEvents);

        // MIDI output has a small native timestamp lookahead. Replace the
        // score first, then flush that queue and restart scheduling from the
        // live tick against the updated event list. Doing this in the reverse
        // order would skip events exactly at the handoff tick.
        globalMidiScheduler.setPosition(currentTick);

        // A live handoff cannot wait for tick-0 state to replay. Reduce the
        // updated full score at the current tick, then reinstall the selected
        // voice plus its authored CC11/CC64 state in one ordered transaction.
        const bank = changedTrack.role === 'drum' ? undefined : (changedTrack.bank ?? 0);
        const program = mapProgramToDream5504(changedTrack.program ?? 0, changedTrack.role, updated.styleHint);
        globalMidiScheduler.restoreChannelState(channel, {
            atTick: currentTick,
            sourceEvents: scoreEvents,
            releaseCurrentSound: true,
            resetControllers: true,
            ...(bank === undefined ? {} : { bankMsb: bank }),
            program,
        });

        this.currentMusicGeneration = updated;
        return updated;
    }

    /** 当前播放会话 id（每次 play* / 切 bank/后端/采样率自增）。跨会话 onTrackEnd 守卫用：
     *  只有仍是自己起播的会话才响应曲终——防上传试听/切源后的过期 onTrackEnd 劫持续播。 */
    public currentPlaybackId(): number { return this.playSessionId; }

    /**
     * Stop sound and invalidate loop callbacks without discarding the current
     * generated score. The right-side instrument editor uses this so voice
     * selections remain editable/replayable after Stop.
     */
    public stopPlaybackPreservingCurrentGeneration(): void {
        this.playSessionId++;
        globalMidiScheduler.stop();
        this.resetUploadedMidiBus();
        Dream5504MidiOutput.applyDefaultMasterVolume();
        this.currentPlaybackKind = null;
    }

    private resetUploadedMidiBus(): void {
        this.uploadedMidiChannels.forEach((channel) =>
            globalMidiScheduler.setChannelVelocityScale(channel, 1));
        this.uploadedMidiChannels.clear();
        this.uploadedMidiGainScale = 1;
    }

    /** Full stop for source changes: also discard the current generated score. */
    public stop(): void {
        this.stopPlaybackPreservingCurrentGeneration();
        this.currentMusicGeneration = null;
    }

    public async setSoundFontBank(id: SoundFontBankId): Promise<void> {
        this.playSessionId++;
        this.stop();
        if (!SOUND_FONT_BANKS.some(bank => bank.id === id)) {
            throw new Error(`未知 Dream 5504 MIDI 目标：${id}`);
        }
        notifySoundFontBank();
    }

    public getSoundFontBank(): SoundFontBank {
        return getSelectedSoundFontBank();
    }

    public getCurrentBeat(): number {
        const tick = globalMidiScheduler.getCurrentTick();
        const ppq = globalMidiScheduler.ppq;
        if (!ppq || ppq <= 0) return 0;
        return tick / ppq;
    }

    public addVisualListener(listener: VisualEventListener): void { this.visualListeners.add(listener); }
    public removeVisualListener(listener: VisualEventListener): void { this.visualListeners.delete(listener); }
    public addRawVisualListener(listener: VisualEventListener): void { this.rawVisualListeners.add(listener); }
    public removeRawVisualListener(listener: VisualEventListener): void { this.rawVisualListeners.delete(listener); }

    public setVisualsMode(mode: 'all' | 'gameplay-only'): void { this.visualsMode = mode; }

    public emitVisualEvent(event: VisualEvent): void {
        this.init();
        this.rawVisualListeners.forEach(l => l(event));
        if (this.visualsMode === 'gameplay-only' && event.source === 'playback') return;
        this.visualListeners.forEach(l => l(event));
    }

    public muteChannel(channel: number, mute: boolean): void {
        globalMidiScheduler.muteChannel(channel, mute);
    }

    public muteChannelGracefully(channel: number, mute: boolean): void {
        globalMidiScheduler.muteChannelGracefully(channel, mute);
    }

    public isChannelMuted(channel: number): boolean {
        return globalMidiScheduler.isChannelMuted(channel);
    }

    public muteNoteRange(channel: number, range: MidiNoteRange, mute: boolean): void {
        globalMidiScheduler.muteNoteRange(channel, range, mute);
    }

    public isNoteRangeMuted(channel: number, range: MidiNoteRange): boolean {
        return globalMidiScheduler.isNoteRangeMuted(channel, range);
    }

    public muteNoteTargets(targets: ReadonlyArray<MidiNoteTarget>, mute: boolean): void {
        globalMidiScheduler.muteNoteTargets(targets, mute);
    }

    public muteNoteTargetsGracefully(
        targets: ReadonlyArray<MidiNoteTarget>,
        mute: boolean,
    ): void {
        globalMidiScheduler.muteNoteTargetsGracefully(targets, mute);
    }

    public areNoteTargetsMuted(targets: ReadonlyArray<MidiNoteTarget>): boolean {
        return globalMidiScheduler.areNoteTargetsMuted(targets);
    }

    // ★ Q+N PartName → channel(对齐 musicalIrToMidi ROLE_CHANNEL:lead=1/comp=2/bass=3/drum=9)。
    //   Q+N 直装 globalMidiScheduler,单轨 mute 走此 map。
    private qnPartChannel(partName: PartName): number | null {
        const map: Partial<Record<PartName, number>> = { melody: 1, chord: 2, bass: 3, drums: 9 };
        return map[partName] ?? null;
    }

    public setPartMute(partName: PartName, mute: boolean): void {
        const channel = this.currentMusicGeneration ? this.qnPartChannel(partName) : null;
        if (channel !== null) globalMidiScheduler.muteChannel(channel, mute);
    }

    public isPartMuted(partName: PartName): boolean {
        const channel = this.currentMusicGeneration ? this.qnPartChannel(partName) : null;
        if (channel === null) return false;
        return globalMidiScheduler.isChannelMuted(channel);
    }

    public injectMidiEvent(ev: any): void { globalMidiScheduler.injectEvent(ev); }
    public getChannelEvents(channel: number) { return globalMidiScheduler.getChannelEvents(channel); }
    public replaceChannelEvents(channel: number, startTick: number, newEvents: any[], endTick?: number): void {
        globalMidiScheduler.replaceChannelEvents(channel, startTick, newEvents, endTick);
    }

    public playNote(channel: number, note: number, velocity: number = 100, durationMs: number = 200): void {
        this.noteOn(channel, note, velocity);
        window.setTimeout(() => this.noteOff(channel, note), Math.max(1, durationMs));
    }
    public getAudioTime(): number {
        return performance.now() / 1000;
    }
    public noteOn(channel: number, note: number, velocity: number = 100): void {
        this.noteOnAt(channel, note, velocity, this.getAudioTime());
    }
    public noteOnAt(channel: number, note: number, velocity: number = 100, audioTime: number = this.getAudioTime()): void {
        const ch = Math.max(0, Math.min(15, Math.round(channel)));
        const midi = Math.max(0, Math.min(127, Math.round(note)));
        const vel = Math.max(0, Math.min(127, Math.round(velocity)));
        // Web MIDI timestamps use the same performance.now() time origin.
        const timestampMs = Number.isFinite(audioTime) ? Math.max(0, audioTime * 1000) : undefined;
        Dream5504MidiOutput.sendSchedulerChannelMessage(ch, { type: 'noteOn', data1: midi, data2: vel }, timestampMs);
    }
    public noteOff(channel: number, note: number): void {
        this.noteOffAt(channel, note, this.getAudioTime());
    }
    public noteOffAt(channel: number, note: number, audioTime: number = this.getAudioTime()): void {
        const ch = Math.max(0, Math.min(15, Math.round(channel)));
        const midi = Math.max(0, Math.min(127, Math.round(note)));
        const timestampMs = Number.isFinite(audioTime) ? Math.max(0, audioTime * 1000) : undefined;
        Dream5504MidiOutput.sendSchedulerChannelMessage(ch, { type: 'noteOff', data1: midi, data2: 0 }, timestampMs);
    }
    public programChange(channel: number, program: number): void {
        const ch = Math.max(0, Math.min(15, Math.round(channel)));
        const pc = Math.max(0, Math.min(127, Math.round(program)));
        Dream5504MidiOutput.sendSchedulerChannelMessage(ch, { type: 'programChange', data1: pc });
    }
    public controllerChange(channel: number, controller: number, value: number): void {
        this.controllerChangeAt(channel, controller, value, this.getAudioTime());
    }
    public controllerChangeAt(channel: number, controller: number, value: number, audioTime: number = this.getAudioTime()): void {
        const ch = Math.max(0, Math.min(15, Math.round(channel)));
        const cc = Math.max(0, Math.min(127, Math.round(controller)));
        const val = Math.max(0, Math.min(127, Math.round(value)));
        const timestampMs = Number.isFinite(audioTime) ? Math.max(0, audioTime * 1000) : undefined;
        Dream5504MidiOutput.sendSchedulerChannelMessage(ch, { type: 'cc', data1: cc, data2: val }, timestampMs);
    }

    public getCurrentTick(): number { return globalMidiScheduler.getCurrentTick(); }
    public getBpm(): number { return globalMidiScheduler.getBpm(); }
    public getPpq(): number { return globalMidiScheduler.ppq; }
}

type VisualEventListener = (event: VisualEvent) => void;

export const AudioEngine = new AudioEngineSystem();
