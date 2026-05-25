// ============================================================
// ChordTextureEngine — AF2 chord 演绎 dispatcher
// ============================================================
//
// POP-only(2026-05-25 大瘦身)— 11 个 family,覆盖 23 个 textureType。
//
// 调用模式:
//   1. applyByTextureType(textureType, ...) — 通过 textureType 字符串查 mapping
//      自动 dispatch。未映射 → fallback 到 Sustained Single_Root
//   2. apply(input) — 直接传 family + params(testing / 自定义 pool 用)
//
// adapter:NoteEvent[] → NoteData[]
//   velocity / 127、删 part 字段、可选 filter(只取 accomp / 只取 bass)
// ============================================================

import type { NoteData } from '../../types';
import type { ChordDef } from '../types/ChordDef';
import type { Random } from '../utils/Random';
import type { ChordTextureInput, NoteEvent } from './types';
import { TEXTURE_MAPPING } from './TextureTypeMapping';

import { applySustained } from './families/Sustained';
import { applyPopAnthem } from './families/PopAnthem';
import { applyPopBroken8th } from './families/PopBroken8th';
import { applyPureArp } from './families/PureArp';
import { applyPureWalk } from './families/PureWalk';
import { applyPureStab } from './families/PureStab';
import { applyScratchSlap } from './families/ScratchSlap';
import { applyOstinatoLayered } from './families/OstinatoLayered';
import { applyBlockLayered } from './families/BlockLayered';
import { applySweepProgressive } from './families/SweepProgressive';
import { applyCallAndResponse } from './families/CallAndResponse';

/** Family dispatch — 11 family 覆盖 POP 全部 textureType */
function dispatchFamily(input: ChordTextureInput): NoteEvent[] {
    const { chord, nextChord, startBeat, duration, rng } = input;
    switch (input.family) {
        case 'Sustained':         return applySustained(chord, nextChord, startBeat, duration, input.params, rng);
        case 'PopAnthem':         return applyPopAnthem(chord, nextChord, startBeat, duration, input.params, rng);
        case 'PopBroken8th':      return applyPopBroken8th(chord, nextChord, startBeat, duration, input.params, rng);
        case 'PureArp':           return applyPureArp(chord, nextChord, startBeat, duration, input.params, rng);
        case 'PureWalk':          return applyPureWalk(chord, nextChord, startBeat, duration, input.params, rng);
        case 'PureStab':          return applyPureStab(chord, nextChord, startBeat, duration, input.params, rng);
        case 'ScratchSlap':       return applyScratchSlap(chord, nextChord, startBeat, duration, input.params, rng);
        case 'OstinatoLayered':   return applyOstinatoLayered(chord, nextChord, startBeat, duration, input.params, rng);
        case 'BlockLayered':      return applyBlockLayered(chord, nextChord, startBeat, duration, input.params, rng);
        case 'SweepProgressive':  return applySweepProgressive(chord, nextChord, startBeat, duration, input.params, rng);
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
     * 未映射 textureType → fallback Sustained Single_Root。
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
