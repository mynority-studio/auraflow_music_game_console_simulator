// ============================================================
// newEngine · arranger · DynamicsPlanner
// ------------------------------------------------------------
// 架构定稿 Part 3.2 / 战线5:能量/密度/高潮 → 下发给 Harmony 的强度目标。
// 宏观先于和声:这里定走向(chorus 高潮),Harmony 据 harmonicRhythmTarget 落实和声节奏。
// Slice 1:per-section 标量;最后一个 chorus = 全曲高潮峰。
// ============================================================

import type {
  ClimaxPoint,
  HarmonicRhythmTarget,
  Section,
  SectionFunctionTag,
  SectionId,
} from './ArrangementPlan';

// 回退能量(无 functionTag 的 legacy/template 段)。
const ROLE_ENERGY: Record<Section['role'], number> = {
  intro: 0.3,
  verse: 0.6,
  chorus: 0.9,
  bridge: 0.7,
  outro: 0.3,
};

// ★ functionTag 能量(CODEX V4.2):风格差异自然来自【各风格用不同 tag】——
//   lofi 只用 loop/breakdown/setup/outro(峰值 loop 0.48 < 0.6,永不碰 hook);
//   jazz 用 head/solo/headOut(峰 solo 0.72,不吃 pop 0.9 chorus);pop/rnb 才用 hook。
//   breakdown 显著低于邻段;不靠 chordsPerBar 伪装层次。
const ENERGY_BY_FUNCTION: Record<SectionFunctionTag, number> = {
  setup: 0.32,
  story: 0.52,
  build: 0.66,
  hook: 0.80,
  breakdown: 0.35,
  loop: 0.48,
  head: 0.62,
  solo: 0.72,
  headOut: 0.70,
  tag: 0.45,
  outro: 0.30,
};

export interface DynamicsPlan {
  energyBySection: Record<SectionId, number>;
  densityBySection: Record<SectionId, number>;
  climaxMap: ClimaxPoint[];
  harmonicRhythmTarget: HarmonicRhythmTarget;
}

export function planDynamics(sections: Section[]): DynamicsPlan {
  const energyBySection: Record<SectionId, number> = {};
  const densityBySection: Record<SectionId, number> = {};
  const chordsPerBarBySection: Record<SectionId, number> = {};

  for (const s of sections) {
    // functionTag 优先(风格级能量轮廓),无则回退 role。
    const e = s.functionTag ? ENERGY_BY_FUNCTION[s.functionTag] : ROLE_ENERGY[s.role];
    energyBySection[s.id] = e;
    densityBySection[s.id] = e;
    // ★ 去掉无条件 chorus⇒2:统一 1 chord/bar,段落层次交给 harmonyRole 选 prototype(prototype 自带节奏),
    //   不靠 chordsPerBar 伪装(对 pop/lofi/jazz 都易过密)。
    chordsPerBarBySection[s.id] = 1;
  }

  // 全曲高潮 = 最后一个 chorus(峰值 intensity=1)
  const choruses = sections.filter((s) => s.role === 'chorus');
  const climaxMap: ClimaxPoint[] = choruses.length
    ? [{ sectionId: choruses[choruses.length - 1].id, intensity: 1 }]
    : [];

  return {
    energyBySection,
    densityBySection,
    climaxMap,
    harmonicRhythmTarget: { chordsPerBarBySection },
  };
}
