import { describe, expect, it } from 'vitest';
import { generateSong } from '../generation/GenerationController';
import { placeMelodyOctaveContinuously } from './mgLeadRenderer';

describe('render/mgLeadRenderer · producer-side octave continuity', () => {
  it('keeps pitch class and folds only accidental octave-plus register jumps', () => {
    const events = [
      { noteNumber: 60, time: 0, duration: 1, velocity: 80, part: 'melody' as const },
      { noteNumber: 85, time: 1, duration: 1, velocity: 80, part: 'melody' as const },
      { noteNumber: 74, time: 2, duration: 1, velocity: 80, part: 'melody' as const },
    ];
    const out = placeMelodyOctaveContinuously(events, 'POP');
    expect(out.map((event) => event.noteNumber)).toEqual([60, 61, 62]);
    expect(out.map((event, index) => ((event.noteNumber - events[index].noteNumber) % 12 + 12) % 12))
      .toEqual([0, 0, 0]);
  });

  it('removes octave-plus consecutive leaps from POP/LOFI/RNB representative seeds', () => {
    for (const style of ['pop', 'lofi', 'rnb']) {
      for (let seed = 0; seed < 23; seed++) {
        const result = generateSong({ seed, styleHint: style, mood: 'build', targetDuration: 90 });
        expect(result.ir, `${style}/${seed} no IR`).toBeTruthy();
        const lead = result.ir!.tracks.find((track) => track.role === 'lead');
        expect(lead, `${style}/${seed} no lead`).toBeTruthy();
        const notes = [...lead!.notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
        for (let index = 1; index < notes.length; index++) {
          expect(
            Math.abs((notes[index].pitch as number) - (notes[index - 1].pitch as number)),
            `${style}/${seed} lead leap at ${index}: ${notes[index - 1].pitch as number}@${notes[index - 1].startTick as number} -> ${notes[index].pitch as number}@${notes[index].startTick as number}`,
          ).toBeLessThanOrEqual(12);
        }
      }
    }
  });
});
