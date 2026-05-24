// Sustained — 单击长音(Single_Root / Root_Octave)
import type { ChordDef } from '../../types/ChordDef';
import type { NoteEvent, SustainedParams } from '../types';
import type { Random } from '../../utils/Random';
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
    const cM = P.chordVoicing(chord);
    const velocity = params.velocity * 127;

    // Bass(单击或 octave-double)
    if (params.bass_octave_double) {
        const bMLow = P.bassMidiLow(chord);
        if (bMLow !== bM) {
            out.push({ noteNumber: bMLow, time: startBeat, duration, velocity, part: 'bass' });
        }
    }
    out.push({ noteNumber: bM, time: startBeat, duration, velocity, part: 'bass' });

    // Chord(长音 sustain,velocity 略低,AF2 simplified — mg 原本不发 accomp,
    // AF2 加这一击让 Accomp 走得到 chord 声音)
    for (const m of cM) {
        out.push({
            noteNumber: m,
            time: startBeat,
            duration,
            velocity: velocity * 0.7,
            part: 'accomp',
        });
    }
    return out;
}
