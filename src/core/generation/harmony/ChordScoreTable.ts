// ==========================================
// 📄 /src/core/generation/harmony/ChordScoreTable.ts
// 🌟 PR #1: Top Voice 评分矩阵 — 法则 1+2 的算法化
//
// 核心思想：
//   对每种和弦 quality，为 12 种 interval（相对根音的度数）打一个分数。
//   旋律音 pc 相对当前和弦根音的 interval 决定它是否是"好听的 top voice"。
//   分数越高 → 旋律音越能被该和弦托住 → 和弦越适合出现在那个旋律点上。
//
// Interval 含义（0~11）：
//   0=R  1=b9/b2  2=9/2  3=b3/#9  4=3  5=11/4  6=b5/#11
//   7=5  8=b6/#5  9=6/13  10=b7  11=maj7
//
// 评分哲学（量纲统一为 int8, 范围 -4~+4）：
//   +4 = 定义音色的"灵魂音"（如 Maj7 上的 11 音 maj7，Dom7 上的 b7）
//   +3 = 根音 / 三音 / 甜美扩展（9/13/maj7）
//   +2 = 五音 / 稳定支撑音
//   +1 = 可用但不突出
//    0 = 中性（不伤但不加分）
//   -1 = 轻度冲突（如 Major 上的 b7、avoid note 边缘）
//   -2 = 明显冲突（Major 上的 b6、Minor 上的 #11）
//   -3 = 与和弦定义音半音相撞（Major 上的 b3、Minor7 上的 maj7）
//   -4 = 最刺耳的 b9（tritone-b9 combo）
//
// ESP32 移植：直接作为 `int8_t scoreTable[17][12]` = 204 字节 flash 常量
// ==========================================

import { ChordQuality } from '../types';

/**
 * 评分表：行 = quality 枚举值（0~16），列 = interval（0~11）。
 * 总共 17 × 12 = 204 个 int8 值。
 *
 * 设计原则：每一行总和约为 0（让评分有可比性），且
 *   - 根音、三音、五音恒为正
 *   - 与定义音半音相撞的本位音恒为负
 *   - 扩展音（9/13/maj7 等）的分数反映和弦色彩的"灵魂"
 *
 * 数值是我基于 6 条法则的初始直觉值。PR #2 接入管道后会做听感调优。
 */
export const SCORE_TABLE: readonly (readonly number[])[] = [
    // ==================================================================
    // [0] Major (R, 3, 5) —— 基础大三和弦
    //      R b9 9 b3 3 11 #11 5 b6 6 b7 maj7
    /*0*/  [+3, -4, +2, -3, +4, -1, -2, +3, -3, +3, -1, +3],

    // [1] Minor (R, b3, 5) —— 基础小三和弦
    /*1*/  [+3, -3, +2, +4, -3, +2, -2, +3, +1, +2, +3, -2],

    // [2] Diminished (R, b3, b5) —— 减三
    //      5 与 b5 冲突 → -3；b6 可作为 leading → +1
    /*2*/  [+3, -3, +1, +4, -3, +1, +4, -3, +1, +1, +1, -2],

    // [3] Diminished7 (R, b3, b5, bb7=6) —— 全减七
    //      bb7 占据了 6 位，与 b7 半音冲突
    /*3*/  [+3, -3, +1, +4, -3, +1, +4, -3, +1, +4, -1, -2],

    // [4] Augmented (R, 3, #5) —— 增三
    //      5 与 #5 冲突 → -3
    /*4*/  [+3, -3, +2, -3, +4, -2, -1, -3, +4, +1, +2, +2],

    // [5] Dominant7 (R, 3, 5, b7) —— 属七
    //      b7 是灵魂音 +4；11 作为 sus 张力 +1；#11 是 lydian dominant 色彩
    /*5*/  [+3, -3, +2, -2, +4, +1, +1, +2, +1, +2, +4, -3],

    // [6] Minor7 (R, b3, 5, b7) —— 小七
    //      11 在 m7 上非常甜 → +3；b7 是灵魂
    /*6*/  [+3, -3, +2, +4, -3, +3, -2, +3, -1, +2, +4, -3],

    // [7] Major7 (R, 3, 5, maj7) —— 大七
    //      maj7 是灵魂音 +4；11 是 avoid note → -2；#11 是 lydian 色彩
    /*7*/  [+3, -4, +3, -3, +4, -2, +2, +2, -3, +2, -3, +4],

    // [8] HalfDiminished = m7b5 (R, b3, b5, b7)
    /*8*/  [+3, -3, +1, +4, -3, +2, +4, -3, +1, +1, +3, -3],

    // [9] Sus4 (R, 4, 5) —— 挂四
    //      4 是灵魂音，3 被挂起所以 -3
    /*9*/  [+3, -3, +2, -1, -3, +4, -2, +3, -3, +2, +1, -1],

    // [10] Dominant7Sus4 (R, 4, 5, b7)
    /*10*/ [+3, -3, +2, -1, -3, +4, -2, +3, -2, +2, +4, -3],

    // [11] Add9 (R, 9, 3, 5) —— 加九
    //      9 是灵魂 +4
    /*11*/ [+3, -3, +4, -3, +4, -1, -2, +3, -3, +2, -2, +2],

    // [12] Minor9 (R, b3, 5, b7, 9)
    /*12*/ [+3, -3, +4, +3, -3, +3, -2, +3, -1, +2, +3, -3],

    // [13] Major9 (R, 3, 5, maj7, 9)
    /*13*/ [+3, -4, +4, -3, +4, -2, +2, +2, -3, +2, -3, +4],

    // [14] Dominant9 (R, 3, 5, b7, 9)
    /*14*/ [+3, -3, +4, -2, +4, +1, +1, +2, +1, +2, +4, -3],

    // [15] Minor11 (R, b3, 5, b7, 9, 11)
    //      11 已是和弦音，分数再拔高
    /*15*/ [+3, -3, +3, +4, -3, +4, -2, +3, -1, +2, +3, -3],

    // [16] Dominant13 (R, 3, 5, b7, 9, 13)
    //      13 成为灵魂 +4
    /*16*/ [+3, -3, +3, -2, +4, +1, +1, +2, +1, +4, +3, -3],
];

/**
 * 查表：旋律音落在和弦上得到的 top voice 分数。
 * interval = (melodyPc - chordRootPc + 12) % 12
 * 热路径，O(1)。
 */
export function topVoiceScore(
    chordRootPc: number,
    quality: ChordQuality,
    melodyPc: number,
): number {
    const interval = ((melodyPc - chordRootPc) % 12 + 12) % 12;
    return SCORE_TABLE[quality][interval];
}

/**
 * 编译期自检：确认 SCORE_TABLE 的结构完整。
 * 在模块加载时 throw，避免运行时查表越界。
 */
(function validateTable() {
    if (SCORE_TABLE.length !== 17) {
        throw new Error(`SCORE_TABLE row count ${SCORE_TABLE.length} !== 17 (ChordQuality enum size)`);
    }
    for (let q = 0; q < SCORE_TABLE.length; q++) {
        if (SCORE_TABLE[q].length !== 12) {
            throw new Error(`SCORE_TABLE[${q}] column count ${SCORE_TABLE[q].length} !== 12`);
        }
        for (let i = 0; i < 12; i++) {
            const v = SCORE_TABLE[q][i];
            if (v < -4 || v > 4 || !Number.isInteger(v)) {
                throw new Error(`SCORE_TABLE[${q}][${i}] = ${v} out of int8 range [-4, 4]`);
            }
        }
    }
    // 通过类型断言抑制枚举类型 unused 警告
    void ChordQuality.Major;
})();
