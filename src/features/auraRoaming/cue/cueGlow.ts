// ============================================================
// auraRoaming · cueGlow(呼吸灯包络,纯函数)
// ------------------------------------------------------------
// 一个提示 = 该键 9 颗灯同步:灭 → 余弦缓升 → 最亮(峰值落在音符
// 发声前 50~100ms)→ 保持 → 渐灭。LedMatrix 的 rAF 每帧调
// cueGlowIntensity 取亮度,发事件的抖动不影响峰值时刻精度。
// ============================================================

export interface AuraCueGlowSpec {
  cueId: number;
  col: number;
  row: number;
  hue: number;
  /** 最亮时刻(performance.now() 时基,已含提前量)。 */
  peakAtMs: number;
  riseMs: number;
  holdMs: number;
  fadeMs: number;
}

/** 0..1 亮度;尚未开始 → 0;已结束 → -1(调用方移除)。 */
export function cueGlowIntensity(nowMs: number, glow: AuraCueGlowSpec): number {
  const riseStart = glow.peakAtMs - glow.riseMs;
  if (nowMs < riseStart) return 0;
  if (nowMs < glow.peakAtMs) {
    const p = (nowMs - riseStart) / glow.riseMs;
    return 0.5 - 0.5 * Math.cos(Math.PI * p);
  }
  const holdEnd = glow.peakAtMs + glow.holdMs;
  if (nowMs <= holdEnd) return 1;
  const fadeEnd = holdEnd + glow.fadeMs;
  if (nowMs < fadeEnd) {
    const p = (nowMs - holdEnd) / glow.fadeMs;
    return 0.5 + 0.5 * Math.cos(Math.PI * p);
  }
  return -1;
}

/** 命中后立刻收灯:峰值截断到当前(早按会先闪到最亮),随即快速渐灭。 */
export function snuffGlow(glow: AuraCueGlowSpec, nowMs: number, fadeMs = 140): AuraCueGlowSpec {
  const riseStart = glow.peakAtMs - glow.riseMs;
  const peakAtMs = Math.min(glow.peakAtMs, nowMs);
  return {
    ...glow,
    peakAtMs,
    riseMs: Math.max(1, peakAtMs - riseStart),
    holdMs: Math.max(0, nowMs - peakAtMs),
    fadeMs,
  };
}
