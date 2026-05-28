// ============================================================
// MgEngineVariantStore — mg / mgV2 二变体切换(2026-05-28)
// ============================================================
//
// V1 = mg(从 ~/vibe_coding/melodygenerative byte-identical 移植,不动)
// V2 = mgCoreV2(沙箱,做 MMA dimensional / kernel synthesis 实验)
//
// Q+H 控制面板切换,runPipeline 按当前 variant dispatch。
// ============================================================

export type MgEngineVariant = 'mg' | 'mgV2';

export const MG_ENGINE_VARIANTS: ReadonlyArray<{ id: MgEngineVariant; label: string }> = [
    { id: 'mg',   label: 'mg' },
    { id: 'mgV2', label: 'mgV2' },
];

let _variant: MgEngineVariant = 'mg';

export const MgEngineVariantStore = {
    getVariant(): MgEngineVariant {
        return _variant;
    },
    setVariant(v: MgEngineVariant): void {
        _variant = v;
    },
};
