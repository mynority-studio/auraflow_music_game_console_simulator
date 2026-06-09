import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderMgMelody } from './mgLeadRenderer';
import { renderSongFull } from './renderCoordinator';
import { createTimebase, createRandomContext, beats } from '../foundation';

// ============================================================
// Loop 3/4(Option A strict parity):final lead === renderMgMelody 原始 lead(事件级一致)。
//   lead = MG 真源,不被任何 newEngine 后处理(gate/dynamics/ending/lead-in/humanize/swing/resolver/snap)改写。
// ============================================================
function ev(notes: readonly { pitch: number; startTick: number; durationTicks: number; velocity: number }[]) {
  return notes.map((n) => `${n.pitch as number}@${n.startTick as number}:${n.durationTicks as number}:${n.velocity}`).join('|');
}

describe('render/mgFinalLeadParity · final lead === MG raw lead', () => {
  for (const [seed, style] of [[7, 'lofi'], [396040, 'pop'], [777870, 'rnb'], [64062, 'lofi'], [633823, 'pop'], [3, 'jazz']] as const) {
    it(`${seed}/${style}:final lead 事件级 == raw MG lead`, () => {
      const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
      const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
      const instr = buildInstrumentationPlan(band, arr, createRandomContext(seed).substream('timbre'));
      const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
      const tb = createTimebase({ meter: { numerator: arr.meter.numerator, denominator: arr.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arr.tempoBpm }] });
      const raw = renderMgMelody(plan, band, tb, seed);
      const final = renderSongFull(band, arr, plan, instr, tb, createRandomContext(seed)).ir.tracks.find((t) => t.role === 'lead')!;
      expect(final.notes.length).toBe(raw.notes.length);
      expect(ev(final.notes as never)).toBe(ev(raw.notes as never)); // pitch/start/dur/velocity 全等
    });
  }
});
