/**
 * Styles barrel — StyleId → 风格 bundle(C.2 简化:删除被 mg 取代的 harmonyRules /
 * voiceLeading / grammar 字段)
 *
 * 保留(auraflow 护城河):
 *   - bpmRange / structureTemplates / beatsPerChord(Stage 1-2 抽样)
 *   - personas / fractal / drum(Stage 4-5 乐手 / weather / drum 系统)
 *   - approachDownProb(标量,bass/atmosphere 调试用)
 *
 * 删除(被 mg 取代,C.2):
 *   - harmonyRules(MacroProgressionEngine 推演规则)
 *   - voiceLeading(SATB 全曲 voicing)
 *   - grammar(PCFGGrammarEngine motif 系统)
 *
 * C.4 待做:基于 personas / drum 接 bass/drums/atmosphere 与 mg chord。
 */

import { StyleId } from '../StyleFlags';
import { MusicianPersona, StructureTemplate } from '../../types';
import { FractalConfig } from '../../primitives/FractalStructureEngine';
import { DrumGridConfig } from '../../primitives/DrumIdiom';
import {
    MODERN_POP_PERSONAS,
    MODERN_POP_FRACTAL,
    MODERN_POP_DRUM_GRID,
    MODERN_POP_STRUCTURES,
} from './ModernPop';
import {
    NEO_SOUL_PERSONAS,
    NEO_SOUL_FRACTAL,
    NEO_SOUL_DRUM_GRID,
    NEO_SOUL_STRUCTURES,
} from './NeoSoul';
import {
    CHILL_JAZZ_PERSONAS,
    CHILL_JAZZ_FRACTAL,
    CHILL_JAZZ_DRUM_GRID,
    CHILL_JAZZ_STRUCTURES,
} from './ChillJazz';

// ============================================================
// StyleHarmonyBundle — Stage 1-2 抽样用(BPM / 段落骨架 / chord 累积速度)
// ============================================================

export interface StyleHarmonyBundle {
    /** BPM 范围(min, max),Stage 2 PRNG 抽 */
    bpmRange: [number, number];
    /** 曲式模板池,Stage 2 PRNG 抽 + 实例化为 sections */
    structureTemplates: StructureTemplate[];
    /** 单和弦持续拍数(Pop/Jazz 每小节 1 个 = 4;NeoSoul 两小节 1 个 = 8) */
    beatsPerChord: number;
}

const POP_BUNDLE: StyleHarmonyBundle = {
    bpmRange: [88, 128],
    beatsPerChord: 4,
    structureTemplates: MODERN_POP_STRUCTURES,
};

const NEOSOUL_BUNDLE: StyleHarmonyBundle = {
    bpmRange: [78, 100],
    beatsPerChord: 8,
    structureTemplates: NEO_SOUL_STRUCTURES,
};

const JAZZ_BUNDLE: StyleHarmonyBundle = {
    bpmRange: [70, 105],
    beatsPerChord: 4,
    structureTemplates: CHILL_JAZZ_STRUCTURES,
};

/** 数值索引查找表(T-1 合规) */
const STYLE_HARMONY_BUNDLES: StyleHarmonyBundle[] = [];
STYLE_HARMONY_BUNDLES[StyleId.POP]   = POP_BUNDLE;
STYLE_HARMONY_BUNDLES[StyleId.RNB]   = NEOSOUL_BUNDLE;
STYLE_HARMONY_BUNDLES[StyleId.JAZZ]  = JAZZ_BUNDLE;
STYLE_HARMONY_BUNDLES[StyleId.BLUES] = JAZZ_BUNDLE;  // C.1 stub — 临时复用 JAZZ

export function getStyleHarmonyBundle(styleId: StyleId): StyleHarmonyBundle {
    const bundle = STYLE_HARMONY_BUNDLES[styleId];
    return bundle !== undefined ? bundle : POP_BUNDLE;
}

// ============================================================
// StyleStage5Bundle — Stage 5 渲染用(乐手 / 分形结构 / drum grid)
// ============================================================

export interface StyleStage5Bundle {
    /** 长度 === ROLE_COUNT(4),下标对齐 ROLE_BASS/ACCOMP/LEAD/DRUMS */
    personas: MusicianPersona[];
    /** FractalStructureEngine 的概率桶配置(Lead / atmosphere 共用) */
    fractal: FractalConfig;
    /** approach 走下方半音 vs 上方调内音的概率(C.4 bass/atmosphere 用) */
    approachDownProb: number;
    /** DrumIdiom 16-step grid + Energy 缩放曲线 */
    drum: DrumGridConfig;
}

const POP_STAGE5: StyleStage5Bundle = {
    personas: MODERN_POP_PERSONAS,
    fractal:  MODERN_POP_FRACTAL,
    approachDownProb: 0.5,
    drum:     MODERN_POP_DRUM_GRID,
};

const NEOSOUL_STAGE5: StyleStage5Bundle = {
    personas: NEO_SOUL_PERSONAS,
    fractal:  NEO_SOUL_FRACTAL,
    approachDownProb: 0.75,
    drum:     NEO_SOUL_DRUM_GRID,
};

const JAZZ_STAGE5: StyleStage5Bundle = {
    personas: CHILL_JAZZ_PERSONAS,
    fractal:  CHILL_JAZZ_FRACTAL,
    approachDownProb: 0.45,
    drum:     CHILL_JAZZ_DRUM_GRID,
};

const STYLE_STAGE5_BUNDLES: StyleStage5Bundle[] = [];
STYLE_STAGE5_BUNDLES[StyleId.POP]   = POP_STAGE5;
STYLE_STAGE5_BUNDLES[StyleId.RNB]   = NEOSOUL_STAGE5;
STYLE_STAGE5_BUNDLES[StyleId.JAZZ]  = JAZZ_STAGE5;
STYLE_STAGE5_BUNDLES[StyleId.BLUES] = JAZZ_STAGE5;  // C.1 stub

export function getStyleStage5Bundle(styleId: StyleId): StyleStage5Bundle {
    const bundle = STYLE_STAGE5_BUNDLES[styleId];
    return bundle !== undefined ? bundle : POP_STAGE5;
}
