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
import type {
  GrooveDrumFillFunction,
  GrooveDrumFillScore,
} from '../knowledge/drumFillVocabulary';
import type {
  GrooveBoundaryBaseMask,
  GrooveContract,
  GrooveDrumIntent,
  GrooveDrumFillFamily,
  GrooveGrid,
  GrooveLandingGesture,
  GroovePhraseBarRole,
  GrooveSubdivision,
} from '../knowledge/grooveContracts';
import type { RoleRhythmPatternByRole } from '../knowledge/roleRhythmPatterns';
import type { DrumFeelProfileId } from '../knowledge/drumPerformanceKnowledge';
import type { AcgPianoArrangementProfileId } from './acgPianoArrangementProfiles';
import type { AcousticInstrumentationIntent } from './acousticInstrumentationProfiles';
import type { JazzArrangementArchetypeId } from './jazzArchetypePlanner';
import type { ResolvedArrangementArchetypePlan } from './arrangementArchetypeContract';
import type { JazzFiveFourHarmonicDirective } from './jazzFiveFourHarmonyScore';
import type { LeadPhraseDirective } from './jazzFiveFourLeadScore';
import type { JazzFiveFourEnsembleScore } from './jazzFiveFourEnsembleScore';
import type { LofiFoundationPlan } from './lofiFoundationPlanner';
import type {
  LofiLeadPhraseBlueprint,
  LofiLeadPhraseRole as LofiLeadPhraseRoleKnowledge,
} from '../knowledge/lofiLeadPhraseBlueprints';
import type { LofiLeadRoadMapPlan } from '../knowledge/lofiLeadRoadMapKnowledge';

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
export type LeadCompCollisionPolicy = 'allow' | 'no-unison-when-same-program';

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
  | 'citypop-syncopated-boogie'
  | 'pop-backbeat'
  | 'jpop-driving-8ths'
  | 'ballad-halftime'
  | 'tr808-rnb-pocket'
  | 'tr808-dilla-pocket'
  | 'tr808-trap-soul-halftime'
  | 'tr808-lofi-boombap'
  | 'tr808-lofi-dusty-break'
  | 'tr808-lofi-minimal'
  | 'tr808-lofi-soul-halftime'
  | 'rnb-neo-soul-pocket'
  | 'rnb-dilla-pocket'
  | 'rnb-gospel-triplet'
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
  | 'jazz-brush-ballad'
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
/** Score-level keyboard touch intent. Instrumentation later resolves it against the actual voice capability. */
export type KeyboardMotion = 'none' | 'lyrical' | 'broken-chord' | 'syncopated-comp' | 'sixteenth-ostinato' | 'percussive';

export interface ScorePerformanceContract {
  sectionId: SectionId;
  grooveContractId: string;
  foregroundRole: InstrumentRoleName;
  rhythmGrid: GrooveGrid;
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
  // Arranger owns the rhythmic/touch intent. It deliberately does not name a
  // MIDI controller or assume the eventual program is a keyboard.
  keyboardMotion: KeyboardMotion;
}

export interface DrumPerformanceContract {
  id: string;
  sectionId: SectionId;
  /** Compiled from this sole score-level groove authority. */
  grooveContractId: string;
  /** Evidence-backed performance grammar selected by the same GrooveContract. */
  feelProfileId: DrumFeelProfileId;
  role: DrumPerformanceRole;
  kitProgram: 8 | 25 | 40;
  patternFamily: DrumPatternFamily;
  complexity: 0 | 1 | 2 | 3;
  intensity: 0 | 1 | 2 | 3;
  densityCeiling: number;
  entryMode: DrumEntryMode;
  fillPolicy: DrumFillPolicy;
  fillAmount: 0 | 1 | 2 | 3;
  fillComplexity: 0 | 1 | 2 | 3;
  phraseVariation: 0 | 1 | 2 | 3;
  timingProfile: DrumTimingProfile;
  maxMoveTicks: number;
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

export type GrooveBoundaryKind = 'pickup' | 'fill' | 'break' | 'dropout';
export type GrooveBarTrajectory = 'settled' | 'rising' | 'arrival' | 'peak' | 'falling';

/**
 * Arranger-authored rhythm-section relationship for one bar. Structural beats
 * are mandatory anchors; response limits keep source-following from becoming a
 * mechanical copy of every bass, comp or lead onset.
 */
export interface GrooveDrumInteractionScore {
  kickFollow: GrooveDrumIntent['kickFollow'];
  snareFollow: GrooveDrumIntent['snareFollow'];
  structuralKickBeats: readonly number[];
  structuralSnareBeats: readonly number[];
  kickResponseLimit: number;
  snareResponseLimit: number;
}

/** One bar of the shared groove score. Instruments project from this bar; drums do not own it. */
export interface GrooveBarScore {
  sectionId: SectionId;
  barInSection: number;
  absoluteBar: number;
  phraseIndex: number;
  phraseBarIndex: number;
  role: GroovePhraseBarRole;
  beatStrength: readonly number[];
  subdivision: GrooveSubdivision;
  subdivisionAccent: readonly number[];
  phraseAccent: number;
  /** Arranger-owned local energy projection; optional only for legacy fixtures. */
  energy?: number;
  /** Macro direction materialized from section energy and climaxMap. */
  trajectory?: GrooveBarTrajectory;
  /** Materialized from the same GrooveContract; optional only for legacy fixtures. */
  drumInteraction?: GrooveDrumInteractionScore;
  /** LOFI only: Arranger-selected, indivisible two-bar Hip Hop phrase. */
  drumPhraseId?: string;
  /** Position inside the selected two-bar phrase. */
  drumPhraseBarIndex?: 0 | 1;
  /** The phrase-level dramatic job; core masks repeat until an explicit cadence. */
  drumPhraseRole?: 'core' | 'turnaround' | 'breakdown';
  /** True only when Arranger authorizes a structural onset-mask mutation. */
  structuralMutation?: boolean;
  /** LOFI only: the shared phrase sentence projected into this groove bar. */
  lofiPhraseInteraction?: LofiPhraseBarInteraction;
  /** LOFI only: stable inter-instrument timing relationships for this song. */
  lofiPocket?: LofiSystemicPocket;
  /** LOFI only: independently selected four-bar upper-percussion identity. */
  drumTopLoopId?: string;
  /** Position inside the selected four-bar upper-percussion loop. */
  drumTopLoopBarIndex?: 0 | 1 | 2 | 3;
}

/** A form boundary authored by Arranger from the selected GrooveContract vocabulary. */
export interface GrooveBoundaryScore {
  id: string;
  fromSectionId?: SectionId;
  toSectionId: SectionId;
  sourceBar: number;
  landingBar: number;
  kind: GrooveBoundaryKind;
  intensity: 1 | 2 | 3;
  durationBeats: number;
  baseMask: GrooveBoundaryBaseMask;
  drumFillFamily: GrooveDrumFillFamily;
  /** The boundary's dramatic job; optional only for legacy fixtures. */
  fillFunction?: GrooveDrumFillFunction;
  /** Concrete semantic hit score selected from the GrooveContract vocabulary. */
  fillScore?: GrooveDrumFillScore;
  landing: GrooveLandingGesture;
  opening: boolean;
}

export interface GrooveSectionScore {
  sectionId: SectionId;
  grooveContractId: string;
  /** Bass vocabulary already resolved by Arranger (archetype wins over song fallback). */
  bassPatternId?: string;
  /**
   * Role-specific rhythm material resolved and cloned by Arranger.  Optional
   * only for legacy hand-written fixtures; planGrooveScore always emits it.
   */
  roleRhythmByRole?: RoleRhythmPatternByRole;
  bars: readonly GrooveBarScore[];
}

/** Materialized song score from the single GrooveContract truth. */
export interface GrooveScorePlan {
  grooveContractId: string;
  bySection: Readonly<Record<SectionId, GrooveSectionScore>>;
  boundaries: readonly GrooveBoundaryScore[];
}

export interface LofiLeadSilenceWindow {
  sectionId: SectionId;
  startBarInSection: number;
  endBarInSection: number;
  startBeat: number;
  endBeat: number;
}

/** Arranger-owned main-loop breathing plan, consumed before lead realization. */
export interface LofiLeadPresencePlan {
  activeBarsBySection: Readonly<Record<SectionId, readonly number[]>>;
  silenceWindows: readonly LofiLeadSilenceWindow[];
  /** One off-downbeat response entry for every Arranger-active bar. */
  entryBeats: readonly number[];
}

export type LofiPhraseArcPhase = 'settle' | 'grow' | 'crest' | 'release';
export type LofiLeadPhraseRole = LofiLeadPhraseRoleKnowledge;
export type LofiCompPhraseRole = 'bed' | 'support' | 'answer';
export type LofiBassPhraseRole = 'anchor' | 'lock' | 'release';
export type LofiDrumPhraseInteractionRole = 'core' | 'answer' | 'settle';
export type LofiTensionIntent = 'stable' | 'open' | 'build' | 'resolve';

/**
 * One Arranger-authored bar of LOFI ensemble syntax. Every role consumes this
 * same decision; renderers may project it but may not infer another call /
 * response plan from already-rendered notes.
 */
export interface LofiPhraseBarInteraction {
  sectionId: SectionId;
  barInSection: number;
  absoluteBar: number;
  phraseId?: string;
  motifId?: string;
  phraseBarIndex: number;
  arcPhase: LofiPhraseArcPhase;
  leadRole: LofiLeadPhraseRole;
  compRole: LofiCompPhraseRole;
  /**
   * Arranger-authored late entry for a Comp answer, relative to its bar.
   * Absent for support/bed bars; renderers must not infer a replacement from
   * already-rendered Lead notes.
   */
  compAnswerEntryBeat?: number;
  bassRole: LofiBassPhraseRole;
  drumRole: LofiDrumPhraseInteractionRole;
  tensionIntent: LofiTensionIntent;
  velocityScaleByRole: Readonly<{
    lead: number;
    comp: number;
    bass: number;
    drum: number;
  }>;
}

/** Stable relative pocket: anchors and relationships, not per-hit random drift. */
export interface LofiSystemicPocket {
  kickAnchorMs: 0;
  kickOffbeatMs: number;
  snareDragMs: number;
  hatOnbeatMs: number;
  hatOffbeatMs: number;
}

export interface LofiPhraseInteractionPlan {
  phraseBars: number;
  bars: readonly LofiPhraseBarInteraction[];
  bySection: Readonly<Record<SectionId, readonly LofiPhraseBarInteraction[]>>;
  pocket: Readonly<LofiSystemicPocket>;
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
  /** Unified, bar-level groove score authored before any instrument chooses notes. */
  grooveScorePlan: GrooveScorePlan;
  /** ★ 每段鼓手演奏合同:Arranger 下发关系意图;render 只消费获授权的 source onset,不反推风格规则。 */
  drumPerformanceBySection: Record<SectionId, DrumPerformanceContract>;
  /** ★ DAW 风格总谱合同:每段每个乐手都有演奏/时序/让位/手势意图;render 只解释合同。 */
  rolePerformanceBySection: Record<InstrumentRoleName, Record<SectionId, RolePerformanceContract>>;
  /** ★ Arranger 明示 Lead/COMP 关系:同音色(program 相同)时 COMP 不得与 Lead 同 MIDI pitch 长时间重叠。 */
  leadCompCollisionPolicy: LeadCompCollisionPolicy;
  // ★ GrooveContract(comp/melody 分开 swing + ms pocket + texture 偏好);arranger 拥有,render 消费。
  //   Phase D:全 MG-backed 风格走真 pool;BLUES/无 rng = legacy 派生兜底。grooveBySection(GrooveKind)保留作 drum 兼容字段。
  /** JAZZ only:拍号/曲式/角色轨迹主型，与表面 GrooveContract 分离。 */
  arrangementArchetypeId?: JazzArrangementArchetypeId;
  /** ACG PIANOSONG only: hidden song-level score blueprint; never a UI style selector. */
  acgPianoArrangementProfileId?: AcgPianoArrangementProfileId;
  /** Arranger-owned acoustic ensemble intent, consumed only by the acoustic palette. */
  acousticInstrumentationIntent?: AcousticInstrumentationIntent;
  /**
   * Arranger 已按实际 section 展开的执行快照。下游只读这里与 rolePerformance，
   * 不得再从 style/meter/GrooveContract id 反推编配。
   */
  resolvedArchetype?: ResolvedArrangementArchetypePlan;
  /**
   * Arranger-selected, whole-template Jazz 5/4 harmonic score. Harmony may
   * compile this frozen list but must not select replacement templates.
   */
  jazzFiveFourHarmonyDirectives?: readonly JazzFiveFourHarmonicDirective[];
  /**
   * Reference-quartet only: Arranger-frozen Lead phrase score. Grammar and
   * Harmony may compile it, but Render must not select or reshape templates.
   */
  jazzFiveFourLeadDirectives?: readonly LeadPhraseDirective[];
  /**
   * Reference-quartet only for now: Arranger-frozen per-bar ensemble score and
   * indivisible Drum phrase placements. The generative planner API exists but
   * is deliberately not selected by any current product archetype.
   */
  jazzFiveFourEnsembleScore?: JazzFiveFourEnsembleScore;
  /** LOFI only: one immutable, compatible musical foundation identity per song. */
  lofiFoundationPlan?: LofiFoundationPlan;
  /** LOFI only: song-level melodic carrier, presence sentence and motif cell. */
  lofiLeadBlueprintPlan?: LofiLeadPhraseBlueprint;
  /**
   * LOFI only: Arranger-authored bar-by-bar Lead brick route. Harmony resolves
   * its texture lanes; Render may not replace or re-select them.
   */
  lofiLeadRoadMapPlan?: LofiLeadRoadMapPlan;
  /** LOFI only: intentional main-loop lead rests authored before MG scheduling. */
  lofiLeadPresencePlan?: LofiLeadPresencePlan;
  /** LOFI only: shared phrase arc, call/response, motif and pocket contract. */
  lofiPhraseInteractionPlan?: LofiPhraseInteractionPlan;
  songGrooveContract: GrooveContract;
  songGrooveContractId: string;
  grooveContractBySection: Record<SectionId, GrooveContract>;
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
