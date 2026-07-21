// ============================================================
// newEngine · arranger · Arranger(组合 4 planner → ArrangementPlan)
// ------------------------------------------------------------
// 架构定稿 Part 5 / 铁律1:最高权威。BandSpec → 曲式/时间/能量/乐句/排比。
// 内部拆 Form/Time/Dynamics/Phrase 子模块(避免上帝层)。输出 deepFreeze。
// ============================================================

import type { BandSpec, InstrumentRoleName } from '../band/BandSpec';
import type { RandomContext } from '../foundation';
import { freezeArrangementPlan, type ArrangementPlan, type ArrangementPlanData } from './ArrangementPlan';
import { planForm, type FormTemplate } from './formPlanner';
import { planTime } from './timePlanner';
import { planDynamics } from './dynamicsPlanner';
import { planPhrases } from './phrasePlanner';
import { planGroove, planGrooveContract } from './groovePlanner';
import { planEdges } from './edgePlanner';
import { planOpeningGesture } from './openingGesturePlanner';
import { planDrumPerformance } from './drumPerformancePlanner';
import { planGrooveScore } from './grooveScorePlanner';
import { planRolePerformance } from './performanceContractPlanner';
import { beatsPerBarOf } from './phraseTiming';
import {
  JAZZ_5_4_ARCHETYPE_ID,
  JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
  planJazzArrangementArchetype,
  type JazzArrangementArchetypeId,
} from './jazzArchetypePlanner';
import {
  resolveArrangementArchetype,
  sectionPolicyForArchetype,
} from './arrangementArchetypeContract';
import {
  acgPianoArrangementProfileForId,
  resolveAcgPianoArrangementProfile,
  type AcgPianoArrangementProfileId,
} from './acgPianoArrangementProfiles';
import { acousticInstrumentationIntentForStyle } from './acousticInstrumentationProfiles';
import { roleRhythmPattern } from '../knowledge/roleRhythmPatterns';
import { planJazzFiveFourHarmonicDirectives } from './jazzFiveFourHarmonyScore';
import { planJazzFiveFourLeadDirectives } from './jazzFiveFourLeadScore';
import { planJazzFiveFourEnsembleScore } from './jazzFiveFourEnsembleScore';

export interface ArrangementOptions {
  rng?: RandomContext; // 有 → seed 选曲式 + 段落长度变化(不同 seed 不同曲式)
  template?: FormTemplate; // 显式固定曲式(测试/特化)
  mood?: string; // 请求情绪提示:复用现有 POP ballad / lyrical 编配素材,不新增 macro
  targetDuration?: number; // 秒；由实际 tempo/meter 换算为 form 的目标小节预算
  jazzArchetypeId?: JazzArrangementArchetypeId; // 测试/内部调试可固定当前已注册的 Jazz 主型。
  /** ACG only: internal/test override for the hidden score blueprint; never surfaced in the style UI. */
  acgPianoArrangementProfileId?: AcgPianoArrangementProfileId;
}

export function buildArrangementPlan(
  band: BandSpec,
  opts: ArrangementOptions = {},
): ArrangementPlan {
  const isJazz = band.style.toLowerCase() === 'jazz';
  const isAcgPianoSong = band.style.toLowerCase() === 'acg';
  // JAZZ 先选已注册编配主型；Time/Form/角色合同随后共同消费同一决定。
  const jazzArchetype = isJazz
    ? planJazzArrangementArchetype(opts.rng, opts.jazzArchetypeId)
    : undefined;
  // ACG 的 profile 和 UI style 分离：同一 ACG PIANOSONG 下，每个 seed 先选一条
  // 可审计的整曲总谱蓝图，随后 Form 与 PianoScorePlan 都读取同一 id。
  // 无 RNG 且未显式调试时保留旧的 generic-form 回退，不凭空改变 legacy fixture。
  const acgPianoArrangementProfile = isAcgPianoSong && !opts.template && opts.rng
    ? (opts.acgPianoArrangementProfileId
      ? acgPianoArrangementProfileForId(opts.acgPianoArrangementProfileId)
      : resolveAcgPianoArrangementProfile(opts.rng?.substream('arranger')))
    : undefined;
  const jazzGrooveContract = jazzArchetype?.grooveContract;
  const time = planTime(band.style, opts.rng?.substream('time'), opts.mood, jazzGrooveContract); // tempo/meter 服从已选 archetype
  const targetBars = opts.targetDuration !== undefined && Number.isFinite(opts.targetDuration) && opts.targetDuration > 0
    ? opts.targetDuration * time.tempoBpm / 60 / beatsPerBarOf(time.meter)
    : undefined;
  const sections = planForm({
    rng: opts.rng?.substream('arranger'),
    template: opts.template,
    style: band.style,
    targetBars,
    acgPianoArrangementProfileId: acgPianoArrangementProfile?.id,
    jazzFormBlueprintId: jazzArchetype?.formBlueprintId,
  });
  const sectionPolicyById = jazzArchetype
    ? Object.fromEntries(sections.map((section) => [section.id, sectionPolicyForArchetype(jazzArchetype, section.id)]))
    : undefined;
  const resolvedArchetype = jazzArchetype
    ? resolveArrangementArchetype(jazzArchetype, sections.map((section) => section.id))
    : undefined;
  const { phrases, motifBindings } = planPhrases(sections, time.phraseBreathing.phraseBars);
  const jazzFiveFourHarmonyDirectives = planJazzFiveFourHarmonicDirectives({
    meter: time.meter,
    sections,
    phrases,
    resolvedArchetype,
  });
  const jazzFiveFourLeadEnabled = jazzArchetype?.id === JAZZ_5_4_ARCHETYPE_ID
    || jazzArchetype?.id === JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID;
  const jazzFiveFourLeadDirectives = jazzArchetype?.id === JAZZ_5_4_ARCHETYPE_ID
    ? planJazzFiveFourLeadDirectives({
      enabled: true,
      mode: 'generative',
      seed: opts.rng?.substream('jazzFiveFourLead').int(0x7fffffff) ?? 0,
      meter: time.meter,
      sections,
      phrases,
    })
    : planJazzFiveFourLeadDirectives({
      enabled: jazzFiveFourLeadEnabled,
      mode: 'canonical-reference',
      meter: time.meter,
      sections,
      phrases,
    });
  const jazzFiveFourEnsembleRng = opts.rng?.substream('jazzFiveFourEnsemble');
  const jazzFiveFourEnsembleScore = jazzArchetype?.id === JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID
    ? planJazzFiveFourEnsembleScore({
      mode: 'canonical-reference',
      meter: time.meter,
      sections,
      phrases,
    })
    : jazzArchetype?.id === JAZZ_5_4_ARCHETYPE_ID
      ? planJazzFiveFourEnsembleScore({
        mode: 'generative',
        seed: jazzFiveFourEnsembleRng?.int(0x7fffffff) ?? 0,
        // The current piano arrangement deliberately keeps the opening Bass
        // silent after the handoff; a future form may explicitly select a return.
        codaDirective: { returnMode: 'continue-comp-foundation' },
        meter: time.meter,
        sections,
        phrases,
      })
      : undefined;
  const dynamics = planDynamics(sections);
  const grooveBySection = planGroove(sections, band.style, opts.mood); // 鼓 groove 下发(纯 functionTag/role 派生,不抽 rng)
  const edges = planEdges(sections, dynamics.energyBySection, band.style, opts.mood); // 段落边界:进入方式 + 收尾(纯 energy/style 派生)
  const entryBySection = { ...edges.entryBySection };
  // Exact archetypes own role handoffs. In the 5/4 piano form Comp must not be
  // pulled into the Bass+Lead prep bar merely because the next section has
  // more energy.
  if (sectionPolicyById) {
    for (const section of sections) {
      const authoredEntry = sectionPolicyById[section.id]?.entryMode;
      if (authoredEntry) entryBySection[section.id] = authoredEntry;
    }
  }
  const openingGesture = planOpeningGesture(sections, band, opts.rng?.substream('openingGesture')); // 全曲开头入场导演(独立子流)
  // ★ GrooveContract(arranger 拥有)。Phase D 起全 MG-backed 风格(POP/JAZZ/RNB/LOFI/ACG)走真 pool
  //   (独立 grooveContract 子流);BLUES/无 rng → legacy 派生兜底。feel.swingRatio 从 contract.compSwingRatio 派生。
  // JAZZ 两条主线都使用 archetype 明确指定的合同；非 JAZZ 仍走原 pool。
  const groove = jazzGrooveContract
    ? {
      song: jazzGrooveContract,
      bySection: Object.fromEntries(sections.map((section) => [section.id, jazzGrooveContract])),
    }
    : planGrooveContract(sections, band.style, time.feel, opts.rng, opts.mood);
  const grooveScorePlan = planGrooveScore(
    sections,
    groove.bySection,
    dynamics.energyBySection,
    entryBySection,
    openingGesture,
    {
      climaxMap: dynamics.climaxMap,
      fillVariantSeed: opts.rng?.substream('drumFill').int(0x7fffffff),
      bassPatternIdBySection: Object.fromEntries(sections.map((section) => [
        section.id,
        sectionPolicyById?.[section.id]
          && !sectionPolicyById[section.id].activeRoles.includes('bass')
          ? undefined
          : sectionPolicyById?.[section.id]?.rolePatternByRole.bass
            ?? groove.bySection[section.id]?.bassPattern,
      ])),
      // The archetype role map also contains ordinary renderer vocabulary
      // (walking bass, MG lead, generic comp). Only IDs registered as typed
      // RoleRhythmPatterns belong in the strict materialization path.
      rolePatternBySection: Object.fromEntries(sections.map((section) => {
        const references = sectionPolicyById?.[section.id]?.rolePatternByRole ?? {};
        return [section.id, Object.fromEntries(
          Object.entries(references).filter(([role, id]) => roleRhythmPattern(id)?.role === role),
        )];
      })),
    },
  );
  const drumPerformanceBySection = planDrumPerformance(
    sections,
    band.style,
    groove.bySection,
    dynamics.energyBySection,
    entryBySection,
    openingGesture.drumEntry,
    grooveScorePlan,
  );
  if (sectionPolicyById) {
    for (const section of sections) {
      if (sectionPolicyById[section.id]?.activeRoles.includes('drum')) continue;
      const current = drumPerformanceBySection[section.id];
      drumPerformanceBySection[section.id] = {
        ...current,
        id: `${section.id}:drum:${groove.bySection[section.id].id}:silent`,
        role: 'silent',
        complexity: 0,
        intensity: 0,
        densityCeiling: 0,
        entryMode: 'none',
        fillPolicy: 'none',
        fillAmount: 0,
        fillComplexity: 0,
        phraseVariation: 0,
      };
    }
  }
  const rolePerformanceBySection = planRolePerformance(
    sections,
    band.style,
    band.instrumentPool,
    groove.bySection,
    dynamics.densityBySection,
    entryBySection,
    drumPerformanceBySection,
  );
  if (sectionPolicyById) {
    for (const section of sections) {
      const policy = sectionPolicyById[section.id];
      const active = new Set(policy.activeRoles.filter((role) => band.instrumentPool.includes(role)));
      for (const role of Object.keys(rolePerformanceBySection) as InstrumentRoleName[]) {
        const current = rolePerformanceBySection[role][section.id];
        const roleActive = active.has(role);
        rolePerformanceBySection[role][section.id] = {
          ...current,
          active: roleActive,
          entryMode: roleActive ? current.entryMode : 'none',
          foreground: roleActive && role === policy.foregroundRole,
          foregroundRole: policy.foregroundRole,
          densityBudget: roleActive ? current.densityBudget : 0,
          continuity: roleActive ? current.continuity : 'none',
          articulationScope: roleActive ? current.articulationScope : 'none',
          articulationExclusionGroup: roleActive ? current.articulationExclusionGroup : 'none',
          phrasePolicy: roleActive ? current.phrasePolicy : 'none',
          fillPolicy: 'none',
        };
      }
    }
  }

  const data: ArrangementPlanData = {
    sections,
    phrases,
    motifBindings,
    tempoBpm: time.tempoBpm,
    meter: time.meter,
    feel: { ...time.feel, swingRatio: groove.song.compSwingRatio },
    phraseBreathing: time.phraseBreathing,
    energyBySection: dynamics.energyBySection,
    densityBySection: dynamics.densityBySection,
    climaxMap: dynamics.climaxMap,
    harmonicRhythmTarget: dynamics.harmonicRhythmTarget,
    grooveBySection,
    grooveScorePlan,
    drumPerformanceBySection,
    rolePerformanceBySection,
    leadCompCollisionPolicy: 'no-unison-when-same-program',
    arrangementArchetypeId: jazzArchetype?.id,
    acgPianoArrangementProfileId: acgPianoArrangementProfile?.id,
    acousticInstrumentationIntent: acousticInstrumentationIntentForStyle(band.style),
    resolvedArchetype,
    jazzFiveFourHarmonyDirectives,
    jazzFiveFourLeadDirectives,
    jazzFiveFourEnsembleScore,
    songGrooveContract: groove.song,
    songGrooveContractId: groove.song.id,
    grooveContractBySection: groove.bySection,
    entryBySection,
    openingGesture,
    endingStyle: edges.endingStyle,
  };

  return freezeArrangementPlan(data);
}
