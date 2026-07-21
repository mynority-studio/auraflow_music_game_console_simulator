import { describe, it, expect } from 'vitest';
import { createTimebase, beats, midi, pc } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';
import { assemble } from '../harmony/harmonyEngine';
import type { RoadMap } from './mgRoadMapParser';
import { buildMelodyRhythmShapeProfile } from './mgRhythmShapeMatcher';
import {
  assembleAuthoredUserMotifLead,
  materializeAuthoredUserMotifBrick,
  planAuthoredUserMotifBrick,
  type AuthoredUserMotifBrickPlan,
  type UserMotifBrickNote,
} from './userMotifBrick';

const timebase = createTimebase({
  meter: { numerator: 4, denominator: 4 },
  tempoMap: [{ atBeat: beats(0), bpm: 96 }],
});

const note = (pitch: number, beat: number, dur: number, velocity = 80) => ({
  pitch: midi(pitch),
  startTick: timebase.beatToTick(beats(beat)),
  durationTicks: timebase.beatToTick(beats(dur)),
  velocity,
});

const authoredPlan = (
  notes: readonly UserMotifBrickNote[],
  endBeat = 2,
): AuthoredUserMotifBrickPlan => ({
  roadMapBrickIndices: [0],
  roadMapBrickNames: ['test-brick'],
  startBeat: 0,
  endBeat,
  sourceSpanBeats: endBeat,
  targetSpanBeats: endBeat,
  scaleFactor: 1,
  harmonicSupportRatio: 1,
  placementScore: 100,
  timingDeviationRatioLimit: 0.2,
  fidelityReferenceNotes: notes,
  rhythmShapeProfile: buildMelodyRhythmShapeProfile(notes, 0, endBeat),
  notes,
});

describe('render/userMotifBrick', () => {
  it('生产 RoadMap 可在和声 brick 内自然结束,不为填满区间把用户 motif 拉成双倍速度', () => {
    const harmonic = assemble([
      { roman: { degree: 1, accidental: 'natural', quality: 'maj' }, rootPc: pc(0), quality: 'maj', durationBeats: 4, sectionId: 'verse', func: 'T' },
      { roman: { degree: 1, accidental: 'natural', quality: 'maj' }, rootPc: pc(0), quality: 'maj', durationBeats: 4, sectionId: 'verse', func: 'T' },
      { roman: { degree: 5, accidental: 'natural', quality: '7' }, rootPc: pc(7), quality: '7', durationBeats: 4, sectionId: 'verse', func: 'D' },
    ], pc(0), 'major');
    const roadMap: RoadMap = {
      totalCost: 0,
      segments: [],
      bricks: [
        { name: 'early-cadence', family: 'Cadence', startBeat: 0, durationBeats: 4, chordIndices: [0], cost: 0 },
        { name: 'theme-on', family: 'Major-On', startBeat: 4, durationBeats: 4, chordIndices: [1], cost: 0 },
        { name: 'ending-cadence', family: 'Cadence', startBeat: 8, durationBeats: 4, chordIndices: [2], cost: 0 },
      ],
    };
    const plan = planAuthoredUserMotifBrick({
      brick: {
        quoteBeats: 2,
        primaryFunction: 'opening',
        notes: [
          { pitch: 60, onsetBeat: 0, durationBeat: 0.5, velocity: 100, structuralToneScore: 1 },
          { pitch: 64, onsetBeat: 1, durationBeat: 0.5, velocity: 96, structuralToneScore: 1 },
        ],
      },
      roadMap,
      harmonicPlan: harmonic,
      totalBeats: 12,
    })!;

    expect(plan.startBeat).toBe(4);
    expect(plan.endBeat).toBe(6);
    expect(plan.scaleFactor).toBe(1);
    expect(plan.notes.map((event) => [event.onsetBeat, event.durationBeat])).toEqual([[4, 0.5], [5, 0.5]]);
    expect(plan.notes.map((event) => event.pitch)).toEqual([60, 64]);

    const authored = materializeAuthoredUserMotifBrick(plan, timebase);
    const generated: TrackIR = { role: 'lead', notes: [note(72, 4, 1), note(74, 8, 1)] };
    const assembled = assembleAuthoredUserMotifLead(generated, plan, authored, timebase);
    expect(assembled.notes.map((event) => event.pitch as number)).toEqual([60, 64, 74]);
  });

  it('结构重音/长音吸附到 GrooveContract melody pocket,装饰音只跟随结构点位移', () => {
    const out = materializeAuthoredUserMotifBrick(authoredPlan([
        { pitch: 60, onsetBeat: 0.08, durationBeat: 1.25, velocity: 110, accent: 1, structuralToneScore: 1 },
        { pitch: 62, onsetBeat: 0.32, durationBeat: 0.2, velocity: 78, accent: 0.2, structuralToneScore: 0.1 },
      ]), timebase, {
      grooveContract: {
        grid: 'straight',
        melodySwingRatio: 0.5,
        melodyStrongPocketMs: [10, 10],
        melodyWeakPocketMs: [20, 20],
      },
      tempoBpm: 120,
      swingRatio: 0.5,
      beatsPerBar: 4,
    });

    const events = out.map((n) => ({ pitch: n.pitch as number, beat: (n.startTick as number) / timebase.ppq }));
    const structural = events.find((e) => e.pitch === 60)!;
    const ornament = events.find((e) => e.pitch === 62)!;
    expect(structural.beat).toBeCloseTo(10 / timebase.ppq, 5); // 10ms @ 120bpm ≈ 10 ticks
    expect(ornament.beat).toBeCloseTo(125 / timebase.ppq, 5);  // 原 0.32 跟随结构点位移,不被单独吸到 0.5
  });

  it('用户 motif 长短时值按最终 Groove/BPM 微修,但保持长短关系', () => {
    const out = materializeAuthoredUserMotifBrick(authoredPlan([
        { pitch: 60, onsetBeat: 0.08, durationBeat: 0.92, velocity: 110, accent: 1, structuralToneScore: 1 },
        { pitch: 62, onsetBeat: 1.48, durationBeat: 0.19, velocity: 76, accent: 0.2, structuralToneScore: 0.1 },
      ]), timebase, {
      grooveContract: {
        grid: 'straight',
        melodySwingRatio: 0.5,
        melodyStrongPocketMs: [0, 0],
        melodyWeakPocketMs: [0, 0],
      },
      tempoBpm: 120,
      swingRatio: 0.5,
      beatsPerBar: 4,
    });

    const long = out.find((n) => (n.pitch as number) === 60)!;
    const short = out.find((n) => (n.pitch as number) === 62)!;
    expect((long.startTick as number) / timebase.ppq).toBeCloseTo(0, 5);
    expect((long.durationTicks as number) / timebase.ppq).toBeCloseTo(1, 5);
    expect((short.startTick as number) / timebase.ppq).toBeCloseTo(1.5, 5);
    const shortDuration = (short.durationTicks as number) / timebase.ppq;
    expect(shortDuration).toBeGreaterThanOrEqual(0.19 * 0.8 - 1 / timebase.ppq);
    expect(shortDuration).toBeLessThanOrEqual(0.19 * 1.2 + 1 / timebase.ppq);
  });

  it('整体 fitting 和 Groove 微调共用一个 20% 预算,不会分层累计成 44%', () => {
    const reference: UserMotifBrickNote[] = [
      { pitch: 60, onsetBeat: 0, durationBeat: 1, velocity: 108, accent: 1, structuralToneScore: 1 },
      { pitch: 64, onsetBeat: 1, durationBeat: 0.5, velocity: 92, accent: 0.7, structuralToneScore: 0.8 },
    ];
    const plan: AuthoredUserMotifBrickPlan = {
      ...authoredPlan(reference, 2.4),
      targetSpanBeats: 2.4,
      scaleFactor: 1.2,
      fidelityReferenceNotes: reference,
      notes: [
        { ...reference[0], durationBeat: 1.2 },
        { ...reference[1], onsetBeat: 1.2, durationBeat: 0.6 },
      ],
    };
    const out = materializeAuthoredUserMotifBrick(plan, timebase, {
      grooveContract: {
        grid: 'dilla',
        melodySwingRatio: 0.66,
        melodyStrongPocketMs: [20, 20],
        melodyWeakPocketMs: [30, 30],
      },
      tempoBpm: 120,
      swingRatio: 0.66,
      beatsPerBar: 4,
    });
    const durations = out.map((event) => (event.durationTicks as number) / timebase.ppq);
    const ioi = ((out[1].startTick as number) - (out[0].startTick as number)) / timebase.ppq;
    expect(durations[0]).toBeLessThanOrEqual(1.2 + 1 / timebase.ppq);
    expect(durations[1]).toBeLessThanOrEqual(0.6 + 1 / timebase.ppq);
    expect(ioi).toBeLessThanOrEqual(1.2 + 1 / timebase.ppq);
    expect(ioi).toBeGreaterThanOrEqual(0.8 - 1 / timebase.ppq);
  });

  it('swing/dilla contract 下,结构反拍按 melodySwingRatio 入袋', () => {
    const out = materializeAuthoredUserMotifBrick(authoredPlan([
        { pitch: 60, onsetBeat: 0.52, durationBeat: 0.9, velocity: 108, accent: 0.9, structuralToneScore: 0.9 },
      ]), timebase, {
      grooveContract: {
        grid: 'dilla',
        melodySwingRatio: 0.66,
        melodyStrongPocketMs: [0, 0],
        melodyWeakPocketMs: [0, 0],
      },
      tempoBpm: 96,
      swingRatio: 0.66,
      beatsPerBar: 4,
    });

    const beat = (out.find((n) => (n.pitch as number) === 60)!.startTick as number) / timebase.ppq;
    expect(beat).toBeGreaterThan(0.62);
    expect(beat).toBeLessThan(0.7);
  });
});
