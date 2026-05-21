// GhostStab — 含 random ghost + syncopate(Blues_Stabs)
// 对齐 mg.applyTexture:Blues_Stabs L3809-3825
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { GhostStabParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyGhostStab(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: GhostStabParams,
    rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);
    const cM = P.chordVoicing(chord);

    // bass 全曲 sustain
    out.push({ noteNumber: bM, time: startBeat, duration, velocity: 0.8 * 127, part: 'bass' });

    for (let t = 1; t < Math.floor(duration); t += params.main_stab_period) {
        const isSyncopated = rng.next() < params.syncopate_probability;
        const stabTime = isSyncopated
            ? Math.max(0, t - 0.34)
            : (t + (rng.next() - 0.5) * 0.1);
        const stabDur = isSyncopated ? 0.34 : 0.15;
        const hitVol = 0.6 + (rng.next() - 0.5) * 0.4;
        const vel = Math.max(0, Math.min(127, hitVol * 127));

        for (const m of cM) {
            out.push({
                noteNumber: m,
                time: startBeat + stabTime,
                duration: stabDur,
                velocity: vel,
                part: 'chord',
            });
        }

        // ghost stab
        if (rng.next() < params.ghost_probability) {
            const ghostTime = t + params.ghost_offset;
            if (ghostTime < duration) {
                for (const m of cM) {
                    out.push({
                        noteNumber: m,
                        time: startBeat + ghostTime,
                        duration: 0.15,
                        velocity: 0.3 * 127,
                        part: 'chord',
                    });
                }
            }
        }
    }

    return out;
}
