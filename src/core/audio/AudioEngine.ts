/**
 * AudioEngine — 音频引擎单例(Q+N 主链路)
 *
 * App 层与音频后端的总入口:
 *   ① 正式播放:playMusicGeneration(result) —— MusicalIR → musicalIrToMidi → globalMidiScheduler(+ 视觉事件驱动 LedMatrix)
 *   ② 当前状态:getCurrentMusicGeneration()(唯一真源,UI 读 uiSnapshot)+ getCurrentBeat/Tick/Bpm/Ppq
 *   ③ MIDI 通道工具:muteChannel / setPartMute(Q+N PartName→channel)/ injectMidiEvent / get|replaceChannelEvents
 *   ④ 实时演奏 + 视觉监听转发(gameplay / LedMatrix)
 *
 * ★ 旧 mg 播放壳(playSong / PlaybackEngine / MidiConverter / AbsoluteTransposer / GeneratedTrack·MusicContext 投影)
 *   已删除;播放不再经 keyOffset 转置(MusicalIR 音符即绝对空间)。
 */

import { VisualEvent, PartName } from './playbackTypes';
import { globalMidiScheduler, type MidiEvent } from './MidiScheduler';
import { musicalIRToMidiEvents, roomWetFor } from './musicalIrToMidi';
import type { MusicalIR } from '../generation/newEngine/ir/MusicalIR';
import type { MusicGenerationResult } from '../generation/musicGeneration/types';
import { mapMidiProgramToAura25 } from '../sound/Aura25Palette';
// M1 批2：copych 后端——CC95 直通判据 + per-song 空间参数（SONG_SPACE_PROFILES 同源镜像设备 AR_CMD_SONG_*）
import { getSynthBackend, isCopychBackend, type SynthBackendKind } from './synthBackend';
import { CopychSynthFacade } from './copych/CopychSynthFacade';
import { songSpaceProfile } from '../generation/newEngine/knowledge/gmMixProfile';
import {
    spessaSynth,
    isSpessaSynthReady,
    getAudioContext,
    startAudioContext,
    SOUND_FONT_BANKS,
    getSelectedSoundFontBank,
    getLoadedSoundFontBank,
    setSelectedSoundFontBank,
    setSynthBackendKind,
    setPlaybackMasterStyle,
    subscribeSoundFontBank,
    type SoundFontBank,
    type SoundFontBankId,
} from './SynthManager';

export {
    spessaSynth,
    isSpessaSynthReady,
    getAudioContext,
    startAudioContext,
    SOUND_FONT_BANKS,
    getSelectedSoundFontBank,
    getLoadedSoundFontBank,
    subscribeSoundFontBank,
    setPlaybackMasterStyle,
    getSynthBackend,
};
export type { SoundFontBank, SoundFontBankId, SynthBackendKind };

// ★ Q+N 角色 → LedMatrix VisualEvent 类型(qn_main_engine_takeover §5.3)。pad 暂归 accomp(无专属 atmosphere 视觉)。
const ROLE_VISUAL_TYPE: Record<string, VisualEvent['type']> = {
    lead: 'melody', comp: 'accomp', bass: 'bass', drum: 'drums', pad: 'accomp',
};
const ROLE_CHANNEL_VIS: Record<string, number> = { lead: 1, comp: 2, bass: 3, pad: 4, drum: 9 };
const CC_DELAY_SEND = 95;

// delayMode → 拍数（镜像设备 ne_song_space_delay 换算：seconds = beats × 60 / bpm）
const DELAY_MODE_BEATS: Record<string, number> = {
    'eighth': 0.5, 'dotted-eighth': 0.75, 'quarter': 1.0, 'off': 0,
};

class AudioEngineSystem {
    private visualsMode: 'all' | 'gameplay-only' = 'all';
    // ★ Q+N 主链路:当前音乐生成结果(唯一正式 state;PipelineMonitor/AuraBar/AuraJam 读 uiSnapshot)。
    private currentMusicGeneration: MusicGenerationResult | null = null;
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
     *   保 programChanges/pedal/mix/mixChanges/ccEvents(musicalIRToMidiEvents)+ 注入角色 visual 事件(LedMatrix)。
     */
    public async playMusicGeneration(result: MusicGenerationResult): Promise<void> {
        if (!result.ir) return; // failed → 不播
        this.init();
        const currentSession = ++this.playSessionId;
        await startAudioContext();
        if (currentSession !== this.playSessionId) return;
        setPlaybackMasterStyle(result.styleHint);

        const events = musicalIRToMidiEvents(result.ir, roomWetFor(result.styleHint));
        const visuals = this.buildVisualEvents(result.ir);
        globalMidiScheduler.stop();

        // M1 批2：copych 后端 per-song 空间参数（reverb/chorus/delay，镜像设备 AR_CMD_SONG_*；
        // spessa 路径无此概念——房间感靠 CC91 send + echo 预渲染，零改动）。
        // 口径：world=undefined（TimbreWorld 未随 result 携带，syntheticSoft 判定缺失=POC 已知偏差）；
        // hasPad 由 IR pad 轨在场推导（与器配 songSpaceProfile 输入一致）。
        if (isCopychBackend() && spessaSynth instanceof CopychSynthFacade) {
            const hasPad = result.ir.tracks.some(t => t.role === 'pad' && t.notes.length > 0);
            const p = songSpaceProfile(result.styleHint, undefined, hasPad);
            const beats = DELAY_MODE_BEATS[p.delayMode] ?? 0;
            spessaSynth.setSongSpace({
                reverb: { time: p.reverbTime, level: p.reverbLevel, predelayMs: p.predelayMs, damping: p.damping },
                // 单位镜像固件 adapter：depth/100→秒、baseDelay ms→秒
                chorus: { lfoHz: p.chorusLfoHz, depthS: p.chorusDepth / 100, baseDelayS: p.chorusBaseDelay / 1000 },
                delay: { seconds: beats > 0 ? (beats * 60) / result.bpm : 0, feedback: p.delayFeedback, enabled: beats > 0 },
            });
        }

        globalMidiScheduler.loadTrack([...events, ...visuals], result.bpm);
        globalMidiScheduler.start();

        this.currentMusicGeneration = result; // UI 读 getCurrentMusicGeneration().uiSnapshot(不再造 GeneratedTrack/MusicContext 投影)
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

    public stop(): void {
        globalMidiScheduler.stop();
        setPlaybackMasterStyle(undefined);
        this.currentMusicGeneration = null;
    }

    public async setSoundFontBank(id: SoundFontBankId): Promise<void> {
        this.playSessionId++;
        this.stop();
        await setSelectedSoundFontBank(id);
    }

    /** 切换合成后端（顶部导航合成器菜单）。先停播放——loadTrack 的 echo 展开随后端变，
     *  在播曲目不可热迁移；切完重新点播即用新后端。 */
    public async setSynthBackend(kind: SynthBackendKind): Promise<void> {
        this.playSessionId++;
        this.stop();
        await setSynthBackendKind(kind);
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

    public isChannelMuted(channel: number): boolean {
        return globalMidiScheduler.isChannelMuted(channel);
    }

    // ★ Q+N PartName → channel(对齐 musicalIrToMidi ROLE_CHANNEL:lead=1/comp=2/bass=3/drum=9)。
    //   Q+N 直装 globalMidiScheduler(无旧 PlaybackEngine.partChannels),故单轨 mute 走此 map。
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
        return getAudioContext().currentTime;
    }
    public noteOn(channel: number, note: number, velocity: number = 100): void {
        this.noteOnAt(channel, note, velocity, getAudioContext().currentTime);
    }
    public noteOnAt(channel: number, note: number, velocity: number = 100, audioTime: number = getAudioContext().currentTime): void {
        if (!spessaSynth) return;
        const ch = Math.max(0, Math.min(15, Math.round(channel)));
        const midi = Math.max(0, Math.min(127, Math.round(note)));
        const vel = Math.max(0, Math.min(127, Math.round(velocity)));
        try { spessaSynth.noteOn(ch, midi, vel, { time: Math.max(getAudioContext().currentTime, audioTime) }); }
        catch { try { spessaSynth.noteOn(ch, midi, vel); } catch { /* ignore */ } }
    }
    public noteOff(channel: number, note: number): void {
        this.noteOffAt(channel, note, getAudioContext().currentTime);
    }
    public noteOffAt(channel: number, note: number, audioTime: number = getAudioContext().currentTime): void {
        if (!spessaSynth) return;
        const ch = Math.max(0, Math.min(15, Math.round(channel)));
        const midi = Math.max(0, Math.min(127, Math.round(note)));
        try { spessaSynth.noteOff(ch, midi, { time: Math.max(getAudioContext().currentTime, audioTime) }); }
        catch { try { spessaSynth.noteOff(ch, midi); } catch { /* ignore */ } }
    }
    public programChange(channel: number, program: number): void {
        if (!spessaSynth) return;
        const ch = Math.max(0, Math.min(15, Math.round(channel)));
        try { spessaSynth.programChange(ch, mapMidiProgramToAura25(program, ch)); }
        catch { /* ignore */ }
    }
    public controllerChange(channel: number, controller: number, value: number): void {
        if (!spessaSynth) return;
        const cc = Math.round(controller);
        // CC95：spessa 吞（echo 预渲染已代偿）；copych 直通真 FxDelay（计划修订1）
        if (cc === CC_DELAY_SEND && !isCopychBackend()) return;
        try {
            (spessaSynth as any).controllerChange?.(
                Math.round(channel),
                cc,
                Math.max(0, Math.min(127, Math.round(value))),
            );
        } catch { /* ignore */ }
    }

    public getCurrentTick(): number { return globalMidiScheduler.getCurrentTick(); }
    public getBpm(): number { return globalMidiScheduler.getBpm(); }
    public getPpq(): number { return globalMidiScheduler.ppq; }
}

type VisualEventListener = (event: VisualEvent) => void;

export const AudioEngine = new AudioEngineSystem();
