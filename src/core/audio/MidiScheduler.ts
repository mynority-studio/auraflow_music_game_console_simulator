/**
 * MidiScheduler — PPQ=480 tick 调度器（Phase 2.D 实装版）
 *
 * 工作模型：
 *   - 5ms setInterval 轮询（主线程；够稳。背景标签页时 throttling 到 1Hz — 后续 Web Worker tick 优化时再补）
 *   - 用 performance.now() 计算自 start 起的 elapsed → 推算 currentTick
 *   - 每次轮询 fire all events with ticks ≤ currentTick AND未 fire 的
 *   - 索引 nextEventIdx 单调推进（events 已按 ticks 排序）
 *
 * 派发：
 *   - noteOn / noteOff / programChange → spessaSynth.*
 *   - cc / pitchBend → spessaSynth.controllerChange / pitchWheel（如果有；否则跳过）
 *   - visual → visualListeners
 *
 * 曲终：last event 之后等 200ms（让 noteOff 发音完整）→ fire onTrackEnd listeners → 自动停止。
 */

import type { TempoCurve } from '../generation/types';
import { spessaSynth } from './SynthManager';
import { mapMidiProgramToAura25 } from '../sound/Aura25Palette';

export interface MidiEvent {
    ticks: number;
    type: 'noteOn' | 'noteOff' | 'cc' | 'programChange' | 'pitchBend' | 'visual';
    channel: number;
    data1: number;
    data2: number;
    visualData?: any;
}

type PendingDelayNote = MidiEvent & { delaySend: number };

const TICK_LOOP_MS = 5;
const TRAILING_SILENCE_MS = 200;
const CC_DELAY_SEND = 95;
const DELAY_ECHO_TICKS = 240; // 1/8 note at PPQ=480
const MIN_DELAY_ECHO_DUR_TICKS = 72;
const MAX_DELAY_ECHO_DUR_TICKS = 240;

function midiEventOrder(ev: MidiEvent): number {
    if (ev.type === 'noteOff') return 0;
    if (ev.type === 'cc' || ev.type === 'programChange' || ev.type === 'pitchBend') return 1;
    if (ev.type === 'noteOn') return 2;
    return 3;
}

function compareMidiEvents(a: MidiEvent, b: MidiEvent): number {
    if (a.ticks !== b.ticks) return a.ticks - b.ticks;
    return midiEventOrder(a) - midiEventOrder(b);
}

function normalizeMidiEvent(ev: MidiEvent): MidiEvent {
    if (ev.type !== 'programChange') return ev;
    const mapped = mapMidiProgramToAura25(ev.data1, ev.channel);
    return mapped === ev.data1 ? ev : { ...ev, data1: mapped };
}

function clampMidi(v: number): number {
    return Math.max(0, Math.min(127, Math.round(v)));
}

function delayEchoVelocity(velocity: number, send: number): number {
    const gain = 0.22 + (clampMidi(send) / 127) * 0.45;
    return clampMidi(Math.max(1, Math.round(velocity * gain)));
}

function buildDelayEchoEvents(events: MidiEvent[]): MidiEvent[] {
    const delaySend = new Array<number>(16).fill(0);
    const pending = new Map<string, PendingDelayNote[]>();
    const echoes: MidiEvent[] = [];

    const keyOf = (event: MidiEvent): string => `${event.channel}:${event.data1}`;
    const pushEcho = (noteOn: PendingDelayNote, noteOffTick: number): void => {
        const duration = Math.max(1, noteOffTick - noteOn.ticks);
        const echoTick = noteOn.ticks + DELAY_ECHO_TICKS;
        const echoDur = Math.max(MIN_DELAY_ECHO_DUR_TICKS, Math.min(MAX_DELAY_ECHO_DUR_TICKS, Math.round(duration * 0.75)));
        echoes.push({
            ticks: echoTick,
            type: 'noteOn',
            channel: noteOn.channel,
            data1: noteOn.data1,
            data2: delayEchoVelocity(noteOn.data2, noteOn.delaySend),
        });
        echoes.push({
            ticks: echoTick + echoDur,
            type: 'noteOff',
            channel: noteOn.channel,
            data1: noteOn.data1,
            data2: 0,
        });
    };

    for (const event of events) {
        if (event.type === 'cc' && event.data1 === CC_DELAY_SEND) {
            delaySend[event.channel] = clampMidi(event.data2);
            continue;
        }

        if (event.type === 'noteOn' && event.data2 > 0) {
            const send = delaySend[event.channel] ?? 0;
            if (send <= 0) continue;
            const key = keyOf(event);
            const stack = pending.get(key) ?? [];
            stack.push({ ...event, data2: clampMidi(event.data2), delaySend: send });
            pending.set(key, stack);
            continue;
        }

        const isNoteOff = event.type === 'noteOff' || (event.type === 'noteOn' && event.data2 <= 0);
        if (!isNoteOff) continue;
        const key = keyOf(event);
        const stack = pending.get(key);
        const noteOn = stack?.shift();
        if (!noteOn) continue;
        if (!stack?.length) pending.delete(key);
        pushEcho(noteOn, event.ticks);
    }

    for (const [key, stack] of pending.entries()) {
        for (const noteOn of stack) {
            pushEcho(noteOn, noteOn.ticks + MAX_DELAY_ECHO_DUR_TICKS);
        }
        pending.delete(key);
    }

    return echoes;
}

function normalizeAndExpandEvents(events: MidiEvent[]): MidiEvent[] {
    const normalized = events.map(normalizeMidiEvent).sort(compareMidiEvents);
    const echoes = buildDelayEchoEvents(normalized);
    return normalized.concat(echoes).sort(compareMidiEvents);
}

export class MidiScheduler {
    public readonly ppq: number = 480;
    public isPlaying = false;
    public loop = false;
    public loopStartTicks = 0;
    public loopEndTicks = 0;

    private events: MidiEvent[] = [];
    private nextEventIdx = 0;
    private currentTick = 0;
    private currentBpm = 120;

    private startWallTimeMs = 0;
    private startTickAtResume = 0;
    private tickHandle: ReturnType<typeof setInterval> | null = null;
    private endFireScheduled = false;

    private mutedChannels: Set<number> = new Set();
    private visualListeners: ((data: any) => void)[] = [];
    private endListeners: (() => void)[] = [];

    public init(_synth: unknown): void { /* synth 由 SynthManager 单例管理，本方法保持签名兼容 */ }

    // -----------------------------------------------------------
    // 事件流装载
    // -----------------------------------------------------------

    public loadTrack(events: MidiEvent[], bpm: number, _tempoCurves?: TempoCurve[]): void {
        // 已按 ticks 升序排好（musicalIRToMidiEvents 输出时排序）— 这里再保险一次。
        // 浏览器 synth 不一定消费 CC95;这里把 CC95 预渲染成轻量 echo note,ESP32 仍可直接吃原 CC95。
        this.events = normalizeAndExpandEvents(events);
        this.currentBpm = bpm;
        this.currentTick = 0;
        this.nextEventIdx = 0;
        this.endFireScheduled = false;
    }

    public load(events: MidiEvent[], bpm: number): void { this.loadTrack(events, bpm); }

    // -----------------------------------------------------------
    // 播放控制
    // -----------------------------------------------------------

    public start(): void {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.startWallTimeMs = performance.now();
        this.startTickAtResume = this.currentTick;
        if (this.tickHandle) clearInterval(this.tickHandle);
        this.tickHandle = setInterval(() => this.tickLoop(), TICK_LOOP_MS);
    }

    public stop(): void {
        this.isPlaying = false;
        if (this.tickHandle) {
            clearInterval(this.tickHandle);
            this.tickHandle = null;
        }
        this.currentTick = 0;
        this.nextEventIdx = 0;
        this.endFireScheduled = false;
        this.panic();
    }

    public pause(): void {
        this.isPlaying = false;
        if (this.tickHandle) {
            clearInterval(this.tickHandle);
            this.tickHandle = null;
        }
    }

    public panic(): void {
        // 所有通道发 allNotesOff（CC 123 = All Notes Off）— 防止残音
        const synth = spessaSynth;
        if (!synth) return;
        for (let ch = 0; ch < 16; ch++) {
            try { synth.controllerChange(ch, 123, 0); } catch { /* ignore */ }
        }
    }

    public clear(): void {
        this.stop();
        this.events = [];
        this.visualListeners = [];
        this.endListeners = [];
        this.mutedChannels.clear();
    }

    // -----------------------------------------------------------
    // 核心 tick 循环
    // -----------------------------------------------------------

    private tickLoop(): void {
        if (!this.isPlaying) return;

        const elapsedMs = performance.now() - this.startWallTimeMs;
        const ticksPerSec = (this.currentBpm / 60) * this.ppq;
        this.currentTick = this.startTickAtResume + (elapsedMs / 1000) * ticksPerSec;

        // 派发所有 ticks ≤ currentTick 的未派发事件
        while (
            this.nextEventIdx < this.events.length &&
            this.events[this.nextEventIdx].ticks <= this.currentTick
        ) {
            this.dispatchEvent(this.events[this.nextEventIdx]);
            this.nextEventIdx++;
        }

        // 曲终检测
        if (this.nextEventIdx >= this.events.length && !this.endFireScheduled) {
            this.endFireScheduled = true;
            setTimeout(() => {
                if (this.isPlaying) {
                    this.endListeners.forEach(l => {
                        try { l(); } catch { /* ignore */ }
                    });
                    this.stop();
                }
            }, TRAILING_SILENCE_MS);
        }
    }

    private dispatchEvent(ev: MidiEvent): void {
        if (ev.type === 'visual') {
            this.visualListeners.forEach(l => {
                try { l(ev.visualData); } catch { /* ignore */ }
            });
            return;
        }
        if (this.mutedChannels.has(ev.channel)) return;
        const synth = spessaSynth;
        if (!synth) return;

        try {
            if (ev.type === 'noteOn') synth.noteOn(ev.channel, ev.data1, ev.data2);
            else if (ev.type === 'noteOff') synth.noteOff(ev.channel, ev.data1);
            else if (ev.type === 'programChange') synth.programChange(ev.channel, mapMidiProgramToAura25(ev.data1, ev.channel));
            else if (ev.type === 'cc') {
                if (ev.data1 === CC_DELAY_SEND) return;
                // controllerChange API exists on BasicSynthesizer
                (synth as any).controllerChange?.(ev.channel, ev.data1, ev.data2);
            } else if (ev.type === 'pitchBend') {
                (synth as any).pitchWheel?.(ev.channel, ev.data1);
            }
        } catch { /* ignore — 静默单事件错误，保播放不中断 */ }
    }

    // -----------------------------------------------------------
    // Channel mute / event injection
    // -----------------------------------------------------------

    public muteChannel(channel: number, mute: boolean): void {
        if (mute) this.mutedChannels.add(channel);
        else this.mutedChannels.delete(channel);
    }

    public isChannelMuted(channel: number): boolean {
        return this.mutedChannels.has(channel);
    }

    public injectEvent(ev: MidiEvent): void {
        ev = normalizeMidiEvent(ev);
        let lo = 0;
        let hi = this.events.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (compareMidiEvents(this.events[mid], ev) <= 0) lo = mid + 1;
            else hi = mid;
        }
        this.events.splice(lo, 0, ev);
        if (lo < this.nextEventIdx) this.nextEventIdx++;
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
        this.events.sort(compareMidiEvents);
    }

    // -----------------------------------------------------------
    // Listeners
    // -----------------------------------------------------------

    public addVisualListener(listener: (data: any) => void): void {
        this.visualListeners.push(listener);
    }

    public removeVisualListener(listener: (data: any) => void): void {
        this.visualListeners = this.visualListeners.filter(l => l !== listener);
    }

    public onTrackEnd(listener: () => void): void {
        this.endListeners.push(listener);
    }

    // -----------------------------------------------------------
    // Getters / Setters
    // -----------------------------------------------------------

    public setBpm(bpm: number): void { this.currentBpm = bpm; }
    public getBpm(): number { return this.currentBpm; }

    public setPosition(ticks: number): void {
        this.currentTick = ticks;
        this.startTickAtResume = ticks;
        this.startWallTimeMs = performance.now();
        // 重新定位 nextEventIdx
        this.nextEventIdx = 0;
        while (
            this.nextEventIdx < this.events.length &&
            this.events[this.nextEventIdx].ticks < ticks
        ) {
            this.nextEventIdx++;
        }
    }

    public getCurrentTick(): number { return this.currentTick; }

    public beatsToTicks(beats: number): number {
        return Math.round(beats * this.ppq);
    }
}

export const globalMidiScheduler = new MidiScheduler();
