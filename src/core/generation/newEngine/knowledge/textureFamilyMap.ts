// ============================================================
// newEngine · knowledge · Texture Family Map(mg_intent_planning_layer_migration §4.3 / Phase 3)
// ------------------------------------------------------------
// KB 元数据:texture case → 宏观 family(intent 的 TextureFamily 词汇)。供 ① intent 派生(arranger 定 family)
//   ② resolver(在已定 family 内选合法 case)③ audit(实际 case ∈ 意图 family?)。名字模式驱动,确定性纯函数。
// ★ 决策(#1 SIM-native):family 是【SIM 内部聚合观测】,不逐 seed 跑 MG;不追 concrete case,追 family。
// ============================================================

import type { TextureFamily } from '../intent/MusicIntentPlan';

/** texture case → family(顺序敏感:先具体后兜底)。未知 → 'block'(柱式/comp 兜底)。 */
export function textureCaseFamily(tc: string): TextureFamily {
  const s = tc;
  if (/Ostinato/i.test(s)) return 'ostinato';
  if (/Stride/i.test(s)) return 'stride';
  if (/Pedal/i.test(s)) return 'pedal';
  if (/Answer/i.test(s)) return 'sparseAnswer';
  if (/Wash|Ambient|Sustain|OneShot|Reverse_Swell|Planing|Felt.*Sparse|Breath/i.test(s)) return 'wash';
  if (/Block|Red_Garland/i.test(s)) return 'block'; // Anthem_Block / Suspended_Block / Block_Chord
  if (/Roll/i.test(s)) return 'roll';
  if (/Broken|10th/i.test(s)) return 'broken';
  if (/Arp|Alberti|158|Sweep|Wave|Flow|arpeggio|Wobble|Bossa/i.test(s)) return 'arp';
  if (/Pulse|HalfTime|Triplet|Charleston|Hemiola|Tremolo|Anthem/i.test(s)) return 'pulse';
  if (/Stab|Chops/i.test(s)) return 'block';
  return 'block'; // Comp / Drop2 / Quartal / Motion / Color / Sync / Pluck / Groove 兜底
}

/** 一组 case 的主导 family(众数;并列取先出现)。空 → 'block'。arranger 从 GrooveContract preferred 派生 family intent 用。 */
export function dominantFamilyOfCases(cases: readonly string[]): TextureFamily {
  const m = new Map<TextureFamily, number>();
  for (const c of cases) { const f = textureCaseFamily(c); m.set(f, (m.get(f) ?? 0) + 1); }
  let best: TextureFamily = 'block'; let bestN = -1;
  for (const [f, n] of m) if (n > bestN) { bestN = n; best = f; }
  return best;
}

/** ★ KB resolver(§7 Phase 3 task2,enforce 用;Phase 3 observe 不接线):在【已定 family】内选一个合法 case。
 *  规则:不决 story、不自己选 block/roll(family 由 arranger 定);只从候选里挑同 family 的(空交集回退全候选,不硬失败);
 *  rng 必须是【命名子流】(调用方传,不碰主 RNG → 不漂移已有 seed)。resolver 不能变隐形 arranger。 */
export function resolveTextureCaseForIntent(
  intendedFamily: TextureFamily,
  candidateCases: readonly string[],
  rng: { pick<T>(xs: readonly T[]): T },
): string | undefined {
  if (candidateCases.length === 0) return undefined;
  const inFamily = candidateCases.filter((c) => textureCaseFamily(c) === intendedFamily);
  const pool = inFamily.length > 0 ? inFamily : candidateCases; // 空交集回退全候选(family 不可满足时不硬失败)
  return rng.pick(pool);
}
