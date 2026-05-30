// ============================================================
// ImproCore engine — grammar 加载(app 侧,Vite glob 85 个 .grammar)
// ============================================================
//
// 把 data/grammars/*.grammar 作为 ?raw 文本内联进 bundle,按名取 Grammar。
// (Node/tsx 测试不走这里,直接 Grammar.fromText(fs 读)。)
// ============================================================

import { Grammar } from './grammar';

const modules = import.meta.glob('../data/grammars/*.grammar', {
    query: '?raw', eager: true, import: 'default',
}) as Record<string, string>;

const TEXT_BY_NAME = new Map<string, string>();
for (const [path, text] of Object.entries(modules)) {
    const name = path.split('/').pop()!.replace(/\.grammar$/, '');
    TEXT_BY_NAME.set(name, text);
}

/** 全部 grammar 名(字母序;过滤掉占位/下划线开头的)*/
export const ALL_GRAMMAR_NAMES: string[] = [...TEXT_BY_NAME.keys()]
    .filter(n => !n.startsWith('_'))
    .sort();

const cache = new Map<string, Grammar>();

/** 按名取 Grammar(解析后缓存)*/
export function getGrammar(name: string): Grammar | null {
    const cached = cache.get(name);
    if (cached) return cached;
    const text = TEXT_BY_NAME.get(name);
    if (!text) return null;
    const g = Grammar.fromText(text);
    cache.set(name, g);
    return g;
}
