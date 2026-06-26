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

export interface ArrangementOptions {
  rng?: RandomContext; // 有 → seed 选曲式 + 段落长度变化(不同 seed 不同曲式)
  template?: FormTemplate; // 显式固定曲式(测试/特化)
}

export function buildArrangementPlan(
  band: BandSpec,
  opts: ArrangementOptions = {},
): ArrangementPlan {
  const sections = planForm({ rng: opts.rng?.substream('arranger'), template: opts.template, style: band.style });
  const time = planTime(band.style, opts.rng?.substream('time')); // tempo 随 seed 在风格区间浮动
  const { phrases, motifBindings } = planPhrases(sections, time.phraseBreathing.phraseBars);
  const dynamics = planDynamics(sections);
  const grooveBySection = planGroove(sections, band.style); // 鼓 groove 下发(纯 functionTag/role 派生,不抽 rng)
  const edges = planEdges(sections, dynamics.energyBySection, band.style); // 段落边界:进入方式 + 收尾(纯 energy/style 派生)
  // ★ MG 升级 Phase 1:GrooveContract(arranger 拥有)。ACG 走新 pool(独立 grooveContract 子流);非 ACG 派生
  //   legacy(零洗牌,swing=feel.swingRatio/pocket=0)。feel.swingRatio 改从 contract.compSwingRatio 派生(非 ACG 等值不变)。
  const groove = planGrooveContract(sections, band.style, time.feel, opts.rng);

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
    songGrooveContract: groove.song,
    songGrooveContractId: groove.song.id,
    grooveContractBySection: groove.bySection,
    entryBySection: edges.entryBySection,
    endingStyle: edges.endingStyle,
  };

  return freezeArrangementPlan(data);
}
