// ============================================================
// MgEngineVariantStore — mg / mgV3 二变体切换(2026-05-28)
// ============================================================
//
// V1 = mg(从 ~/vibe_coding/melodygenerative byte-identical 移植,baseline,不动)
// V3 = mgCoreV3(新沙箱,做另一个实验。mgCoreV2 已废弃删除)
//
// Q+H 控制面板切换,runPipeline 按当前 variant dispatch。
// ============================================================

export type MgEngineVariant = 'mg' | 'mgV3';

export const MG_ENGINE_VARIANTS: ReadonlyArray<{ id: MgEngineVariant; label: string }> = [
    { id: 'mg',   label: 'mg' },
    { id: 'mgV3', label: 'mgV3' },
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
