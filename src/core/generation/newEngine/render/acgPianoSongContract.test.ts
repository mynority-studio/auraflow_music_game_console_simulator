import { describe, expect, it } from 'vitest';
import { pc } from '../foundation';
import { buildSongBundle, generateSongFromBundle } from '../generation/GenerationController';

describe('render/acgPianoSongContract · three-hand piano score', () => {
  it('minor piano cue executes its arranger-owned score spans, including intentional comp silence', () => {
    for (const seed of [3, 7, 42, 128]) {
      const bundle = buildSongBundle({
        seed,
        styleHint: 'acg',
        mood: 'lyrical',
        targetDuration: 90,
        key: pc(0),
        mode: 'minor',
      });
      const result = generateSongFromBundle(bundle);
      expect(result.ir, `seed ${seed} should render`).toBeDefined();
      const tracks = result.ir!.tracks;
      const bass = tracks.find((track) => track.role === 'bass')!;
      const comp = tracks.find((track) => track.role === 'comp')!;
      const lead = tracks.find((track) => track.role === 'lead')!;
      const score = bundle.acgPianoScorePlan;
      expect(score, `seed ${seed} production ACG score`).toBeDefined();

      for (const scoreSpan of Object.values(score!.spanById)) {
        const span = bundle.harmonic.chordTimeline.find((candidate) => candidate.id === scoreSpan.spanId);
        expect(span, `seed ${seed} score span ${scoreSpan.spanId} harmonic source`).toBeDefined();
        if (!span) continue;

        const lo = (span.startBeat as number) * bundle.timebase.ppq;
        const hi = lo + (span.durationBeats as number) * bundle.timebase.ppq;
        const bassHere = bass.notes.filter((note) => {
          const start = note.startTick as number;
          const end = start + (note.durationTicks as number);
          return start < hi && end > lo;
        });
        const compHere = comp.notes.filter((note) => {
          const start = note.startTick as number;
          const end = start + (note.durationTicks as number);
          return start < hi && end > lo;
        });
        expect(bassHere.length, `seed ${seed} score span ${scoreSpan.spanId} low root`).toBeGreaterThan(0);
        if (scoreSpan.comp.gesture === 'tacet') {
          expect(compHere.length, `seed ${seed} score span ${scoreSpan.spanId} planned tacet`).toBe(0);
        } else {
          expect(compHere.length, `seed ${seed} score span ${scoreSpan.spanId} planned ${scoreSpan.comp.gesture}`).toBeGreaterThan(0);
        }

        // ACG PIANOSONG 的低音不是泛化节奏贝斯：每个 score span 的一拍内必须确立当前和声根。
        const rootPc = ((span.rootPc as number) % 12 + 12) % 12;
        const rootAnchor = bass.notes.some((note) => {
          const start = note.startTick as number;
          return start >= lo - bundle.timebase.ppq * 0.25
            && start < lo + bundle.timebase.ppq
            && (((note.pitch as number) % 12 + 12) % 12) === rootPc;
        });
        expect(rootAnchor, `seed ${seed} score span ${scoreSpan.spanId} root anchor`).toBe(true);

        const leadHere = lead.notes.filter((note) => {
          const start = note.startTick as number;
          const end = start + (note.durationTicks as number);
          return start < hi && end > lo;
        });
        if (leadHere.length === 0 || compHere.length === 0) continue;
        const ceiling = Math.min(67, Math.min(...leadHere.map((note) => note.pitch as number)) - 3);
        expect(Math.max(...compHere.map((note) => note.pitch as number)), `seed ${seed} score span ${scoreSpan.spanId} comp must not become a second top line`)
          .toBeLessThanOrEqual(ceiling);
      }
    }
  });
});
