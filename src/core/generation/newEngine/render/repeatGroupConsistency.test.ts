// ============================================================
// newEngine · render · repeatGroup 重放一致性(2026-06-11)
// ------------------------------------------------------------
// 用户诉求验收:重复段落(verse1≡verse2 / chorus1≡chorus2)body 全轨【同音符】;
//   lead 逐字节一致(不 humanize);comp/bass/pad/drum 同音符(pitch/count)+ 各自人性化(timing/velocity 可不同);
//   链接尾巴(发散点之后)允许各自不同;确定性;深不可变。
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderSongFull } from './renderCoordinator';
import { planRepeatGroupReplays } from './repeatGroupReplay';
import { createTimebase, createRandomContext, beats } from '../foundation';
import type { MusicalIR, NoteIR } from '../ir/MusicalIR';

function pipeline(seed: number, style: string) {
  const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 150 });
  const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
  const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
  const instr = buildInstrumentationPlan(band, arr, createRandomContext(seed).substream('timbre'), plan);
  const tb = createTimebase({ meter: { numerator: arr.meter.numerator, denominator: arr.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arr.tempoBpm }] });
  const { ir } = renderSongFull(band, arr, plan, instr, tb, createRandomContext(seed));
  const plans = planRepeatGroupReplays(arr, plan.chordTimeline, tb);
  return { ir, plans, arr, plan, tb };
}

const win = (ir: MusicalIR, role: string, lo: number, hi: number): NoteIR[] =>
  (ir.tracks.find((t) => t.role === role)?.notes ?? []).filter((n) => (n.startTick as number) >= lo && (n.startTick as number) < hi);
const pitchMultiset = (ns: NoteIR[]) => ns.map((n) => n.pitch as number).sort((a, b) => a - b).join(',');
const exact = (ns: NoteIR[], base: number) =>
  [...ns].sort((a, b) => (a.startTick as number) - (b.startTick as number) || (a.pitch as number) - (b.pitch as number))
    .map((n) => `${n.pitch as number}@${(n.startTick as number) - base}+${n.durationTicks as number}v${n.velocity}`).join('|');

const ROLES = ['lead', 'comp', 'bass', 'pad', 'drum'];

describe('render/repeatGroupConsistency — 重复段 body 同音符,尾巴各自', () => {
  const SEEDS: [number, string][] = [[3, 'pop'], [42, 'pop'], [7, 'rnb'], [100, 'rnb'], [7, 'lofi'], [64062, 'lofi'], [3, 'jazz'], [42, 'jazz']];

  it('每个重放:body 全轨 pitch-multiset 一致 + 音数一致;lead 逐字节一致', () => {
    let exercised = 0;
    for (const [seed, style] of SEEDS) {
      const { ir, plans } = pipeline(seed, style);
      for (const p of plans) {
        exercised++;
        for (const role of ROLES) {
          const src = win(ir, role, p.sourceStartTick, p.sourceStartTick + p.prefixTicks);
          const tgt = win(ir, role, p.targetStartTick, p.targetStartTick + p.prefixTicks);
          expect(tgt.length, `${seed}/${style} ${p.targetId} ${role} count`).toBe(src.length);
          expect(pitchMultiset(tgt), `${seed}/${style} ${p.targetId} ${role} pitch-multiset`).toBe(pitchMultiset(src));
          if (role === 'lead') {
            // lead 不 humanize → 前缀逐字节一致(相对各自段起点)
            expect(exact(tgt, p.targetStartTick), `${seed}/${style} ${p.targetId} lead exact`).toBe(exact(src, p.sourceStartTick));
          }
        }
      }
    }
    expect(exercised, '至少有重放发生(机制被实际触发)').toBeGreaterThan(0);
  });

  it('POP/RNB 含重复段 → 必有重放计划', () => {
    for (const [seed, style] of [[3, 'pop'], [42, 'pop'], [7, 'rnb']] as [number, string][]) {
      const { plans } = pipeline(seed, style);
      expect(plans.length, `${seed}/${style} 应有重放`).toBeGreaterThan(0);
    }
  });

  it('确定性:同 seed 两次生成 → IR 逐字节一致', () => {
    const snap = (ir: MusicalIR) => JSON.stringify(ir.tracks.map((t) => ({ r: t.role, n: t.notes.map((x) => [x.pitch, x.startTick, x.durationTicks, x.velocity]) })));
    for (const [seed, style] of [[3, 'pop'], [7, 'rnb']] as [number, string][]) {
      expect(snap(pipeline(seed, style).ir)).toBe(snap(pipeline(seed, style).ir));
    }
  });

  it('IR 深不可变', () => {
    const { ir } = pipeline(3, 'pop');
    expect(Object.isFrozen(ir)).toBe(true);
    expect(Object.isFrozen(ir.tracks)).toBe(true);
  });
});
