import { describe, it, expect } from 'vitest';
import { auditMotifWeave } from './jazzinessAudit';
import { makeChord, type SandboxChord } from './chords';
import type { MotifNote, UserMotif, MotifOccurrence } from './types';

// followup 2.3:quote 结构蓝音 —— 保留原样,但和声没接住时审计要报 quoteStructuralUnsupported(不 mutate quote)。
const m12 = (n: number) => ((n % 12) + 12) % 12;
const n = (midi: number, onsetBeat: number, durationBeat: number, kind: MotifNote['occurrenceKind'], str: number): MotifNote =>
  ({ midi, onsetBeat, durationBeat, velocity: 0.9, scaleDegree: 1, octave: 4, accent: 0.7, structuralToneScore: str, occurrenceKind: kind });
const motifOf = (notes: MotifNote[]): UserMotif => ({ id: 'm', keyPc: 0, mode: 'major', bpm: 96, notes, lengthBeats: 4, contour: [], rhythmCell: [], createdAt: 0, inputTonality: 'majorBlues' });
const occ = (startBeat: number): MotifOccurrence => ({ motifId: 'm', startBeat, slotIndex: 0, kind: 'quote', label: 'quote', chordRoman: 'I' });

// C 大调 plain I(不容纳 Eb)vs seasoned I(bluesColorPcs 含 Eb=3)
const plainC: SandboxChord = makeChord(1, 0, 'major', 0, 4);
const seasonedC: SandboxChord = { ...makeChord(1, 0, 'major', 0, 4), realType: '7', realRootPc: 0, realTonePcs: [0, 4, 7, 10, 3], bluesColorPcs: [3], bluesSeasoned: true, effectiveFunc: 'D' };

describe('motifSandbox/contract audit · quote 结构蓝音(followup 2.3)', () => {
  it('★ plain C 上的强 Eb quote:首音保 Eb + quoteStructuralUnsupported>0(和声没接住,不 mutate)', () => {
    const lead = [n(63, 0, 2, 'quote', 0.7)]; // Eb 强长(结构)
    const a = auditMotifWeave(lead, motifOf(lead), [occ(0)], 0, 'major', { totalBars: 1, quoteBeats: 4, progression: [plainC], inputTonality: 'majorBlues' });
    expect(m12(lead[0].midi)).toBe(3);                 // quote 未被改(审计只读)
    expect(a.quoteStructuralUnsupported).toBeGreaterThan(0);
    expect(a.structuralUnsupported).toBe(0);            // 非 quote 结构不支持仍 0
  });

  it('★ seasoned(容纳 Eb)上的强 Eb quote:quoteStructuralUnsupported=0 + blueColorStructuralSupported>0', () => {
    const lead = [n(63, 0, 2, 'quote', 0.7)];
    const a = auditMotifWeave(lead, motifOf(lead), [occ(0)], 0, 'major', { totalBars: 1, quoteBeats: 4, progression: [seasonedC], inputTonality: 'majorBlues' });
    expect(a.quoteStructuralUnsupported).toBe(0);
    expect(a.blueColorStructuralSupported).toBeGreaterThan(0);
  });

  it('★ 弱 Eb quote 经过(短弱)→ 不算 quoteStructuralUnsupported', () => {
    const lead = [n(60, 0, 0.5, 'quote', 0.7), n(63, 0.75, 0.25, 'quote', 0.2), n(62, 1, 1, 'quote', 0.7)];
    const a = auditMotifWeave(lead, motifOf(lead), [occ(0)], 0, 'major', { totalBars: 1, quoteBeats: 4, progression: [plainC], inputTonality: 'majorBlues' });
    expect(a.quoteStructuralUnsupported).toBe(0); // 弱 Eb = quote-blue/scale-passing,放行
  });
});
