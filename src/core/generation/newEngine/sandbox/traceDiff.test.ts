import { describe, it, expect } from 'vitest';
import { diffLines, compareTraces } from './traceDiff';
import { traceGeneration } from '../generation';
import { pc } from '../foundation';

describe('sandbox · A/B trace diff (6.3)', () => {
  it('完全相同 → 全部 same,无变更', () => {
    const rows = diffLines(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(rows.every((r) => r.same)).toBe(true);
    expect(rows.map((r) => r.left)).toEqual(['a', 'b', 'c']);
  });

  it('★ 单行变更 → 共享前后保 same,变更行各占一侧', () => {
    const rows = diffLines(['a', 'X', 'c'], ['a', 'Y', 'c']);
    // 'a' 与 'c' 同;X/Y 各为单侧 not-same
    expect(rows[0]).toEqual({ left: 'a', right: 'a', same: true });
    expect(rows.some((r) => r.left === 'X' && !r.same)).toBe(true);
    expect(rows.some((r) => r.right === 'Y' && !r.same)).toBe(true);
    expect(rows[rows.length - 1]).toEqual({ left: 'c', right: 'c', same: true });
  });

  it('增行:B 多一行 → 该行 right-only not-same,其余 same', () => {
    const rows = diffLines(['a', 'b'], ['a', 'x', 'b']);
    expect(rows.filter((r) => r.same).map((r) => r.left)).toEqual(['a', 'b']);
    expect(rows.find((r) => !r.same)).toEqual({ right: 'x', same: false });
  });

  it('★ 两 seed 对比:有相同行也有差异行 + 指标 delta', () => {
    const a = traceGeneration({ seed: 1, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
    const b = traceGeneration({ seed: 2, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
    const cmp = compareTraces(a, b);
    expect(cmp.rows.length).toBeGreaterThan(0);
    expect(cmp.rows.some((r) => r.same)).toBe(true);    // REQUEST/某些层一致
    expect(cmp.changedCount).toBeGreaterThan(0);        // seed 不同 → 有差异
    expect(cmp.metrics.bpm.a).toBe(a.bpm);
    expect(cmp.metrics.notes.a).toBeGreaterThan(0);
    expect(typeof cmp.metrics.status.equal).toBe('boolean');
  });

  it('同 seed 对比 → changedCount 0,指标全 equal', () => {
    const a = traceGeneration({ seed: 5, styleHint: 'jazz', mood: 'x', targetDuration: 120, key: pc(0) });
    const b = traceGeneration({ seed: 5, styleHint: 'jazz', mood: 'x', targetDuration: 120, key: pc(0) });
    const cmp = compareTraces(a, b);
    expect(cmp.changedCount).toBe(0);
    expect(cmp.metrics.bpm.equal).toBe(true);
    expect(cmp.metrics.notes.equal).toBe(true);
    expect(cmp.metrics.bars.equal).toBe(true);
  });
});
