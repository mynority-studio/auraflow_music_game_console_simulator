// Hemiola — 3-against-4 cross-rhythm(Jazz_Waltz_Hemiola)
// chord 在 hemiola 时间点(如 [0, 1.5, 3.0])击发,产生隐含 3/4 律动。
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { HemiolaParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyHemiola(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: HemiolaParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);
    const cM = P.chordVoicing(chord);

    out.push({ noteNumber: bM, time: startBeat, duration, velocity: 0.8 * 127, part: 'bass' });

    for (const t of params.hemiola_points) {
        if (t < duration) {
            for (const m of cM) {
                out.push({
                    noteNumber: m,
                    time: startBeat + t,
                    duration: 0.5,
                    velocity: params.velocity * 127,
                    part: 'chord',
                });
            }
        }
    }

    return out;
}
