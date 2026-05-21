// BoogieWalk — quality-aware boogie pattern(Blues_Boogie_Woogie / Blues_Shuffle_Bass)
//   bass: bRootLow + boogiePattern[i % 8] 循环
//   Blues_Boogie_Woogie:每 4 step 发 chord;Blues_Shuffle_Bass:无 chord + 长短交替
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { BoogieWalkParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyBoogieWalk(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: BoogieWalkParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bRootLow = P.rootAnchorLow(chord);
    const cM = P.chordVoicing(chord);
    const pattern = P.boogiePattern(chord);

    const totalSteps = Math.floor(duration * 2);  // 8 分音符
    for (let i = 0; i < totalSteps; i++) {
        const t = i * 0.5;
        if (t >= duration) break;

        const bassMidiAtStep = bRootLow + pattern[i % 8];
        // 长短交替(Blues_Shuffle_Bass)
        const bassDur = params.long_short_pattern
            ? (i % 2 === 0 ? 0.4 : 0.2)
            : 0.4;

        out.push({
            noteNumber: bassMidiAtStep,
            time: startBeat + t,
            duration: bassDur,
            velocity: params.bass_velocity * 127,
            part: 'bass',
        });

        // 每 4 step 一个 chord(Boogie_Woogie)
        if (params.emit_chord_every_4_steps && i % 4 === 3) {
            for (const m of cM) {
                out.push({
                    noteNumber: m,
                    time: startBeat + t,
                    duration: 0.4,
                    velocity: params.chord_velocity * 127,
                    part: 'chord',
                });
            }
        }
    }
    return out;
}
