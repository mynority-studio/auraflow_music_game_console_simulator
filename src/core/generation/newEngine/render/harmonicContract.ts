// ============================================================
// newEngine · render · HarmonicContract(和声合同准入 gate,render 共用)
// ------------------------------------------------------------
// 用户定的准入规则(织体 + 旋律都走):
//   和声合同 = 当前和弦【包含的音】= stable ∪ color(我方色彩和弦 → 合同宽容度高)。
//   ① notePc 在合同内 → 放行。
//   ② 合同外的音 → 只在 弱拍 / 经过音 / 邻音(两侧合同内音) 放行,
//      且与前后是【级进】接入 = 不形成不和谐跳进(前后不和谐音程)。
// ★ 合同成员判定用 pc(和弦音是音级);但【级进/不和谐音程】判定用真实 midi 距离
//   (pc 距 1 可能是 m2 级进、也可能是 M7 跳进 —— 必须看真实音程)。
// 垂直撞音(lead vs comp 小二/小九)另由 Auditor R4 管,不在此。
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

/** 真实 midi 级进(半音 / 全音)。 */
function isStepMidi(a: number, b: number): boolean {
  const d = Math.abs(a - b);
  return d === 1 || d === 2;
}

export type AdmitReason = 'in-contract' | 'passing' | 'neighbor' | 'weak-beat-step' | 'rejected';
export interface ContractAdmission { admit: boolean; reason: AdmitReason; }

/**
 * 和声合同准入判定。contract = pc 集;prevMidi/nextMidi = 同轨前后音真实 midi(无则 undefined)。
 *   合同内 → in-contract。合同外 → 经过 / 邻音 / 弱拍级进(均要求真实级进接入=禁不和谐跳进)→ 放行;否则 rejected。
 */
export function admitNoteByContract(args: {
  noteMidi: number;
  contract: ReadonlySet<number>;
  isWeakBeat: boolean;
  prevMidi?: number;
  nextMidi?: number;
}): ContractAdmission {
  const { noteMidi, contract, isWeakBeat, prevMidi, nextMidi } = args;
  if (contract.has(mod12(noteMidi))) return { admit: true, reason: 'in-contract' };

  const stepFromPrev = prevMidi !== undefined && isStepMidi(prevMidi, noteMidi);
  const stepToNext = nextMidi !== undefined && isStepMidi(noteMidi, nextMidi);
  const prevIn = prevMidi !== undefined && contract.has(mod12(prevMidi));
  const nextIn = nextMidi !== undefined && contract.has(mod12(nextMidi));

  // 邻音(更具体:两侧同一合同音 pc,级进折回)—— 先判,免被 passing 吞
  if (prevMidi !== undefined && nextMidi !== undefined && mod12(prevMidi) === mod12(nextMidi) && prevIn && stepFromPrev && stepToNext) {
    return { admit: true, reason: 'neighbor' };
  }
  // 经过音:两侧是(不同)合同音,真实级进穿过(前后均无不和谐跳进)
  if (prevIn && nextIn && stepFromPrev && stepToNext) return { admit: true, reason: 'passing' };
  // 弱拍:至少一侧真实级进接入(禁跳进到非合同音)
  if (isWeakBeat && (stepFromPrev || stepToNext)) return { admit: true, reason: 'weak-beat-step' };
  return { admit: false, reason: 'rejected' };
}

/** 整组 voicing 是否全部在合同内(comp voicing 择优的合法性底)。midi[] → 取 pc 判。 */
export function voicingAllInContract(noteMidis: readonly number[], contract: ReadonlySet<number>): boolean {
  return noteMidis.every((m) => contract.has(mod12(m)));
}
