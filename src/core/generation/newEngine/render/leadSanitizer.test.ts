import { describe, it, expect } from 'vitest';
import { sanitizeLeadNoteIR } from './leadSanitizer';
import { generateSongFromMotif } from '../generation/generateSongFromMotif';
import { buildMotifSongOverride } from '../../motifSandbox/bridge/sandboxToOverride';
import { generateMotifWeave } from '../../motifSandbox/model/motifWeaver';
import { generateSampleCaptured } from '../../motifSandbox/model/motifAnalysis';
import { midi, ticks } from '../foundation';
import type { NoteIR } from '../ir/MusicalIR';

const n = (pitch: number, startTick: number, durationTicks: number, velocity = 90): NoteIR =>
  ({ pitch: midi(pitch), startTick: ticks(startTick), durationTicks: ticks(durationTicks), velocity });

/** 同 pitch overlap 对数(含同 startTick 同 pitch)。 */
const samePitchOverlap = (notes: readonly NoteIR[]): number => {
  const ns = [...notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
  let c = 0;
  for (let i = 0; i < ns.length; i++) {
    const iEnd = (ns[i].startTick as number) + (ns[i].durationTicks as number);
    for (let j = i + 1; j < ns.length; j++) {
      const js = ns[j].startTick as number;
      if (js >= iEnd) break;
      if ((ns[j].pitch as number) === (ns[i].pitch as number)) c++;
    }
  }
  return c;
};

describe('render/leadSanitizer · 单声部 tick 域清洗(directive Phase 4)', () => {
  it('§4:同 startTick + 同 pitch 合并为一(取较长 dur)', () => {
    // 77@tick23040 dur14(短 develop)+ 77@tick23040 dur432(长 connect)
    const out = sanitizeLeadNoteIR([n(77, 23040, 14), n(77, 23040, 432)]);
    expect(out.length).toBe(1);
    expect(out[0].durationTicks).toBe(432); // 取长
    expect(out[0].pitch).toBe(77);
    expect(out[0].startTick).toBe(23040);
  });

  it('同 pitch overlap(不同 start)→ 前音裁到 nextStart-1tick;不同 pitch overlap 保留', () => {
    const out = sanitizeLeadNoteIR([n(60, 0, 300), n(60, 240, 200), n(62, 0, 300)]);
    const first60 = out.find((x) => (x.pitch as number) === 60 && (x.startTick as number) === 0)!;
    expect(first60.durationTicks).toBe(239); // 240 - 1 gap
    expect(samePitchOverlap(out)).toBe(0);
    expect(out.length).toBe(3); // 不同 pitch(62)overlap 保留
  });

  it('空/单音安全', () => {
    expect(sanitizeLeadNoteIR([])).toEqual([]);
    expect(sanitizeLeadNoteIR([n(60, 0, 100)]).length).toBe(1);
  });

  it('★ Phase 4 走 A:Q+R pop seed=2 variant=1 → generateSongFromMotif lead 无同 pitch overlap', () => {
    const r = generateMotifWeave({ capturedNotes: generateSampleCaptured(96, 0, 'major', 1), style: 'pop', keyPc: 0, mode: 'major', bpm: 96, seed: 2 });
    const ov = buildMotifSongOverride(r, 0, 'major');
    const song = generateSongFromMotif({ seed: 2, styleHint: 'pop', mood: 'build', targetDuration: 120 }, ov);
    const lead = song.ir!.tracks.find((t) => t.role === 'lead')!;
    expect(samePitchOverlap(lead.notes), 'lead 同 pitch overlap=0').toBe(0);
  });
});
