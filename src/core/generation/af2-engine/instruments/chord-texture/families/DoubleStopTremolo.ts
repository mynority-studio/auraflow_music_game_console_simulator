// DoubleStopTremolo — 双停颤音(Blues_Tremolo_Comp)
//   每 beat:bottom(cM[0]) + 奇数 beat: top1/top2 (cM[-1]/cM[-2]) 16 分 tremolo
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { DoubleStopTremoloParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyDoubleStopTremolo(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: DoubleStopTremoloParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);
    const cM = P.chordVoicing(chord);
    if (cM.length < 2) return out;

    out.push({ noteNumber: bM, time: startBeat, duration, velocity: params.bass_velocity * 127, part: 'bass' });

    const bottom = cM[0];
    const top1 = cM[cM.length - 1];
    const top2 = cM[cM.length - 2];

    for (let i = 0; i < Math.floor(duration); i++) {
        // bottom on every beat
        out.push({
            noteNumber: bottom,
            time: startBeat + i,
            duration: params.bottom_duration,
            velocity: params.bottom_velocity * 127,
            part: 'chord',
        });
        // top tremolo on odd beats (i % 2 !== 0)
        if (i % 2 !== 0) {
            for (let j = 0; j < 4; j++) {
                const m = (j % 2 === 0) ? top1 : top2;
                out.push({
                    noteNumber: m,
                    time: startBeat + i + j * 0.25,
                    duration: params.top_duration,
                    velocity: params.top_velocity * 127,
                    part: 'chord',
                });
            }
        }
    }
    return out;
}
