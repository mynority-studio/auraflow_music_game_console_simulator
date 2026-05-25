// ============================================================
// note-utils.ts — 音名 / GM drum / 通用 MIDI 转换 helper
// ============================================================
//
// Impro-Visor 音名约定:
//   字母:c d e f g a b(小写)
//   变音:`#` 升 / `b` 降(在字母后)
//   八度:`-` 下 1 octave / `+` 上 1 octave(可叠加 `--` `++`)
//   默认八度:c = MIDI 60(middle C)
//
// 例:
//   'c'   → 60   (C4)
//   'g--' → 43   (G2)
//   'a'   → 69   (A4)
//   'c+'  → 72   (C5)
//   'd-'  → 50   (D3)
//   'eb'  → 63   (Eb4)
//   'f#'  → 66   (F#4)
//
// GM Drum name → MIDI 标准映射(支持 Impro-Visor .sty drum-pattern 用的常见名)。
// ============================================================

export const BASE_C_MIDI = 60;  // middle C

const LETTER_TO_PC: Record<string, number> = {
  'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11,
};

/**
 * 解析 Impro-Visor 音名字符串 → MIDI。
 * @returns MIDI number or null 解析失败
 */
export function parseNoteName(s: string): number | null {
  if (!s) return null;
  const m = s.match(/^([a-g])([#b])?([+-]*)$/);
  if (!m) return null;
  const letter = m[1]!;
  const acc = m[2] ?? '';
  const oct = m[3] ?? '';
  const pc = LETTER_TO_PC[letter];
  if (pc === undefined) return null;
  let midi = BASE_C_MIDI + pc;
  if (acc === '#') midi += 1;
  else if (acc === 'b') midi -= 1;
  for (const c of oct) {
    if (c === '-') midi -= 12;
    else if (c === '+') midi += 12;
  }
  return midi;
}

/**
 * GM Drum name → MIDI key map(Impro-Visor .sty drum-pattern 用的标准名)。
 * 大小写 + 下划线敏感(跟 .sty 原文一致)。
 */
export const DRUM_NAME_TO_MIDI: Record<string, number> = {
  // Kicks
  'Bass_Drum_1':         36,
  'Acoustic_Bass_Drum':  35,
  'Bass_Drum_2':         35,
  // Snares
  'Snare':               38,
  'Acoustic_Snare':      38,
  'Snare_2':             40,
  'Electric_Snare':      40,
  'Side_Stick':          37,
  // Hi-hats
  'Closed_Hi-Hat':       42,
  'Open_Hi-Hat':         46,
  'Pedal_Hi-Hat':        44,
  // Cymbals
  'Crash_Cymbal_1':      49,
  'Crash_Cymbal_2':      57,
  'Ride_Cymbal_1':       51,
  'Ride_Cymbal_2':       59,
  'Ride_Bell':           53,
  'Splash_Cymbal':       55,
  'Chinese_Cymbal':      52,
  // Toms
  'High_Tom':            50,
  'High_Mid_Tom':        48,
  'Low_Mid_Tom':         47,
  'Low_Tom':             45,
  'High_Floor_Tom':      43,
  'Low_Floor_Tom':       41,
  // Percussion
  'Hand_Clap':           39,
  'Tambourine':          54,
  'Cowbell':             56,
  'Vibraslap':           58,
  'High_Bongo':          60,
  'Low_Bongo':           61,
  'Mute_High_Conga':     62,
  'Open_High_Conga':     63,
  'Conga':               63,
  'Low_Conga':           64,
  'High_Timbale':        65,
  'Low_Timbale':         66,
  'High_Agogo':          67,
  'Low_Agogo':           68,
  'Cabasa':              69,
  'Maracas':             70,
  'Short_Whistle':       71,
  'Long_Whistle':        72,
  'Short_Guiro':         73,
  'Long_Guiro':          74,
  'Claves':              75,
  'High_Wood_Block':     76,
  'Low_Wood_Block':      77,
  'Mute_Cuica':          78,
  'Open_Cuica':          79,
  'Mute_Triangle':       80,
  'Open_Triangle':       81,
};

export function drumNameToMidi(name: string): number | null {
  return DRUM_NAME_TO_MIDI[name] ?? null;
}

/**
 * 把 pitch class 落到指定 prev MIDI 最近的 octave 内 [lo, hi]。
 * 跟 AF2 voice-leading.placeNearAnchor 等价(独立实现,improCore 不 deps AF2)。
 */
export function placeNearMidi(pc: number, prevMidi: number, lo: number, hi: number): number {
  const idealShift = Math.round((prevMidi - pc) / 12);
  let best = pc + idealShift * 12;
  while (best < lo) best += 12;
  while (best > hi) best -= 12;
  if (best < lo) best = lo;
  if (best > hi) best = hi;
  return best;
}

/**
 * 同 placeNearMidi 但加 **低区偏好** — bass 专用(避免飘到高区)。
 * 算法:
 *   1. 枚举 [lo, hi] 内所有 pc 同 octave 候选
 *   2. 给每个候选打 cost = |distance from prevMidi| + (octave 越高,额外 octavePenalty)
 *   3. 选 cost 最小
 *
 * octavePenalty 让 prevMidi 上方候选 vs 下方候选 同距离时偏好下方。
 *
 * 例:pc=0 (C), prevMidi=55, lo=43, hi=60
 *   候选:48 (C3) 距 7,60 (C4) 距 5
 *   placeNearMidi:选 60 (近)
 *   placeBassMidi:cost(48)=7+0=7,cost(60)=5+3=8 → 选 48 (C3,低区)
 */
export function placeBassMidi(
  pc: number,
  prevMidi: number,
  lo: number,
  hi: number,
  octavePenalty: number = 3,
): number {
  const pcMod = ((pc % 12) + 12) % 12;
  const candidates: number[] = [];
  for (let m = pcMod; m < 128; m += 12) {
    if (m >= lo && m <= hi) candidates.push(m);
  }
  if (candidates.length === 0) {
    // 区间无 pc 可放 — fallback clamp 到边界
    return Math.max(lo, Math.min(hi, pcMod + Math.round((prevMidi - pcMod) / 12) * 12));
  }
  let best = candidates[0]!;
  let bestCost = Infinity;
  for (const m of candidates) {
    const dist = Math.abs(m - prevMidi);
    const penalty = m > prevMidi ? octavePenalty : 0;
    const cost = dist + penalty;
    if (cost < bestCost) {
      bestCost = cost;
      best = m;
    }
  }
  return best;
}
