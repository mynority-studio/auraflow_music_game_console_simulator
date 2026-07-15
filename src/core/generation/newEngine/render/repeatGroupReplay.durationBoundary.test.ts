import { describe, expect, it } from 'vitest';
import { beats, createTimebase, midi, pc, ticks } from '../foundation';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import type { ChordSpan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import { applyRepeatGroupReplay, planRepeatGroupReplays } from './repeatGroupReplay';

const timebase = createTimebase({
  meter: { numerator: 4, denominator: 4 },
  tempoMap: [{ atBeat: beats(0), bpm: 100 }],
});

const arrangement = {
  meter: { numerator: 4, denominator: 4 },
  sections: [
    { id: 'verse-a', role: 'verse', bars: 1, repeatGroup: 'verse' },
    { id: 'verse-b', role: 'verse', bars: 1, repeatGroup: 'verse' },
  ],
} as unknown as ArrangementPlan;

function chord(id: string, sectionId: string, startBeat: number, root: number): ChordSpan {
  return {
    id,
    sectionId,
    roman: { degree: 1, accidental: 'natural', quality: 'maj' },
    rootPc: pc(root),
    quality: 'maj',
    startBeat: beats(startBeat),
    durationBeats: beats(2),
  };
}

const chordTimeline: ChordSpan[] = [
  chord('source-body', 'verse-a', 0, 0),
  chord('source-link', 'verse-a', 2, 7),
  chord('target-body', 'verse-b', 4, 0),
  chord('target-link', 'verse-b', 6, 5),
];

function note(pitch: number, startBeat: number, durationBeats: number): NoteIR {
  return {
    pitch: midi(pitch),
    startTick: timebase.beatToTick(beats(startBeat)),
    durationTicks: timebase.beatToTick(beats(durationBeats)),
    velocity: 80,
  };
}

describe('render/repeatGroupReplay — duration boundary', () => {
  it('裁断跨出 source prefix 的复制音，并裁断从目标 prefix 前延入的旧音', () => {
    const plans = planRepeatGroupReplays(arrangement, chordTimeline, timebase);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      sourceStartTick: 0,
      targetStartTick: 4 * timebase.ppq,
      prefixTicks: 2 * timebase.ppq,
    });

    const sourceCrossing = note(60, 1.5, 1.5); // source body 起音，原尾部越过 beat 2 发散点
    const enteringTarget = note(50, 3.5, 1); // 目标 body 前起音，原尾部延入 beat 4
    const replacedTarget = note(72, 4.25, 0.5);
    const targetLink = note(74, 6, 0.5);
    const lead: TrackIR = {
      role: 'lead',
      notes: [sourceCrossing, enteringTarget, replacedTarget, targetLink],
    };

    const out = applyRepeatGroupReplay([lead], arrangement, chordTimeline, timebase)[0];
    const atBeat = (beat: number) => out.notes.find(
      (event) => (event.startTick as number) === (timebase.beatToTick(beats(beat)) as number),
    );

    // source 原音不改；复制到 target 的音在 beat 6(prefix end)前收住。
    expect(atBeat(1.5)?.durationTicks).toBe(1.5 * timebase.ppq);
    expect(atBeat(5.5)).toMatchObject({ pitch: midi(60), durationTicks: ticks(0.5 * timebase.ppq) });

    // 原目标前导长音裁到 target start；目标 prefix 内旧音被重放 body 替换；link 保留。
    expect(atBeat(3.5)?.durationTicks).toBe(0.5 * timebase.ppq);
    expect(atBeat(4.25)).toBeUndefined();
    expect(atBeat(6)?.pitch).toBe(midi(74));

    // 输入保持不变。
    expect(sourceCrossing.durationTicks).toBe(1.5 * timebase.ppq);
    expect(enteringTarget.durationTicks).toBe(1 * timebase.ppq);
  });
});
