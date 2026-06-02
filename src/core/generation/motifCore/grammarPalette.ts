// ============================================================
// motifCore — Grammar 调色板(按实测密度分级)
// ============================================================
//
// topline 不要 bebop 的密集跑动(8-15 音/bar)。这里按实测音休比/密度,
// 只暴露「抒情/中疏」的 grammar 当 motif 来源,排除 bebop/hard-bop 密集系。
// 数据源:__probe__/grammar-density-rank.ts(density=音/bar,实测 8-bar ii-V)。
// ============================================================

import { ALL_GRAMMAR_NAMES } from '../improCore/engine';

/** 抒情/中疏 grammar(实测 ≤ ~5 音/bar,留白足):适合做 topline 主旋律。
 *  按疏→密大致排序,默认取最抒情的 MilesDavis。 */
export const LYRICAL_GRAMMARS: readonly string[] = [
    'MilesDavis',        // 3.4 音/bar avgDur=113 — 最抒情,留白美学
    'ChetBaker',         // 3.5 — cool 抒情
    'WayneShorter',      // 3.6 — modal 抒情
    'GrantGreen',        // 3.9
    'BlueMitchell',      // 4.4
    'BillEvans',         // 4.5 — 钢琴抒情
    'OliverNelson',      // 4.5
    'BixBeiderbecke',    // 4.5
    'KennyDorham',       // 4.5
    'GerryMulligan',     // 4.7 — cool/baritone
    'KennyGarrett',      // 4.7
    'ArtFarmer',         // flugelhorn 抒情
    'TomHarrell',        // 抒情
    'StanGetz',          // cool tenor
];

/** 面板可选的 grammar:白名单 ∩ 实际存在的(防 ROM 缺某个)。 */
export const TOPLINE_GRAMMARS: readonly string[] =
    LYRICAL_GRAMMARS.filter(n => ALL_GRAMMAR_NAMES.includes(n));

/** 默认 grammar(最抒情;若不存在则取白名单第一个可用)。 */
export const DEFAULT_GRAMMAR: string = TOPLINE_GRAMMARS[0] ?? ALL_GRAMMAR_NAMES[0] ?? '';
