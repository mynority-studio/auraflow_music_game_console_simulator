// WalkingBass — Jazz walking bass(beat 1 root + 中间 chord tones + 末拍 chromatic approach)
// 对齐 mg.applyTexture:Jazz_Walking_Bass L3712-3776
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { WalkingBassParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyWalkingBass(
    chord: ChordDef,
    nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: WalkingBassParams,
    rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);

    // Beat 1 — root
    out.push({ noteNumber: bM, time: startBeat, duration: 1, velocity: 0.85 * 127, part: 'bass' });

    if (duration < 2) return out;

    // 中间 beat — chord tone(避免重复 root)
    const middleCount = Math.max(0, Math.floor(duration) - 2);
    const allChordTones = P.chordTones(chord);
    const middlePool = allChordTones.slice(1);  // 3rd / 5th / 7th

    let prevPick = bM;
    for (let i = 0; i < middleCount; i++) {
        const candidates = middlePool.filter(mt => mt !== prevPick);
        const pick = candidates.length > 0
            ? rng.pick(candidates)
            : middlePool[0];
        out.push({
            noteNumber: pick,
            time: startBeat + i + 1,
            duration: 1,
            velocity: 0.78 * 127,
            part: 'bass',
        });
        prevPick = pick;
    }

    // Final beat — chromatic approach to next chord
    if (params.approach_enabled) {
        const approach = P.approachTone(chord, nextChord, rng, params.approach_half_step_ratio);
        out.push({
            noteNumber: approach,
            time: startBeat + duration - 1,
            duration: 1,
            velocity: 0.82 * 127,
            part: 'bass',
        });
    }

    return out;
}
