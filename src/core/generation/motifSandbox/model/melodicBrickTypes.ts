// ============================================================
// motifSandbox · model · Melodic Brick 类型(directive: motif_brick_progression_newengine_integration)
// ------------------------------------------------------------
// 把 UserMotif 升级成有【功能分类】的 melodic brick,驱动【和声模板选择】(不是逐 bar 猜和弦)。
// Phase 1 = brick 驱动的和声模板选择器(旋律仍走现有 weaver)。复用 newEngine 知识层(progressions),
//   不碰生产链(generateSong/renderMgMelody)。
// ============================================================

import type { ProgressionSlot } from '../../newEngine/knowledge/progressions';

/** 结构音/经过音边界(directive grid_alignment_structural_tone Phase 4):
 *  structuralToneScore >= 0.58 = 骨干结构音(主导和声定位/重拍伴奏);< 0.58 = 经过音/装饰音(弱影响)。
 *  brick 分类、和声模板选择、伴奏对拍统一用这条线。 */
export const STRUCTURAL_TONE_MIN = 0.58;

export type UserMelodicBrickFunction =
  | 'opening' | 'approach' | 'cadence' | 'resolution' | 'launcher'
  | 'answer' | 'passing' | 'neighbor' | 'arpeggio' | 'sequence' | 'ambiguous';

export interface StructuralMelodyTone {
  midi: number;
  scaleDegree: number;       // 1..7
  onsetBeat: number;
  durationBeat: number;
  weight: number;            // 结构权重(长音/强拍/结构分/力度)
  role: 'head' | 'tail' | 'long' | 'strongBeat' | 'peak' | 'valley';
}

export interface UserMelodicBrickFunctionScore {
  function: UserMelodicBrickFunction;
  confidence: number;        // 0..1
  evidence: string[];
}

export type CadencePattern = '2-1' | '7-1' | '4-3' | '5-1' | '6-5' | 'stepToStable' | 'leapToStable' | 'none';
export interface CadenceMotion {
  fromDegree: number;
  toDegree: number;
  pattern: CadencePattern;
  strength: number;          // 0..1
}

export interface UserMelodicBrick {
  id: string;
  sourceMotifId: string;
  keyPc: number;
  mode: 'major' | 'minor';
  lengthBeats: number;
  lengthBars: number;        // 1..4
  quoteBeats: number;        // 实际复现的 quote 单元长度(长 motif 缩子动机)
  head: StructuralMelodyTone | null;
  tail: StructuralMelodyTone | null;
  allTones: StructuralMelodyTone[];         // 全部 quote 音(contour/rhythm/debug)
  structuralTones: StructuralMelodyTone[];  // 仅骨干结构音(>= STRUCTURAL_TONE_MIN;经过音不入)→ 主导和声定位
  contour: number[];
  rhythmSignature: number[];
  cadenceMotion: CadenceMotion | null;
  functions: UserMelodicBrickFunctionScore[]; // 降序
  primaryFunction: UserMelodicBrickFunction;
  evidence: string[];
}

// —— HarmonyIntent(brick → 和声偏好)——
export interface MotifHarmonyIntent {
  targetFunctions: Array<'T' | 'S' | 'D'>;
  cadenceNeed: 'none' | 'weak' | 'strong';
  startStability: 'stable' | 'unstable' | 'ambiguous';
  endingStability: 'stable' | 'unstable' | 'open';
  preferTemplateCadence: Array<'open' | 'weak' | 'loop' | 'modal' | 'soft_authentic'>;
  preferredStartDegrees: number[];
  preferredLandingDegrees: number[];
  avoidDegenerateProgressions: string[];
}

// —— 模板选择结果(含调试分解)——
export interface ProgressionScoreBreakdown {
  templatePrior: number;        // 含 opposite-mode 降权(modeMatch=false → 弱先验)
  structuralToneSupport: number;
  headFit: number;
  tailFit: number;
  cadenceFit: number;
  functionArcFit: number;
  sectionRoleFit: number;       // 段落角色软奖励(命中 form 段落角色 → 加分,不命中=0,从不排除)
  diversityBonus: number;       // seed 相关小抖动 → 跨 seed 保持多模板可达
  phraseCycleFit: number;
  degeneratePenalty: number;
  strongNonChordPenalty: number;
}

export interface SelectedMotifProgression {
  prototypeId: string;
  style: string;
  mode: 'Major' | 'Minor';
  slots: ProgressionSlot[];     // 已 fit 到 16 bar
  fittedBars: number;
  cadence: 'open' | 'weak' | 'loop' | 'modal' | 'soft_authentic' | 'none';
  score: number;
  scoreBreakdown: ProgressionScoreBreakdown;
  topCandidates: Array<{ prototypeId: string; score: number }>;
}

// —— RoadMap brick slot(directive roadmap_slot_fusion §5.2):parseRoadMap 的 BrickMatch 规范化成
//   Q+R 友好结构 —— RoadMap 不再只是 debug 文本,而是旋律 slot 计划的结构真源(Phase 4 消费)。——
export type RoadmapBrickType = 'Approach' | 'Cadence' | 'Launcher' | 'Tonic' | 'Cycle' | 'Turnaround' | 'Other';

export interface RoadmapBrickSlot {
  id: string;
  name: string;                 // parser brick 名(如 "Straight-Approach"/"I-V-vi-IV")
  type: RoadmapBrickType;       // family → 粗类型
  startBeat: number;
  durationBeats: number;
  sectionId?: string;
  chordIds: string[];           // 覆盖的 SandboxChord id(startBeat 键)
  entryFunction?: 'T' | 'S' | 'D';
  exitFunction?: 'T' | 'S' | 'D';
  cadenceStrength?: 'none' | 'weak' | 'strong';
  recurrenceKey: string;        // 结构等价键(同 key 的 brick 可接 motif 复用)
}

// —— Melodic Slot Plan(directive roadmap_slot_fusion §5.3/5.4):RoadMap brick slot → 旋律 slot 计划。
//   motif 按【功能匹配】落进 slot,结构性复现按 recurrenceKey(无复现回退句头);Phase 5 weaver 据此填充。——
export type MelodicSlotFunction = 'opening' | 'approach' | 'cadence' | 'resolution' | 'continuation' | 'answer' | 'fill';
export type UserMotifPolicy = 'mustQuote' | 'mustDevelop' | 'mayReference' | 'generatedOnly';
export type MelodicSlotTransform = 'quote' | 'transpose' | 'invert' | 'sequence' | 'rhythmicShift' | 'answer' | 'cadenceTail' | 'none';

export interface MelodicSlot {
  id: string;
  roadmapBrickId: string;
  startBeat: number;
  durationBeats: number;
  sectionId?: string;
  requiredFunction: MelodicSlotFunction;
  userMotifPolicy: UserMotifPolicy;
  lineage: { sourceMotifId?: string; parentSlotId?: string; transform?: MelodicSlotTransform };
  reason: string;               // UI 调试证据
}

export interface MelodicSlotPlan {
  totalBars: number;
  beatsPerBar: number;
  slots: MelodicSlot[];
  userQuoteSlotIds: string[];   // motif 原样出现的 slot
  userDevelopSlotIds: string[]; // motif 发展/引用的 slot
  warnings: string[];
}

// —— 旋律 roadmap(锚点槽 + 真 harmonicBricks:slots→ChordPart→parseRoadMap)——
export interface MotifMelodicSlot {
  id: string;
  startBeat: number;
  durationBeats: number;
  role: 'userBrick' | 'answer' | 'connector' | 'cadence' | 'continuation';
  source: 'user' | 'generated' | 'placeholder';
  requiredFunction?: UserMelodicBrickFunction;
  anchorMotifId?: string;
}

export interface MotifMelodicRoadmap {
  totalBars: number;
  harmonicRomans: string[];     // 每小节 roman(选中模板真 roman,调试用)
  harmonicBricks?: import('../../newEngine/render/mgRoadMapParser').BrickMatch[]; // 真 RoadMap(slots→ChordPart→parseRoadMap)
  brickSlots: RoadmapBrickSlot[]; // ★ 规范化 brick slots(Phase 3;Phase 4 据此排旋律 slot)
  brickSlotsFromFallback: boolean; // true = parse 失败,逐和弦 span 兜底(非静默回退到固定 phrase loop)
  roadmapError?: string;        // parseRoadMap 失败时的错误(不静默吞;UI 暴露)
  melodicSlots: MotifMelodicSlot[];
}
