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
  SectionId,
} from './ArrangementPlan';

const ROLE_ENERGY: Record<Section['role'], number> = {
  intro: 0.3,
  verse: 0.6,
  chorus: 0.9,
  bridge: 0.7,
  outro: 0.3,
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
    const e = ROLE_ENERGY[s.role];
    energyBySection[s.id] = e;
    densityBySection[s.id] = e;
    // 高潮手段之一:chorus 和声节奏加密
    chordsPerBarBySection[s.id] = s.role === 'chorus' ? 2 : 1;
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
