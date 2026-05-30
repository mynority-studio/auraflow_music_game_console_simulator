// ============================================================
// ImproCore engine — style 加载(app 侧,Vite glob 145 个 .sty)
// ============================================================

import { parseStyle, type Style } from './style';

const modules = import.meta.glob('./styles/*.sty', {
    query: '?raw', eager: true, import: 'default',
}) as Record<string, string>;

const TEXT_BY_NAME = new Map<string, string>();
for (const [path, text] of Object.entries(modules)) {
    const name = path.split('/').pop()!.replace(/\.sty$/, '');
    TEXT_BY_NAME.set(name, text);
}

export const ALL_STYLE_NAMES: string[] = [...TEXT_BY_NAME.keys()].sort();

const cache = new Map<string, Style>();

export function getStyle(name: string): Style | null {
    const cached = cache.get(name);
    if (cached) return cached;
    const text = TEXT_BY_NAME.get(name);
    if (!text) return null;
    try {
        const s = parseStyle(text);
        cache.set(name, s);
        return s;
    } catch {
        return null;
    }
}
