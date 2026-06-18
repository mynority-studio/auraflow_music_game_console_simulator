import { describe, it, expect } from 'vitest';
import { buildMotifSongOverride, motifNoteToLeadNote } from './sandboxToOverride';
import { generateMotifWeave } from '../model/motifWeaver';
import { generateSampleCaptured } from '../model/motifAnalysis';
import { generateSongFromMotif } from '../../newEngine/generation/generateSongFromMotif';

const m12 = (n: number) => ((n % 12) + 12) % 12;
const weave = (style: 'pop' | 'jazz' = 'pop', seed = 7) =>
  generateMotifWeave({ capturedNotes: generateSampleCaptured(96, 0, 'major', 0), style, keyPc: 0, mode: 'major', bpm: 96, seed });

describe('motifSandbox/bridge sandboxToOverride(走 A PR3 · 整曲 override)', () => {
  it('★ motifNoteToLeadNote:midi→pitch、velocity 0..1 → 1..127、拍位/时值保留', () => {
    const ln = motifNoteToLeadNote({ midi: 67, onsetBeat: 2.5, durationBeat: 1.5, velocity: 0.8, scaleDegree: 5, octave: 5, accent: 0.7 });
    expect(ln.pitch).toBe(67);
    expect(ln.onsetBeat).toBe(2.5);
    expect(ln.durationBeat).toBe(1.5);
    expect(ln.velocity).toBe(Math.round(0.8 * 127));
  });

  it('★ buildMotifSongOverride:weave 结果 → {harmony, lead} 合同(harmony 对齐 progression,lead 逐音映射)', () => {
    const r = weave('pop', 7);
    const ov = buildMotifSongOverride(r, 0, 'major');
    expect(ov.harmony!.chordTimeline.length).toBe(r.progression.length);
    expect(ov.lead!.length).toBe(r.lead.length);
    expect(ov.lead![0].pitch).toBe(Math.round(r.lead[0].midi));
  });

  it('★ 端到端走 A:Q+R weave → override → generateSongFromMotif 成曲(lead==我们的 motif lead,bass 吃 sandbox 和声)', () => {
    const r = weave('pop', 7);
    const ov = buildMotifSongOverride(r, 0, 'major');
    const song = generateSongFromMotif({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 120 }, ov);
    expect(song.status).not.toBe('failed');

    // lead 轨 = 我们的 motif lead(音高逐音原样,证明 renderMgMelody 让位)
    const lead = song.ir!.tracks.find((t) => t.role === 'lead')!;
    expect(lead.notes.map((n) => n.pitch)).toEqual(ov.lead!.map((n) => n.pitch));

    // bass 轨吃 sandbox 和声(首音根/三/五)
    const bass = song.ir!.tracks.find((t) => t.role === 'bass');
    if (bass && bass.notes.length) {
      const rootPc = m12(r.progression[0].realRootPc ?? r.progression[0].rootPc);
      expect([rootPc, m12(rootPc + 3), m12(rootPc + 4), m12(rootPc + 7)]).toContain(m12(bass.notes[0].pitch));
    }
  });

  it('★ 默认 generateSong 链不被 override 影响(无 override 仍与默认一致由 generateSongFromMotif.test 锁;此处确认 override 不抛)', () => {
    const r = weave('jazz', 3);
    const ov = buildMotifSongOverride(r, 0, 'major');
    expect(() => generateSongFromMotif({ seed: 3, styleHint: 'jazz', mood: 'x', targetDuration: 120 }, ov)).not.toThrow();
  });
});
