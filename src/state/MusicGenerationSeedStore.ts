// ============================================================
// MusicGenerationSeedStore — Q+N 音乐生成 seed(qn_main_engine_takeover §7.3)
// ------------------------------------------------------------
// 取代旧 MgSeedStore。用户输入字母数字 seed → hashSeedToInt → Q+N number seed。
// ============================================================

let _suffix: string = '42';

export const MusicGenerationSeedStore = {
    getSuffix(): string { return _suffix; },
    setSuffix(suffix: string): void { _suffix = suffix || '0'; },
    /** Q+N number seed(字符串输入 → uint32 哈希)。 */
    getSeedNumber(): number { return hashSeedToInt(_suffix); },
};

/** 字符串 → uint32 哈希(djb2 变种,(h<<5)-h+charCode)。Q+N number seed 用。 */
export function hashSeedToInt(seed: string): number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
        h = (h << 5) - h + seed.charCodeAt(i);
        h = h & h;
    }
    return h >>> 0;
}
