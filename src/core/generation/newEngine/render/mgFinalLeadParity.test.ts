import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderMgMelody } from './mgLeadRenderer';
import { renderSongFull } from './renderCoordinator';
import { applyRepeatGroupReplay } from './repeatGroupReplay';
import { applyGroovePocket } from './groovePocket';
import { fillLeadBarGaps } from './leadGapFill';
import { connectFastLeadNoteIR, fastLeadLegatoOptionsForStyle } from './leadArticulation';
import { sanitizeLeadNoteIR } from './leadSanitizer';
import { normalizeAcgDynamics } from './acgDynamics';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { createTimebase, createRandomContext, beats } from '../foundation';

const SAN = { gapTicks: 1, minDurTicks: 1 };

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
  // ★ ACG fidelity directive §2.3/§4(2026-06-28):此前无 ACG seed → ACG final lead 未被 parity 锁。补 ACG seed,
  //   ACG lead 走同一渲染链(renderMgMelody → fill → replay → pocket → sanitize → legato)→ 同不变量。
  for (const [seed, style] of [[7, 'lofi'], [396040, 'pop'], [777870, 'rnb'], [64062, 'lofi'], [633823, 'pop'], [3, 'jazz'], [7, 'acg'], [42, 'acg']] as const) {
    it(`${seed}/${style}:final lead 事件级 == raw MG lead 经 repeatGroup 重放`, () => {
      const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
      const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
      const instr = buildInstrumentationPlan(band, arr, createRandomContext(seed).substream('timbre'));
      const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
      const tb = createTimebase({ meter: { numerator: arr.meter.numerator, denominator: arr.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arr.tempoBpm }] });
      // ★ Phase D:baseline 喂 arranger 选中的 GrooveContract(+lead program),与生产一致
      //   (生产 lead feel/pocket 真源 = contract;不喂则 baseline 走 feelForStyle → 与生产 contract feel 漂 1-9 tick)。
      const raw = renderMgMelody(plan, band, tb, seed, instr.roleProgram?.lead, arr.songGrooveContract);
      // ★ 契约:原始 MG lead 经【空拍补全 → repeatGroup 重放 → 末端安全闸(sanitize → (jazz/blues)legato → sanitize)】
      //   = production lead 的预期。lead 不 humanize;legato 只改 duration;sanitize 只裁同 pitch collision(无 overlap 时
      //   为 no-op)→ 多数 seed 仍逐字节相等,仅含同 pitch overlap 的 seed(raw MG 自身重叠)被安全闸裁短(directive
      //   q_n_final_lead_sanitizer 2026-06-23)。
      // ★ ACG(P0-2 mg fidelity):生产跳过 fillLeadBarGaps(保 MG 空旷 lead 呼吸感)→ 预期也跳过。
      const filled = band.style.toLowerCase() === 'acg' ? [raw] : fillLeadBarGaps([raw], plan.chordTimeline, tb, beatsPerBarOf(arr.meter));
      const replayed = applyRepeatGroupReplay(filled, arr, plan.chordTimeline, tb)[0];
      // ★ Phase D(directive 3.2):真 GrooveContract 的 ms melody-pocket → applyGroovePocket lay-back(humanizeTiming 之后)。
      const pocketed = applyGroovePocket([replayed], arr.songGrooveContract, arr.tempoBpm, tb.ppq, beatsPerBarOf(arr.meter))[0];
      const preSan = { ...pocketed, notes: sanitizeLeadNoteIR(pocketed.notes, SAN) };
      const legatoOpts = fastLeadLegatoOptionsForStyle(band.style, tb.ppq);
      const legato = legatoOpts.enabled ? { ...preSan, notes: connectFastLeadNoteIR(preSan.notes, legatoOpts) } : preSan;
      const sanitizedExp = { ...legato, notes: sanitizeLeadNoteIR(legato.notes, SAN) };
      // ★ ACG(P1 mg fidelity):生产末步 normalizeAcgDynamics 把 lead velocity 归一到 MG 目标(86)→ 预期也归一。
      const expected = band.style.toLowerCase() === 'acg'
        ? normalizeAcgDynamics([sanitizedExp], beatsPerBarOf(arr.meter) * tb.ppq)[0]
        : sanitizedExp;
      const final = renderSongFull(band, arr, plan, instr, tb, createRandomContext(seed)).ir.tracks.find((t) => t.role === 'lead')!;
      expect(final.notes.length).toBe(expected.notes.length);
      expect(ev(final.notes as never)).toBe(ev(expected.notes as never)); // pitch/start/dur/velocity 全等(jazz 含末步 legato)
    });
  }
});
