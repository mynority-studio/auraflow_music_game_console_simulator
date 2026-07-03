// ============================================================
// newEngine · render · Bass Pattern Schedule 消费者(mg_intent_planning_layer_migration §6.1 / Phase 2)
// ------------------------------------------------------------
// bass floor 的 intent 版:从 MusicIntentPlan 的逐段 BassPatternSlot.family 读地板拍位,复用 addRootAnchorFloor 共享核心。
// ★ 等价:只要 family→floorBeats 与 finalEventProfile.bassFloorBeats 对齐、intro/outro=minimal(=不补),输出与
//   enforceBassDensityFloor 逐字节相同(由共享核心 + 相同 floorBeats 构造保证)。Phase 2【不接线 renderer】,等签字。
// ============================================================

import type { TrackIR } from '../ir/MusicalIR';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { BassPatternFamily } from '../intent/MusicIntentPlan';
import type { MusicIntentPlan } from '../intent/MusicIntentPlan';
import { addRootAnchorFloor, type SectionLike } from './bassDensityFloor';

/** family → 地板强拍位。与 finalEventProfile.bassFloorBeats 对齐(rootAnchor=[0,2]·syncopated=[0,2,3]·walking=[0,1,2,3])。
 *  minimal / 其它非 anchor 家族 → 不补(与 POP/ACG 无地板一致)。 */
export const FAMILY_FLOOR_BEATS: Record<BassPatternFamily, readonly number[]> = {
  minimal: [],
  rootAnchor: [0, 2],
  syncopated: [0, 2, 3],
  walking: [0, 1, 2, 3],
  pedal: [],
  broken: [],
  octaveAlternate: [],
  fifthDrop: [],
};

/** 从 intent plan 逐段读 bass family → 地板拍位,补 root anchor。sections 与 intentPlan.sections 同序(同 arranger 派生)。 */
export function applyBassPatternSchedule(
  bass: TrackIR,
  plan: HarmonicPlan,
  sections: readonly SectionLike[],
  intentPlan: MusicIntentPlan,
  bpb: number,
  ppq: number,
): TrackIR {
  return addRootAnchorFloor(bass, plan, sections, bpb, ppq, (_s, index) => {
    const fam = intentPlan.sections[index]?.bassPatternSchedule?.slots[0]?.family;
    return fam ? FAMILY_FLOOR_BEATS[fam] : [];
  });
}
