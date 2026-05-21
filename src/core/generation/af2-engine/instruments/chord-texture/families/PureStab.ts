// PureStab — 纯短促 stab(Stabs / Syncopated_Stabs / Block_Chord_Staccato / RnB_16th_Funk_Stabs)
// 固定 stab 点位 + 短 duration + 可选 bass-at-zero。
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { PureStabParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyPureStab(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: PureStabParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);
    const cM = P.chordVoicing(chord);
    const velocity = params.velocity * 127;

    if (params.bass_at_zero) {
        out.push({
            noteNumber: bM,
            time: startBeat,
            duration: Math.min(duration, params.stab_duration),
            velocity,
            part: 'bass',
        });
    }

    for (const t of params.stab_positions) {
        if (t < duration) {
            for (const m of cM) {
                out.push({
                    noteNumber: m,
                    time: startBeat + t,
                    duration: params.stab_duration,
                    velocity,
                    part: 'chord',
                });
            }
        }
    }

    return out;
}
