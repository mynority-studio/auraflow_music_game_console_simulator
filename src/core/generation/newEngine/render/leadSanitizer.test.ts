import { describe, it, expect } from 'vitest';
import { sanitizeLeadNoteIR } from './leadSanitizer';
import { generateSongFromMotif } from '../generation/generateSongFromMotif';
import { generateSong } from '../generation/GenerationController';
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

// ★ renderCoordinator 末端安全闸(directive q_n_final_lead_sanitizer 2026-06-23):humanize/fill/swing/replay 后重新撞出的
//   同 pitch overlap 必须在进 IR 前清掉 —— 对【所有 style】+【所有 lead 来源】生效(此前只 jazz/blues legato 分支顺带保护)。
describe('render/leadSanitizer · renderCoordinator final safety(directive q_n_final_lead_sanitizer)', () => {
  const routeA = (style: 'pop' | 'lofi' | 'rnb' | 'jazz', seed: number, variant: number): readonly NoteIR[] => {
    const r = generateMotifWeave({ capturedNotes: generateSampleCaptured(96, 0, 'major', variant), style, keyPc: 0, mode: 'major', bpm: 96, seed });
    const song = generateSongFromMotif({ seed, styleHint: style, mood: 'build', targetDuration: 120 }, buildMotifSongOverride(r, 0, 'major'));
    return song.ir!.tracks.find((t) => t.role === 'lead')!.notes;
  };

  it('★ Phase 2 确定性复现:走 A pop seed=10 variant=1 full arrangement lead 无同 pitch overlap', () => {
    expect(samePitchOverlap(routeA('pop', 10, 1)), 'pop seed=10 v=1 overlap').toBe(0);
  });

  it('★ Phase 3 走 A fuzz:pop/lofi/rnb/jazz × seed 1..20 × variant 0..2 → 全 0 同 pitch overlap', () => {
    for (const style of ['pop', 'lofi', 'rnb', 'jazz'] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        for (const v of [0, 1, 2]) {
          expect(samePitchOverlap(routeA(style, seed, v)), `${style} seed=${seed} v=${v}`).toBe(0);
        }
      }
    }
  });

  it('★ Phase 4 默认 Q+N 不变量:generateSong(无 override)lead 也无同 pitch overlap', () => {
    for (const style of ['pop', 'lofi', 'rnb', 'jazz'] as const) {
      for (const seed of [1, 2, 3, 7, 10, 17, 31]) {
        const lead = generateSong({ seed, styleHint: style, mood: 'build', targetDuration: 120 }).ir!.tracks.find((t) => t.role === 'lead');
        if (lead) expect(samePitchOverlap(lead.notes), `default ${style} seed=${seed}`).toBe(0);
      }
    }
  });
});
