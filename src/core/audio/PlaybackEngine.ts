// ============================================================
// 🚧 STUB — 播放引擎占位
// ============================================================
//
// 历史功能：
//   PlaybackEngine.loadSong(arranged) 把 ArrangedTrack 转成 MidiEvent[]：
//   ① 抽 mastering profile + 创建 InstrumentRegistry 通道
//   ② 渲染 vocal/melody/secondary/pianoLH/pianoRH/drums/counterMelody 7 轨为 noteOn/Off
//   ③ 注入 CC7/CC10/CC91（per-section 渐入 + spread 衰减）
//   ④ Sidechain（kick → bass/chord 触发 CC11 包络）
//   ⑤ CC11 呼吸包络（counterMelody/secondaryMelody 长音）
//   ⑥ CC74 Intro 低通涌动 / CC64 Signature Ending 延音
//   ⑦ Count-in 4 拍 + 循环 loopStart/loopEnd
//   最终调 globalMidiScheduler.loadTrack(events, bpm, tempoCurves) 启动播放。
//
// 重构期占位行为：
//   - PartName / VisualEvent 类型保留（被 AudioEngine / PipelineMonitor 引用）
//   - PlaybackEngine 类仅暴露空方法签名，loadSong 不再生成任何 MIDI 事件
//   - getMixerState 返回 VolumeController 期望的字段骨架，避免空时崩 UI
//
// 重构方向：
//   新音频引擎决定混音架构（保留 MIDI CC 驱动 / 切换 GainNode / 改用 WebMIDI）。
//   重写时尽量复用 PartName 命名，让 AudioEngine 的 partChannels 接口可平滑迁移。
// ============================================================

import type { ArrangedTrack } from '../generation/types';

export interface VisualEvent {
    type: 'melody' | 'pianoLH' | 'pianoRH' | 'drums' | 'bass' | 'counterMelody' | 'confirm' | 'custom_particle' | 'fn_key_active';
    midiNote?: number;
    velocity?: number;
    col?: number;
    row?: number;
    hue?: number;
    energy?: number;
    spread?: number;
    source?: 'playback' | 'gameplay';
    time?: number;
    onset?: number;
    isUserMotif?: boolean;
    active?: boolean;
}

export type VisualEventListener = (event: VisualEvent) => void;

export type PartName =
    | 'vocal'
    | 'melody'
    | 'chord'
    | 'bass'
    | 'drums'
    | 'secondaryMelody'
    | 'counterMelody';

export interface MixerStateStub {
    volumes: { master: number; melody: number; pianoLH: number; pianoRH: number };
    eq: {
        melody: { low: number; mid: number; high: number };
        piano: { low: number; mid: number; high: number };
    };
    effects: {
        reverbWet: number; reverbRoomSize: number;
        hallWet: number; hallSize: number;
        filterFreq: number; compThreshold: number; compRatio: number;
    };
    system: { hardwareLofi: number };
}

const DEFAULT_MIXER_STATE: MixerStateStub = {
    volumes: { master: 0, melody: 0, pianoLH: 0, pianoRH: 0 },
    eq: {
        melody: { low: 0, mid: 0, high: 0 },
        piano: { low: 0, mid: 0, high: 0 },
    },
    effects: {
        reverbWet: 0.0, reverbRoomSize: 0.5,
        hallWet: 0.0, hallSize: 1.0,
        filterFreq: 20000, compThreshold: 0, compRatio: 1,
    },
    system: { hardwareLofi: 0 },
};

export class PlaybackEngine {
    private partChannels: Partial<Record<PartName, number>> = {};
    private visualListeners: VisualEventListener[] = [];
    private mixerState: MixerStateStub = JSON.parse(JSON.stringify(DEFAULT_MIXER_STATE));

    public setDrumDucking(_enabled: boolean): void { /* no-op */ }

    public getPartChannels(): Partial<Record<PartName, number>> {
        return { ...this.partChannels };
    }

    public getPartChannel(partName: PartName): number | null {
        return this.partChannels[partName] ?? null;
    }

    public addVisualListener(listener: VisualEventListener): void {
        this.visualListeners.push(listener);
    }
    public removeVisualListener(listener: VisualEventListener): void {
        this.visualListeners = this.visualListeners.filter(l => l !== listener);
    }
    public emitVisualEvent(event: VisualEvent): void {
        this.visualListeners.forEach(l => l(event));
    }

    public getMixerState(): MixerStateStub { return this.mixerState; }

    public setMixerParam(category: string, param: string, value: number): void {
        const s = this.mixerState as unknown as Record<string, Record<string, number>>;
        if (category === 'eq') {
            const [inst, band] = param.split('.');
            if (s.eq && (s.eq as any)[inst]) (s.eq as any)[inst][band] = value;
            return;
        }
        if (s[category] && Object.prototype.hasOwnProperty.call(s[category], param)) {
            s[category][param] = value;
        }
    }

    public setFocusTrack(_trackType: 'RHYTHM' | 'MELODY' | 'ATMOSPHERE' | 'NONE'): void { /* no-op */ }

    public async loadSong(_song: ArrangedTrack, _options?: { withCountIn?: boolean; loopStart?: number; loopEnd?: number }): Promise<void> {
        this.partChannels = {};
    }

    public async appendSongChunk(_song: ArrangedTrack): Promise<void> { /* no-op */ }

    public setNextBlockTrigger(_triggerBeat: number, _callback: () => void): void { /* no-op */ }

    public play(): void { /* no-op */ }
    public stop(): void { /* no-op */ }

    public getDuration(): number { return 0; }
}
