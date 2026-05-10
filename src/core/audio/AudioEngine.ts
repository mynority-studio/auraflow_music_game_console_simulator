// ============================================================
// 🚧 STUB — 音频引擎单例占位
// ============================================================
//
// 历史功能：
//   AudioEngine 是 App 层与音频后端的总入口：
//   ① 管理 PlaybackEngine 生命周期 + 转发 visualListener / rawVisualListener
//   ② playSong(track, styleId, context, generator) 调 Orchestrator.arrange → playback.loadSong
//   ③ 暴露 getCurrentArrangedTrack / getCurrentContext / getCurrentBeat / getCurrentTick / getBpm / getPpq
//   ④ MIDI 通道工具：muteChannel / setPartMute / injectMidiEvent / get|replaceChannelEvents
//   ⑤ 实时演奏：playNote / noteOn / noteOff / pitchBend（直接打 spessaSynth）
//   ⑥ Mixer 状态读写 + Focus Track / Drum Ducking 等播放策略开关
//
// 重构期占位行为：
//   - playSong 不真正播放，仅把传入 track + context 缓存供 PipelineMonitor UI 读取
//   - 所有实时演奏 API（noteOn/noteOff/playNote/pitchBend）变成 no-op，
//     SystemAudio / AuraBar / AuraJam 的"试听 / Jam 模式"全部静音降级
//   - visualListener 仍可注册，但占位永远不会主动派发事件
//   - 重导出 spessaSynth / isSpessaSynthReady / getAudioContext / startAudioContext，
//     维持旧 import 路径不变
//
// 重构方向：
//   新音频引擎重写时只需保持本文件公开方法的 shape 不变，App 层即可零改动接入。
// ============================================================

import { PlaybackEngine, VisualEvent, PartName } from './PlaybackEngine';
import { ArrangedTrack, GeneratedTrack, MusicContext } from '../generation/types';
import { StyleId } from '../generation/config/StyleFlags';
import { MelodyEngine } from '../generation/MelodyEngine';
import { globalMidiScheduler } from './MidiScheduler';
import {
    spessaSynth,
    isSpessaSynthReady,
    getAudioContext,
    startAudioContext,
} from './SynthManager';

export { spessaSynth, isSpessaSynthReady, getAudioContext, startAudioContext };

class AudioEngineSystem {
    private playback: PlaybackEngine | null = null;
    private generator: MelodyEngine | null = null;
    private visualsMode: 'all' | 'gameplay-only' = 'all';
    private currentArrangedTrack: ArrangedTrack | null = null;
    private currentContext: MusicContext | null = null;

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
    }

    public async playSong(
        initialTrack: GeneratedTrack,
        styleId: StyleId,
        context: MusicContext,
        generator: MelodyEngine,
        _options?: { withCountIn?: boolean; loopStart?: number; loopEnd?: number },
    ): Promise<void> {
        if (!this.playback) this.init();
        this.generator = generator;

        // STUB：旧实现走 Orchestrator.arrange(initialTrack, styleId, context) → ArrangedTrack
        // 占位期没有 Orchestrator，按 GeneratedTrack 字段直接拼一份最小 ArrangedTrack
        const arranged: ArrangedTrack = {
            bpm: initialTrack.bpm,
            key: initialTrack.key,
            absoluteStartBeat: initialTrack.absoluteStartBeat,
            timeSignature: initialTrack.timeSignature,
            styleId,
            vocal: initialTrack.vocal,
            melody: initialTrack.melody ?? [],
            secondaryMelody: undefined,
            pianoLH: [],
            pianoRH: [],
            drums: initialTrack.drums,
            counterMelody: initialTrack.counterMelody,
            userMotif: initialTrack.processedUserMotif,
            palette: initialTrack.preSelectedPalette,
            sections: initialTrack.sections,
            globalRiff: initialTrack.globalRiff,
            chords: initialTrack.chords,
        };
        this.currentArrangedTrack = arranged;
        this.currentContext = context;
    }

    public stop(): void {
        if (this.playback) this.playback.stop();
        this.generator = null;
        this.currentArrangedTrack = null;
        this.currentContext = null;
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
