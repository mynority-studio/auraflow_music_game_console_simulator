/**
 * MidiScheduler — PPQ=480 tick 调度器（Phase 2.D 实装版）
 *
 * 工作模型：
 *   - 20ms setInterval 维护短窗口，MIDI 事件提前交给 Web MIDI 时间戳队列
 *   - 用 performance.now() 计算自 start 起的 elapsed → 推算 currentTick
 *   - MIDI 提前 100ms 排队，visual 仍在 currentTick 到点时派发
 *   - MIDI/visual 各自使用单调游标（events 已按 ticks 排序）
 *
 * 派发：
 *   - noteOn / noteOff / programChange / cc / pitchBend → MIDI listeners
 *   - visual → visualListeners
 *
 * 曲终：last event 之后等 200ms（让 noteOff 发音完整）→ fire onTrackEnd listeners → 自动停止。
 */

import type { TempoCurve } from '../generation/types';

export interface MidiEvent {
    ticks: number;
    type: 'noteOn' | 'noteOff' | 'cc' | 'programChange' | 'pitchBend' | 'visual';
    channel: number;
    data1: number;
    data2: number;
    /**
     * Explicit 1..16 hardware-channel claim. Generated events derive this
     * from their role; uploaded SMF events set it from raw channel + 1.
     */
    outputChannel?: number;
    /** Explicit capability carried to the final hardware sink. */
    outputPolicy?: 'lofi-channel-mix';
    visualData?: any;
}

export interface MidiNoteRange {
    minMidi: number;
    maxMidi: number;
}

export interface MidiNoteTarget {
    channel: number;
    midi: number;
    startTick: number;
    endTick: number;
}

export interface MidiChannelPlaybackState {
    channel: number;
    atTick: number;
    outputChannel?: number;
    bankMsb?: number;
    bankLsb?: number;
    program?: number;
    expression: number;
    sustain: number;
}

export interface MidiChannelStateRestoreOptions {
    atTick?: number;
    /** Use a newly rendered channel score while replacing a live voice. */
    sourceEvents?: readonly MidiEvent[];
    bankMsb?: number;
    bankLsb?: number;
    program?: number;
    /** Flush the outgoing voice before installing the restored state. */
    releaseCurrentSound?: boolean;
    /** Re-establish Firm5504 controller defaults before authored state. */
    resetControllers?: boolean;
}

type MidiEventListener = (event: MidiEvent, timestampMs?: number) => void;
type MidiQueueClearListener = () => void;

const TICK_LOOP_MS = 20;
const MIDI_SCHEDULE_LOOKAHEAD_MS = 100;
const MUTE_RELEASE_RECHECK_MS = MIDI_SCHEDULE_LOOKAHEAD_MS + TICK_LOOP_MS;
const TRAILING_SILENCE_MS = 200;

function midiEventOrder(ev: MidiEvent): number {
    if (ev.type === 'noteOff') return 0;
    // State changes at one tick have an audible order on the Dream board.
    // Release a damper, restore controller defaults, then select bank/program,
    // apply piano expression, re-engage a planned pedal, and finally strike.
    if (ev.type === 'cc' && ev.data1 === 64 && ev.data2 <= 63) return 1;
    if (ev.type === 'cc' && ev.data1 === 121) return 2;
    if (ev.type === 'cc' && ev.data1 === 0) return 3;
    if (ev.type === 'programChange') return 4;
    if (ev.type === 'cc' && ev.data1 === 64 && ev.data2 >= 64) return 6;
    if (ev.type === 'cc' && ev.data1 === 11) return 5;
    if (ev.type === 'cc' || ev.type === 'pitchBend') return 5;
    if (ev.type === 'noteOn') return 7;
    return 7;
}

function compareMidiEvents(a: MidiEvent, b: MidiEvent): number {
    if (a.ticks !== b.ticks) return a.ticks - b.ticks;
    return midiEventOrder(a) - midiEventOrder(b);
}

function normalizeMidiEvent(ev: MidiEvent): MidiEvent {
    return ev;
}

function normalizeAndSortEvents(events: MidiEvent[]): MidiEvent[] {
    return events.map(normalizeMidiEvent).sort(compareMidiEvents);
}

export class MidiScheduler {
    public readonly ppq: number = 480;
    public isPlaying = false;
    public loop = false;
    public loopStartTicks = 0;
    public loopEndTicks = 0;

    private events: MidiEvent[] = [];
    private nextEventIdx = 0;
    private nextMidiEventIdx = 0;
    private midiScheduledThroughTick = 0;
    private currentTick = 0;
    private currentBpm = 120;

    private startWallTimeMs = 0;
    private startTickAtResume = 0;
    private tickHandle: ReturnType<typeof setInterval> | null = null;
    private endFireScheduled = false;
    /** Explicit score/form end. May be later than the last note-off because a written tail is still musical time. */
    private trackEndTick = 0;

    private mutedChannels: Set<number> = new Set();
    private suppressedChannelEvents: Map<number, MidiEvent[]> = new Map();
    private mutedNoteRanges: Map<number, MidiNoteRange> = new Map();
    private mutedNoteTargetKeys: Set<string> = new Set();
    private channelVelocityScales: Map<number, number> = new Map();
    private channelMuteReleaseTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
    private channelGracefulMuteTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
    private noteRangeReleaseTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
    private noteTargetReleaseTimer: ReturnType<typeof setTimeout> | null = null;
    private visualListeners: ((data: any) => void)[] = [];
    private midiEventListeners: MidiEventListener[] = [];
    private midiQueueClearListeners: MidiQueueClearListener[] = [];
    private endListeners: (() => void)[] = [];

    public init(_synth: unknown): void { /* MIDI-only:保留 init 签名兼容,事件由监听器消费。 */ }

    // -----------------------------------------------------------
    // 事件流装载
    // -----------------------------------------------------------

    public loadTrack(events: MidiEvent[], bpm: number, _tempoCurves?: TempoCurve[], durationTicks?: number): void {
        this.cancelPendingMuteReleases();
        // A mute or uploaded-MIDI gain belongs to the score that created it.
        // Never let takeover filters leak into a newly loaded generated song.
        this.mutedChannels.clear();
        this.suppressedChannelEvents.clear();
        this.mutedNoteRanges.clear();
        this.mutedNoteTargetKeys.clear();
        this.channelVelocityScales.clear();
        // 已按 ticks 升序排好（musicalIRToMidiEvents 输出时排序）— 这里再保险一次。
        // MIDI-only：CC95 作为硬件 delay send 直通，不再生成浏览器 echo 代偿音符。
        this.events = normalizeAndSortEvents(events);
        this.currentBpm = bpm;
        this.currentTick = 0;
        this.nextEventIdx = 0;
        this.nextMidiEventIdx = 0;
        this.midiScheduledThroughTick = 0;
        this.endFireScheduled = false;
        const lastEventTick = this.events[this.events.length - 1]?.ticks ?? 0;
        this.trackEndTick = Math.max(lastEventTick, Math.max(0, Math.round(durationTicks ?? lastEventTick)));
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
        this.tickLoop();
        this.tickHandle = setInterval(() => this.tickLoop(), TICK_LOOP_MS);
    }

    public stop(): void {
        this.cancelPendingMuteReleases();
        this.isPlaying = false;
        if (this.tickHandle) {
            clearInterval(this.tickHandle);
            this.tickHandle = null;
        }
        this.currentTick = 0;
        this.nextEventIdx = 0;
        this.nextMidiEventIdx = 0;
        this.midiScheduledThroughTick = 0;
        this.suppressedChannelEvents.clear();
        this.endFireScheduled = false;
        this.trackEndTick = 0;
        this.panic();
    }

    public pause(): void {
        this.updateCurrentTick();
        this.isPlaying = false;
        if (this.tickHandle) {
            clearInterval(this.tickHandle);
            this.tickHandle = null;
        }
        this.notifyMidiQueueClearListeners();
        this.nextMidiEventIdx = this.firstEventIndexAfter(this.currentTick);
    }

    public panic(): void {
        this.notifyMidiQueueClearListeners();
        if (this.isPlaying) this.nextMidiEventIdx = this.firstEventIndexAfter(this.currentTick);
        // Release a damper before All Notes Off, then restore documented board
        // controller defaults. The score never owns a persistent Pad CC1 lane.
        for (let ch = 0; ch < 16; ch++) {
            this.notifyMidiEventListeners({ ticks: this.currentTick, type: 'cc', channel: ch, data1: 64, data2: 0 });
            this.notifyMidiEventListeners({ ticks: this.currentTick, type: 'cc', channel: ch, data1: 123, data2: 0 });
            this.notifyMidiEventListeners({ ticks: this.currentTick, type: 'cc', channel: ch, data1: 121, data2: 0 });
        }
    }

    public clear(): void {
        this.stop();
        this.events = [];
        this.visualListeners = [];
        this.midiEventListeners = [];
        this.midiQueueClearListeners = [];
        this.endListeners = [];
        this.mutedChannels.clear();
        this.suppressedChannelEvents.clear();
        this.mutedNoteRanges.clear();
        this.mutedNoteTargetKeys.clear();
        this.channelVelocityScales.clear();
    }

    // -----------------------------------------------------------
    // 核心 tick 循环
    // -----------------------------------------------------------

    private tickLoop(): void {
        if (!this.isPlaying) return;

        const nowMs = performance.now();
        this.updateCurrentTick(nowMs);
        const ticksPerSec = (this.currentBpm / 60) * this.ppq;
        const midiScheduleThroughTick = this.currentTick + (MIDI_SCHEDULE_LOOKAHEAD_MS / 1000) * ticksPerSec;

        while (
            this.nextMidiEventIdx < this.events.length &&
            this.events[this.nextMidiEventIdx].ticks <= midiScheduleThroughTick
        ) {
            const event = this.events[this.nextMidiEventIdx];
            if (event.type !== 'visual') this.dispatchEvent(event, this.eventTimestampMs(event.ticks));
            this.nextMidiEventIdx++;
        }
        this.midiScheduledThroughTick = midiScheduleThroughTick;

        // Visuals stay on the audible playhead; MIDI was already timestamped above.
        while (
            this.nextEventIdx < this.events.length &&
            this.events[this.nextEventIdx].ticks <= this.currentTick
        ) {
            const event = this.events[this.nextEventIdx];
            if (event.type === 'visual') this.dispatchEvent(event);
            this.nextEventIdx++;
        }

        // 曲终检测
        if (this.nextEventIdx >= this.events.length && this.currentTick >= this.trackEndTick && !this.endFireScheduled) {
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

    private updateCurrentTick(nowMs = performance.now()): number {
        if (!this.isPlaying) return this.currentTick;
        const elapsedMs = nowMs - this.startWallTimeMs;
        const ticksPerSec = (this.currentBpm / 60) * this.ppq;
        this.currentTick = this.startTickAtResume + (elapsedMs / 1000) * ticksPerSec;
        return this.currentTick;
    }

    private eventTimestampMs(ticks: number): number {
        const ticksPerMs = ((this.currentBpm / 60) * this.ppq) / 1000;
        if (!Number.isFinite(ticksPerMs) || ticksPerMs <= 0) return performance.now();
        return this.startWallTimeMs + (ticks - this.startTickAtResume) / ticksPerMs;
    }

    private firstEventIndexAfter(ticks: number): number {
        let lo = 0;
        let hi = this.events.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.events[mid].ticks <= ticks) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    private firstEventIndexAtOrAfter(ticks: number): number {
        let lo = 0;
        let hi = this.events.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.events[mid].ticks < ticks) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    private dispatchEvent(ev: MidiEvent, timestampMs?: number): void {
        if (ev.type === 'visual') {
            this.visualListeners.forEach(l => {
                try { l(ev.visualData); } catch { /* ignore */ }
            });
            return;
        }
        // A graceful takeover blocks new native attacks immediately while
        // still allowing the already sounding note and sustain tail to end.
        const releasesCurrentSound = ev.type === 'noteOff'
            || (ev.type === 'cc' && ev.data1 === 64 && ev.data2 <= 63);
        if (this.mutedChannels.has(ev.channel) && !releasesCurrentSound) {
            const suppressed = this.suppressedChannelEvents.get(ev.channel) ?? [];
            suppressed.push(ev);
            this.suppressedChannelEvents.set(ev.channel, suppressed);
            return;
        }
        const mutedRange = this.mutedNoteRanges.get(ev.channel);
        if (ev.type === 'noteOn'
            && mutedRange
            && ev.data1 >= mutedRange.minMidi
            && ev.data1 <= mutedRange.maxMidi) {
            return;
        }
        if (ev.type === 'noteOn'
            && this.mutedNoteTargetKeys.has(this.noteTargetKey({
                channel: ev.channel,
                midi: ev.data1,
                startTick: ev.ticks,
                endTick: ev.ticks,
            }))) {
            return;
        }
        const velocityScale = this.channelVelocityScales.get(ev.channel) ?? 1;
        const outputEvent = ev.type === 'noteOn' && ev.data2 > 0 && velocityScale !== 1
            ? {
                ...ev,
                data2: Math.max(1, Math.min(127, Math.round(ev.data2 * velocityScale))),
            }
            : ev;
        this.notifyMidiEventListeners(outputEvent, timestampMs);
    }

    private notifyMidiEventListeners(ev: MidiEvent, timestampMs?: number): void {
        this.midiEventListeners.forEach(l => {
            try { l(ev, timestampMs); } catch { /* ignore */ }
        });
    }

    private notifyMidiQueueClearListeners(): void {
        this.midiQueueClearListeners.forEach(l => {
            try { l(); } catch { /* ignore */ }
        });
    }

    // -----------------------------------------------------------
    // Channel mute / event injection
    // -----------------------------------------------------------

    public muteChannel(channel: number, mute: boolean): void {
        const wasMuted = this.mutedChannels.has(channel);
        if (wasMuted === mute) return;
        this.cancelChannelMuteRelease(channel);
        if (!mute) {
            this.mutedChannels.delete(channel);
            if (this.isPlaying) {
                const currentTick = this.updateCurrentTick();
                this.restoreChannelState(channel, { atTick: currentTick });
                this.replaySuppressedChannelEvents(channel, currentTick);
            } else {
                this.suppressedChannelEvents.delete(channel);
            }
            return;
        }

        this.mutedChannels.add(channel);
        this.suppressedChannelEvents.set(channel, []);
        if (this.isPlaying) {
            this.releaseChannelNow(channel);
            const handle = setTimeout(() => {
                this.channelMuteReleaseTimers.delete(channel);
                if (this.mutedChannels.has(channel) && this.isPlaying) {
                    this.releaseChannelNow(channel);
                }
            }, MUTE_RELEASE_RECHECK_MS);
            this.channelMuteReleaseTimers.set(channel, handle);
        }
    }

    public isChannelMuted(channel: number): boolean {
        return this.mutedChannels.has(channel);
    }

    public muteChannelGracefully(channel: number, mute: boolean): void {
        if (!mute) {
            this.muteChannel(channel, false);
            return;
        }
        if (this.mutedChannels.has(channel)) return;
        this.mutedChannels.add(channel);
        this.suppressedChannelEvents.set(channel, []);
        this.cancelChannelMuteRelease(channel);
        if (!this.isPlaying) return;

        const currentTick = this.updateCurrentTick();
        const activeEndTick = this.activeChannelEndTick(channel, currentTick);
        this.neutralizePrequeuedChannelAttacks(channel, currentTick);
        if (activeEndTick === null) {
            this.releaseChannelNow(channel);
            const handle = setTimeout(() => {
                this.channelGracefulMuteTimers.delete(channel);
                if (this.mutedChannels.has(channel) && this.isPlaying) {
                    this.releaseChannelNow(channel);
                }
            }, MUTE_RELEASE_RECHECK_MS);
            this.channelGracefulMuteTimers.set(channel, handle);
            return;
        }
        const ticksPerMs = ((this.currentBpm / 60) * this.ppq) / 1000;
        const delayMs = ticksPerMs > 0
            ? Math.max(0, (activeEndTick - currentTick) / ticksPerMs)
            : 0;
        const handle = setTimeout(() => {
            this.channelGracefulMuteTimers.delete(channel);
            if (this.mutedChannels.has(channel) && this.isPlaying) {
                this.releaseChannelNow(channel);
            }
        }, delayMs);
        this.channelGracefulMuteTimers.set(channel, handle);
    }

    public muteNoteRange(channel: number, range: MidiNoteRange, mute: boolean): void {
        const normalized = {
            minMidi: Math.max(0, Math.min(127, Math.round(Math.min(range.minMidi, range.maxMidi)))),
            maxMidi: Math.max(0, Math.min(127, Math.round(Math.max(range.minMidi, range.maxMidi)))),
        };
        const existing = this.mutedNoteRanges.get(channel);
        const unchanged = mute
            ? existing?.minMidi === normalized.minMidi && existing.maxMidi === normalized.maxMidi
            : !existing;
        if (unchanged) return;
        if (mute) this.mutedNoteRanges.set(channel, normalized);
        else this.mutedNoteRanges.delete(channel);
        this.cancelNoteRangeRelease(channel);
        if (mute && this.isPlaying) {
            this.releaseNoteRangeNow(channel, normalized);
            const handle = setTimeout(() => {
                this.noteRangeReleaseTimers.delete(channel);
                if (this.isNoteRangeMuted(channel, normalized) && this.isPlaying) {
                    this.releaseNoteRangeNow(channel, normalized);
                }
            }, MUTE_RELEASE_RECHECK_MS);
            this.noteRangeReleaseTimers.set(channel, handle);
        }
    }

    public isNoteRangeMuted(channel: number, range: MidiNoteRange): boolean {
        const existing = this.mutedNoteRanges.get(channel);
        return !!existing
            && existing.minMidi === Math.round(Math.min(range.minMidi, range.maxMidi))
            && existing.maxMidi === Math.round(Math.max(range.minMidi, range.maxMidi));
    }

    public muteNoteTargets(targets: ReadonlyArray<MidiNoteTarget>, mute: boolean): void {
        const normalized = targets.map((target) => this.normalizeNoteTarget(target));
        const changed = normalized.some((target) =>
            this.mutedNoteTargetKeys.has(this.noteTargetKey(target)) !== mute);
        if (!changed) return;
        for (const target of normalized) {
            const key = this.noteTargetKey(target);
            if (mute) {
                this.mutedNoteTargetKeys.add(key);
            } else {
                this.mutedNoteTargetKeys.delete(key);
            }
        }
        this.cancelNoteTargetRelease();
        if (mute && this.isPlaying) {
            this.releaseActiveNoteTargetsNow(normalized);
            this.noteTargetReleaseTimer = setTimeout(() => {
                this.noteTargetReleaseTimer = null;
                if (this.isPlaying) {
                    this.releaseActiveNoteTargetsNow(
                        normalized.filter((target) =>
                            this.mutedNoteTargetKeys.has(this.noteTargetKey(target))),
                    );
                }
            }, MUTE_RELEASE_RECHECK_MS);
        }
    }

    public areNoteTargetsMuted(targets: ReadonlyArray<MidiNoteTarget>): boolean {
        return targets.length > 0 && targets.every((target) =>
            this.mutedNoteTargetKeys.has(this.noteTargetKey(this.normalizeNoteTarget(target))));
    }

    public muteNoteTargetsGracefully(
        targets: ReadonlyArray<MidiNoteTarget>,
        mute: boolean,
    ): void {
        const normalized = targets.map((target) => this.normalizeNoteTarget(target));
        this.cancelNoteTargetRelease();
        for (const target of normalized) {
            const key = this.noteTargetKey(target);
            if (mute) this.mutedNoteTargetKeys.add(key);
            else this.mutedNoteTargetKeys.delete(key);
        }
        // Exact-note muting already lets Note Off events through. Unlike the
        // hard path, do not release a target that was sounding at handoff.
        if (mute && this.isPlaying) {
            const currentTick = this.updateCurrentTick();
            const prequeuedAfterHandoff = normalized.filter((target) =>
                target.startTick > currentTick
                && target.startTick <= this.midiScheduledThroughTick);
            this.neutralizePrequeuedNoteTargets(prequeuedAfterHandoff);
        }
    }

    public setChannelVelocityScale(channel: number, scale: number): void {
        const normalized = Math.max(0, Math.min(1, Number.isFinite(scale) ? scale : 1));
        if (Math.abs(normalized - 1) < 1e-6) {
            this.channelVelocityScales.delete(channel);
        } else {
            this.channelVelocityScales.set(channel, normalized);
        }
    }

    public getChannelVelocityScale(channel: number): number {
        return this.channelVelocityScales.get(channel) ?? 1;
    }

    /**
     * Reduce the authored event stream to the controller/voice state that is
     * in force at one musical position. CC121 is stateful: it restores CC11
     * and CC64 defaults but does not change the selected bank/program.
     */
    public getChannelStateAt(
        channel: number,
        atTick: number,
        sourceEvents: readonly MidiEvent[] = this.events,
    ): MidiChannelPlaybackState {
        const clampedTick = Math.max(0, Number.isFinite(atTick) ? atTick : 0);
        const state: MidiChannelPlaybackState = {
            channel,
            atTick: clampedTick,
            expression: 127,
            sustain: 0,
        };
        const ordered = sourceEvents === this.events
            ? this.events
            : [...sourceEvents].sort(compareMidiEvents);
        for (const event of ordered) {
            if (event.ticks > clampedTick) break;
            if (event.channel !== channel || event.type === 'visual') continue;
            if (event.outputChannel !== undefined) state.outputChannel = event.outputChannel;
            if (event.type === 'programChange') {
                state.program = event.data1;
                continue;
            }
            if (event.type !== 'cc') continue;
            if (event.data1 === 121) {
                state.expression = 127;
                state.sustain = 0;
            } else if (event.data1 === 0) {
                state.bankMsb = event.data2;
            } else if (event.data1 === 32) {
                state.bankLsb = event.data2;
            } else if (event.data1 === 11) {
                state.expression = event.data2;
            } else if (event.data1 === 64) {
                state.sustain = event.data2;
            }
        }
        if (state.outputChannel === undefined) {
            state.outputChannel = sourceEvents.find((event) =>
                event.channel === channel && event.outputChannel !== undefined)?.outputChannel;
        }
        return state;
    }

    /**
     * Immediately reinstall a channel's latched voice/expression/damper state.
     * This is transport recovery, not a new performance decision: every value
     * comes from the score at `atTick`, except an explicit live voice override.
     */
    public restoreChannelState(
        channel: number,
        options: MidiChannelStateRestoreOptions = {},
    ): MidiChannelPlaybackState {
        const atTick = options.atTick ?? this.updateCurrentTick();
        const state = this.getChannelStateAt(channel, atTick, options.sourceEvents ?? this.events);
        const outputChannel = state.outputChannel;
        const eventBase = {
            ticks: state.atTick,
            channel,
            ...(outputChannel === undefined ? {} : { outputChannel }),
        };
        const sendCc = (controller: number, value: number): void => {
            this.notifyMidiEventListeners({
                ...eventBase,
                type: 'cc',
                data1: controller,
                data2: Math.max(0, Math.min(127, Math.round(value))),
            });
        };

        if (options.releaseCurrentSound) {
            sendCc(64, 0);
            sendCc(123, 0);
        }
        if (options.resetControllers) sendCc(121, 0);

        const bankMsb = options.bankMsb ?? state.bankMsb;
        const bankLsb = options.bankLsb ?? state.bankLsb;
        const program = options.program ?? state.program;
        if (bankMsb !== undefined) sendCc(0, bankMsb);
        if (bankLsb !== undefined) sendCc(32, bankLsb);
        if (program !== undefined) {
            this.notifyMidiEventListeners({
                ...eventBase,
                type: 'programChange',
                data1: Math.max(0, Math.min(127, Math.round(program))),
                data2: 0,
            });
        }
        sendCc(11, state.expression);
        sendCc(64, state.sustain);
        return {
            ...state,
            ...(bankMsb === undefined ? {} : { bankMsb }),
            ...(bankLsb === undefined ? {} : { bankLsb }),
            ...(program === undefined ? {} : { program }),
        };
    }

    private replaySuppressedChannelEvents(channel: number, afterTick: number): void {
        const suppressed = this.suppressedChannelEvents.get(channel) ?? [];
        this.suppressedChannelEvents.delete(channel);
        for (const event of suppressed) {
            if (event.ticks <= afterTick) continue;
            this.dispatchEvent(event, this.eventTimestampMs(event.ticks));
        }
    }

    private cancelChannelMuteRelease(channel: number): void {
        const handle = this.channelMuteReleaseTimers.get(channel);
        if (handle) clearTimeout(handle);
        this.channelMuteReleaseTimers.delete(channel);
        const gracefulHandle = this.channelGracefulMuteTimers.get(channel);
        if (gracefulHandle) clearTimeout(gracefulHandle);
        this.channelGracefulMuteTimers.delete(channel);
    }

    private cancelNoteRangeRelease(channel: number): void {
        const handle = this.noteRangeReleaseTimers.get(channel);
        if (handle) clearTimeout(handle);
        this.noteRangeReleaseTimers.delete(channel);
    }

    private cancelPendingMuteReleases(): void {
        for (const handle of this.channelMuteReleaseTimers.values()) clearTimeout(handle);
        for (const handle of this.channelGracefulMuteTimers.values()) clearTimeout(handle);
        for (const handle of this.noteRangeReleaseTimers.values()) clearTimeout(handle);
        this.channelMuteReleaseTimers.clear();
        this.channelGracefulMuteTimers.clear();
        this.noteRangeReleaseTimers.clear();
        this.cancelNoteTargetRelease();
    }

    private cancelNoteTargetRelease(): void {
        if (this.noteTargetReleaseTimer) clearTimeout(this.noteTargetReleaseTimer);
        this.noteTargetReleaseTimer = null;
    }

    private normalizeNoteTarget(target: MidiNoteTarget): MidiNoteTarget {
        const startTick = Math.max(0, Math.round(target.startTick));
        return {
            channel: Math.max(0, Math.min(15, Math.round(target.channel))),
            midi: Math.max(0, Math.min(127, Math.round(target.midi))),
            startTick,
            endTick: Math.max(startTick + 1, Math.round(target.endTick)),
        };
    }

    private noteTargetKey(target: MidiNoteTarget): string {
        return `${target.channel}:${target.startTick}:${target.midi}`;
    }

    private activeChannelEndTick(channel: number, atTick: number): number | null {
        const pressedCounts = new Map<number, number>();
        const sustainedCounts = new Map<number, number>();
        let sustainDown = false;
        const releasePressedNote = (midi: number): void => {
            const count = pressedCounts.get(midi) ?? 0;
            if (count <= 0) return;
            if (count === 1) pressedCounts.delete(midi);
            else pressedCounts.set(midi, count - 1);
            if (sustainDown) {
                sustainedCounts.set(midi, (sustainedCounts.get(midi) ?? 0) + 1);
            }
        };
        const applyReleasePedal = (value: number): void => {
            const nextSustainDown = value >= 64;
            if (sustainDown && !nextSustainDown) sustainedCounts.clear();
            sustainDown = nextSustainDown;
        };

        for (const event of this.events) {
            if (event.ticks > atTick) break;
            if (event.channel !== channel) continue;
            if (event.type === 'noteOn' && event.data2 > 0) {
                pressedCounts.set(event.data1, (pressedCounts.get(event.data1) ?? 0) + 1);
            } else if (event.type === 'noteOff'
                || (event.type === 'noteOn' && event.data2 <= 0)) {
                releasePressedNote(event.data1);
            } else if (event.type === 'cc' && event.data1 === 64) {
                applyReleasePedal(event.data2);
            }
        }
        if (pressedCounts.size === 0 && sustainedCounts.size === 0) return null;

        let latestEndTick = atTick;
        for (const event of this.events) {
            if (event.ticks <= atTick || event.channel !== channel) continue;
            if (event.type === 'noteOff'
                || (event.type === 'noteOn' && event.data2 <= 0)) {
                if (!pressedCounts.has(event.data1)) continue;
                releasePressedNote(event.data1);
                latestEndTick = Math.max(latestEndTick, event.ticks);
            } else if (event.type === 'cc' && event.data1 === 64) {
                applyReleasePedal(event.data2);
                latestEndTick = Math.max(latestEndTick, event.ticks);
            } else {
                // Future Note Ons belong to the native melody we just blocked.
                continue;
            }
            if (pressedCounts.size === 0 && sustainedCounts.size === 0) {
                return latestEndTick;
            }
        }
        return Math.max(latestEndTick, this.trackEndTick);
    }

    private neutralizePrequeuedChannelAttacks(channel: number, afterTick: number): void {
        const released = new Set<string>();
        for (const attack of this.events) {
            if (attack.ticks > this.midiScheduledThroughTick) break;
            if (attack.channel !== channel
                || attack.type !== 'noteOn'
                || attack.data2 <= 0
                || attack.ticks <= afterTick) {
                continue;
            }
            const key = `${attack.ticks}:${attack.data1}`;
            if (released.has(key)) continue;
            released.add(key);
            this.notifyMidiEventListeners({
                ticks: attack.ticks,
                type: 'noteOff',
                channel,
                data1: attack.data1,
                data2: 0,
                ...(attack.outputChannel === undefined
                    ? {}
                    : { outputChannel: attack.outputChannel }),
            }, this.eventTimestampMs(attack.ticks));
        }
    }

    private neutralizePrequeuedNoteTargets(targets: ReadonlyArray<MidiNoteTarget>): void {
        const released = new Set<string>();
        for (const target of targets) {
            const key = `${target.channel}:${target.startTick}:${target.midi}`;
            if (released.has(key)) continue;
            released.add(key);
            const outputChannel = this.events.find((event) =>
                event.channel === target.channel
                && event.ticks === target.startTick
                && event.type === 'noteOn'
                && event.data1 === target.midi)?.outputChannel;
            this.notifyMidiEventListeners({
                ticks: target.startTick,
                type: 'noteOff',
                channel: target.channel,
                data1: target.midi,
                data2: 0,
                ...(outputChannel === undefined ? {} : { outputChannel }),
            }, this.eventTimestampMs(target.startTick));
        }
    }

    private outputChannelFor(channel: number): number | undefined {
        return this.events.find((event) =>
            event.channel === channel && event.outputChannel !== undefined)?.outputChannel;
    }

    private releaseChannelNow(channel: number): void {
        const outputChannel = this.outputChannelFor(channel);
        const eventBase = {
            ticks: this.currentTick,
            type: 'cc' as const,
            channel,
            data2: 0,
            ...(outputChannel === undefined ? {} : { outputChannel }),
        };
        this.notifyMidiEventListeners({ ...eventBase, data1: 64 });
        this.notifyMidiEventListeners({ ...eventBase, data1: 123 });
    }

    private releaseNoteRangeNow(channel: number, range: MidiNoteRange): void {
        const outputChannel = this.outputChannelFor(channel);
        for (let midi = range.minMidi; midi <= range.maxMidi; midi++) {
            this.notifyMidiEventListeners({
                ticks: this.currentTick,
                type: 'noteOff',
                channel,
                data1: midi,
                data2: 0,
                ...(outputChannel === undefined ? {} : { outputChannel }),
            });
        }
    }

    private releaseActiveNoteTargetsNow(targets: ReadonlyArray<MidiNoteTarget>): void {
        this.releaseNoteTargetsNow(targets.filter((target) =>
            target.startTick <= this.currentTick && target.endTick > this.currentTick));
    }

    private releaseNoteTargetsNow(targets: ReadonlyArray<MidiNoteTarget>): void {
        const released = new Set<string>();
        for (const target of targets) {
            const noteKey = `${target.channel}:${target.midi}`;
            if (released.has(noteKey)) continue;
            released.add(noteKey);
            const outputChannel = this.outputChannelFor(target.channel);
            this.notifyMidiEventListeners({
                ticks: this.currentTick,
                type: 'noteOff',
                channel: target.channel,
                data1: target.midi,
                data2: 0,
                ...(outputChannel === undefined ? {} : { outputChannel }),
            });
        }
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
        this.trackEndTick = Math.max(this.trackEndTick, ev.ticks);
        if (lo < this.nextEventIdx) this.nextEventIdx++;
        if (lo < this.nextMidiEventIdx) {
            this.nextMidiEventIdx++;
            if (this.isPlaying && ev.type !== 'visual' && ev.ticks > this.currentTick) {
                this.dispatchEvent(ev, this.eventTimestampMs(ev.ticks));
            }
        }
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
        this.suppressedChannelEvents.delete(channel);
        this.events = this.events.filter(e => {
            if (e.channel !== channel) return true;
            if (e.ticks < startTick) return true;
            if (endTick !== undefined && e.ticks >= endTick) return true;
            return false;
        });
        this.events.push(...newEvents);
        this.events.sort(compareMidiEvents);
        this.nextEventIdx = this.firstEventIndexAfter(this.currentTick);
        this.nextMidiEventIdx = this.firstEventIndexAfter(this.midiScheduledThroughTick);
        this.trackEndTick = Math.max(this.trackEndTick, this.events[this.events.length - 1]?.ticks ?? 0);
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

    public addMidiEventListener(listener: MidiEventListener): () => void {
        this.midiEventListeners.push(listener);
        return () => this.removeMidiEventListener(listener);
    }

    public removeMidiEventListener(listener: MidiEventListener): void {
        this.midiEventListeners = this.midiEventListeners.filter(l => l !== listener);
    }

    public addMidiQueueClearListener(listener: MidiQueueClearListener): () => void {
        this.midiQueueClearListeners.push(listener);
        return () => {
            this.midiQueueClearListeners = this.midiQueueClearListeners.filter(l => l !== listener);
        };
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
        this.notifyMidiQueueClearListeners();
        this.currentTick = ticks;
        this.startTickAtResume = ticks;
        this.startWallTimeMs = performance.now();
        this.nextEventIdx = this.firstEventIndexAtOrAfter(ticks);
        this.nextMidiEventIdx = this.nextEventIdx;
        this.midiScheduledThroughTick = ticks;
    }

    public getCurrentTick(): number { return this.updateCurrentTick(); }

    public beatsToTicks(beats: number): number {
        return Math.round(beats * this.ppq);
    }
}

export const globalMidiScheduler = new MidiScheduler();
