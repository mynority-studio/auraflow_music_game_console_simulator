// ============================================================
// newEngine · render · Swing(feel.swingRatio 落地)
// ------------------------------------------------------------
// 架构定稿 Part 2.3 feel:把 swingRatio 真正 warp 到 tick。
// 拍内时间扭曲(piecewise-linear):frac∈[0,0.5]→[0,ratio],[0.5,1]→[ratio,1]。
//   ratio=0.5 → 恒等(直);ratio=0.66 → offbeat 后移(三连摇摆)。
// 整拍 onset(frac=0)不动;全轨统一(drum/comp/bass/melody 一致摆动)。
// ============================================================

import { ticks } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';

export function swingFrac(frac: number, ratio: number): number {
  if (frac <= 0.5) return frac * (ratio / 0.5);
  return ratio + (frac - 0.5) * ((1 - ratio) / 0.5);
}

/** 对全部音轨 onset 做 swing warp。直(ratio≈0.5)则原样返回。 */
export function applySwing(tracks: TrackIR[], ppq: number, swingRatio: number): TrackIR[] {
  if (Math.abs(swingRatio - 0.5) < 1e-6) return tracks;
  return tracks.map((t) => {
    if (t.role === 'lead') return t; // ★ Loop 9:lead = MG StyleRenderer 已上单轨 swing,跳过全局 swing(避免 jazz 双 swing)
    if (t.role === 'pad') return t;  // ★ pad = sustain 铺底层:跳过 swing(长音 onset 不应被 swing 移位,保连续平铺)
    return {
    role: t.role,
    notes: t.notes.map((n) => {
      const beat = (n.startTick as number) / ppq;
      const whole = Math.floor(beat);
      const swung = whole + swingFrac(beat - whole, swingRatio);
      return { ...n, startTick: ticks(Math.round(swung * ppq)) };
    }),
    };
  });
}
