import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderMgMelody } from './mgLeadRenderer';
import { gateByDensity, leadAvoidExposureResolver, renderSongFull } from './renderCoordinator';
import { applyRepeatGroupReplay } from './repeatGroupReplay';
import { applyGroovePocket } from './groovePocket';
import { fillLeadBarGaps } from './leadGapFill';
import { connectFastLeadNoteIR, fastLeadLegatoOptionsForStyle } from './leadArticulation';
import { sanitizeLeadNoteIR } from './leadSanitizer';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { createTimebase, createRandomContext, beats } from '../foundation';
import { applyGestureExpressionToTrack } from '../instrumental/gestureExpression';
import { applyEnding, applyLeadIns } from './ending';
import { applyDynamics, type EnergyRange } from './dynamics';

const SAN = { gapTicks: 1, minDurTicks: 1 };

// ============================================================
// Loop 3/4(Option A strict parity)+ repeatGroup 重放(2026-06-11):
//   final lead === renderMgMelody 原始 lead 【经 repeatGroup 重放后】(事件级一致)。
//   契约:每个 repeatGroup 【首次出现】== raw MG;【重复出现】== 首次出现的重放(body 复用,链接尾巴各自)。
//   lead pitch/onset/duration 仍保持 MG+replay 契约；velocity 在 replay 后按目标段 lead-in 重新投影。
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

function withExpectedLeadGesture<T extends { notes: any[] }>(
  track: T,
  instr: ReturnType<typeof buildInstrumentationPlan>,
  tb: ReturnType<typeof createTimebase>,
): T {
  const gesture = applyGestureExpressionToTrack(
    { ...track, role: 'lead', program: instr.roleProgram.lead } as never,
    instr.gestureExpressionByRole?.lead,
    tb,
  );
  return { ...track, notes: gesture.notes };
}

function withExpectedSectionExpression(
  track: ReturnType<typeof renderMgMelody>,
  arrangement: ReturnType<typeof buildArrangementPlan>,
  instrumentation: ReturnType<typeof buildInstrumentationPlan>,
  tb: ReturnType<typeof createTimebase>,
) {
  const beatsPerBar = beatsPerBarOf(arrangement.meter);
  const energyRanges: EnergyRange[] = [];
  const climaxIntensityBySection = new Map<string, number>();
  for (const climax of arrangement.climaxMap) {
    climaxIntensityBySection.set(
      climax.sectionId,
      Math.max(climaxIntensityBySection.get(climax.sectionId) ?? 0, Math.max(0, Math.min(1, climax.intensity))),
    );
  }
  let beatCursor = 0;
  for (const section of arrangement.sections) {
    const end = beatCursor + section.bars * beatsPerBar;
    const baseEnergy = arrangement.energyBySection[section.id] ?? 0.5;
    const energy = Math.min(1, baseEnergy + (climaxIntensityBySection.get(section.id) ?? 0) * 0.12);
    energyRanges.push({ lo: beatCursor, hi: end, energy });
    beatCursor = end;
  }
  const dynamic = applyDynamics([track], energyRanges, tb.ppq)[0];
  const ended = applyEnding([dynamic], arrangement, instrumentation.endingPlan, tb.ppq, beatsPerBar)[0];
  const leadInBars = new Set<number>();
  let barCursor = 0;
  for (let index = 0; index < arrangement.sections.length; index++) {
    barCursor += arrangement.sections[index].bars;
    const next = arrangement.sections[index + 1];
    if (next && arrangement.entryBySection[next.id] === 'lead-in') leadInBars.add(barCursor - 1);
  }
  return applyLeadIns([ended], leadInBars, tb.ppq, beatsPerBar)[0];
}

function withExpectedArrangerGate(
  track: ReturnType<typeof renderMgMelody>,
  arrangement: ReturnType<typeof buildArrangementPlan>,
  instrumentation: ReturnType<typeof buildInstrumentationPlan>,
  plan: ReturnType<typeof buildHarmonicPlanFromArrangement>,
  tb: ReturnType<typeof createTimebase>,
) {
  const barTicks = beatsPerBarOf(arrangement.meter) * tb.ppq;
  const pickupWindows = instrumentation.transitionPlan.boundaries
    .filter((boundary) => boundary.protectPickupFromGate && boundary.pickupRoles.length > 0)
    .map((boundary) => ({
      lo: boundary.prepBar * barTicks,
      hi: (boundary.prepBar + 1) * barTicks,
      roles: new Set<string>(boundary.pickupRoles as readonly string[]),
    }));
  return gateByDensity([track], plan, tb, instrumentation.activeRolesBySection, {
    pickupWindows,
    rolePerformanceBySection: arrangement.rolePerformanceBySection,
    openingGesture: arrangement.openingGesture,
  })[0];
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
      const gated = withExpectedArrangerGate(replayed, arr, instr, plan, tb);
      const withSectionExpression = withExpectedSectionExpression(gated, arr, instr, tb);
      // ★ Phase D(directive 3.2):真 GrooveContract 的 ms melody-pocket → applyGroovePocket lay-back(humanizeTiming 之后)。
      const pocketed = applyGroovePocket([withSectionExpression], arr.songGrooveContract, arr.tempoBpm, tb.ppq, beatsPerBarOf(arr.meter))[0];
      const preSan = { ...pocketed, notes: sanitizeLeadNoteIR(pocketed.notes, SAN) };
      const legatoOpts = fastLeadLegatoOptionsForStyle(band.style, tb.ppq);
      const legato = legatoOpts.enabled ? { ...preSan, notes: connectFastLeadNoteIR(preSan.notes, legatoOpts) } : preSan;
      const sanitized = { ...legato, notes: sanitizeLeadNoteIR(legato.notes, SAN) };
      const balancedLegato = { ...sanitized, notes: connectFastLeadNoteIR(sanitized.notes, legatoOpts) };
      const balancedSanitized = { ...balancedLegato, notes: sanitizeLeadNoteIR(balancedLegato.notes, SAN) };
      const gestured = withExpectedLeadGesture(balancedSanitized, instr, tb);
      const resolvedNotes = leadAvoidExposureResolver(gestured.notes, plan, tb, leadProgramForSection(instr, band), [], auditKeyContext(band));
      const expected = { ...gestured, notes: sanitizeLeadNoteIR(resolvedNotes, SAN) };
      const final = renderSongFull(band, arr, plan, instr, tb, createRandomContext(seed)).ir.tracks.find((t) => t.role === 'lead')!;
      expectLeadNear(final.notes as never, expected.notes as never); // safety resolver may choose comp-aware neighboring tones.
    });
  }
});
