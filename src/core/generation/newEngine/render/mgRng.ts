// ============================================================
// newEngine · render · MgRng(MG strict 移植 Loop 3)
// ------------------------------------------------------------
// Provenance: ../melodygenerative/src/lib/improvisor/generateImprovisorMelody.ts
//   的 makeSeededRng(mulberry32)+ hashString 忠实港(逐值)。
// MG-compatible 确定性 RNG —— 旋律生成的随机源,Loop 3+ 共享。
// 注:MG 旋律 RNG 由 seed 独立创建,不依赖和弦生成的 rng → 喂相同 seed 复现相同序列(parity 基础)。
// ============================================================

/** Seeded PRNG (mulberry32) from any string/number seed. */
export function makeSeededRng(seed: string | number): () => number {
  let s = typeof seed === 'number' ? seed : hashString(seed);
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}
