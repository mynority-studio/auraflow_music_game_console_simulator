import { describe, it, expect } from 'vitest';
import { generateMotifWeave } from './motifWeaver';
import { generateSampleCaptured } from './motifAnalysis';
import { isInScale } from './scale';
import { isMotifQuotedAt } from './jazzinessAudit';
import type { MotifWeaverInput } from './types';

const baseInput = (over: Partial<MotifWeaverInput> = {}): MotifWeaverInput => ({
  capturedNotes: generateSampleCaptured(96, 0, 'major', 0),
  style: 'pop', keyPc: 0, mode: 'major', bpm: 96, seed: 7, ...over,
});
const sig = (lead: { midi: number; onsetBeat: number }[]) => lead.map((n) => `${n.midi}@${n.onsetBeat}`).join(',');

describe('motifSandbox/motifWeaver', () => {
  it('verse1 / verse2 exact quote(beat 0 与 beat 32 都原样复现 motif)', () => {
    const r = generateMotifWeave(baseInput());
    expect(r.audit.motifQuotedInVerse1).toBe(true);
    expect(r.audit.motifQuotedInVerse2).toBe(true);
    expect(isMotifQuotedAt(r.lead, r.motif, 0)).toBe(true);
    expect(isMotifQuotedAt(r.lead, r.motif, 32)).toBe(true);
  });

  it('verse1 quote 与 verse2 quote 逐音相等(相对段首)', () => {
    const r = generateMotifWeave(baseInput());
    const q1 = r.lead.filter((n) => n.occurrenceKind === 'quote' && n.sectionId === 'verse1').map((n) => `${n.midi}@${n.onsetBeat}`).join(' ');
    const q2 = r.lead.filter((n) => n.occurrenceKind === 'quote' && n.sectionId === 'verse2').map((n) => `${n.midi}@${n.onsetBeat - 32}`).join(' ');
    expect(q2).toBe(q1);
  });

  it('确定性:同 seed 同结果', () => {
    expect(sig(generateMotifWeave(baseInput({ seed: 11 })).lead)).toBe(sig(generateMotifWeave(baseInput({ seed: 11 })).lead));
  });

  it('不同 seed → 续写不同,但 quote 仍一致', () => {
    const a = generateMotifWeave(baseInput({ seed: 7 }));
    const b = generateMotifWeave(baseInput({ seed: 99 }));
    expect(sig(a.lead)).not.toBe(sig(b.lead));               // 整体不同
    const quote = (r: typeof a) => r.lead.filter((n) => n.occurrenceKind === 'quote').map((n) => `${n.midi}@${n.onsetBeat}`).join(',');
    expect(quote(a)).toBe(quote(b));                          // quote 仍一致
  });

  it('音符排序 + 时值非负 + 总长 ≈ 64 beats', () => {
    const r = generateMotifWeave(baseInput());
    const sorted = [...r.lead].sort((a, b) => a.onsetBeat - b.onsetBeat);
    expect(r.lead.map((n) => n.onsetBeat)).toEqual(sorted.map((n) => n.onsetBeat));
    for (const n of r.lead) expect(n.durationBeat).toBeGreaterThan(0);
    const span = Math.max(...r.lead.map((n) => n.onsetBeat + n.durationBeat));
    expect(span).toBeGreaterThan(56);
    expect(span).toBeLessThanOrEqual(64);
  });

  it('POP/LOFI/RNB:chromaticRatio = 0(全 diatonic);jazziness < 0.35', () => {
    for (const style of ['pop', 'lofi', 'rnb'] as const) {
      const r = generateMotifWeave(baseInput({ style }));
      expect(r.audit.chromaticRatio, style).toBe(0);
      for (const n of r.lead) expect(isInScale(n.midi, 0, 'major'), `${style} GM${n.midi}`).toBe(true);
      expect(r.audit.jazzinessScore, style).toBeLessThan(0.35);
    }
  });

  it('minor key 也全在调内', () => {
    const r = generateMotifWeave(baseInput({ capturedNotes: generateSampleCaptured(96, 9, 'minor', 1), keyPc: 9, mode: 'minor' }));
    for (const n of r.lead) expect(isInScale(n.midi, 9, 'minor')).toBe(true);
  });
});
