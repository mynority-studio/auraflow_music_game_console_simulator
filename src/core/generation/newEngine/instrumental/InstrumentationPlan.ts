// ============================================================
// newEngine · instrumental · InstrumentationPlan 契约
// ------------------------------------------------------------
// 架构定稿 Part 2.5 / 铁律16:器配 / 织体 / 旋律预留。值对象快照,deepFreeze。
// textureYieldPolicy 按织体分流(active comp 让位 / pad 不让位)。
// melodyReservationPlan.hookAnchorSlots = 伴奏生成前就知道的 hook【窗口+要求】;
//   具体锚点音高由 Prepass 填进候选池(2.6/2.7)。
// Slice 1:voicingPlan/articulationPlan/silencePlan 待消费者到位再补(轻耦合)。
// ============================================================

import { deepFreeze, type DeepReadonly, type Midi } from '../foundation';
import type { InstrumentRoleName } from '../band/BandSpec';
import type { PhraseId, SectionId } from '../arranger/ArrangementPlan';
import type { GenericTextureKind, GenericTextureYield } from '../knowledge/textureProfiles';
import type { TimbreWorld } from '../knowledge/instruments';

// ★ 织体种类 / 让位类的真源在 KB(knowledge/textureProfiles);此处仅按契约名复用(用户定:织体归 KB)。
export type TextureKind = GenericTextureKind;
export type YieldClass = GenericTextureYield;

export interface RegisterRange {
  lowMidi: Midi;
  highMidi: Midi;
}

export interface HookAnchorSlot {
  phraseId: PhraseId;
  beatSlot: number;            // hook 句在曲中的起拍(绝对拍位)
  preferredRegister: RegisterRange;
  anchorRequired: boolean;     // 主 hook(chorus)强制让位
  segment: 'head' | 'tail' | 'full-motif';
  maxAccompanimentDensity: number;
}

export interface MelodyReservationPlan {
  reservedRegister: RegisterRange;
  densityCeiling: number;
  hookAnchorSlots: HookAnchorSlot[];
}

export interface InstrumentationPlanData {
  activityBySection: Record<SectionId, Partial<Record<InstrumentRoleName, number>>>;
  // ★ 编曲密度弧(A1):每段【在场的乐手子集】(genre×functionTag×lineup 确定性推出)。
  //   render 按此 gate(谁在哪段进/出)→ intro 稀疏 / chorus 全员同进 / breakdown 抽离。
  //   无 functionTag/genre 的段 = 全 lineup(向后兼容)。lead 当前全程在场(gating 留后续)。
  activeRolesBySection: Record<SectionId, InstrumentRoleName[]>;
  registerByRole: Record<InstrumentRoleName, RegisterRange>;
  textureBySection: Record<SectionId, TextureKind>;
  textureYieldPolicy: Record<TextureKind, YieldClass>;
  // ★ 器配:每乐手(角色)× 每段落的音色(GM program)。大多全曲=primary;comp/lead 偶尔 chorus 换同族备选。
  //   同一乐手换声音(效果器/电钢切音色)→ render 落 programChange 事件,不换轨/通道。
  programByRoleSection: Record<InstrumentRoleName, Record<SectionId, number>>;
  // ★ 音色世界统一性(可观测;不参与避让/render):timbreWorld = 本曲音色世界分类;
  //   sameInstrumentPairs = 同乐器对(lead==comp 等,记录不拒绝)。GM program 仍由 programByRoleSection 承载。
  timbreWorld?: TimbreWorld;
  sameInstrumentPairs?: { a: InstrumentRoleName; b: InstrumentRoleName; program: number }[];
  melodyReservationPlan: MelodyReservationPlan;
}

export type InstrumentationPlan = DeepReadonly<InstrumentationPlanData>;

export function freezeInstrumentationPlan(data: InstrumentationPlanData): InstrumentationPlan {
  return deepFreeze(data);
}
