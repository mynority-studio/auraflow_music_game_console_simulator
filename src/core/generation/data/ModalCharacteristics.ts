// ============================================================
// ModalCharacteristics — 调式特征音字典
// ============================================================
//
// 出处:melodygenerative MODAL_CHARACTERISTIC_NOTES — 每个调式的"灵魂音"。
// 在 modal 场域下,这些音免疫避讳法则(否则 Dorian 的大 6 度会被判定为
// "三全音泄露 → V7 篡位",Lydian 的 #11 会被判定为"撞 5 度小九度")。
//
// 实证锚点:
//   Dorian      大 6 度(♮6)  — Miles "So What" 唯一特征
//   Phrygian    小 2 度(b2)  — 西班牙 / 弗拉门戈
//   Lydian      增 4 度(#11) — Debussy / 北欧民谣
//   Mixolydian  小 7 度(b7)  — 凯尔特 / 蓝调
//   Locrian     b2 + b5      — 半减状态
//   Aeolian     b6           — 自然小调
//   Harmonic    b6 + ♮7      — 西方古典小调
//   Melodic     ♮6 + ♮7      — 上行旋律小调
//   Blues       b3 + b5 + b7 — 蓝调三连
//   Major_Pent / Minor_Pent  — 无特征音(已是骨架)
//
// 调式 vs 调性场域(isModalContext flag):
//   - tonal 场:特征音严格,仅短经过(防三全音泄露)
//   - modal 场:特征音解放,强拍悬挂是该调式的体裁签名
//
// 消费方(Batch 1 暂不接):
//   - Batch 2 HarmonicEvaluator(modal exemption — isAvoidNote 法则的免死金牌)
//   - Batch 5 扩 Tonality 时同步扩本表
//
// 零 PRNG。仅依赖 Tonality enum。
//
// Cross-sync(注册到 cross_sync_rule §1.4 ChordQuality 邻近条目):
//   改 Tonality enum 数值或顺序 → 必须同步本表索引。
// ============================================================

import { Tonality } from '../types';

/**
 * 索引 = Tonality enum。
 * 值 = 该调式的特征音 interval(相对 scale root,半音数 0-11)。
 * 空数组 → 该 tonality 无特征音(走通用避讳法则)。
 *
 * 注:Tonality 当前有 11 个值,本表对应填写。Batch 5 扩 Tonality 后,
 * 本表需要同步新增 PhrygianDominant / LydianDominant / Altered /
 * BebopDominant / BebopMajor 等条目(已在 melodygenerative 中定义,
 * 数据保留在 // TODO Batch 5 注释)。
 */
export const MODAL_CHARACTERISTIC_INTERVALS: ReadonlyArray<ReadonlyArray<number>> = (() => {
    const arr: ReadonlyArray<number>[] = [];
    arr[Tonality.Major]            = Object.freeze([]);          // 主流 — 无特征音
    arr[Tonality.Minor]            = Object.freeze([8]);         // b6 — 与 Aeolian 等同
    arr[Tonality.Major_Pentatonic] = Object.freeze([]);          // 已是骨架
    arr[Tonality.Minor_Pentatonic] = Object.freeze([]);          // 已是骨架
    arr[Tonality.Blues]            = Object.freeze([3, 6, 10]);  // b3 + b5 + b7 蓝调三连
    arr[Tonality.Dorian]           = Object.freeze([9]);         // ♮6 (大 6 度) — Dorian 唯一特征
    arr[Tonality.Mixolydian]       = Object.freeze([10]);        // b7 — Mixolydian 签名
    arr[Tonality.Melodic_Minor]    = Object.freeze([9, 11]);     // ♮6 + ♮7
    arr[Tonality.Lydian]           = Object.freeze([6]);         // #4 / #11
    arr[Tonality.Harmonic_Minor]   = Object.freeze([8, 11]);     // b6 + ♮7
    arr[Tonality.Phrygian]         = Object.freeze([1]);         // b2 / b9
    // Batch 5 新增条目:
    arr[Tonality.Locrian]          = Object.freeze([1, 6]);      // b2 + b5
    arr[Tonality.LydianDominant]   = Object.freeze([6, 10]);     // #11 + b7
    arr[Tonality.PhrygianDominant] = Object.freeze([1, 8]);      // b9 + b13
    arr[Tonality.Altered]          = Object.freeze([1, 3, 6, 8]); // b9 / #9 / #11 / b13 全色彩
    arr[Tonality.BebopDominant]    = Object.freeze([10, 11]);    // b7 + nat 7 双经过
    arr[Tonality.BebopMajor]       = Object.freeze([8, 9]);      // b6 + nat 6 双经过
    return Object.freeze(arr);
})();

// ============================================================
// 查询函数
// ============================================================

/**
 * 给定 (tonality, interval),判断 interval 是否是该调式的特征音。
 *
 * interval 应是 [0, 11] 半音数(相对 scale root)。
 * 调用方传入越界 / 负数:自动 mod-12 归一化。
 *
 * @example
 *   isModalCharacteristicInterval(Tonality.Dorian, 9)  // true (大 6 度是 Dorian 特征)
 *   isModalCharacteristicInterval(Tonality.Dorian, 10) // false (b7 不是 Dorian 特征)
 *   isModalCharacteristicInterval(Tonality.Major, 5)   // false (主流无特征音)
 */
export function isModalCharacteristicInterval(tonality: Tonality, interval: number): boolean {
    const arr = MODAL_CHARACTERISTIC_INTERVALS[tonality];
    if (arr === undefined || arr.length === 0) return false;
    const pc = ((interval % 12) + 12) % 12;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] === pc) return true;
    }
    return false;
}

/**
 * 返回该 tonality 的特征音数组(只读)。
 * 未定义 / 主流调式返回空数组。
 */
export function getModalCharacteristicIntervals(tonality: Tonality): ReadonlyArray<number> {
    const arr = MODAL_CHARACTERISTIC_INTERVALS[tonality];
    return arr !== undefined ? arr : [];
}
