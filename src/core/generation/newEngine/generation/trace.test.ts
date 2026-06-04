import { describe, it, expect } from 'vitest';
import { traceGeneration } from './trace';

describe('generation/traceGeneration', () => {
  const t = traceGeneration({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 120 });
  const text = t.lines.join('\n');

  it('每层节点都有日志行', () => {
    for (const marker of ['REQUEST', 'BAND', 'ARRANGER', 'INSTRUMENT', 'HARMONY', 'PREPASS', 'RENDER', 'AUDITOR']) {
      expect(text).toContain(marker);
    }
  });

  it('产出可播放 IR(5 轨)+ pass', () => {
    expect(t.ir.tracks.map((tr) => tr.role)).toEqual(['bass', 'comp', 'pad', 'drum', 'lead']);
    expect(t.audit.findings.length).toBe(0);
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
