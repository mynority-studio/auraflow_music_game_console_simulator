// AnticipatedBlock — Red Garland 早发块(Jazz_Red_Garland_Block)
//   每 beat 的 chord 提前 0.34 (triplet 3rd anticipation)
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { AnticipatedBlockParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyAnticipatedBlock(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: AnticipatedBlockParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);
    const cM = P.chordVoicing(chord);

    out.push({ noteNumber: bM, time: startBeat, duration, velocity: params.bass_velocity * 127, part: 'bass' });

    for (let i = 0; i < Math.floor(duration); i++) {
        // beat i 的 chord 提前 anticipation_offset(通常 -0.34)
        // i===0 时不能提前到负数,clamp 到 0
        const baseT = i === 0 ? 0 : i + params.anticipation_offset;
        const t = Math.max(0, baseT);
        if (t >= duration) break;
        for (const m of cM) {
            out.push({
                noteNumber: m,
                time: startBeat + t,
                duration: params.chord_duration,
                velocity: params.chord_velocity * 127,
                part: 'chord',
            });
        }
    }
    return out;
}
