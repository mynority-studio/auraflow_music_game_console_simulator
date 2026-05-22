// CallAndResponse — cross-track 应答模式(Call_And_Response)
//   bass 全曲 sustain + 每 chord_step 检查 melody,无 melody 占用时填 chord stab。
//   对齐 mg.applyTexture L3697-3710 逻辑。
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { CallAndResponseParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyCallAndResponse(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: CallAndResponseParams,
    _rng: Random,
    melodyEvents?: NoteEvent[],
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);
    const cM = P.chordVoicing(chord);

    // bass 全曲 sustain
    out.push({ noteNumber: bM, time: startBeat, duration, velocity: params.bass_velocity * 127, part: 'bass' });

    // 每 chord_step 检查 melody 是否占用此时间窗口
    for (let b = 0; b < duration; b += params.chord_step) {
        const absTime = startBeat + b;

        let melodyOccupied = false;
        if (melodyEvents && melodyEvents.length > 0) {
            for (const me of melodyEvents) {
                if (absTime >= me.time - params.melody_lookahead_back && absTime < me.time + params.melody_lookahead_forward) {
                    melodyOccupied = true;
                    break;
                }
            }
        }

        // melody 不占用 → 填 chord stab
        if (!melodyOccupied) {
            for (const m of cM) {
                out.push({
                    noteNumber: m,
                    time: absTime,
                    duration: params.chord_step,
                    velocity: params.chord_velocity * 127,
                    part: 'chord',
                });
            }
        }
    }
    return out;
}
