// ============================================================
// export-afe-instrumentation —— P2-7 步e：v5 InstrumentationPlan golden（一次性转录，入仓即产权）
// ------------------------------------------------------------
// 直调生产链 buildBandSpec → buildArrangementPlan → buildHarmonicPlanFromArrangement →
// buildInstrumentationPlan（同 GenerationController.ts:204-220 序，单 ctx 贯穿；
// substream 'timbre'/'acgPianoVoice' 与生产逐字相同）。
// palette 侧别 = 构建默认 ACTIVE_DREAM_ORCHESTRATION_PALETTE（fail-closed 断言）：
//   vitest.export.config.ts → full-modern-gm → afe_instrumentation_golden_fm.json
//   vitest.acoustic-export.config.ts → acoustic-debug → afe_instrumentation_golden_acoustic.json
// motif 第二调用点：buildMotifSongBundle 例断言 instrumentation 与直调逐位一致（引用相等由
// P2-6 已证；此处对 plan 深比较）。投影 = 设计 §3.1 冻结字段集（D10 裁剪后）；
// 枚举一律导出字符串名（JSON→H 转换器独立解析 lock/C 头换算——非自证）。
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { buildBandSpec, withBandMode } from '../src/core/generation/newEngine/band/bandEngine';
import { buildArrangementPlan } from '../src/core/generation/newEngine/arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../src/core/generation/newEngine/harmony/harmonyEngine';
import { buildInstrumentationPlan } from '../src/core/generation/newEngine/instrumental/instrumentalPlanner';
import { ACTIVE_DREAM_ORCHESTRATION_PALETTE } from '../src/core/generation/newEngine/instrumental/acousticDebugPalette';
import { buildMotifSongBundle } from '../src/core/generation/newEngine/generation/generateSongFromMotif';
import { createRandomContext } from '../src/core/generation/newEngine/foundation/randomContext';
import type { InstrumentationPlan } from '../src/core/generation/newEngine/instrumental/InstrumentationPlan';
import type { InstrumentRoleName } from '../src/core/generation/newEngine/band/BandSpec';

const HERE = dirname(fileURLToPath(import.meta.url));
const PALETTE = ACTIVE_DREAM_ORCHESTRATION_PALETTE;
if (PALETTE !== 'full-modern-gm' && PALETTE !== 'acoustic-debug') throw new Error(`未知 palette ${PALETTE}`);
const SIDE = PALETTE === 'full-modern-gm' ? 'fm' : 'acoustic';
const OUT = join(HERE, '..', '..', 'core', 'tests', 'golden', `afe_instrumentation_golden_${SIDE}.json`);
const SCHEMA_VERSION = 'instrumentation_golden_v1';

const ROLES: readonly InstrumentRoleName[] = ['bass', 'comp', 'pad', 'lead', 'drum'];  // afe_role_t 序
const roleBit = (r: InstrumentRoleName): number => 1 << ROLES.indexOf(r);
const die = (m: string): never => { throw new Error(`export-afe-instrumentation FAIL-CLOSED: ${m}`); };
const asInt = (x: number, path: string): number => {
  if (!Number.isInteger(x)) die(`${path} 非整数: ${x}`);
  return x;
};
const milli = (x: number): number => Math.round(x * 1000);

interface Fx {
  name: string; styleHint: string; seed: number; mood?: string; targetDuration?: number;
  allowModulation?: boolean; jazzArchetypeId?: string;
  motifBypassCheck?: boolean;   /* 经 buildMotifSongBundle 断言第二调用点逐位 */
  why: string;
}

// 桶：判别力优先（设计 §7.2）。覆盖统计文末机器断言。
const FIXTURES: readonly Fx[] = [
  { name: 'pop_a', styleHint: 'pop', seed: 11, why: 'pop 基线（cityPop ensemble 分派+DARC 弧）' },
  { name: 'pop_b_dur', styleHint: 'pop', seed: 12, targetDuration: 95, why: 'pop + duration（段数变化→transition/ending）' },
  { name: 'rock_default', styleHint: 'rock', seed: 13, why: '未知 styleHint → default（legacy chain 路径+非 rich 风格跳过）' },
  { name: 'jazz_a', styleHint: 'jazz', seed: 21, why: 'jazz（trio/sax 分派+brush kit+walking gesture）' },
  { name: 'jazz_b', styleHint: 'jazz', seed: 27, why: 'jazz 第二 seed' },
  { name: 'lofi_a', styleHint: 'lofi', seed: 31, why: 'lofi（boomBap ensemble+muted bass gesture）' },
  { name: 'lofi_b', styleHint: 'lofi', seed: 35, why: 'lofi 第二 seed（verse variation 高概率）' },
  { name: 'rnb_a', styleHint: 'rnb', seed: 41, why: 'rnb（rnbPocket+ghosted）' },
  { name: 'rnb_b_dur', styleHint: 'rnb', seed: 44, targetDuration: 150, why: 'rnb + duration' },
  { name: 'acg_a', styleHint: 'acg', seed: 51, why: 'acg（整首钢琴子流+shared pedal+统一 mix）' },
  { name: 'acg_b', styleHint: 'acg', seed: 55, why: 'acg 第二 seed（钢琴权重轮盘另一臂）' },
  { name: 'modal_a', styleHint: 'modal', seed: 61, why: 'modal（非干声 mix 域+rich 跳过+DARC 无行→ALL）' },
  { name: 'modal_b', styleHint: 'modal', seed: 66, why: 'modal 第二 seed（syntheticSoft world 分派）' },
  { name: 'pop_switch_scan', styleHint: 'pop', seed: 77, why: 'timbre 切换判别（seed 扫描定向）' },
  { name: 'jazz54_solo', styleHint: 'jazz', seed: 81, jazzArchetypeId: 'jazz_5_4_modern_piano', why: 'resolved ensemble solo piano（registerByRole 硬音区+ensemble-locked）' },
  { name: 'jazz54_quartet', styleHint: 'jazz', seed: 82, jazzArchetypeId: 'jazz_5_4_reference_quartet', why: 'resolved quartet（alto lead+独立四人）' },
  { name: 'motif_pop', styleHint: 'pop', seed: 91, motifBypassCheck: true, why: 'motif 第二调用点逐位' },
  { name: 'motif_acg', styleHint: 'acg', seed: 95, motifBypassCheck: true, why: 'motif × acg（acgPianoVoice 子流经第二调用点）' },
  { name: 'pop_dur_long', styleHint: 'pop', seed: 14, targetDuration: 180, why: '多段（boundaries 满+fade 域）' },
  { name: 'lofi_dur_short', styleHint: 'lofi', seed: 36, targetDuration: 45, why: '短曲（无 intro→staged-first-bar 域）' },
];

function projGesture(g: InstrumentationPlan['gestureExpressionByRole'][InstrumentRoleName]) {
  return {
    kind: g.kind, family: g.family, continuity: g.continuity, articulationScope: g.articulationScope,
    articulationExclusionGroup: g.articulationExclusionGroup, triggerPolicy: g.triggerPolicy,
    phrasePolicy: g.phrasePolicy, breathModel: g.breathModel, noteShape: g.noteShape,
    articulation: g.articulation, velocityCurve: g.velocityCurve, pedalPolicy: g.pedalPolicy,
    rudimentPolicy: g.rudimentPolicy, hiHatPolicy: g.hiHatPolicy,
    cc: [...g.ccControllers], bassTech: g.bassTechniques ? [...g.bassTechniques] : null,
    gateMilli: g.gateRatio === undefined ? null : milli(g.gateRatio),
    maxConnectMilli: g.maxConnectBeats === undefined ? null : milli(g.maxConnectBeats),
    overlapMilli: g.overlapBeats === undefined ? null : milli(g.overlapBeats),
    tail: g.tailPolicy ?? null, program: g.program ?? null,
  };
}

function project(fx: Fx, plan: InstrumentationPlan, sectionIds: readonly string[], phraseIds: readonly string[]) {
  const secIdx = (id: string): number => {
    const i = sectionIds.indexOf(id);
    if (i < 0) die(`${fx.name}: 未知 section id ${id}`);
    return i;
  };
  const activeMask = sectionIds.map((sid) =>
    (plan.activeRolesBySection[sid] ?? []).reduce((m, r) => m | roleBit(r), 0));
  const disabledProj = (d: Partial<Record<string, string>>) =>
    sectionIds.map((sid) => d[sid] ?? null);
  return {
    name: fx.name,
    request: { styleHint: fx.styleHint, seed: fx.seed, mood: fx.mood ?? null,
      targetDuration: fx.targetDuration ?? null, allowModulation: fx.allowModulation ?? null,
      jazzArchetypeId: fx.jazzArchetypeId ?? null },
    nSections: sectionIds.length,
    activeMask,
    registerByRole: ROLES.map((r) => [plan.registerByRole[r].lowMidi, plan.registerByRole[r].highMidi]),
    strictRegister: plan.strictRegisterByRole
      ? ROLES.map((r) => plan.strictRegisterByRole![r]
          ? [plan.strictRegisterByRole![r]!.lowMidi, plan.strictRegisterByRole![r]!.highMidi] : null)
      : null,
    textureBySection: sectionIds.map((sid) => plan.textureBySection[sid]),
    richTextureBySection: sectionIds.map((sid) => plan.richTextureBySection[sid] ?? null),
    richSwitch: sectionIds.map((sid) => {
      const sw = plan.richTextureSwitchBySection[sid];
      if (!sw) return null;
      if (sw.atFraction !== 0.5) die(`${fx.name}: atFraction ≠ 0.5`);
      return sw.toTexture;
    }),
    programByRoleSection: ROLES.map((r) => sectionIds.map((sid) => plan.programByRoleSection[r]?.[sid] ?? null)),
    bankByRoleSection: ROLES.map((r) => sectionIds.map((sid) => {
      const b = plan.bankByRoleSection[r]?.[sid];
      return b === undefined ? null : b;
    })),
    roleProgram: ROLES.map((r) => plan.roleProgram[r] ?? null),
    roleBank: ROLES.map((r) => plan.roleBank[r] ?? null),
    mix: ROLES.map((r) => sectionIds.map((sid) => {
      const m = plan.mixByRoleSection[r]?.[sid];
      if (!m) return null;
      if ((m as { delay?: number }).delay !== undefined) die('delay 意外产出');
      if ((m as { expression?: number }).expression !== undefined) die('expression 意外产出');
      return [m.volume, m.pan, m.reverb, m.chorus];
    })),
    gesture: ROLES.map((r) => projGesture(plan.gestureExpressionByRole[r])),
    pedal: ROLES.map((r) => {
      const p = plan.pedalPlanByRole[r];
      if (!p) return null;
      return {
        shared: p.playerGroup === 'shared-piano',
        events: p.events.map((e) => [asInt(e.atBeat, 'pedal.atBeat'), e.down ? 1 : 0, secIdx(e.sectionId), e.reason]),
        disabled: disabledProj(p.disabledBySection),
      };
    }),
    controller: ROLES.map((r) => {
      const c = plan.controllerPlanByRole[r];
      if (!c) return null;
      return {
        events: c.events.map((e) => [asInt(e.atBeat, 'ctrl.atBeat'), e.controller, e.value, secIdx(e.sectionId), e.reason]),
        disabled: disabledProj(c.disabledBySection),
      };
    }),
    drumBySection: sectionIds.map((sid) =>
      (plan.drumPatternBySection[sid] ?? []).map((h) => [h.drum, milli(h.beat), h.vel])),
    drumBySectionBar: sectionIds.map((sid) =>
      (plan.drumPatternBySectionBar[sid] ?? []).map((bar) => bar.map((h) => [h.drum, milli(h.beat), h.vel]))),
    samePairs: plan.sameInstrumentPairs
      ? plan.sameInstrumentPairs.map((p) => [ROLES.indexOf(p.a), ROLES.indexOf(p.b), p.program]) : null,
    reservation: {
      lo: plan.melodyReservationPlan.reservedRegister.lowMidi,
      hi: plan.melodyReservationPlan.reservedRegister.highMidi,
      densityCeilingMilli: milli(plan.melodyReservationPlan.densityCeiling),
      hooks: plan.melodyReservationPlan.hookAnchorSlots.map((h) => {
        if (h.segment !== 'head') die('hook.segment ≠ head');
        const pi = phraseIds.indexOf(h.phraseId);
        if (pi < 0) die(`未知 phrase id ${h.phraseId}`);
        return [pi, asInt(h.beatSlot, 'hook.beatSlot'), h.anchorRequired ? 1 : 0, milli(h.maxAccompanimentDensity)];
      }),
    },
    ending: {
      style: plan.endingPlan.style,
      outroIdx: plan.endingPlan.outroSectionId === null ? null : secIdx(plan.endingPlan.outroSectionId),
      outroBars: plan.endingPlan.outroBars,
      exitBar: ROLES.map((r) => plan.endingPlan.exitBarByRole[r] ?? null),
      hold: plan.endingPlan.holdFinalChord ? 1 : 0, fade: plan.endingPlan.fadeOut ? 1 : 0,
      cold: plan.endingPlan.coldStop ? 1 : 0,
      sustainMask: (plan.endingPlan.sustainRoles ?? []).reduce((m, r) => m | roleBit(r), 0),
      protectLead: plan.endingPlan.protectLeadTiming === true ? 1 : die('protectLeadTiming ≠ true'),
    },
    transition: {
      boundaries: plan.transitionPlan.boundaries.map((b) => ({
        from: secIdx(b.fromSectionId), to: secIdx(b.toSectionId),
        boundaryBar: b.boundaryBar, prepBar: b.prepBar, entry: b.entry,
        pickupMask: b.pickupRoles.reduce((m, r) => m | roleBit(r), 0),
        releaseMask: b.releaseRoles.reduce((m, r) => m | roleBit(r), 0),
        anchorMask: b.downbeatAnchorRoles.reduce((m, r) => m | roleBit(r), 0),
        protect: b.protectPickupFromGate ? 1 : 0,
      })),
      songEntry: {
        firstIdx: secIdx(plan.transitionPlan.songEntry.firstSectionId),
        hasIntro: plan.transitionPlan.songEntry.hasIntro ? 1 : 0,
        mode: plan.transitionPlan.songEntry.mode,
        anchorMask: plan.transitionPlan.songEntry.downbeatAnchorRoles.reduce((m, r) => m | roleBit(r), 0),
        delayedMask: plan.transitionPlan.songEntry.delayedRoles.reduce((m, r) => m | roleBit(r), 0),
      },
    },
    needsAnchorMask: sectionIds.reduce((m, sid, i) =>
      m | (plan.needsDownbeatCompAnchorBySection[sid] ? 1 << i : 0), 0),
  };
}

describe(`export-afe-instrumentation (${SIDE})`, () => {
  it('exports v5 instrumentation golden', () => {
    const cases: unknown[] = [];
    const stats = { styles: new Set<string>(), richSwitch: 0, timbreSwitch: 0, resolved: 0, motif: 0 };
    for (const fx of FIXTURES) {
      const band0 = buildBandSpec({ seed: fx.seed, styleHint: fx.styleHint,
        allowModulation: fx.allowModulation } as never);
      const ctx = createRandomContext(fx.seed);
      const arrangement = buildArrangementPlan(band0, {
        rng: ctx, mood: fx.mood, targetDuration: fx.targetDuration,
        jazzArchetypeId: fx.jazzArchetypeId as never,
      });
      const authoredMode = arrangement.resolvedArchetype?.tonalityMode;
      const band = authoredMode ? withBandMode(band0, authoredMode) : band0;   /* P2-5d seam */
      const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, ctx);
      const plan = buildInstrumentationPlan(band, arrangement, ctx.substream('timbre'), harmonic,
        ctx.substream('acgPianoVoice'), PALETTE);
      const request = { styleHint: fx.styleHint, seed: fx.seed, mood: fx.mood ?? undefined,
        targetDuration: fx.targetDuration, allowModulation: fx.allowModulation,
        jazzArchetypeId: fx.jazzArchetypeId } as never;
      const sectionIds = arrangement.sections.map((s) => s.id);
      const phraseIds = arrangement.phrases.map((p) => p.id);
      const proj = project(fx, plan, sectionIds, phraseIds);
      if (fx.motifBypassCheck) {
        const out2 = buildMotifSongBundle(request as never);
        // 第二调用点：palette 由构建默认承载（bundle 内不传 palette）→ 与直调同 palette 前提下逐位。
        const proj2 = project(fx, out2.bundle.instrumentation,
          out2.bundle.arrangement.sections.map((s) => s.id), out2.bundle.arrangement.phrases.map((p) => p.id));
        expect(JSON.stringify({ ...proj2, name: proj.name })).toBe(JSON.stringify(proj));
        stats.motif++;
      }
      stats.styles.add(band.style);
      if (Object.keys(plan.richTextureSwitchBySection).length) stats.richSwitch++;
      if (arrangement.resolvedArchetype) stats.resolved++;
      cases.push(proj);
    }
    // 覆盖机器断言（判别面在场证明）
    if (stats.styles.size < 6) die(`风格覆盖不足: ${[...stats.styles].join(',')}`);
    if (SIDE === 'fm' && stats.richSwitch < 1) die('无 verse-variation 命中例');
    if (stats.resolved < 2) die('resolved archetype 例不足');
    if (stats.motif !== 2) die('motif 例 ≠ 2');
    const payload = { schema: SCHEMA_VERSION, palette: PALETTE, roleOrder: ROLES, cases };
    const json = JSON.stringify(payload, null, 1) + '\n';
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, json.replace('"schema"', `"payloadSha256": "${createHash('sha256').update(json).digest('hex')}",\n "schema"`));
    expect(cases.length).toBe(FIXTURES.length);
  });
});
