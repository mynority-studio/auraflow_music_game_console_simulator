import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderSongFull } from './renderCoordinator';
import { createTimebase, createRandomContext, beats } from '../foundation';

// ============================================================
// outro 不再戛然而止(2026-06-08):两处根因修复的回归守门
//   ① 和声铺满曲式(fitProgressionToBars 按拍铺满,split-bar 槽不再让段落短缺 → 时间线整体前移挤掉 outro)
//   ② outro 接地(rnb/lofi outro 密度弧 +bass → 无 pad 编制下 outro 仍有音落终止根音)
// ============================================================

const STYLES = ['pop', 'rnb', 'lofi', 'jazz', 'modal', 'default'];

function pieces(seed: number, style: string) {
  const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band, { rng: createRandomContext(seed) });
  const instrumentation = buildInstrumentationPlan(band, arrangement, createRandomContext(seed).substream('timbre'));
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
  const timebase = createTimebase({ meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }] });
  const { ir } = renderSongFull(band, arrangement, plan, instrumentation, timebase, createRandomContext(seed));
  return { band, arrangement, plan, ir, timebase };
}

describe('harmony 时间线铺满曲式(无段落短缺)', () => {
  for (const style of STYLES) {
    it(`${style}:每段 cov = bars×beatsPerBar,时间线末端 = 总拍`, () => {
      for (let seed = 0; seed < 25; seed++) {
        const { arrangement, plan } = pieces(seed, style);
        const bpb = arrangement.meter.numerator * (4 / arrangement.meter.denominator);
        for (const s of arrangement.sections) {
          const cov = plan.chordTimeline.filter((c) => c.sectionId === s.id).reduce((n, c) => n + (c.durationBeats as number), 0);
          expect(cov).toBe(s.bars * bpb);
        }
        const end = Math.max(...plan.chordTimeline.map((c) => (c.startBeat as number) + (c.durationBeats as number)));
        const total = arrangement.sections.reduce((n, s) => n + s.bars, 0) * bpb;
        expect(end).toBe(total);
      }
    });
  }
});

describe('outro 段不空(有音落终止)', () => {
  for (const style of STYLES) {
    it(`${style}:末段(outro)tick 区间内有音`, () => {
      for (let seed = 0; seed < 25; seed++) {
        const { arrangement, ir, timebase } = pieces(seed, style);
        const bpb = arrangement.meter.numerator * (4 / arrangement.meter.denominator);
        const last = arrangement.sections[arrangement.sections.length - 1];
        let cur = 0;
        for (const s of arrangement.sections) { if (s.id === last.id) break; cur += s.bars * bpb; }
        const lo = timebase.beatToTick(beats(cur)) as number;
        const hi = timebase.beatToTick(beats(cur + last.bars * bpb)) as number;
        const notes = ir.tracks.reduce((n, tr) => n + tr.notes.filter((x) => (x.startTick as number) >= lo && (x.startTick as number) < hi).length, 0);
        expect(notes, `${style}/${seed} outro=${last.id} 空了`).toBeGreaterThan(0);
      }
    });
  }
});
