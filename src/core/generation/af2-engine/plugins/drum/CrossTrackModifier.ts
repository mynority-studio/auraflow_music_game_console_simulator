// ============================================================
// CrossTrack Modifier — bass / chord 跨乐手 onset 触发 prob boost
// ============================================================
//
// 原 DrumIdiom.renderSection 内 bass/chord modifier(2026-05-25 拆 plugin)。
//
// 规则:
//   1. bass strong onset 在 step ±0.1 beat 内 + velocity >= 0.75 →
//      kick prob 提到至少 0.75(上限 0.95),保 bass-kick interlock
//   2. chord syncopate onset 在 step ±0.1 beat 内(0.34 / 0.66 frac in bar)→
//      snare prob × 1.3(上限 0.85),保 ghost-like accent 跟 chord 切分一致
//
// 必须 snareGateOpen(grid.snareEnergyGate 通过)才考虑 chord 加成。
// ============================================================

import type { NoteData } from '../../../types';
import type { DrumModifier, DrumProbs, DrumModifierContext } from './types';

const MODIFIER_TIME_WINDOW = 0.1;
const BASS_STRONG_VEL = 0.75;
const KICK_BOOST_FLOOR = 0.75;
const KICK_BOOST_CEIL = 0.95;
const SNARE_BOOST_RATIO = 1.3;
const SNARE_BOOST_CEIL = 0.85;

/** Bass strong onset 在该 step 时间窗口内? */
function hasBassStrongNear(stepBeat: number, bassNotes: ReadonlyArray<NoteData>): boolean {
    for (const n of bassNotes) {
        if (Math.abs(n.onset - stepBeat) <= MODIFIER_TIME_WINDOW && n.velocity >= BASS_STRONG_VEL) {
            return true;
        }
    }
    return false;
}

/** Chord syncopate onset(0.34 / 0.66 frac in bar)在该 step 时间窗口内? */
function isSyncopatedOffset(beatOffsetInBar: number): boolean {
    const fraction = beatOffsetInBar - Math.floor(beatOffsetInBar);
    return Math.abs(fraction - 0.34) < 0.08 || Math.abs(fraction - 0.66) < 0.08;
}

function hasChordSyncopateNear(
    stepBeat: number,
    barStart: number,
    chordNotes: ReadonlyArray<NoteData>,
): boolean {
    for (const n of chordNotes) {
        if (Math.abs(n.onset - stepBeat) <= MODIFIER_TIME_WINDOW) {
            const relTime = n.onset - barStart;
            if (isSyncopatedOffset(relTime)) return true;
        }
    }
    return false;
}

export const CrossTrackModifier: DrumModifier = {
    name: 'CrossTrackModifier',
    version: 'v1.0',
    prngConsumption: 'zero',
    description: 'Bass strong onset → kick prob floor(0.75/0.95);chord syncopate → snare prob × 1.3(ceil 0.85)',

    apply(probs, ctx) {
        let { kickProbAdj, snareProbAdj, hihatProbAdj } = probs;

        if (hasBassStrongNear(ctx.stepBeat, ctx.bassNotes)) {
            kickProbAdj = Math.min(KICK_BOOST_CEIL, Math.max(kickProbAdj, KICK_BOOST_FLOOR));
        }
        if (ctx.snareGateOpen && hasChordSyncopateNear(ctx.stepBeat, ctx.barStart, ctx.chordNotes)) {
            snareProbAdj = Math.min(SNARE_BOOST_CEIL, snareProbAdj * SNARE_BOOST_RATIO);
        }

        return { kickProbAdj, snareProbAdj, hihatProbAdj };
    },
};
