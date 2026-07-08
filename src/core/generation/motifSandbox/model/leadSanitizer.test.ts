import { describe, it, expect } from 'vitest';
import { sanitizeMotifLeadNotes } from './leadSanitizer';
import { generateMotifWeave } from './motifWeaver';
import { generateSampleCaptured } from './motifAnalysis';
import { buildLeadOnlyIr } from './leadOnlyIr';
import { fitRange, identity } from './motifTransform';
import { quotedAt } from './jazzinessAudit';
import type { MotifNote } from './types';
import type { NoteIR as IRNote } from '../../newEngine/ir/MusicalIR';

const mn = (midi: number, onsetBeat: number, durationBeat: number, kind: MotifNote['occurrenceKind'] = 'connect', velocity = 0.8): MotifNote =>
  ({ midi, onsetBeat, durationBeat, velocity, scaleDegree: 1, octave: 5, accent: 0.5, structuralToneScore: 0.5, occurrenceKind: kind });

const sameOnsetPitch = (notes: readonly MotifNote[]): number => {
  let c = 0;
  for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++)
    if (notes[i].midi === notes[j].midi && Math.abs(notes[i].onsetBeat - notes[j].onsetBeat) < 1e-6) c++;
  return c;
};
const irSamePitchOverlap = (notes: readonly IRNote[]): number => {
  const ns = [...notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
  let c = 0;
  for (let i = 0; i < ns.length; i++) {
    const iEnd = (ns[i].startTick as number) + (ns[i].durationTicks as number);
    for (let j = i + 1; j < ns.length; j++) {
      if ((ns[j].startTick as number) >= iEnd) break;
      if ((ns[j].pitch as number) === (ns[i].pitch as number)) c++;
    }
  }
  return c;
};

describe('motifSandbox/leadSanitizer · beat 域单声部清洗(directive Phase 3)', () => {
  it('同 onset+同 midi 合并:取长 dur、大 vel、quote 优先', () => {
    const out = sanitizeMotifLeadNotes([mn(77, 48, 0.125, 'develop', 0.6), mn(77, 48, 0.9, 'connect', 0.9)]);
    expect(out.length).toBe(1);
    expect(out[0].durationBeat).toBeCloseTo(0.9, 6);   // 取长
    expect(out[0].velocity).toBeCloseTo(0.9, 6);        // 取大
  });

  it('quote 优先级:quote + connect 同 onset → 结果 occurrenceKind=quote(审计不误报)', () => {
    const out = sanitizeMotifLeadNotes([mn(60, 0, 0.5, 'connect'), mn(60, 0, 0.25, 'quote')]);
    expect(out.length).toBe(1);
    expect(out[0].occurrenceKind).toBe('quote');
  });

  it('同 pitch overlap(不同 onset)→ 前音裁到 nextStart-gap', () => {
    const out = sanitizeMotifLeadNotes([mn(64, 0, 1.0), mn(64, 0.5, 0.5)]);
    const first = out.find((x) => Math.abs(x.onsetBeat) < 1e-6)!;
    expect(first.durationBeat).toBeLessThanOrEqual(0.5); // 裁到 ≤ 0.5 - gap
  });

  it('★ Phase 3:pop seed=2 variant=1 → finalLead 无同 onset+同 pitch;buildLeadOnlyIr lead 无同 pitch overlap', () => {
    const r = generateMotifWeave({ capturedNotes: generateSampleCaptured(96, 0, 'major', 1), style: 'pop', keyPc: 0, mode: 'major', bpm: 96, seed: 2 });
    expect(sameOnsetPitch(r.lead), 'finalLead 同 onset+pitch=0').toBe(0);
    const ir = buildLeadOnlyIr(r.lead, 120, 'pop');
    expect(irSamePitchOverlap(ir.tracks[0].notes), 'preview lead 同 pitch overlap=0').toBe(0);
  });

  it('★ quote 回归(缩减 fuzz):多风格/种子 quote slot 首音存在 + lead 无同 pitch overlap', () => {
    for (const style of ['pop', 'jazz', 'lofi', 'rnb', 'acg'] as const) {
      for (let seed = 1; seed <= 8; seed++) {
        for (const variant of [0, 1, 2, 3]) {
          const r = generateMotifWeave({ capturedNotes: generateSampleCaptured(96, 0, 'major', variant), style, keyPc: 0, mode: 'major', bpm: 96, seed });
          // 曲首主题陈述:ref motif 在 beat0 完整 quote(不丢第一个用户音)
          const ref = fitRange(identity(r.motif.notes), 60, 84).filter((x) => x.onsetBeat < r.quoteBars * 4 - 1e-6);
          expect(quotedAt(r.lead, ref, 0), `${style} seed${seed} v${variant} 曲首陈述`).toBe(true);
          expect(sameOnsetPitch(r.lead), `${style} seed${seed} v${variant} 无同 onset+pitch`).toBe(0);
          expect(irSamePitchOverlap(buildLeadOnlyIr(r.lead, 120, style).tracks[0].notes), `${style} seed${seed} v${variant} IR 无 overlap`).toBe(0);
        }
      }
    }
  });
});
