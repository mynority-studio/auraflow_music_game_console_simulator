// ============================================================
// synthBackend — 合成后端单一判据（M1 批2，E5）
// ------------------------------------------------------------
// copych WASM 后端 = feature flag 显式开启（POC 不改默认行为）：
//   ① URL ?synth=copych（优先，便于 A/B 分享链接）
//   ② localStorage 'auraflow.synthBackend' = 'copych'
//   默认 'spessa'（SpessaSynth 现状路径零改动）。
// ★ CC95 三入口分流（MidiScheduler loadTrack echo 展开 / dispatchEvent 吞 /
//   AudioEngine.controllerChange 吞）与 panic 路径都必须经此单一判据，
//   禁止散落 if（计划修订1）。
// ============================================================

export type SynthBackendKind = 'spessa' | 'copych';

const STORAGE_KEY = 'auraflow.synthBackend';

let _cached: SynthBackendKind | null = null;

export function getSynthBackend(): SynthBackendKind {
    if (_cached) return _cached;
    let kind: SynthBackendKind = 'spessa';
    try {
        const fromUrl = new URLSearchParams(window.location.search).get('synth');
        if (fromUrl === 'copych' || fromUrl === 'spessa') {
            kind = fromUrl;
            try { window.localStorage.setItem(STORAGE_KEY, kind); } catch { /* ignore */ }
        } else {
            const stored = window.localStorage.getItem(STORAGE_KEY);
            if (stored === 'copych') kind = 'copych';
        }
    } catch { /* SSR/无 window → spessa */ }
    _cached = kind;
    return kind;
}

export const isCopychBackend = (): boolean => getSynthBackend() === 'copych';
