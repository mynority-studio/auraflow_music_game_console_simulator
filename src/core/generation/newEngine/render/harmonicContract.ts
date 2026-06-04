// ============================================================
// newEngine · render · HarmonicContract(和声合同准入 gate,render 共用)
// ------------------------------------------------------------
// 用户定的准入规则(织体 + 旋律都走)—— 和弦 与 音阶 是【两条正交参考轴】:
//   • 和弦合同 = stable ∪ color(纵向)= 强拍自由落点(含色彩 9/13/#11)。
//   • 音阶(横向调色板)= chordScaleMap[span] = 当前和弦的【相对音阶】
//     (借用/副属/转调/调式已在 harmony 层转换好;blues 等专属音阶需 harmony 层补)。
// 三档准入(不在交集的退化成弱拍/经过/装饰):
//   ① 在和弦合同 → 强拍自由。
//   ② 在音阶、不在和弦 → 自然经过/装饰 → 弱拍 / 经过 / 邻音放行。
//   ③ 既非和弦也非音阶(半音)→ 最严:仅两侧为和弦音的真半音经过/邻音。
// ★ 合同/音阶成员判定用 pc;级进/不和谐音程判定用真实 midi 距离。
// 垂直撞音(lead vs comp)另由 Auditor R4 管,不在此。
// ============================================================

import { mod12, type DeepReadonly } from '../foundation';
import type { ChordSpanId, HarmonicPlan } from '../harmony/HarmonicPlan';

/** 和弦的"和声合同"= 和弦包含的音(stable ∪ color)。返回 pc 集。 */
export function chordContractPcs(plan: HarmonicPlan, spanId: ChordSpanId): Set<number> {
  const s = new Set<number>();
  for (const pc of (plan.stableToneMap[spanId] ?? []) as DeepReadonly<number[]>) s.add(mod12(pc));
  for (const pc of (plan.colorToneMap[spanId] ?? []) as DeepReadonly<number[]>) s.add(mod12(pc));
  return s;
}

/** 当前和弦的【相对音阶】pc 集(chordScaleMap;借用/副属/转调/调式已转换)。 */
export function chordScalePcs(plan: HarmonicPlan, spanId: ChordSpanId): Set<number> {
  const s = new Set<number>();
  for (const pc of (plan.chordScaleMap[spanId] ?? []) as DeepReadonly<number[]>) s.add(mod12(pc));
  return s;
}

/** 真实 midi 级进(半音 / 全音)。 */
function isStepMidi(a: number, b: number): boolean {
  const d = Math.abs(a - b);
  return d === 1 || d === 2;
}

export type AdmitReason =
  | 'in-contract'        // ① 和弦合同内 → 强拍自由
  | 'scale-weak' | 'scale-passing' | 'scale-neighbor'           // ② 音阶内非和弦音
  | 'chromatic-passing' | 'chromatic-neighbor'                  // ③ 半音(非音阶)
  | 'rejected';
export interface ContractAdmission { admit: boolean; reason: AdmitReason; }

/**
 * 和声合同准入判定(同时参考 和弦合同 + 相对音阶)。
 * prevMidi/nextMidi = 同轨前后音真实 midi(无则 undefined)。
 */
export function admitNoteByContract(args: {
  noteMidi: number;
  chordContract: ReadonlySet<number>;  // stable ∪ color
  scale: ReadonlySet<number>;          // chordScaleMap(相对音阶);空集 = 不约束(modal 松)
  isWeakBeat: boolean;
  prevMidi?: number;
  nextMidi?: number;
}): ContractAdmission {
  const { noteMidi, chordContract, scale, isWeakBeat, prevMidi, nextMidi } = args;
  const note = mod12(noteMidi);

  // ① 和弦合同内 → 强拍自由
  if (chordContract.has(note)) return { admit: true, reason: 'in-contract' };

  // ★ 非合同音必须在【弱位】(弱拍 / 短音 / off-beat)—— 经过/邻音/装饰天生是弱位短音。
  //   强拍或长音的非合同音 → rejected(交给调用方就近 snap 到合同),否则会长暴露撞 Auditor。
  if (!isWeakBeat) return { admit: false, reason: 'rejected' };

  const inScale = scale.size === 0 || scale.has(note);
  const stepFromPrev = prevMidi !== undefined && isStepMidi(prevMidi, noteMidi);
  const stepToNext = nextMidi !== undefined && isStepMidi(noteMidi, nextMidi);
  // 支持(音阶档):两侧为和弦音 或 音阶音
  const supported = (m?: number) => m !== undefined && (chordContract.has(mod12(m)) || (scale.size > 0 && scale.has(mod12(m))));
  // 和弦支持(半音档,更严):两侧必须是和弦合同音
  const chordSup = (m?: number) => m !== undefined && chordContract.has(mod12(m));
  const samePc = prevMidi !== undefined && nextMidi !== undefined && mod12(prevMidi) === mod12(nextMidi);

  if (inScale) {
    // ② 音阶内非和弦音 = 自然经过/装饰
    if (samePc && supported(prevMidi) && stepFromPrev && stepToNext) return { admit: true, reason: 'scale-neighbor' };
    if (supported(prevMidi) && supported(nextMidi) && stepFromPrev && stepToNext) return { admit: true, reason: 'scale-passing' };
    if (stepFromPrev || stepToNext) return { admit: true, reason: 'scale-weak' };
    return { admit: false, reason: 'rejected' };
  }
  // ③ 半音(非音阶)→ 最严:仅两侧为和弦音的真半音经过/邻音
  if (samePc && chordSup(prevMidi) && stepFromPrev && stepToNext) return { admit: true, reason: 'chromatic-neighbor' };
  if (chordSup(prevMidi) && chordSup(nextMidi) && stepFromPrev && stepToNext) return { admit: true, reason: 'chromatic-passing' };
  return { admit: false, reason: 'rejected' };
}

/** 整组 voicing 是否全部在合同内(comp voicing 择优的合法性底)。midi[] → 取 pc 判。 */
export function voicingAllInContract(noteMidis: readonly number[], contract: ReadonlySet<number>): boolean {
  return noteMidis.every((m) => contract.has(mod12(m)));
}
