export enum StyleId {
    ModernPop = 0,
    Synthwave = 9,
    LofiChill = 17,

    // ── App 层兼容别名 ──
    Default = ModernPop,          // 旧版 Default → ModernPop
    DarkSynthPop = Synthwave,     // 旧版 DarkSynthPop → Synthwave
    LoFiChill = LofiChill,        // 旧版 LoFiChill(大写 F) → LofiChill
}

export const StyleIdName: Record<StyleId, string> = {
    [StyleId.ModernPop]: '现代华语流行 (Modern C-Pop)',
    [StyleId.Synthwave]: '合成器浪潮 (Synthwave)',
    [StyleId.LofiChill]: '放松低保真 (Lo-Fi Chill)'
};
