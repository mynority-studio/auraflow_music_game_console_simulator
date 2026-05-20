/**
 * HarmonyCore — 和声推演入口(Phase 1 重构后)
 *
 * 本模块在 Phase 1 之后退化为薄 facade,真正的工作分别委托:
 *   1. 和弦推演 → MacroProgressionEngine(代数推演,T-S-D 马尔可夫 + 4 变异门)
 *   2. 声部排列 → VoicingProcessor.computeSATBVoicings(原本的 voice-leading 大套规则)
 *   3. Fallback voicing → VoicingProcessor.computeFallbackVoicing(给 PassingChordEngine)
 *
 * 历史:
 *   - Phase 6 之前,HarmonyCore 内嵌字典化推演 + voicing(681 行,职责重)
 *   - Phase 6:推演下沉到 MacroProgressionEngine
 *   - Phase 1 重构:voicing 下沉到 VoicingProcessor(连带 RootlessVoicer 一并合并)
 *
 * 风格无关:HarmonyCore 不认识 Pop / Jazz,所有风格差异通过 VoiceLeadingConfig +
 *   HarmonyRulesConfig 注入。
 *
 * Pitch Space: RELATIVE(K-1 / K-7)— voicings 仍在相对空间,AbsoluteTransposer 后续才加 keyOffset。
 *
 * VoiceLeadingConfig 仍从本模块导出(向后兼容 style 配置文件的 import 路径),
 *   实际定义已迁移至 VoicingProcessor。新代码请直接从 primitives/VoicingProcessor 导入。
 */

import {
    GeneratedChord, SectionMetadata, Tonality,
} from '../types';
import type { VoicedPitch } from '../types';
import { VoicingProcessor } from '../primitives/VoicingProcessor';
import type { VoiceLeadingConfig } from '../primitives/VoicingProcessor';
import {
    MacroProgressionEngine, HarmonyRulesConfig,
} from './MacroProgressionEngine';

// 向后兼容 re-export — style 配置文件继续从 HarmonyCore 导入 VoiceLeadingConfig
export type { VoiceLeadingConfig };

// ============================================================
// HarmonyCore 输入 / 输出
// ============================================================

export interface HarmonyCoreInput {
    sections: SectionMetadata[];
    tonality: Tonality;
    harmonyRules: HarmonyRulesConfig;
    voiceLeadingConfig: VoiceLeadingConfig;
    /** 每段和弦数 — 默认 4 */
    chordsPerSection?: number;
    /** V4.2c — 风格进行池(来自 styleConfig.harmony)。提供时 MacroProgression 70% 概率从 pool 抽起手 */
    progressionPool?: {
        major: Record<string, string[][]>;
        minor: Record<string, string[][]>;
    };
}

/**
 * voicings 与 chords 平行索引;voicings[i] 是 chords[i] 的声部分布(升序,相对空间 MIDI)。
 * Pitch Space: RELATIVE
 *
 * Phase 1a — voicings 升级为 VoicedPitch[][](携带 VoiceRole 角色标记),
 * Phase 1b VoicingMask 按角色 bitmask 过滤。
 * 老 callsite 取裸 pitch: `voicings[i].map(v => v.pitch)`。
 */
export interface HarmonyResult {
    chords: GeneratedChord[];
    voicings: VoicedPitch[][];
}

// ============================================================
// HarmonyCore 主类
// ============================================================

export class HarmonyCoreError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'HarmonyCoreError';
        this.context = context;
    }
}

// 内部校验常量(与 VoicingProcessor 内部 VR_COUNT × CT_COUNT 对齐)
const VOICE_ROLE_COUNT = 3;
const CHORD_TONE_ROLE_COUNT = 5;

export class HarmonyCore {
    /**
     * Fallback voicing 计算 — 给 PassingChordEngine 插入的"无 voicing 和弦"用。
     * 委托 VoicingProcessor.computeFallbackVoicing。零 PRNG。
     */
    public static computeFallbackVoicing(chord: GeneratedChord): VoicedPitch[] {
        return VoicingProcessor.computeFallbackVoicing(chord);
    }

    /**
     * 入口:推演和弦序列 + 计算声部连接。
     *
     * PRNG 消耗(Phase 1 重构后不变):
     *   - 推演:每和弦 1 次(起始 / 状态转移 weighted pick,在 MacroProgressionEngine 内)
     *   - 声部:每和弦 voiceCount 次(每个 voice 1 次 pickWeighted,在 VoicingProcessor 内)
     *
     * 输出 voicings 处于 RELATIVE 空间(K-1)。
     */
    public static generate(input: HarmonyCoreInput): HarmonyResult {
        HarmonyCore.validate(input);
        const chords = HarmonyCore.generateProgression(input);
        const voicings = VoicingProcessor.computeSATBVoicings(chords, input.voiceLeadingConfig);
        return { chords, voicings };
    }

    /**
     * 进行推演 — 委托 MacroProgressionEngine 代数推演。
     */
    private static generateProgression(input: HarmonyCoreInput): GeneratedChord[] {
        return MacroProgressionEngine.generate({
            sections: input.sections,
            rules: input.harmonyRules,
            chordsPerSection: input.chordsPerSection,
            tonality: input.tonality,
            progressionPool: input.progressionPool,
        });
    }

    /** S-7:非法输入早期失败 */
    private static validate(input: HarmonyCoreInput): void {
        const cfg = input.voiceLeadingConfig;
        if (cfg.voiceCount < 1) {
            throw new HarmonyCoreError('voiceCount must be >= 1', { actual: cfg.voiceCount });
        }
        if (cfg.voiceRangeLo < 0 || cfg.voiceRangeHi <= cfg.voiceRangeLo) {
            throw new HarmonyCoreError(
                'voiceRangeLo / voiceRangeHi invalid',
                { lo: cfg.voiceRangeLo, hi: cfg.voiceRangeHi },
            );
        }
        const expectedTableLen = VOICE_ROLE_COUNT * CHORD_TONE_ROLE_COUNT;
        if (cfg.voiceRoleScoreTable.length !== expectedTableLen) {
            throw new HarmonyCoreError(
                `voiceRoleScoreTable length must be ${expectedTableLen} (3 voice roles × 5 chord tone roles)`,
                { actual: cfg.voiceRoleScoreTable.length },
            );
        }
    }
}
