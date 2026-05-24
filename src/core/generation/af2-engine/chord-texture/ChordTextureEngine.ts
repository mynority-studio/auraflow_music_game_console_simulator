// ============================================================
// ChordTextureEngine — AF2 chord 演绎 dispatcher(N 阶段)
// ============================================================
//
// 从 mg/src/lib/chord-texture/ChordTextureEngine.ts 移植。
//
// 调用模式:
//   1. applyByTextureType(textureType, ...) — 通过 textureType 字符串查 mapping
//      自动 dispatch。未映射 → fallback 到 Sustained Single_Root(避免静默)
//   2. apply(input) — 直接传 family + params(testing / Phase N+ 自定义 pool 用)
//
// adapter:NoteEvent[] → NoteData[]
//   velocity / 127、删 part 字段、可选 filter(只取 accomp / 只取 bass)
// ============================================================

import type { NoteData } from '../../types';
import type { ChordDef } from '../types/ChordDef';
import type { Random } from '../utils/Random';
import type { ChordTextureInput, NoteEvent } from './types';
import { TEXTURE_MAPPING } from './TextureTypeMapping';

// N 阶段(8)
import { applySustained } from './families/Sustained';
import { applyPopAnthem } from './families/PopAnthem';
import { applyPopBroken8th } from './families/PopBroken8th';
import { applyJazzCharleston } from './families/JazzCharleston';
import { applyBossa } from './families/Bossa';
import { applyBoogieWalk } from './families/BoogieWalk';
import { applyGhostStab } from './families/GhostStab';
import { applyPureArp } from './families/PureArp';
// N5 阶段(15)
import { applyPureWalk } from './families/PureWalk';
import { applyWalkingBass } from './families/WalkingBass';
import { applyHemiola } from './families/Hemiola';
import { applyPureStab } from './families/PureStab';
import { applyScratchSlap } from './families/ScratchSlap';
import { applyShuffleChop } from './families/ShuffleChop';
import { applyOstinatoLayered } from './families/OstinatoLayered';
import { applyTriplet } from './families/Triplet';
import { applyRoll } from './families/Roll';
import { applyBlockLayered } from './families/BlockLayered';
import { applySweepProgressive } from './families/SweepProgressive';
import { applyGrooveDelay } from './families/GrooveDelay';
import { applySpecialVoicing } from './families/SpecialVoicing';
import { applyDoubleStopTremolo } from './families/DoubleStopTremolo';
import { applyAnticipatedBlock } from './families/AnticipatedBlock';
// N6 阶段(1)— cross-track
import { applyCallAndResponse } from './families/CallAndResponse';

/** Family dispatch — 24 family 完整覆盖 mg(N+N5+N6) */
function dispatchFamily(input: ChordTextureInput): NoteEvent[] {
    const { chord, nextChord, startBeat, duration, rng } = input;
    switch (input.family) {
        // N 阶段(8)
        case 'Sustained':         return applySustained(chord, nextChord, startBeat, duration, input.params, rng);
        case 'PopAnthem':         return applyPopAnthem(chord, nextChord, startBeat, duration, input.params, rng);
        case 'PopBroken8th':      return applyPopBroken8th(chord, nextChord, startBeat, duration, input.params, rng);
        case 'JazzCharleston':    return applyJazzCharleston(chord, nextChord, startBeat, duration, input.params, rng);
        case 'Bossa':             return applyBossa(chord, nextChord, startBeat, duration, input.params, rng);
        case 'BoogieWalk':        return applyBoogieWalk(chord, nextChord, startBeat, duration, input.params, rng);
        case 'GhostStab':         return applyGhostStab(chord, nextChord, startBeat, duration, input.params, rng);
        case 'PureArp':           return applyPureArp(chord, nextChord, startBeat, duration, input.params, rng);
        // N5 阶段(15)
        case 'PureWalk':          return applyPureWalk(chord, nextChord, startBeat, duration, input.params, rng);
        case 'WalkingBass':       return applyWalkingBass(chord, nextChord, startBeat, duration, input.params, rng);
        case 'Hemiola':           return applyHemiola(chord, nextChord, startBeat, duration, input.params, rng);
        case 'PureStab':          return applyPureStab(chord, nextChord, startBeat, duration, input.params, rng);
        case 'ScratchSlap':       return applyScratchSlap(chord, nextChord, startBeat, duration, input.params, rng);
        case 'ShuffleChop':       return applyShuffleChop(chord, nextChord, startBeat, duration, input.params, rng);
        case 'OstinatoLayered':   return applyOstinatoLayered(chord, nextChord, startBeat, duration, input.params, rng);
        case 'Triplet':           return applyTriplet(chord, nextChord, startBeat, duration, input.params, rng);
        case 'Roll':              return applyRoll(chord, nextChord, startBeat, duration, input.params, rng);
        case 'BlockLayered':      return applyBlockLayered(chord, nextChord, startBeat, duration, input.params, rng);
        case 'SweepProgressive':  return applySweepProgressive(chord, nextChord, startBeat, duration, input.params, rng);
        case 'GrooveDelay':       return applyGrooveDelay(chord, nextChord, startBeat, duration, input.params, rng);
        case 'SpecialVoicing':    return applySpecialVoicing(chord, nextChord, startBeat, duration, input.params, rng);
        case 'DoubleStopTremolo': return applyDoubleStopTremolo(chord, nextChord, startBeat, duration, input.params, rng);
        case 'AnticipatedBlock':  return applyAnticipatedBlock(chord, nextChord, startBeat, duration, input.params, rng);
        // N6 阶段(1)— cross-track,需 melodyEvents
        case 'CallAndResponse':   return applyCallAndResponse(chord, nextChord, startBeat, duration, input.params, rng, input.melodyEvents);
    }
}

/**
 * NoteEvent[] → NoteData[] 适配器。
 *   velocity / 127、删 part(但可选 filter)
 */
function adaptEvents(events: ReadonlyArray<NoteEvent>, partFilter?: 'accomp' | 'bass'): NoteData[] {
    const out: NoteData[] = [];
    for (const e of events) {
        if (partFilter && e.part !== partFilter) continue;
        out.push({
            pitch: e.noteNumber,
            onset: e.time,
            duration: e.duration,
            velocity: Math.max(0, Math.min(1, e.velocity / 127)),
        });
    }
    return out;
}

export const ChordTextureEngine = {
    /** 直传 family + params(测试 / 自定义 textureType pool 用)*/
    apply(input: ChordTextureInput, partFilter?: 'accomp' | 'bass'): NoteData[] {
        return adaptEvents(dispatchFamily(input), partFilter);
    },

    /**
     * 主入口:textureType 字符串查 mapping 自动 dispatch。
     * 未映射 textureType → fallback Sustained Single_Root(避免静默)。
     *
     * N6 阶段:加 melodyEvents 可选参数,给 CallAndResponse 等 cross-track family 用。
     */
    applyByTextureType(
        textureType: string,
        chord: ChordDef,
        nextChord: ChordDef | null,
        startBeat: number,
        duration: number,
        rng: Random,
        partFilter?: 'accomp' | 'bass',
        melodyEvents?: ReadonlyArray<NoteEvent>,
    ): NoteData[] {
        const mapping = TEXTURE_MAPPING[textureType] ?? TEXTURE_MAPPING['Single_Root'];
        const input = {
            ...mapping,
            chord, nextChord, startBeat, duration, rng,
            melodyEvents,
        } as ChordTextureInput;
        return adaptEvents(dispatchFamily(input), partFilter);
    },
};
