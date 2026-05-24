// Hemiola — 3-against-4 cross-rhythm(Jazz_Waltz_Hemiola)
import type { ChordDef } from '../../types/ChordDef';
import type { NoteEvent, HemiolaParams } from '../types';
import type { Random } from '../../utils/Random';
import * as P from '../PitchPrimitives';

export function applyHemiola(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: HemiolaParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);
    const cM = P.chordVoicing(chord);

    out.push({ noteNumber: bM, time: startBeat, duration, velocity: 0.8 * 127, part: 'bass' });

    for (const t of params.hemiola_points) {
        if (t < duration) {
            for (const m of cM) {
                out.push({
                    noteNumber: m,
                    time: startBeat + t,
                    duration: 0.5,
                    velocity: params.velocity * 127,
                    part: 'accomp',
                });
            }
        }
    }
    return out;
}
