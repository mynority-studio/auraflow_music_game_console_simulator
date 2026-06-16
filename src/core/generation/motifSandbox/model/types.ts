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
  accent: number;        // 0..1(力度/能量重音 → comp/bass 击点)
  structuralToneScore?: number; // 0..1(节拍/时值/相位 = 和声/乐句重要性 → 配和声、乐句身份)
  /** quote=原样陈述(head/recap);develop=变形发展(移位/倒影/片段/扩张/位移);connect=连接留白 */
  occurrenceKind?: 'quote' | 'develop' | 'connect';
  slotIndex?: number;
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
  slotIndex: number;
  kind: 'quote' | 'develop' | 'connect'; // 原样陈述 / 变形发展 / 连接留白
  label: string;               // 'head' / 'transpose+2' / 'invert' / 'fragment×2' / 'recap' / 'connect'
  chordRoman: string;          // 落在哪个和弦(起和弦)
}

export interface MotifWeaveAudit {
  motifQuotedFirstCycle: boolean; // 第一槽 = 原样 motif(head 陈述)
  themeStatements: number;        // 陈述槽数(原样 + 变形)
  developVariants: number;        // 不同变形手法数(去重;>1 = 真有发展不是复制)
  connectSlots: number;           // 连接/留白槽数
  notesPerBar: number;            // 密度(音/bar)
  restRatio: number;              // 空拍占比(0..1,越大越透气)
  maxLeap: number;
  chromaticRatio: number;
  jazzinessScore: number;
}

export interface MotifWeaverResult {
  motif: UserMotif;
  progression: import('./chords').SandboxChord[]; // 配出的整曲和弦进行(16 bar)
  occurrences: MotifOccurrence[];
  lead: MotifNote[];
  totalBars: number;             // 16
  motifBars: number;             // 分析出的 motif 小节数(1..4)
  quoteBars: number;             // 实际排比 quote 单元小节数(长 motif 缩为 ≤2 子动机;≤2 小节时 = motifBars)
  numSlots: number;
  arc: string[];                 // 每槽角色/手法(发展弧,UI 展示)
  audit: MotifWeaveAudit;
  // —— brick 驱动和声(调试/UI)——
  brick?: import('./melodicBrickTypes').UserMelodicBrick;
  selectedProgression?: import('./melodicBrickTypes').SelectedMotifProgression | null;
  roadmap?: import('./melodicBrickTypes').MotifMelodicRoadmap | null;
}

export type QuotePlan = 'verseHeadsOnly' | 'phraseHeads';

export interface MotifWeaverInput {
  capturedNotes: CapturedMidiNote[]; // raw 输入(free 路径走 analyze→normalize)
  motif?: UserMotif;                 // 给定则【直接用】(hidden-grid 已分析好的 motif,跳过 capturedNotes)
  style: SandboxStyle;
  keyPc: number;
  mode: ScaleMode;                   // 续写/配和声用的大/小调母调
  bpm: number;
  seed: number;
  inputTonality?: import('./sandboxScales').SandboxTonality; // 给定则输入吸到该音阶(保 blues b5/五声特征)
  quotePlan?: QuotePlan;             // 默认 phraseHeads(排比:每乐句头);verseHeadsOnly = 只 bar1/bar9
}
