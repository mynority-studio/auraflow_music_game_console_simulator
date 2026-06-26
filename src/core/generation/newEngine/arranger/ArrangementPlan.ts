// ============================================================
// newEngine · arranger · ArrangementPlan 契约
// ------------------------------------------------------------
// 架构定稿 Part 2.3:Arranger 输出(最高权威)。值对象快照,deepFreeze。
// motifBindings = 凝聚力引擎(slot→motifId+排比);restatementStrength 连续标量。
// Slice 1:curves 简化为 per-section 标量;tempoCurve / 连续曲线后续叠加。
// ============================================================

import { deepFreeze, type DeepReadonly, type Meter } from '../foundation';
import type { GrooveKind } from '../knowledge/grooves';

export type SectionId = string;
export type PhraseId = string;
export type MotifId = string;
export type MotifBindingId = string;
export type RepeatGroupId = string;

export type SectionRole = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';
export type HookPolicy = 'none' | 'light' | 'main' | 'call-response';

// ★ 风格编排吸纳(CODEX V4.2,分层加字段,不动管道):
//   harmonyRole → progressionSelector 选 prototype(值集 = KB ProtoSectionRole,直接可传);
//   functionTag → dynamics 能量 / phrase hook scope 的轻量语义;
//   linkOut    → harmony 段尾骨架链接(标意图;T6 才落实,当前 inert)。三者皆可选,向后兼容。
export type HarmonySectionRole = 'intro' | 'verse' | 'chorus' | 'bridge' | 'ending' | 'loop';
export type SectionFunctionTag =
  | 'setup' | 'story' | 'build' | 'hook' | 'breakdown'
  | 'loop' | 'head' | 'solo' | 'headOut' | 'tag' | 'outro';
export type HarmonyLinkKind =
  | 'none'
  | 'dominantLift'              // IV -> V -> next I/vi
  | 'secondaryToRelativeMinor' // IV -> III7 -> next vi
  | 'backdoorToSubdominant'    // v/IV -> I7/IV -> next IV
  | 'minorIvHold'              // iv hold -> next I/vi
  | 'stopOnDominant';          // V stop -> next hook impact

// ★ 段落【边界行为】(2026-06-08,修 intro→verse 衔接 / outro 收尾):
//   entry = 本段乐器【怎么进来】:'lead-in'=上一段末小节铺垫推进到本段下拍(release,能量跃升处);'downbeat'=直入(重复段/无跃升)。
//   ending = 全曲【怎么收尾】(风格定制,不改 tempo):'cold'=末和弦干净停(button);'fade'=逐件抽离+音量渐弱;'tag'=末和弦延留+节奏件先退(渐慢感)。
export type SectionEntry = 'downbeat' | 'lead-in';
export type EndingStyle = 'cold' | 'fade' | 'tag';

export interface Section {
  id: SectionId;
  role: SectionRole;              // legacy 投影(render/texture/trace),五类不变
  harmonyRole?: HarmonySectionRole; // 给 progressionSelector(可选;缺省回退 role 映射)
  functionTag?: SectionFunctionTag; // 给 dynamics / phrase(可选;缺省回退 role)
  linkOut?: HarmonyLinkKind;        // 段尾和声链接意图(T6 落实;当前未消费)
  bars: number;
  repeatGroup?: RepeatGroupId;
  hookPolicy: HookPolicy;
}

export type PhraseRole = 'antecedent' | 'consequent' | 'climax' | 'cadence' | 'link' | 'fill';
export type SkeletonRole = 'hook' | 'connector' | 'cadence' | 'fill';
export type CadenceTarget = 'open' | 'half' | 'authentic' | 'climax';

export interface Phrase {
  id: PhraseId;
  sectionId: SectionId;
  bars: number;
  phraseSlot: number;
  role: PhraseRole;
  cadenceTarget: CadenceTarget;
  repeatGroup?: RepeatGroupId;
  skeletonRole: SkeletonRole;
}

export interface MotifBinding {
  id: MotifBindingId;
  motifId: MotifId;
  phraseId: PhraseId;
  repeatGroup?: RepeatGroupId;
  requestedRestatementStrength: number; // 0..1,Arranger 戏剧意图(不可变)
}

export type FeelKind = 'straight' | 'swing' | 'shuffle' | 'half-time' | 'double-time';
export interface Feel {
  kind: FeelKind;
  swingRatio: number;
}

export interface PhraseBreathing {
  phraseBars: number;
  cadenceBreathBeats: number;
}

export interface ClimaxPoint {
  sectionId: SectionId;
  intensity: number; // 0..1
}

export interface HarmonicRhythmTarget {
  chordsPerBarBySection: Record<SectionId, number>;
}

export interface ArrangementPlanData {
  sections: Section[];
  phrases: Phrase[];
  motifBindings: MotifBinding[];
  tempoBpm: number;
  meter: Meter;
  feel: Feel;
  phraseBreathing: PhraseBreathing;
  energyBySection: Record<SectionId, number>;
  densityBySection: Record<SectionId, number>;
  climaxMap: ClimaxPoint[];
  harmonicRhythmTarget: HarmonicRhythmTarget;
  /** ★ 每段鼓 groove 性格(Arranger 下发,器配层据此匹配具体 drum pattern 变体)。swing 不在此,走 feel.swingRatio。 */
  grooveBySection: Record<SectionId, GrooveKind>;
  // ★ MG 升级 Phase 1:GrooveContract(comp/melody 分开 swing + ms pocket + texture 偏好);arranger 拥有,render 消费。
  //   非 ACG = legacy 派生(零洗牌);grooveBySection(GrooveKind)保留作 drum 兼容字段。
  songGrooveContract: import('../knowledge/grooveContracts').GrooveContract;
  songGrooveContractId: string;
  grooveContractBySection: Record<SectionId, import('../knowledge/grooveContracts').GrooveContract>;
  /** ★ 每段乐器【进入方式】(Arranger 下发,修 intro→verse 衔接):能量跃升处=lead-in(上段末小节铺垫推进),其余=downbeat 直入。 */
  entryBySection: Record<SectionId, SectionEntry>;
  /** ★ 全曲【收尾方式】(Arranger 下发,风格定制,修戛然而止):器配据此排乐器退出、render 出渐弱/延留/冷收手势。 */
  endingStyle: EndingStyle;
}

export type ArrangementPlan = DeepReadonly<ArrangementPlanData>;

export function freezeArrangementPlan(data: ArrangementPlanData): ArrangementPlan {
  return deepFreeze(data);
}
