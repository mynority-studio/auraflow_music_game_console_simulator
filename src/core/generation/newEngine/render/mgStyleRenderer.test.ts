import { describe, it, expect } from 'vitest';
import { buildGuideTonePlan, guideToneAtBeat } from './mgGuideTonePlanner';
import { renderStyleFeel, feelForStyle } from './mgStyleRenderer';
import { buildChordPart, type MgChordDef } from './mgChordPart';
import type { MgNoteEvent } from './mgMelodyRealizer';

// ============================================================
// MG strict 移植 Loop 5 — GuideTonePlanner / StyleRenderer 单元锁
// ============================================================

// Cmaj7 → Dm7 → G7 → Cmaj7(各 4 拍)
const CHORDS: MgChordDef[] = [
  { root: 'C', rootMidi: 48, type: 'maj7', bassMidi: 36, duration: 4 },
  { root: 'D', rootMidi: 50, type: 'm7', bassMidi: 38, duration: 4 },
  { root: 'G', rootMidi: 55, type: '7', bassMidi: 43, duration: 4 },
  { root: 'C', rootMidi: 48, type: 'maj7', bassMidi: 36, duration: 4 },
];

describe('render/mgGuideTonePlanner · buildGuideTonePlan', () => {
  const part = buildChordPart(CHORDS);
  const plan = buildGuideTonePlan({ chordPart: part });

  it('每和弦 1-2 锚点(≥2 拍 → 2 段)', () => {
    for (const c of part.blocks) {
      const pts = plan.byChordIndex.get(c.index)!;
      expect(pts.length).toBe(2); // 4 拍 ≥ 2 → segmentCount 2
    }
  });

  it('guide-tone 落在 3rd/7th(导音骨架)', () => {
    // Cmaj7: 3rd=E(4) 7th=B(11);Dm7: 3rd=F(5) 7th=C(0);G7: 3rd=B(11) 7th=F(5)
    const guideOk: Record<number, number[]> = { 0: [4, 11], 1: [5, 0], 2: [11, 5], 3: [4, 11] };
    for (const c of part.blocks) {
      for (const p of plan.byChordIndex.get(c.index)!) {
        expect(guideOk[c.index]).toContain(p.pc);
      }
    }
  });

  it('guideToneAtBeat:null plan → null;真 plan 命中段', () => {
    expect(guideToneAtBeat(null, part.blocks[0], 0)).toBeNull();
    const p = guideToneAtBeat(plan, part.blocks[0], 0);
    expect(p).not.toBeNull();
    expect(p!.chordIndex).toBe(0);
  });
});

describe('render/mgStyleRenderer · renderStyleFeel + feelForStyle', () => {
  it('feelForStyle 预设', () => {
    expect(feelForStyle('JAZZ')).toMatchObject({ swingRatio: 0.67, articulation: 'bebop' });
    expect(feelForStyle('POP')).toMatchObject({ swingRatio: 0.5, articulation: 'legato' });
    expect(feelForStyle('RNB')).toMatchObject({ swingRatio: 0.5, articulation: 'legato' });
    expect(feelForStyle('UNKNOWN')).toEqual({});
  });

  const mk = (time: number, dur = 0.5): MgNoteEvent => ({ noteNumber: 60, time, duration: dur, velocity: 100, part: 'melody' });

  it('★ pitch 永不改', () => {
    const out = renderStyleFeel({ events: [mk(0), mk(0.5), mk(1)], feel: feelForStyle('JAZZ') });
    expect(out.map((e) => e.noteNumber)).toEqual([60, 60, 60]);
  });

  it('★ JAZZ swing:offbeat 0.5 → 0.67', () => {
    const out = renderStyleFeel({ events: [mk(0), mk(0.5)], feel: feelForStyle('JAZZ') });
    expect(out[1].time).toBeCloseTo(0.67, 5);
  });

  it('★ POP 直拍:offbeat 0.5 不动', () => {
    const out = renderStyleFeel({ events: [mk(0), mk(0.5)], feel: feelForStyle('POP') });
    expect(out[1].time).toBeCloseTo(0.5, 5);
  });

  it('★ accent:downbeat(beat0,accent 1.0)velocity 不降;弱拍降', () => {
    const out = renderStyleFeel({ events: [mk(0), mk(1)], feel: feelForStyle('POP') });
    expect(out[0].velocity).toBe(100);          // beat0 accent 1.0
    expect(out[1].velocity).toBe(90);           // beat1 accent 0.9 → 100*0.9
  });

  it('5/4 accent 真消费第 5 拍，并在 beat=5 重置小节', () => {
    const out = renderStyleFeel({
      events: [mk(4), mk(5)],
      feel: { beatsPerMeasure: 5, accentPattern: [1, 1, 1, 1, 0.5] },
    });
    expect(out.map((event) => event.velocity)).toEqual([50, 100]);
  });

  it('★ bebop articulation:duration ×0.85', () => {
    const out = renderStyleFeel({ events: [mk(0, 0.5)], feel: feelForStyle('JAZZ') });
    expect(out[0].duration).toBeCloseTo(0.5 * 0.85, 5);
  });
});
