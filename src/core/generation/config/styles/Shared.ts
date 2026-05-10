// ============================================================
// Shared.ts — 共享和声进行池 + 默认 16-grid 鼓概率
// ============================================================
// 直接移植自参考代码 styles/Shared.ts
//   - DefaultHarmony：Pop / Neo-Soul 共享的罗马数字进行池（major / minor 双模式）
//   - defaultDrumProbabilities：16 个 16 分网格 × 5 列（kick / snare / hihat / vel-min / vel-max）
//
// 段落 key：使用小写字符串 'intro'/'verse'/'preChorus'/'chorus'/'outro'
// 与参考 SectionType 字符串枚举对齐；HarmonyCore 查表时 sec.name.toLowerCase()。
// ============================================================

export interface StyleHarmonyPool {
    major: Record<string, string[][]>;
    minor: Record<string, string[][]>;
}

export const DefaultHarmony: StyleHarmonyPool = {
    major: {
        intro:     [['I', 'IVmaj7', 'I', 'IVmaj7'], ['vi', 'IV', 'I', 'V']],
        verse:     [['I', 'vi', 'IV', 'V'], ['I', 'V', 'vi', 'IV'], ['I', 'IV', 'ii', 'V']],
        preChorus: [['ii', 'V', 'I', 'vi'], ['IV', 'V', 'iii', 'vi']],
        chorus:    [['I', 'V', 'vi', 'IV'], ['IVmaj7', 'V', 'iii', 'vi'], ['I', 'V/VII', 'vi', 'I/V', 'IV', 'I/III', 'ii', 'V']],
        bridge:    [['vi', 'IV', 'I', 'V'], ['ii', 'V', 'I', 'I']],
        outro:     [['IV', 'iv', 'I', 'I'], ['vi', 'V', 'IV', 'I']],
    },
    minor: {
        intro:     [['i', 'VI', 'i', 'VI'], ['i', 'v', 'VI', 'VII']],
        verse:     [['i', 'VI', 'III', 'VII'], ['i', 'iv', 'v', 'i'], ['i', 'VII', 'VI', 'v']],
        preChorus: [['iv', 'v', 'i', 'i'], ['VI', 'VII', 'i', 'i']],
        chorus:    [['VI', 'VII', 'i', 'v'], ['i', 'VI', 'III', 'VII'], ['VI', 'VII', 'III', 'VI', 'iiø', 'V7', 'i', 'i']],
        bridge:    [['VI', 'VII', 'i', 'v'], ['iv', 'V', 'i', 'i']],
        outro:     [['VI', 'iv', 'i', 'i'], ['i', 'v', 'i', 'i']],
    },
};

export const ChillJazzHarmony: StyleHarmonyPool = {
    major: {
        intro:     [['ii7', 'V7', 'Imaj7', 'Imaj7'], ['Imaj7', 'vi7', 'ii7', 'V7']],
        verse:     [['Imaj7', 'vi7', 'ii7', 'V7'], ['ii7', 'V7', 'Imaj7', 'VI7'], ['IVmaj7', 'iii7', 'ii7', 'Imaj7']],
        preChorus: [['ii7', 'V7', 'iii7', 'vi7'], ['IVmaj7', 'V7', 'iii7', 'VI7']],
        chorus:    [['IVmaj7', 'V7', 'iii7', 'vi7', 'ii7', 'V7', 'Imaj7', 'I7'], ['Imaj7', 'IVmaj7', 'iii7', 'vi7'], ['ii7', 'V7', 'Imaj7', 'VI7']],
        bridge:    [['IVmaj7', 'V7', 'iii7', 'vi7'], ['ii7', 'V7', 'Imaj7', 'I7']],
        outro:     [['IVmaj7', 'iv7', 'Imaj7', 'Imaj7'], ['ii7', 'V7', 'Imaj7', 'Imaj7']],
    },
    minor: {
        intro:     [['i7', 'iv7', 'i7', 'v7'], ['i7', 'VImaj7', 'i7', 'V7']],
        verse:     [['i7', 'iv7', 'VII7', 'IIImaj7'], ['i7', 'VImaj7', 'iiø7', 'V7'], ['VImaj7', 'V7', 'i7', 'i7']],
        preChorus: [['iv7', 'VII7', 'IIImaj7', 'VImaj7'], ['iiø7', 'V7', 'i7', 'I7']],
        chorus:    [['VImaj7', 'VII7', 'i7', 'v7'], ['i7', 'VImaj7', 'IIImaj7', 'VII7'], ['VImaj7', 'VII7', 'IIImaj7', 'VImaj7', 'iiø7', 'V7', 'i7', 'i7']],
        bridge:    [['iiø7', 'V7', 'i7', 'i7'], ['VImaj7', 'VII7', 'IIImaj7', 'VImaj7']],
        outro:     [['VImaj7', 'iv7', 'i7', 'i7'], ['i7', 'V7', 'i7', 'i7']],
    },
};

// 16-grid × 5 列：[kickProb, snareProb, hihatProb, velMin, velMax]
// 直接移植参考 defaultDrumProbabilities（参考是 0~127 速度，本工程速度归一到 0~1，velMin/Max 由各风格 drumPatterns 重写覆盖）
export const defaultDrumProbabilities: number[][] = [
    [1.0, 0.0, 0.4, 60, 80], [0.0, 0.0, 0.3, 30, 50], [0.1, 0.0, 0.6, 40, 60], [0.0, 0.0, 0.2, 30, 50],
    [0.0, 1.0, 0.5, 70, 90], [0.0, 0.0, 0.2, 30, 50], [0.2, 0.0, 0.5, 40, 60], [0.0, 0.0, 0.3, 30, 50],
    [0.6, 0.0, 0.4, 60, 80], [0.0, 0.0, 0.3, 30, 50], [0.1, 0.0, 0.5, 40, 60], [0.0, 0.0, 0.2, 30, 50],
    [0.0, 1.0, 0.5, 70, 90], [0.0, 0.0, 0.2, 30, 50], [0.1, 0.3, 0.5, 40, 60], [0.1, 0.0, 0.3, 30, 50],
];
