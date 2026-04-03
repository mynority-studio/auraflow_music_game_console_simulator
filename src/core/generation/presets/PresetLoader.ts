import { GenerationParams, getDefaultParams } from '../types';

/**
 * 深度合并风格预设到默认参数。
 * override 中未定义的字段保留 base 的值。
 * 仅合并两层（顶层 key + 嵌套对象 key），不做递归无限深度合并。
 *
 * P-1 合规：不使用 Map/Set
 * S-3 合规：纯同步函数
 */
export function mergeParams(base: GenerationParams, override: Partial<GenerationParams>): GenerationParams {
    const result: GenerationParams = {
        global: { ...base.global, ...(override.global || {}) },
        harmony: { ...base.harmony, ...(override.harmony || {}) },
        harmonyRules: { ...base.harmonyRules, ...(override.harmonyRules || {}) },
        rhythm: { ...base.rhythm, ...(override.rhythm || {}) },
        melody: { ...base.melody, ...(override.melody || {}) },
        contrast: { ...base.contrast, ...(override.contrast || {}) },
        modulation: { ...base.modulation, ...(override.modulation || {}) },
        orchestration: {
            ...base.orchestration,
            ...(override.orchestration || {}),
            // mixingPreferences 需要单独深度合并
            mixingPreferences: {
                ...base.orchestration.mixingPreferences,
                ...(override.orchestration?.mixingPreferences || {}),
            },
        },
    };

    // 如果 override.orchestration 存在但没有 mixingPreferences，不覆盖 base 的
    if (override.orchestration && !override.orchestration.mixingPreferences) {
        result.orchestration.mixingPreferences = base.orchestration.mixingPreferences;
    }

    return result;
}

/**
 * 从默认参数 + 风格预设创建最终参数。
 * 这是调用方的便捷入口。
 */
export function createParams(preset?: Partial<GenerationParams>): GenerationParams {
    if (!preset) return getDefaultParams();
    return mergeParams(getDefaultParams(), preset);
}
