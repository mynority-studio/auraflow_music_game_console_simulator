// ============================================================
// newEngine · knowledge · Style Intent Profiles(mg_intent_planning_layer_migration_directive_v2 §5.1)
// ------------------------------------------------------------
// 逐 style 的【偏好/MG-like family 规则】—— 不生成音符,只声明 intent 偏好。派生器(deriveMusicIntentPlan)读它。
// ★ 决策(用户 2026-07-03):派生来源 = SIM-native 纯函数,MG oracle 仅校准。此处规则来自【已移植 MG-KB 的
//   聚合观测 + GrooveContract 家族】,不逐 seed 跑 MG,不追 concrete case,只追 MG-like family/密度/onset-form。
// ★ finalEventProfile.ts【不删】:bassFloorBeats 仍是 render bass 地板真源;此处把它【升格】成 style intent 的
//   bass 偏好投影(Phase 2 再把 render 地板包成 BassPatternSchedule,行为等价)。
// ============================================================

import type { StyleName } from './mgMusicTheory';
import type { BassPatternFamily, TextureFamily } from '../intent/MusicIntentPlan';
import { finalEventProfile } from './finalEventProfile';

export interface StyleIntentProfile {
  // bass 偏好(MG bass/bar 参考:LOFI~2.6 · RNB~3.8 · JAZZ~3.75 · POP~1.06 · ACG~2.5)。
  bassFamily: BassPatternFamily;
  bassTargetNotesPerBar: [number, number];
  // texture family 默认(placeholder,Phase 1 observe;Phase 3 用 section-energy + 和声动量精化,见 [acgRenderProfile])。
  defaultTextureFamily: TextureFamily;
  // ★ Phase 6:lead coverage 意图区间(MG 参考:RNB~0.5·POP~0.6·LOFI~0.4·JAZZ~0.55·ACG cantabile~0.4)。observe(不 post-cap)。
  leadTargetCoverage: [number, number];
  leadMaxGapBeats: number;
}

const PROFILES: Record<string, StyleIntentProfile> = {
  acg: { bassFamily: 'minimal', bassTargetNotesPerBar: [2, 3], defaultTextureFamily: 'roll', leadTargetCoverage: [0.3, 0.6], leadMaxGapBeats: 8 },
  pop: { bassFamily: 'rootAnchor', bassTargetNotesPerBar: [1, 2], defaultTextureFamily: 'block', leadTargetCoverage: [0.5, 0.7], leadMaxGapBeats: 4 },
  jazz: { bassFamily: 'walking', bassTargetNotesPerBar: [3, 4], defaultTextureFamily: 'block', leadTargetCoverage: [0.45, 0.7], leadMaxGapBeats: 4 },
  rnb: { bassFamily: 'syncopated', bassTargetNotesPerBar: [2, 4], defaultTextureFamily: 'roll', leadTargetCoverage: [0.4, 0.65], leadMaxGapBeats: 4 },
  lofi: { bassFamily: 'rootAnchor', bassTargetNotesPerBar: [2, 3], defaultTextureFamily: 'wash', leadTargetCoverage: [0.3, 0.6], leadMaxGapBeats: 5 },
  blues: { bassFamily: 'walking', bassTargetNotesPerBar: [2, 4], defaultTextureFamily: 'block', leadTargetCoverage: [0.45, 0.7], leadMaxGapBeats: 4 },
};

export function styleIntentProfile(style: StyleName | string): StyleIntentProfile {
  return PROFILES[String(style).toLowerCase()] ?? { bassFamily: 'rootAnchor', bassTargetNotesPerBar: [1, 2], defaultTextureFamily: 'block', leadTargetCoverage: [0.5, 0.7], leadMaxGapBeats: 4 };
}

/** bass 地板拍位数 → style 默认家族；具体 archetype pattern 由 Arranger 另行覆盖。 */
export function bassFamilyFromFloorBeats(
  style: string,
  _beatsPerBar?: number,
): BassPatternFamily {
  const beats = finalEventProfile(style).bassFloorBeats.length;
  if (String(style).toLowerCase() === 'jazz') return 'walking';
  if (beats >= 3) return 'syncopated';
  if (beats >= 1) return 'rootAnchor';
  return 'minimal';
}
