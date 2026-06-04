// ============================================================
// newEngine · knowledge · GrooveLibrary(comping 节奏型)
// ------------------------------------------------------------
// 架构定稿 Part 4 GrooveLibrary。per-style comping hit 型(每小节 4 拍相对拍位)。
// 取代"每和弦一整块"→ 有律动/切分。bass walking / drum groove 另见各 renderer。
// ============================================================

export interface CompHit {
  beat: number; // 小节内相对拍位(0..beatsPerBar)
  dur: number;  // 时值(拍)
  vel: number;  // 力度
}

const COMP_PATTERNS: Record<string, readonly CompHit[]> = {
  // lofi:疏、半拍延音、慵懒
  lofi: [
    { beat: 0, dur: 1.5, vel: 58 },
    { beat: 2, dur: 1.5, vel: 50 },
  ],
  // pop:四分律动 + 弱起
  pop: [
    { beat: 0, dur: 0.5, vel: 70 },
    { beat: 1, dur: 0.5, vel: 54 },
    { beat: 2, dur: 0.5, vel: 64 },
    { beat: 3, dur: 0.5, vel: 54 },
  ],
  // jazz:切分(Charleston 风,落 offbeat)
  jazz: [
    { beat: 0, dur: 0.5, vel: 60 },
    { beat: 1.5, dur: 0.5, vel: 70 },
    { beat: 2.5, dur: 0.5, vel: 56 },
    { beat: 3.5, dur: 0.5, vel: 66 },
  ],
  default: [
    { beat: 0, dur: 1, vel: 66 },
    { beat: 2, dur: 1, vel: 56 },
  ],
};

export function compPattern(style: string): CompHit[] {
  return (COMP_PATTERNS[style] ?? COMP_PATTERNS.default).map((h) => ({ ...h }));
}
