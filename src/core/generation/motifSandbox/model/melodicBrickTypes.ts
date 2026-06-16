// ============================================================
// motifSandbox · model · Melodic Brick 类型(directive: motif_brick_progression_newengine_integration)
// ------------------------------------------------------------
// 把 UserMotif 升级成有【功能分类】的 melodic brick,驱动【和声模板选择】(不是逐 bar 猜和弦)。
// Phase 1 = brick 驱动的和声模板选择器(旋律仍走现有 weaver)。复用 newEngine 知识层(progressions),
//   不碰生产链(generateSong/renderMgMelody)。
// ============================================================

import type { ProgressionSlot } from '../../newEngine/knowledge/progressions';

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
  structuralTones: StructuralMelodyTone[];
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
  templatePrior: number;
  structuralToneSupport: number;
  headFit: number;
  tailFit: number;
  cadenceFit: number;
  functionArcFit: number;
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

// —— 旋律 roadmap(锚点槽;Phase 1 = sandbox-local,parseRoadMap BrickMatch 留后续 PR)——
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
  harmonicRomans: string[];     // 每和弦槽的 roman(选中模板,调试用)
  melodicSlots: MotifMelodicSlot[];
}
