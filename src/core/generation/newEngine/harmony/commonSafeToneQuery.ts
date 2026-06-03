// ============================================================
// newEngine · harmony · commonSafeToneSet 查询
// ------------------------------------------------------------
// 架构定稿 Part 2.4 / 附录 D9:挂 HarmonicPlan 的派生【纯函数】,不碰 motif 概念。
// 安全音 = ∩(各 span 的 stable ∪ acceptable);真 avoid 永不入集。
// spans 由调用方(Prepass)按 scope 解析好(local=当前 phrase / global=该 motif 全部出现并集)。
// 空 spans → [](调用方据此判降级)。
// ============================================================

import type { PitchClass } from '../foundation';
import type { ChordSpanId, HarmonicPlan } from './HarmonicPlan';

export type SafeToneScope = 'local' | 'global';

export function commonSafeToneSet(
  plan: HarmonicPlan,
  scope: SafeToneScope,
  spans: ChordSpanId[],
): PitchClass[] {
  void scope; // 交集算法与 scope 无关;scope 由调用方用于解析 spans(此处仅契约保真)
  if (spans.length === 0) return [];

  // 每个 span 的安全音 = stable ∪ acceptable,再剔除 avoid
  const perSpan: Set<number>[] = spans.map((id) => {
    const t = plan.tensionMap[id];
    if (!t) throw new RangeError(`commonSafeToneSet(): 未知 chordSpanId "${id}"`);
    const set = new Set<number>([...t.stable, ...t.acceptable]);
    for (const a of t.avoid) set.delete(a);
    return set;
  });

  // 交集
  let acc = perSpan[0];
  for (let i = 1; i < perSpan.length; i++) {
    const next = perSpan[i];
    acc = new Set([...acc].filter((x) => next.has(x)));
  }

  return [...acc].sort((a, b) => a - b) as PitchClass[];
}
