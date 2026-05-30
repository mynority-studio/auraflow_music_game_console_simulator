// ============================================================
// ImproCore sandbox — 发声出口
// ============================================================
//
// 沙盒唯一与"你们系统"接触的点:把一串 slot-based 音符转成
// MidiEvent[],经 globalMidiScheduler → spessasynth 发声。
// 不走任何生成 pipeline / 游戏逻辑,纯音频原语复用。
// ============================================================

import { globalMidiScheduler, type MidiEvent } from '../../../audio/MidiScheduler';
import { startAudioContext } from '../../../audio/SynthManager';
import { slotsToTicks } from '../engine/constants';

/** 一个 slot 基准的音符(Phase 0 占位用,后续会被 MelodyPart 取代) */
export interface SlotNote {
    /** MIDI pitch;< 0 表示休止(不发声) */
    pitch: number;
    /** 起始 slot(从 0 起) */
    startSlot: number;
    /** 时长(slot) */
    durationSlots: number;
    /** 力度 0-127,默认 100 */
    velocity?: number;
}

export interface PlayOptions {
    /** MIDI 通道,默认 0 */
    channel?: number;
    /** GM program(乐器),默认 0 = Acoustic Grand Piano */
    program?: number;
}

/**
 * 播放一串 slot 音符。会先确保 AudioContext / spessasynth 已启动。
 * @returns 这条 track 的总时长(slot)
 */
export async function playSlotNotes(
    notes: SlotNote[],
    bpm: number,
    opts: PlayOptions = {},
): Promise<number> {
    await startAudioContext();

    const channel = opts.channel ?? 0;
    const events: MidiEvent[] = [];

    if (opts.program !== undefined) {
        events.push({ ticks: 0, type: 'programChange', channel, data1: opts.program, data2: 0 });
    }

    let endSlot = 0;
    for (const n of notes) {
        if (n.pitch < 0) {
            endSlot = Math.max(endSlot, n.startSlot + n.durationSlots);
            continue; // 休止:占时长但不发声
        }
        const onTick = slotsToTicks(n.startSlot);
        const offTick = slotsToTicks(n.startSlot + n.durationSlots);
        events.push({ ticks: onTick, type: 'noteOn', channel, data1: n.pitch, data2: n.velocity ?? 100 });
        events.push({ ticks: offTick, type: 'noteOff', channel, data1: n.pitch, data2: 0 });
        endSlot = Math.max(endSlot, n.startSlot + n.durationSlots);
    }

    globalMidiScheduler.stop();
    globalMidiScheduler.loadTrack(events, bpm);
    globalMidiScheduler.start();

    return endSlot;
}

export interface Track {
    notes: SlotNote[];
    channel: number;
    /** GM program;drum 通道(9)可省 */
    program?: number;
}

/**
 * 多轨同步播放(solo + bass + chords + drums 一次性装载,保证对齐)。
 * @returns 总时长(slot)
 */
export async function playTracks(tracks: Track[], bpm: number): Promise<number> {
    await startAudioContext();
    const events: MidiEvent[] = [];
    let endSlot = 0;

    for (const tr of tracks) {
        if (tr.program !== undefined) {
            events.push({ ticks: 0, type: 'programChange', channel: tr.channel, data1: tr.program, data2: 0 });
        }
        for (const n of tr.notes) {
            endSlot = Math.max(endSlot, n.startSlot + n.durationSlots);
            if (n.pitch < 0) continue;
            events.push({ ticks: slotsToTicks(n.startSlot), type: 'noteOn', channel: tr.channel, data1: n.pitch, data2: n.velocity ?? 100 });
            events.push({ ticks: slotsToTicks(n.startSlot + n.durationSlots), type: 'noteOff', channel: tr.channel, data1: n.pitch, data2: 0 });
        }
    }

    globalMidiScheduler.stop();
    globalMidiScheduler.loadTrack(events, bpm);
    globalMidiScheduler.start();
    return endSlot;
}

/** 停止当前播放 */
export function stopPlayback(): void {
    globalMidiScheduler.stop();
}
