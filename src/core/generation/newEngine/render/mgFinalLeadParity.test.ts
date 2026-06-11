import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderMgMelody } from './mgLeadRenderer';
import { renderSongFull } from './renderCoordinator';
import { applyRepeatGroupReplay } from './repeatGroupReplay';
import { fillLeadBarGaps } from './leadGapFill';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { createTimebase, createRandomContext, beats } from '../foundation';

// ============================================================
// Loop 3/4(Option A strict parity)+ repeatGroup 重放(2026-06-11):
//   final lead === renderMgMelody 原始 lead 【经 repeatGroup 重放后】(事件级一致)。
//   契约:每个 repeatGroup 【首次出现】== raw MG;【重复出现】== 首次出现的重放(body 复用,链接尾巴各自)。
//   lead 仍不被 dynamics/ending/lead-in/humanize/swing/resolver/snap 改写(只重放,且 lead 不 humanize → 逐字节一致)。
// ============================================================
function ev(notes: readonly { pitch: number; startTick: number; durationTicks: number; velocity: number }[]) {
  return notes.map((n) => `${n.pitch as number}@${n.startTick as number}:${n.durationTicks as number}:${n.velocity}`).join('|');
}

describe('render/mgFinalLeadParity · final lead === replay(MG raw lead)', () => {
  for (const [seed, style] of [[7, 'lofi'], [396040, 'pop'], [777870, 'rnb'], [64062, 'lofi'], [633823, 'pop'], [3, 'jazz']] as const) {
    it(`${seed}/${style}:final lead 事件级 == raw MG lead 经 repeatGroup 重放`, () => {
      const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
      const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
      const instr = buildInstrumentationPlan(band, arr, createRandomContext(seed).substream('timbre'));
      const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
      const tb = createTimebase({ meter: { numerator: arr.meter.numerator, denominator: arr.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arr.tempoBpm }] });
      const raw = renderMgMelody(plan, band, tb, seed);
      // ★ 契约:原始 MG lead 经【空拍补全 → repeatGroup 重放】= production lead 的预期(lead 不 humanize → 逐字节相等)
      const filled = fillLeadBarGaps([raw], plan.chordTimeline, tb, beatsPerBarOf(arr.meter));
      const expected = applyRepeatGroupReplay(filled, arr, plan.chordTimeline, tb)[0];
      const final = renderSongFull(band, arr, plan, instr, tb, createRandomContext(seed)).ir.tracks.find((t) => t.role === 'lead')!;
      expect(final.notes.length).toBe(expected.notes.length);
      expect(ev(final.notes as never)).toBe(ev(expected.notes as never)); // pitch/start/dur/velocity 全等
    });
  }
});
