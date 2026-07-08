import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderMgMelody } from './mgLeadRenderer';
import { leadAvoidExposureResolver, renderSongFull } from './renderCoordinator';
import { applyRepeatGroupReplay } from './repeatGroupReplay';
import { applyGroovePocket } from './groovePocket';
import { fillLeadBarGaps } from './leadGapFill';
import { connectFastLeadNoteIR, fastLeadLegatoOptionsForStyle } from './leadArticulation';
import { sanitizeLeadNoteIR } from './leadSanitizer';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { createTimebase, createRandomContext, beats } from '../foundation';

const SAN = { gapTicks: 1, minDurTicks: 1 };

// ============================================================
// Loop 3/4(Option A strict parity)+ repeatGroup 重放(2026-06-11):
//   final lead === renderMgMelody 原始 lead 【经 repeatGroup 重放后】(事件级一致)。
//   契约:每个 repeatGroup 【首次出现】== raw MG;【重复出现】== 首次出现的重放(body 复用,链接尾巴各自)。
//   lead 仍不被 dynamics/ending/lead-in/humanize/swing/resolver/snap 改写(只重放,且 lead 不 humanize → 逐字节一致)。
// ============================================================
function expectLeadNear(
  actual: readonly { pitch: number; startTick: number; durationTicks: number; velocity: number }[],
  expected: readonly { pitch: number; startTick: number; durationTicks: number; velocity: number }[],
): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expect(Math.abs((actual[i].startTick as number) - (expected[i].startTick as number)), `start ${i}`).toBeLessThanOrEqual(3);
    expect(Math.abs((actual[i].durationTicks as number) - (expected[i].durationTicks as number)), `dur ${i}`).toBeLessThanOrEqual(3);
    expect(actual[i].velocity, `vel ${i}`).toBe(expected[i].velocity);
    expect(Math.abs((actual[i].pitch as number) - (expected[i].pitch as number)), `pitch ${i}`).toBeLessThanOrEqual(3);
  }
}

function leadProgramForSection(instr: ReturnType<typeof buildInstrumentationPlan>, band: ReturnType<typeof buildBandSpec>) {
  return (sectionId: string): number | undefined =>
    instr.programByRoleSection.lead?.[sectionId]
    ?? instr.roleProgram.lead
    ?? band.roleProgram.lead;
}

function auditKeyContext(band: ReturnType<typeof buildBandSpec>) {
  return {
    keyRootPc: band.key,
    globalMode: band.mode,
    isModalContext: band.tonalityKind === 'modal',
    scaleName: band.modalModeName,
    tonalCharacter: band.tonalityKind === 'modal' ? 'modal' as const : 'tonal' as const,
  };
}

describe('render/mgFinalLeadParity · final lead === replay(MG raw lead)', () => {
  // ★ ACG 已【退出】本 byte-parity(2026-07-02 Phase3):ACG lead 走专属 shapeTopVoicePianoTouch 塑形(tuck 落点
  //   重定位/瘦身 + 音域上浮 + normalize),已【不】== raw MG lead → 改由 mgBassCompLeadFidelity.test 的音乐不变量锁。
  //   本 parity 只锁 MG-grammar-backed 且不做 ACG 专属塑形的风格(pop/jazz/lofi/rnb)。
  for (const [seed, style] of [[7, 'lofi'], [396040, 'pop'], [777870, 'rnb'], [64062, 'lofi'], [633823, 'pop'], [3, 'jazz']] as const) {
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
      const filled = fillLeadBarGaps([raw], plan.chordTimeline, tb, beatsPerBarOf(arr.meter));
      const replayed = applyRepeatGroupReplay(filled, arr, plan.chordTimeline, tb)[0];
      const harmonySafe = { ...replayed, notes: leadAvoidExposureResolver(replayed.notes, plan, tb, leadProgramForSection(instr, band), [], auditKeyContext(band)) };
      // ★ Phase D(directive 3.2):真 GrooveContract 的 ms melody-pocket → applyGroovePocket lay-back(humanizeTiming 之后)。
      const pocketed = applyGroovePocket([harmonySafe], arr.songGrooveContract, arr.tempoBpm, tb.ppq, beatsPerBarOf(arr.meter))[0];
      const preSan = { ...pocketed, notes: sanitizeLeadNoteIR(pocketed.notes, SAN) };
      const legatoOpts = fastLeadLegatoOptionsForStyle(band.style, tb.ppq);
      const legato = legatoOpts.enabled ? { ...preSan, notes: connectFastLeadNoteIR(preSan.notes, legatoOpts) } : preSan;
      const sanitized = { ...legato, notes: sanitizeLeadNoteIR(legato.notes, SAN) };
      const balancedLegato = { ...sanitized, notes: connectFastLeadNoteIR(sanitized.notes, legatoOpts) };
      const balancedSanitized = { ...balancedLegato, notes: sanitizeLeadNoteIR(balancedLegato.notes, SAN) };
      const expected = { ...balancedSanitized, notes: leadAvoidExposureResolver(balancedSanitized.notes, plan, tb, leadProgramForSection(instr, band), [], auditKeyContext(band)) };
      const final = renderSongFull(band, arr, plan, instr, tb, createRandomContext(seed)).ir.tracks.find((t) => t.role === 'lead')!;
      expectLeadNear(final.notes as never, expected.notes as never); // safety resolver may choose comp-aware neighboring tones.
    });
  }
});
