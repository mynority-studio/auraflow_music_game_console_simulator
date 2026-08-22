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

/** planner 选定的提示音(尚未绑定键位)。
 *  source:'lead' = 来自 lead 重音;'harmonic' = 和声填充(lead 无旋律的
 *  空窗里,按当前布局的结构音/色彩音提前亮灯,ACG 等稀疏风格提密度)。 */
export interface PlannedCue {
  id: number;
  tick: number;
  beat: number;
  pitch: number;
  durationBeats: number;
  valueClass: CueValueClass;
  source?: 'lead' | 'harmonic';
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
/** 呼吸上升时长:所有提示统一固定 — 每个键只按自己的峰值时刻倒推
 *  起亮点,窗口重叠就同时呼吸,绝不等前一个灯熄灭。 */
export const CUE_RISE_MS = 620;
/** 引导灯主色相(紫罗兰,与面板 violet 一致)。 */
export const CUE_HUE = 272;
/** 亮灯键命中后的自动时值延音:按 lead 音符时值持续,再加一点
 *  legato 尾巴衔接下一个提示;未亮键不延音。 */
export const CUE_SUSTAIN_TAIL_MS = 150;
export const CUE_SUSTAIN_MAX_MS = 5000;
