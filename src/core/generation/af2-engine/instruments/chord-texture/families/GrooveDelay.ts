// GrooveDelay — J Dilla style push(RnB_Laid_Back_Groove)
//   bass 全曲 + chord 在指定 beat + delay 偏移(120ms)
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { GrooveDelayParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyGrooveDelay(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: GrooveDelayParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bMLow = P.bassMidiLow(chord);
    const cM = P.chordVoicing(chord);

    out.push({ noteNumber: bMLow, time: startBeat, duration, velocity: params.bass_velocity * 127, part: 'bass' });

    for (const t of params.chord_at) {
        const delayedT = t + params.chord_delay;
        if (delayedT >= duration) continue;
        for (const m of cM) {
            out.push({
                noteNumber: m,
                time: startBeat + delayedT,
                duration: params.chord_duration,
                velocity: params.chord_velocity * 127,
                part: 'accomp',
            });
        }
    }
    return out;
}
