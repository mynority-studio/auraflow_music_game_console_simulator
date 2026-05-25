// ============================================================
// voicing-generator.ts — Impro-Visor VoicingGenerator 移植
// ============================================================
//
// 原型:`/Users/mynority/vibe_coding/Impro-Visor/src/imp/voicing/VoicingGenerator.java`
// 算法:weighted random sampling with dynamic reweighting(动态权重收缩)
//
// 输入:
//   priority[]:chord 内 priority pcs(root → 3 → 7 → 5 → ...)
//   color[]:chord 外 extension/color pcs(可用 tension)
//   handLayout:numLH / numRH + LH range + RH range
//   prevVoicing:上一 chord 的 voicing MIDI 数组(voice leading)
//   settings:VoicingSettings 23 参数
//   rng:AF2 Random(deterministic per chord)
//
// 输出:
//   { lhMidi[], rhMidi[] } 各自升序
//
// 算法 4 phase(对照审计 §C.1):
//   Phase 1:128-MIDI 权重表初始化
//     - color pc 所有 octave 加 colorPriority × 10
//     - priority[p] 所有 octave 加 (maxPriority - p × priorityMultiplier) × 10
//   Phase 2:prev voicing voice leading boost
//     - prevVoicing 内 MIDI 本身 ×= prevVoicingMultiplier
//     - 其 ±1 半音 ×= halfStepMultiplier
//     - 其 ±2 半音 ×= fullStepMultiplier
//   Phase 3:迭代采样 LH / RH(交替)
//     每步:在区间内构建加权 candidate 列表 → weighted random 抽
//     拔后:抽中音权重清零 + ±1/±2 半音 ×= halfStepReducer/fullStepReducer
//          + 同 pc 所有 octave ×= repeatMultiplier(压制 octave 重复)
//   Phase 4:特殊后处理(可选)
//     - voiceAll:强制每 priority/color 至少一次出现(忽略 first 版本)
//     - invertM9th:LH-RH 之间小 9 度(13)swap 成 maj 7(12)
// ============================================================

import type { Random } from '../../af2-engine/utils/Random';
import type { VoicingSettings } from '../data/fv-parser';
import type { HandLayout } from './hand-manager';

export interface VoicingResult {
  lhMidi: number[];
  rhMidi: number[];
}

/**
 * 主入口 — 给定 chord 信息 + hand layout + prev,产出 LH/RH MIDI。
 */
export function generateVoicing(
  priority: number[],   // pc 0-11,按 priority 排序
  color: number[],      // pc 0-11
  handLayout: HandLayout,
  prevVoicing: number[],
  settings: VoicingSettings,
  rng: Random,
): VoicingResult {
  // 128-MIDI 权重表
  const weights = new Float32Array(128);

  // ----- Phase 1:初始化权重 -----
  for (const cPc of color) {
    setupNote(weights, cPc, settings.lhColorPriority * 10, 0, 127);
    setupNote(weights, cPc, settings.rhColorPriority * 10, settings.rhLowerLimit, 127);
  }
  for (let p = 0; p < priority.length; p++) {
    const wt = settings.maxPriority * 10 - p * 10 * settings.priorityMultiplier;
    if (wt > 0) setupNote(weights, priority[p]!, wt, 0, 127);
  }

  // ----- Phase 2:Voice leading boost(prev 同 / ±1 / ±2) -----
  if (prevVoicing.length > 0) {
    for (const n of prevVoicing) {
      if (n >= 0 && n < 128) weights[n]! *= settings.prevVoicingMultiplier;
      if (n + 1 < 128) weights[n + 1]! *= settings.halfStepMultiplier;
      if (n - 1 >= 0) weights[n - 1]! *= settings.halfStepMultiplier;
      if (n + 2 < 128) weights[n + 2]! *= settings.fullStepMultiplier;
      if (n - 2 >= 0) weights[n - 2]! *= settings.fullStepMultiplier;
    }
  }

  // ----- Phase 3:交替采样 LH / RH -----
  const lhMidi: number[] = [];
  const rhMidi: number[] = [];
  const maxIter = Math.max(handLayout.numLeftNotes, handLayout.numRightNotes);
  for (let i = 0; i < maxIter; i++) {
    if (lhMidi.length < handLayout.numLeftNotes) {
      const pick = pickWeighted(weights, handLayout.lhRangeLow, handLayout.lhRangeHigh, rng);
      if (pick >= 0) {
        lhMidi.push(pick);
        suppressAfterPick(weights, pick, settings.halfStepReducer, settings.fullStepReducer, settings.repeatMultiplier, settings.leftMinInterval);
      }
    }
    if (rhMidi.length < handLayout.numRightNotes) {
      const pick = pickWeighted(weights, handLayout.rhRangeLow, handLayout.rhRangeHigh, rng);
      if (pick >= 0) {
        rhMidi.push(pick);
        suppressAfterPick(weights, pick, settings.halfStepReducer, settings.fullStepReducer, settings.repeatMultiplier, settings.rightMinInterval);
      }
    }
  }

  // ----- Phase 4:invert-9th 撞音修复 -----
  if (settings.invertM9th) {
    fixMinor9th(lhMidi, rhMidi);
  }

  lhMidi.sort((a, b) => a - b);
  rhMidi.sort((a, b) => a - b);
  return { lhMidi, rhMidi };
}

/**
 * 给 pc 的所有 [lo, hi] 内 octave 加 weight。
 */
function setupNote(weights: Float32Array, pc: number, weight: number, lo: number, hi: number): void {
  const pcMod = ((pc % 12) + 12) % 12;
  for (let m = pcMod; m < 128; m += 12) {
    if (m < lo || m > hi) continue;
    weights[m]! += weight;
  }
}

/**
 * 在 [lo, hi] 内按 weights[] 加权随机抽 1 个 MIDI。
 * 全 0 权重 → 返 -1(caller 跳过本次抽)。
 */
function pickWeighted(weights: Float32Array, lo: number, hi: number, rng: Random): number {
  let total = 0;
  for (let m = lo; m <= hi; m++) total += Math.max(0, weights[m]!);
  if (total <= 0) return -1;
  let target = rng.next() * total;
  for (let m = lo; m <= hi; m++) {
    const w = Math.max(0, weights[m]!);
    target -= w;
    if (target <= 0) return m;
  }
  return hi; // 数值边界 fallback
}

/**
 * 抽中音后压权重(防同区域 cluster + 防 octave 重复):
 *   抽中本身 → 0
 *   ±1 半音 ×= halfStepReducer 的倒数
 *   ±2 半音 ×= fullStepReducer 的倒数
 *   同 pc 所有 octave ×= 1/repeatMultiplier
 *   [pick - minInterval, pick + minInterval] 全 → 0
 *
 * 注:Impro-Visor 把 halfStepReducer 当"权重 ×= 1/reducer"用(reducer 越大压得越狠),
 * 我们沿用同义。
 */
function suppressAfterPick(
  weights: Float32Array,
  pick: number,
  halfReducer: number,
  fullReducer: number,
  repeatMul: number,
  minInterval: number,
): void {
  weights[pick]! = 0;
  if (pick + 1 < 128) weights[pick + 1]! /= Math.max(1, halfReducer);
  if (pick - 1 >= 0) weights[pick - 1]! /= Math.max(1, halfReducer);
  if (pick + 2 < 128) weights[pick + 2]! /= Math.max(1, fullReducer);
  if (pick - 2 >= 0) weights[pick - 2]! /= Math.max(1, fullReducer);
  // 同 pc 所有 octave
  const pcMod = ((pick % 12) + 12) % 12;
  for (let m = pcMod; m < 128; m += 12) {
    if (m === pick) continue;
    weights[m]! /= Math.max(1, repeatMul);
  }
  // min interval
  if (minInterval > 0) {
    for (let d = 1; d <= minInterval; d++) {
      if (pick + d < 128) weights[pick + d]! = 0;
      if (pick - d >= 0) weights[pick - d]! = 0;
    }
  }
}

/**
 * LH-RH 之间小 9 度(13 半音)swap 成 maj 7(12)— 交换两音 pc 保 octave 区。
 * 例:LH=60(C4), RH=73(Db5) → swap pc → LH=61(Db4), RH=72(C5),差 11(maj 7)。
 */
function fixMinor9th(lhMidi: number[], rhMidi: number[]): void {
  for (let li = 0; li < lhMidi.length; li++) {
    for (let ri = 0; ri < rhMidi.length; ri++) {
      const lh = lhMidi[li]!;
      const rh = rhMidi[ri]!;
      if (rh - lh !== 13) continue;
      const lhOct = Math.floor(lh / 12);
      const rhOct = Math.floor(rh / 12);
      const lhPc = lh % 12;
      const rhPc = rh % 12;
      const newLh = lhOct * 12 + rhPc;
      const newRh = rhOct * 12 + lhPc;
      if (newLh < newRh && newRh - newLh < 13) {
        lhMidi[li] = newLh;
        rhMidi[ri] = newRh;
      }
    }
  }
}
