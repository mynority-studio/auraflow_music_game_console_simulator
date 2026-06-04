// ============================================================
// newEngine · knowledge · GrooveLibrary(comping + drum 节奏型)
// ------------------------------------------------------------
// 架构定稿 Part 4 GrooveLibrary。per-style 节奏型(每小节 4 拍相对拍位)。
//   comp:取代"每和弦一整块"→ 律动/切分。
//   drum:per-style groove(pop backbeat / lofi 半拍 / jazz swing ride)。
// 力度人性化 + 段落 fill 由 drumRenderer 叠加。
// ============================================================

// ---------- comp ----------
export interface CompHit {
  beat: number; // 小节内相对拍位
  dur: number;  // 时值(拍)
  vel: number;
}

const COMP_PATTERNS: Record<string, readonly CompHit[]> = {
  lofi: [
    { beat: 0, dur: 1.5, vel: 58 },
    { beat: 2, dur: 1.5, vel: 50 },
  ],
  pop: [
    { beat: 0, dur: 0.5, vel: 70 },
    { beat: 1, dur: 0.5, vel: 54 },
    { beat: 2, dur: 0.5, vel: 64 },
    { beat: 3, dur: 0.5, vel: 54 },
  ],
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

// ---------- drum ----------
export const DRUM = {
  KICK: 36,
  SNARE: 38,
  CHAT: 42, // closed hi-hat
  OHAT: 46, // open hi-hat
  RIDE: 51,
  PHAT: 44, // pedal hi-hat
} as const;

export interface DrumHit {
  drum: number;
  beat: number;
  vel: number;
}

const HAT8 = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];

const DRUM_PATTERNS: Record<string, readonly DrumHit[]> = {
  // pop:backbeat(snare 2/4)+ 八分 hat
  pop: [
    { drum: DRUM.KICK, beat: 0, vel: 112 },
    { drum: DRUM.KICK, beat: 2, vel: 104 },
    { drum: DRUM.SNARE, beat: 1, vel: 96 },
    { drum: DRUM.SNARE, beat: 3, vel: 100 },
    ...HAT8.map((b) => ({ drum: DRUM.CHAT, beat: b, vel: 58 })),
  ],
  // lofi:慵懒半拍 + 弱 hat
  lofi: [
    { drum: DRUM.KICK, beat: 0, vel: 100 },
    { drum: DRUM.KICK, beat: 2.5, vel: 84 },
    { drum: DRUM.SNARE, beat: 2, vel: 82 },
    ...HAT8.map((b) => ({ drum: DRUM.CHAT, beat: b, vel: 44 })),
  ],
  // jazz:swing ride(三连后位)+ pedal hat 2/4 + 轻 kick
  jazz: [
    // ride 用直 8 分位置;swing 由 applySwing 全局 warp(避免双重 swing)
    { drum: DRUM.RIDE, beat: 0, vel: 72 },
    { drum: DRUM.RIDE, beat: 1, vel: 62 },
    { drum: DRUM.RIDE, beat: 1.5, vel: 56 },
    { drum: DRUM.RIDE, beat: 2, vel: 70 },
    { drum: DRUM.RIDE, beat: 3, vel: 62 },
    { drum: DRUM.RIDE, beat: 3.5, vel: 56 },
    { drum: DRUM.PHAT, beat: 1, vel: 50 },
    { drum: DRUM.PHAT, beat: 3, vel: 50 },
    { drum: DRUM.KICK, beat: 0, vel: 68 },
  ],
  default: [
    { drum: DRUM.KICK, beat: 0, vel: 112 },
    { drum: DRUM.KICK, beat: 2, vel: 100 },
    { drum: DRUM.SNARE, beat: 1, vel: 95 },
    { drum: DRUM.SNARE, beat: 3, vel: 95 },
    ...HAT8.map((b) => ({ drum: DRUM.CHAT, beat: b, vel: 60 })),
  ],
};

export function drumPattern(style: string): DrumHit[] {
  return (DRUM_PATTERNS[style] ?? DRUM_PATTERNS.default).map((h) => ({ ...h }));
}
