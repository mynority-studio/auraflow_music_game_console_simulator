// ============================================================
// motifSandbox · model · motif 变形工具(clean-room ThemeWeaver.adjustTheme)
// ------------------------------------------------------------
// 全部 diatonic、保持 onset/dur 不倒退;quote 用 identity,变形只用于 answer/development。
// ============================================================

import type { MotifNote, ScaleMode } from './types';
import { transposeDiatonic as diatonic, snapMidiToScale, midiToScaleDegree, midiToOctave } from './scale';

const refresh = (n: MotifNote, midi: number, keyPc: number, mode: ScaleMode): MotifNote => ({
  ...n, midi, scaleDegree: midiToScaleDegree(midi, keyPc, mode), octave: midiToOctave(midi),
});

export function identity(notes: readonly MotifNote[]): MotifNote[] {
  return notes.map((n) => ({ ...n }));
}

/** diatonic 移位 steps 个度(保持调内)。 */
export function transposeDiatonicMotif(notes: readonly MotifNote[], steps: number, keyPc: number, mode: ScaleMode): MotifNote[] {
  return notes.map((n) => refresh(n, diatonic(n.midi, steps, keyPc, mode), keyPc, mode));
}

/** 围绕 pivot midi 反向(音程倒影),再吸回 scale。 */
export function invertAroundMidi(notes: readonly MotifNote[], pivotMidi: number, keyPc: number, mode: ScaleMode): MotifNote[] {
  return notes.map((n) => refresh(n, snapMidiToScale(2 * pivotMidi - n.midi, keyPc, mode), keyPc, mode));
}

/** 逆行(只逆 pitch,保持原 onset/dur 网格)。 */
export function retrogradePitchOnly(notes: readonly MotifNote[]): MotifNote[] {
  const pitches = notes.map((n) => n.midi).reverse();
  return notes.map((n, i) => ({ ...n, midi: pitches[i] }));
}

/** 把最长音一分为二(第二个取上邻接 diatonic)。 */
export function rhythmDivide(notes: readonly MotifNote[], keyPc: number, mode: ScaleMode): MotifNote[] {
  if (notes.length === 0) return [];
  let maxI = 0;
  for (let i = 1; i < notes.length; i++) if (notes[i].durationBeat > notes[maxI].durationBeat) maxI = i;
  const out: MotifNote[] = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (i === maxI && n.durationBeat >= 0.5) {
      const half = n.durationBeat / 2;
      out.push({ ...n, durationBeat: half });
      const upMidi = diatonic(n.midi, 1, keyPc, mode);
      out.push(refresh({ ...n, onsetBeat: n.onsetBeat + half, durationBeat: half, accent: n.accent * 0.7 }, upMidi, keyPc, mode));
    } else out.push({ ...n });
  }
  return out;
}

/** 八度平移到 [lowMidi, highMidi] 内(保持相对)。 */
export function fitRange(notes: readonly MotifNote[], lowMidi: number, highMidi: number): MotifNote[] {
  if (notes.length === 0) return [];
  let shift = 0;
  const lo = Math.min(...notes.map((n) => n.midi));
  const hi = Math.max(...notes.map((n) => n.midi));
  while (lo + shift < lowMidi) shift += 12;
  while (hi + shift > highMidi && lo + shift - 12 >= lowMidi) shift -= 12;
  return shift === 0 ? notes.map((n) => ({ ...n })) : notes.map((n) => ({ ...n, midi: n.midi + shift, octave: n.octave + shift / 12 }));
}

/** 整段重新吸到 scale(变形后兜底)。 */
export function snapMotifToScale(notes: readonly MotifNote[], keyPc: number, mode: ScaleMode): MotifNote[] {
  return notes.map((n) => refresh(n, snapMidiToScale(n.midi, keyPc, mode), keyPc, mode));
}

/** 节奏扩张(augmentation):onset/dur 整体 ×factor —— 把动机拉长,音变少变长(降密度)。 */
export function augmentMotif(notes: readonly MotifNote[], factor: number): MotifNote[] {
  return notes.map((n) => ({ ...n, onsetBeat: n.onsetBeat * factor, durationBeat: n.durationBeat * factor }));
}

/** 片段化(fragmentation):只取前 keep 比例的音(其余=留白),= motivic 发展的常用手法(降密度)。 */
export function fragmentMotif(notes: readonly MotifNote[], keep: number): MotifNote[] {
  if (notes.length === 0) return [];
  const k = Math.max(1, Math.round(notes.length * keep));
  return notes.slice(0, k).map((n) => ({ ...n }));
}

/** 小节线位移(barLineShift):整体后移 beats 拍 → 切分/错位(调用方按槽长裁剪)。 */
export function displaceMotif(notes: readonly MotifNote[], beats: number): MotifNote[] {
  return notes.map((n) => ({ ...n, onsetBeat: n.onsetBeat + beats }));
}
