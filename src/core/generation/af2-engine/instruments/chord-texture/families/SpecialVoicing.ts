// SpecialVoicing — Bill Evans drop-2 comp(Jazz_Drop_2_Comp)
//   chord 用 drop-2 voicing(去 cM 顶音) + random velocity jitter
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { SpecialVoicingParams } from '../types';
import * as P from '../PitchPrimitives';

export function applySpecialVoicing(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: SpecialVoicingParams,
    rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);
    const cM = P.chordVoicing(chord);

    out.push({ noteNumber: bM, time: startBeat, duration, velocity: params.bass_velocity * 127, part: 'bass' });

    // drop-2:去顶音
    const dropVoicing = params.voicing_strategy === 'drop_2'
        ? cM.slice(0, -1)
        : cM;
    if (dropVoicing.length === 0) return out;

    for (const t of params.comp_times) {
        if (t >= duration) continue;
        const vel = params.velocity_base + (rng.next() - 0.5) * params.velocity_random_range;
        const clampedVel = Math.max(0, Math.min(127, vel * 127));
        for (const m of dropVoicing) {
            out.push({
                noteNumber: m,
                time: startBeat + t,
                duration: params.chord_duration,
                velocity: clampedVel,
                part: 'chord',
            });
        }
    }
    return out;
}
