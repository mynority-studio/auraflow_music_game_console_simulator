// PopAnthem — Coldplay 风每拍重音 8 分脉(Pop_Anthem_Pulse)
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { PopAnthemParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyPopAnthem(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: PopAnthemParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = params.bass_octave_low ? P.bassMidiLow(chord) : P.bassMidi(chord);
    const cM = P.chordVoicing(chord);

    out.push({ noteNumber: bM, time: startBeat, duration, velocity: 0.9 * 127, part: 'bass' });

    // 每 0.5 beat chord 击,偶数 step 强 / 奇数弱
    const steps = Math.floor(duration * 2);
    for (let i = 0; i < steps; i++) {
        const vel = (i % 2 === 0 ? params.chord_velocity_even : params.chord_velocity_odd) * 127;
        for (const m of cM) {
            out.push({
                noteNumber: m,
                time: startBeat + i * 0.5,
                duration: 0.45,
                velocity: vel,
                part: 'chord',
            });
        }
    }
    return out;
}
