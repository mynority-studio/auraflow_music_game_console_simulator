// ============================================================
// newEngine · knowledge · MelodyGrammarTypes(MG strict 移植 Loop 1)
// ------------------------------------------------------------
// Provenance: ../melodygenerative/src/lib/improvisor/GrammarTypes.ts 忠实港(逐值)。
// KB 合规:纯 schema + makeGrammar 纯函数(无 NoteIR / Timebase / prevMidi / RNG / 实际音符生成)。
// 抽象 melody token(pitch 不在此阶段定;render 层 mgNoteChooser 按和弦实化)。
// ============================================================

// Token semantics(per spec §6 + IV LickGen.java terminals):
//   C — 当前和弦的和弦音(root/3/5/7)
//   S — 当前 chord-scale 的音阶音(非 C/L/X)
//   L — 色彩/延伸(9/11/13/altered)
//   A — approach:下一个和弦音的半音(或音阶级)邻音
//   R — 休止
//   X(deg?)— 显式级数;按和弦族解析;无 degree 时 = "任意在阶"锚点
//   H — "helpful" 色彩(IV terminal),与 L 同候选池,分开记便于未来权重区分
//   G — "goal" 音(IV terminal);NoteChooser 给整和弦拼写 3rd/7th 最强;有 GuideTonePlan 时结构 G 绑导音骨架
//   B — "bass" 音(IV terminal)= 和弦根音 pc;旋律倍低音锚做织体强调
//   Slope — min..max 音阶级的方向线
//   Triadic — 和弦音琶音(1-3-5-7 升/降)

/**
 * ACG PIANOSONG 在 grammar 层写下的稳定音角色。它不是 renderer 对 chord
 * spelling 的猜测：scheduler 必须把它和 HarmonicPlan 的 stable∩scale 求交，
 * realizer 也会再次校验后才允许落音。
 */
export type AcgStableRole = 'root' | 'third' | 'fifth' | 'seventh';

/** ACG return 的落点和声归属。 */
export type AcgHarmonicScope = 'current-chord' | 'next-chord';

/**
 * 可被 grammar token 直接声明的、必须立刻级进解决的局部色彩。
 * 这些不是“随机换音阶”的许可；无相应和声支撑时 realizer 会退回普通 approach，
 * 不会把色彩悬置在结构拍上。
 */
export type AcgBorrowedColorIntent = 'dorian6' | 'harmonic7' | 'phrygianb2';

/**
 * 钢琴上声部的短暂双音意图。partner 仍必须属于 arrival 的 stableRoles，
 * `preferredIntervals` 仅决定在多个合法声部中如何排布，不能放宽和声合同。
 */
export interface AcgDyadIntent {
  voicing: 'below-topline';
  partnerRoles: readonly AcgStableRole[];
  preferredIntervals: readonly (3 | 4 | 5 | 7 | 8 | 9)[];
}

/**
 * ACG 的 arrival terminal 必须携带完整、可执行的和声合同。这里故意不允许
 * `harmonicScope` / `stableRoles` 只写其一：那会把“落在当前/下一和弦的哪个稳定
 * 声部”重新降格成 renderer 的猜测。
 */
export interface AcgStableArrivalTokenIntent {
  harmonicScope: AcgHarmonicScope;
  stableRoles: readonly AcgStableRole[];
  dyad?: AcgDyadIntent;
  colorIntent?: never;
}

/**
 * 借用色彩只允许作为立即解决的 passing terminal。它不能伪装成没有
 * `harmonicScope` / `stableRoles` 的 arrival 合同。
 */
export interface AcgBorrowedPassingTokenIntent {
  colorIntent: AcgBorrowedColorIntent;
  harmonicScope?: never;
  stableRoles?: never;
  dyad?: never;
}

/**
 * 附着在现有 abstract terminal 上的 ACG 语义。保留既有 token kind，因而不改变
 * 通用 grammar 的展开/时值语义；但一旦声明 ACG intent，就必须是完整稳定落点或
 * 明确的借用 passing 色彩二者之一。
 */
export type AcgGrammarTokenIntent = AcgStableArrivalTokenIntent | AcgBorrowedPassingTokenIntent;

type MelodyTokenBase = {
  duration: number;
  /** 只由 ACG grammar 使用；其它 style 忽略，保持既有 terminal 语义。 */
  acg?: AcgGrammarTokenIntent;
};

export type AbstractMelodyToken =
  | (MelodyTokenBase & { kind: 'C' })
  | (MelodyTokenBase & { kind: 'S' })
  | (MelodyTokenBase & { kind: 'L' })
  | (MelodyTokenBase & { kind: 'A' })
  | (MelodyTokenBase & { kind: 'R' })
  | (MelodyTokenBase & { kind: 'X'; degree?: number | string })
  | (MelodyTokenBase & { kind: 'H' })
  | (MelodyTokenBase & { kind: 'G' })
  | (MelodyTokenBase & { kind: 'B' })
  | (MelodyTokenBase & { kind: 'Slope'; min: number; max: number })
  | (MelodyTokenBase & { kind: 'Triadic'; direction: 'up' | 'down' })
  // Slope group markers(per IV LickGen.java:1991+)。SlopeEnter 设每步半音区间约束:
  //   后续每个音 MIDI 须在 [prev + dirMin, prev + dirMax];SlopeExit 清除。markers 无音、不占时(duration=0)。
  | (MelodyTokenBase & { kind: 'SlopeEnter'; dirMin: number; dirMax: number; duration: 0 })
  | (MelodyTokenBase & { kind: 'SlopeExit'; duration: 0 });

export type TokenKind = AbstractMelodyToken['kind'];

/** 产生式规则。lhs=非终结符;weight=同 lhs+满足条件的规则按权重比例选;conditions=门控;
 *  rhs=有序子项(非终结符名字符串 或 字面 abstract token;非终结符递归展开)。 */
export interface GrammarRule {
  lhs: string;
  weight: number;
  metadata?: {
    sourceRuleId?: string;
    sourceBrickType?: string;
    authoredDurationBeats?: number; // ★ MG full-parity G7:slope rule 作者标注时长(SlopeAdapter 用)
    lofiTags?: string[];
    styleTags?: string[];
  };
  conditions?: {
    brickFamily?: string[];   // 仅当前 brick 族 ∈ 此列表才展开
    brickName?: string[];     // 精确 brick 名匹配
    minDuration?: number;     // brick 时长 ≥
    maxDuration?: number;     // brick 时长 ≤
  };
  rhs: Array<string | AbstractMelodyToken>;
}

/** grammar = 规则按 lhs 索引。 */
export interface Grammar {
  rulesByLhs: Map<string, GrammarRule[]>;
  start: string; // 顶层入口符号(常 "Phrase" 或 "Brick")
}

/** 从规则列表构建 grammar(纯)。 */
export function makeGrammar(rules: GrammarRule[], start: string): Grammar {
  const map = new Map<string, GrammarRule[]>();
  for (const r of rules) {
    const arr = map.get(r.lhs) ?? [];
    arr.push(r);
    map.set(r.lhs, arr);
  }
  return { rulesByLhs: map, start };
}
