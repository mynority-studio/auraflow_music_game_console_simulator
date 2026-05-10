// ============================================================
// 🚧 STUB — 跨系统对比日志器占位
// ============================================================
//
// 历史功能：
//   buildComparisonLog() 用于把生成结果序列化成固定格式的 ASCII 日志，
//   便于与 C 移植版 / 其他算法系统做 A/B 比对（SONG_COMPARISON_LOG_SPEC.md）。
//   报告结构：META / TRACKS / STRUCTURE / MELODY STATS / HARMONY。
//
// 重构期占位行为：
//   返回单行占位字符串。AuraRadio 在 comparisonMode 下会 console.log 这一行。
//
// 重构方向：
//   新引擎产出有效 GeneratedTrack 后，恢复完整统计逻辑（参考 git 历史里旧版实现）。
// ============================================================

import { GeneratedTrack } from '../types';

export interface ComparisonLogInput {
    seed: number;
    styleName: string;
    track: GeneratedTrack;
    engineName?: string;
}

export function buildComparisonLog(input: ComparisonLogInput): string {
    const engineName = input.engineName ?? 'AuraFlow';
    return `[${engineName}] seed=${input.seed} style=${input.styleName} (stub: full comparison log disabled during refactor)`;
}
