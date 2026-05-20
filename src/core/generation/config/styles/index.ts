/**
 * Styles barrel — StyleId → 和声配置二件套（rules / voice leading）+ BPM 范围
 *
 * Phase 6：StyleHarmonyBundle 已从 "matrix + sectionStartWeights" 重构为
 * "harmonyRules" — 由 MacroProgressionEngine 消费做代数推演（无字典拼接）。
 *
 * 这是 runPipeline Stage 3 注入 HarmonyCore 的入口。新增 / 替换风格只需修改本文件 + 对应配置。
 */

import { StyleId } from '../StyleFlags';
import { MusicianPersona, StructureTemplate } from '../../types';
import { VoiceLeadingConfig } from '../../pipeline/HarmonyCore';
import { HarmonyRulesConfig } from '../../pipeline/MacroProgressionEngine';
import { FractalConfig } from '../../primitives/FractalStructureEngine';
import { GrammarConfig } from '../../primitives/PCFGGrammarEngine';
import { DrumGridConfig } from '../../primitives/DrumIdiom';
import {
    MODERN_POP_HARMONY_RULES,
    MODERN_POP_VOICE_LEADING,
    MODERN_POP_PERSONAS,
    MODERN_POP_FRACTAL,
    MODERN_POP_GRAMMAR,
    MODERN_POP_DRUM_GRID,
    MODERN_POP_STRUCTURES,
} from './ModernPop';
import {
    NEO_SOUL_HARMONY_RULES,
    NEO_SOUL_VOICE_LEADING,
    NEO_SOUL_PERSONAS,
    NEO_SOUL_FRACTAL,
    NEO_SOUL_GRAMMAR,
    NEO_SOUL_DRUM_GRID,
    NEO_SOUL_STRUCTURES,
} from './NeoSoul';
import {
    CHILL_JAZZ_HARMONY_RULES,
    CHILL_JAZZ_VOICE_LEADING,
    CHILL_JAZZ_PERSONAS,
    CHILL_JAZZ_FRACTAL,
    CHILL_JAZZ_GRAMMAR,
    CHILL_JAZZ_DRUM_GRID,
    CHILL_JAZZ_STRUCTURES,
} from './ChillJazz';

export interface StyleHarmonyBundle {
    /** Phase 6 — 代数推演规则（取代旧 ChordTransitionMatrix + SectionStartWeights） */
    harmonyRules: HarmonyRulesConfig;
    voiceLeading: VoiceLeadingConfig;
    /** BPM 范围（min, max） */
    bpmRange: [number, number];
    /** 曲式模板池（Phase 3 结构剥离） */
    structureTemplates: StructureTemplate[];
    /** 单和弦持续拍数（Pop/Jazz 每小节 1 个 = 4；NeoSoul 两小节 1 个 = 8） */
    beatsPerChord: number;
}

const POP_BUNDLE: StyleHarmonyBundle = {
    harmonyRules: MODERN_POP_HARMONY_RULES,
    voiceLeading: MODERN_POP_VOICE_LEADING,
    bpmRange: [88, 128],
    beatsPerChord: 4,
    structureTemplates: MODERN_POP_STRUCTURES,
};

const NEOSOUL_BUNDLE: StyleHarmonyBundle = {
    harmonyRules: NEO_SOUL_HARMONY_RULES,
    voiceLeading: NEO_SOUL_VOICE_LEADING,
    bpmRange: [78, 100],
    beatsPerChord: 8,
    structureTemplates: NEO_SOUL_STRUCTURES,
};

const JAZZ_BUNDLE: StyleHarmonyBundle = {
    harmonyRules: CHILL_JAZZ_HARMONY_RULES,
    voiceLeading: CHILL_JAZZ_VOICE_LEADING,
    bpmRange: [70, 105],
    beatsPerChord: 4,
    structureTemplates: CHILL_JAZZ_STRUCTURES,
};

/** 数值索引查找表（T-1 合规 — enum 比较，无字符串分类） */
const STYLE_HARMONY_BUNDLES: StyleHarmonyBundle[] = [];
STYLE_HARMONY_BUNDLES[StyleId.POP] = POP_BUNDLE;
STYLE_HARMONY_BUNDLES[StyleId.RNB]   = NEOSOUL_BUNDLE;
STYLE_HARMONY_BUNDLES[StyleId.JAZZ] = JAZZ_BUNDLE;

export function getStyleHarmonyBundle(styleId: StyleId): StyleHarmonyBundle {
    const bundle = STYLE_HARMONY_BUNDLES[styleId];
    if (bundle === undefined) {
        // 兜底到 Pop（永远不该到达，但避免 undefined.matrix 崩）
        return POP_BUNDLE;
    }
    return bundle;
}

// ============================================================
// Stage 5 Bundle — 与 StyleHarmonyBundle 并列（L-2 阶段独立性）
// ============================================================
//
// 设计原则：
//   - Stage 3 (HarmonyCore) 不应看见 Stage 5 (Layering) 的配置。两者用独立 bundle。
//   - personas 长度 === ROLE_COUNT (4: Bass/Accomp/Lead/Drums)，下标必须与
//     Stage5Layering.ts 中的 ROLE_BASS / ROLE_ACCOMP / ROLE_LEAD / ROLE_DRUMS 对齐。
//   - drum 字段独立于 personas 的 dynamicRange — DrumIdiom 完全由 grid + energy scale 控制
//     velocity，persona.dynamicRange 仅作为参考记录（未来 Phase 6 IdiomDispatcher 可能消费）。
// ============================================================

export interface StyleStage5Bundle {
    /** 长度 === ROLE_COUNT (4)，下标对齐 ROLE_BASS=0 / ROLE_ACCOMP=1 / ROLE_LEAD=2 / ROLE_DRUMS=3 */
    personas: MusicianPersona[];
    /** Lead 用 — FractalStructureEngine 的概率桶配置 */
    fractal: FractalConfig;
    /** Lead 用 — PCFGGrammarEngine 的规则集（kind-based，Phase 6） */
    grammar: GrammarConfig;
    /**
     * Lead 用 — ToplineEngine approachTone 走下方半音 vs 上方调内音的概率（Phase 6）
     * Pop ≈ 0.5（均衡）/ Jazz ≈ 0.45（略偏上行）/ NeoSoul ≈ 0.75（下方半音主导）
     */
    approachDownProb: number;
    /** Drums 用 — DrumIdiom 16-step grid + Energy 缩放曲线 */
    drum: DrumGridConfig;
}

const POP_STAGE5: StyleStage5Bundle = {
    personas: MODERN_POP_PERSONAS,
    fractal:  MODERN_POP_FRACTAL,
    grammar:  MODERN_POP_GRAMMAR,
    approachDownProb: 0.5,
    drum:     MODERN_POP_DRUM_GRID,
};

const NEOSOUL_STAGE5: StyleStage5Bundle = {
    personas: NEO_SOUL_PERSONAS,
    fractal:  NEO_SOUL_FRACTAL,
    grammar:  NEO_SOUL_GRAMMAR,
    approachDownProb: 0.75,
    drum:     NEO_SOUL_DRUM_GRID,
};

const JAZZ_STAGE5: StyleStage5Bundle = {
    personas: CHILL_JAZZ_PERSONAS,
    fractal:  CHILL_JAZZ_FRACTAL,
    grammar:  CHILL_JAZZ_GRAMMAR,
    approachDownProb: 0.45,
    drum:     CHILL_JAZZ_DRUM_GRID,
};

const STYLE_STAGE5_BUNDLES: StyleStage5Bundle[] = [];
STYLE_STAGE5_BUNDLES[StyleId.POP] = POP_STAGE5;
STYLE_STAGE5_BUNDLES[StyleId.RNB]   = NEOSOUL_STAGE5;
STYLE_STAGE5_BUNDLES[StyleId.JAZZ] = JAZZ_STAGE5;

export function getStyleStage5Bundle(styleId: StyleId): StyleStage5Bundle {
    const bundle = STYLE_STAGE5_BUNDLES[styleId];
    if (bundle === undefined) {
        // 兜底到 Pop（永远不该到达；与 getStyleHarmonyBundle 行为一致）
        return POP_STAGE5;
    }
    return bundle;
}
