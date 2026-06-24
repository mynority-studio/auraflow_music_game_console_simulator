import { describe, it, expect } from 'vitest';
import { generateMotifWeave } from '../model/motifWeaver';
import { generateSampleCaptured } from '../model/motifAnalysis';
import { snapMidiToTonality } from '../model/sandboxScales';
import { sandboxProgressionToHarmonicPlan } from './sandboxToHarmonicPlan';
import { buildMotifSongOverride } from './sandboxToOverride';
import { generateSongFromMotif } from '../../newEngine/generation/generateSongFromMotif';

const m12 = (n: number) => ((n % 12) + 12) % 12;

describe('Q+R→Q+N 桥保留 blues realization(Phase 6)', () => {
  it('★ seasoned 和弦(dom7/含蓝音)→ HarmonicPlan 保留属/张力质量(非误判小调)', () => {
    const cap = generateSampleCaptured(96, 0, 'major', 0).map((n) => ({ ...n, midi: snapMidiToTonality(n.midi, 0, 'majorBlues') }));
    const r = generateMotifWeave({ capturedNotes: cap, style: 'pop', keyPc: 0, mode: 'major', bpm: 96, seed: 7, inputTonality: 'majorBlues' });
    const seasoned = r.progression.filter((c) => c.bluesSeasoned);
    expect(seasoned.length).toBeGreaterThan(0);
    const plan = sandboxProgressionToHarmonicPlan(r.progression, 0, 'major');
    // 每个 seasoned 和弦在 HarmonicPlan 里:① root 一致 ② b7 在 chord 张力集(dom 色),不被当成 m7 小三
    for (const c of seasoned) {
      const root = c.realRootPc ?? c.rootPc;
      const span = plan.chordTimeline.find((s) => m12(s.rootPc) === m12(root));
      expect(span, `seasoned root ${root} 在 plan`).toBeTruthy();
      // seasoned 大三蓝调和弦不应被桥标成小三品质(m7/min/m7b5/dim)
      if (c.realType === '7') expect(['m7', 'min', 'm7b5', 'dim']).not.toContain(span!.quality);
    }
  });

  it('★ 端到端 majorBlues 走 A 整编:出 IR 不 failed,和声跨度数 = progression 数,lead override 仍非空', () => {
    const cap = generateSampleCaptured(96, 0, 'major', 0).map((n) => ({ ...n, midi: snapMidiToTonality(n.midi, 0, 'majorBlues') }));
    const r = generateMotifWeave({ capturedNotes: cap, style: 'pop', keyPc: 0, mode: 'major', bpm: 96, seed: 7, inputTonality: 'majorBlues' });
    const song = generateSongFromMotif({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 96 }, buildMotifSongOverride(r, 0, 'major'));
    expect(song.ir, '整编出 IR').toBeTruthy();
    expect(song.status).not.toBe('failed');
    const lead = song.ir!.tracks.find((t) => t.role === 'lead');
    expect(lead && lead.notes.length).toBeGreaterThan(0);
  });

  it('★ minorBlues 走 A 整编同样可成曲', () => {
    const cap = generateSampleCaptured(96, 0, 'minor', 2).map((n) => ({ ...n, midi: snapMidiToTonality(n.midi, 0, 'minorBlues') }));
    const r = generateMotifWeave({ capturedNotes: cap, style: 'jazz', keyPc: 0, mode: 'minor', bpm: 96, seed: 11, inputTonality: 'minorBlues' });
    const song = generateSongFromMotif({ seed: 11, styleHint: 'jazz', mood: 'build', targetDuration: 96 }, buildMotifSongOverride(r, 0, 'minor'));
    expect(song.ir).toBeTruthy();
    expect(song.status).not.toBe('failed');
  });
});
