// BlockLayered — bass+chord 时序层级
//   block: Block_Chord(chord beat 0 + 可能 beat 2)
//   sparse_off_beat: Jazz_Comping(chord 在 1.5/3.0 稀疏 stab)
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { BlockLayeredParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyBlockLayered(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: BlockLayeredParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);
    const cM = P.chordVoicing(chord);

    out.push({ noteNumber: bM, time: startBeat, duration, velocity: params.bass_velocity * 127, part: 'bass' });

    if (params.chord_pattern === 'block') {
        // Block_Chord: chord(0, min(2,dur), 0.7) + chord(2, dur-2, 0.6) if dur>2
        const firstDur = Math.min(2, duration);
        for (const m of cM) {
            out.push({
                noteNumber: m,
                time: startBeat,
                duration: firstDur,
                velocity: 0.7 * 127,
                part: 'accomp',
            });
        }
        if (duration > 2) {
            for (const m of cM) {
                out.push({
                    noteNumber: m,
                    time: startBeat + 2,
                    duration: duration - 2,
                    velocity: 0.6 * 127,
                    part: 'accomp',
                });
            }
        }
    } else {
        // sparse_off_beat: Jazz_Comping
        if (duration > 1.5) {
            for (const m of cM) {
                out.push({
                    noteNumber: m,
                    time: startBeat + 1.5,
                    duration: 0.5,
                    velocity: 0.7 * 127,
                    part: 'accomp',
                });
            }
        }
        if (duration > 3.0) {
            for (const m of cM) {
                out.push({
                    noteNumber: m,
                    time: startBeat + 3.0,
                    duration: 0.5,
                    velocity: 0.6 * 127,
                    part: 'accomp',
                });
            }
        }
    }
    return out;
}
