// ============================================================
// voice-leading — placeNearAnchor 共享 helper
// ============================================================
//
// 2026-05-24 提取自 Af2MelodyGen.placeNearAnchor + BassIdiom.placeBassNearAnchor
// 两处独立但逻辑等价的实现。
//
// 给定目标 pc + prev MIDI + 音域 range,返回 pc 落在 range 内、距 prev 最近的八度位置。
// 用于 melody / bass / 任何单声部 voice-leading 平滑过渡。
// ============================================================

/**
 * @param pc        目标 pitch class(0-11)
 * @param prevMidi  上一个 MIDI(voice-leading 锚点)
 * @param lo        音域下界 MIDI(inclusive)
 * @param hi        音域上界 MIDI(inclusive)
 * @returns        在 [lo, hi] 内、pc 不变、距 prevMidi 最近的 MIDI
 */
export function placeNearAnchor(pc: number, prevMidi: number, lo: number, hi: number): number {
    let best = pc;
    while (best < lo) best += 12;
    while (best > hi) best -= 12;
    if (best < lo) best = pc + 12 * Math.ceil((lo - pc) / 12);
    let bestDist = Math.abs(best - prevMidi);
    for (let m = best - 12; m >= lo; m -= 12) {
        const d = Math.abs(m - prevMidi);
        if (d < bestDist) { bestDist = d; best = m; }
    }
    for (let m = best + 12; m <= hi; m += 12) {
        const d = Math.abs(m - prevMidi);
        if (d < bestDist) { bestDist = d; best = m; }
    }
    if (best < lo) best = lo;
    if (best > hi) best = hi;
    return best;
}
