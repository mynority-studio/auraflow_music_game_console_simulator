// Triplet — 12/8 三连音(RnB_Gospel_Triplets / Blues_Slow_12_8_Arp)
//   每 beat 3 个位置:0 / 0.33 / 0.66
import type { ChordDef } from '../../types/ChordDef';
import type { NoteEvent, TripletParams } from '../types';
import type { Random } from '../../utils/Random';
import * as P from '../PitchPrimitives';

export function applyTriplet(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: TripletParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = params.bass_source === 'bMLow' ? P.bassMidiLow(chord) : P.bassMidi(chord);
    const cM = P.chordVoicing(chord);
    if (cM.length === 0) return out;

    out.push({ noteNumber: bM, time: startBeat, duration, velocity: 0.85 * 127, part: 'bass' });

    const pickPitch = (beatIdx: number, pos: 0 | 1 | 2): number => {
        if (params.blues_pitches) {
            const seq = [cM[0], cM[1 % cM.length], cM[2 % cM.length], cM[3] ?? cM[1 % cM.length]];
            return seq[(beatIdx * 3 + pos) % seq.length];
        } else {
            return cM[pos % cM.length];
        }
    };

    for (let beat = 0; beat < Math.floor(duration); beat++) {
        for (let pos: 0 | 1 | 2 = 0; pos <= 2; pos = (pos + 1) as 0 | 1 | 2) {
            const t = beat + pos * 0.33;
            out.push({
                noteNumber: pickPitch(beat, pos),
                time: startBeat + t,
                duration: params.triplet_duration,
                velocity: params.triplet_velocities[pos] * 127,
                part: 'accomp',
            });
        }
    }
    return out;
}
