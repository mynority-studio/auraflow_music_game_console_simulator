// ============================================================
// PianoVoicingDictionary — 钢琴 voicing 字典(4 本 hand-tuned 表)
// ============================================================
//
// 出处:melodygenerative 4 张 voicing dict —
//   - JAZZ_ROOTLESS_VOICINGS:Bill Evans A 位,适配 tonal-voicing-dictionary
//     (Daniel Gómez Blasco / MIT)的 lefthand 表
//   - POP_VOICINGS:Hal Leonard pop piano + Coldplay/Adele 转抄
//   - RNB_VOICINGS:D'Angelo / Glasper / Erykah Badu 转抄(Neo-Soul cluster)
//   - BLUES_VOICINGS:Otis Spann / Mose Allison / Memphis Slim(boogie/barrelhouse)
//
// 关键设计:**每条 entry 是 listening-validated 的具体音程组合**,
// 而非通用公式派生 — 这是 melodygenerative 钢琴听感"对"的核心数据资源。
//
// 数据组织:
//   PIANO_VOICING_DICTIONARY[dictId][quality] = intervals[] | undefined
//   - intervals 半音数从 chord root 算起(含跨八度,如 14 = 9度)
//   - undefined 表示该 dict 对该 quality 无 hand-tuned entry,调用方回落公式算法
//
// auraflow 当前 ChordQuality 覆盖 17 个值,melodygenerative 覆盖 ~30 个。
// 差集(7#11 / 7alt / m11 / maj13 / 等 jazz 扩展)在 Batch 5 扩 enum 时补齐,
// 本文件内已用 `// TODO Batch 5:` 标注待补条目。
//
// 消费方(Batch 1 暂不接):
//   - Batch 3 主消费:VoicingProcessor.buildRootlessRH 加 dict-first 路径
//   - Batch 7 Solo Piano M8 mode 选 voicing
//
// 零 PRNG。仅依赖 ChordQuality。
//
// Cross-sync:跟 ChordQuality enum 强绑定(§1.4 已涵盖)。
// ============================================================

import { ChordQuality } from '../types';

/** 4 个字典 ID(数值与 VoicingStylePreferences.VoicingDictRef 同步) */
export enum VoicingDictId {
    JazzRootless = 0,
    Pop          = 1,
    Rnb          = 2,
    Blues        = 3,
}

export const VoicingDictCount = 4;

export const VoicingDictName: ReadonlyArray<string> = Object.freeze([
    'JazzRootless', 'Pop', 'Rnb', 'Blues',
]);

// ============================================================
// JAZZ_ROOTLESS — Bill Evans A 位 voicing
// ============================================================
//
// 设计哲学:删 root,让 bass / LH 自己 declare root,RH 专注 3+7+ext。
// 三和弦补 9 度(addColorOnTriad)。
//
// melodygenerative 原表 30 个 chord type 中,auraflow 现有覆盖如下:
//
const JAZZ_ROOTLESS: ReadonlyArray<ReadonlyArray<number> | undefined> = (() => {
    const arr: (ReadonlyArray<number> | undefined)[] = [];
    arr[ChordQuality.Major]          = Object.freeze([4, 7, 14]);          // 3 5 9
    arr[ChordQuality.Major7]         = Object.freeze([4, 7, 11, 14]);      // 3 5 7M 9
    arr[ChordQuality.Major9]         = Object.freeze([4, 7, 11, 14]);      // 同 Major7
    arr[ChordQuality.Add9]           = Object.freeze([4, 7, 14]);
    arr[ChordQuality.Minor]          = Object.freeze([3, 7, 14]);          // b3 5 9
    arr[ChordQuality.Minor7]         = Object.freeze([3, 7, 10, 14]);      // b3 5 b7 9
    arr[ChordQuality.Minor9]         = Object.freeze([3, 7, 10, 14]);      // 同 m7
    arr[ChordQuality.Minor11]        = Object.freeze([3, 10, 14, 17]);     // b3 b7 9 11 (drop 5)
    arr[ChordQuality.Dominant7]      = Object.freeze([4, 9, 10, 14]);      // 3 13 b7 9 (Bill Evans A)
    arr[ChordQuality.Dominant9]      = Object.freeze([4, 9, 10, 14]);
    arr[ChordQuality.Dominant13]     = Object.freeze([4, 9, 10, 14]);      // pc-identical
    arr[ChordQuality.Dominant7Sus4]  = Object.freeze([5, 10, 14]);         // 4 b7 9
    arr[ChordQuality.Sus4]           = Object.freeze([5, 7, 14]);          // 4 5 9
    arr[ChordQuality.HalfDiminished] = Object.freeze([0, 3, 6, 10]);       // keep root (identity fragile)
    arr[ChordQuality.Diminished]     = Object.freeze([0, 3, 6]);
    arr[ChordQuality.Diminished7]    = Object.freeze([0, 3, 6, 9]);
    arr[ChordQuality.Augmented]      = Object.freeze([0, 4, 8]);

    // ---- Batch 5 新增 jazz 高级和弦 ----
    arr[ChordQuality.Major13]        = Object.freeze([4, 7, 11, 14, 21]);   // 3 5 7 9 13
    arr[ChordQuality.Major7Sharp11]  = Object.freeze([4, 11, 14, 18]);      // 3 7 9 #11 (drop 5, Lydian color)
    arr[ChordQuality.Dom7Flat9]      = Object.freeze([4, 9, 10, 13]);       // 3 13 b7 b9
    arr[ChordQuality.Dom7Sharp9]     = Object.freeze([4, 9, 10, 15]);       // 3 13 b7 #9
    arr[ChordQuality.Dom7Sharp11]    = Object.freeze([10, 14, 18, 21]);     // b7 9 #11 13 (no 3, Lydian-dom signature)
    arr[ChordQuality.Dom7Flat13]     = Object.freeze([4, 8, 10, 13]);       // 3 b13 b7 b9
    arr[ChordQuality.Dom7Alt]        = Object.freeze([4, 10, 13, 15, 20]);  // 3 b7 b9 #9 b13 (altered stack)
    arr[ChordQuality.Dominant11]     = Object.freeze([5, 10, 14]);          // 4 b7 9 (sus voicing form)

    return Object.freeze(arr);
})();

// ============================================================
// POP — Pop piano full-extension comping
// ============================================================
//
// 设计哲学:Pop 钢琴 idiom 不像 jazz 那样分工,vocal 浮在上方,comping 直接弹
// "完整 chord type"(含 root)。本表只 enumerate 与 CHORD_INTERVALS 差异的 chord type
// (主要是为了避免 11/3 b9 clash 而把 3 改成 sus 的情况),其他都 fallback 到
// CHORD_INTERVALS。
//
const POP: ReadonlyArray<ReadonlyArray<number> | undefined> = (() => {
    const arr: (ReadonlyArray<number> | undefined)[] = [];

    // Batch 5 新增 — 用 sus11 避开 11/3 b9 clash:
    arr[ChordQuality.Dominant11] = Object.freeze([0, 5, 7, 10, 14]);

    return Object.freeze(arr);
})();

// ============================================================
// RNB — Neo-Soul / D'Angelo / Glasper cluster
// ============================================================
//
// 设计哲学:紧簇 4 voice(3 + 5 + 7 + 9 + ext),特别照顾 m11(D'Angelo Untitled
// signature)、13(V13 R&B punch)、altered tensions。
//
const RNB: ReadonlyArray<ReadonlyArray<number> | undefined> = (() => {
    const arr: (ReadonlyArray<number> | undefined)[] = [];
    arr[ChordQuality.Minor11]    = Object.freeze([3, 10, 14, 17]);       // D'Angelo Untitled signature
    arr[ChordQuality.Dominant13] = Object.freeze([4, 10, 14, 21]);       // 3 b7 9 13 (drop 5)

    // ---- Batch 5 新增 ----
    arr[ChordQuality.Dom7Flat13]    = Object.freeze([4, 10, 13, 20]);    // 3 b7 b9 b13 (full altered)
    arr[ChordQuality.Dom7Alt]       = Object.freeze([4, 10, 13, 15, 20]);
    arr[ChordQuality.Dom7Sharp11]   = Object.freeze([4, 10, 14, 18]);    // 3 b7 9 #11
    arr[ChordQuality.Major13]       = Object.freeze([4, 11, 14, 21]);    // Glasper maj13
    arr[ChordQuality.Major7Sharp11] = Object.freeze([4, 11, 14, 18]);    // Glasper maj7#11
    arr[ChordQuality.Dominant11]    = Object.freeze([5, 10, 14, 17]);    // 4 b7 9 11 (Glasper sus voicing)

    return Object.freeze(arr);
})();

// ============================================================
// BLUES — Boogie / shuffle 右手 comping
// ============================================================
//
// 设计哲学:LH 跑 boogie walk(root-3-5-6-b7-5-3-root),RH 在 dominant chord 上
// drop 5 留位置给 9/b9/#9/b13;triad / m7 / maj7 保留 5(不需要给 tension 让位)。
// "horn shout" voicing(root + 3 + b7 + 9)是 boogie/barrelhouse 签名。
//
const BLUES: ReadonlyArray<ReadonlyArray<number> | undefined> = (() => {
    const arr: (ReadonlyArray<number> | undefined)[] = [];

    // Triads / quality 7-chords:保留全音(无 dom tension 需腾位)
    arr[ChordQuality.Major]          = Object.freeze([0, 4, 7]);
    arr[ChordQuality.Minor]          = Object.freeze([0, 3, 7]);
    arr[ChordQuality.Diminished]     = Object.freeze([0, 3, 6]);
    arr[ChordQuality.Augmented]      = Object.freeze([0, 4, 8]);
    arr[ChordQuality.Major7]         = Object.freeze([0, 4, 7, 11]);
    arr[ChordQuality.Minor7]         = Object.freeze([0, 3, 7, 10]);
    arr[ChordQuality.Major9]         = Object.freeze([0, 4, 7, 11, 14]);
    arr[ChordQuality.Minor9]         = Object.freeze([0, 3, 7, 10, 14]);
    arr[ChordQuality.Minor11]        = Object.freeze([0, 3, 7, 10, 14, 17]);
    arr[ChordQuality.HalfDiminished] = Object.freeze([0, 3, 6, 10]);
    arr[ChordQuality.Diminished7]    = Object.freeze([0, 3, 6, 9]);
    arr[ChordQuality.Add9]           = Object.freeze([0, 4, 7, 14]);

    // Dominant chords:drop 5,留位置给 9 / 13(horn shout)
    arr[ChordQuality.Dominant7]      = Object.freeze([0, 4, 10]);          // root + 3 + b7
    arr[ChordQuality.Dominant9]      = Object.freeze([0, 4, 10, 14]);      // horn shout: root + 3 + b7 + 9
    arr[ChordQuality.Dominant13]     = Object.freeze([0, 4, 10, 14, 21]);  // + 13

    // sus
    arr[ChordQuality.Sus4]           = Object.freeze([0, 5, 7]);
    arr[ChordQuality.Dominant7Sus4]  = Object.freeze([0, 5, 10]);

    // ---- Batch 5 新增 boogie/blues 高级和弦 ----
    arr[ChordQuality.Major13]       = Object.freeze([0, 4, 7, 11, 14, 21]); // 完整 maj13(blues 内罕见,保留兼容)
    arr[ChordQuality.Major7Sharp11] = Object.freeze([0, 4, 7, 11, 18]);
    arr[ChordQuality.Dom7Flat9]     = Object.freeze([0, 4, 10, 13]);
    arr[ChordQuality.Dom7Sharp9]    = Object.freeze([0, 4, 10, 15]);        // Hendrix chord
    arr[ChordQuality.Dom7Sharp11]   = Object.freeze([0, 4, 10, 14, 18]);
    arr[ChordQuality.Dom7Flat13]    = Object.freeze([0, 4, 10, 20]);
    arr[ChordQuality.Dom7Alt]       = Object.freeze([0, 4, 10, 13, 15, 20]);
    arr[ChordQuality.Dominant11]    = Object.freeze([0, 5, 10, 14]);

    return Object.freeze(arr);
})();

// ============================================================
// 主表 — 4 本字典聚合
// ============================================================

/**
 * 索引:PIANO_VOICING_DICTIONARY[dictId][quality] = intervals[] | undefined
 *
 * undefined 时调用方应 fallback 到公式算法(VoicingProcessor.buildRootlessRH 现有路径)。
 */
export const PIANO_VOICING_DICTIONARY: ReadonlyArray<ReadonlyArray<ReadonlyArray<number> | undefined>> = Object.freeze([
    JAZZ_ROOTLESS,
    POP,
    RNB,
    BLUES,
]);

// ============================================================
// 查询函数
// ============================================================

/**
 * 单点查询 — 在某字典中查询某 chord quality 的 voicing intervals。
 *
 * @param dictId  字典选择
 * @param quality chord 类型
 * @returns       intervals[] (相对 chord root 的半音数) 或 undefined(未命中)
 */
export function lookupPianoVoicing(
    dictId: VoicingDictId,
    quality: ChordQuality,
): ReadonlyArray<number> | undefined {
    const dict = PIANO_VOICING_DICTIONARY[dictId];
    if (dict === undefined) return undefined;
    return dict[quality];
}

/**
 * Fallback 链查询 — 按优先级在多本字典里查,第一个命中即返回。
 *
 * 使用场景:RNB 字典只覆盖差异化条目,常见 chord 走 JazzRootless;BLUES 字典
 * 完整覆盖但只在 boogie 场景用。
 *
 * @param dictIds 字典优先级列表(从高到低)
 * @param quality chord 类型
 */
export function lookupPianoVoicingChain(
    dictIds: ReadonlyArray<VoicingDictId>,
    quality: ChordQuality,
): ReadonlyArray<number> | undefined {
    for (let i = 0; i < dictIds.length; i++) {
        const result = lookupPianoVoicing(dictIds[i], quality);
        if (result !== undefined) return result;
    }
    return undefined;
}
