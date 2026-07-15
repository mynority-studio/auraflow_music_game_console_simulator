// ============================================================
// newEngine · arranger · Arranger(组合 4 planner → ArrangementPlan)
// ------------------------------------------------------------
// 架构定稿 Part 5 / 铁律1:最高权威。BandSpec → 曲式/时间/能量/乐句/排比。
// 内部拆 Form/Time/Dynamics/Phrase 子模块(避免上帝层)。输出 deepFreeze。
// ============================================================

import type { BandSpec } from '../band/BandSpec';
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
import { planRolePerformance } from './performanceContractPlanner';
import { beatsPerBarOf } from './phraseTiming';

export interface ArrangementOptions {
  rng?: RandomContext; // 有 → seed 选曲式 + 段落长度变化(不同 seed 不同曲式)
  template?: FormTemplate; // 显式固定曲式(测试/特化)
  mood?: string; // 请求情绪提示:复用现有 POP ballad / lyrical 编配素材,不新增 macro
  targetDuration?: number; // 秒；由实际 tempo/meter 换算为 form 的目标小节预算
}

export function buildArrangementPlan(
  band: BandSpec,
  opts: ArrangementOptions = {},
): ArrangementPlan {
  const time = planTime(band.style, opts.rng?.substream('time'), opts.mood); // tempo 随 seed 在风格区间浮动
  const targetBars = opts.targetDuration !== undefined && Number.isFinite(opts.targetDuration) && opts.targetDuration > 0
    ? opts.targetDuration * time.tempoBpm / 60 / beatsPerBarOf(time.meter)
    : undefined;
  const sections = planForm({
    rng: opts.rng?.substream('arranger'),
    template: opts.template,
    style: band.style,
    targetBars,
  });
  const { phrases, motifBindings } = planPhrases(sections, time.phraseBreathing.phraseBars);
  const dynamics = planDynamics(sections);
  const grooveBySection = planGroove(sections, band.style, opts.mood); // 鼓 groove 下发(纯 functionTag/role 派生,不抽 rng)
  const edges = planEdges(sections, dynamics.energyBySection, band.style, opts.mood); // 段落边界:进入方式 + 收尾(纯 energy/style 派生)
  const openingGesture = planOpeningGesture(sections, band, opts.rng?.substream('openingGesture')); // 全曲开头入场导演(独立子流)
  // ★ GrooveContract(arranger 拥有)。Phase D 起全 MG-backed 风格(POP/JAZZ/RNB/LOFI/ACG)走真 pool
  //   (独立 grooveContract 子流);BLUES/无 rng → legacy 派生兜底。feel.swingRatio 从 contract.compSwingRatio 派生。
  const groove = planGrooveContract(sections, band.style, time.feel, opts.rng, opts.mood);
  const drumPerformanceBySection = planDrumPerformance(
    sections,
    band.style,
    groove.bySection,
    dynamics.energyBySection,
    edges.entryBySection,
    openingGesture.drumEntry,
  );
  const rolePerformanceBySection = planRolePerformance(
    sections,
    band.style,
    band.instrumentPool,
    groove.bySection,
    dynamics.densityBySection,
    edges.entryBySection,
    drumPerformanceBySection,
  );

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
    drumPerformanceBySection,
    rolePerformanceBySection,
    songGrooveContract: groove.song,
    songGrooveContractId: groove.song.id,
    grooveContractBySection: groove.bySection,
    entryBySection: edges.entryBySection,
    openingGesture,
    endingStyle: edges.endingStyle,
  };

  return freezeArrangementPlan(data);
}
