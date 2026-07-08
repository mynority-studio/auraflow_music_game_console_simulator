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
const shaker16 = (vel: number): DrumHit[] => HAT16.map((b) => ({ drum: DRUM.SHAKER, beat: b, vel })); // 沙锤 16 分

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
      // ★ clap 叠 backbeat(加厚)
      [K(0, 112), K(2, 104), S(1, 96), S(3, 100), CL(1, 78), CL(3, 82), ...hats8(56)],
    ],
    driving: [
      [K(0, 112), K(1, 92), K(2, 104), K(3, 92), S(1, 100), S(3, 104), ...hats8(62), OH(1.5, 56), OH(3.5, 56)],
      [K(0, 112), K(2, 104), K(2.5, 84), S(1, 100), S(3, 104), S(1.5, 42), S(3.5, 42), ...hats8(64)],
      [K(0, 112), K(1, 92), K(2, 104), K(3, 92), S(1, 100), S(3, 104), CL(1, 84), CL(3, 88), ...hats8(60)],
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

const DRUM_PERFORMANCE_FAMILIES: Record<string, DrumHit[][]> = {
  'citypop-disco-boogie': [
    [K(0, 108), K(1, 86), K(2, 102), K(3, 86), S(1, 96), S(3, 100), CL(1, 72), CL(3, 76), ...HAT16.map((b) => ({ drum: DRUM.CHAT, beat: b, vel: b % 1 === 0 ? 54 : 42 })), { drum: DRUM.TAMB, beat: 1.5, vel: 48 }, { drum: DRUM.TAMB, beat: 3.5, vel: 48 }],
    [K(0, 110), K(0.75, 78), K(2, 102), K(2.75, 82), S(1, 96), S(3, 100), CL(1, 70), CL(3, 76), ...HAT16.map((b) => ({ drum: DRUM.CHAT, beat: b, vel: b % 1 === 0 ? 56 : 40 })), OH(3.5, 56)],
    [K(0, 108), K(1.5, 80), K(2, 102), K(3.5, 82), S(1, 96), S(3, 102), ...HAT16.map((b) => ({ drum: b % 1 === 0 ? DRUM.CHAT : DRUM.TAMB, beat: b, vel: b % 1 === 0 ? 52 : 34 }))],
  ],
  'pop-backbeat': DRUM_GROOVES.pop.straight,
  'jpop-driving-8ths': DRUM_GROOVES.pop.driving,
  'ballad-halftime': [
    [K(0, 98), S(2, 86), ...hats4(38)],
    [K(0, 96), K(2.5, 70), S(2, 84), ...hats4(36)],
    [K(0, 94), SK(2, 72), ...hats4(34)],
  ],
  'rnb-neo-soul': DRUM_GROOVES.rnb.laidback,
  'rnb-dilla': [
    [K(0, 96), K(2.5, 78), S(2, 82), CL(2, 58), ...shaker16(34)],
    [K(0, 94), K(1.5, 68), K(2.5, 76), S(2, 80), S(3.5, 34), ...shaker16(32)],
    [K(0, 92), K(2.75, 76), SK(2, 70), CL(2, 54), ...shaker16(32)],
  ],
  'rnb-gospel-shuffle': [
    [K(0, 98), K(2.67, 78), S(2, 86), CL(2, 58), ...[0, 0.67, 1, 1.67, 2, 2.67, 3, 3.67].map((b) => ({ drum: DRUM.SHAKER, beat: b, vel: 34 }))],
    [K(0, 98), K(1.67, 72), K(2.67, 78), S(2, 86), S(3.67, 34), ...[0, 0.67, 1, 1.67, 2, 2.67, 3, 3.67].map((b) => ({ drum: DRUM.SHAKER, beat: b, vel: 34 }))],
  ],
  'trap-soul-halftime': [
    [K(0, 98), K(2.5, 74), S(2, 82), ...hats8(42)],
    [K(0, 96), K(1.5, 68), S(2, 82), S(3.5, 34), ...hats8(40)],
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
