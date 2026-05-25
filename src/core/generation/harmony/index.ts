// ============================================================
// harmony/ — 共享和声工具(AF2 + ImproCore 共用)
// ============================================================
//
// 来源:从 ~/vibe_coding/melodygenerative/src/lib/ 移植(2026-05-25)
// 设计哲学:独立 module,不依赖任何引擎 IR,纯 data in / data out。
// caller(AF2 / ImproCore)自己做 adapter。
//
// 模块清单:
//   - wide-piano-voicing.ts  钢琴 6-lane 宽阔排列 + inner motion 副旋律
//   - harmonic-coherence.ts  跨 chord 债务簿 + 评分诊断(TBD Tier 1.2)
//   - borrow-rules.ts        10 条借调规则(A1-G)(TBD Tier 1.3)
//   - tonicization-rules.ts  Tonicization P5a + cooldown(TBD Tier 2.6)
// ============================================================

export * from './wide-piano-voicing';
export * from './harmonic-coherence';
export * from './borrow-rules';
export * from './tonicization-rules';
