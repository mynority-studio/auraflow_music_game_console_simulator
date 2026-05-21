// Sustained — 单击长音(Single_Root / Root_Octave)
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { SustainedParams } from '../types';
import * as P from '../PitchPrimitives';

export function applySustained(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: SustainedParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);
    const velocity = params.velocity * 127;

    if (params.bass_octave_double) {
        const bMLow = P.bassMidiLow(chord);
        if (bMLow !== bM) {
            out.push({ noteNumber: bMLow, time: startBeat, duration, velocity, part: 'bass' });
        }
    }
    out.push({ noteNumber: bM, time: startBeat, duration, velocity, part: 'bass' });
    return out;
}
