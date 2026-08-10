import { describe, it, expect } from 'vitest';
import { buildMotifBrickSongOverride, buildMotifSongOverride, buildUserMotifBrickSongOverride, motifNoteToLeadNote } from './sandboxToOverride';
import { generateMotifWeave } from '../model/motifWeaver';
import { generateSampleCaptured } from '../model/motifAnalysis';
import {
  buildMotifSongBundle,
  generateSongFromMotif,
  generateSongFromMotifBundle,
} from '../../newEngine/generation/generateSongFromMotif';
import { generateSong } from '../../newEngine/generation/GenerationController';
import { beats, pc } from '../../newEngine/foundation';
import { fitMidiToProgramRange } from '../../newEngine/knowledge/instruments';
import { leadCompWetEnergyRatio } from '../../newEngine/render/renderMixBalance';
import { buildMgLeadRoadMap } from '../../newEngine/render/mgLeadRenderer';
import { authoredMotifSectionInfos, planAuthoredUserMotifBrick } from '../../newEngine/render/userMotifBrick';
import type { TrackIR } from '../../newEngine/ir/MusicalIR';
import type { SandboxStyle, UserMotif } from '../model/types';

const m12 = (n: number) => ((n % 12) + 12) % 12;
const weave = (style: SandboxStyle = 'pop', seed = 7) =>
  generateMotifWeave({ capturedNotes: generateSampleCaptured(96, 0, 'major', 0), style, keyPc: 0, mode: 'major', bpm: 96, seed });
const fittedLeadPitches = (lead: readonly { pitch: number }[], program: number): number[] =>
  lead.map((n) => fitMidiToProgramRange(n.pitch, 'lead', program));
const fitMidiToDutyRegister = (pitch: number, range: { lowMidi: number; highMidi: number }): number => {
  let fitted = Math.round(pitch);
  while (fitted > range.highMidi) fitted -= 12;
  while (fitted < range.lowMidi) fitted += 12;
  if (fitted < range.lowMidi || fitted > range.highMidi) {
    return Math.abs(fitted - range.lowMidi) <= Math.abs(fitted - range.highMidi)
      ? range.lowMidi
      : range.highMidi;
  }
  return fitted;
};
const beatOf = (tick: unknown, ppq: number): number => (tick as number) / ppq;

function expectHarmonySafeProjection(
  actual: readonly number[],
  fittedSource: readonly number[],
  findings: readonly { severity: string; location: { trackRole: string } }[],
): void {
  expect(actual.length).toBe(fittedSource.length);
  const changed = actual
    .map((pitch, index) => ({ pitch, source: fittedSource[index] }))
    .filter(({ pitch, source }) => pitch !== source);
  // Harmony-first may micro-project an illegal structural landing, but it must remain a
  // local correction rather than rewriting the user-authored line.
  expect(changed.length).toBeLessThanOrEqual(Math.max(1, Math.ceil(actual.length * 0.05)));
  for (const { pitch, source } of changed) expect(Math.abs(pitch - source)).toBeLessThanOrEqual(2);
  expect(findings.filter((finding) => finding.location.trackRole === 'lead'
    && (finding.severity === 'error' || finding.severity === 'fatal'))).toEqual([]);
}

function strongFirstPhraseMotif(): UserMotif {
  return {
    id: 'strong-first-phrase',
    keyPc: 0,
    mode: 'major',
    bpm: 96,
    lengthBeats: 4,
    createdAt: 0,
    contour: [1, -1],
    rhythmCell: [2, 1, 1],
    notes: [
      { midi: 65, onsetBeat: 0, durationBeat: 2, velocity: 0.95, scaleDegree: 4, octave: 5, accent: 1, structuralToneScore: 1 },
      { midi: 69, onsetBeat: 2, durationBeat: 1, velocity: 0.9, scaleDegree: 6, octave: 5, accent: 0.9, structuralToneScore: 0.9 },
      { midi: 67, onsetBeat: 3, durationBeat: 1, velocity: 0.8, scaleDegree: 5, octave: 5, accent: 0.7, structuralToneScore: 0.65 },
    ],
  };
}

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

  it('★ buildMotifBrickSongOverride:产品播放只传 userBrick,不传 sandbox 整条 lead/harmony', () => {
    const r = weave('pop', 7);
    const ov = buildMotifBrickSongOverride(r);
    expect(ov.harmony).toBeUndefined();
    expect(ov.lead).toBeUndefined();
    expect(ov.userBrick?.notes.length).toBe(r.motif.notes.length);
    expect(ov.userBrick?.quoteBeats).toBe(Math.min(r.motif.lengthBeats, r.quoteBars * 4));
  });

  it('★ buildUserMotifBrickSongOverride:无产品参数时仅接入 Q+N userBrick(兼容旧调试调用)', () => {
    const r = weave('pop', 7);
    const ov = buildUserMotifBrickSongOverride(r.motif);
    expect(ov.harmony).toBeUndefined();
    expect(ov.lead).toBeUndefined();
    expect(ov.userBrick?.notes[0].pitch).toBe(Math.round(r.motif.notes[0].midi));
    expect(ov.userBrick?.quoteBeats).toBeLessThanOrEqual(r.motif.lengthBeats);
  });

  it('★ 产品参数:bridge 不再派发 anchor,生产 Functional RoadMap 决定唯一 authored brick', () => {
    const motif = strongFirstPhraseMotif();
    const ov = buildUserMotifBrickSongOverride(motif, { style: 'pop', seed: 7, keyPc: 0, mode: 'major' });
    expect(ov.harmony).toBeDefined();
    expect(ov.lead).toBeUndefined();
    expect('anchorBeats' in ov.userBrick!).toBe(false);
    expect(ov.userBrick?.quoteBeats).toBe(motif.lengthBeats);
    const mb = buildMotifSongBundle({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 96 }, ov);
    const roadMap = buildMgLeadRoadMap(mb.bundle.harmonic, mb.bundle.band, mb.bundle.timebase, mb.bundle.acgPianoScorePlan);
    const totalBeats = (mb.bundle.timebase.beatToTick(beats(0)) as number)
      + mb.bundle.arrangement.sections.reduce((sum, section) => sum + section.bars * mb.bundle.arrangement.meter.numerator, 0);
    const planned = planAuthoredUserMotifBrick({
      brick: ov.userBrick!, roadMap, harmonicPlan: mb.bundle.harmonic, totalBeats,
      sections: authoredMotifSectionInfos(mb.bundle.arrangement.sections, mb.bundle.arrangement.meter.numerator),
    })!;
    expect(planned.roadMapBrickIndices.length).toBeGreaterThanOrEqual(1);
    expect(planned.endBeat).toBeGreaterThan(planned.startBeat);
    expect(planned.harmonicSupportRatio).toBeGreaterThan(0.6);
    expect(planned.notes.map((note) => note.pitch)).toEqual(motif.notes.map((note) => note.midi));
  });

  it('★ 端到端:生产 RoadMap owned span 中只有完整等比 motif,音高不再按音色改写', () => {
    const motif = strongFirstPhraseMotif();
    const ov = buildUserMotifBrickSongOverride(motif, { style: 'pop', seed: 7, keyPc: 0, mode: 'major' });
    const mb = buildMotifSongBundle({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 96 }, ov);
    const roadMap = buildMgLeadRoadMap(mb.bundle.harmonic, mb.bundle.band, mb.bundle.timebase, mb.bundle.acgPianoScorePlan);
    const totalBeats = mb.bundle.arrangement.sections.reduce((sum, section) => sum + section.bars * mb.bundle.arrangement.meter.numerator, 0);
    // 镜像生产落位:renderCoordinator 同样传 sections(段落亲和),推导必须一致
    const planned = planAuthoredUserMotifBrick({
      brick: ov.userBrick!, roadMap, harmonicPlan: mb.bundle.harmonic, totalBeats,
      sections: authoredMotifSectionInfos(mb.bundle.arrangement.sections, mb.bundle.arrangement.meter.numerator),
    })!;
    const song = generateSongFromMotifBundle(mb);
    expect(song.status).not.toBe('failed');
    const lead = song.ir!.tracks.find((t) => t.role === 'lead')!;
    const ppq = song.ir!.timebase.ppq;
    const quote = lead.notes
      .filter((n) => beatOf(n.startTick, ppq) >= planned.startBeat - 0.05 && beatOf(n.startTick, ppq) < planned.endBeat - 1e-6)
      .sort((a, b) => (a.startTick as number) - (b.startTick as number));
    expect(quote.length).toBe(motif.notes.length);
    quote.forEach((n, index) => {
      expect(beatOf(n.startTick, ppq)).toBeCloseTo(planned.notes[index].onsetBeat, 1);
      expect(beatOf(n.durationTicks, ppq)).toBeCloseTo(planned.notes[index].durationBeat, 1);
    });
    expect(quote.map((n) => n.pitch)).toEqual(ov.userBrick!.notes.map((note) => note.pitch));
    expect(mb.bundle.band.key).toBe(pc(motif.keyPc));
    expect(mb.bundle.band.mode).toBe(motif.mode);
  });

  it('★ 端到端走 A:Q+R weave → override → generateSongFromMotif 成曲(lead 吃 motif+音区,bass 吃 sandbox 和声)', () => {
    const r = weave('pop', 7);
    const ov = buildMotifSongOverride(r, 0, 'major');
    const song = generateSongFromMotif({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 120 }, ov);
    expect(song.status).not.toBe('failed');

    // lead 轨 = Q+R motif lead(tile 满全曲);音高按最终器配音色折回,证明 renderMgMelody 让位且消费 Aura25 合同。
    const lead = song.ir!.tracks.find((t) => t.role === 'lead')!;
    expect(lead.notes.length).toBeGreaterThanOrEqual(ov.lead!.length);
    expectHarmonySafeProjection(
      lead.notes.slice(0, ov.lead!.length).map((n) => n.pitch as number),
      fittedLeadPitches(ov.lead!, lead.program!),
      song.report.findings,
    );

    // bass 可能按 openingGesture 延迟进入；首音应服从它实际落到的 sandbox 和弦，
    // 不能再机械拿曲首和弦校验。
    const bass = song.ir!.tracks.find((t) => t.role === 'bass');
    if (bass && bass.notes.length) {
      const beat = beatOf(bass.notes[0].startTick, song.ir!.timebase.ppq);
      const span = ov.harmony!.chordTimeline.find((chord) => beat >= (chord.startBeat as number)
        && beat < (chord.startBeat as number) + (chord.durationBeats as number));
      expect(span).toBeDefined();
      expect(ov.harmony!.stableToneMap[span!.id]).toContain(m12(bass.notes[0].pitch));
    }
  });

  it('★ 默认 generateSong 链不被 override 影响(无 override 仍与默认一致由 generateSongFromMotif.test 锁;此处确认 override 不抛)', () => {
    const r = weave('jazz', 3);
    const ov = buildMotifSongOverride(r, 0, 'major');
    expect(() => generateSongFromMotif({ seed: 3, styleHint: 'jazz', mood: 'x', targetDuration: 120 }, ov)).not.toThrow();
  });

  it('★ pop 走 A:轻力度用户 motif 整编后 lead 不被 comp 盖住', () => {
    const captured = generateSampleCaptured(96, 0, 'major', 0)
      .map((n) => ({ ...n, velocity: Math.max(1, Math.round(n.velocity * 0.4)) }));
    const r = generateMotifWeave({ capturedNotes: captured, style: 'pop', keyPc: 0, mode: 'major', bpm: 96, seed: 7 });
    const ov = buildMotifSongOverride(r, 0, 'major');
    const leadAvg = ov.lead!.reduce((sum, n) => sum + n.velocity, 0) / ov.lead!.length;

    expect(leadAvg).toBeGreaterThanOrEqual(88);

    const song = generateSongFromMotif({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 96 }, ov);
    const ratio = leadCompWetEnergyRatio(song.ir!.tracks as TrackIR[], {
      style: 'pop',
      ppq: song.ir!.timebase.ppq,
      durationTicks: song.ir!.durationTicks as number,
    });

    expect(ratio).toBeGreaterThanOrEqual(1.2);
  });

  // —— PR4 端到端验收:曲长对齐(tile)+ 各轨覆盖全曲 + 不 failed ——
  const STYLES: ReadonlyArray<readonly [SandboxStyle, number]> = [['pop', 7], ['jazz', 3], ['lofi', 3], ['rnb', 5], ['acg', 11]];

  it('★ PR4:5 风格走 A 成曲不 failed,lead=tile 的 motif lead(首音按音色折回),bass/comp 非空', () => {
    for (const [style, seed] of STYLES) {
      const r = weave(style, seed);
      const ov = buildMotifSongOverride(r, 0, 'major');
      const motifBundle = buildMotifSongBundle({ seed, styleHint: style, mood: 'build', targetDuration: 120 }, ov);
      const song = generateSongFromMotifBundle(motifBundle);
      expect(song.status, `${style} status`).not.toBe('failed');
      expect(song.ir, `${style} ir`).toBeDefined();
      const lead = song.ir!.tracks.find((t) => t.role === 'lead')!;
      expect(lead.notes.length, `${style} lead≥motif`).toBeGreaterThanOrEqual(ov.lead!.length); // tile ≥ 1 份
      const programFitted = fitMidiToProgramRange(ov.lead![0].pitch, 'lead', lead.program!);
      const strictLeadRegister = motifBundle.bundle.instrumentation.strictRegisterByRole?.lead;
      const expectedFirstPitch = strictLeadRegister
        ? fitMidiToDutyRegister(programFitted, strictLeadRegister)
        : programFitted;
      expect(lead.notes[0].pitch, `${style} lead 首音`).toBe(expectedFirstPitch); // 所有风格均先服从最终职责音区
      expect(song.ir!.tracks.find((t) => t.role === 'bass')!.notes.length, `${style} bass`).toBeGreaterThan(0);
      expect(song.ir!.tracks.find((t) => t.role === 'comp')!.notes.length, `${style} comp`).toBeGreaterThan(0);
    }
  });

  it('★ PR6 收口:motif lead 节奏原样,音高按最终音色折回(无 humanize;pop 无 swing)', () => {
    const r = weave('pop', 7);
    const ov = buildMotifSongOverride(r, 0, 'major');
    const song = generateSongFromMotif({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 96 }, ov);
    const lead = song.ir!.tracks.find((t) => t.role === 'lead')!;
    const tb = song.ir!.timebase;
    const expectedPitch = fittedLeadPitches(ov.lead!, lead.program!);
    for (let i = 0; i < ov.lead!.length; i++) {
      expect(lead.notes[i].startTick, `lead[${i}] startTick`).toBe(tb.beatToTick(beats(ov.lead![i].onsetBeat))); // 时序原样
    }
    expectHarmonySafeProjection(
      lead.notes.slice(0, ov.lead!.length).map((n) => n.pitch as number),
      expectedPitch,
      song.report.findings,
    );
  });

  it('★ PR4:走 A 编制与默认 generateSong 一致；各风格 bass/comp 持续覆盖后段', () => {
    for (const [style, seed] of STYLES) {
      const def = generateSong({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
      const r = weave(style, seed);
      const ov = buildMotifSongOverride(r, 0, 'major');
      const motifBundle = buildMotifSongBundle({ seed, styleHint: style, mood: 'build', targetDuration: 120 }, ov);
      const mot = generateSongFromMotifBundle(motifBundle);
      const roles = (x: typeof def) => x.ir!.tracks.map((t) => t.role).sort();
      expect(roles(mot), `${style} 编制`).toEqual(roles(def)); // 同编制(走 A 不丢轨)
      const dur = mot.ir!.durationTicks as unknown as number;
      // bass/comp 覆盖全曲后段(末音 ≥75%)，无大段空轨。
      for (const role of ['bass', 'comp'] as const) {
        const t = mot.ir!.tracks.find((x) => x.role === role);
        if (t && t.notes.length) {
          const end = Math.max(...t.notes.map((n) => (n.startTick as unknown as number) + (n.durationTicks as unknown as number)));
          expect(end / dur, `${style} ${role} 覆盖`).toBeGreaterThan(0.75);
        }
      }
    }
  });
});
