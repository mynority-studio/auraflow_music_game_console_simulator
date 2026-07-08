// ============================================================
// motifSandbox · model · 音阶×风格 相邻摩擦容差(beginner healing Phase 2)
// ------------------------------------------------------------
// 用户拍板【精简方案】:不铺 N 调式×风格巨表 —— base risk 按【绝对跨度(span)+风格】算,
//   再叠【实时音阶成员检查(producedByScalePcs / AdjacentScaleSteps)】+ blues/jazz 豁免。
// 关键音乐学:旋律音程(相邻先后弹的两音)不是和声音程;协和/不协和看风格+上下文。
//   - M2(2 半音)是常规级进;m7(10 半音)是大跳 —— 同 interval class 2,但绝对跨度天差 → 不能混。
//   - m2(1)可作半音经过/jazz approach;M7(11)是危险大跳 —— 同 class 1,绝对跨度天差。
//   故 risk 用【绝对半音 absSemitones】区分,不只 intervalClass。纯函数 / 确定性。
// ============================================================

import type { SandboxStyle } from './types';
import type { SandboxTonality } from './sandboxScales';
import { keyBlueNotePc, isBluesTonalityInput } from './pitchContract';

const m12 = (n: number): number => ((n % 12) + 12) % 12;

export type IntervalClass = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type MelodicSpanKind = 'unison' | 'step' | 'third' | 'fourthOrFifth' | 'tritone' | 'sixth' | 'seventh' | 'compound';

/** 绝对半音 → interval class(0..6,八度折叠)。 */
export function intervalClassOf(semitones: number): IntervalClass {
  const r = Math.abs(semitones) % 12;
  return (r > 6 ? 12 - r : r) as IntervalClass;
}

/** 绝对半音 → 旋律跨度种类(用绝对值,不折叠 → 区分 M2 与 m7)。 */
export function spanKindOf(absSemitones: number): MelodicSpanKind {
  const a = Math.abs(absSemitones);
  if (a === 0) return 'unison';
  if (a >= 12) return 'compound';
  if (a === 1 || a === 2) return 'step';
  if (a === 3 || a === 4) return 'third';
  if (a === 5 || a === 7) return 'fourthOrFifth';
  if (a === 6) return 'tritone';
  if (a === 8 || a === 9) return 'sixth';
  return 'seventh'; // 10/11 = m7/M7 跳
}

/** base risk:按【绝对跨度 + 风格】。jazz/blues 对半音/三全音宽容(色彩语言)。 */
function baseRiskFor(absSemi: number, style: SandboxStyle): number {
  const jazzy = style === 'jazz';
  const a = Math.abs(absSemi);
  if (a >= 12) return 0.5;                       // 复合大跳
  if (a === 10 || a === 11) return jazzy ? 0.2 : 0.45; // m7/M7 跳(大跳不协和)
  const cls = a % 12;
  if (cls === 1) return jazzy ? 0.12 : 0.38;     // m2
  if (cls === 6) return jazzy ? 0.18 : 0.48;     // 三全音
  if (cls === 8 || cls === 9) return 0.08;       // 六度跳(轻)
  return 0.0;                                     // M2/三度/四五度/同度 = 常规旋律材料
}

export interface FrictionAssessment {
  risk: number;                       // 0..1
  intervalClass: IntervalClass;
  spanKind: MelodicSpanKind;
  producedByScalePcs: boolean;        // 两音皆在选定音阶 pc 集
  producedByAdjacentScaleSteps: boolean; // 该跨度是音阶相邻级(级进语言)
  styleScaleExempt: boolean;          // jazz 半音 approach / blues 蓝调音 → 豁免
  repeatLimit: number;                // 强调摩擦允许出现次数(默认 2)
  reason: string[];
}

/** 评估一对相邻旋律音的摩擦风险。 */
export function assessFriction(args: {
  semitones: number;                  // signed midiB - midiA
  pcA: number; pcB: number;
  style: SandboxStyle;
  tonality?: SandboxTonality;
  keyPc?: number;                     // 调中心(算蓝调音 pc;默认 0)
  scalePcs: readonly number[];        // 选定输入音阶的 pc 集(绝对 pc)
  emphasized: boolean;                // 任一音强拍/长音/高结构分/高力度
  resolved: boolean;                  // 级进进入并级进解决(经过音)
  chordSupported: boolean;            // 当前和声 chord-scale 支持(合同 stable/color/scale)
}): FrictionAssessment {
  const { semitones, pcA, pcB, style, tonality, scalePcs, emphasized, resolved, chordSupported } = args;
  const abs = Math.abs(semitones);
  const intervalClass = intervalClassOf(abs);
  const spanKind = spanKindOf(abs);
  const reason: string[] = [];

  const inScale = (pc: number): boolean => scalePcs.includes(m12(pc));
  const producedByScalePcs = inScale(pcA) && inScale(pcB);
  // 相邻级:两音都在音阶且在音阶顺序里是邻接(cyclic)。
  const producedByAdjacentScaleSteps = producedByScalePcs && adjacentInScale(m12(pcA), m12(pcB), scalePcs);

  // blues/jazz 豁免:蓝调音(b3/b5)或 jazz 半音 approach(resolved)。
  const blue = keyBlueNotePc(args.keyPc ?? 0, tonality); // 该调的蓝调音 pc
  const isBluesIn = isBluesTonalityInput(tonality);
  const blueNoteInvolved = isBluesIn && blue !== null && (m12(pcA) === blue || m12(pcB) === blue);
  const jazzChromaticApproach = style === 'jazz' && intervalClass === 1 && resolved;
  const styleScaleExempt = blueNoteInvolved || jazzChromaticApproach;

  let risk = baseRiskFor(abs, style);
  if (emphasized) { risk += 0.2; reason.push('emphasized'); }
  if (!producedByScalePcs) { risk += 0.25; reason.push('out-of-scale'); }       // 离调音程 → 高风险
  else if (!producedByAdjacentScaleSteps && (spanKind === 'seventh' || spanKind === 'tritone')) { risk += 0.1; reason.push('non-adjacent-leap'); }
  if (resolved) { risk -= 0.35; reason.push('resolved-passing'); }
  if (styleScaleExempt) { risk -= 0.45; reason.push(blueNoteInvolved ? 'blue-note' : 'jazz-approach'); }
  if (chordSupported) { risk -= 0.3; reason.push('chord-supported'); }
  risk = Math.max(0, Math.min(1, risk));

  return { risk, intervalClass, spanKind, producedByScalePcs, producedByAdjacentScaleSteps, styleScaleExempt, repeatLimit: 2, reason };
}

/** 两 pc 是否在音阶顺序里相邻(cyclic):排序后相邻、或首尾环绕相邻。 */
function adjacentInScale(pcA: number, pcB: number, scalePcs: readonly number[]): boolean {
  if (pcA === pcB) return false;
  const sorted = [...new Set(scalePcs.map(m12))].sort((a, b) => a - b);
  const ia = sorted.indexOf(pcA), ib = sorted.indexOf(pcB);
  if (ia < 0 || ib < 0) return false;
  const n = sorted.length;
  const d = Math.abs(ia - ib);
  return d === 1 || d === n - 1; // 相邻 或 首尾环绕
}
