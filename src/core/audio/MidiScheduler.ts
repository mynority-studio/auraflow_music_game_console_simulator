// ============================================================
// 🚧 STUB — MIDI 调度器占位
// ============================================================
//
// 历史功能：
//   MidiScheduler 模拟 ESP32 上的 FreeRTOS 硬件定时器：
//   ① 用 Web Worker 周期唤醒（背景标签页也能跑）
//   ② 维护 events: MidiEvent[]（PPQ=480），按 currentTick 推进
//   ③ 派发 noteOn/noteOff/cc/programChange/pitchBend/visual 到 SpessaSynth
//   ④ 支持 muteChannel / loop / tempoCurves / onTrackEnd / channelEvents 替换
//   消费方：PlaybackEngine（写）、AudioEngine（读 tick / channel）、
//          EndlessRadioManager + JamSessionManager（jam 模式直接编辑事件流）。
//
// 重构期占位行为：
//   - 所有调度方法均为 no-op，不会真正派发事件
//   - getCurrentTick/getBpm/ppq 返回常量；beatsToTicks 仍是 round(beats*ppq)
//   - injectEvent / replaceChannelEvents 仅维护一个简易事件数组以便 getChannelEvents 自洽
//   - onTrackEnd 注册的回调永远不会被自动触发（曲子永不"结束"）— 调用方需要显式 stop
//   - addVisualListener 仍记录 listener，但本占位永远不会主动触发可视化事件
//
// 重构方向：
//   新音频引擎决定是否继续 PPQ=480 + Worker tick 的模型（C 移植口径）。
//   重写时尽量保持 MidiEvent shape 与公开方法签名，让 PlaybackEngine 重写最小化。
// ============================================================

import type { TempoCurve } from '../generation/types';

export interface MidiEvent {
    ticks: number;
    type: 'noteOn' | 'noteOff' | 'cc' | 'programChange' | 'pitchBend' | 'visual';
    channel: number;
    data1: number;
    data2: number;
    visualData?: any;
}

export class MidiScheduler {
    public readonly ppq: number = 480;
    public isPlaying: boolean = false;
    public loop: boolean = false;
    public loopStartTicks: number = 0;
    public loopEndTicks: number = 0;

    private events: MidiEvent[] = [];
    private currentTick: number = 0;
    private currentBpm: number = 120;
    private mutedChannels: Set<number> = new Set();
    private visualListeners: ((data: any) => void)[] = [];
    private endListeners: (() => void)[] = [];

    public init(_synth: unknown): void { /* no-op */ }

    public muteChannel(channel: number, mute: boolean): void {
        if (mute) this.mutedChannels.add(channel);
        else this.mutedChannels.delete(channel);
    }

    public isChannelMuted(channel: number): boolean {
        return this.mutedChannels.has(channel);
    }

    public injectEvent(ev: MidiEvent): void {
        this.events.push(ev);
    }

    public getChannelEvents(channel: number): MidiEvent[] {
        return this.events.filter(e => e.channel === channel);
    }

    public replaceChannelEvents(
        channel: number,
        startTick: number,
        newEvents: MidiEvent[],
        endTick?: number,
    ): void {
        this.events = this.events.filter(e => {
            if (e.channel !== channel) return true;
            if (e.ticks < startTick) return true;
            if (endTick !== undefined && e.ticks >= endTick) return true;
            return false;
        });
        this.events.push(...newEvents);
    }

    public addVisualListener(listener: (data: any) => void): void {
        this.visualListeners.push(listener);
    }

    public removeVisualListener(listener: (data: any) => void): void {
        this.visualListeners = this.visualListeners.filter(l => l !== listener);
    }

    public onTrackEnd(listener: () => void): void {
        this.endListeners.push(listener);
    }

    public loadTrack(events: MidiEvent[], bpm: number, _tempoCurves?: TempoCurve[]): void {
        this.events = [...events];
        this.currentBpm = bpm;
        this.currentTick = 0;
    }

    public load(events: MidiEvent[], bpm: number): void { this.loadTrack(events, bpm); }

    public setBpm(bpm: number): void { this.currentBpm = bpm; }
    public getBpm(): number { return this.currentBpm; }

    public setPosition(ticks: number): void { this.currentTick = ticks; }
    public getCurrentTick(): number { return this.currentTick; }

    public start(): void { this.isPlaying = false; /* placeholder: never actually plays */ }
    public stop(): void {
        this.isPlaying = false;
        this.currentTick = 0;
    }
    public pause(): void { this.isPlaying = false; }

    public clear(): void {
        this.stop();
        this.events = [];
        this.visualListeners = [];
        this.endListeners = [];
        this.mutedChannels.clear();
    }

    public panic(): void { /* no-op */ }

    public beatsToTicks(beats: number): number {
        return Math.round(beats * this.ppq);
    }
}

export const globalMidiScheduler = new MidiScheduler();
