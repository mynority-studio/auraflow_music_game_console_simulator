// ============================================================
// newEngine · knowledge · WidePianoVoicings(宽阔钢琴排列法,B-port 乐理事实)
// ------------------------------------------------------------
// Provenance:port 自 melodygenerative/src/lib/widePianoVoicing.ts(纯规则部分:
//   PIANO_ZONES / VoiceLane / SpreadMode / getChordRolePcs / buildWidePianoVoicing
//   + sanitize/compress 后置校正)。render 层的事件发射(renderWidePianoVoicing)不在此。
// ★ 分层模型 = 用户 voicing 铁律的实现:外声部=结构音(root/3/5)· 内声部紧凑 cluster=色彩(7/9/11/13)·
//   上层 RH 顶=air voice;9≠2(色彩以 compound 高位入 inner/upper,不折回中低区);m2 防摩擦后置校正。
// 仅当 comp 乐器是钢琴时调用(否则走通用 voiceComp)—— 见 feedback。
// ============================================================

import { mod12 } from '../foundation';

export type PianoVoiceLane = 'bass' | 'low_outer' | 'inner_low' | 'inner_mid' | 'inner_high' | 'upper_outer';
export type VoiceRole = 'root' | 'third' | 'fifth' | 'seventh' | 'ninth' | 'eleventh' | 'thirteenth' | 'sixth' | 'color' | 'doubling';
export type SpreadMode = 'close' | 'half_wide' | 'wide' | 'drop2_wide';

export interface PianoVoicingNote {
  midi: number;
  pc: number;
  role: VoiceRole;
  lane: PianoVoiceLane;
  hand: 'LH' | 'RH';
  velocity: number;
}

export interface WidePianoVoicing {
  notes: PianoVoicingNote[];
  innerLanes: PianoVoicingNote[];
  attackMidi: number[];
  spreadMode?: SpreadMode;
}

export interface WidePianoOptions {
  includeRootInComp: boolean;
  colorLevel: 0 | 1 | 2;
  style: string;
  spreadMode: SpreadMode;
}

// 音区分层:两边开阔(放结构音 root/3/5),中间密集 cluster(放 7/9/11/13 色彩)。
const PIANO_ZONES = {
  bass: [36, 52] as const,
  lowOuter: [50, 61] as const,
  innerLow: [62, 66] as const,
  innerMid: [65, 70] as const,
  innerHigh: [68, 72] as const,
  upperOuter: [73, 79] as const,
};
const VOICING_MAX_TOTAL_SPAN = 29; // 18 度

const rolePc = (rootPc: number, semis: number): number => mod12(rootPc + semis);

/** [low,high] 内找最接近 prefer 且 pc 匹配的 midi;区间内无则到 ±八度外找。 */
function nearestMidiForPc(targetPc: number, low: number, high: number, prefer: number): number {
  let best = -1;
  let bestCost = Infinity;
  for (let m = low; m <= high; m++) {
    if (mod12(m) !== targetPc) continue;
    const cost = Math.abs(m - prefer);
    if (cost < bestCost) { best = m; bestCost = cost; }
  }
  if (best < 0) {
    for (let m = low - 12; m <= high + 12; m++) {
      if (mod12(m) !== targetPc) continue;
      const cost = Math.abs(m - prefer);
      if (cost < bestCost) { best = m; bestCost = cost; }
    }
  }
  return best;
}

/** chord type → 各角色 pc(不止 close 7 个,所有可用角色)。port 逐条忠实。 */
function getChordRolePcs(rootPc: number, type: string): Partial<Record<VoiceRole, number>> {
  const result: Partial<Record<VoiceRole, number>> = { root: rolePc(rootPc, 0) };
  const isMaj = type.startsWith('maj') || type === 'add9' || type === '6' || type === '6/9' || type === 'maj';
  const isMin = (!isMaj && (type.startsWith('m') && !type.startsWith('maj'))) || type === 'min';
  const isSus = type.includes('sus');
  const isDim = type.includes('dim') || type === 'm7b5' || type === 'm9b5';

  if (isSus) result.eleventh = rolePc(rootPc, 5);
  else if (isMin || isDim) result.third = rolePc(rootPc, 3);
  else result.third = rolePc(rootPc, 4);

  if (isDim) result.fifth = rolePc(rootPc, 6);
  else if (type === 'aug' || type === '7#5') result.fifth = rolePc(rootPc, 8);
  else result.fifth = rolePc(rootPc, 7);

  if (type.startsWith('maj') || type === 'maj7' || type === 'maj9' || type === 'maj13' || type === 'maj7#11') {
    result.seventh = rolePc(rootPc, 11);
  } else if (type.includes('7') || type.includes('9') || type.includes('11') || type.includes('13')) {
    result.seventh = rolePc(rootPc, 10);
  }

  if (type.includes('9') || type === 'add9' || type === '6/9') result.ninth = rolePc(rootPc, 2);
  if (type.includes('11')) result.eleventh = rolePc(rootPc, 5);
  if (type === '6' || type === '6/9') result.sixth = rolePc(rootPc, 9);
  if (type.includes('13')) result.thirteenth = rolePc(rootPc, 9);

  if (type.includes('b9')) result.color = rolePc(rootPc, 1);
  if (type.includes('#9')) result.color = rolePc(rootPc, 3);
  if (type.includes('b13')) result.color = rolePc(rootPc, 8);
  if (type.includes('#11')) result.color = rolePc(rootPc, 6);
  return result;
}

/** 后置校正:m9 cluster(bass 上方 13 半音的 b9)+ 低区相邻 m2 → 上移八度防摩擦。 */
function sanitizeMuddyVoices(notes: PianoVoicingNote[], bassMidi: number): PianoVoicingNote[] {
  const out = notes.map((n) => ({ ...n }));
  const E4 = 64;
  const b9Pc = mod12(mod12(bassMidi) + 1);
  for (const n of out) {
    if (n.midi - bassMidi === 13 && n.pc === b9Pc) { n.midi += 12; n.pc = mod12(n.midi); }
  }
  out.sort((a, b) => a.midi - b.midi);
  for (let i = 1; i < out.length; i++) {
    if (out[i].midi - out[i - 1].midi === 1 && out[i - 1].midi < E4) { out[i].midi += 12; out[i].pc = mod12(out[i].midi); }
  }
  out.sort((a, b) => a.midi - b.midi);
  return out;
}

/** 总 span ≤ maxSpan:把外侧 voice 向中间压(高下移/低上移八度,选压完更窄的)。 */
function compressVoicingSpan(notes: PianoVoicingNote[], maxSpan: number): PianoVoicingNote[] {
  const out = notes.map((n) => ({ ...n })).sort((a, b) => a.midi - b.midi);
  let guard = 0;
  while (out.length >= 2 && out[out.length - 1].midi - out[0].midi > maxSpan && guard < 8) {
    guard++;
    const lo = out[0];
    const hi = out[out.length - 1];
    const span = hi.midi - lo.midi;
    const hiDownMidi = hi.midi - 12;
    const loUpMidi = lo.midi + 12;
    const candHiDown = out.slice(0, -1).concat({ ...hi, midi: hiDownMidi, pc: mod12(hiDownMidi) }).sort((a, b) => a.midi - b.midi);
    const candLoUp = out.slice(1).concat({ ...lo, midi: loUpMidi, pc: mod12(loUpMidi) }).sort((a, b) => a.midi - b.midi);
    const newSpanHiDown = candHiDown[candHiDown.length - 1].midi - candHiDown[0].midi;
    const newSpanLoUp = candLoUp[candLoUp.length - 1].midi - candLoUp[0].midi;
    if (newSpanHiDown < newSpanLoUp && newSpanHiDown < span) out.splice(0, out.length, ...candHiDown);
    else if (newSpanLoUp < span) out.splice(0, out.length, ...candLoUp);
    else break;
  }
  return out;
}

/**
 * 钢琴宽阔排列(~5-7 voices,不含 bass)。外声部=结构音 · 内声部紧凑 cluster=色彩 · 上层=air voice。
 * prev 给定 → 各 lane prefer 贴上一组同 lane voice(共同音保留 + 最小动量声部进行)。
 */
export function buildWidePianoVoicing(args: {
  rootPc: number;
  chordType: string;
  bassMidi: number;
  options: WidePianoOptions;
  prev?: WidePianoVoicing;
  /** 整合接缝:给定则用它取代 getChordRolePcs(rootPc,chordType)。
   *  让消费方按【自己引擎已算好的真实和弦音】驱动 zone 排列,而非靠 type 字符串再推导
   *  —— 避免 getChordRolePcs 对窄三和弦(我们的 'maj'/'min')幻觉出七音。默认行为不变。 */
  rolePcs?: Partial<Record<VoiceRole, number>>;
}): WidePianoVoicing {
  const { rootPc, chordType, options, prev } = args;
  const pcs = args.rolePcs ?? getChordRolePcs(rootPc, chordType);
  const notes: PianoVoicingNote[] = [];

  const prevAnchor = (lane: PianoVoiceLane, role: VoiceRole, zoneCenter: number): number => {
    if (!prev) return zoneCenter;
    const exact = prev.notes.filter((n) => n.lane === lane && n.role === role);
    if (exact.length > 0) { exact.sort((a, b) => Math.abs(a.midi - zoneCenter) - Math.abs(b.midi - zoneCenter)); return exact[0].midi; }
    const laneMatch = prev.notes.filter((n) => n.lane === lane);
    if (laneMatch.length > 0) { laneMatch.sort((a, b) => Math.abs(a.midi - zoneCenter) - Math.abs(b.midi - zoneCenter)); return laneMatch[0].midi; }
    return zoneCenter;
  };
  const add = (role: VoiceRole, lane: PianoVoiceLane, hand: 'LH' | 'RH', midi: number, velocity: number): void => {
    if (midi < 0 || !Number.isFinite(midi)) return;
    notes.push({ midi, pc: mod12(midi), role, lane, hand, velocity });
  };

  const [LO_LO, LO_HI] = PIANO_ZONES.lowOuter;
  const [IL_LO, IL_HI] = PIANO_ZONES.innerLow;
  const [IM_LO, IM_HI] = PIANO_ZONES.innerMid;
  const [IH_LO, IH_HI] = PIANO_ZONES.innerHigh;
  const [UO_LO, UO_HI] = PIANO_ZONES.upperOuter;
  const mode = options.spreadMode;

  // ① lowOuter(结构):root + 3rd
  if (mode !== 'close') {
    if (options.includeRootInComp && pcs.root !== undefined) add('root', 'low_outer', 'LH', nearestMidiForPc(pcs.root, LO_LO, LO_LO + 7, prevAnchor('low_outer', 'root', LO_LO + 3)), 58);
    if (pcs.third !== undefined) add('third', 'low_outer', 'LH', nearestMidiForPc(pcs.third, LO_LO + 2, LO_HI, prevAnchor('low_outer', 'third', LO_LO + 6)), 54);
  }
  // ② inner cluster(色彩):5/7/root-double/9/color
  if (pcs.fifth !== undefined) add('fifth', 'inner_low', 'RH', nearestMidiForPc(pcs.fifth, IL_LO, IL_HI, prevAnchor('inner_low', 'fifth', IL_LO + 2)), 48);
  if (pcs.seventh !== undefined) add('seventh', 'inner_mid', 'RH', nearestMidiForPc(pcs.seventh, IM_LO, IM_HI, prevAnchor('inner_mid', 'seventh', IM_LO + 2)), 46);
  if (mode !== 'close' && options.colorLevel >= 1 && pcs.root !== undefined) add('doubling', 'inner_mid', 'RH', nearestMidiForPc(pcs.root, IM_LO + 1, IM_HI, prevAnchor('inner_mid', 'doubling', IM_LO + 3)), 42);
  if (options.colorLevel >= 1 && pcs.ninth !== undefined) add('ninth', 'inner_high', 'RH', nearestMidiForPc(pcs.ninth, IH_LO, IH_HI, prevAnchor('inner_high', 'ninth', IH_LO + 2)), 40);
  else if (pcs.third !== undefined) add('third', 'inner_high', 'RH', nearestMidiForPc(pcs.third, IH_LO, IH_HI, prevAnchor('inner_high', 'third', IH_LO + 2)), 40);
  if (mode !== 'close' && options.colorLevel >= 2) {
    const ext = pcs.thirteenth ?? pcs.sixth ?? pcs.eleventh ?? pcs.color;
    if (ext !== undefined) add('thirteenth', 'inner_high', 'RH', nearestMidiForPc(ext, IH_LO + 1, IH_HI, prevAnchor('inner_high', 'thirteenth', IH_LO + 3)), 38);
  }
  // ③ upperOuter(air voice):5/root 高八度 —— wide / drop2_wide
  if (mode === 'wide' || mode === 'drop2_wide') {
    if (pcs.fifth !== undefined) add('fifth', 'upper_outer', 'RH', nearestMidiForPc(pcs.fifth, UO_LO, UO_HI, prevAnchor('upper_outer', 'fifth', UO_LO + 2)), 38);
    if (options.colorLevel >= 2 && pcs.root !== undefined) add('root', 'upper_outer', 'RH', nearestMidiForPc(pcs.root, UO_LO + 3, UO_HI, prevAnchor('upper_outer', 'root', UO_LO + 6)), 34);
  }

  // 排序去重
  const seen = new Set<number>();
  const dedup: PianoVoicingNote[] = [];
  for (const n of notes.sort((a, b) => a.midi - b.midi)) { if (seen.has(n.midi)) continue; seen.add(n.midi); dedup.push(n); }

  // 后置校正:drop2 → muddy → span 压缩
  let processed = dedup;
  if (mode === 'drop2_wide' && processed.length >= 4) {
    const asc = processed.slice().sort((a, b) => a.midi - b.midi);
    const i2 = asc.length - 2;
    const dropped = asc[i2].midi - 12;
    if (dropped > args.bassMidi + 4 && dropped >= 33) { asc[i2] = { ...asc[i2], midi: dropped, pc: mod12(dropped) }; processed = asc.sort((a, b) => a.midi - b.midi); }
  }
  const compressed = compressVoicingSpan(sanitizeMuddyVoices(processed, args.bassMidi), VOICING_MAX_TOTAL_SPAN);

  return {
    notes: compressed,
    attackMidi: compressed.map((n) => n.midi),
    innerLanes: compressed.filter((n) => n.lane === 'inner_low' || n.lane === 'inner_mid' || n.lane === 'inner_high'),
    spreadMode: mode,
  };
}

/** 钢琴 GM program 判定(Acoustic Grand / Bright / Electric Grand)。 */
export function isPianoProgram(program: number | undefined): boolean {
  return program === 0 || program === 1 || program === 2;
}
