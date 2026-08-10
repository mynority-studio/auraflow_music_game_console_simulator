import { describe, it, expect } from 'vitest';
import { rankMotifGrammarAffinity, motifGrammarAffinityLine } from './motifGrammarAffinity';

// 稀疏长音 + 大量留白(lofi 语感)
const SPARSE = [
  { onsetBeat: 0, durationBeat: 1.5 },
  { onsetBeat: 2, durationBeat: 1 },
  { onsetBeat: 4, durationBeat: 2 },
];
// 密集十六分连奏(bebop 语感)
const DENSE = Array.from({ length: 16 }, (_, i) => ({ onsetBeat: i * 0.25, durationBeat: 0.25 }));

describe('motifGrammarAffinity · 风格语料节奏亲和', () => {
  it('五个风格全量返回,分值 0..1 降序,确定性', () => {
    const a = rankMotifGrammarAffinity(SPARSE, 8);
    const b = rankMotifGrammarAffinity(SPARSE, 8);
    expect(a.map((x) => x.style).sort()).toEqual(['acg', 'jazz', 'lofi', 'pop', 'rnb']);
    for (let i = 1; i < a.length; i++) expect(a[i].score).toBeLessThanOrEqual(a[i - 1].score + 1e-9);
    for (const x of a) { expect(x.score).toBeGreaterThan(0); expect(x.score).toBeLessThanOrEqual(1); }
    expect(a).toEqual(b);
  });

  it('稀疏留白动机比密集十六分动机更亲和 LOFI 语料', () => {
    const lofiOf = (r: ReturnType<typeof rankMotifGrammarAffinity>) => r.find((x) => x.style === 'lofi')!.score;
    expect(lofiOf(rankMotifGrammarAffinity(SPARSE, 8))).toBeGreaterThan(lofiOf(rankMotifGrammarAffinity(DENSE, 4)));
  });

  it('UI 文案:前 3 风格 · 两位小数', () => {
    const line = motifGrammarAffinityLine(rankMotifGrammarAffinity(SPARSE, 8));
    expect(line.split(' · ').length).toBe(3);
    expect(line).toMatch(/^(POP|JAZZ|LOFI|RNB|ACG) \.\d{2}/);
  });
});
