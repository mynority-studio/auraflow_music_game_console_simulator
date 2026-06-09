// ============================================================
// newEngine · render · TextureClock(Loop I,2026-06-09)
// ------------------------------------------------------------
// 跨轨时钟【中央 policy】:LOFI rich texture 的 chord/bass 事件不再把 raw tRel(如 0.58)当最终 onset。
//   1:1 对齐 MG musicEngine.shapeLofiArrangement / lofiPocketMs / beatsFromMsAtStyleTempo:
//     ① 把【小节内 relTime】吸附到 16 分格:round(relTime*4)/4;
//     ② 再加【毫秒级】pocket(MG fallback timing chord [4,18]ms / bass [-2,4]ms,强拍收窄)→ 换算成拍。
//   结果:0.58 → grid 0.50 + ~0.01-0.02 拍 pocket(毫秒级,非半拍级),comp 与 bass/drum 同一时钟。
//   不放进各 renderer 各自偷修;此处是单一 policy,bass/comp 共享。确定性(纯 hash,无 rng 对象)。
// ============================================================

// MG fallback timing(profile?.timing ?? …);不扩大范围。
const LOFI_CHORD_LATE_MS: readonly [number, number] = [4, 18];
const LOFI_BASS_LATE_MS: readonly [number, number] = [-2, 4];
const STRONG_BEATS = [0, 2]; // 4/4 强拍(下拍 + 半小节)

/** 确定性 [0,1)(xmur3 hash;替代 MG stableUnitInterval,无需 rng 对象)。 */
function hash01(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^= h >>> 16) >>> 0) / 4294967296;
}

/** ms → 拍(按 LOFI tempo)。 */
export function beatsFromMs(ms: number, tempoBpm: number): number {
  return (ms * tempoBpm) / 60000;
}

/** MG lofiPocketMs 的忠实端口(fallback timing;strong-beat 收窄;lane + hit 两个确定性 roll)。 */
export function lofiPocketMs(part: 'chord' | 'bass', beatInBar: number, barIndex: number, role: string, key: string, relTime: number): number {
  const isStrong = STRONG_BEATS.some((sb) => Math.abs(beatInBar - sb) < 0.035);
  const isDownbeat = Math.abs(beatInBar) < 0.035;
  const lanePocket = (hash01(`lofi-pocket|${key}|${barIndex}|${part}|${role}`) - 0.5) * (part === 'bass' ? 1.5 : 3.0);
  const hitRoll = hash01(`lofi-hit|${key}|${barIndex}|${part}|${relTime.toFixed(3)}`);
  if (part === 'bass') {
    let [lo, hi] = LOFI_BASS_LATE_MS;
    lo = Math.max(-4, lo); hi = Math.min(6, hi);
    if (isDownbeat) { lo = Math.max(lo, -1); hi = Math.min(hi, 3); }
    return Math.max(isDownbeat ? 0 : -4, Math.min(6, lo + (hi - lo) * hitRoll + lanePocket));
  }
  const roleCap = role === 'lift' ? 24 : role === 'develop' ? 22 : role === 'cadence' ? 20 : 18;
  let [lo, hi] = LOFI_CHORD_LATE_MS;
  if (isStrong) { lo = 0; hi = Math.min(hi, isDownbeat ? 6 : 8); }
  else { lo = Math.min(lo, 8); hi = Math.min(hi, roleCap); }
  return Math.max(0, Math.min(roleCap, lo + (hi - lo) * hitRoll + lanePocket));
}

/** LOFI texture 事件最终 onset(拍):16 分格吸附 + 毫秒级 pocket。 */
export function lofiTextureClockBeat(
  absBeat: number,
  beatsPerBar: number,
  tempoBpm: number,
  part: 'chord' | 'bass',
  role: string,
  key: string,
): number {
  const barIndex = Math.floor(absBeat / beatsPerBar);
  const barStart = barIndex * beatsPerBar;
  const relTime = Math.max(0, absBeat - barStart);
  const gridTime = Math.round(relTime * 4) / 4; // 16 分格吸附
  const beatInBar = ((gridTime % beatsPerBar) + beatsPerBar) % beatsPerBar;
  const pocketBeats = beatsFromMs(lofiPocketMs(part, beatInBar, barIndex, role, key, relTime), tempoBpm);
  return barStart + gridTime + pocketBeats;
}
