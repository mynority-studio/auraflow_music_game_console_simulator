// ============================================================
// auraRoaming · types(光律漫游共享契约)
// ------------------------------------------------------------
// 功能整体收在 src/features/auraRoaming/ 独立目录,方便日后整体迁移。
// 两个模式:氛围漫游 = 现有音乐生成(Q+H 配置,这里零设置);
// Aura Key = 亮灯引导跟弹(lead 不静音,15 键逻辑与用户接管沙盒一致)。
// ============================================================

/** 只读 lead 音符(从 MusicalIR NoteIR 适配,剥掉品牌类型)。 */
export interface AuraLeadNote {
  pitch: number;
  startTick: number;
  durationTicks: number;
  velocity: number;
}

/** 提示音的时值档:只提示全/二/四分 + 少量八分,防节拍器由 planner 负责。 */
export type CueValueClass = 'whole' | 'half' | 'quarter' | 'eighth';

/** 重音打分候选(accent 层输出,planner 输入)。 */
export interface AccentCandidate {
  noteIndex: number;
  tick: number;
  beat: number;
  pitch: number;
  durationBeats: number;
  velocity: number;
  score: number;
}

/** planner 选定的提示音(尚未绑定键位)。 */
export interface PlannedCue {
  id: number;
  tick: number;
  beat: number;
  pitch: number;
  durationBeats: number;
  valueClass: CueValueClass;
}

export type AuraJudgementKind = 'perfect' | 'good' | 'missAttempt' | 'missIgnore';

export interface AuraJudgeWindows {
  /** |Δt| ≤ perfectMs → Perfect */
  perfectMs: number;
  /** perfect < |Δt| ≤ goodMs → 普通成功 */
  goodMs: number;
  /** good < |Δt| ≤ attemptMs → 按偏 miss;更远 = 自由弹奏不判定 */
  attemptMs: number;
}

export const DEFAULT_JUDGE_WINDOWS: AuraJudgeWindows = {
  perfectMs: 60,
  goodMs: 150,
  attemptMs: 300,
};

export const LUX_PER_PERFECT = 2;
export const LUX_PER_GOOD = 1;
/** 连续成功该次数进入「充能」🌟高能颤抖 + 光斑喷射。 */
export const CHARGE_COMBO = 5;
/** 律光音轨:两次成功命中相距超过该拍数则锚点作废。 */
export const TRAIL_MAX_GAP_BEATS = 8;

/** 呼吸灯时序:最亮点提前量(音符发声前 50~100ms,取中值)。 */
export const CUE_PEAK_LEAD_MS = 75;
/** 最亮保持窗(覆盖住音符发声时刻,给用户反应)。 */
export const CUE_HOLD_MS = 320;
export const CUE_FADE_MS = 260;
export const CUE_RISE_MIN_MS = 350;
export const CUE_RISE_MAX_MS = 700;
/** 引导灯主色相(紫罗兰,与面板 violet 一致)。 */
export const CUE_HUE = 272;
