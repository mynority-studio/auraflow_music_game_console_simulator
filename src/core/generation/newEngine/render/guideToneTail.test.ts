import { describe, it, expect } from 'vitest';
import { renderMelody } from './melodyRenderer';
import { runPrepass } from './motifAnchorPrepass';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { phraseStartBeats, beatsPerBarOf } from '../arranger/phraseTiming';
import { guideTonePcs } from '../knowledge/guideTonePolicies';
import { createTimebase, createRandomContext } from '../foundation';

describe('render/melody GuideTone tail (2.3)', () => {
  const band = buildBandSpec({ seed: 4, styleHint: 'pop', mood: 'x', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(4));
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  const { anchorPlan, motifStore } = runPrepass(band, arrangement, plan, createRandomContext(4));
  const lead = renderMelody(anchorPlan, motifStore, plan, arrangement, band, timebase, undefined);

  const starts = phraseStartBeats(arrangement);
  const bpb = beatsPerBarOf(arrangement.meter);

  // 取一个 connector 句(intro-p0:skeletonRole=connector)
  const connector = arrangement.phrases.find((p) => p.id === 'intro-p0')!;
  const hookPhrase = arrangement.phrases.find((p) => p.skeletonRole === 'hook')!;

  const notesInPhrase = (pid: string) => {
    const p = arrangement.phrases.find((x) => x.id === pid)!;
    const lo = starts[pid] ?? 0;
    const hi = lo + p.bars * bpb;
    return lead.notes.filter((n) => { const b = n.startTick / 480; return b >= lo && b < hi; });
  };

  it('connector 句的音都是导音(其和弦的 3/7 音)', () => {
    expect(connector.skeletonRole).toBe('connector');
    const ns = notesInPhrase('intro-p0');
    expect(ns.length).toBeGreaterThan(0);
    for (const n of ns) {
      const b = n.startTick / 480;
      const chord = plan.chordTimeline.find((c) => b >= c.startBeat && b < c.startBeat + c.durationBeats)!;
      const { third, seventh } = guideTonePcs(chord.rootPc, chord.quality);
      const isGuide = n.pitch % 12 === third || n.pitch % 12 === seventh;
      expect(isGuide).toBe(true);
    }
  });

  it('★ connector(导音线)比 hook 句稀疏', () => {
    expect(notesInPhrase('intro-p0').length).toBeLessThan(notesInPhrase(hookPhrase.id).length);
  });

  it('确定性', () => {
    const again = renderMelody(anchorPlan, motifStore, plan, arrangement, band, timebase, undefined);
    expect(again.notes.map((n) => n.pitch)).toEqual(lead.notes.map((n) => n.pitch));
  });
});
