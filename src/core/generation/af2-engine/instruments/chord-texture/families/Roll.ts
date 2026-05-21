// Roll — D'Angelo neo-soul roll(RnB_Neo_Soul_Roll)
//   bass 全曲 + 可选 syncopated bass + 每和弦 beat 上 cM 滚弦(0.04 级联延迟)
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { RollParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyRoll(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: RollParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);
    const bMLow = P.bassMidiLow(chord);
    const cM = P.chordVoicing(chord);

    out.push({ noteNumber: bMLow, time: startBeat, duration, velocity: 0.85 * 127, part: 'bass' });

    // syncopated bass hit
    if (params.syncopated_bass_at !== null && params.syncopated_bass_at < duration) {
        out.push({
            noteNumber: bM,
            time: startBeat + params.syncopated_bass_at,
            duration: duration - params.syncopated_bass_at,
            velocity: 0.75 * 127,
            part: 'bass',
        });
    }

    // chord roll at 指定 beats
    for (const beat of params.roll_at_beats) {
        if (beat >= duration) continue;
        for (let idx = 0; idx < cM.length; idx++) {
            const m = cM[idx];
            const t = beat + 0.05 + idx * params.roll_delay;
            const vel = params.roll_chord_velocity_start + idx * params.roll_chord_velocity_step;
            out.push({
                noteNumber: m,
                time: startBeat + t,
                duration: Math.min(2, duration - t) - 0.2,
                velocity: Math.min(127, vel * 127),
                part: 'chord',
            });
        }
    }
    return out;
}
