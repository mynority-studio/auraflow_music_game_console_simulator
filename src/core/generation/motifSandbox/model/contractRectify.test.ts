import { describe, it, expect } from 'vitest';
import { generateMotifWeave } from './motifWeaver';
import { generateSampleCaptured } from './motifAnalysis';
import { snapMidiToTonality, type SandboxTonality } from './sandboxScales';
import { buildPitchContractContext, contractAtBeat, classifyMelodyNoteAgainstContract, isStructuralMelodyNote, isBlueColorPc } from './pitchContract';

const m12 = (n: number) => ((n % 12) + 12) % 12;

// 跑一首 weave,统计【非 quote 的结构音】里有多少不被合同支持(应 = 0)。
function structuralUnsupportedCount(seed: number, tonality?: SandboxTonality, style: 'pop' | 'jazz' | 'rnb' | 'lofi' = 'pop'): number {
  const parent = tonality === 'majorBlues' || tonality === 'major' || !tonality ? 'major' : 'minor';
  let cap = generateSampleCaptured(96, 0, parent, seed % 4);
  if (tonality) cap = cap.map((n) => ({ ...n, midi: snapMidiToTonality(n.midi, 0, tonality) }));
  const r = generateMotifWeave({ capturedNotes: cap, style, keyPc: 0, mode: parent, bpm: 96, seed, inputTonality: tonality });
  const ctx = buildPitchContractContext({ progression: r.progression, keyPc: 0, mode: parent, inputTonality: tonality });
  let bad = 0;
  for (const n of r.lead) {
    if (n.occurrenceKind === 'quote') continue;       // quote 保留,不计入(Phase 7.1)
    if (!isStructuralMelodyNote(n)) continue;          // 只看结构音
    const contract = contractAtBeat(ctx, n.onsetBeat);
    const isBlue = tonality ? isBlueColorPc(m12(n.midi), 0, tonality) : false;
    if (classifyMelodyNoteAgainstContract({ note: n, contract, isBlue }) === 'unsupported-structural') bad++;
  }
  return bad;
}

describe('motifSandbox/contract rectify(Phase 4)', () => {
  it('★ majorBlues:生成/发展的结构音 structuralUnsupported = 0', () => {
    for (const seed of [1, 7, 42, 100, 333]) expect(structuralUnsupportedCount(seed, 'majorBlues'), `seed${seed}`).toBe(0);
  });

  it('★ minorBlues:生成/发展的结构音 structuralUnsupported = 0', () => {
    for (const seed of [2, 11, 55, 200]) expect(structuralUnsupportedCount(seed, 'minorBlues'), `seed${seed}`).toBe(0);
  });

  it('★ 非布鲁斯(major)结构音也 0(旧 nearestChordTone 至少同样严格)', () => {
    for (const seed of [1, 7, 42]) expect(structuralUnsupportedCount(seed, undefined), `seed${seed}`).toBe(0);
  });

  it('★ quote 仍原样(首个 quote occurrence 不被 rectify 改音)', () => {
    const cap = generateSampleCaptured(96, 0, 'major', 0).map((n) => ({ ...n, midi: snapMidiToTonality(n.midi, 0, 'majorBlues') }));
    const r = generateMotifWeave({ capturedNotes: cap, style: 'pop', keyPc: 0, mode: 'major', bpm: 96, seed: 7, inputTonality: 'majorBlues' });
    expect(r.audit.motifQuotedFirstCycle).toBe(true); // 第一个 quote = 原样陈述
  });
});
