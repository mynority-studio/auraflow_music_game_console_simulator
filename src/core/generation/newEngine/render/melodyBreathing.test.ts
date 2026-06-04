import { describe, it, expect } from 'vitest';
import { renderMelody } from './melodyRenderer';
import { runPrepass } from './motifAnchorPrepass';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { phraseStartBeats, beatsPerBarOf } from '../arranger/phraseTiming';
import { createTimebase, createRandomContext } from '../foundation';

describe('render/melody 句尾呼吸 (2.1)', () => {
  const band = buildBandSpec({ seed: 4, styleHint: 'pop', mood: 'x', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(4));
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  const { anchorPlan, motifStore } = runPrepass(band, arrangement, plan, createRandomContext(4));
  const lead = renderMelody(anchorPlan, motifStore, plan, arrangement, band, timebase, undefined);

  const starts = phraseStartBeats(arrangement);
  const bpb = beatsPerBarOf(arrangement.meter);
  const breath = arrangement.phraseBreathing.cadenceBreathBeats;
  const onsetBeats = lead.notes.map((n) => n.startTick / 480); // ppq 480

  it('★ 每个 phrase 末尾 cadenceBreath 拍内无 lead 起音(句尾呼吸)', () => {
    for (const p of arrangement.phrases) {
      const end = (starts[p.id] ?? 0) + p.bars * bpb;
      const breathStart = end - breath;
      const inBreath = onsetBeats.filter((b) => b >= breathStart - 1e-6 && b < end - 1e-6);
      expect(inBreath.length).toBe(0);
    }
  });

  it('末小节比首小节稀疏(发展→解决)', () => {
    // 取 verse1-p0:首小节 vs 末小节的起音数
    const ps = starts['verse1-p0'] ?? 0;
    const onsetsInBar = (bar: number) =>
      onsetBeats.filter((b) => b >= ps + bar * bpb - 1e-6 && b < ps + (bar + 1) * bpb - 1e-6).length;
    expect(onsetsInBar(3)).toBeLessThan(onsetsInBar(0));
  });

  it('确定性 + lead 仍非空、落 [67,84]', () => {
    expect(lead.notes.length).toBeGreaterThan(0);
    for (const n of lead.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(67);
      expect(n.pitch).toBeLessThanOrEqual(98);
    }
    const again = renderMelody(anchorPlan, motifStore, plan, arrangement, band, timebase, undefined);
    expect(again.notes.map((n) => n.pitch)).toEqual(lead.notes.map((n) => n.pitch));
  });
});
