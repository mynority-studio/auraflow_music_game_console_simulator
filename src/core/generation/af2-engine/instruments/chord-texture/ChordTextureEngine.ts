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

import { applySustained } from './families/Sustained';
import { applyPureWalk } from './families/PureWalk';
import { applyWalkingBass } from './families/WalkingBass';
import { applyBossa } from './families/Bossa';
import { applyHemiola } from './families/Hemiola';
import { applyPureStab } from './families/PureStab';
import { applyGhostStab } from './families/GhostStab';
import { applyScratchSlap } from './families/ScratchSlap';
import { applyShuffleChop } from './families/ShuffleChop';

export const ChordTextureEngine = {
    /**
     * 主 apply 入口 — 接收已 narrow 的 family + params。
     */
    apply(input: ChordTextureInput): NoteEvent[] {
        const { chord, nextChord, startBeat, duration, rng } = input;
        switch (input.family) {
            case 'Sustained':
                return applySustained(chord, nextChord, startBeat, duration, input.params, rng);
            case 'PureWalk':
                return applyPureWalk(chord, nextChord, startBeat, duration, input.params, rng);
            case 'WalkingBass':
                return applyWalkingBass(chord, nextChord, startBeat, duration, input.params, rng);
            case 'Bossa':
                return applyBossa(chord, nextChord, startBeat, duration, input.params, rng);
            case 'Hemiola':
                return applyHemiola(chord, nextChord, startBeat, duration, input.params, rng);
            case 'PureStab':
                return applyPureStab(chord, nextChord, startBeat, duration, input.params, rng);
            case 'GhostStab':
                return applyGhostStab(chord, nextChord, startBeat, duration, input.params, rng);
            case 'ScratchSlap':
                return applyScratchSlap(chord, nextChord, startBeat, duration, input.params, rng);
            case 'ShuffleChop':
                return applyShuffleChop(chord, nextChord, startBeat, duration, input.params, rng);
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
