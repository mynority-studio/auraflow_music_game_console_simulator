// ============================================================
// ImproCore engine — grammar 加载(app 侧,预编译 ROM)
// ============================================================
//
// 从 data/grammars.rom(85 .grammar 编译成的无损二进制,base64 内联)解出
// GrammarData,经 Grammar.fromData 重建。等价于旧的 .grammar ?raw 文本路径,
// 但 bundle 体积更小(4.8MB 文本 → 1.3MB base64)。
//
// 无损性已由 __harness__/grammar-rom-equiv 验证:全 85 grammar × 5 种子,
// fromData(ROM) 与 fromText(原文本)生成逐字节一致。
// (Node/tsx 测试不走这里,直接 Grammar.fromText/fromData(fs 读)。)
// ============================================================

import { Grammar } from './grammar';
import { ALL_GRAMMAR_DATA_MAP, getGrammarData } from '../data/grammar-rom-reader';

/** 全部 grammar 名(字母序;过滤掉占位/下划线开头的)*/
export const ALL_GRAMMAR_NAMES: string[] = [...ALL_GRAMMAR_DATA_MAP.keys()]
    .filter(n => !n.startsWith('_'))
    .sort();

const cache = new Map<string, Grammar>();

/** 按名取 Grammar(从 ROM 解出 GrammarData → fromData,缓存)*/
export function getGrammar(name: string): Grammar | null {
    const cached = cache.get(name);
    if (cached) return cached;
    const data = getGrammarData(name);
    if (!data) return null;
    const g = Grammar.fromData(data);
    cache.set(name, g);
    return g;
}
