// ShuffleChop — swing 8th + grace 前导(Blues_Chicago_Shuffle / Blues_Slow_Chops)
// 两种模式:grace_lead 非 null = Slow_Chops(grace+chop pair on beats 1,3)
//          grace_lead null + shuffle_offset > 0 = Chicago_Shuffle(每 beat + offset)
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { ShuffleChopParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyShuffleChop(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: ShuffleChopParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);
    const cM = P.chordVoicing(chord);

    out.push({ noteNumber: bM, time: startBeat, duration, velocity: 0.8 * 127, part: 'bass' });

    if (params.grace_lead_ms !== null) {
        // Blues_Slow_Chops — grace + chop pair on beats 1, 3
        for (const beat of [1, 3]) {
            if (beat < duration) {
                // Grace 前导(短)
                for (const m of cM) {
                    out.push({
                        noteNumber: m,
                        time: startBeat + Math.max(0, beat + params.grace_lead_ms),
                        duration: 0.1,
                        velocity: 0.6 * 127,
                        part: 'accomp',
                    });
                }
                // Main chop
                for (const m of cM) {
                    out.push({
                        noteNumber: m,
                        time: startBeat + beat,
                        duration: params.chop_duration,
                        velocity: params.velocity * 127,
                        part: 'accomp',
                    });
                }
            }
        }
    } else {
        // Blues_Chicago_Shuffle — every beat + shuffle offset(0.66)
        for (let i = 0; i < Math.floor(duration); i++) {
            for (const m of cM) {
                out.push({
                    noteNumber: m,
                    time: startBeat + i,
                    duration: 0.3,
                    velocity: 0.6 * 127,
                    part: 'accomp',
                });
                if (params.shuffle_offset > 0 && i + params.shuffle_offset < duration) {
                    out.push({
                        noteNumber: m,
                        time: startBeat + i + params.shuffle_offset,
                        duration: 0.3,
                        velocity: params.velocity * 127,
                        part: 'accomp',
                    });
                }
            }
        }
    }

    return out;
}
