// ============================================================
// motifSandbox · model · 类型(2026-06-12)
// ------------------------------------------------------------
// 旋律续写沙盒(Q+R)的数据模型。完全独立于 newEngine 生产链 —— 只生成 lead-only。
// 参考 Impro-Visor Theme/ThemeUse/ThemeWeaver,clean-room TypeScript。
// ============================================================

export type SandboxStyle = 'pop' | 'jazz' | 'lofi' | 'rnb' | 'acg';
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
  // —— 新手 motif 治愈(beginner healing directive,2026-06-24)——
  /** 治愈标签(调试/审计/render 守护):同音断奏锁、空拍补连、摩擦修复、quote 保护。 */
  healingTags?: Array<'intentional-repeat-staccato' | 'gap-healed-legato' | 'friction-repaired' | 'protected-user-quote'>;
  originalMidi?: number;         // friction-repaired 前的原音高(审计/可逆)
  originalDurationBeat?: number; // gap-healed 前的原时值
  /** 同音重复断奏锁:render legato 不得连接、healer 不得延长(真演奏手势,非新手失误)。 */
  articulationLock?: 'staccato-repeat';
}

export interface UserMotif {
  id: string;
  keyPc: number;         // 0..11
  mode: ScaleMode;
  bpm: number;           // ★ capture/analysis 元数据(ms→beat 用);【非】最终播放 BPM(见 playbackBpm snapshot)
  notes: MotifNote[];    // normalized
  lengthBeats: number;   // 整 bar 拍数(hidden-grid 最多 4 小节=16 拍;free fallback 1-4 bar)
  contour: number[];     // 相邻 scaleDegree delta 的符号
  rhythmCell: number[];  // onset 差 + 时值模式
  createdAt: number;
  /** ★ 输入预设音阶(blues chord contract directive Phase 1):分析后保留 → 续写/和声合同识别布鲁斯输入。
   *  缺省 = 未指定(走母调 mode)。两条分析路径(free / hidden-grid)都写入。 */
  inputTonality?: import('./sandboxScales').SandboxTonality;
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
  chromaticRatio: number;          // 全部离调比(含和声证成的色彩,informational)
  unjustifiedChromatic: number;    // 【不证成】离调音数(既非调内、非 quote、非真实和声音)→ 非 jazz 应=0
  jazzinessScore: number;
  // —— 音高合同审计(blues contract Phase 5)——
  structuralUnsupported: number;       // 生成/发展的结构音不被和弦合同支持 → 全风格应=0(fail)
  weakUnsupported: number;             // 弱音不被支持(非 scale/approach)→ warning
  quoteStructuralUnsupported: number;  // quote 结构音不被支持 = 和声没接住用户 motif(warning,不改 quote)
  blueColorStructuralSupported: number;// 被合同支持的结构蓝调音数(blues 色彩落地)
  bluesSeasonedChordCount: number;     // 被布鲁斯调味的和弦数
  contractPassRatio: number;           // 被合同支持(含弱经过/approach/quote-blue)的音占比 0..1
  // —— 新手治愈审计(beginner healing directive Phase 1)——
  articulationGapsHealed: number;        // 不同音高短空拍被补连的音数
  intentionalRepeatStaccatoCount: number;// 被识别为【有意同音断奏】的音数(不延长)
  captureBpmUsedForTimingOnly: boolean;  // ★ capture BPM 仅用于 ms→beat;playbackBpm = generation snapshot
  // —— 摩擦修复审计(beginner healing Phase 2)——
  frictionPairsScanned: number;          // 扫描的相邻音对数
  frictionPairsFlagged: number;          // 高风险强调摩擦对数
  frictionPairsRepaired: number;         // 第 3 次起被修的对数(只 develop/connect)
  frictionRepairsSkippedByStyleScale: number; // 被 blues/jazz 风格/音阶豁免免修的数
  protectedQuoteFrictionCount: number;   // exact/varied quote 里的摩擦(计数但永不修)
}

// —— 曲式上下文(directive roadmap_slot_fusion §5.1):曲长不再是 weaver 内的隐藏常量,
//   显式从外部传入(sandbox 默认 16 bar 也走 context)。未来 Q+N 传真实段落。——
export interface MotifSandboxSection {
  id: string;
  role: 'intro' | 'verse' | 'chorus' | 'bridge' | 'ending' | 'loop';
  startBeat: number;
  durationBeats: number;
}
export interface MotifSandboxFormContext {
  totalBars: number;
  beatsPerBar: number;
  sections: MotifSandboxSection[];
}

export interface MotifWeaverResult {
  motif: UserMotif;
  progression: import('./chords').SandboxChord[]; // 配出的整曲和弦进行(长度 = form.totalBars)
  occurrences: MotifOccurrence[];
  lead: MotifNote[];
  playbackBpm: number;           // ★ = 本次 generation 的 input.bpm(选定/输出 BPM 快照);UI 只读它(非 live slider),改 BPM 须重新 generate。capture BPM(motif.bpm)仅 ms→beat 元数据
  totalBars: number;             // = form.totalBars
  progressionBeats: number;      // 配出的和弦进行总拍数(= totalBars × beatsPerBar;动态曲长验证)
  motifBars: number;             // 分析出的 motif 小节数(1..4)
  quoteBars: number;             // 实际排比 quote 单元小节数(长 motif 缩为 ≤2 子动机;≤2 小节时 = motifBars)
  numSlots: number;
  arc: string[];                 // 每槽角色/手法(发展弧,UI 展示)
  audit: MotifWeaveAudit;
  // —— brick 驱动和声(调试/UI)——
  brick?: import('./melodicBrickTypes').UserMelodicBrick;
  selectedProgression?: import('./melodicBrickTypes').SelectedMotifProgression | null;
  roadmap?: import('./melodicBrickTypes').MotifMelodicRoadmap | null;
  harmonySource?: 'template' | 'fallback'; // 模板选择成功 / 兜底回 buildProgression(不静默)
  harmonyError?: string;                    // fallback 时的错误(UI 暴露)
  melodicSlotPlan?: import('./melodicBrickTypes').MelodicSlotPlan; // RoadMap 驱动旋律 slot 计划(Phase 4;Phase 5 消费)
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
  form?: MotifSandboxFormContext;    // 曲式上下文(默认 16 bar);决定曲长,不再由 weaver 隐藏常量拥有
  healingMode?: HealingMode;         // 新手 motif 治愈(默认 beginner;off=高级用户不修)
}

/** 新手 motif 治愈模式:beginner=补短空拍/护同音断奏(+ Phase 2 摩擦软化);off=不修(高级用户故意 dissonance)。 */
export type HealingMode = 'off' | 'beginner';

/** sandbox 默认曲式(16 bar 单 verse 段)—— 显式当 context 传,不在链路里硬编。 */
export function defaultSandboxForm(totalBars = 16, beatsPerBar = 4): MotifSandboxFormContext {
  return { totalBars, beatsPerBar, sections: [{ id: 'sandbox-main', role: 'verse', startBeat: 0, durationBeats: totalBars * beatsPerBar }] };
}
