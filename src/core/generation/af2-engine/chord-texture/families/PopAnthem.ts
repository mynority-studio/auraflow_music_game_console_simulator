// PopAnthem — Coldplay 风强拍柱式 + off-beat broken 8th(Pop_Anthem_Pulse)
// ============================================================
// 2026-05-25 重设计(用户反馈"全是柱式")
// ============================================================
// 原行为:每 0.5 beat 完整柱 strike(8 分密集柱式 pulse)
// 新行为:per-beat 模式
//   - 整拍(beat 0, 1, 2, 3...)弹完整柱式(强)
//   - off-beat(0.5, 1.5, 2.5, 3.5)弹 chord 高音 broken 单音(弱)
//
// 节奏型示意(per chord beat):
//   beat 0   .5    1    1.5  2    2.5  3    3.5
//   [柱] [单音] [柱] [单音] [柱] [单音] [柱] [单音]
//
// off-beat broken 音从 cM 高音轮转(cM[len-1] / cM[len-2] / cM[len-3]
// 循环),给一种"柱式 + 装饰"的钢琴 ballad 风,不再是密集 8 分柱式 pulse。
//
// velocity:
//   - 整拍柱式 → chord_velocity_even(0.75 默认)— 强
//   - off-beat 单音 → chord_velocity_odd(0.55 默认)× 0.85 — 更弱
// ============================================================

import type { ChordDef } from '../../types/ChordDef';
import type { NoteEvent, PopAnthemParams } from '../types';
import type { Random } from '../../utils/Random';
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
    if (cM.length === 0) return out;

    out.push({ noteNumber: bM, time: startBeat, duration, velocity: 0.9 * 127, part: 'bass' });

    // per-beat 双模式:整拍柱 + off-beat broken 单音
    const steps = Math.floor(duration * 2);
    const velStrong = params.chord_velocity_even * 127;
    const velWeak = params.chord_velocity_odd * 127 * 0.85;
    let brokenIdx = 0;
    for (let i = 0; i < steps; i++) {
        const isOnBeat = (i % 2 === 0);
        const time = startBeat + i * 0.5;
        if (isOnBeat) {
            // 整拍 — 完整柱式 strike
            for (const m of cM) {
                out.push({
                    noteNumber: m,
                    time,
                    duration: 0.45,
                    velocity: velStrong,
                    part: 'accomp',
                });
            }
        } else {
            // off-beat — broken 单音(cM 高音轮转)
            const pickIdx = cM.length - 1 - (brokenIdx % Math.min(3, cM.length));
            brokenIdx++;
            out.push({
                noteNumber: cM[pickIdx]!,
                time,
                duration: 0.45,
                velocity: velWeak,
                part: 'accomp',
            });
        }
    }
    return out;
}
