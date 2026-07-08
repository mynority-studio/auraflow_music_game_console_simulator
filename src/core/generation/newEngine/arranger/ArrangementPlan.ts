// ============================================================
// newEngine · arranger · ArrangementPlan 契约
// ------------------------------------------------------------
// 架构定稿 Part 2.3:Arranger 输出(最高权威)。值对象快照,deepFreeze。
// motifBindings = 凝聚力引擎(slot→motifId+排比);restatementStrength 连续标量。
// Slice 1:curves 简化为 per-section 标量;tempoCurve / 连续曲线后续叠加。
// ============================================================

import { deepFreeze, type DeepReadonly, type Meter } from '../foundation';
import type { InstrumentRoleName } from '../band/BandSpec';
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

// ★ 全曲开头【入场导演】(arranger 层,render 后续消费):
//   只决定首段怎么铺、鼓怎么进、各 role 延迟几小节;不改和声 brick、不指定 GM 音色、不突破 band lineup。
export type OpeningGestureMode =
  | 'coldDownbeat'
  | 'pickupFill'
  | 'textureFadeIn'
  | 'riffFirst'
  | 'drumsFirst'
  | 'rubatoKeys';
export type OpeningDrumEntry =
  | 'none'
  | 'hatsOnly'
  | 'kickOnly'
  | 'backbeatDelayed'
  | 'fourOnFloorRamp'
  | 'rideOnly'
  | 'brushLoop'
  | 'halftimePocket'
  | 'tomPickup';
export type OpeningTextureEntry =
  | 'none'
  | 'pianoRiff'
  | 'rhodesDust'
  | 'padSwell'
  | 'stringOstinato'
  | 'synthPulse'
  | 'guitarMute'
  | 'bellMotif'
  | 'vinylNoise';
export type OpeningRole = 'bass' | 'comp' | 'pad' | 'lead' | 'drum';
export type OpeningIntensity = 'soft' | 'medium' | 'bold';
export interface OpeningGesturePlan {
  sectionId: SectionId;
  mode: OpeningGestureMode;
  drumEntry: OpeningDrumEntry;
  textureEntry: OpeningTextureEntry;
  roleDelayBars: Partial<Record<OpeningRole, number>>;
  pickupBars: 0 | 1;
  intensity: OpeningIntensity;
}

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

export type DrumPerformanceRole = 'silent' | 'timekeeper' | 'lift' | 'breakdown' | 'pickup';
export type DrumPatternFamily =
  | 'citypop-disco-boogie'
  | 'pop-backbeat'
  | 'jpop-driving-8ths'
  | 'ballad-halftime'
  | 'rnb-neo-soul'
  | 'rnb-dilla'
  | 'rnb-gospel-shuffle'
  | 'trap-soul-halftime'
  | 'lofi-boombap'
  | 'lofi-dusty-break'
  | 'lofi-minimal'
  | 'smooth-jazz-backbeat'
  | 'jazz-swing-ride'
  | 'jazz-bebop-comping'
  | 'jazz-ballad-light'
  | 'jazz-bossa';
export type DrumEntryMode = 'none' | 'hat-only' | 'kick-only' | 'kick-hat' | 'ride-only' | 'full' | 'dropout';
export type DrumFillPolicy = 'none' | 'light' | 'turnaround' | 'big';
export type DrumSwingUnit = '8th' | '16th';
export type DrumTimingProfile = 'tight' | 'behind-snare' | 'dilla-late' | 'swing-ride';
export type DrumVelocityProfile = 'flat' | 'backbeat' | 'ghosted' | 'crescendo';
export type DrumKickPolicy = 'anchor-only' | 'four-on-floor' | 'syncopated' | 'halftime';
export type DrumSnarePolicy = 'backbeat' | 'rim' | 'ghost-before-backbeat' | 'jazz-comping';
export type DrumHatPolicy = 'quarters' | 'eighths' | 'sixteenths' | 'shaker16' | 'ride' | 'pedal-hat';
export type DrumCymbalPolicy = 'none' | 'section-crash' | 'hook-crash';
export type DrumTomPolicy = 'none' | 'turnaround' | 'big-fill';
export type DrumForegroundGuard = 'strict' | 'normal';
export type PerformanceContinuity = 'none' | 'staccato' | 'connected' | 'legato-flow' | 'pedal-legato';
export type PerformanceArticulationScope = 'none' | 'attribute' | 'direction';
export type PerformanceArticulationExclusionGroup = 'none' | 'length' | 'pedal' | 'breath' | 'rudiment';
export type PerformanceFollowSource = 'none' | 'chords' | 'bass' | 'comp' | 'lead' | 'drum';
export type PerformancePreQuantizeGrid = 'none' | '8th' | '16th';

export interface ScorePerformanceContract {
  sectionId: SectionId;
  grooveContractId: string;
  foregroundRole: InstrumentRoleName;
  rhythmGrid: import('../knowledge/grooveContracts').GrooveGrid;
  swingUnit: DrumSwingUnit;
  safeRangeTicks: number;
  maxMoveTicks: number;
  preQuantizeGrid: PerformancePreQuantizeGrid;
  humanizeAmount: 0 | 1 | 2 | 3;
  dynamicsRange: 0 | 1 | 2 | 3;
}

export interface RolePerformanceContract extends ScorePerformanceContract {
  id: string;
  role: InstrumentRoleName;
  entryMode: 'none' | 'downbeat' | 'delayed' | 'pickup' | 'sustain' | 'dropout';
  active: boolean;
  foreground: boolean;
  densityBudget: number;
  continuity: PerformanceContinuity;
  articulationScope: PerformanceArticulationScope;
  articulationExclusionGroup: PerformanceArticulationExclusionGroup;
  phrasePolicy: 'none' | 'breath-group' | 'bow-group' | 'pick-voice' | 'pluck-voice' | 'pedal-harmony' | 'rudiment-bar' | 'sustain-bed';
  fillPolicy: DrumFillPolicy;
  phraseVariation: 0 | 1 | 2 | 3;
  feelOffsetMs: number;
  followSource: PerformanceFollowSource;
}

export interface DrumPerformanceContract {
  id: string;
  sectionId: SectionId;
  role: DrumPerformanceRole;
  patternFamily: DrumPatternFamily;
  complexity: 0 | 1 | 2 | 3;
  intensity: 0 | 1 | 2 | 3;
  densityCeiling: number;
  entryMode: DrumEntryMode;
  fillPolicy: DrumFillPolicy;
  fillAmount: 0 | 1 | 2 | 3;
  fillComplexity: 0 | 1 | 2 | 3;
  phraseVariation: 0 | 1 | 2 | 3;
  swingUnit: DrumSwingUnit;
  timingProfile: DrumTimingProfile;
  safeRangeTicks: number;
  maxMoveTicks: number;
  preQuantizeGrid: PerformancePreQuantizeGrid;
  humanizeAmount: 0 | 1 | 2 | 3;
  feelOffsetMs: number;
  velocityProfile: DrumVelocityProfile;
  kickPolicy: DrumKickPolicy;
  snarePolicy: DrumSnarePolicy;
  hatPolicy: DrumHatPolicy;
  cymbalPolicy: DrumCymbalPolicy;
  tomPolicy: DrumTomPolicy;
  foregroundGuard: DrumForegroundGuard;
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
  /** ★ 每段鼓手演奏合同:Arranger 总谱下发,drum 只消费合同,不偷看 lead/comp。 */
  drumPerformanceBySection: Record<SectionId, DrumPerformanceContract>;
  /** ★ DAW 风格总谱合同:每段每个乐手都有演奏/时序/让位/手势意图;render 只解释合同。 */
  rolePerformanceBySection: Record<InstrumentRoleName, Record<SectionId, RolePerformanceContract>>;
  // ★ GrooveContract(comp/melody 分开 swing + ms pocket + texture 偏好);arranger 拥有,render 消费。
  //   Phase D:全 MG-backed 风格走真 pool;BLUES/无 rng = legacy 派生兜底。grooveBySection(GrooveKind)保留作 drum 兼容字段。
  songGrooveContract: import('../knowledge/grooveContracts').GrooveContract;
  songGrooveContractId: string;
  grooveContractBySection: Record<SectionId, import('../knowledge/grooveContracts').GrooveContract>;
  /** ★ 每段乐器【进入方式】(Arranger 下发,修 intro→verse 衔接):能量跃升处=lead-in(上段末小节铺垫推进),其余=downbeat 直入。 */
  entryBySection: Record<SectionId, SectionEntry>;
  /** ★ 全曲开头【入场导演】:首段角色延迟 + 鼓/织体开场策略。render 层消费,ESP32 端可按同一小表落 MIDI 事件。 */
  openingGesture: OpeningGesturePlan;
  /** ★ 全曲【收尾方式】(Arranger 下发,风格定制,修戛然而止):器配据此排乐器退出、render 出渐弱/延留/冷收手势。 */
  endingStyle: EndingStyle;
}

export type ArrangementPlan = DeepReadonly<ArrangementPlanData>;

export function freezeArrangementPlan(data: ArrangementPlanData): ArrangementPlan {
  return deepFreeze(data);
}
