// ============================================================
// improCore — Grammar ROM 公开入口(2026-05-27 wipe music engines)
// ============================================================
//
// 历史:本目录原承载完整 Impro-Visor 移植引擎(lick-gen / voicing-generator
//        / sty-parser / fv-parser / 145 styles / 19 voicings 等)。
//        2026-05-27 全 engine 物理删除,只保留 85 grammar 的压缩 ROM
//        + 解码工具链,作为未来新引擎的资产。
//
// 公开 API:
//   ALL_GRAMMAR_DATA_MAP   — Map<grammarName, GrammarData>(85 个 grammar 解码后索引)
//   ALL_GRAMMAR_DATA_NAMES — sorted string[](UI dropdown 用)
//   getGrammarData(name)   — lookup helper
//
// 类型:
//   GrammarData / GrammarRule / GrammarToken(供新引擎类型标注用)
//
// 调用示例:
//   import { getGrammarData, ALL_GRAMMAR_DATA_NAMES } from '../core/generation/improCore';
//   const g = getGrammarData('jazz-medium-comping');
//   if (g) { ... walk g.rules / g.startSymbol / g.parameters ... }
//
// 详细数据结构 / 调用契约见 ./README.md。
// ============================================================

export {
    ALL_GRAMMAR_DATA_MAP,
    ALL_GRAMMAR_DATA_NAMES,
    getGrammarData,
} from './data/grammar-rom-reader';

export type {
    GrammarData,
    GrammarRule,
    GrammarToken,
} from './data/grammar-parser';
