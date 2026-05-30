// ============================================================
// ImproCore engine — transform 加载(app 侧,Vite glob .transform)
// ============================================================

import { parseTransform, type Substitution } from './transform';

const modules = import.meta.glob('./transforms/*.transform', {
    query: '?raw', eager: true, import: 'default',
}) as Record<string, string>;

const TEXT_BY_NAME = new Map<string, string>();
for (const [path, text] of Object.entries(modules)) {
    const name = path.split('/').pop()!.replace(/\.transform$/, '');
    TEXT_BY_NAME.set(name, text);
}

export const ALL_TRANSFORM_NAMES: string[] = [...TEXT_BY_NAME.keys()].sort();

const cache = new Map<string, Substitution[]>();

export function getTransform(name: string): Substitution[] | null {
    const cached = cache.get(name);
    if (cached) return cached;
    const text = TEXT_BY_NAME.get(name);
    if (!text) return null;
    try {
        const subs = parseTransform(text);
        cache.set(name, subs);
        return subs;
    } catch {
        return null;
    }
}
