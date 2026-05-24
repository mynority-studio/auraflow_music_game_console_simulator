// JazzCharleston — (0, 0.5) + (1.66, 0.34) Charleston rhythm(Jazz_Charleston_Comp)
import type { ChordDef } from '../../types/ChordDef';
import type { NoteEvent, JazzCharlestonParams } from '../types';
import type { Random } from '../../utils/Random';
import * as P from '../PitchPrimitives';

export function applyJazzCharleston(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: JazzCharlestonParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = params.bass_octave_low ? P.bassMidiLow(chord) : P.bassMidi(chord);
    const cM = P.chordVoicing(chord);

    out.push({ noteNumber: bM, time: startBeat, duration, velocity: 0.85 * 127, part: 'bass' });

    // chord first hit at beat 0
    for (const m of cM) {
        out.push({
            noteNumber: m,
            time: startBeat,
            duration: 0.5,
            velocity: params.chord_first_velocity * 127,
            part: 'accomp',
        });
    }
    // charleston at 1.66 (and of 2 in swing)
    if (params.charleston_time < duration) {
        for (const m of cM) {
            out.push({
                noteNumber: m,
                time: startBeat + params.charleston_time,
                duration: 0.34,
                velocity: params.chord_charleston_velocity * 127,
                part: 'accomp',
            });
        }
    }
    return out;
}
