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

// ============================================================
// ★ 鼓型词汇库(2026-06-08):4 档 groove × 每风格 × 2-3 变体。
//   groove = 鼓的节奏【性格/密度】(Arranger 按段下发);swing 走 feel.swingRatio,不进 groove。
//   器配层按 (style × groove) 从这里确定性挑一个变体(repeatGroup 一致)→ 取代"每风格单一 pattern"的呆板。
// ============================================================
export type GrooveKind = 'sparse' | 'laidback' | 'straight' | 'driving';

const hats8 = (vel: number): DrumHit[] => HAT8.map((b) => ({ drum: DRUM.CHAT, beat: b, vel }));
const hats4 = (vel: number): DrumHit[] => [0, 1, 2, 3].map((b) => ({ drum: DRUM.CHAT, beat: b, vel }));
const K = (beat: number, vel: number): DrumHit => ({ drum: DRUM.KICK, beat, vel });
const S = (beat: number, vel: number): DrumHit => ({ drum: DRUM.SNARE, beat, vel });
const R = (beat: number, vel: number): DrumHit => ({ drum: DRUM.RIDE, beat, vel });
const PH = (beat: number, vel: number): DrumHit => ({ drum: DRUM.PHAT, beat, vel });
const OH = (beat: number, vel: number): DrumHit => ({ drum: DRUM.OHAT, beat, vel });

// 每 (style × groove) = 2-3 个变体(DrumHit[][])。
const DRUM_GROOVES: Record<string, Record<GrooveKind, DrumHit[][]>> = {
  pop: {
    sparse: [[K(0, 100), S(2, 84), ...hats4(40)]],
    laidback: [
      [K(0, 100), K(2.5, 82), S(1, 88), S(3, 92), ...hats8(48)],
      [K(0, 100), K(2, 78), S(1, 86), S(3, 92), S(1.5, 40), ...hats8(46)],
    ],
    straight: [
      [K(0, 112), K(2, 104), S(1, 96), S(3, 100), ...hats8(58)],
      [K(0, 110), K(2, 100), K(2.5, 80), S(1, 96), S(3, 100), ...hats8(56), OH(1.5, 50)],
    ],
    driving: [
      [K(0, 112), K(1, 92), K(2, 104), K(3, 92), S(1, 100), S(3, 104), ...hats8(62), OH(1.5, 56), OH(3.5, 56)],
      [K(0, 112), K(2, 104), K(2.5, 84), S(1, 100), S(3, 104), S(1.5, 42), S(3.5, 42), ...hats8(64)],
    ],
  },
  rnb: {
    sparse: [[K(0, 94), S(2, 76), ...hats4(38)]],
    laidback: [
      [K(0, 96), K(2.5, 80), S(2, 82), S(2.5, 38), ...hats8(42)],
      [K(0, 96), K(1.5, 70), K(2.5, 78), S(2, 80), S(3.5, 36), ...hats8(40)],
    ],
    straight: [
      [K(0, 96), K(2, 84), S(1, 82), S(3, 84), ...hats8(46)],
      [K(0, 96), K(2, 84), S(1, 82), S(3, 84), S(1.5, 38), ...hats8(44)],
    ],
    driving: [
      [K(0, 100), K(2, 90), K(2.5, 74), S(1, 92), S(3, 96), S(3.5, 40), ...hats8(50), OH(1.5, 52)],
      [K(0, 100), K(1, 80), K(2, 90), K(3, 80), S(1, 92), S(3, 96), ...hats8(52)],
    ],
  },
  lofi: {
    sparse: [[K(0, 96), S(2, 78), ...hats4(36)]],
    laidback: [
      [K(0, 100), K(2.5, 84), S(2, 82), ...hats8(44)],
      [K(0, 98), K(1.5, 72), S(2, 80), S(2.5, 36), ...hats8(42)],
    ],
    straight: [
      [K(0, 98), K(2, 86), S(2, 80), ...hats8(44)],
      [K(0, 98), K(2, 84), S(1, 76), S(3, 78), ...hats8(42)],
    ],
    driving: [
      [K(0, 100), K(1.5, 74), K(2, 88), S(2, 82), S(2.5, 38), S(3.5, 38), ...hats8(48)],
      [K(0, 98), K(2, 86), K(3, 76), S(2, 80), ...hats8(46), OH(1.5, 44)],
    ],
  },
  jazz: {
    // jazz 用 ride + pedal hat;swing 由全局 applySwing warp(ride 写直 8 分位)。
    sparse: [[R(0, 66), R(2, 62), PH(1, 46), PH(3, 46), K(0, 60)]],
    laidback: [
      [R(0, 60), R(1, 56), R(2, 60), R(3, 56), PH(1, 46), PH(3, 46)],
      [R(0, 64), R(1.5, 54), R(2, 62), R(3.5, 52), PH(1, 48), PH(3, 48)],
    ],
    straight: [
      [R(0, 72), R(1, 62), R(1.5, 56), R(2, 70), R(3, 62), R(3.5, 56), PH(1, 50), PH(3, 50), K(0, 68)],
      [R(0, 72), R(1, 62), R(1.5, 56), R(2, 70), R(3, 62), R(3.5, 56), PH(1, 50), PH(3, 50), K(0, 66), S(2.5, 46)],
    ],
    driving: [
      [R(0, 78), R(1, 68), R(1.5, 60), R(2, 76), R(3, 68), R(3.5, 60), PH(1, 52), PH(3, 52), K(0, 64), K(2, 60), S(1.5, 50), S(3.5, 50)],
      [R(0, 78), R(1, 68), R(1.5, 62), R(2, 76), R(3, 68), R(3.5, 62), PH(1, 54), PH(3, 54), K(0, 64), S(1.5, 52), S(2.5, 48), S(3.5, 52)],
    ],
  },
};

/** (style × groove) → 变体列表(确定性挑选交器配层)。缺风格 → default(=pop straight 系);缺 groove → 该风格 straight。 */
export function drumGrooveVariants(style: string, groove: GrooveKind): DrumHit[][] {
  const byStyle = DRUM_GROOVES[style.toLowerCase()] ?? DRUM_GROOVES.pop;
  const variants = byStyle[groove] ?? byStyle.straight;
  return variants.map((v) => v.map((h) => ({ ...h })));
}
