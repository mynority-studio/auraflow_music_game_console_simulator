// ============================================================
// synthBackend — 合成后端单一判据（M1 批2 建立；默认值口径 2026-07-09 用户拍板）
// ------------------------------------------------------------
// **默认 = copych**（设备同款引擎；模拟器定位=嵌入式镜像参考，默认即设备之声）。
// 覆盖优先级：① URL ?synth=copych|spessa（最高，便于 A/B 分享链接，命中即持久化）
//            ② localStorage 'auraflow.synthBackend'（顶部导航合成器菜单写入）
//            ③ 默认 'copych'。
// ★ CC95 三入口分流（MidiScheduler loadTrack echo 展开 / dispatchEvent 吞 /
//   AudioEngine.controllerChange 吞）与 panic 路径都必须经此单一判据，
//   禁止散落 if（M1 计划修订1）。
// ============================================================

export type SynthBackendKind = 'spessa' | 'copych';

const STORAGE_KEY = 'auraflow.synthBackend';
const DEFAULT_BACKEND: SynthBackendKind = 'copych';

const isBackendKind = (v: string | null): v is SynthBackendKind => v === 'copych' || v === 'spessa';

let _cached: SynthBackendKind | null = null;

export function getSynthBackend(): SynthBackendKind {
    if (_cached) return _cached;
    let kind: SynthBackendKind = DEFAULT_BACKEND;
    try {
        const fromUrl = new URLSearchParams(window.location.search).get('synth');
        if (isBackendKind(fromUrl)) {
            kind = fromUrl;
            try { window.localStorage.setItem(STORAGE_KEY, kind); } catch { /* ignore */ }
        } else {
            const stored = window.localStorage.getItem(STORAGE_KEY);
            if (isBackendKind(stored)) kind = stored;
        }
    } catch { /* 非浏览器环境（vitest node 等）→ 默认 */ }
    _cached = kind;
    return kind;
}

/** 更新判据缓存并持久化后端偏好（合成器实例重建由 SynthManager.setSynthBackendKind 负责）。 */
export function setSynthBackendPref(kind: SynthBackendKind): void {
    _cached = kind;
    try { window.localStorage.setItem(STORAGE_KEY, kind); } catch { /* ignore */ }
}

export const isCopychBackend = (): boolean => getSynthBackend() === 'copych';
