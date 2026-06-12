// ============================================================
// motifSandbox · model · 类型(2026-06-12)
// ------------------------------------------------------------
// 旋律续写沙盒(Q+R)的数据模型。完全独立于 newEngine 生产链 —— 只生成 lead-only。
// 参考 Impro-Visor Theme/ThemeUse/ThemeWeaver,clean-room TypeScript。
// ============================================================

export type SandboxStyle = 'pop' | 'lofi' | 'rnb' | 'jazz';
export type SandboxSectionId = 'verse1' | 'verse2';
export type ScaleMode = 'major' | 'minor';

/** 用户 MIDI 原始录入(raw;仅 UI/debug 展示,不直接进生成)。 */
export interface CapturedMidiNote {
  midi: number;
  velocity: number;      // 0..127
  onsetMs: number;
  durationMs: number;
}

/** 归一化后的 motif 音(量化 + 单旋律化 + scale snap 之后,生成用这个)。 */
export interface MotifNote {
  midi: number;
  onsetBeat: number;
  durationBeat: number;
  velocity: number;      // 0..1
  scaleDegree: number;   // 1..7
  octave: number;
  accent: number;        // 0..1
  /** 续写时标记此音属于哪次 motif 复现(quote)/发展;quote 音带 occurrence 元数据 */
  occurrenceKind?: 'quote' | 'answer' | 'continuation';
  sectionId?: SandboxSectionId;
}

export interface UserMotif {
  id: string;
  keyPc: number;         // 0..11
  mode: ScaleMode;
  bpm: number;
  notes: MotifNote[];    // normalized
  lengthBeats: number;   // 1/2/4/8(≤8)
  contour: number[];     // 相邻 scaleDegree delta 的符号
  rhythmCell: number[];  // onset 差 + 时值模式
  createdAt: number;
}

export interface MotifOccurrence {
  motifId: string;
  sectionId: SandboxSectionId;
  startBeat: number;
  kind: 'quote' | 'variation';
  transform: 'identity' | 'transpose' | 'invert' | 'retrograde' | 'rhythmDivide' | 'tailAnswer';
}

export interface MotifWeaveAudit {
  motifQuotedInVerse1: boolean;
  motifQuotedInVerse2: boolean;
  maxLeap: number;        // 最大相邻半音跳
  chromaticRatio: number; // 离调音占比(POP/LOFI/RNB 应为 0)
  jazzinessScore: number; // 0..1(越高越 jazz)
}

export interface MotifWeaverResult {
  motif: UserMotif;
  occurrences: MotifOccurrence[];
  lead: MotifNote[];
  audit: MotifWeaveAudit;
}

export interface MotifWeaverInput {
  capturedNotes: CapturedMidiNote[]; // raw 输入(必走 analyze→normalize,不绕过)
  style: SandboxStyle;
  keyPc: number;
  mode: ScaleMode;
  bpm: number;
  seed: number;
}
