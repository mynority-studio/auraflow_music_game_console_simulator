// ============================================================
// motifSandbox · model · 和弦(diatonic 三和弦)
// ------------------------------------------------------------
// 给 motif 配和弦 / motif 在和弦下复现用。第一期只用调内三和弦(I..vii°)。
// ============================================================

import type { ScaleMode } from './types';
import { SCALE_INTERVALS } from './scale';

export interface SandboxChord {
  degree: number;          // 1..7(调内级)
  rootPc: number;          // 0..11
  toneDegrees: number[];   // 三和弦的 scale degree(如 I=[1,3,5])
  tonePcs: number[];       // 三和弦音的 pc
  roman: string;           // 'I' / 'vi' / 'IV' / 'V' / 'ii°'…
  startBeat: number;
  durationBeats: number;
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** 某级三和弦的 scale degree(1-indexed,叠三度):d, d+2, d+4。 */
export function triadToneDegrees(degree: number): number[] {
  return [0, 2, 4].map((s) => mod(degree - 1 + s, 7) + 1);
}

/** scale degree(1..7)→ 该调下的 pc。 */
export function degreeToPc(degree: number, keyPc: number, mode: ScaleMode): number {
  return mod(keyPc + SCALE_INTERVALS[mode][mod(degree - 1, 7)], 12);
}

const ROMAN_MAJOR = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
const ROMAN_MINOR = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];

export function romanOf(degree: number, mode: ScaleMode): string {
  return (mode === 'major' ? ROMAN_MAJOR : ROMAN_MINOR)[mod(degree - 1, 7)];
}

/** 造一个调内三和弦。 */
export function makeChord(degree: number, keyPc: number, mode: ScaleMode, startBeat: number, durationBeats: number): SandboxChord {
  const toneDegrees = triadToneDegrees(degree);
  return {
    degree, rootPc: degreeToPc(degree, keyPc, mode),
    toneDegrees, tonePcs: toneDegrees.map((d) => degreeToPc(d, keyPc, mode)),
    roman: romanOf(degree, mode), startBeat, durationBeats,
  };
}

/** 某 midi 是否该和弦的和弦音(按 pc)。 */
export function isChordTone(midiNote: number, chord: SandboxChord): boolean {
  return chord.tonePcs.includes(mod(midiNote, 12));
}

/** 把 midi 吸到该和弦【最近的和弦音】(保持就近八度)。 */
export function nearestChordTone(midiNote: number, chord: SandboxChord): number {
  let best = midiNote, bestD = 99;
  for (const pc of chord.tonePcs) {
    const base = midiNote - mod(midiNote, 12) + pc;
    for (const cand of [base - 12, base, base + 12]) {
      const d = Math.abs(cand - midiNote);
      if (d < bestD) { bestD = d; best = cand; }
    }
  }
  return best;
}

/** 朝指定方向(dir:+1 上 / -1 下 / 0 就近)取最近的和弦音(限一个八度内;超则退就近)。 */
export function chordToneInDirection(fromMidi: number, chord: SandboxChord, dir: number): number {
  if (dir === 0) return nearestChordTone(fromMidi, chord);
  let best = fromMidi, bestD = 999;
  for (const pc of chord.tonePcs) {
    const base = fromMidi - mod(fromMidi, 12) + pc;
    for (const cand of [base - 24, base - 12, base, base + 12, base + 24]) {
      if ((dir > 0 && cand > fromMidi) || (dir < 0 && cand < fromMidi)) {
        const d = Math.abs(cand - fromMidi);
        if (d >= 1 && d < bestD) { bestD = d; best = cand; }
      }
    }
  }
  return bestD > 12 ? nearestChordTone(fromMidi, chord) : best; // 该方向太远 → 就近(任意方向)
}

/** 在和弦序列里取覆盖某 beat 的和弦。 */
export function chordAtBeat(progression: readonly SandboxChord[], beat: number): SandboxChord | undefined {
  return progression.find((c) => beat >= c.startBeat - 1e-6 && beat < c.startBeat + c.durationBeats - 1e-6)
    ?? progression[progression.length - 1];
}
