/**
 * AudioEngine — 音频引擎单例（Phase 4 实装版）
 *
 * App 层与音频后端的总入口：
 *   ① 管理 PlaybackEngine 生命周期 + 转发 visualListener / rawVisualListener
 *   ② playSong(track, styleId, context, generator) 调 AbsoluteTransposer.arrange → playback.loadSong
 *   ③ 暴露 getCurrentArrangedTrack / getCurrentContext / getCurrentBeat / getCurrentTick / getBpm / getPpq
 *   ④ MIDI 通道工具：muteChannel / setPartMute / injectMidiEvent / get|replaceChannelEvents
 *   ⑤ 实时演奏：playNote / noteOn / noteOff / pitchBend（暂保 no-op，Phase 5 实装）
 *   ⑥ Mixer 状态读写 + Focus Track / Drum Ducking 等播放策略开关
 *
 * Phase 4 关键改动：
 *   - 移除 expandVoicingsToNoteData — 老的 chord.voicing 展开逻辑被 Stage 5
 *     accompaniment 轨取代。
 *   - playSong 现在调用 AbsoluteTransposer.arrange 把 RELATIVE 空间 GeneratedTrack 转成
 *     ABSOLUTE 空间 ArrangedTrack，再交给 PlaybackEngine.loadSong（内部跑
 *     MidiConverter.convert）。
 *   - K-2 唯一加 keyOffset 的位置：AbsoluteTransposer。本类**不再**触碰 keyOffset。
 */

import { PlaybackEngine, VisualEvent, PartName } from './PlaybackEngine';
import { ArrangedTrack, GeneratedTrack, MusicContext } from '../generation/types';
import { StyleId } from '../generation/config/StyleFlags';
import { AbsoluteTransposer } from '../generation/pipeline/AbsoluteTransposer';

import { globalMidiScheduler, type MidiEvent } from './MidiScheduler';
import { musicalIRToMidiEvents, roomWetFor } from './musicalIrToMidi';
import type { MusicalIR } from '../generation/newEngine/ir/MusicalIR';
import type { MusicGenerationResult } from '../generation/musicGeneration/types';
import {
    spessaSynth,
    isSpessaSynthReady,
    getAudioContext,
    startAudioContext,
} from './SynthManager';

export { spessaSynth, isSpessaSynthReady, getAudioContext, startAudioContext };

// ★ Q+N 角色 → LedMatrix VisualEvent 类型(qn_main_engine_takeover §5.3)。pad 暂归 accomp(无专属 atmosphere 视觉)。
const ROLE_VISUAL_TYPE: Record<string, VisualEvent['type']> = {
    lead: 'melody', comp: 'accomp', bass: 'bass', drum: 'drums', pad: 'accomp',
};
const ROLE_CHANNEL_VIS: Record<string, number> = { lead: 1, comp: 2, bass: 3, pad: 4, drum: 9 };

class AudioEngineSystem {
    private playback: PlaybackEngine | null = null;
    private visualsMode: 'all' | 'gameplay-only' = 'all';
    private currentArrangedTrack: ArrangedTrack | null = null;
    private currentContext: MusicContext | null = null;
    // ★ Q+N 主链路:当前音乐生成结果(正式 state;PipelineMonitor/AuraJam 读 uiSnapshot)。
    private currentMusicGeneration: MusicGenerationResult | null = null;
    private schedulerVisualWired = false;

    // 并发互斥 — 快速连点 Play 时，仅最后一次触发的会话能完成 loadSong/play
    private playSessionId: number = 0;

    private visualListeners: Set<VisualEventListener> = new Set();
    private rawVisualListeners: Set<VisualEventListener> = new Set();

    public init(): void {
        if (!this.playback) {
            this.playback = new PlaybackEngine();
            this.playback.addVisualListener((event: VisualEvent) => {
                this.rawVisualListeners.forEach(l => l(event));
                if (this.visualsMode === 'gameplay-only' && event.source === 'playback') return;
                this.visualListeners.forEach(l => l(event));
            });
        }
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

        const events = musicalIRToMidiEvents(result.ir, roomWetFor(result.styleHint));
        const visuals = this.buildVisualEvents(result.ir);
        globalMidiScheduler.stop();
        globalMidiScheduler.loadTrack([...events, ...visuals], result.bpm);
        globalMidiScheduler.start();

        this.currentMusicGeneration = result;
        // 兼容投影(§5.2/§12.3:getCurrentArrangedTrack/Context 仍非空可用)。详细 UI 数据走 getCurrentMusicGeneration().uiSnapshot。
        this.currentArrangedTrack = { bpm: result.bpm, key: result.uiSnapshot.key, absoluteStartBeat: 0, timeSignature: result.uiSnapshot.timeSignature, melody: [] } as ArrangedTrack;
        this.currentContext = { keyOffset: 0, tonality: result.uiSnapshot.tonality, bpm: result.bpm, timeSignature: result.uiSnapshot.timeSignature, grooveDNA: [] } as unknown as MusicContext;
    }

    /** 低层:直接播 MusicalIR(无 MusicGenerationResult 包装;诊断/特殊路径用)。 */
    public async playMusicalIR(ir: MusicalIR, ctx: { styleHint: string; bpm: number }): Promise<void> {
        this.init();
        const currentSession = ++this.playSessionId;
        await startAudioContext();
        if (currentSession !== this.playSessionId) return;
        const events = musicalIRToMidiEvents(ir, roomWetFor(ctx.styleHint));
        const visuals = this.buildVisualEvents(ir);
        globalMidiScheduler.stop();
        globalMidiScheduler.loadTrack([...events, ...visuals], ctx.bpm);
        globalMidiScheduler.start();
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

    public async playSong(
        initialTrack: GeneratedTrack,
        styleId: StyleId,
        context: MusicContext,
        _options?: { withCountIn?: boolean; loopStart?: number; loopEnd?: number },
    ): Promise<void> {
        if (!this.playback) this.init();

        // 并发互斥：每次调用领取一个新 session id；仅在 startAudioContext 后检查一次
        const currentSession = ++this.playSessionId;

        // 确保 SpessaSynth 已就绪（用户手势后第一次播放才会真正加载 SF2）
        await startAudioContext();
        if (currentSession !== this.playSessionId) return;

        // K-2：AbsoluteTransposer 是 RELATIVE→ABSOLUTE 的唯一转换点
        const arranged: ArrangedTrack = AbsoluteTransposer.arrange(initialTrack, styleId, context);

        this.currentArrangedTrack = arranged;
        this.currentContext = context;

        await this.playback!.loadSong(arranged);
        this.playback!.play();
    }

    public stop(): void {
        if (this.playback) this.playback.stop();
        else globalMidiScheduler.stop(); // Q+N 路径可能未初始化 PlaybackEngine
        this.currentArrangedTrack = null;
        this.currentContext = null;
        this.currentMusicGeneration = null;
    }

    public getCurrentArrangedTrack(): ArrangedTrack | null { return this.currentArrangedTrack; }
    public getCurrentContext(): MusicContext | null { return this.currentContext; }

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

    public setDrumDucking(_enabled: boolean): void { /* no-op */ }

    public emitVisualEvent(event: VisualEvent): void {
        if (!this.playback) this.init();
        this.rawVisualListeners.forEach(l => l(event));
        if (this.visualsMode === 'gameplay-only' && event.source === 'playback') return;
        this.visualListeners.forEach(l => l(event));
    }

    public getMixerState() {
        if (!this.playback) this.init();
        return this.playback!.getMixerState();
    }

    public getDuration(): number {
        if (!this.playback) return 0;
        return this.playback.getDuration();
    }

    public setMixerParam(category: string, param: string, value: number): void {
        if (!this.playback) this.init();
        this.playback!.setMixerParam(category, param, value);
    }

    public setFocusTrack(_trackType: 'RHYTHM' | 'MELODY' | 'ATMOSPHERE' | 'NONE'): void { /* no-op */ }

    public muteChannel(channel: number, mute: boolean): void {
        globalMidiScheduler.muteChannel(channel, mute);
    }

    public isChannelMuted(channel: number): boolean {
        return globalMidiScheduler.isChannelMuted(channel);
    }

    public getPartChannels(): Partial<Record<PartName, number>> {
        if (!this.playback) return {};
        return this.playback.getPartChannels();
    }

    public setPartMute(partName: PartName, mute: boolean): void {
        if (!this.playback) return;
        const channel = this.playback.getPartChannel(partName);
        if (channel !== null) globalMidiScheduler.muteChannel(channel, mute);
    }

    public isPartMuted(partName: PartName): boolean {
        if (!this.playback) return false;
        const channel = this.playback.getPartChannel(partName);
        if (channel === null) return false;
        return globalMidiScheduler.isChannelMuted(channel);
    }

    public injectMidiEvent(ev: any): void { globalMidiScheduler.injectEvent(ev); }
    public getChannelEvents(channel: number) { return globalMidiScheduler.getChannelEvents(channel); }
    public replaceChannelEvents(channel: number, startTick: number, newEvents: any[], endTick?: number): void {
        globalMidiScheduler.replaceChannelEvents(channel, startTick, newEvents, endTick);
    }

    public playNote(_channel: number, _note: number, _velocity: number = 100, _durationMs: number = 200): void { /* no-op */ }
    public noteOn(_channel: number, _note: number, _velocity: number = 100): void { /* no-op */ }
    public noteOff(_channel: number, _note: number): void { /* no-op */ }
    public pitchBend(_channel: number, _value: number): void { /* no-op */ }

    public getCurrentTick(): number { return globalMidiScheduler.getCurrentTick(); }
    public getBpm(): number { return globalMidiScheduler.getBpm(); }
    public getPpq(): number { return globalMidiScheduler.ppq; }
}

type VisualEventListener = (event: VisualEvent) => void;

export const AudioEngine = new AudioEngineSystem();
