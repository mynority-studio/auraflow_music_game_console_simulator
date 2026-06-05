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
export type AbstractMelodyToken =
  | { kind: 'C'; duration: number }
  | { kind: 'S'; duration: number }
  | { kind: 'L'; duration: number }
  | { kind: 'A'; duration: number }
  | { kind: 'R'; duration: number }
  | { kind: 'X'; degree?: number | string; duration: number }
  | { kind: 'H'; duration: number }
  | { kind: 'G'; duration: number }
  | { kind: 'B'; duration: number }
  | { kind: 'Slope'; min: number; max: number; duration: number }
  | { kind: 'Triadic'; direction: 'up' | 'down'; duration: number }
  // Slope group markers(per IV LickGen.java:1991+)。SlopeEnter 设每步半音区间约束:
  //   后续每个音 MIDI 须在 [prev + dirMin, prev + dirMax];SlopeExit 清除。markers 无音、不占时(duration=0)。
  | { kind: 'SlopeEnter'; dirMin: number; dirMax: number; duration: 0 }
  | { kind: 'SlopeExit'; duration: 0 };

export type TokenKind = AbstractMelodyToken['kind'];

/** 产生式规则。lhs=非终结符;weight=同 lhs+满足条件的规则按权重比例选;conditions=门控;
 *  rhs=有序子项(非终结符名字符串 或 字面 abstract token;非终结符递归展开)。 */
export interface GrammarRule {
  lhs: string;
  weight: number;
  metadata?: {
    sourceRuleId?: string;
    sourceBrickType?: string;
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
