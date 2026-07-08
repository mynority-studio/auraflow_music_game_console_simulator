import { describe, it, expect } from 'vitest';
import { createTimebase, beats, midi } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';
import { applyUserMotifBrickToLead } from './userMotifBrick';

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

describe('render/userMotifBrick', () => {
  it('把用户 motif 作为 quote 注入锚点,只替换 quote span,保留其它 Q+N lead 续写', () => {
    const lead: TrackIR = {
      role: 'lead',
      program: 0,
      notes: [
        note(72, 0, 1),
        note(74, 1, 1),
        note(76, 4, 1),
        note(79, 17.5, 0.5),
      ],
    };

    const out = applyUserMotifBrickToLead(lead, {
      quoteBeats: 2,
      anchorBeats: [0, 16],
      notes: [
        { pitch: 60, onsetBeat: 0, durationBeat: 1, velocity: 100 },
        { pitch: 64, onsetBeat: 1, durationBeat: 1, velocity: 96 },
      ],
    }, timebase, 32);

    const events = out.notes.map((n) => ({ pitch: n.pitch as number, beat: (n.startTick as number) / timebase.ppq }));
    expect(events).toContainEqual({ pitch: 60, beat: 0 });
    expect(events).toContainEqual({ pitch: 64, beat: 1 });
    expect(events).toContainEqual({ pitch: 60, beat: 16 });
    expect(events).toContainEqual({ pitch: 64, beat: 17 });
    expect(events).toContainEqual({ pitch: 76, beat: 4 }); // Q+N 续写区保留
    expect(events.some((e) => e.pitch === 72 && e.beat === 0)).toBe(false); // quote span 被用户 motif 接管
    expect(events.some((e) => e.pitch === 79 && e.beat === 17.5)).toBe(false); // 第二个 quote span 同样替换
  });

  it('结构重音/长音吸附到 GrooveContract melody pocket,装饰音只跟随结构点位移', () => {
    const lead: TrackIR = { role: 'lead', program: 0, notes: [note(72, 0, 1)] };
    const out = applyUserMotifBrickToLead(lead, {
      quoteBeats: 2,
      anchorBeats: [0],
      notes: [
        { pitch: 60, onsetBeat: 0.08, durationBeat: 1.25, velocity: 110, accent: 1, structuralToneScore: 1 },
        { pitch: 62, onsetBeat: 0.32, durationBeat: 0.2, velocity: 78, accent: 0.2, structuralToneScore: 0.1 },
      ],
    }, timebase, 8, {
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

    const events = out.notes.map((n) => ({ pitch: n.pitch as number, beat: (n.startTick as number) / timebase.ppq }));
    const structural = events.find((e) => e.pitch === 60)!;
    const ornament = events.find((e) => e.pitch === 62)!;
    expect(structural.beat).toBeCloseTo(10 / timebase.ppq, 5); // 10ms @ 120bpm ≈ 10 ticks
    expect(ornament.beat).toBeCloseTo(125 / timebase.ppq, 5);  // 原 0.32 跟随结构点位移,不被单独吸到 0.5
  });

  it('swing/dilla contract 下,结构反拍按 melodySwingRatio 入袋', () => {
    const lead: TrackIR = { role: 'lead', program: 0, notes: [note(72, 0, 1)] };
    const out = applyUserMotifBrickToLead(lead, {
      quoteBeats: 2,
      anchorBeats: [0],
      notes: [
        { pitch: 60, onsetBeat: 0.52, durationBeat: 0.9, velocity: 108, accent: 0.9, structuralToneScore: 0.9 },
      ],
    }, timebase, 8, {
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

    const beat = (out.notes.find((n) => (n.pitch as number) === 60)!.startTick as number) / timebase.ppq;
    expect(beat).toBeGreaterThan(0.62);
    expect(beat).toBeLessThan(0.7);
  });
});
