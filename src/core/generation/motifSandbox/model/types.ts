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
  /** quote=轮首原样 motif;adapted=后半段和声适配变体;fill=续接填充 */
  occurrenceKind?: 'quote' | 'adapted' | 'fill';
  cycleIndex?: number;
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
  startBeat: number;
  kind: 'quote' | 'adapted';   // quote=原样;adapted=和声适配变体
  cycleIndex: number;
  chordRoman: string;          // 落在哪个和弦(起和弦)
}

export interface MotifWeaveAudit {
  motifQuotedFirstCycle: boolean; // 第一轮轮首有原样 motif
  placementsPerCycle: number;     // 1 或 2(每轮 motif 出现次数)
  cyclesConsistent: boolean;      // 各轮复制一致(进行重复→复制第一遍)
  maxLeap: number;
  chromaticRatio: number;
  jazzinessScore: number;
}

export interface MotifWeaverResult {
  motif: UserMotif;
  progression: import('./chords').SandboxChord[]; // 配出的整曲和弦进行(多轮)
  occurrences: MotifOccurrence[];
  lead: MotifNote[];
  cycleBeats: number;
  numCycles: number;
  placeTwice: boolean;
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
