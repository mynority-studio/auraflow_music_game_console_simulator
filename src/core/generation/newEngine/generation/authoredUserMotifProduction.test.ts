import { describe, expect, it } from 'vitest';
import { buildUserMotifBrickSongOverride } from '../../motifSandbox/bridge/sandboxToOverride';
import type { SandboxStyle, UserMotif } from '../../motifSandbox/model/types';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { buildMotifSongBundle, generateSongFromMotifBundle } from './generateSongFromMotif';
import { buildMgLeadRoadMap } from '../render/mgLeadRenderer';
import {
  materializeAuthoredUserMotifBrick,
  planAuthoredUserMotifBrick,
} from '../render/userMotifBrick';

const STYLES: readonly SandboxStyle[] = ['pop', 'jazz', 'lofi', 'rnb', 'acg'];

function motifForBars(bars: 1 | 2 | 3 | 4): UserMotif {
  const notes: UserMotif['notes'] = [];
  for (let bar = 0; bar < bars; bar++) {
    const start = bar * 4;
    notes.push(
      { midi: 60, onsetBeat: start, durationBeat: 1, velocity: 0.9, scaleDegree: 1, octave: 5, accent: 1, structuralToneScore: 1 },
      { midi: 64, onsetBeat: start + 1, durationBeat: 0.5, velocity: 0.72, scaleDegree: 3, octave: 5, accent: 0.45, structuralToneScore: 0.45 },
      { midi: 67, onsetBeat: start + 2, durationBeat: 1, velocity: 0.86, scaleDegree: 5, octave: 5, accent: 0.85, structuralToneScore: 0.9 },
      { midi: 64, onsetBeat: start + 3, durationBeat: 0.5, velocity: 0.7, scaleDegree: 3, octave: 5, accent: 0.4, structuralToneScore: 0.4 },
    );
  }
  return {
    id: `production-${bars}-bar`,
    keyPc: 0,
    mode: 'major',
    bpm: 96,
    notes,
    lengthBeats: bars * 4,
    contour: notes.slice(1).map((note, index) => Math.sign(note.midi - notes[index].midi)),
    rhythmCell: notes.map((note) => note.durationBeat),
    createdAt: bars,
  };
}

const noteKey = (note: { pitch: unknown; startTick: unknown; durationTicks: unknown }): string =>
  `${note.pitch as number}:${note.startTick as number}:${note.durationTicks as number}`;

describe('Q+R authored motif production RoadMap ownership', () => {
  it('1-4 小节 × 5 风格:完整 motif 等比进入唯一 owned span,最终 lead 无生成音重叠', () => {
    for (const style of STYLES) {
      for (const bars of [1, 2, 3, 4] as const) {
        const seed = 100 + STYLES.indexOf(style) * 10 + bars;
        const motif = motifForBars(bars);
        const override = buildUserMotifBrickSongOverride(motif, {
          style,
          seed,
          keyPc: motif.keyPc,
          mode: motif.mode,
          targetBars: 16,
        });
        const mb = buildMotifSongBundle({ seed, styleHint: style, mood: 'build', targetDuration: 64 }, override);
        const roadMap = buildMgLeadRoadMap(
          mb.bundle.harmonic,
          mb.bundle.band,
          mb.bundle.timebase,
          mb.bundle.acgPianoScorePlan,
        );
        const bpb = beatsPerBarOf(mb.bundle.arrangement.meter);
        const totalBeats = mb.bundle.arrangement.sections.reduce((sum, section) => sum + section.bars * bpb, 0);
        const plan = planAuthoredUserMotifBrick({
          brick: override.userBrick!,
          roadMap,
          harmonicPlan: mb.bundle.harmonic,
          totalBeats,
        });
        expect(plan, `${style}/${bars}bar plan`).toBeDefined();
        expect(plan!.notes.length, `${style}/${bars}bar planned note count`).toBe(motif.notes.length);
        expect(plan!.notes.map((note) => note.pitch), `${style}/${bars}bar pitch fidelity`)
          .toEqual(motif.notes.map((note) => note.midi));
        expect(plan!.scaleFactor, `${style}/${bars}bar scale`).toBeGreaterThanOrEqual(0.8);
        expect(plan!.scaleFactor, `${style}/${bars}bar scale`).toBeLessThanOrEqual(1.2);

        const expected = materializeAuthoredUserMotifBrick(plan, mb.bundle.timebase, {
          swingRatio: mb.bundle.arrangement.songGrooveContract.melodySwingRatio,
          beatsPerBar: bpb,
          grooveContract: mb.bundle.arrangement.songGrooveContract,
          tempoBpm: mb.bundle.arrangement.tempoBpm,
        });
        expected.forEach((note, index) => {
          const source = motif.notes[index];
          const duration = (note.durationTicks as number) / mb.bundle.timebase.ppq;
          expect(duration, `${style}/${bars}bar note ${index} duration floor`)
            .toBeGreaterThanOrEqual(source.durationBeat * 0.8 - 1 / mb.bundle.timebase.ppq);
          expect(duration, `${style}/${bars}bar note ${index} duration ceiling`)
            .toBeLessThanOrEqual(source.durationBeat * 1.2 + 1 / mb.bundle.timebase.ppq);
          if (index > 0) {
            const sourceIoi = source.onsetBeat - motif.notes[index - 1].onsetBeat;
            const actualIoi = ((note.startTick as number) - (expected[index - 1].startTick as number)) / mb.bundle.timebase.ppq;
            expect(actualIoi, `${style}/${bars}bar note ${index} IOI floor`)
              .toBeGreaterThanOrEqual(sourceIoi * 0.8 - 1 / mb.bundle.timebase.ppq);
            expect(actualIoi, `${style}/${bars}bar note ${index} IOI ceiling`)
              .toBeLessThanOrEqual(sourceIoi * 1.2 + 1 / mb.bundle.timebase.ppq);
          }
        });
        const result = generateSongFromMotifBundle(mb);
        expect(result.status, `${style}/${bars}bar status`).not.toBe('failed');
        const lead = result.ir!.tracks.find((track) => track.role === 'lead')!;
        const lo = mb.bundle.timebase.beatToTick(plan!.startBeat as never) as number;
        const hi = mb.bundle.timebase.beatToTick(plan!.endBeat as never) as number;
        const actual = lead.notes.filter((note) => (note.startTick as number) >= lo && (note.startTick as number) < hi);
        expect(actual.map(noteKey), `${style}/${bars}bar exact owned span`).toEqual(expected.map(noteKey));
        expect(mb.bundle.band.key as number, `${style}/${bars}bar key`).toBe(motif.keyPc);
        expect(mb.bundle.band.mode, `${style}/${bars}bar mode`).toBe(motif.mode);
      }
    }
  });
});
