// PureWalk — 纯根音模式行走(Root_5_8 / Root_7_5_8 / Root_5_7_5 / Root_Fifth_Bass / Root_Octave_Pulse)
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { PureWalkParams, BassOffsetName } from '../types';
import * as P from '../PitchPrimitives';

function resolveOffset(chord: ChordDef, name: BassOffsetName): number {
    const bRoot = P.rootAnchor(chord);
    switch (name) {
        case 'root':       return P.bassMidi(chord);
        case '5th':        return bRoot + 7;
        case '7th':        return bRoot + P.seventhInterval(chord);
        case 'octave':     return bRoot + 12;
        case 'low_octave': return P.bassMidiLow(chord);
    }
}

export function applyPureWalk(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: PureWalkParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];

    // 单 bar 内按 grid_points 走
    for (let i = 0; i < params.grid_points.length; i++) {
        const t = params.grid_points[i];
        if (t >= duration) break;

        const pitch = resolveOffset(chord, params.bass_offsets[i]);
        const nextT = (i + 1 < params.grid_points.length) ? params.grid_points[i + 1] : duration;
        const noteDur = Math.min(nextT, duration) - t;

        out.push({
            noteNumber: pitch,
            time: startBeat + t,
            duration: noteDur,
            velocity: params.velocity_sequence[i] * 127,
            part: 'bass',
        });
    }

    // 若 grid_points 总长 < duration,后续重复模式(Root_Octave_Pulse 等需要)
    const totalGridDuration = params.grid_points[params.grid_points.length - 1] + 0.5;  // 假定最后一个 grid point 之后 0.5 beat
    let cycleStart = totalGridDuration;
    while (cycleStart < duration) {
        for (let i = 0; i < params.grid_points.length; i++) {
            const t = cycleStart + params.grid_points[i];
            if (t >= duration) break;
            const pitch = resolveOffset(chord, params.bass_offsets[i]);
            const nextT = (i + 1 < params.grid_points.length)
                ? cycleStart + params.grid_points[i + 1]
                : cycleStart + totalGridDuration;
            const noteDur = Math.min(nextT, duration) - t;
            out.push({
                noteNumber: pitch,
                time: startBeat + t,
                duration: noteDur,
                velocity: params.velocity_sequence[i] * 127,
                part: 'bass',
            });
        }
        cycleStart += totalGridDuration;
    }

    return out;
}
