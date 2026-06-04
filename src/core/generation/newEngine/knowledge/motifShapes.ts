// ============================================================
// newEngine · knowledge · MotifShape 生成器(rng 驱动的抽象动机形状)
// ------------------------------------------------------------
// 给 Prepass 用:由 rng 子流抽出【节奏 cell + 音级走向 + 轮廓】。
// 同 seed 确定;不同 seed / 不同抽取序 → 不同形状(动机各异 + 种子真生效)。
// 纯逻辑、可测,不碰具体 pitch(scaleDegree 抽象身份)。
// ============================================================

import type { Rng } from '../foundation';

// 1 小节(4 拍)节奏 cell 候选(durations 求和 = 4)
const RHYTHM_CELLS: readonly (readonly number[])[] = [
  [1, 1, 1, 1],
  [2, 1, 1],
  [1, 1, 2],
  [1.5, 0.5, 1, 1],
  [1, 0.5, 0.5, 1, 1],
  [2, 2],
  [1, 1, 0.5, 0.5, 1],
  [0.5, 0.5, 1, 2],
];

const START_DEGREES = [1, 2, 3, 5];
const STEPS = [-2, -1, -1, 1, 1, 2]; // 偏好级进(±1 概率高)

function wrapDegree(d: number): number {
  return (((d - 1) % 7) + 7) % 7 + 1; // → 1..7
}

export interface MotifShape {
  rhythmCell: number[];   // 每音时值(拍),求和 = 4
  scaleDegrees: number[]; // 抽象音级 1..7,长度 = rhythmCell.length
  contour: number[];      // 逐音方向 -1/0/+1
}

export function generateMotifShape(rng: Rng): MotifShape {
  const rhythmCell = rng.pick(RHYTHM_CELLS).slice();
  const n = rhythmCell.length;

  const degrees = [rng.pick(START_DEGREES)];
  for (let i = 1; i < n; i++) {
    degrees.push(wrapDegree(degrees[i - 1] + rng.pick(STEPS)));
  }

  const contour = degrees.slice(1).map((d, i) => Math.sign(d - degrees[i]));
  return { rhythmCell, scaleDegrees: degrees, contour };
}
