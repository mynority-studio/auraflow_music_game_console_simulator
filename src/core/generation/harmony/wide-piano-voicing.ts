// ============================================================
// wide-piano-voicing.ts — 钢琴宽阔排列 + inner motion 副旋律
// ============================================================
//
// 来源:melodygenerative/src/lib/widePianoVoicing.ts(2026-05-25 移植)
//
// 核心设计("两边开阔中间密集"):
//   - 6 条 voice lane:bass / low_outer / inner_low/mid/high / upper_outer
//   - 外声部(low_outer + upper_outer)放结构音(root/3/5)
//   - 内声部(inner cluster)放色彩音(7/9/11/13)— 紧凑 1 octave 区间
//   - 整 voicing span ≤ 29 半音(18 度 — 真实钢琴手舒适上限)
//
// 4 个 spread mode:
//   close       — 4 voices ≤12 semis,cadence 用
//   half_wide   — 5 voices ~16-20 semis,默认中庸
//   wide        — 5-7 voices ~24-27 semis,chorus/lift 用
//   drop2_wide  — wide + drop-2(2nd-from-top 下移八度,Bill Evans 风)
//
// Inner motion:跨 chord 在 inner lane 弱拍"暗中漂"(Bill Evans 副旋律风)
//
// 独立 module:不 import 任何 ImproCore / AF2 接口,自带 pc helper + scale 表。
// caller 通过 plain data 接口调用,自己做 adapter。
// ============================================================

// ─────────────────────────────────────────────────────────────────────
// Types(plain data,不依赖任何 IR)
// ─────────────────────────────────────────────────────────────────────

export type PianoVoiceLane =
  | 'bass'
  | 'low_outer'
  | 'inner_low'
  | 'inner_mid'
  | 'inner_high'
  | 'upper_outer';

export type VoiceRole =
  | 'root' | 'third' | 'fifth' | 'seventh'
  | 'ninth' | 'eleventh' | 'thirteenth'
  | 'sixth' | 'color' | 'doubling';

export interface PianoVoicingNote {
  midi: number;
  pc: number;
  role: VoiceRole;
  lane: PianoVoiceLane;
  hand: 'LH' | 'RH';
  velocity: number;       // 0-127 (MIDI standard)
}

export interface InnerMotionEvent {
  midi: number;
  time: number;           // 相对 chord 起拍的 beat offset
  duration: number;
  velocity: number;       // 0-127
  lane: PianoVoiceLane;
}

export interface WidePianoVoicing {
  notes: PianoVoicingNote[];
  innerLanes: PianoVoicingNote[];
  attackMidi: number[];   // 强拍同时发声的 MIDI 列表(sorted asc)
  innerMotion?: InnerMotionEvent[];
  spreadMode?: SpreadMode;
}

export type SpreadMode = 'close' | 'half_wide' | 'wide' | 'drop2_wide';

export interface WidePianoOptions {
  includeRootInComp: boolean;
  colorLevel: 0 | 1 | 2;
  style: string;
  spreadMode: SpreadMode;
}

/** Caller 传入的 chord 数据(plain object,跟任何 ChordDef IR 解耦) */
export interface WideVoicingChordInput {
  rootPc: number;         // 0-11 ABSOLUTE
  chordType: string;      // 'maj' / 'min' / 'maj7' / 'm7' / 'dom7' / etc.
  bassMidi: number;
  duration: number;       // beats
  roman: string;          // 'I' / 'V' / 'ii' / etc.(给 spread mode dispatch 用)
  effectiveFunc?: 'T' | 'S' | 'D';
  forcedScale?: string;   // 优先 inner motion 用的 scale 名(可选)
}

/** Caller 传入的 PRNG 接口(deterministic) */
export interface PickerRandom {
  next(): number;
  pick<T>(arr: T[]): T;
}

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

const pc = (n: number): number => ((n % 12) + 12) % 12;

/** Register zones(两边开阔,中间密集) */
const PIANO_ZONES = {
  bass:       [36, 52] as const,  // C2-E3
  lowOuter:   [50, 61] as const,  // D3-C#4
  innerLow:   [62, 66] as const,  // D4-F#4
  innerMid:   [65, 70] as const,  // F4-A#4
  innerHigh:  [68, 72] as const,  // G#4-C5
  upperOuter: [73, 79] as const,  // C#5-G5
};

const VOICING_MAX_TOTAL_SPAN = 29;  // 18 度

/** Inner motion 必须在右手低声部 [C4, D5] 内 — 防止下沉到 LH 区跟 bass 重叠 */
const MOTION_RH_LOW = 60;
const MOTION_RH_HIGH = 74;

/** 内置 scale intervals(inner motion 经过音用,从 chord scale 取允许 pcs)*/
const INTERNAL_SCALE_INTERVALS: Record<string, number[]> = {
  'Ionian':       [0, 2, 4, 5, 7, 9, 11],
  'major':        [0, 2, 4, 5, 7, 9, 11],
  'Dorian':       [0, 2, 3, 5, 7, 9, 10],
  'dorian':       [0, 2, 3, 5, 7, 9, 10],
  'Phrygian':     [0, 1, 3, 5, 7, 8, 10],
  'phrygian':     [0, 1, 3, 5, 7, 8, 10],
  'Lydian':       [0, 2, 4, 6, 7, 9, 11],
  'lydian':       [0, 2, 4, 6, 7, 9, 11],
  'Mixolydian':   [0, 2, 4, 5, 7, 9, 10],
  'mixolydian':   [0, 2, 4, 5, 7, 9, 10],
  'Aeolian':      [0, 2, 3, 5, 7, 8, 10],
  'aeolian':      [0, 2, 3, 5, 7, 8, 10],
  'Locrian':      [0, 1, 3, 5, 6, 8, 10],
  'locrian':      [0, 1, 3, 5, 6, 8, 10],
};

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function rolePc(rootPc: number, semis: number): number {
  return pc(rootPc + semis);
}

/** 在 [low, high] MIDI 区间找最接近 prefer 且 pc 匹配的 midi */
function nearestMidiForPc(targetPc: number, low: number, high: number, prefer: number): number {
  let best = -1;
  let bestCost = Infinity;
  for (let m = low; m <= high; m++) {
    if (pc(m) !== targetPc) continue;
    const cost = Math.abs(m - prefer);
    if (cost < bestCost) { best = m; bestCost = cost; }
  }
  if (best < 0) {
    // 区间内没匹配 — 找最近一个八度外的
    for (let m = low - 12; m <= high + 12; m++) {
      if (pc(m) !== targetPc) continue;
      const cost = Math.abs(m - prefer);
      if (cost < bestCost) { best = m; bestCost = cost; }
    }
  }
  return best;
}

/** 根据 chord type 返回各角色的 pc(覆盖所有"可用"角色,不止 close 7) */
function getChordRolePcs(rootPc: number, type: string): Partial<Record<VoiceRole, number>> {
  const result: Partial<Record<VoiceRole, number>> = { root: rolePc(rootPc, 0) };
  const isMaj = type.startsWith('maj') || type === 'add9' || type === '6' || type === '6/9' || type === 'maj';
  const isMin = !isMaj && ((type.startsWith('m') && !type.startsWith('maj')) || type === 'min');
  const isSus = type.includes('sus');
  const isDim = type.includes('dim') || type === 'm7b5' || type === 'm9b5';

  // 3rd
  if (isSus) result.eleventh = rolePc(rootPc, 5);
  else if (isMin || isDim) result.third = rolePc(rootPc, 3);
  else result.third = rolePc(rootPc, 4);

  // 5th
  if (isDim) result.fifth = rolePc(rootPc, 6);
  else if (type === 'aug' || type === '7#5') result.fifth = rolePc(rootPc, 8);
  else result.fifth = rolePc(rootPc, 7);

  // 7th
  if (type.startsWith('maj') || type === 'maj7' || type === 'maj9' || type === 'maj13' || type === 'maj7#11') {
    result.seventh = rolePc(rootPc, 11);
  } else if (type.includes('7') || type.includes('9') || type.includes('11') || type.includes('13')) {
    result.seventh = rolePc(rootPc, 10);
  }

  // 9 / 11 / 13 / 6
  if (type.includes('9') || type === 'add9' || type === '6/9') result.ninth = rolePc(rootPc, 2);
  if (type.includes('11')) result.eleventh = rolePc(rootPc, 5);
  if (type === '6' || type === '6/9') result.sixth = rolePc(rootPc, 9);
  if (type.includes('13')) result.thirteenth = rolePc(rootPc, 9);

  // Altered tensions on dom
  if (type.includes('b9')) result.color = rolePc(rootPc, 1);
  if (type.includes('#9')) result.color = rolePc(rootPc, 3);
  if (type.includes('b13')) result.color = rolePc(rootPc, 8);
  if (type.includes('#11')) result.color = rolePc(rootPc, 6);

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Main builder
// ─────────────────────────────────────────────────────────────────────

export function buildWidePianoVoicing(args: {
  rootPc: number;
  chordType: string;
  bassMidi: number;
  options: WidePianoOptions;
}): WidePianoVoicing {
  const { rootPc, chordType, options } = args;
  const pcs = getChordRolePcs(rootPc, chordType);
  const notes: PianoVoicingNote[] = [];

  const add = (role: VoiceRole, lane: PianoVoiceLane, hand: 'LH' | 'RH', midi: number, velocity: number): void => {
    if (midi < 0 || !Number.isFinite(midi)) return;
    notes.push({ midi, pc: pc(midi), role, lane, hand, velocity });
  };

  const [LO_LO, LO_HI] = PIANO_ZONES.lowOuter;
  const [IL_LO, IL_HI] = PIANO_ZONES.innerLow;
  const [IM_LO, IM_HI] = PIANO_ZONES.innerMid;
  const [IH_LO, IH_HI] = PIANO_ZONES.innerHigh;
  const [UO_LO, UO_HI] = PIANO_ZONES.upperOuter;

  const mode = options.spreadMode;

  // ① low_outer — 结构音(root + 3),close 模式不加
  if (mode !== 'close') {
    if (options.includeRootInComp && pcs.root !== undefined) {
      add('root', 'low_outer', 'LH', nearestMidiForPc(pcs.root, LO_LO, LO_LO + 7, LO_LO + 3), 58);
    }
    if (pcs.third !== undefined) {
      add('third', 'low_outer', 'LH', nearestMidiForPc(pcs.third, LO_LO + 2, LO_HI, LO_LO + 6), 54);
    }
  }

  // ② inner cluster — 色彩(5 / 7 / root doubling / 9 / color)
  if (pcs.fifth !== undefined) {
    add('fifth', 'inner_low', 'RH', nearestMidiForPc(pcs.fifth, IL_LO, IL_HI, IL_LO + 2), 48);
  }
  if (pcs.seventh !== undefined) {
    add('seventh', 'inner_mid', 'RH', nearestMidiForPc(pcs.seventh, IM_LO, IM_HI, IM_LO + 2), 46);
  }
  if (mode !== 'close' && options.colorLevel >= 1 && pcs.root !== undefined) {
    add('doubling', 'inner_mid', 'RH', nearestMidiForPc(pcs.root, IM_LO + 1, IM_HI, IM_LO + 3), 42);
  }
  if (options.colorLevel >= 1 && pcs.ninth !== undefined) {
    add('ninth', 'inner_high', 'RH', nearestMidiForPc(pcs.ninth, IH_LO, IH_HI, IH_LO + 2), 40);
  } else if (pcs.third !== undefined) {
    add('third', 'inner_high', 'RH', nearestMidiForPc(pcs.third, IH_LO, IH_HI, IH_LO + 2), 40);
  }
  if (mode !== 'close' && options.colorLevel >= 2) {
    const ext = pcs.thirteenth ?? pcs.sixth ?? pcs.eleventh ?? pcs.color;
    if (ext !== undefined) {
      add('thirteenth', 'inner_high', 'RH', nearestMidiForPc(ext, IH_LO + 1, IH_HI, IH_LO + 3), 38);
    }
  }

  // ③ upper_outer — wide / drop2_wide 加 air voice
  if (mode === 'wide' || mode === 'drop2_wide') {
    if (pcs.fifth !== undefined) {
      add('fifth', 'upper_outer', 'RH', nearestMidiForPc(pcs.fifth, UO_LO, UO_HI, UO_LO + 2), 38);
    }
    if (options.colorLevel >= 2 && pcs.root !== undefined) {
      add('root', 'upper_outer', 'RH', nearestMidiForPc(pcs.root, UO_LO + 3, UO_HI, UO_LO + 6), 34);
    }
  }

  // Sort + dedup
  const seen = new Set<number>();
  const dedup: PianoVoicingNote[] = [];
  for (const n of notes.sort((a, b) => a.midi - b.midi)) {
    if (seen.has(n.midi)) continue;
    seen.add(n.midi);
    dedup.push(n);
  }

  // 校正 1:drop2_wide → Drop-2 变换
  let processed = dedup;
  if (mode === 'drop2_wide' && processed.length >= 4) {
    const sortedAsc = processed.slice().sort((a, b) => a.midi - b.midi);
    const idx2FromTop = sortedAsc.length - 2;
    const droppedMidi = sortedAsc[idx2FromTop]!.midi - 12;
    if (droppedMidi > args.bassMidi + 4 && droppedMidi >= 33) {
      sortedAsc[idx2FromTop] = { ...sortedAsc[idx2FromTop]!, midi: droppedMidi, pc: pc(droppedMidi) };
      processed = sortedAsc.sort((a, b) => a.midi - b.midi);
    }
  }

  // 校正 2:muddy-check
  const sanitized = sanitizeMuddyVoices(processed, args.bassMidi);

  // 校正 3:span ≤ 29
  const compressed = compressVoicingSpan(sanitized, VOICING_MAX_TOTAL_SPAN);

  return {
    notes: compressed,
    attackMidi: compressed.map(n => n.midi),
    innerLanes: compressed.filter(n =>
      n.lane === 'inner_low' || n.lane === 'inner_mid' || n.lane === 'inner_high',
    ),
  };
}

function compressVoicingSpan(notes: PianoVoicingNote[], maxSpan: number): PianoVoicingNote[] {
  const out = notes.map(n => ({ ...n })).sort((a, b) => a.midi - b.midi);
  let guard = 0;
  while (out.length >= 2 && (out[out.length - 1]!.midi - out[0]!.midi) > maxSpan && guard < 8) {
    guard++;
    const lo = out[0]!;
    const hi = out[out.length - 1]!;
    const span = hi.midi - lo.midi;
    const hiDownMidi = hi.midi - 12;
    const loUpMidi = lo.midi + 12;
    const candHiDown = out.slice(0, -1).concat({ ...hi, midi: hiDownMidi, pc: pc(hiDownMidi) });
    const candLoUp = out.slice(1).concat({ ...lo, midi: loUpMidi, pc: pc(loUpMidi) });
    candHiDown.sort((a, b) => a.midi - b.midi);
    candLoUp.sort((a, b) => a.midi - b.midi);
    const newSpanHiDown = candHiDown[candHiDown.length - 1]!.midi - candHiDown[0]!.midi;
    const newSpanLoUp = candLoUp[candLoUp.length - 1]!.midi - candLoUp[0]!.midi;
    if (newSpanHiDown < newSpanLoUp && newSpanHiDown < span) {
      out.splice(0, out.length, ...candHiDown);
    } else if (newSpanLoUp < span) {
      out.splice(0, out.length, ...candLoUp);
    } else {
      break;
    }
  }
  return out;
}

function sanitizeMuddyVoices(notes: PianoVoicingNote[], bassMidi: number): PianoVoicingNote[] {
  const out = notes.map(n => ({ ...n }));
  const E4 = 64;
  const bassPc = pc(bassMidi);
  const b9Pc = (bassPc + 1) % 12;

  // m9 cluster
  for (const n of out) {
    const interval = n.midi - bassMidi;
    if (interval === 13 && n.pc === b9Pc) {
      n.midi += 12;
      n.pc = pc(n.midi);
    }
  }

  // 相邻 m2 在低区
  out.sort((a, b) => a.midi - b.midi);
  for (let i = 1; i < out.length; i++) {
    const gap = out[i]!.midi - out[i - 1]!.midi;
    if (gap === 1 && out[i - 1]!.midi < E4) {
      out[i]!.midi += 12;
      out[i]!.pc = pc(out[i]!.midi);
    }
  }
  out.sort((a, b) => a.midi - b.midi);
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Inner motion
// ─────────────────────────────────────────────────────────────────────

function matchInnerLanes(curr: WidePianoVoicing, next: WidePianoVoicing): Array<{ from: PianoVoicingNote; to: PianoVoicingNote }> {
  const inRH = (n: PianoVoicingNote): boolean => n.midi >= 60 && n.midi <= 74;
  const currInnerRH = curr.innerLanes.filter(inRH);
  const nextInnerRH = next.innerLanes.filter(inRH);
  const pairs: Array<{ from: PianoVoicingNote; to: PianoVoicingNote }> = [];
  const used = new Set<number>();
  for (const from of currInnerRH) {
    let bestIdx = -1;
    let bestCost = Infinity;
    nextInnerRH.forEach((to, idx) => {
      if (used.has(idx)) return;
      const laneCost = from.lane === to.lane ? 0 : 3;
      const pitchCost = Math.abs(from.midi - to.midi);
      const roleCost = from.role === to.role ? 0 : 1;
      const cost = pitchCost + laneCost + roleCost;
      if (cost < bestCost) { bestCost = cost; bestIdx = idx; }
    });
    if (bestIdx >= 0) {
      used.add(bestIdx);
      pairs.push({ from, to: nextInnerRH[bestIdx]! });
    }
  }
  return pairs;
}

function stepToward(from: number, to: number, allowedPcs: Set<number>): number {
  if (from === to) return from;
  const dir = to > from ? 1 : -1;
  for (let step = 1; step <= 2; step++) {
    const cand = from + dir * step;
    if (allowedPcs.has(pc(cand))) return cand;
  }
  return from + dir * Math.min(2, Math.abs(to - from));
}

export function buildInnerMotion(args: {
  curr: WidePianoVoicing;
  next: WidePianoVoicing;
  chordScalePcs: Set<number>;
  durationBeats: number;
  density: number;
}): InnerMotionEvent[] {
  if (args.curr.notes.length === 0) return [];
  const clampToRH = (m: number): number => {
    let x = m;
    while (x < MOTION_RH_LOW) x += 12;
    while (x > MOTION_RH_HIGH) x -= 12;
    if (x < MOTION_RH_LOW || x > MOTION_RH_HIGH) return -1;
    return x;
  };
  const pairs = matchInnerLanes(args.curr, args.next);
  const events: InnerMotionEvent[] = [];
  const maxMovingVoices = args.density > 0.6 ? 2 : 1;
  const movingPairs = pairs
    .filter(p => Math.abs(p.from.midi - p.to.midi) > 0)
    .sort((a, b) => Math.abs(a.from.midi - a.to.midi) - Math.abs(b.from.midi - b.to.midi))
    .slice(0, maxMovingVoices);

  for (const { from, to } of movingPairs) {
    const targetClamped = clampToRH(to.midi);
    if (targetClamped < 0) continue;
    const dist = Math.abs(targetClamped - from.midi);
    if (dist === 0) continue;
    if (dist <= 2) {
      const t = args.durationBeats >= 4 ? 3.5 : args.durationBeats * 0.75;
      events.push({ midi: targetClamped, time: t, duration: 0.35, velocity: 26, lane: from.lane });
    } else {
      const passRaw = stepToward(from.midi, targetClamped, args.chordScalePcs);
      const passClamped = clampToRH(passRaw);
      if (args.durationBeats >= 4) {
        if (passClamped >= 0) {
          events.push({ midi: passClamped, time: 2.5, duration: 0.35, velocity: 24, lane: from.lane });
        }
        events.push({ midi: targetClamped, time: 3.5, duration: 0.35, velocity: 26, lane: from.lane });
      } else {
        events.push({
          midi: targetClamped, time: args.durationBeats * 0.65,
          duration: 0.28, velocity: 24, lane: from.lane,
        });
      }
    }
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────
// Spread mode dispatcher + attach to chord chain
// ─────────────────────────────────────────────────────────────────────

export function pickSpreadMode(args: {
  func: 'T' | 'S' | 'D';
  cellRole: 'establish' | 'develop' | 'lift' | 'cadence';
  sectionFunction: 'INTRO' | 'VERSE' | 'CHORUS' | 'BRIDGE' | 'OUTRO';
  isPhraseEnd: boolean;
  isLast: boolean;
  random: PickerRandom;
}): SpreadMode {
  if (args.isLast || args.isPhraseEnd) return 'close';
  if (args.sectionFunction === 'INTRO' || args.sectionFunction === 'OUTRO') {
    return args.random.next() < 0.7 ? 'close' : 'half_wide';
  }
  const scores: Record<SpreadMode, number> = { close: 0, half_wide: 2, wide: 0, drop2_wide: 0 };
  if (args.cellRole === 'establish') scores.half_wide += 1;
  if (args.cellRole === 'develop')   { scores.half_wide += 1; scores.wide += 1; }
  if (args.cellRole === 'lift')      { scores.wide += 3; scores.drop2_wide += 1; }
  if (args.cellRole === 'cadence')   { scores.half_wide += 1; scores.close += 2; }
  if (args.func === 'T') scores.half_wide += 1;
  if (args.func === 'S') { scores.half_wide += 1; scores.wide += 1; }
  if (args.func === 'D') { scores.wide += 2; scores.drop2_wide += 2; }
  if (args.sectionFunction === 'CHORUS') scores.wide += 2;
  if (args.sectionFunction === 'BRIDGE') { scores.drop2_wide += 3; scores.wide += 1; }
  if (args.sectionFunction === 'VERSE')  scores.half_wide += 1;

  const max = Math.max(...Object.values(scores));
  const top = (Object.entries(scores) as [SpreadMode, number][]).filter(([, v]) => v === max).map(([k]) => k);
  return top.length === 1 ? top[0]! : args.random.pick(top);
}

/**
 * 批量挂 widePianoVoicing 到 chord chain。
 * @returns 跟 chords 等长的 WidePianoVoicing 数组(含 innerMotion + spreadMode)
 */
export function attachWidePianoVoicings(args: {
  chords: WideVoicingChordInput[];
  style: string;
  density: number;
  keyRootPc: number;
  mode: string;
  sectionFunction: 'INTRO' | 'VERSE' | 'CHORUS' | 'BRIDGE' | 'OUTRO';
  motifInterval: number;
  random: PickerRandom;
}): WidePianoVoicing[] {
  const { chords, style, density } = args;

  // 第一遍:per chord 决定 spread + 生成 voicing
  const spreadModes: SpreadMode[] = [];
  const wides: WidePianoVoicing[] = chords.map((chord, i) => {
    const baseRoman = chord.roman.split('/')[0]!.replace(/[^a-zA-Z]/g, '');
    const func: 'T' | 'S' | 'D' = chord.effectiveFunc
      ?? (['V', 'v', 'vii', 'VII'].includes(baseRoman) || chord.roman.includes('/') ? 'D'
       :  ['IV', 'iv', 'ii', 'II', 'bVII'].includes(baseRoman) ? 'S' : 'T');
    const isLast = i === chords.length - 1;
    const isPhraseEnd = args.motifInterval > 0 && (i + 1) % args.motifInterval === 0;
    const cellRole: 'establish' | 'develop' | 'lift' | 'cadence' =
      i < chords.length / 4 ? 'establish' :
      i < chords.length / 2 ? 'develop' :
      i < (chords.length * 3) / 4 ? 'lift' : 'cadence';
    const spreadMode = pickSpreadMode({
      func, cellRole,
      sectionFunction: args.sectionFunction,
      isPhraseEnd, isLast,
      random: args.random,
    });
    spreadModes.push(spreadMode);
    const colorLevel: 0 | 1 | 2 = density > 0.65 ? 2 : density > 0.35 ? 1 : 0;
    return buildWidePianoVoicing({
      rootPc: chord.rootPc,
      chordType: chord.chordType,
      bassMidi: chord.bassMidi,
      options: {
        includeRootInComp: style !== 'JAZZ',
        colorLevel,
        style,
        spreadMode,
      },
    });
  });

  // 第二遍:per chord 算 inner motion(peek 下一 chord)
  const out: WidePianoVoicing[] = [];
  for (let i = 0; i < chords.length; i++) {
    const curr = wides[i]!;
    const next = wides[(i + 1) % wides.length]!;
    const chord = chords[i]!;
    const scaleName = chord.forcedScale ?? args.mode;
    const scaleIntervals = INTERNAL_SCALE_INTERVALS[scaleName] ?? INTERNAL_SCALE_INTERVALS['Ionian']!;
    const scalePcs = new Set(scaleIntervals.map(iv => pc(chord.rootPc + iv)));
    const innerMotion = spreadModes[i] === 'close' ? [] : buildInnerMotion({
      curr, next, chordScalePcs: scalePcs,
      durationBeats: chord.duration, density,
    });
    out.push({ ...curr, innerMotion, spreadMode: spreadModes[i] });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Render to NoteEvent(plain output,caller adapt to ImproCore / AF2)
// ─────────────────────────────────────────────────────────────────────

export interface WidePianoNoteEvent {
  pitch: number;
  onset: number;
  duration: number;
  velocity: number;     // 0-127(caller / 127 转 0-1 若需)
  part: 'chord';
}

export interface WidePianoMelodyContext {
  pitch: number;
  onset: number;
}

/**
 * 渲染 widePianoVoicing 成 NoteEvent[]。
 * - 主和弦微 roll(18ms/voice)
 * - innerMotion 弱拍漂(若 density > 0.25 + melody 不 busy)
 */
export function renderWidePianoVoicing(args: {
  wide: WidePianoVoicing;
  bassMidi: number;
  startBeat: number;
  duration: number;
  density: number;
  melodyEvents: WidePianoMelodyContext[];
}): WidePianoNoteEvent[] {
  const out: WidePianoNoteEvent[] = [];
  const { wide, startBeat, duration, density } = args;

  // ① 主和弦微 roll
  wide.attackMidi.forEach((m, idx) => {
    const rollOffset = idx * 0.018;
    const vel = idx < 2 ? 0.48 : 0.34;
    out.push({
      pitch: m,
      onset: startBeat + rollOffset,
      duration: Math.min(duration, 2.2),
      velocity: vel * 127,
      part: 'chord',
    });
  });

  // ② Inner motion 弱拍漂
  if (wide.innerMotion && density > 0.25) {
    for (const ev of wide.innerMotion) {
      if (ev.time >= duration) continue;
      const absTime = startBeat + ev.time;
      const melodyBusy = args.melodyEvents.some(me => Math.abs(me.onset - absTime) < 0.08);
      if (melodyBusy && density < 0.65) continue;
      out.push({
        pitch: ev.midi,
        onset: absTime,
        duration: ev.duration,
        velocity: melodyBusy ? 18 : ev.velocity,
        part: 'chord',
      });
    }
  }
  return out;
}
