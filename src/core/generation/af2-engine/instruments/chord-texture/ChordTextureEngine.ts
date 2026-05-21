// ============================================================
// ChordTextureEngine — AF2 自有 chord 演绎引擎(Phase 2b.1)
// ============================================================
//
// 取代 mg.applyTexture 的调用 — AF2 自己用网格概率 + grammar primitive
// 生成 chord/bass 节奏。
//
// 调用模式:
//
//   1. applyByTextureType(textureType, ...) → 通过 mg textureType 查 mapping
//      table 自动 dispatch。返回 null 表示未覆盖,调用方 fallback 到 mg.applyTexture
//      (Phase 2b.1 渐进迁移)。
//
//   2. apply(input) → 直接传 family + params 调用,跳过 mapping。Phase 2b.2+
//      AF2 自己决定 texture 选择时用。
//
// 参考:af2-engine/CHORD_TEXTURE_ENGINE.md
// ============================================================

import type { ChordDef, NoteEvent, Random } from '../../../mg-engine/musicEngine';
import type { ChordTextureInput } from './types';
import { TEXTURE_MAPPING } from './TextureTypeMapping';

// Phase 2b.1 (9 子族)
import { applySustained } from './families/Sustained';
import { applyPureWalk } from './families/PureWalk';
import { applyWalkingBass } from './families/WalkingBass';
import { applyBossa } from './families/Bossa';
import { applyHemiola } from './families/Hemiola';
import { applyPureStab } from './families/PureStab';
import { applyGhostStab } from './families/GhostStab';
import { applyScratchSlap } from './families/ScratchSlap';
import { applyShuffleChop } from './families/ShuffleChop';
// Phase 2b.3 (14 子族)
import { applyPopAnthem } from './families/PopAnthem';
import { applyPopBroken8th } from './families/PopBroken8th';
import { applyJazzCharleston } from './families/JazzCharleston';
import { applyPureArp } from './families/PureArp';
import { applyOstinatoLayered } from './families/OstinatoLayered';
import { applyTriplet } from './families/Triplet';
import { applyRoll } from './families/Roll';
import { applyBlockLayered } from './families/BlockLayered';
import { applySweepProgressive } from './families/SweepProgressive';
import { applyGrooveDelay } from './families/GrooveDelay';
import { applySpecialVoicing } from './families/SpecialVoicing';
import { applyDoubleStopTremolo } from './families/DoubleStopTremolo';
import { applyBoogieWalk } from './families/BoogieWalk';
import { applyAnticipatedBlock } from './families/AnticipatedBlock';

export const ChordTextureEngine = {
    /**
     * 主 apply 入口 — 接收已 narrow 的 family + params。
     */
    apply(input: ChordTextureInput): NoteEvent[] {
        const { chord, nextChord, startBeat, duration, rng } = input;
        switch (input.family) {
            // Phase 2b.1
            case 'Sustained':         return applySustained(chord, nextChord, startBeat, duration, input.params, rng);
            case 'PureWalk':          return applyPureWalk(chord, nextChord, startBeat, duration, input.params, rng);
            case 'WalkingBass':       return applyWalkingBass(chord, nextChord, startBeat, duration, input.params, rng);
            case 'Bossa':             return applyBossa(chord, nextChord, startBeat, duration, input.params, rng);
            case 'Hemiola':           return applyHemiola(chord, nextChord, startBeat, duration, input.params, rng);
            case 'PureStab':          return applyPureStab(chord, nextChord, startBeat, duration, input.params, rng);
            case 'GhostStab':         return applyGhostStab(chord, nextChord, startBeat, duration, input.params, rng);
            case 'ScratchSlap':       return applyScratchSlap(chord, nextChord, startBeat, duration, input.params, rng);
            case 'ShuffleChop':       return applyShuffleChop(chord, nextChord, startBeat, duration, input.params, rng);
            // Phase 2b.3
            case 'PopAnthem':         return applyPopAnthem(chord, nextChord, startBeat, duration, input.params, rng);
            case 'PopBroken8th':      return applyPopBroken8th(chord, nextChord, startBeat, duration, input.params, rng);
            case 'JazzCharleston':    return applyJazzCharleston(chord, nextChord, startBeat, duration, input.params, rng);
            case 'PureArp':           return applyPureArp(chord, nextChord, startBeat, duration, input.params, rng);
            case 'OstinatoLayered':   return applyOstinatoLayered(chord, nextChord, startBeat, duration, input.params, rng);
            case 'Triplet':           return applyTriplet(chord, nextChord, startBeat, duration, input.params, rng);
            case 'Roll':              return applyRoll(chord, nextChord, startBeat, duration, input.params, rng);
            case 'BlockLayered':      return applyBlockLayered(chord, nextChord, startBeat, duration, input.params, rng);
            case 'SweepProgressive':  return applySweepProgressive(chord, nextChord, startBeat, duration, input.params, rng);
            case 'GrooveDelay':       return applyGrooveDelay(chord, nextChord, startBeat, duration, input.params, rng);
            case 'SpecialVoicing':    return applySpecialVoicing(chord, nextChord, startBeat, duration, input.params, rng);
            case 'DoubleStopTremolo': return applyDoubleStopTremolo(chord, nextChord, startBeat, duration, input.params, rng);
            case 'BoogieWalk':        return applyBoogieWalk(chord, nextChord, startBeat, duration, input.params, rng);
            case 'AnticipatedBlock':  return applyAnticipatedBlock(chord, nextChord, startBeat, duration, input.params, rng);
        }
    },

    /**
     * 通过 textureType 查 mapping table 自动 dispatch。
     * 返回 null 表示该 textureType 未在 Phase 2b.1 覆盖范围,调用方应 fallback
     * 到 mg.applyTexture。
     */
    applyByTextureType(
        textureType: string,
        chord: ChordDef,
        nextChord: ChordDef | null,
        startBeat: number,
        duration: number,
        rng: Random,
    ): NoteEvent[] | null {
        const mapping = TEXTURE_MAPPING[textureType];
        if (!mapping) return null;

        // 构造 discriminated union 输入(TS narrowing via family field)
        const input = {
            chord,
            nextChord,
            startBeat,
            duration,
            rng,
            family: mapping.family,
            params: mapping.params,
        } as ChordTextureInput;

        return this.apply(input);
    },
};
