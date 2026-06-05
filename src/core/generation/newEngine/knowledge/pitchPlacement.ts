// ============================================================
// newEngine · knowledge · pitchPlacement(pc ↔ register 工具)
// ------------------------------------------------------------
// 把 pitch class 落到指定 Midi 音区;pc 间最短环绕距离。Prepass / Melody 共用。
// ============================================================

import { midi, type Midi } from '../foundation';

/** pc → 落在 [low,high] 的 Midi(对齐到 low 所在八度上方最近;越界则回落)。 */
export function pcToMidiInRange(pc: number, low: number, high: number): Midi {
  let m = low - (low % 12) + pc;
  while (m < low) m += 12;
  while (m > high) m -= 12;
  return midi(m);
}

/** 两个 pc 的最短环绕半音距离(0..6)。 */
export function pcDistance(a: number, b: number): number {
  const d = (((a - b) % 12) + 12) % 12;
  return Math.min(d, 12 - d);
}

/**
 * bass pc → [low,high] 的 Midi:【声部进行 + 软重心井】(取代单八度死锁)。
 *   - 声部进行:在 pc 的各八度候选里取【最贴 prevMidi】的(平滑、不乱跳八度);
 *   - 软重心井 [centerLo,centerHi](默认 C2–G2):高于 centerHi 拉回(别飘 G3)、低于 centerLo 轻拉回
 *     (留少量下探空间 → 根音可掉 E1–B1 拿低端,但不沉底);
 *   - 无 prev(prevMidi=NaN/越界)→ 取最接近 center 的候选。
 * 纯函数,确定性(tie → 更接近 center 的低八度)。pc 的八度由此决定,音级不变 → 不扰和声判定。
 */
export function placeBassMidi(
  pc: number,
  prevMidi: number,
  low = 28,
  high = 55,
  centerLo = 36,
  centerHi = 43,
): Midi {
  const base = ((pc % 12) + 12) % 12;
  const cands: number[] = [];
  for (let m = low - (low % 12) + base; m <= high; m += 12) if (m >= low) cands.push(m);
  if (cands.length === 0) return pcToMidiInRange(pc, low, high); // 兜底:越界回落
  const center = (centerLo + centerHi) / 2;
  const ref = Number.isFinite(prevMidi) ? prevMidi : center;
  const score = (m: number) =>
    Math.abs(m - ref) +                    // 声部进行:贴前一个音
    0.4 * Math.max(0, m - centerHi) +      // 高于 G2 → 拉回
    0.6 * Math.max(0, centerLo - m);       // 低于 C2 → 轻拉回(留下探余量)
  let best = cands[0];
  for (const m of cands) {
    const dm = score(m), db = score(best);
    if (dm < db || (dm === db && Math.abs(m - center) < Math.abs(best - center))) best = m;
  }
  return midi(best);
}
