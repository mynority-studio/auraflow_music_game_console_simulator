// ============================================================
// motifSandbox · model · 音阶词汇(大调/小调/大五声/小五声/布鲁斯)
// ------------------------------------------------------------
// 用户:Q+R 选音阶 → 3×5 键盘的音变成该音阶的对应音阶音(可随机下发)。
//   词汇 = 大调、小调、大五声、小五声、布鲁斯。clean-room 镜像 AuraJam ScaleEngine
//   的 padIndex / generateScaleNotes(不 import apps,保 core 独立)。
//   续写/配和声只懂 7 音大/小调 → 每个 tonality 推一个【母调】(parentMode)给下游;
//   输入吸附走【本 tonality】(布鲁斯 b5 等特征音保留)。
// ============================================================

import type { ScaleMode } from './types';

export type SandboxTonality = 'major' | 'minor' | 'majorPent' | 'minorPent' | 'blues';

export const SANDBOX_TONALITIES: SandboxTonality[] = ['major', 'minor', 'majorPent', 'minorPent', 'blues'];

export const TONALITY_INTERVALS: Record<SandboxTonality, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],   // Ionian
  minor: [0, 2, 3, 5, 7, 8, 10],   // Aeolian
  majorPent: [0, 2, 4, 7, 9],      // 大调五声
  minorPent: [0, 3, 5, 7, 10],     // 小调五声
  blues: [0, 3, 5, 6, 7, 10],      // 小调五声 + b5 蓝调音
};

export const TONALITY_LABEL: Record<SandboxTonality, string> = {
  major: '大调', minor: '小调', majorPent: '大五声', minorPent: '小五声', blues: '布鲁斯',
};

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const keyName = (keyPc: number): string => KEY_NAMES[((keyPc % 12) + 12) % 12];

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** 续写/配和声用的 7 音母调(大/小调框架)。 */
export function tonalityParentMode(t: SandboxTonality): ScaleMode {
  return t === 'major' || t === 'majorPent' ? 'major' : 'minor';
}

/** 把 midi 吸到该 tonality 最近音(保留特征音,如 blues b5)。 */
export function snapMidiToTonality(midiNote: number, keyPc: number, tonality: SandboxTonality): number {
  const ivs = TONALITY_INTERVALS[tonality];
  const rel = mod(midiNote - keyPc, 12);
  let best = ivs[0], bestD = 99;
  for (const iv of ivs) { const d = Math.min(mod(rel - iv, 12), mod(iv - rel, 12)); if (d < bestD) { bestD = d; best = iv; } }
  return midiNote - (rel - best);
}

/** 3×5 键盘音表:count 个音升序(C3 附近起,跨 tonality 循环)。镜像 ScaleEngine.generateScaleNotes。 */
export function scaleNoteMap(keyPc: number, tonality: SandboxTonality, count = 14): number[] {
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

/** (c,r) → pad 索引(0-13),FN 键(右上 c=4,r=0)返回 -1。镜像 ScaleEngine.padIndex。
 *  底行 r=2 → 0-4(低)· 中行 r=1 → 5-9 · 顶行 r=0 c<4 → 10-13(高)。 */
export function padIndex(c: number, r: number): number {
  if (c === 4 && r === 0) return -1;
  if (r === 2) return c;
  if (r === 1) return 5 + c;
  if (r === 0 && c < 4) return 10 + c;
  return -1;
}

const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** midi → 音名(含八度,如 "C4")。 */
export function midiName(midiNote: number): string {
  return `${PC_NAMES[mod(midiNote, 12)]}${Math.floor(midiNote / 12) - 1}`;
}
