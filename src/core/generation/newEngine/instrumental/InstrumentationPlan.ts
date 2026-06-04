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
  registerByRole: Record<InstrumentRoleName, RegisterRange>;
  textureBySection: Record<SectionId, TextureKind>;
  textureYieldPolicy: Record<TextureKind, YieldClass>;
  melodyReservationPlan: MelodyReservationPlan;
}

export type InstrumentationPlan = DeepReadonly<InstrumentationPlanData>;

export function freezeInstrumentationPlan(data: InstrumentationPlanData): InstrumentationPlan {
  return deepFreeze(data);
}
