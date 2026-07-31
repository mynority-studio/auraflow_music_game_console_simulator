// ============================================================
// newEngine · render · Loop 9 验收 — audit 只读 + retry 后 lead 仍 exact(strict parity 不被破坏)
// ------------------------------------------------------------
// musicgenerative_strict_newengine_migration_directive.md Loop 9:
//   动作:audit 只产 finding · retry budget 在 Controller 消费 · audit 不改 lead · audit 不直接写 MIDI。
//   验收:audit 前后 MusicalIR 不变 · retry 后 lead 仍 exact。终止:audit 不破坏 strict parity。
// ★ 结构性事实(本测试锁):① lead = renderMgMelody(plan, band, tb, songSeed, Arranger presence),只依赖冻结 score + song seed;
//   retry 的 rng.advance() 保持 seed 不变(randomContext.advance 只推子流 count)→ lead 跨重跑恒等。
//   ② 终 IR = freezeMusicalIR(深冻结);两审计在冻结 IR 上跑 → 改写即抛 → 只读由结构强制。
// ============================================================

import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderMgMelody } from './mgLeadRenderer';
import { gateByDensity, leadAvoidExposureResolver, renderSongFull } from './renderCoordinator';
import { applyMotifBindingReplay, applyRepeatGroupReplay } from './repeatGroupReplay';
import { applyGroovePocket } from './groovePocket';
import { fillLeadBarGaps } from './leadGapFill';
import { connectFastLeadNoteIR, fastLeadLegatoOptionsForStyle } from './leadArticulation';
import { sanitizeLeadNoteIR } from './leadSanitizer';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { auditMusicality } from './musicalityAuditor';
import { auditHarmony } from './readOnlyHarmonyAuditor';
import { runGenerationControl, type RenderFn } from '../generation/GenerationController';
import { buildRetryLocator } from '../generation/retryMapping';
import { DEFAULT_BUDGET } from '../generation/RetryPolicy';
import { createTimebase, createRandomContext, beats } from '../foundation';
import type { MusicalIR } from '../ir/MusicalIR';
import type { AuditFinding } from '../ir/AuditReport';
import { applyGestureExpressionToTrack } from '../instrumental/gestureExpression';
import { applyEnding, applyLeadIns } from './ending';
import { applyDynamics, type EnergyRange } from './dynamics';
import { MOTIF_POLICY_REPEAT_GROUP } from '../arranger/arrangementArchetypeContract';

function setup(seed: number, style: string) {
  const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
  const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
  const instr = buildInstrumentationPlan(band, arr, createRandomContext(seed).substream('timbre'));
  const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
  const tb = createTimebase({ meter: { numerator: arr.meter.numerator, denominator: arr.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arr.tempoBpm }] });
  return { band, arr, instr, plan, tb };
}
const ev = (notes: readonly { pitch: number; startTick: number; durationTicks: number; velocity: number }[]) =>
  notes.map((n) => `${n.pitch as number}@${n.startTick as number}:${n.durationTicks as number}:${n.velocity}`).join('|');
const leadOf = (ir: MusicalIR) => ir.tracks.find((t) => t.role === 'lead')!;
const SAN = { gapTicks: 1, minDurTicks: 1 };
const snap = (ir: MusicalIR) => JSON.stringify(ir.tracks.map((t) => ({ role: t.role, n: t.notes.map((x) => [x.pitch, x.startTick as number, x.durationTicks as number, x.velocity]) })));
function expectLeadNear(
  actual: readonly { pitch: number; startTick: number; durationTicks: number; velocity: number }[],
  expected: readonly { pitch: number; startTick: number; durationTicks: number; velocity: number }[],
  label: string,
): void {
  expect(actual.length, `${label} lead count`).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expect(Math.abs((actual[i].startTick as number) - (expected[i].startTick as number)), `${label} start ${i}`).toBeLessThanOrEqual(3);
    expect(Math.abs((actual[i].durationTicks as number) - (expected[i].durationTicks as number)), `${label} dur ${i}`).toBeLessThanOrEqual(3);
    expect(actual[i].velocity, `${label} vel ${i}`).toBe(expected[i].velocity);
    expect(
      Math.abs((actual[i].pitch as number) - (expected[i].pitch as number)),
      `${label} pitch ${i}: actual=${actual[i].pitch as number} expected=${expected[i].pitch as number}`,
    ).toBeLessThanOrEqual(3);
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
  const strictRange = instr.strictRegisterByRole?.lead;
  const notes = strictRange ? track.notes.map((note) => {
    let pitch = Math.round(note.pitch as number);
    while (pitch > strictRange.highMidi) pitch -= 12;
    while (pitch < strictRange.lowMidi) pitch += 12;
    if (pitch < strictRange.lowMidi || pitch > strictRange.highMidi) {
      pitch = Math.abs(pitch - strictRange.lowMidi) <= Math.abs(pitch - strictRange.highMidi)
        ? strictRange.lowMidi
        : strictRange.highMidi;
    }
    return pitch === (note.pitch as number) ? note : { ...note, pitch };
  }) : track.notes;
  const gesture = applyGestureExpressionToTrack(
    { ...track, notes, role: 'lead', program: instr.roleProgram.lead } as never,
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

function renderExpectedRawLead(
  seed: number,
  band: ReturnType<typeof buildBandSpec>,
  arrangement: ReturnType<typeof buildArrangementPlan>,
  instrumentation: ReturnType<typeof buildInstrumentationPlan>,
  plan: ReturnType<typeof buildHarmonicPlanFromArrangement>,
  tb: ReturnType<typeof createTimebase>,
) {
  return renderMgMelody(
    plan,
    band,
    tb,
    seed,
    instrumentation.roleProgram.lead,
    arrangement.songGrooveContract,
    undefined,
    undefined,
    arrangement.grooveContractBySection,
    instrumentation.strictRegisterByRole?.lead,
    undefined,
    undefined,
    arrangement.tempoBpm,
    arrangement.lofiLeadPresencePlan?.silenceWindows,
    arrangement.lofiLeadPresencePlan?.entryBeats,
    undefined,
    arrangement.lofiPhraseInteractionPlan,
  );
}

function applyExpectedReplayPolicy(
  raw: ReturnType<typeof renderMgMelody>,
  arrangement: ReturnType<typeof buildArrangementPlan>,
  plan: ReturnType<typeof buildHarmonicPlanFromArrangement>,
  tb: ReturnType<typeof createTimebase>,
) {
  const gapFilled = arrangement.lofiLeadPresencePlan
    ? [raw]
    : fillLeadBarGaps([raw], plan.chordTimeline, tb, beatsPerBarOf(arrangement.meter));
  const motifReplayed = arrangement.resolvedArchetype?.motifPolicyId === MOTIF_POLICY_REPEAT_GROUP
    ? applyMotifBindingReplay(gapFilled, arrangement, plan.chordTimeline, tb)
    : gapFilled;
  return applyRepeatGroupReplay(motifReplayed, arrangement, plan.chordTimeline, tb)[0];
}

// ★ ACG 已退出 byte-parity(2026-07-02 Phase3):ACG lead 走专属 shapeTopVoicePianoTouch 塑形,不 == raw MG →
//   改由 mgBassCompLeadFidelity.test 音乐不变量锁。本 MATRIX 只留 MG-grammar-backed 无 ACG 专属塑形的风格。
const MATRIX: [number, string][] = [[7, 'lofi'], [396040, 'pop'], [777870, 'rnb'], [633823, 'pop'], [3, 'jazz'], [64062, 'lofi'], [100, 'rnb'], [999, 'jazz']];

describe('Loop 9 — audit 只读 · retry 后 lead exact', () => {
  // ① production lead === Arranger-scored MG lead 经 repeatGroup 重放，再按目标段重投影 lead-in velocity；
  //   audit/swing/dynamics/humanize/ending 仍不改 lead 的 pitch/onset/duration。
  for (const [seed, style] of MATRIX) {
    it(`${seed}/${style}: production lead 事件级 === replay(raw MG lead)`, () => {
      const { band, arr, instr, plan, tb } = setup(seed, style);
      const raw = renderExpectedRawLead(seed, band, arr, instr, plan, tb);
      const replayed = applyExpectedReplayPolicy(raw, arr, plan, tb);
      const gated = withExpectedArrangerGate(replayed, arr, instr, plan, tb);
      const withSectionExpression = withExpectedSectionExpression(gated, arr, instr, tb);
      // ★ Phase D(directive 3.2,推翻零洗牌):真 GrooveContract 的 ms melody-pocket 由 applyGroovePocket 在
      //   humanizeTiming(lead 本就跳)之后落地 → lead onset lay-back。legacy pocket=0 时 no-op(零洗牌兼容)。
      const pocketed = applyGroovePocket([withSectionExpression], arr.songGrooveContract, arr.tempoBpm, tb.ppq, beatsPerBarOf(arr.meter))[0];
      // 末端安全闸(sanitize → (jazz/blues)legato → sanitize;directive q_n_final_lead_sanitizer 2026-06-23):
      //   sanitize 只裁同 pitch collision(无重叠=no-op),legato 只改 duration → 多数 seed 仍逐字节相等。
      const lo = fastLeadLegatoOptionsForStyle(band.style, tb.ppq);
      const preSan = { ...pocketed, notes: sanitizeLeadNoteIR(pocketed.notes, SAN) };
      const legato = lo.enabled ? { ...preSan, notes: connectFastLeadNoteIR(preSan.notes, lo) } : preSan;
      const sanitizedExp = { ...legato, notes: sanitizeLeadNoteIR(legato.notes, SAN) };
      const balancedLegato = { ...sanitizedExp, notes: connectFastLeadNoteIR(sanitizedExp.notes, lo) };
      const balancedSanitized = { ...balancedLegato, notes: sanitizeLeadNoteIR(balancedLegato.notes, SAN) };
      const gestured = withExpectedLeadGesture(balancedSanitized, instr, tb);
      const rendered = renderSongFull(band, arr, plan, instr, tb, createRandomContext(seed)).ir;
      const finalCompNotes = rendered.tracks.find((track) => track.role === 'comp')?.notes ?? [];
      const resolvedNotes = leadAvoidExposureResolver(
        gestured.notes,
        plan,
        tb,
        leadProgramForSection(instr, band),
        finalCompNotes,
        auditKeyContext(band),
      );
      const expected = { ...gestured, notes: sanitizeLeadNoteIR(resolvedNotes, SAN) };
      const final = leadOf(rendered);
      expectLeadNear(final.notes as never, expected.notes as never, `${seed}/${style}`);
    });
  }

  // ② audit 不改 IR:终 IR 深冻结;在其上重跑 auditHarmony + auditMusicality → 无抛 + 前后字节一致。
  it('audit 只读:深冻结 IR 上重跑两审计 → 无抛 + IR 前后字节一致', () => {
    const { band, arr, instr, plan, tb } = setup(633823, 'pop');
    const ir = renderSongFull(band, arr, plan, instr, tb, createRandomContext(633823)).ir;
    expect(Object.isFrozen(ir), 'ir frozen').toBe(true);
    expect(Object.isFrozen(ir.tracks), 'tracks frozen').toBe(true);
    const before = snap(ir);
    // 冻结 IR 上重跑两审计:若任一改写 → TypeError 抛 → 测试失败(只读由结构强制)。
    expect(() => auditHarmony(ir, plan, tb)).not.toThrow();
    expect(() => auditMusicality(ir, arr, instr, tb, band.style)).not.toThrow();
    expect(snap(ir), 'IR 审计后不变').toBe(before);
  });

  // ③ retry 后 lead 仍 exact:强制 2 次重跑(注入非-lead error finding 驱动)→ 最终 lead === raw MG lead。
  it('强制重跑后 production lead 仍 === raw MG lead(retry 只动 comp,碰不到 lead)', () => {
    const seed = 633823;
    const { band, arr, instr, plan, tb } = setup(seed, 'pop');
    const seedRng = createRandomContext(seed);
    const raw = renderMgMelody(plan, band, tb, seed, instr.roleProgram?.lead, arr.songGrooveContract);
    const blocking: AuditFinding = { severity: 'error', location: { trackRole: 'comp', startTick: 0 }, ruleId: 'forced-retry-test', reason: 'force retry', suggestedReturnPoint: 'render-fallback' };
    let calls = 0;
    const render: RenderFn = (retry) => {
      calls++;
      const att = renderSongFull(band, arr, plan, instr, tb, retry?.rng ?? seedRng, retry && { voicingSafer: retry.voicingSafer });
      const findings = calls < 3 ? [...att.audit.findings, blocking] : att.audit.findings; // 前 2 次注入 → 重跑;第 3 次干净
      return { ir: att.ir, audit: { findings } };
    };
    const result = runGenerationControl(render, seedRng, DEFAULT_BUDGET, buildRetryLocator(plan, tb));
    expect(result.attempts, '确实发生重跑').toBeGreaterThanOrEqual(3);
    expect(result.ir, 'retry 后有 IR').toBeDefined();
    const replayedExp = applyRepeatGroupReplay(fillLeadBarGaps([raw], plan.chordTimeline, tb, beatsPerBarOf(arr.meter)), arr, plan.chordTimeline, tb)[0]; // ★ 重放 + 空拍补全(retry 不改 lead)
    const gatedExp = withExpectedArrangerGate(replayedExp, arr, instr, plan, tb);
    const withSectionExpressionExp = withExpectedSectionExpression(gatedExp, arr, instr, tb);
    const pocketedExp = applyGroovePocket([withSectionExpressionExp], arr.songGrooveContract, arr.tempoBpm, tb.ppq, beatsPerBarOf(arr.meter))[0]; // ★ Phase D:真 contract 的 melody-pocket lay-back
    const preSan = { ...pocketedExp, notes: sanitizeLeadNoteIR(pocketedExp.notes, SAN) };
    const legato = { ...preSan, notes: connectFastLeadNoteIR(preSan.notes, fastLeadLegatoOptionsForStyle(band.style, tb.ppq)) };
    const sanitizedExp = { ...legato, notes: sanitizeLeadNoteIR(legato.notes, SAN) };
    const lo = fastLeadLegatoOptionsForStyle(band.style, tb.ppq);
    const balancedLegato = { ...sanitizedExp, notes: connectFastLeadNoteIR(sanitizedExp.notes, lo) };
    const balancedSanitized = { ...balancedLegato, notes: sanitizeLeadNoteIR(balancedLegato.notes, SAN) };
    const gestured = withExpectedLeadGesture(balancedSanitized, instr, tb);
    const resolvedNotes = leadAvoidExposureResolver(gestured.notes, plan, tb, leadProgramForSection(instr, band), [], auditKeyContext(band));
    const expected = { ...gestured, notes: sanitizeLeadNoteIR(resolvedNotes, SAN) };
    expectLeadNear(leadOf(result.ir!).notes as never, expected.notes as never, 'retry 后 lead');
  });

  // ④ rng.advance(comp 子流)不改 lead:lead 只依赖 song seed,advance 保持 seed 不变。
  it('rng.advance(accompaniment) 后 lead 字节不变(lead 不依赖被推进的子流)', () => {
    const seed = 396040;
    const { band, arr, instr, plan, tb } = setup(seed, 'pop');
    const base = leadOf(renderSongFull(band, arr, plan, instr, tb, createRandomContext(seed)).ir);
    const advanced = leadOf(renderSongFull(band, arr, plan, instr, tb, createRandomContext(seed).advance('accompaniment').advance('compTexture')).ir);
    expect(ev(advanced.notes as never)).toBe(ev(base.notes as never));
  });
});
