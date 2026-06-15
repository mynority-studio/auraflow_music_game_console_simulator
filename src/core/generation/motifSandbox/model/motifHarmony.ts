// ============================================================
// motifSandbox · model · 给 motif 配和弦(melody → chord progression)
// ------------------------------------------------------------
// 用户:和弦来自【对用户 motif 配和弦】(独立模块)。第一期轻量:
//   ① 按 bar 给 motif 选最贴合的调内三和弦(motif 音多落和弦音 = 高分;首 bar 偏 I)。
//   ② 续接一段【终止式】(predominant→dominant)凑成一轮 = motif 和弦 + 续接和弦。
// 例:motif 落 C-Am(I-vi)→ 续接 F-G(IV-V)→ 一轮 C-Am-F-G。clean-room,确定性。
// ============================================================

import type { MotifNote, ScaleMode, UserMotif } from './types';
import { makeChord, type SandboxChord } from './chords';
import { midiToScaleDegree } from './scale';

const BAR = 4;

/** 给 motif 的每个 bar 选最贴合的调内三和弦(motif 音落和弦音得分;首 bar 偏 I,末偏不强求)。 */
export function harmonizeMotif(motif: UserMotif, keyPc: number, mode: ScaleMode): SandboxChord[] {
  const bars = Math.max(1, Math.round(motif.lengthBeats / BAR));
  const out: SandboxChord[] = [];
  for (let b = 0; b < bars; b++) {
    const lo = b * BAR, hi = (b + 1) * BAR;
    const inBar = motif.notes.filter((n) => n.onsetBeat >= lo - 1e-6 && n.onsetBeat < hi - 1e-6);
    let bestDeg = 1, bestScore = -1;
    for (let deg = 1; deg <= 7; deg++) {
      if (deg === 7) continue; // 第一期跳过 vii°(不稳定)
      const ch = makeChord(deg, keyPc, mode, lo, BAR);
      let score = 0;
      for (const n of inBar) {
        const sd = n.scaleDegree;
        const w = (n.accent + Math.min(1, n.durationBeat)) + (Math.abs(n.onsetBeat - Math.round(n.onsetBeat)) < 1e-6 ? 0.5 : 0);
        if (ch.toneDegrees.includes(sd)) score += w;
        else score -= 0.25 * w; // 非和弦音轻罚
      }
      if (b === 0 && deg === 1) score += 0.6;   // 首 bar 偏 I(稳定起)
      if (deg === 1 || deg === 5 || deg === 4 || deg === 6) score += 0.2; // 常用功能和弦偏好
      if (score > bestScore) { bestScore = score; bestDeg = deg; }
    }
    out.push(makeChord(bestDeg, keyPc, mode, lo, BAR));
  }
  return out;
}

/** 续接终止式(predominant→dominant),长度 = motif 和弦数;接在 motif 和弦之后。 */
export function continuationChords(motifChords: readonly SandboxChord[], keyPc: number, mode: ScaleMode): SandboxChord[] {
  const n = motifChords.length;
  const startBeat = motifChords[n - 1].startBeat + motifChords[n - 1].durationBeats;
  // 终止式骨架:predominant(IV 或 ii)→ dominant(V),按长度铺
  const TEMPLATES: Record<number, number[]> = {
    1: [5],
    2: [4, 5],
    3: [4, 4, 5],
    4: [4, 2, 5, 5],
  };
  const degs = TEMPLATES[Math.min(4, n)] ?? [4, 5];
  return degs.map((deg, i) => makeChord(deg, keyPc, mode, startBeat + i * BAR, BAR));
}

export interface MotifCycle {
  motifChords: SandboxChord[];   // 前半段(motif 自己的和弦)
  contChords: SandboxChord[];    // 后半段(续接终止式)
  all: SandboxChord[];           // motifChords + contChords(一轮)
  cycleBeats: number;
  motifBeats: number;            // 前半段长度(= motif.lengthBeats)
}

/** 一轮和弦进行 = motif 和弦(前半)+ 续接终止式(后半)。 */
export function buildMotifCycle(motif: UserMotif, keyPc: number, mode: ScaleMode): MotifCycle {
  const motifChords = harmonizeMotif(motif, keyPc, mode);
  const contChords = continuationChords(motifChords, keyPc, mode);
  const all = [...motifChords, ...contChords];
  const cycleBeats = all.length * BAR;
  return { motifChords, contChords, all, cycleBeats, motifBeats: motifChords.length * BAR };
}

/** 4 小节乐句 = motif 自己的和弦(前段,保留)+ 终止式填充(vi/VI–IV/iv–V)凑到 4 小节。 */
export function buildPhrase(motif: UserMotif, keyPc: number, mode: ScaleMode): number[] {
  const PHRASE = 4;
  const degs = harmonizeMotif(motif, keyPc, mode).slice(0, PHRASE).map((c) => c.degree); // 保 motif 配出的和弦
  const FILL = [6, 4, 5]; // vi/VI → IV/iv → V(romanOf 自动处理大小调记号)
  for (let i = 0; degs.length < PHRASE; i++) degs.push(FILL[i % FILL.length]);
  return degs;
}

/** 整曲(totalBars)和弦进行 = 4 小节乐句平铺,末两小节收尾终止式(V→I)。
 *  和声【循环】是常态(乐句/turnaround);发展落在【旋律】上,不在和声上 → 不算"重复"。 */
export function buildProgression(motif: UserMotif, keyPc: number, mode: ScaleMode, totalBars: number): SandboxChord[] {
  const phrase = buildPhrase(motif, keyPc, mode);
  const out: SandboxChord[] = [];
  for (let b = 0; b < totalBars; b++) out.push(makeChord(phrase[b % phrase.length], keyPc, mode, b * BAR, BAR));
  if (totalBars >= 2) { // 收尾真终止式:倒数第二小节 V、末小节 I
    out[totalBars - 2] = makeChord(5, keyPc, mode, (totalBars - 2) * BAR, BAR);
    out[totalBars - 1] = makeChord(1, keyPc, mode, (totalBars - 1) * BAR, BAR);
  }
  return out;
}
