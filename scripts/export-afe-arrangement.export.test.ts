// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-arrangement — buildArrangementPlan 逐位对账 golden exporter（P2-5c 步c 收尾）
// ------------------------------------------------------------
// P2-5 步c 第三批已落地 C 主体 `afe_plan_arrangement`（core/src/arranger/afe_arrange.c）。
// 本 exporter 直调**生产** buildArrangementPlan（零触碰 src/），把 (输入, 期望 plan) 成对投影成
// core/tests/golden/afe_arrangement_golden.json，由 core 侧转换器 gen_arrangement_golden.py
// 生成 C golden .h（对锁 afe_arrange.h 的 ABI），供 C 侧逐字段对账 + 独立重算 digest。
//
// ★ **枚举一律输出 TS 原始字面量字符串，本文件不写任何 枚举名→数值 映射表**
//   （CLAUDE.md 头号坑：把自己写的表当真源）。字符串→C 枚举值的换算集中在转换器，
//   由它解析 `p2org_enums.lock.json` 与 C 头完成，两侧独立。
//
// ★ **band 不在对账面内**：fixture 用生产 `buildBandSpec` 产出真实 band，但只把
//   `instrumentPool`（lineup）导进 golden 作 C 侧输入；buildBandSpec 自身的正确性归 P2-3，
//   本靶不重复对账（否则 band 一变本靶就红，归因错位）。
//
// ★ 覆盖缺口两类记账（见 meta.coverageGaps）：**不可达** = 生产域无路径，不伪造；
//   **延后** = 可达但按任务边界归其它靶。ACG 属后者（曲式 owner=P2-11，C 侧 fail-closed）。
//
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-arrangement.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { buildBandSpec, withBandMode } from '../src/core/generation/newEngine/band/bandEngine';
import { buildArrangementPlan } from '../src/core/generation/newEngine/arranger/arranger';
import { createRandomContext } from '../src/core/generation/newEngine/foundation/randomContext';
import {
  planJazzArrangementArchetype,
} from '../src/core/generation/newEngine/arranger/jazzArchetypePlanner';
import {
  sectionPolicyForArchetype,
} from '../src/core/generation/newEngine/arranger/arrangementArchetypeContract';
import type { BandSpec, InstrumentRoleName } from '../src/core/generation/newEngine/band/BandSpec';
import type { ArrangementPlan } from '../src/core/generation/newEngine/arranger/ArrangementPlan';
import type { JazzArrangementArchetypeId } from '../src/core/generation/newEngine/arranger/jazzArchetypePlanner';
import type { FormTemplate } from '../src/core/generation/newEngine/arranger/formPlanner';
import type { AcgPianoArrangementProfileId } from '../src/core/generation/newEngine/arranger/acgPianoArrangementProfiles';
import { beatsPerBarOf } from '../src/core/generation/newEngine/arranger/phraseTiming';

const SCHEMA_VERSION = 'arrangement_golden_v2';
const ENGINE_BASE_COMMIT = 'fb33e9eaa74cee6a1c882b3d710391e969e0462e'; // Newengine_Demo-v5.0 规格锚（非工装 pin）
const SPEC_ANCHOR = 'Newengine_Demo-v5.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const EXPORTER_REL = 'scripts/export-afe-arrangement.export.test.ts';
const OUT_DIR = join(HERE, '..', '..', 'core', 'tests', 'golden');
const OUT = join(OUT_DIR, 'afe_arrangement_golden.json');

// ---- afe_arrange.h 容量上界（导出侧先行 fail-closed，勿等 C 侧溢出）----
const CAP = { sections: 8, phrases: 96, roleContracts: 40, sharedGroups: 5 } as const;
const ALL_ROLES: readonly InstrumentRoleName[] = ['bass', 'comp', 'pad', 'lead', 'drum'];

// double → IEEE754 binary64 位型（十六进制串；C 侧 target_duration_sec_bits 的输入面）
/** 递归看守：任何 undefined / NaN / ±Infinity 都 fail-closed。
 *  没有它，写错一个字段名会让 JSON.stringify **静默丢键**、bits64(undefined) 写出 NaN 位型，
 *  而 exporter 自身的断言仍全绿（实测已发生：restatementStrength 拼错为非 optional 字段名）。 */
function assertJsonSafe(v: unknown, path: string): void {
  if (v === undefined) throw new Error(`JSON-unsafe undefined at ${path}`);
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`JSON-unsafe ${v} at ${path}`);
  if (Array.isArray(v)) { v.forEach((x, i) => assertJsonSafe(x, `${path}[${i}]`)); return; }
  if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) assertJsonSafe(x, `${path}.${k}`);
}

function bits64(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`bits64 收到非有限值 ${x}（多半是字段名写错 ⇒ undefined）`);
  const b = Buffer.alloc(8);
  b.writeDoubleLE(x, 0);
  return '0x' + b.readBigUInt64LE(0).toString(16);
}

interface FixtureSpec {
  name: string;
  styleHint: string;
  seed: number;
  mood?: string;
  targetDuration?: number;
  jazzArchetypeId?: JazzArrangementArchetypeId;
  template?: FormTemplate;
  /** P2-11 步0：ACG 显式 profile（零抽路径，对锁 arranger.ts:66-70）。 */
  acgPianoArrangementProfileId?: AcgPianoArrangementProfileId;
  /** P2-11 步0：期望的 normalized bars——经 probe 取该 seed 实际 tempo/meter 换算成
   *  targetDuration 秒（time 子流与 duration 无关，同 seed 恒同 tempo），golden 记录的
   *  仍是生产形态的秒数。仅 ACG 定向 fixtures 使用。 */
  acgTargetBars?: number;
  /** 该 fixture 存在的理由（判别力：它能抓住哪一类错误实现）。 */
  why: string;
}

/** 逐 fixture 用生产链构造 band + plan。band 只贡献 lineup 与 style，不入对账面。 */
function runFixture(f: FixtureSpec): { band: BandSpec; plan: ArrangementPlan; targetDuration: number | undefined } {
  const band = buildBandSpec({ seed: f.seed, styleHint: f.styleHint } as never);
  let targetDuration = f.targetDuration;
  if (f.acgTargetBars !== undefined) {
    const probe = buildArrangementPlan(band, { rng: createRandomContext(f.seed) });
    targetDuration = f.acgTargetBars * 60 * beatsPerBarOf(probe.meter) / probe.tempoBpm;
  }
  const plan = buildArrangementPlan(band, {
    rng: createRandomContext(f.seed),
    mood: f.mood,
    targetDuration,
    jazzArchetypeId: f.jazzArchetypeId,
    acgPianoArrangementProfileId: f.acgPianoArrangementProfileId,
    template: f.template,
  });
  return { band, plan, targetDuration };
}

/** 把 plan 投影成 golden case 的 expected 面（枚举全部保留 TS 字面量）。 */
function projectPlan(band: BandSpec, plan: ArrangementPlan) {
  const sectionIds = plan.sections.map((s) => s.id);
  const energyOf = (sid: string) => plan.energyBySection[sid];
  const densityOf = (sid: string) => plan.densityBySection[sid];

  const sections = plan.sections.map((s) => {
    const climax = plan.climaxMap.find((c) => c.sectionId === s.id);
    return {
      id: s.id,
      repeatGroup: s.repeatGroup ?? null,
      bars: s.bars,
      contractId: plan.grooveContractBySection[s.id].id,
      role: s.role,
      harmonyRole: s.harmonyRole ?? null,
      functionTag: s.functionTag ?? null,
      linkOut: s.linkOut ?? null,
      hookPolicy: s.hookPolicy,
      entry: plan.entryBySection[s.id],
      grooveKind: plan.grooveBySection[s.id],
      // energy 与 density 是 TS 里对同一变量的双写（设计 §4-C3）；两者相等由下方断言强制
      energy: energyOf(s.id),
      energyRawBits: bits64(energyOf(s.id)),
      density: densityOf(s.id),
      hasClimax: climax !== undefined,
      climaxIntensity: climax ? climax.intensity : 0,
      chordsPerBar: plan.harmonicRhythmTarget.chordsPerBarBySection[s.id],
    };
  });

  const phrases = plan.phrases.map((p) => {
    const binding = plan.motifBindings.find((b) => b.phraseId === p.id)!;
    return {
      sectionIndex: sectionIds.indexOf(p.sectionId),
      phraseSlot: p.phraseSlot,
      bars: p.bars,
      role: p.role,
      cadenceTarget: p.cadenceTarget,
      skeletonRole: p.skeletonRole,
      // motifId 形如 "m-{repeatGroup ?? sectionId}-{motifSlot}"（§4-C6）；ABI 只存 motifSlot
      motifId: binding.motifId,
      restatementStrength: binding.requestedRestatementStrength,
      restatementRawBits: bits64(binding.requestedRestatementStrength),
    };
  });

  const og = plan.openingGesture;
  const opening = {
    sectionIndex: sectionIds.indexOf(og.sectionId),
    mode: og.mode,
    drumEntry: og.drumEntry,
    textureEntry: og.textureEntry,
    pickupBars: og.pickupBars,
    intensity: og.intensity,
    // 输出**全 5 role**：不在 lineup 者显式 null（C 侧哨兵 0xFF），不靠"键缺席"隐式表达
    roleDelayBars: ALL_ROLES.map((r) => (og.roleDelayBars as Record<string, number | undefined>)[r] ?? null),
  };

  // 发射序 = role × n_sections + section_index（设计 §4-C2）
  const roleContracts: unknown[] = [];
  for (const role of ALL_ROLES) {
    for (const [si, sid] of sectionIds.entries()) {
      const rc = plan.rolePerformanceBySection[role][sid];
      roleContracts.push({
        sectionIndex: si,
        role: rc.role,
        active: rc.active,
        foreground: rc.foreground,
        foregroundRole: rc.foregroundRole,
        entryMode: rc.entryMode,
        continuity: rc.continuity,
        articulationScope: rc.articulationScope,
        articulationExclusionGroup: rc.articulationExclusionGroup,
        phrasePolicy: rc.phrasePolicy,
        fillPolicy: rc.fillPolicy,
        phraseVariation: rc.phraseVariation,
        humanizeAmount: rc.humanizeAmount,
        dynamicsRange: rc.dynamicsRange,
        rhythmGrid: rc.rhythmGrid,
        swingUnit: rc.swingUnit,
        preQuantizeGrid: rc.preQuantizeGrid,
        keyboardMotion: rc.keyboardMotion,
        followSource: rc.followSource,
        contractId: rc.grooveContractId,
        safeRangeTicks: rc.safeRangeTicks,
        maxMoveTicks: rc.maxMoveTicks,
        densityBudget: rc.densityBudget,
        densityBudgetRawBits: bits64(rc.densityBudget),
        feelOffsetMs: rc.feelOffsetMs,
      });
    }
  }

  const ra = plan.resolvedArchetype;
  const resolved = ra
    ? {
      tonalityMode: ra.tonalityMode ?? null,
      ensembleId: ra.instrumentationEnsembleId ?? null,
      voicePolicy: ra.instrumentationVoicePolicy ?? null,
      motifPolicyId: ra.motifPolicyId,
      boundaryPolicyId: ra.boundaryPolicyId,
      sharedGroups: (ra.sharedInstrumentRoleGroups ?? []).map((g) => [...g]),
      bySection: sectionIds.map((sid) => {
        const p = ra.sectionPolicyById[sid];
        return {
          foundationOwner: p.foundationOwner,
          entryMode: p.entryMode ?? null,
          harmonyPolicyId: p.harmonyPolicyId,
          cadencePolicyId: p.cadencePolicyId,
          rolePattern: ALL_ROLES.map((r) => (p.rolePatternByRole as Record<string, string | undefined>)[r] ?? null),
        };
      }),
      // ★ 诊断面（**不进 C golden 对账**）：ResolvedSectionArrangementPolicy 不含 activeRoles/
      //   foregroundRole，它们只在未 resolve 的 ArchetypeSectionPolicy 上。这里从**独立第二来源**
      //   （生产 planJazzArrangementArchetype + sectionPolicyForArchetype）取，仅供下方
      //   §4-C9-② / ③ 的判别力断言使用；afe_arr_resolved_policy_t 本就不含这两项。
      diagBySection: (() => {
        const arch = planJazzArrangementArchetype(undefined, ra.id as never);
        return sectionIds.map((sid) => {
          const ap = sectionPolicyForArchetype(arch, sid);
          return { activeRoles: [...ap.activeRoles], foregroundRole: ap.foregroundRole };
        });
      })(),
    }
    : null;

  // ★ §4-C10：内嵌 drum_performance 与 TS 同名字段**逐位一致**，arranger 层不得再改写
  //   （C9-② 的 silent 改写除外）。故必须导出 afe_drum_performance_contract_t 的
  //   **全部 25 个物理字段**——只导 12 个会让「arranger 在 wrapper 后改写 patternFamily」
  //   这类当前错误直接穿透（独立 drum planner golden 不覆盖 wrapper 后的改写）。
  const drumPerformance = sectionIds.map((sid, si) => {
    const d = plan.drumPerformanceBySection[sid];
    return {
      id: d.id,                       // 诊断用（含 :silent 后缀）；ABI 不存串
      sectionIndex: si,
      contractId: d.grooveContractId,
      feelProfileId: d.feelProfileId,
      role: d.role,
      patternFamily: d.patternFamily,
      kitProgram: d.kitProgram,
      entryMode: d.entryMode,
      fillPolicy: d.fillPolicy,
      timingProfile: d.timingProfile,
      velocityProfile: d.velocityProfile,
      kickPolicy: d.kickPolicy,
      snarePolicy: d.snarePolicy,
      hatPolicy: d.hatPolicy,
      cymbalPolicy: d.cymbalPolicy,
      tomPolicy: d.tomPolicy,
      foregroundGuard: d.foregroundGuard,
      complexity: d.complexity,
      intensity: d.intensity,
      fillAmount: d.fillAmount,
      fillComplexity: d.fillComplexity,
      phraseVariation: d.phraseVariation,
      humanizeAmount: d.humanizeAmount,
      densityCeiling: d.densityCeiling,
      densityCeilingRawBits: bits64(d.densityCeiling),
      maxMoveTicks: d.maxMoveTicks,
      feelOffsetMs: d.feelOffsetMs,
    };
  });

  // ---- P2-5d：withBandMode 后置一致化的期望面（controller 层 seam）----
  //   对锁 GenerationController.ts:213-216：authoredMode 存在且 request.mode 缺省时
  //   band = withBandMode(requestedBand, authoredMode)。本 exporter 的 request 恒不带 mode
  //   ⇒ 期望 = authoredMode ? withBandMode 结果 : 原 band。导出改写后的 mode/tonality/scale。
  const authoredMode = plan.resolvedArchetype?.tonalityMode ?? null;
  const bandAfter = authoredMode ? withBandMode(band, authoredMode) : band;
  const withMode = {
    authoredMode,
    applied: authoredMode !== null && bandAfter !== band,
    // before 面（C 测试据此重建改写前的 band；modalModeName null = tonal）
    before: {
      key: band.key,
      mode: band.mode,
      tonalityKind: band.tonalityKind,
      modalModeName: (band as { modalModeName?: string }).modalModeName ?? null,
      primaryScale: [...band.primaryScale],
    },
    // after 面（期望输出）
    mode: bandAfter.mode,
    tonalityKind: bandAfter.tonalityKind,
    primaryScale: [...bandAfter.primaryScale],
  };

  const gsp = plan.grooveScorePlan;
  return {
    withMode,
    nSections: plan.sections.length,
    sections,
    nPhrases: plan.phrases.length,
    phrases,
    tempoBpm: plan.tempoBpm,
    tempoBpmRawBits: bits64(plan.tempoBpm),
    meterNum: plan.meter.numerator,
    meterDen: plan.meter.denominator,
    feelKind: plan.feel.kind,
    swingRatio: plan.feel.swingRatio,
    swingRatioRawBits: bits64(plan.feel.swingRatio),
    phraseBars: plan.phraseBreathing.phraseBars,
    cadenceBreathBeats: plan.phraseBreathing.cadenceBreathBeats,
    styleName: band.style,
    endingStyle: plan.endingStyle,
    leadCompCollisionPolicy: plan.leadCompCollisionPolicy,
    archetypeId: plan.arrangementArchetypeId ?? null,
    acgProfileId: plan.acgPianoArrangementProfileId ?? null,
    acousticIntentId: plan.acousticInstrumentationIntent?.id ?? null,
    songContractId: plan.songGrooveContractId,
    opening,
    nRoleContracts: roleContracts.length,
    roleContracts,
    resolved,
    drumPerformance,
    // ★ groove score plan 只记**规模量**：其逐位对账由 P2-4c 步3/步5 的独立 golden 承担
    //   （见 meta.coverageGaps）。这里锁住「arranger 传给它的输入产生了预期规模的输出」，
    //   同时 role_rhythm 三槽被显式导出——那是 arranger 侧桥接的产物，属本层责任。
    grooveScoreShape: {
      nSections: sectionIds.length,
      nBars: sectionIds.reduce((n, sid) => n + gsp.bySection[sid].bars.length, 0),
      nBoundaries: gsp.boundaries.length,
      songContractId: gsp.grooveContractId,
      roleRhythmBySection: sectionIds.map((sid) => {
        const rr = gsp.bySection[sid].roleRhythmByRole ?? {};
        const idOf = (k: 'bass' | 'comp' | 'lead') =>
          (rr as Record<string, { id?: string } | undefined>)[k]?.id ?? null;
        return {
          bass: idOf('bass'), comp: idOf('comp'), lead: idOf('lead'),
          bassPattern: gsp.bySection[sid].bassPatternId ?? null,
        };
      }),
    },
  };
}

// ============================================================
// fixtures —— **判别力优先**：每条对应一种能蒙混过关的错误实现
// ============================================================
const FIXTURES: readonly FixtureSpec[] = [
  { name: 'pop_default', styleHint: 'pop', seed: 42,
    why: 'pop 程序化基线：抽序 hasIntro·空抽·verses·choruses；linkOut 位置；per 等长' },
  { name: 'pop_lyrical', styleHint: 'pop', seed: 42, mood: 'ballad',
    why: 'POP 抒情三连动：POP_LYRICAL_TIME(82±18) + ballad 过滤池 + ending fade + grooveKind 覆盖' },
  { name: 'pop_duration_60s', styleHint: 'pop', seed: 7, targetDuration: 60,
    why: 'duration-aware 主路径：normalizeTargetBars + sizeContent + fitOptionalIntro 全链' },
  { name: 'pop_duration_tiny', styleHint: 'pop', seed: 7, targetDuration: 8,
    why: 'FDBR `<=16 → set_counts(1,1)+alsoNoIntro` 分支（最短曲式）' },
  { name: 'pop_duration_long', styleHint: 'pop', seed: 3, targetDuration: 200,
    why: 'FDBR `>=64 → grow_chorus_to_ge(4)` 分支 + over() 封顶（段数须仍 ≤6）' },
  { name: 'rnb_default', styleHint: 'rnb', seed: 11,
    why: 'rnb id 族 introVamp/hook{i}/outroVamp + repeatGroup H + hookPolicy call-response' },
  { name: 'lofi_default', styleHint: 'lofi', seed: 5,
    why: 'lofi loop 族 + outroFade + harmonyRole loop；loops 下限 2（≠pop 的 1）' },
  { name: 'lofi_duration_long', styleHint: 'lofi', seed: 5, targetDuration: 150,
    why: 'lofi FDBR `>=48 → set_counts(3)`；contentMax 20（≠pop 的 28）' },
  { name: 'jazz_4_4', styleHint: 'jazz', seed: 13,
    why: 'jazz 4/4：抽序仅 hasIntro·hasSolo（**无空抽占位**）+ headA/headA2/headOut 共享 repeatGroup A' },
  { name: 'jazz_4_4_duration', styleHint: 'jazz', seed: 13, targetDuration: 240,
    why: 'jazz branchEval=all（逐条 if，非 else-if）+ `>=112 → set_solo_bars(32)`' },
  { name: 'jazz_5_4_quartet', styleHint: 'jazz', seed: 13, jazzArchetypeId: 'jazz_5_4_reference_quartet',
    why: '5/4 固定 33 bar 旁路（零抽、不消费 targetDuration）+ resolved 投影 + lead grammar-marker' },
  { name: 'jazz_5_4_quartet_with_duration', styleHint: 'jazz', seed: 13, targetDuration: 90,
    jazzArchetypeId: 'jazz_5_4_reference_quartet',
    why: '★ 明示旁路判别：给了 targetDuration 也必须仍是 33 bar（否则说明错误地消费了 normalized）' },
  { name: 'jazz_5_4_modern_piano', styleHint: 'jazz', seed: 13, jazzArchetypeId: 'jazz_5_4_modern_piano',
    why: '§4-C9-① entryMode 覆写 + §4-C9-③ 逐段 active/foreground/rolePattern 覆写（该 archetype 的'
      + ' sectionPolicyByFormSlot 对 pickup/headA 给了与 default 不同的 activeRoles）。'
      + '★ 不含 C9-② silent 改写——该分支当前不可达（本文件下方看守断言证明 silentReachable==0）' },
  { name: 'jazz_4_4_forced', styleHint: 'jazz', seed: 2, jazzArchetypeId: 'jazz_4_4_standard',
    why: '显式传缺省 archetype ⇒ 与不传等价（forced 路径不改行为）' },
  { name: 'modal_legacy_pool', styleHint: 'modal', seed: 9,
    why: 'legacy 池路径：pick(FORM_POOL)+pick(introBars)+pick(outroBars) 三抽；modal 落 default bounds' },
  { name: 'default_legacy_pool', styleHint: 'unknown-style-falls-back', seed: 9,
    why: '未知 styleHint → default profile；style_key 0xFF 路由 + groove pool 投影 POP' },
  { name: 'template_compact', styleHint: 'pop', seed: 1, template: 'compact',
    why: '显式 template 零抽 + compact 末段非 outro ⇒ **追加** outro（统一收尾段）' },
  { name: 'template_verse_chorus_bridge', styleHint: 'pop', seed: 1, template: 'verse-chorus-bridge',
    why: '容量紧界：8 段 = AFE_ARR_MAX_SECTIONS' },
  { name: 'template_on_jazz', styleHint: 'jazz', seed: 1, template: 'verse-chorus',
    why: '显式 template 优先于程序化分支，且 jazz archetype 仍生效（合同/resolved 不受 template 影响）' },

  // ---- P2-11 步0：ACG 程序化曲式定向 fixtures（设计 §4 分支矩阵冻结）----
  { name: 'acg_short12_motif', styleHint: 'acg', seed: 21, acgTargetBars: 12, acgPianoArrangementProfileId: 'motif-first',
    why: 'short 无 intro（norm 12 < 16）；非 ripple profile——E1-short：coda 必须是 pianoCoda 而非派生列' },
  { name: 'acg_short16_descending', styleHint: 'acg', seed: 22, acgTargetBars: 16, acgPianoArrangementProfileId: 'descending-memory',
    why: 'short intro 阈值 >=16 边界；非 ripple' },
  { name: 'acg_med28_motif', styleHint: 'acg', seed: 23, acgTargetBars: 28, acgPianoArrangementProfileId: 'motif-first',
    why: 'medium transition=0：lift 条件段缺席' },
  { name: 'acg_med28_wide', styleHint: 'acg', seed: 24, acgTargetBars: 28, acgPianoArrangementProfileId: 'wide-cinema',
    why: 'medium transition=0：序列首 prelude 条件段缺席' },
  { name: 'acg_med32_dialogue', styleHint: 'acg', seed: 25, acgTargetBars: 32, acgPianoArrangementProfileId: 'dialogue-breath',
    why: 'medium transition=4：breath 插在 themeA 后（五序列互异之一）' },
  { name: 'acg_med32_descending', styleHint: 'acg', seed: 26, acgTargetBars: 32, acgPianoArrangementProfileId: 'descending-memory',
    why: 'medium transition=4：reflection 插位 + minorIvHold linkOut' },
  { name: 'acg_med32_ripple', styleHint: 'acg', seed: 27, acgTargetBars: 32, acgPianoArrangementProfileId: 'ripple-journey',
    why: 'medium transition=4：intro 插在序列首' },
  { name: 'acg_c20_dialogue', styleHint: 'acg', seed: 28, acgTargetBars: 20, acgPianoArrangementProfileId: 'dialogue-breath',
    why: 'dialogue compact（<24 网格上唯一可达点 20）：ext 全给 callIntro' },
  { name: 'acg_f24_dialogue', styleHint: 'acg', seed: 29, acgTargetBars: 24, acgPianoArrangementProfileId: 'dialogue-breath',
    why: 'dialogue full 下边界 24：breath 段出现' },
  { name: 'acg_c20_ripple', styleHint: 'acg', seed: 30, acgTargetBars: 20, acgPianoArrangementProfileId: 'ripple-journey',
    why: 'ripple compact 20：intro 吸收 ext（与 full 序列差）' },
  { name: 'acg_f24_ripple', styleHint: 'acg', seed: 31, acgTargetBars: 24, acgPianoArrangementProfileId: 'ripple-journey',
    why: 'ripple full 下边界 24：pianoLift 出现' },
  { name: 'acg_c24_wide', styleHint: 'acg', seed: 32, acgTargetBars: 24, acgPianoArrangementProfileId: 'wide-cinema',
    why: 'wide compact 上边界 24（<32；28/32 被 medium 截走）——统一 <24 判 compact 的错误实现在此转红' },
  { name: 'acg_f36_wide', styleHint: 'acg', seed: 33, acgTargetBars: 36, acgPianoArrangementProfileId: 'wide-cinema',
    why: 'wide 首个 full 36：prelude 8+ext 与 wideLift 8' },
  { name: 'acg_c24_descending', styleHint: 'acg', seed: 34, acgTargetBars: 24, acgPianoArrangementProfileId: 'descending-memory',
    why: 'descending compact 上边界 24（<28）' },
  { name: 'acg_f36_descending', styleHint: 'acg', seed: 35, acgTargetBars: 36, acgPianoArrangementProfileId: 'descending-memory',
    why: 'descending 首个 full 36：lift 段出现（7 段最大序列）' },
  { name: 'acg_f20_motif', styleHint: 'acg', seed: 36, acgTargetBars: 20, acgPianoArrangementProfileId: 'motif-first',
    why: 'motif 无 compact：20 也走 full（theme 下钳 4 + lift 4）' },
  { name: 'acg_h84_motif', styleHint: 'acg', seed: 37, acgTargetBars: 84, acgPianoArrangementProfileId: 'motif-first',
    why: '84 高值：theme clamp 24 + ext 4（fixed 8 组）' },
  { name: 'acg_h84_ripple', styleHint: 'acg', seed: 38, acgTargetBars: 84, acgPianoArrangementProfileId: 'ripple-journey',
    why: '84 高值：theme 24 + ext 0（fixed 12 组）' },
  { name: 'acg_h84_wide', styleHint: 'acg', seed: 39, acgTargetBars: 84, acgPianoArrangementProfileId: 'wide-cinema',
    why: '84 高值：theme 20 + ext 4——「全部 clamp 24」的错误实现在此转红' },
  { name: 'acg_h84_descending', styleHint: 'acg', seed: 40, acgTargetBars: 84, acgPianoArrangementProfileId: 'descending-memory',
    why: '84 高值：theme 20 + ext 8（fixed 16 组）' },
  { name: 'acg_nodur_rngprofile', styleHint: 'acg', seed: 41,
    why: '无 targetDuration：theme=8/ext=0 默认路径 + RNG 抽 profile（arranger 子流首抽，对锁抽序）' },
];

// ---- P2-5d：G4 固定语料集 12 例并入（参数机器读自 corpus_set_v5.json，不手抄）----
//   P2-11 步0：2 个 ACG 例随曲式落地翻转为逐位对账（原 expectAcgFailClosed 退场）。
const G4_CORPUS = JSON.parse(
  readFileSync(join(HERE, '..', '..', 'core', 'tests', 'fixtures', 'corpus_set_v5.json'), 'utf8'),
) as { cases: Array<{ id: string; seed: number; styleHint: string; mood: string; targetDuration: number }> };

const CORPUS_FIXTURES: readonly FixtureSpec[] = G4_CORPUS.cases.map((c) => ({
  name: `g4_${c.id.replace(/[^a-zA-Z0-9]/g, '_')}`,
  styleHint: c.styleHint,
  seed: c.seed,
  mood: c.mood,
  targetDuration: c.targetDuration,
  why: `P2-5d G4 固定语料 ${c.id}（真实歌曲参数；手构造 fixture 可能恰好避开的组合）`,
}));

describe('export-afe-arrangement', () => {
  it('writes arrangement plan golden', () => {
    const exporterSha = createHash('sha256')
      .update(readFileSync(join(HERE, 'export-afe-arrangement.export.test.ts')))
      .digest('hex');

    const cases = [...FIXTURES, ...CORPUS_FIXTURES].map((f) => {
      const { band, plan, targetDuration } = runFixture(f);
      const expectedProj = projectPlan(band, plan);

      // ---- 容量 fail-closed（导出侧先拦，勿等 C 侧溢出）----
      expect(plan.sections.length, `${f.name}: 段数 ≤ ${CAP.sections}`).toBeLessThanOrEqual(CAP.sections);
      expect(plan.phrases.length, `${f.name}: 乐句数 ≤ ${CAP.phrases}`).toBeLessThanOrEqual(CAP.phrases);
      expect(expectedProj.nRoleContracts, `${f.name}: 合同数 ≤ ${CAP.roleContracts}`)
        .toBeLessThanOrEqual(CAP.roleContracts);
      expect((expectedProj.resolved?.sharedGroups.length ?? 0), `${f.name}: shared group ≤ ${CAP.sharedGroups}`)
        .toBeLessThanOrEqual(CAP.sharedGroups);

      // ---- §4-C3 density ≡ energy：**逐段机器断言**，不靠推理 ----
      for (const s of expectedProj.sections)
        expect(s.density, `${f.name}/${s.id}: density ≡ energy（§4-C3）`).toBe(s.energy);
      // ---- §4-C4 chordsPerBar 恒 1 ----
      expect(expectedProj.sections.every((s) => s.chordsPerBar === 1),
        `${f.name}: chordsPerBar 恒 1（§4-C4）`).toBe(true);
      // ---- §4-C5 feel.swingRatio 取 songGrooveContract.compSwingRatio ----
      expect(expectedProj.swingRatio, `${f.name}: swingRatio 来自 song contract（§4-C5）`)
        .toBe(plan.songGrooveContract.compSwingRatio);
      // ---- motifBindings 与 phrases 1:1（设计 §1.4 的合并前提）----
      expect(plan.motifBindings.length, `${f.name}: motifBindings 与 phrases 1:1`)
        .toBe(plan.phrases.length);
      // ---- 段 id 唯一（id_off 作 canonical key 的前提）----
      expect(new Set(plan.sections.map((s) => s.id)).size, `${f.name}: 段 id 唯一`)
        .toBe(plan.sections.length);
      // ---- 必有收尾段（formPlanner 统一保证）----
      expect(plan.sections[plan.sections.length - 1].role, `${f.name}: 末段 role=outro`).toBe('outro');
      expect(plan.sections[plan.sections.length - 1].harmonyRole, `${f.name}: 末段 harmonyRole=ending`)
        .toBe('ending');
      // ---- 合同全曲同一（planGrooveContract 段级暂不变化）----
      expect(new Set(plan.sections.map((s) => plan.grooveContractBySection[s.id].id)).size,
        `${f.name}: 全曲同一 contract`).toBe(1);

      return {
        name: f.name,
        why: f.why,
        input: {
          styleHint: f.styleHint,
          bandStyle: band.style,
          lineup: [...band.instrumentPool],
          seed: f.seed,
          mood: f.mood ?? null,
          targetDuration: targetDuration ?? null,
          targetDurationBits: targetDuration === undefined ? '0x0' : bits64(targetDuration),
          jazzArchetypeId: f.jazzArchetypeId ?? null,
          acgPianoArrangementProfileId: f.acgPianoArrangementProfileId ?? null,
          template: f.template ?? null,
        },
        expected: expectedProj,
      };
    });

    const byName = new Map(cases.map((c) => [c.name, c]));
    // P2-5d：聚合断言只跑有 expected 的 case（ACG fail-closed 例只有输入面）
    const planCases = cases.filter((c) => c.expected !== null) as Array<typeof cases[0] & { expected: NonNullable<typeof cases[0]['expected']> }>;

    // ============================================================
    // 判别力断言 —— 每条对应一种"只看形状看不出来"的错误实现
    // ============================================================

    // ① 5/4 quartet 明示旁路：给不给 targetDuration，曲式都必须是固定 33 bar。
    //    错误实现（消费了 normalized）会在带 duration 的那条上产出不同 bar 数。
    {
      const a = byName.get('jazz_5_4_quartet')!.expected;
      const b = byName.get('jazz_5_4_quartet_with_duration')!.expected;
      const barsOf = (e: typeof a) => e.sections.reduce((n, s) => n + s.bars, 0);
      expect(barsOf(a), 'quartet 固定 33 bar').toBe(33);
      expect(barsOf(b), '★ quartet + targetDuration 仍是 33 bar（明示旁路）').toBe(33);
      expect(b.sections.map((s) => s.id), 'quartet 段序不受 duration 影响')
        .toEqual(a.sections.map((s) => s.id));
    }

    // ② §4-C9-② drum silent 改写 —— ★ **当前生产域不可达，如实记账、不伪造**。
    //    这段是「不可达」记账的**事实依据**：在当前 pin 的真源上逐 case 数出
    //    `!activeRoles.includes('drum')` 的实际命中数，实得 0 ⇒ 该分支无输入可触发。
    //    没有这个数字，"不可达"就只是我方断言而非机器结论
    //    （本仓栽过：把"我构造不出"写成"不可表示"）。只数，不放死断言（D10）。
    {
      let silentReachable = 0;
      for (const c of planCases) {
        if (!c.expected.resolved) continue;
        for (const p of c.expected.resolved.diagBySection)
          if (!p.activeRoles.includes('drum')) silentReachable++;
      }
      expect(silentReachable, '§4-C9-② silent 改写在**当前** archetype 注册表下的实际命中数（见 coverageGaps）')
        .toBe(0);
    }

    // ②b §4-C9-③ 的 active 覆写**可达**且必须对账：policy.activeRoles ∩ lineup 之外的 role
    //     须 active=false 且 entryMode/densityBudget/continuity 等受保护字段归零。
    {
      let overridden = 0;
      for (const c of planCases) {
        if (!c.expected.resolved) continue;
        const lineup = new Set(c.input.lineup);
        const n = c.expected.nSections;
        const rcs = c.expected.roleContracts as Array<{
          active: boolean; entryMode: string; densityBudget: number; continuity: string;
          foregroundRole: string; foreground: boolean;
        }>;
        for (const [ri, role] of ALL_ROLES.entries()) {
          for (let si = 0; si < n; si++) {
            const diag = c.expected.resolved.diagBySection[si];
            const want = diag.activeRoles.includes(role) && lineup.has(role);
            const rc = rcs[ri * n + si];
            expect(rc.active, `${c.name}: role ${role}/段 ${si} active = policy ∩ lineup`).toBe(want);
            expect(rc.foregroundRole, `${c.name}: foregroundRole 取 policy`).toBe(diag.foregroundRole);
            expect(rc.foreground, `${c.name}: foreground = active && role==policy.foregroundRole`)
              .toBe(want && role === diag.foregroundRole);
            if (!want) {
              expect(rc.entryMode, `${c.name}: 非 active ⇒ entryMode none`).toBe('none');
              expect(rc.densityBudget, `${c.name}: 非 active ⇒ densityBudget 0`).toBe(0);
              expect(rc.continuity, `${c.name}: 非 active ⇒ continuity none`).toBe('none');
              overridden++;
            }
          }
        }
      }
      expect(overridden, '★ §4-C9-③ 须存在被覆写为非 active 的 (role,段)，否则该靶无判别力')
        .toBeGreaterThan(0);
    }

    // ③ §4-C9-③ archetype 覆写：有 resolvedArchetype 时**所有** role 合同 fillPolicy 恒 none。
    for (const c of planCases) {
      if (!c.expected.resolved) continue;
      const bad = (c.expected.roleContracts as Array<{ fillPolicy: string }>)
        .filter((rc) => rc.fillPolicy !== 'none');
      expect(bad.length, `${c.name}: ★ archetype 覆写后 fillPolicy 恒 none（§4-C9-③）`).toBe(0);
    }

    // ④ lead role-rhythm 桥接（P2-5c 第三批实现门首轮 Major 的回归面）：
    //    5/4 archetype 的 lead 槽必须解析出 grammar-marker，不得为 null。
    {
      const seen: string[] = [];
      for (const n of ['jazz_5_4_quartet', 'jazz_5_4_modern_piano']) {
        const e = byName.get(n)!.expected;
        for (const r of e.grooveScoreShape.roleRhythmBySection) if (r.lead) seen.push(r.lead);
      }
      expect(seen.length, '★ 5/4 archetype 的 lead role-rhythm 须被解析（跨 id 空间桥接回归面）')
        .toBeGreaterThan(0);
    }

    // ⑤ opening：不在 lineup 的 role 必须是 null（C 侧 0xFF），在 lineup 的必须有值。
    for (const c of planCases) {
      const lineup = new Set(c.input.lineup);
      for (const [i, r] of ALL_ROLES.entries()) {
        const v = (c.expected.opening.roleDelayBars as (number | null)[])[i];
        expect(v === null, `${c.name}: role ${r} 在 lineup(${lineup.has(r)}) 与 delay null 须互斥`)
          .toBe(!lineup.has(r));
      }
      // 无 drum ⇒ drumEntry 必为 none（adaptDrum）
      if (!lineup.has('drum'))
        expect(c.expected.opening.drumEntry, `${c.name}: 无 drum ⇒ drumEntry=none`).toBe('none');
    }

    // ⑥ POP 抒情三连动：与非抒情同 seed 对照，tempo/ending/合同池三处都必须变。
    {
      const plain = byName.get('pop_default')!.expected;
      const lyr = byName.get('pop_lyrical')!.expected;
      expect(lyr.endingStyle, '★ POP 抒情 ending=fade').toBe('fade');
      expect(plain.endingStyle, 'POP 非抒情 ending=cold').toBe('cold');
      expect(lyr.tempoBpm === plain.tempoBpm, '★ 抒情走 POP_LYRICAL_TIME ⇒ tempo 应不同').toBe(false);
      const balladish = ['pop_ballad_halftime'].includes(lyr.songContractId)
        || lyr.songContractId !== plain.songContractId;
      expect(balladish, '★ 抒情走 ballad 过滤池 ⇒ 合同应与非抒情不同').toBe(true);
    }

    // ⑦ legacy 池 vs 程序化：modal 段 bars 必落 legacy 形态（intro/outro ∈{2,4}，content=8）
    {
      const m = byName.get('modal_legacy_pool')!.expected;
      for (const s of m.sections) {
        if (s.role === 'intro' || s.role === 'outro')
          expect([2, 4].includes(s.bars), `modal legacy intro/outro bars ∈{2,4}（得 ${s.bars}）`).toBe(true);
        else expect(s.bars, 'modal legacy content bars=8').toBe(8);
      }
    }

    // ⑧ 显式 template 覆盖程序化：jazz + template 仍走 legacy 模板段序
    {
      const t = byName.get('template_on_jazz')!.expected;
      expect(t.sections.map((s) => s.id), '显式 template 段序 = legacy verse-chorus')
        .toEqual(['intro', 'verse1', 'chorus1', 'verse2', 'chorus2', 'outro']);
      expect(t.resolved !== null, 'jazz 的 archetype 不受 template 影响').toBe(true);
    }

    // ⑨ compact 追加 outro：4 段模板 → 5 段
    {
      const c = byName.get('template_compact')!.expected;
      expect(c.nSections, 'compact 4 段 + 追加 outro = 5').toBe(5);
      expect(c.sections[4].id, '追加段 id=outro').toBe('outro');
    }

    // ⑩ 容量紧界
    expect(byName.get('template_verse_chorus_bridge')!.expected.nSections, 'vcb 用满 8 段').toBe(8);

    // ⑪ 发射序合同：role 外层 × section 内层（§4-C2）
    for (const c of planCases) {
      const rcs = c.expected.roleContracts as Array<{ role: string; sectionIndex: number }>;
      const n = c.expected.nSections;
      for (const [k, rc] of rcs.entries()) {
        expect(rc.role, `${c.name}: 合同[${k}] role`).toBe(ALL_ROLES[Math.floor(k / n)]);
        expect(rc.sectionIndex, `${c.name}: 合同[${k}] sectionIndex`).toBe(k % n);
      }
    }

    // ⑫ 覆盖面统计（机器计数，非手写）——**且逐项断言下界**，缺覆盖即红
    const cover = {
      styles: new Set(planCases.map((c) => c.expected.styleName)),
      endings: new Set(planCases.map((c) => c.expected.endingStyle)),
      openingModes: new Set(planCases.map((c) => c.expected.opening.mode)),
      grooveKinds: new Set(planCases.flatMap((c) => c.expected.sections.map((s) => s.grooveKind))),
      functionTags: new Set(planCases.flatMap((c) => c.expected.sections.map((s) => s.functionTag))),
      entries: new Set(planCases.flatMap((c) => c.expected.sections.map((s) => s.entry))),
      continuities: new Set(planCases.flatMap((c) =>
        (c.expected.roleContracts as Array<{ continuity: string }>).map((r) => r.continuity))),
      keyboardMotions: new Set(planCases.flatMap((c) =>
        (c.expected.roleContracts as Array<{ keyboardMotion: string }>).map((r) => r.keyboardMotion))),
      withArchetype: planCases.filter((c) => c.expected.resolved !== null).length,
      withDuration: cases.filter((c) => c.input.targetDuration !== null).length,
      corpus: cases.filter((c) => c.name.startsWith('g4_')).length,
      acg: cases.filter((c) => c.input.styleHint === 'acg').length,
      withTemplate: cases.filter((c) => c.input.template !== null).length,
    };
    expect(cover.styles.size, '覆盖 ≥5 个 band style').toBeGreaterThanOrEqual(5);
    expect(cover.endings.size, '覆盖 ≥3 种 endingStyle').toBeGreaterThanOrEqual(3);
    expect(cover.grooveKinds.size, '覆盖 ≥3 种 GrooveKind').toBeGreaterThanOrEqual(3);
    expect(cover.entries.size, '覆盖 downbeat 与 lead-in 两种 entry').toBeGreaterThanOrEqual(2);
    expect(cover.continuities.size, '覆盖 ≥4 种 continuity').toBeGreaterThanOrEqual(4);
    expect(cover.withArchetype, '≥3 条带 resolvedArchetype').toBeGreaterThanOrEqual(3);
    expect(cover.withDuration, '≥4 条带 targetDuration').toBeGreaterThanOrEqual(4);
    expect(cover.withTemplate, '≥3 条带显式 template').toBeGreaterThanOrEqual(3);

    const out = {
      meta: {
        layer: 'arrangement plan golden (buildArrangementPlan raw)',
        schemaVersion: SCHEMA_VERSION,
        generator: EXPORTER_REL,
        exporterSha,
        engineBaseCommit: ENGINE_BASE_COMMIT,
        specAnchor: SPEC_ANCHOR,
        note: 'fixtures 用生产 buildBandSpec + buildArrangementPlan 直调；(输入, 期望 plan) 成对冻结，'
          + '供 P2-5 步c 的 C afe_plan_arrangement 逐字段对账。**枚举一律输出 TS 原始字面量**，'
          + '字符串→C 枚举值的换算在转换器 gen_arrangement_golden.py 内完成（解析 p2org_enums.lock.json '
          + '与 C 头，两侧独立）。band 只贡献 lineup，其自身正确性归 P2-3，不在本靶对账面。',
        emissionOrder: {
          sections: 'planForm 产出序',
          phrases: '段序 × phraseSlot 序',
          roleContracts: 'role(bass,comp,pad,lead,drum) 外层 × section 内层（§4-C2）',
          openingRoleDelayBars: 'afe_role_t 序（bass,comp,pad,lead,drum）；不在 lineup 者为 null',
          resolvedBySection: '段序',
          drumPerformance: '段序',
        },
        coverageGaps: [
          '[已闭] ACG 程序化曲式（P2-11 步0，2026-07-29）：2 个语料例翻转逐位对账 + 21 条定向'
            + ' fixtures 冻结分支矩阵（short 12/16 非 ripple / medium 28·32 五 profile 全命中 /'
            + ' dialogue·ripple 20c·24f / wide·descending 24c·36f / 84 高值四组 (theme,ext) /'
            + ' motif 无 compact / 无 duration 默认路径 + RNG profile 抽取）。',
          '[延后·可达] grooveScorePlan 的逐位对账：由 P2-4c 步3/步5 的独立 golden（afe_groove_score_golden / '
            + 'afe_fill_materialize_golden）承担。本靶只锁 arranger 传入后的**规模量与 role_rhythm 三槽**'
            + '（后者是 arranger 侧跨 id 空间桥接的产物，属本层责任）。',
          '[延后·可达] jazzFiveFour{Harmony,Lead,Ensemble} 三个 directive：设计 §2.3 已冻结归 P2J-c，'
            + 'afe_arrangement_plan_t **本就不含**该三字段，故不导出、不对账。',
          '[不可达] §4-C9-② drum silent 改写：三个已注册 jazz archetype 的**每一条** section policy '
            + '（default 与 sectionPolicyByFormSlot 覆盖）的 activeRoles 都含 drum ⇒ '
            + '`!activeRoles.includes(\'drum\')` 分支无输入可触发（exporter 逐 case 机器数出命中数=0，'
            + '该数字即本条记账的事实依据）。C 侧实现保留——它对锁 TS，不是空钩子。',
          '[不可达] foregroundRoleFor 的 `activeRoles[0] ?? \'comp\'` 末位兜底：需 lineup 不含 '
            + 'lead/comp/bass 三者中任何一个；本 exporter 逐 fixture 实测 lineup 恒含其一。',
        ],
        coverage: {
          cases: cases.length,
          styles: [...cover.styles].sort(),
          endingStyles: [...cover.endings].sort(),
          openingModes: [...cover.openingModes].sort(),
          grooveKinds: [...cover.grooveKinds].sort(),
          functionTags: [...cover.functionTags].map((t) => t ?? '(none)').sort(),
          sectionEntries: [...cover.entries].sort(),
          continuities: [...cover.continuities].sort(),
          keyboardMotions: [...cover.keyboardMotions].sort(),
          withArchetype: cover.withArchetype,
          withTargetDuration: cover.withDuration,
          withExplicitTemplate: cover.withTemplate,
        },
      },
      cases,
    };

    // 「foregroundRoleFor 末位兜底不可达」这条记账的**事实依据**：逐 fixture 实测 lineup
    // 恒含 lead/comp/bass 之一 ⇒ `activeRoles[0] ?? 'comp'` 分支取不到输入。
    for (const c of planCases) {
      const lineup = new Set(c.input.lineup);
      expect(lineup.has('lead') || lineup.has('comp') || lineup.has('bass'),
        `${c.name}: 实测 lineup 含 lead/comp/bass 之一（末位兜底分支因此取不到输入）`)
        .toBe(true);
    }

    assertJsonSafe(out, 'root');
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT, JSON.stringify(out, null, 1));
    expect(readFileSync(OUT, 'utf-8').length).toBeGreaterThan(0);
  });
});
