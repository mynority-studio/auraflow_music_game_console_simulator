// CallAndResponse — cross-track 应答模式(Call_And_Response)
//   bass 全曲 sustain + 每 chord_step 检查 melody 是否占用此时间窗口,
//   无 melody 时填 chord stab(让 chord "答" melody 的"问")。
//
// N6 阶段(2026-05-24)移植自 mg。需 melodyEvents 输入(Facade Dispatcher
// 重排为 melody → bass → accomp → ...,accomp closure 通过 input.peers
// 获取 melodyMusicianId 的 NoteData[],adapter 转 NoteEvent[] 传入)。
import type { ChordDef } from '../../types/ChordDef';
import type { NoteEvent, CallAndResponseParams } from '../types';
import type { Random } from '../../utils/Random';
import * as P from '../PitchPrimitives';

export function applyCallAndResponse(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: CallAndResponseParams,
    _rng: Random,
    melodyEvents?: ReadonlyArray<NoteEvent>,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);
    const cM = P.chordVoicing(chord);

    // bass 全曲 sustain
    out.push({
        noteNumber: bM,
        time: startBeat,
        duration,
        velocity: params.bass_velocity * 127,
        part: 'bass',
    });

    // 每 chord_step 检查 melody 是否占用窗口 [t - back, t + forward)
    for (let b = 0; b < duration; b += params.chord_step) {
        const absTime = startBeat + b;

        let melodyOccupied = false;
        if (melodyEvents && melodyEvents.length > 0) {
            for (const me of melodyEvents) {
                if (absTime >= me.time - params.melody_lookahead_back
                    && absTime < me.time + params.melody_lookahead_forward) {
                    melodyOccupied = true;
                    break;
                }
            }
        }

        // melody 不占用 → 填 chord stab(让 chord "答")
        if (!melodyOccupied) {
            for (const m of cM) {
                out.push({
                    noteNumber: m,
                    time: absTime,
                    duration: params.chord_step,
                    velocity: params.chord_velocity * 127,
                    part: 'accomp',
                });
            }
        }
    }
    return out;
}
