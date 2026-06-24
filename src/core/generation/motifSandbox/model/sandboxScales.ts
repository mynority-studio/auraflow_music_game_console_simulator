// ============================================================
// motifSandbox · model · 音阶词汇(大调/小调/大五声/小五声/大调布鲁斯/小调布鲁斯)
// ------------------------------------------------------------
// 用户:Q+R 选音阶 → 3×5 键盘的音变成该音阶的对应音阶音(可随机下发)。
//   词汇 = 大调、小调、大五声、小五声、大调布鲁斯、小调布鲁斯。clean-room 镜像 AuraJam
//   ScaleEngine 的 padIndex / generateScaleNotes(不 import apps,保 core 独立)。
//   续写/配和声只懂 7 音大/小调 → 每个 tonality 推一个【母调】(parentMode)给下游;
//   输入吸附走【本 tonality】(布鲁斯蓝调音 b3/b5 等特征音保留)。
// ============================================================

import type { ScaleMode } from './types';

export type SandboxTonality = 'major' | 'minor' | 'majorPent' | 'minorPent' | 'majorBlues' | 'minorBlues' | 'majorBluesPent' | 'minorBluesPent';

export const SANDBOX_TONALITIES: SandboxTonality[] = ['major', 'minor', 'majorPent', 'minorPent', 'majorBlues', 'minorBlues', 'majorBluesPent', 'minorBluesPent'];

export const TONALITY_INTERVALS: Record<SandboxTonality, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],   // Ionian
  minor: [0, 2, 3, 5, 7, 8, 10],   // Aeolian
  majorPent: [0, 2, 4, 7, 9],      // 大调五声
  minorPent: [0, 3, 5, 7, 10],     // 小调五声
  majorBlues: [0, 2, 3, 4, 7, 9],  // 大调五声 + b3 蓝调音(1 2 b3 3 5 6)
  minorBlues: [0, 3, 5, 6, 7, 10], // 小调五声 + b5 蓝调音(1 b3 4 b5 5 b7)
  majorBluesPent: [0, 3, 4, 7, 9], // 大调布鲁斯五声(1 b3 3 5 6;b3→3 蓝调滑音)
  minorBluesPent: [0, 3, 5, 6, 10],// 小调布鲁斯五声(1 b3 4 b5 b7;含 b5 蓝调音)
};

export const TONALITY_LABEL: Record<SandboxTonality, string> = {
  major: '大调', minor: '小调', majorPent: '大五声', minorPent: '小五声',
  majorBlues: '大调布鲁斯', minorBlues: '小调布鲁斯', majorBluesPent: '大调布鲁斯五声', minorBluesPent: '小调布鲁斯五声',
};

/** 是否布鲁斯音阶(蓝调音相对母调为离调 → chromaticRatio 审计应放行 + 走 blues 合同/调味管线)。 */
export function isBluesTonality(t: SandboxTonality): boolean {
  return t === 'majorBlues' || t === 'minorBlues' || t === 'majorBluesPent' || t === 'minorBluesPent';
}

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const keyName = (keyPc: number): string => KEY_NAMES[((keyPc % 12) + 12) % 12];

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** 续写/配和声用的 7 音母调(大/小调框架)。 */
export function tonalityParentMode(t: SandboxTonality): ScaleMode {
  return t === 'major' || t === 'majorPent' || t === 'majorBlues' || t === 'majorBluesPent' ? 'major' : 'minor';
}

/** 把 midi 吸到该 tonality 最近音(保留特征音,如 blues b5)。 */
export function snapMidiToTonality(midiNote: number, keyPc: number, tonality: SandboxTonality): number {
  const ivs = TONALITY_INTERVALS[tonality];
  const rel = mod(midiNote - keyPc, 12);
  let best = ivs[0], bestD = 99;
  for (const iv of ivs) { const d = Math.min(mod(rel - iv, 12), mod(iv - rel, 12)); if (d < bestD) { bestD = d; best = iv; } }
  return midiNote - (rel - best);
}

/** 3×5 键盘音表:count 个音升序(C3 附近起,跨 tonality 循环)。15 键全填(阅读顺序排列)。 */
export function scaleNoteMap(keyPc: number, tonality: SandboxTonality, count = 15): number[] {
  const ivs = TONALITY_INTERVALS[tonality];
  const out: number[] = [];
  let octave = Math.floor((keyPc + 48) / 12);
  let idx = 0;
  for (let i = 0; i < count; i++) {
    out.push(ivs[idx] + octave * 12 + keyPc);
    if (++idx >= ivs.length) { idx = 0; octave++; }
  }
  return out;
}

/** (c,r) → pad 索引(0-14),【阅读顺序】:顶行左→右 = 0-4(低),中行 5-9,底行 10-14(高)。
 *  15 键全填、无 FN 空位 —— 从顶行最左到底行最右顺序排列音阶。 */
export function padIndex(c: number, r: number): number {
  return r * 5 + c;
}

const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** midi → 音名(含八度,如 "C4")。 */
export function midiName(midiNote: number): string {
  return `${PC_NAMES[mod(midiNote, 12)]}${Math.floor(midiNote / 12) - 1}`;
}
