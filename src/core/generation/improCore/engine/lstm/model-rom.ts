// model-rom.ts — app(浏览器/Vite)侧的 connectome 加载。
//   glob 出 models/<名>/{manifest.json, model.q8.bin},按需 fetch + 反量化并缓存。
//   (Node/tsx 测试不走这里,直接 fs 读 + loadModel。)

import { loadModel, type LoadedModel, type ModelManifest } from './q8';

const manifests = import.meta.glob('./models/*/manifest.json', {
    eager: true, import: 'default',
}) as Record<string, ModelManifest>;

const binUrls = import.meta.glob('./models/*/model.q8.bin', {
    query: '?url', eager: true, import: 'default',
}) as Record<string, string>;

/** path '.../models/CliffordBrown/manifest.json' → 'CliffordBrown' */
function nameOf(path: string): string {
    const m = path.match(/models\/([^/]+)\//);
    return m ? m[1]! : path;
}

const MANIFEST_BY_NAME = new Map<string, ModelManifest>();
const URL_BY_NAME = new Map<string, string>();
for (const [path, man] of Object.entries(manifests)) MANIFEST_BY_NAME.set(nameOf(path), man);
for (const [path, url] of Object.entries(binUrls)) URL_BY_NAME.set(nameOf(path), url);

/** 全部可用 connectome 名(字母序) */
export const ALL_CONNECTOME_NAMES: string[] = [...MANIFEST_BY_NAME.keys()].sort();

const cache = new Map<string, LoadedModel>();

/** 按名异步加载 connectome(fetch bin → 反量化),结果缓存 */
export async function getConnectome(name: string): Promise<LoadedModel> {
    const cached = cache.get(name);
    if (cached) return cached;

    const manifest = MANIFEST_BY_NAME.get(name);
    const url = URL_BY_NAME.get(name);
    if (!manifest || !url) throw new Error(`LSTM: 未找到 connectome ${name}`);

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`LSTM: 加载 ${name} 失败 ${resp.status}`);
    const blob = new Uint8Array(await resp.arrayBuffer());
    const model = loadModel(manifest, blob);
    cache.set(name, model);
    return model;
}
