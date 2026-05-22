// PopBroken8th — 8 分破碎 + 高低 cM 对交替(Pop_Broken_8ths_Sync)
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { PopBroken8thParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyPopBroken8th(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: PopBroken8thParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);
    const cM = P.chordVoicing(chord);
    if (cM.length < 2) return out;

    out.push({ noteNumber: bM, time: startBeat, duration, velocity: 0.85 * 127, part: 'bass' });

    // 高低对:lowPair = cM[0,1] / highPair = cM[-2,-1]
    const highPair = [cM[cM.length - 2], cM[cM.length - 1]];
    const lowPair = [cM[0], cM[Math.min(1, cM.length - 1)]];

    const steps = Math.floor(duration * 2);
    for (let i = 0; i < steps; i++) {
        if (i % 4 === 0) continue;  // 跳过强拍
        const isHigh = (i % 2 !== 0);
        const pair = isHigh ? highPair : lowPair;
        const vel = (isHigh ? params.velocity_high : params.velocity_low) * 127;
        for (const m of pair) {
            out.push({
                noteNumber: m,
                time: startBeat + i * 0.5,
                duration: 0.4,
                velocity: vel,
                part: 'accomp',
            });
        }
    }
    return out;
}
