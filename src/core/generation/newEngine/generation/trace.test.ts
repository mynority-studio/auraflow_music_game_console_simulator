import { describe, it, expect } from 'vitest';
import { traceGeneration } from './trace';

describe('generation/traceGeneration', () => {
  const t = traceGeneration({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 120 });
  const text = t.lines.join('\n');

  it('每层节点都有日志行', () => {
    // ★ 2026-06-07:退役 Motif 旋律子系统 → 无 PREPASS 段(旋律=MG 链)
    for (const marker of ['REQUEST', 'BAND', 'ARRANGER', 'INSTRUMENT', 'HARMONY', 'RENDER', 'AUDITOR']) {
      expect(text).toContain(marker);
    }
  });

  it('产出可播放 IR(可变编制,含 lead)+ 非 failed', () => {
    const roles = t.ir.tracks.map((tr) => tr.role);
    expect(roles).toContain('lead');
    expect(roles.length).toBeGreaterThanOrEqual(2);
    expect(t.status).not.toBe('failed');
    expect(t.bpm).toBeGreaterThan(0);
  });

  it('确定性:同 seed → 同日志', () => {
    const again = traceGeneration({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    expect(again.lines).toEqual(t.lines);
  });

  it('不同 seed → 日志不同(动机/和声变)', () => {
    const other = traceGeneration({ seed: 99, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    expect(other.lines).not.toEqual(t.lines);
  });
});
