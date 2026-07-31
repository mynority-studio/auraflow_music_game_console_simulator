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
  // ★ 2026-06-09 扩库(联网研究 genre 鼓色):
  SIDESTICK: 37, // 边击/rim(lofi/ballad verse 的轻军鼓替身)
  CLAP: 39,      // 拍手(pop/rnb backbeat 叠层加厚)
  TOM_LO: 45, TOM_MID: 47, TOM_HI: 50, // 嗵鼓(fill / tom roll)
  CRASH: 49,     // 吊镲(段落/乐句下拍重音落点)
  RIDE_BELL: 53, // ride 铃(jazz 加重)
  TAMB: 54,      // 铃鼓(pop 16 分亮色)
  SHAKER: 70,    // 沙锤(rnb/neo-soul 16 分律动)
  CONGA_HI: 62, CONGA_LO: 63, // 康加(latin/rnb 副打击)
} as const;

export interface DrumHit {
  drum: number;
  beat: number;
  vel: number;
}

export interface DrumPerformanceLike {
  patternFamily?: string;
  role?: string;
  complexity?: number;
  intensity?: number;
  hatPolicy?: string;
  kickPolicy?: string;
  snarePolicy?: string;
}

export type LofiDrumPhraseFamily =
  | 'slow-boombap'
  | 'dusty-dilla-boombap'
  | 'slow-soul-halftime';
export type LofiDrumBackbeatMode = 'two-four' | 'halftime-three';

/**
 * A LOFI Hip Hop groove is selected as one indivisible two-bar phrase.
 * `turnaroundBar` is the only structural replacement permitted at an
 * Arranger-declared 8-bar cadence; Performance may still shape timing and
 * velocity, but it must not change these nominal onset masks.
 */
export interface LofiDrumPhrase {
  id: string;
  family: LofiDrumPhraseFamily;
  backbeatMode: LofiDrumBackbeatMode;
  bars: readonly [readonly DrumHit[], readonly DrumHit[]];
  turnaroundBar: readonly DrumHit[];
}

/**
 * A low-density four-bar percussion layer.  It is selected independently from
 * the kick/backbeat phrase so the Arranger can add or remove the upper loop
 * without changing the song's Boom-bap identity.
 */
export interface LofiAuxiliaryTopLoop {
  id: string;
  bars: readonly [
    readonly DrumHit[],
    readonly DrumHit[],
    readonly DrumHit[],
    readonly DrumHit[],
  ];
}

const HAT8 = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
const HAT16 = Array.from({ length: 16 }, (_, i) => i * 0.25);

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
const lofiHats8 = (downVel: number, offVel: number): DrumHit[] =>
  HAT8.map((beat) => ({ drum: DRUM.CHAT, beat, vel: beat % 1 === 0 ? downVel : offVel }));
const hats4 = (vel: number): DrumHit[] => [0, 1, 2, 3].map((b) => ({ drum: DRUM.CHAT, beat: b, vel }));
const hats16BoomBap = (downVel: number, offVel: number, ghostVel: number, drum = DRUM.CHAT): DrumHit[] =>
  HAT16.map((b) => ({ drum, beat: b, vel: b % 1 === 0 ? downVel : b % 0.5 === 0 ? offVel : ghostVel }));
const K = (beat: number, vel: number): DrumHit => ({ drum: DRUM.KICK, beat, vel });
const S = (beat: number, vel: number): DrumHit => ({ drum: DRUM.SNARE, beat, vel });
const R = (beat: number, vel: number): DrumHit => ({ drum: DRUM.RIDE, beat, vel });
const PH = (beat: number, vel: number): DrumHit => ({ drum: DRUM.PHAT, beat, vel });
const OH = (beat: number, vel: number): DrumHit => ({ drum: DRUM.OHAT, beat, vel });
// ★ 扩库副打击构造器(genre 鼓色)
const CL = (beat: number, vel: number): DrumHit => ({ drum: DRUM.CLAP, beat, vel });       // 拍手
const SK = (beat: number, vel: number): DrumHit => ({ drum: DRUM.SIDESTICK, beat, vel });   // 边击
const RB = (beat: number, vel: number): DrumHit => ({ drum: DRUM.RIDE_BELL, beat, vel });   // ride 铃
const CGH = (beat: number, vel: number): DrumHit => ({ drum: DRUM.CONGA_HI, beat, vel });
const CGL = (beat: number, vel: number): DrumHit => ({ drum: DRUM.CONGA_LO, beat, vel });
const shaker16 = (vel: number): DrumHit[] => HAT16.map((b) => ({ drum: DRUM.SHAKER, beat: b, vel })); // 沙锤 16 分
const hats16Accent = (downVel: number, offVel: number, ghostVel: number): DrumHit[] =>
  HAT16.map((b) => ({ drum: DRUM.CHAT, beat: b, vel: b % 1 === 0 ? downVel : b % 0.5 === 0 ? offVel : ghostVel }));
const tamb16 = (downVel: number, ghostVel: number): DrumHit[] =>
  HAT16.map((b) => ({ drum: DRUM.TAMB, beat: b, vel: b % 1 === 0 ? downVel : ghostVel }));
const cityPopHat16 = (downVel = 58, offVel = 48, ghostVel = 32): DrumHit[] =>
  HAT16.map((b) => ({ drum: DRUM.CHAT, beat: b, vel: b % 1 === 0 ? downVel : b % 0.5 === 0 ? offVel : ghostVel }));
const cityPopTambOffbeats = (vel = 38): DrumHit[] => [0.5, 1.5, 2.5, 3.5].map((beat) => ({ drum: DRUM.TAMB, beat, vel }));
const cityPopBackbeat = (snareVel = 96, clapVel = 70): DrumHit[] => [S(1, snareVel), CL(1, clapVel), S(3, snareVel + 4), CL(3, clapVel + 4)];
const popBackbeat = (snareVel = 88, clapVel = 54): DrumHit[] => [S(1, snareVel), CL(1, clapVel), S(3, snareVel + 4), CL(3, clapVel + 4)];
const popGhosts = (vel = 32): DrumHit[] => [S(0.75, vel), S(2.75, vel + 3)];
const loungeCongas = (vel = 34): DrumHit[] => [CGL(1.5, vel), CGH(2.5, vel + 4), CGL(3.5, vel - 2)];
const TRIPLET8 = [0, 0.67, 1, 1.67, 2, 2.67, 3, 3.67];
const tripletShaker = (vel: number): DrumHit[] => TRIPLET8.map((b) => ({ drum: DRUM.SHAKER, beat: b, vel }));

// 每 (style × groove) = 2-3 个变体(DrumHit[][])。
const DRUM_GROOVES: Record<string, Record<GrooveKind, DrumHit[][]>> = {
  pop: {
    sparse: [
      [K(0, 92), SK(2, 66), ...hats4(34), { drum: DRUM.SHAKER, beat: 3.5, vel: 24 }],
      [K(0, 90), K(2.5, 58), SK(2, 64), ...hats8(30), CGL(1.5, 28), CGH(2.5, 32)],
    ],
    laidback: [
      [K(0, 96), K(2.5, 74), ...popBackbeat(82, 46), ...popGhosts(28), ...hats8(42), ...cityPopTambOffbeats(26)],
      [K(0, 96), K(1.5, 62), K(2.75, 72), S(1, 82), S(3, 88), SK(2.75, 28), ...hats16Accent(38, 30, 20)],
      [K(0, 94), K(0.75, 52), K(2.5, 72), SK(1, 70), S(3, 84), ...hats8(38), ...loungeCongas(30)],
    ],
    straight: [
      [K(0, 98), K(2, 88), K(2.75, 64), ...popBackbeat(86, 52), ...popGhosts(30), ...hats8(44), ...cityPopTambOffbeats(28)],
      [K(0, 98), K(1.5, 62), K(2, 86), S(1, 84), S(3, 90), SK(2.75, 30), ...hats16Accent(42, 34, 22), OH(3.5, 36)],
      [K(0, 96), K(0.75, 54), K(2.25, 76), K(3.5, 60), ...popBackbeat(84, 50), ...hats16Accent(41, 33, 21)],
      [K(0, 96), K(2, 84), S(1, 80), S(3, 88), ...hats8(40), ...shaker16(24), ...loungeCongas(30)],
    ],
    driving: [
      [K(0, 102), K(1, 82), K(2, 94), K(3, 80), ...popBackbeat(90, 58), ...cityPopHat16(48, 39, 25), OH(1.5, 42), OH(3.5, 46)],
      [K(0, 102), K(0.75, 58), K(2, 92), K(2.75, 70), S(1, 90), S(3, 96), S(3.5, 34), ...hats16Accent(48, 38, 24), ...cityPopTambOffbeats(32)],
      [K(0, 100), K(1, 78), K(2, 92), K(3, 78), S(1, 90), S(3, 96), CL(1, 58), CL(3, 64), ...hats8(48), ...shaker16(26)],
    ],
  },
  rnb: {
    sparse: [[K(0, 94), S(2, 76), ...hats4(38)]],
    laidback: [
      [K(0, 96), K(2.5, 80), S(2, 82), S(2.5, 38), ...hats8(42)],
      [K(0, 96), K(1.5, 70), K(2.5, 78), S(2, 80), S(3.5, 36), ...hats8(40)],
      // ★ neo-soul 沙锤 16 分 + clap rim(conversational)
      [K(0, 96), K(2.5, 80), S(2, 82), S(2.5, 36), CL(2, 60), ...shaker16(34)],
    ],
    straight: [
      [K(0, 96), K(2, 84), S(1, 82), S(3, 84), ...hats8(46)],
      [K(0, 96), K(2, 84), S(1, 82), S(3, 84), S(1.5, 38), ...hats8(44)],
      [K(0, 96), K(2, 84), S(1, 82), S(3, 84), CL(1, 64), CL(3, 66), ...shaker16(36)],
    ],
    driving: [
      [K(0, 100), K(2, 90), K(2.5, 74), S(1, 92), S(3, 96), S(3.5, 40), ...hats8(50), OH(1.5, 52)],
      [K(0, 100), K(1, 80), K(2, 90), K(3, 80), S(1, 92), S(3, 96), ...hats8(52)],
    ],
  },
  lofi: {
    sparse: [[K(0, 96), S(2, 78), ...hats4(36)]],
    laidback: [
      // classic lofi boom-bap:snare/rim on 2/4, syncopated kick, ghost hats.
      [K(0, 100), K(0.75, 60), K(2, 86), K(2.75, 70), S(1, 84), S(3, 88), SK(0.75, 28), SK(2.75, 32), ...hats16BoomBap(48, 38, 26)],
      [K(0, 98), K(1.75, 70), K(2, 84), K(2.5, 72), SK(1, 76), SK(3, 82), S(3, 52), SK(0.75, 26), SK(2.75, 30), ...hats16BoomBap(46, 36, 24)],
      [K(0, 98), K(0.5, 56), K(2.25, 78), K(3.5, 64), S(1, 82), S(3, 86), CL(3, 44), SK(2.75, 28), ...hats16BoomBap(46, 35, 24), OH(3.5, 36)],
    ],
    straight: [
      [K(0, 98), K(2, 86), S(2, 80), ...hats8(44)],
      [K(0, 98), K(2, 84), S(1, 76), S(3, 78), ...hats8(42)],
      [K(0, 98), K(2, 86), SK(2, 72), ...hats8(42)],
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
      // ★ ride 铃加重(comping kicks/snare 对话)
      [RB(0, 74), R(1, 64), R(1.5, 56), RB(2, 72), R(3, 64), R(3.5, 56), PH(1, 52), PH(3, 52), K(0, 64), K(2.5, 58), S(1.5, 50), S(3.5, 52)],
    ],
  },
};

/** (style × groove) → 变体列表(确定性挑选交器配层)。缺风格 → default(=pop straight 系);缺 groove → 该风格 straight。 */
export function drumGrooveVariants(style: string, groove: GrooveKind): DrumHit[][] {
  const byStyle = DRUM_GROOVES[style.toLowerCase()] ?? DRUM_GROOVES.pop;
  const variants = byStyle[groove] ?? byStyle.straight;
  return variants.map((v) => v.map((h) => ({ ...h })));
}

const CITYPOP_DISCO_BOOGIE: DrumHit[][] = [
  // CityPop hook:four-on-floor disco-boogie + 16 分帽 + open-hat lift + snare/clap 叠层。
  [K(0, 110), K(1, 92), K(2, 106), K(3, 92), ...cityPopBackbeat(98, 74), ...cityPopHat16(58, 48, 32), ...cityPopTambOffbeats(36), OH(1.5, 52), OH(3.5, 58)],
  [K(0, 110), K(1, 90), K(2, 104), K(2.75, 76), K(3, 90), ...cityPopBackbeat(96, 72), ...cityPopHat16(56, 47, 31), { drum: DRUM.TAMB, beat: 1.5, vel: 42 }, { drum: DRUM.TAMB, beat: 3.5, vel: 46 }, OH(0.5, 44), OH(2.5, 50)],
  [K(0, 108), K(1, 88), K(1.75, 74), K(2, 104), K(3, 88), ...cityPopBackbeat(98, 70), ...cityPopHat16(57, 46, 30), ...tamb16(36, 22), OH(3.5, 56)],
];

const CITYPOP_SYNCOPATED_BOOGIE: DrumHit[][] = [
  // CityPop verse:syncopated kick answers the bass;backbeat stays fat, hat/tamb carry the engine.
  [K(0, 108), K(0.75, 70), K(2, 100), K(2.75, 76), ...cityPopBackbeat(94, 68), ...cityPopHat16(54, 44, 30), ...cityPopTambOffbeats(34), OH(3.5, 50)],
  [K(0, 106), K(1.5, 76), K(2, 98), K(3.5, 74), ...cityPopBackbeat(94, 68), S(0.75, 34), S(2.75, 38), ...cityPopHat16(53, 43, 29), { drum: DRUM.TAMB, beat: 1.5, vel: 40 }, { drum: DRUM.TAMB, beat: 3.5, vel: 44 }, OH(3.5, 48)],
  [K(0, 106), K(0.5, 62), K(2.25, 78), K(2.75, 76), ...cityPopBackbeat(92, 66), S(0.75, 32), S(2.75, 36), ...cityPopHat16(52, 42, 28), ...cityPopTambOffbeats(32), OH(1.5, 42), OH(3.5, 50)],
];

const POP_MODERN_BACKBEAT: DrumHit[][] = [
  // Live/bar pop:the backbeat is familiar, but kick answers, ghost notes and light percussion keep it breathing.
  [K(0, 98), K(2, 88), K(2.75, 64), ...popBackbeat(84, 50), ...popGhosts(28), ...cityPopHat16(44, 35, 22), ...cityPopTambOffbeats(28)],
  [K(0, 98), K(1.5, 62), K(2, 86), S(1, 84), S(3, 90), SK(2.75, 30), ...hats16Accent(44, 35, 22), OH(3.5, 36)],
  [K(0, 96), K(0.75, 54), K(2.25, 76), K(3.5, 60), ...popBackbeat(84, 50), ...hats16Accent(42, 34, 21), { drum: DRUM.TAMB, beat: 3.5, vel: 30 }],
  [K(0, 96), K(2, 84), S(1, 80), S(3, 88), S(0.75, 26), ...hats16Accent(40, 32, 20), ...shaker16(24), ...loungeCongas(30)],
  [K(0, 98), K(1, 70), K(2, 86), K(2.5, 62), S(1, 84), S(3, 90), CL(3, 54), S(3.5, 30), ...hats16Accent(43, 34, 21)],
];

const JPOP_DRIVING_8THS: DrumHit[][] = [
  [K(0, 100), K(0.75, 58), K(2, 90), K(3, 66), S(1, 86), S(3, 92), CL(3, 54), S(2.75, 28), ...cityPopHat16(46, 37, 23), OH(3.5, 38)],
  [K(0, 100), K(1, 68), K(2, 90), K(2.5, 62), S(1, 86), S(3, 92), S(3.5, 30), ...cityPopHat16(46, 37, 23), ...cityPopTambOffbeats(28)],
  [K(0, 98), K(1.5, 62), K(2, 90), K(3.5, 62), S(1, 86), S(3, 92), CL(3, 54), ...cityPopHat16(46, 37, 23), ...loungeCongas(30)],
  [K(0, 98), K(0.5, 50), K(2.25, 76), K(2.75, 64), S(1, 82), S(3, 90), S(2.75, 28), ...hats16Accent(45, 36, 22), OH(1.5, 34)],
];

const tr808Hat16 = (downVel = 48, offVel = 38, ghostVel = 24): DrumHit[] =>
  HAT16.map((b) => ({ drum: DRUM.CHAT, beat: b, vel: b % 1 === 0 ? downVel : b % 0.5 === 0 ? offVel : ghostVel }));
const tr808HatRoll = (start: number, vel = 26): DrumHit[] => [0, 0.125, 0.25, 0.375].map((d, i) => ({ drum: DRUM.CHAT, beat: start + d, vel: vel + i * 3 }));

const TR808_RNB_POCKET: DrumHit[][] = [
  [K(0, 108), K(1.75, 72), K(2.5, 88), S(1, 74), CL(1, 52), S(3, 82), CL(3, 60), ...tr808Hat16(44, 34, 22), ...tr808HatRoll(3.5, 24), OH(3.5, 34)],
  [K(0, 106), K(0.75, 62), K(2.25, 84), K(2.75, 78), SK(1, 72), CL(1, 46), S(3, 82), CL(3, 58), ...tr808Hat16(43, 34, 22), ...tr808HatRoll(2.5, 23)],
  [K(0, 104), K(1.5, 70), K(2.5, 84), S(1, 72), CL(1, 48), S(3, 82), CL(3, 58), SK(2.75, 26), ...tr808Hat16(42, 33, 21), OH(3.75, 32)],
];

const TR808_DILLA_POCKET: DrumHit[][] = [
  [K(0, 106), K(0.75, 62), K(2.5, 86), SK(1, 72), CL(1, 46), S(3, 80), CL(3, 54), SK(2.75, 26), ...tr808Hat16(42, 32, 20), ...tr808HatRoll(3.5, 23)],
  [K(0, 104), K(1.5, 70), K(2.25, 78), S(1, 72), CL(1, 44), S(3, 80), CL(3, 52), SK(3.5, 26), ...tr808Hat16(41, 32, 20)],
  [K(0, 104), K(0.5, 58), K(2.75, 82), SK(1, 70), S(3, 78), CL(3, 50), SK(3.5, 26), ...tr808Hat16(40, 31, 20), ...tr808HatRoll(2.5, 22)],
];

const TR808_TRAP_SOUL_HALFTIME: DrumHit[][] = [
  [K(0, 110), K(2.5, 86), K(3.25, 72), S(2, 86), CL(2, 56), SK(1.75, 24), ...tr808Hat16(44, 34, 22), ...tr808HatRoll(3.5, 24), OH(3.75, 32)],
  [K(0, 108), K(1.5, 72), K(2.75, 82), S(2, 86), CL(2, 54), S(3.5, 34), ...tr808Hat16(43, 34, 22), ...tr808HatRoll(1.5, 22)],
  [K(0, 108), K(0.75, 64), K(2.5, 82), S(2, 84), CL(2, 54), SK(3.5, 26), ...tr808Hat16(42, 32, 20), OH(3.5, 30)],
];

const TR808_LOFI_BOOMBAP: DrumHit[][] = [
  [K(0, 104), K(0.75, 62), K(2, 88), K(2.75, 72), SK(1, 80), CL(1, 42), SK(3, 84), CL(3, 48), SK(2.75, 26), ...tr808Hat16(42, 32, 20), ...tr808HatRoll(3.5, 22)],
  [K(0, 102), K(1.75, 70), K(2.5, 76), SK(1, 78), SK(3, 84), CL(3, 46), SK(0.75, 24), ...tr808Hat16(40, 31, 20), OH(3.5, 30)],
  [K(0, 102), K(0.5, 56), K(2.25, 80), K(3.5, 64), S(1, 78), SK(3, 82), CL(3, 44), SK(2.75, 24), ...tr808Hat16(40, 31, 20), ...tr808HatRoll(2.5, 22)],
];

const TR808_LOFI_DUSTY_BREAK: DrumHit[][] = [
  [K(0, 102), K(1.75, 68), K(2.5, 74), SK(1, 76), SK(3, 82), CL(3, 44), SK(0.75, 24), SK(2.75, 26), ...tr808Hat16(38, 29, 18), OH(3.5, 28)],
  [K(0, 100), K(0.75, 58), K(2.25, 78), SK(1, 74), SK(3, 80), CL(3, 42), S(3.5, 28), ...tr808Hat16(38, 28, 18), ...tr808HatRoll(2.5, 20)],
  [K(0, 100), K(0.5, 54), K(2.75, 76), S(1, 74), SK(3, 80), CL(3, 42), SK(2.75, 24), ...tr808Hat16(37, 28, 18), ...tr808HatRoll(3.5, 20)],
];

const TR808_LOFI_MINIMAL: DrumHit[][] = [
  [K(0, 98), SK(2, 72), ...tr808Hat16(34, 26, 18)],
  [K(0, 98), K(2.5, 66), SK(2, 70), ...tr808Hat16(34, 26, 18)],
  [K(0, 96), S(2, 70), ...tr808Hat16(32, 25, 17)],
];

const TR808_LOFI_SOUL_HALFTIME: DrumHit[][] = [
  [K(0, 100), K(2.75, 72), SK(2, 78), ...lofiHats8(38, 28)],
  [K(0, 98), K(1.75, 62), K(3.5, 68), SK(2, 76), ...lofiHats8(36, 27)],
];

const LOFI_DRUM_PHRASES: readonly LofiDrumPhrase[] = [
  {
    id: 'lofi-boombap-soul-01',
    family: 'slow-boombap',
    backbeatMode: 'two-four',
    bars: [
      [K(0, 104), K(2.5, 78), SK(1, 80), SK(3, 84), ...lofiHats8(42, 30)],
      [K(0, 102), K(1.75, 66), K(2.75, 74), SK(1, 78), SK(3, 84), ...lofiHats8(41, 29)],
    ],
    turnaroundBar: [K(0, 102), K(2.5, 76), K(3.75, 68), SK(1, 78), SK(3, 84), ...lofiHats8(41, 29)],
  },
  {
    id: 'lofi-boombap-soul-02',
    family: 'slow-boombap',
    backbeatMode: 'two-four',
    bars: [
      [K(0, 104), K(0.75, 58), K(2.25, 78), SK(1, 80), SK(3, 84), ...lofiHats8(41, 29)],
      [K(0, 102), K(2, 82), K(3.5, 62), SK(1, 78), SK(3, 83), ...lofiHats8(40, 28)],
    ],
    turnaroundBar: [K(0, 102), K(2.25, 78), K(3.75, 66), SK(1, 78), SK(3, 84), ...lofiHats8(40, 28)],
  },
  {
    id: 'lofi-boombap-soul-03',
    family: 'slow-boombap',
    backbeatMode: 'two-four',
    bars: [
      [K(0, 102), K(1.5, 62), K(2.75, 76), SK(1, 78), SK(3, 82), ...lofiHats8(40, 28)],
      [K(0, 104), K(0.5, 56), K(2.5, 78), SK(1, 79), SK(3, 84), ...lofiHats8(41, 29)],
    ],
    turnaroundBar: [K(0, 102), K(1.5, 60), K(3.75, 68), SK(1, 78), SK(3, 84), ...lofiHats8(40, 28)],
  },
  {
    id: 'lofi-boombap-soul-04',
    family: 'slow-boombap',
    backbeatMode: 'two-four',
    bars: [
      [K(0, 104), K(2, 80), SK(1, 80), SK(3, 84), ...lofiHats8(42, 30)],
      [K(0, 102), K(3.5, 62), SK(1, 78), SK(3, 82), ...lofiHats8(40, 28)],
    ],
    turnaroundBar: [K(0, 102), K(2, 78), K(3.75, 66), SK(1, 78), SK(3, 84), ...lofiHats8(40, 28)],
  },
  {
    id: 'lofi-boombap-soul-05',
    family: 'slow-boombap',
    backbeatMode: 'two-four',
    bars: [
      [K(0, 104), K(2.5, 76), SK(1, 80), SK(3, 84), ...lofiHats8(42, 29)],
      [K(0, 102), K(2.5, 74), K(3.5, 58), SK(1, 78), SK(3, 83), ...lofiHats8(40, 27)],
    ],
    turnaroundBar: [K(0, 102), K(2.5, 74), K(3.75, 62), SK(1, 78), SK(3, 84), ...lofiHats8(40, 27)],
  },
  {
    id: 'lofi-boombap-soul-06',
    family: 'slow-boombap',
    backbeatMode: 'two-four',
    bars: [
      [K(0, 104), K(2.75, 76), SK(1, 80), SK(3, 84), ...lofiHats8(41, 29)],
      [K(0, 102), K(0.75, 56), K(2.75, 74), SK(1, 78), SK(3, 83), ...lofiHats8(40, 28)],
    ],
    turnaroundBar: [K(0, 102), K(2.75, 74), K(3.75, 62), SK(1, 78), SK(3, 84), ...lofiHats8(40, 28)],
  },
  {
    id: 'lofi-boombap-soul-07',
    family: 'slow-boombap',
    backbeatMode: 'two-four',
    bars: [
      [K(0, 104), K(1.75, 64), SK(1, 80), SK(3, 84), ...lofiHats8(42, 29)],
      [K(0, 102), K(2.25, 76), K(3.5, 58), SK(1, 78), SK(3, 83), ...lofiHats8(40, 27)],
    ],
    turnaroundBar: [K(0, 102), K(1.75, 62), K(3.75, 64), SK(1, 78), SK(3, 84), ...lofiHats8(40, 27)],
  },
  {
    id: 'lofi-boombap-soul-08',
    family: 'slow-boombap',
    backbeatMode: 'two-four',
    bars: [
      [K(0, 104), K(0.5, 54), K(2.5, 76), SK(1, 80), SK(3, 84), ...lofiHats8(41, 28)],
      [K(0, 102), K(2, 78), K(2.75, 62), SK(1, 78), SK(3, 83), ...lofiHats8(40, 27)],
    ],
    turnaroundBar: [K(0, 102), K(2.5, 74), K(3.75, 64), SK(1, 78), SK(3, 84), ...lofiHats8(40, 27)],
  },
  {
    id: 'lofi-dilla-dust-01',
    family: 'dusty-dilla-boombap',
    backbeatMode: 'two-four',
    bars: [
      [K(0, 102), K(1.75, 66), K(2.5, 74), SK(1, 76), SK(3, 82), SK(2.75, 25), ...lofiHats8(38, 27)],
      [K(0, 100), K(0.75, 56), K(2.25, 76), SK(1, 75), SK(3, 80), ...lofiHats8(37, 26), OH(3.5, 27)],
    ],
    turnaroundBar: [K(0, 100), K(2.25, 76), K(3.75, 65), SK(1, 75), SK(3, 81), SK(3.5, 28), ...lofiHats8(37, 26)],
  },
  {
    id: 'lofi-dilla-dust-02',
    family: 'dusty-dilla-boombap',
    backbeatMode: 'two-four',
    bars: [
      [K(0, 100), K(0.5, 54), K(2.75, 74), SK(1, 75), SK(3, 81), ...lofiHats8(37, 26)],
      [K(0, 102), K(1.5, 62), K(2.25, 76), SK(1, 76), SK(3, 82), SK(0.75, 24), ...lofiHats8(38, 27)],
    ],
    turnaroundBar: [K(0, 100), K(1.5, 60), K(3.75, 65), SK(1, 75), SK(3, 81), ...lofiHats8(37, 26)],
  },
  {
    id: 'lofi-dilla-dust-03',
    family: 'dusty-dilla-boombap',
    backbeatMode: 'two-four',
    bars: [
      [K(0, 102), K(2.25, 76), SK(1, 76), SK(3, 82), SK(2.75, 24), ...lofiHats8(38, 27)],
      [K(0, 100), K(0.75, 56), K(2.75, 72), SK(1, 75), SK(3, 80), ...lofiHats8(37, 26)],
    ],
    turnaroundBar: [K(0, 100), K(2.25, 74), K(3.75, 66), SK(1, 75), SK(3, 81), OH(3.5, 27), ...lofiHats8(37, 26)],
  },
  {
    id: 'lofi-dilla-dust-04',
    family: 'dusty-dilla-boombap',
    backbeatMode: 'two-four',
    bars: [
      [K(0, 102), K(0.75, 54), K(2.5, 72), SK(1, 76), SK(3, 82), ...lofiHats8(38, 26)],
      [K(0, 100), K(1.75, 62), K(2.75, 70), SK(1, 75), SK(3, 80), SK(3.5, 23), ...lofiHats8(37, 25)],
    ],
    turnaroundBar: [K(0, 100), K(1.75, 60), K(3.75, 64), SK(1, 75), SK(3, 81), ...lofiHats8(37, 25)],
  },
  {
    id: 'lofi-dilla-dust-05',
    family: 'dusty-dilla-boombap',
    backbeatMode: 'two-four',
    bars: [
      [K(0, 102), K(1.5, 60), K(2.5, 72), SK(1, 76), SK(3, 82), SK(0.75, 23), ...lofiHats8(38, 26)],
      [K(0, 100), K(0.5, 52), K(2.25, 74), SK(1, 75), SK(3, 80), ...lofiHats8(37, 25), OH(3.5, 26)],
    ],
    turnaroundBar: [K(0, 100), K(2.5, 72), K(3.75, 64), SK(1, 75), SK(3, 81), ...lofiHats8(37, 25)],
  },
  {
    id: 'lofi-halftime-soul-01',
    family: 'slow-soul-halftime',
    backbeatMode: 'halftime-three',
    bars: [
      [K(0, 100), K(2.75, 72), SK(2, 78), ...lofiHats8(38, 27)],
      [K(0, 98), K(1.75, 60), K(3.5, 66), SK(2, 76), ...lofiHats8(36, 26)],
    ],
    turnaroundBar: [K(0, 98), K(2.75, 70), K(3.75, 64), SK(2, 77), ...lofiHats8(36, 26)],
  },
  {
    id: 'lofi-halftime-soul-02',
    family: 'slow-soul-halftime',
    backbeatMode: 'halftime-three',
    bars: [
      [K(0, 100), K(1.5, 60), SK(2, 78), ...lofiHats8(38, 27)],
      [K(0, 98), K(2.5, 70), K(3.75, 62), SK(2, 76), ...lofiHats8(36, 26)],
    ],
    turnaroundBar: [K(0, 98), K(1.75, 58), K(3.75, 65), SK(2, 77), ...lofiHats8(36, 26)],
  },
  {
    id: 'lofi-halftime-soul-03',
    family: 'slow-soul-halftime',
    backbeatMode: 'halftime-three',
    bars: [
      [K(0, 100), K(0.75, 54), K(2.75, 68), SK(2, 78), ...lofiHats8(38, 27)],
      [K(0, 98), K(1.5, 58), K(3.5, 64), SK(2, 76), ...lofiHats8(36, 26)],
    ],
    turnaroundBar: [K(0, 98), K(2.5, 68), K(3.75, 63), SK(2, 77), ...lofiHats8(36, 26)],
  },
];

const LOFI_AUXILIARY_TOP_LOOPS: readonly LofiAuxiliaryTopLoop[] = [
  {
    id: 'lofi-top-shaker-air-01',
    bars: [
      [{ drum: DRUM.SHAKER, beat: 1.5, vel: 28 }, { drum: DRUM.SHAKER, beat: 3.5, vel: 32 }],
      [{ drum: DRUM.SHAKER, beat: 0.5, vel: 24 }, { drum: DRUM.SHAKER, beat: 2.5, vel: 30 }],
      [{ drum: DRUM.SHAKER, beat: 1.5, vel: 27 }, { drum: DRUM.SHAKER, beat: 3.5, vel: 33 }],
      [{ drum: DRUM.SHAKER, beat: 0.5, vel: 23 }, { drum: DRUM.SHAKER, beat: 2.5, vel: 29 }, { drum: DRUM.SHAKER, beat: 3.75, vel: 25 }],
    ],
  },
  {
    id: 'lofi-top-rim-answer-01',
    bars: [
      [{ drum: DRUM.SIDESTICK, beat: 2.5, vel: 28 }],
      [{ drum: DRUM.SIDESTICK, beat: 0.5, vel: 24 }, { drum: DRUM.SIDESTICK, beat: 2.5, vel: 30 }],
      [{ drum: DRUM.SIDESTICK, beat: 2.5, vel: 27 }],
      [{ drum: DRUM.SIDESTICK, beat: 0.5, vel: 24 }, { drum: DRUM.SIDESTICK, beat: 3.5, vel: 31 }],
    ],
  },
  {
    id: 'lofi-top-conga-dust-01',
    bars: [
      [{ drum: DRUM.CONGA_LO, beat: 1.5, vel: 26 }],
      [{ drum: DRUM.CONGA_HI, beat: 2.5, vel: 30 }],
      [{ drum: DRUM.CONGA_LO, beat: 0.5, vel: 24 }, { drum: DRUM.CONGA_HI, beat: 3.5, vel: 29 }],
      [{ drum: DRUM.CONGA_LO, beat: 1.5, vel: 25 }, { drum: DRUM.CONGA_HI, beat: 2.75, vel: 28 }],
    ],
  },
  {
    id: 'lofi-top-tamb-skip-01',
    bars: [
      [{ drum: DRUM.TAMB, beat: 1.5, vel: 25 }],
      [{ drum: DRUM.TAMB, beat: 3.5, vel: 30 }],
      [{ drum: DRUM.TAMB, beat: 1.5, vel: 24 }, { drum: DRUM.TAMB, beat: 2.5, vel: 27 }],
      [{ drum: DRUM.TAMB, beat: 0.5, vel: 23 }, { drum: DRUM.TAMB, beat: 3.5, vel: 31 }],
    ],
  },
];

function familyForLofiPattern(patternFamily: string | undefined): LofiDrumPhraseFamily | undefined {
  if (!patternFamily) return undefined;
  if (patternFamily.includes('soul-halftime')) return 'slow-soul-halftime';
  if (patternFamily.includes('dusty')) return 'dusty-dilla-boombap';
  if (patternFamily.includes('lofi-boombap')) return 'slow-boombap';
  return undefined;
}

export function lofiDrumPhrases(patternFamily?: string): LofiDrumPhrase[] {
  const family = familyForLofiPattern(patternFamily);
  if (!family) return [];
  return lofiDrumPhrasesForFamily(family);
}

export function lofiDrumPhrasesForFamily(family: LofiDrumPhraseFamily): LofiDrumPhrase[] {
  return LOFI_DRUM_PHRASES
    .filter((phrase) => phrase.family === family)
    .map((phrase) => ({
      ...phrase,
      bars: phrase.bars.map((bar) => bar.map((hit) => ({ ...hit }))) as unknown as LofiDrumPhrase['bars'],
      turnaroundBar: phrase.turnaroundBar.map((hit) => ({ ...hit })),
    }));
}

export function lofiDrumPhraseById(id: string | undefined): LofiDrumPhrase | undefined {
  if (!id) return undefined;
  const phrase = LOFI_DRUM_PHRASES.find((candidate) => candidate.id === id);
  if (!phrase) return undefined;
  return {
    ...phrase,
    bars: phrase.bars.map((bar) => bar.map((hit) => ({ ...hit }))) as unknown as LofiDrumPhrase['bars'],
    turnaroundBar: phrase.turnaroundBar.map((hit) => ({ ...hit })),
  };
}

export function lofiAuxiliaryTopLoops(): LofiAuxiliaryTopLoop[] {
  return LOFI_AUXILIARY_TOP_LOOPS.map((loop) => ({
    ...loop,
    bars: loop.bars.map((bar) => bar.map((hit) => ({ ...hit }))) as unknown as LofiAuxiliaryTopLoop['bars'],
  }));
}

export function lofiAuxiliaryTopLoopById(id: string | undefined): LofiAuxiliaryTopLoop | undefined {
  if (!id) return undefined;
  const loop = LOFI_AUXILIARY_TOP_LOOPS.find((candidate) => candidate.id === id);
  if (!loop) return undefined;
  return {
    ...loop,
    bars: loop.bars.map((bar) => bar.map((hit) => ({ ...hit }))) as unknown as LofiAuxiliaryTopLoop['bars'],
  };
}

const RNB_NEO_SOUL_POCKET: DrumHit[][] = [
  [K(0, 96), K(1.75, 66), K(2.5, 78), S(1, 76), CL(1, 46), S(3, 82), CL(3, 54), SK(0.75, 26), SK(2.75, 30), ...shaker16(31), OH(3.5, 38)],
  [K(0, 94), K(0.75, 60), K(2.25, 74), K(2.75, 70), SK(1, 72), S(3, 82), CL(3, 52), SK(2.5, 28), ...shaker16(30)],
  [K(0, 94), K(1.5, 64), K(2.5, 76), S(1, 74), S(3, 80), CL(3, 52), SK(0.75, 26), SK(2.75, 30), ...hats16Accent(38, 32, 22), ...shaker16(26)],
];

const RNB_DILLA_POCKET: DrumHit[][] = [
  [K(0, 96), K(0.75, 60), K(2.5, 76), SK(1, 72), S(3, 80), CL(3, 52), SK(2.75, 28), ...shaker16(32)],
  [K(0, 94), K(1.5, 66), K(2.25, 72), S(1, 72), SK(2.75, 28), S(3, 80), CL(3, 50), ...hats16Accent(40, 32, 22)],
  [K(0, 92), K(0.5, 56), K(2.75, 74), SK(1, 70), SK(3, 76), CL(3, 48), SK(3.5, 28), ...shaker16(30)],
];

const RNB_GOSPEL_TRIPLET: DrumHit[][] = [
  [K(0, 98), K(2.67, 78), S(1, 84), CL(1, 56), S(3, 88), CL(3, 58), ...tripletShaker(34)],
  [K(0, 98), K(1.67, 72), K(2.67, 78), S(1, 84), S(3, 88), S(3.67, 34), ...tripletShaker(34)],
  [K(0, 96), K(0.67, 60), K(2.67, 76), SK(1, 76), S(3, 86), CL(3, 56), ...tripletShaker(32), OH(3.67, 38)],
];

const JAZZ_BRUSH_BALLAD: DrumHit[][] = [
  [S(0, 30), S(1, 24), S(2, 28), S(3, 24), R(0, 50), R(1.5, 38), R(2, 48), R(3.5, 36), PH(1, 40), PH(3, 40), K(0, 48)],
  [SK(0, 26), S(1.5, 30), SK(2, 26), S(3.5, 30), R(0, 48), R(1, 36), R(2, 48), R(3, 36), PH(1, 38), PH(3, 38)],
  [S(0, 28), S(0.75, 22), S(2, 28), S(2.75, 22), R(0, 46), R(1.5, 36), R(2, 46), R(3.5, 36), PH(1, 38), PH(3, 38), K(0, 44)],
];

const DRUM_PERFORMANCE_FAMILIES: Record<string, DrumHit[][]> = {
  'citypop-disco-boogie': CITYPOP_DISCO_BOOGIE,
  'citypop-syncopated-boogie': CITYPOP_SYNCOPATED_BOOGIE,
  'pop-backbeat': POP_MODERN_BACKBEAT,
  'jpop-driving-8ths': JPOP_DRIVING_8THS,
  'ballad-halftime': [
    [K(0, 82), SK(2, 60), ...hats4(28), { drum: DRUM.SHAKER, beat: 3.5, vel: 22 }],
    [K(0, 80), K(2.5, 54), SK(2, 58), ...hats4(26), { drum: DRUM.SHAKER, beat: 1.5, vel: 20 }],
    [K(0, 78), SK(2, 56), SK(3.5, 22), ...hats4(24)],
  ],
  'tr808-rnb-pocket': TR808_RNB_POCKET,
  'tr808-dilla-pocket': TR808_DILLA_POCKET,
  'tr808-trap-soul-halftime': TR808_TRAP_SOUL_HALFTIME,
  'tr808-lofi-boombap': TR808_LOFI_BOOMBAP,
  'tr808-lofi-dusty-break': TR808_LOFI_DUSTY_BREAK,
  'tr808-lofi-minimal': TR808_LOFI_MINIMAL,
  'tr808-lofi-soul-halftime': TR808_LOFI_SOUL_HALFTIME,
  'rnb-neo-soul-pocket': RNB_NEO_SOUL_POCKET,
  'rnb-dilla-pocket': RNB_DILLA_POCKET,
  'rnb-gospel-triplet': RNB_GOSPEL_TRIPLET,
  'rnb-neo-soul': RNB_NEO_SOUL_POCKET,
  'rnb-dilla': RNB_DILLA_POCKET,
  'rnb-gospel-shuffle': RNB_GOSPEL_TRIPLET,
  'trap-soul-halftime': [
    [K(0, 98), K(2.5, 74), S(2, 82), SK(1.75, 26), ...hats16Accent(38, 30, 20)],
    [K(0, 96), K(1.5, 68), S(2, 82), S(3.5, 34), ...hats16Accent(38, 30, 20), OH(3.5, 34)],
  ],
  'smooth-jazz-backbeat': [
    [K(0, 92), K(2.5, 74), SK(1, 64), SK(3, 68), ...shaker16(30), R(0, 52), R(2, 50)],
    [K(0, 90), K(1.5, 66), K(2.5, 72), S(1, 70), S(3, 74), S(2.75, 32), ...hats8(38), R(0, 50), R(2, 48)],
    [K(0, 90), K(2, 72), SK(1, 62), SK(3, 68), CL(3, 48), ...shaker16(28), OH(3.5, 46)],
  ],
  'lofi-boombap': DRUM_GROOVES.lofi.laidback,
  'lofi-dusty-break': [
    [K(0, 94), K(0.75, 56), K(2.5, 76), SK(1, 68), SK(3, 72), SK(2.75, 32), ...shaker16(32)],
    [K(0, 92), K(1.5, 66), K(2.5, 70), SK(1, 66), SK(3, 70), CL(3, 42), SK(0.75, 28), ...shaker16(30)],
    [K(0, 94), K(2.75, 72), SK(1, 68), SK(3, 72), SK(3.5, 30), ...hats16BoomBap(44, 34, 23)],
  ],
  'lofi-minimal': [
    [K(0, 92), SK(2, 68), ...hats4(32)],
    [K(0, 90), K(2.5, 68), SK(2, 66), ...hats4(30)],
    [K(0, 88), S(2, 66), ...hats4(28)],
  ],
  'jazz-swing-ride': DRUM_GROOVES.jazz.straight,
  'jazz-bebop-comping': DRUM_GROOVES.jazz.driving,
  'jazz-brush-ballad': JAZZ_BRUSH_BALLAD,
  'jazz-ballad-light': DRUM_GROOVES.jazz.laidback,
  'jazz-bossa': [
    [R(0, 62), R(1, 54), R(2, 62), R(3, 54), PH(1, 44), PH(3, 44), K(0, 58), K(2.5, 52), SK(1.5, 44)],
    [R(0, 62), R(1.5, 52), R(2, 60), R(3.5, 52), PH(1, 44), PH(3, 44), K(0, 56), K(2.5, 52), SK(1.5, 42), SK(3.5, 42)],
  ],
};

/** DrumPerformanceContract → 具体鼓型族。patternFamily 是 Arranger 总谱主权威;缺失时仍可由 legacy groove fallback。 */
export function drumPerformanceVariants(performance: DrumPerformanceLike): DrumHit[][] {
  const variants = DRUM_PERFORMANCE_FAMILIES[performance.patternFamily ?? ''];
  if (variants) return variants.map((v) => v.map((h) => ({ ...h })));
  return drumGrooveVariants('pop', 'straight');
}
