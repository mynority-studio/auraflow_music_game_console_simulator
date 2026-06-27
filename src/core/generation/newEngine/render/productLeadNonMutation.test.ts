// ============================================================
// newEngine · render · Loop 9 验收 — audit 只读 + retry 后 lead 仍 exact(strict parity 不被破坏)
// ------------------------------------------------------------
// musicgenerative_strict_newengine_migration_directive.md Loop 9:
//   动作:audit 只产 finding · retry budget 在 Controller 消费 · audit 不改 lead · audit 不直接写 MIDI。
//   验收:audit 前后 MusicalIR 不变 · retry 后 lead 仍 exact。终止:audit 不破坏 strict parity。
// ★ 结构性事实(本测试锁):① lead = renderMgMelody(plan, band, tb, songSeed),只依赖 song seed;
//   retry 的 rng.advance() 保持 seed 不变(randomContext.advance 只推子流 count)→ lead 跨重跑恒等。
//   ② 终 IR = freezeMusicalIR(深冻结);两审计在冻结 IR 上跑 → 改写即抛 → 只读由结构强制。
// ============================================================

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
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { auditMusicality } from './musicalityAuditor';
import { auditHarmony } from './readOnlyHarmonyAuditor';
import { runGenerationControl, type RenderFn } from '../generation/GenerationController';
import { buildRetryLocator } from '../generation/retryMapping';
import { DEFAULT_BUDGET } from '../generation/RetryPolicy';
import { createTimebase, createRandomContext, beats } from '../foundation';
import type { MusicalIR } from '../ir/MusicalIR';
import type { AuditFinding } from '../ir/AuditReport';

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

const MATRIX: [number, string][] = [[7, 'lofi'], [396040, 'pop'], [777870, 'rnb'], [633823, 'pop'], [3, 'jazz'], [64062, 'lofi'], [100, 'rnb'], [999, 'jazz']];

describe('Loop 9 — audit 只读 · retry 后 lead exact', () => {
  // ① production lead === raw MG lead 经 repeatGroup 重放(audit/swing/dynamics/humanize/ending 全不改 lead;
  //   ★ 2026-06-11:lead 仅多一道 repeatGroup 重放 —— 首次出现==MG,重复出现==首次重放,lead 不 humanize → 逐字节相等)。
  for (const [seed, style] of MATRIX) {
    it(`${seed}/${style}: production lead 事件级 === replay(raw MG lead)`, () => {
      const { band, arr, instr, plan, tb } = setup(seed, style);
      const raw = renderMgMelody(plan, band, tb, seed, instr.roleProgram?.lead, arr.songGrooveContract);
      const replayed = applyRepeatGroupReplay(fillLeadBarGaps([raw], plan.chordTimeline, tb, beatsPerBarOf(arr.meter)), arr, plan.chordTimeline, tb)[0];
      // ★ Phase D(directive 3.2,推翻零洗牌):真 GrooveContract 的 ms melody-pocket 由 applyGroovePocket 在
      //   humanizeTiming(lead 本就跳)之后落地 → lead onset lay-back。legacy pocket=0 时 no-op(零洗牌兼容)。
      const pocketed = applyGroovePocket([replayed], arr.songGrooveContract, arr.tempoBpm, tb.ppq, beatsPerBarOf(arr.meter))[0];
      // 末端安全闸(sanitize → (jazz/blues)legato → sanitize;directive q_n_final_lead_sanitizer 2026-06-23):
      //   sanitize 只裁同 pitch collision(无重叠=no-op),legato 只改 duration → 多数 seed 仍逐字节相等。
      const lo = fastLeadLegatoOptionsForStyle(band.style, tb.ppq);
      const preSan = { ...pocketed, notes: sanitizeLeadNoteIR(pocketed.notes, SAN) };
      const legato = lo.enabled ? { ...preSan, notes: connectFastLeadNoteIR(preSan.notes, lo) } : preSan;
      const expected = { ...legato, notes: sanitizeLeadNoteIR(legato.notes, SAN) };
      const final = leadOf(renderSongFull(band, arr, plan, instr, tb, createRandomContext(seed)).ir);
      expect(final.notes.length, `${seed}/${style} lead count`).toBe(expected.notes.length);
      expect(ev(final.notes as never), `${seed}/${style} lead events`).toBe(ev(expected.notes as never));
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
    const pocketedExp = applyGroovePocket([replayedExp], arr.songGrooveContract, arr.tempoBpm, tb.ppq, beatsPerBarOf(arr.meter))[0]; // ★ Phase D:真 contract 的 melody-pocket lay-back
    const expected = { ...pocketedExp, notes: sanitizeLeadNoteIR(pocketedExp.notes, SAN) }; // pop 无 legato → 末端安全闸 = 一道 sanitize
    expect(ev(leadOf(result.ir!).notes as never), 'retry 后 lead == sanitize(fill(replay(raw MG)))').toBe(ev(expected.notes as never));
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
