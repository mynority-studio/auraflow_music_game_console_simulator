// ============================================================
// motifSandbox · model · 重复强调摩擦修复(beginner healing Phase 2)
// ------------------------------------------------------------
// 扫描【所有相邻旋律音对】(非只结构音),按 scaleStyleIntervalTolerance 评风险。重复强调的刺耳摩擦
//   允许出现 2 次,第 3 次起把【第二个音】修到合同就近音(≤3 半音、保 contour)。
// 用户铁律:**exact quote 永不修**(只计 protectedQuoteFrictionCount);只修 develop/connect 等续写材料。
//   不与 smoothAndResolve 抢职责(它管大跳平滑;这里管风格/音阶不合法的重复摩擦)。纯函数 / 确定性。
// ============================================================

import type { MotifNote, SandboxStyle, HealingMode } from './types';
import type { SandboxTonality } from './sandboxScales';
import { assessFriction } from './scaleStyleIntervalTolerance';
import { contractAtBeat, isStructuralMelodyNote, type PitchContractContext } from './pitchContract';

const m12 = (n: number): number => ((n % 12) + 12) % 12;
const REPAIR_RISK = 0.65;
const REPEAT_LIMIT = 2;     // 前两次留,第 3 次起修
const MAX_MOVE = 3;         // 修复最大移动半音

export interface FrictionRepairAudit {
  frictionPairsScanned: number;
  frictionPairsFlagged: number;
  frictionPairsRepaired: number;
  frictionRepairsSkippedByStyleScale: number;
  protectedQuoteFrictionCount: number;
}

/** 该音是否【受保护、不可修】:exact/varied quote、首音、同音断奏锁。 */
function isProtected(n: MotifNote, idx: number): boolean {
  return n.occurrenceKind === 'quote' || idx === 0 || n.articulationLock === 'staccato-repeat';
}

/** 合同允许的就近音(stable∪color∪scale ∪ 输入音阶);±1..3 半音、保 contour、且新对不再高摩擦。无解 → null。 */
function repairTarget(prev: MotifNote, cur: MotifNote, next: MotifNote | undefined, allowedPcs: Set<number>, scalePcs: readonly number[], style: SandboxStyle, tonality: SandboxTonality | undefined, keyPc: number): number | null {
  const dir = Math.sign(cur.midi - prev.midi); // 原 contour 方向
  const deltas = [1, -1, 2, -2, 3, -3].sort((a, b) => Math.abs(a) - Math.abs(b) || (dir >= 0 ? b - a : a - b)); // 小步优先 + 顺原方向优先
  const lowFriction = (x: number, y: number): boolean => {
    if (m12(x) === m12(y)) return true;
    const a = assessFriction({ semitones: y - x, pcA: x, pcB: y, style, tonality, keyPc, scalePcs, emphasized: true, resolved: false, chordSupported: allowedPcs.has(m12(y)) });
    return a.risk < REPAIR_RISK;
  };
  for (const d of deltas) {
    if (Math.abs(d) > MAX_MOVE) continue;
    const cand = cur.midi + d;
    if (!allowedPcs.has(m12(cand))) continue;
    if (lowFriction(prev.midi, cand) && (!next || lowFriction(cand, next.midi))) return cand; // 不与前后造新摩擦
  }
  return null;
}

export function repairRepeatedMelodicFriction(
  notes: readonly MotifNote[],
  args: { pitchCtx: PitchContractContext; style: SandboxStyle; tonality?: SandboxTonality; keyPc: number; scalePcs: readonly number[]; mode?: HealingMode },
): { notes: MotifNote[]; audit: FrictionRepairAudit } {
  const audit: FrictionRepairAudit = { frictionPairsScanned: 0, frictionPairsFlagged: 0, frictionPairsRepaired: 0, frictionRepairsSkippedByStyleScale: 0, protectedQuoteFrictionCount: 0 };
  const out = notes.map((n) => ({ ...n })).sort((a, b) => a.onsetBeat - b.onsetBeat);
  if ((args.mode ?? 'beginner') === 'off' || out.length < 2) return { notes: out, audit };

  const { pitchCtx, style, tonality, keyPc, scalePcs } = args;
  const cellCount = new Map<string, number>();
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i], b = out[i + 1];
    const semis = b.midi - a.midi;
    if (Math.abs(semis) === 0) continue; // 同音/同度 → 跳(断奏交 healer)
    audit.frictionPairsScanned++;
    const emphasized = isStructuralMelodyNote(a) || isStructuralMelodyNote(b) || a.durationBeat >= 1 || b.durationBeat >= 1;
    const next = out[i + 2];
    const resolved = Math.abs(semis) <= 2 && !!next && Math.abs(next.midi - b.midi) <= 2; // 半音/全音级进 + 级进解决
    const contract = contractAtBeat(pitchCtx, b.onsetBeat);
    const chordSupported = contract.stablePcs.includes(m12(b.midi)) || contract.colorPcs.includes(m12(b.midi)) || contract.scalePcs.includes(m12(b.midi));
    const f = assessFriction({ semitones: semis, pcA: a.midi, pcB: b.midi, style, tonality, keyPc, scalePcs, emphasized, resolved, chordSupported });
    if (f.styleScaleExempt && f.risk + 0.45 >= REPAIR_RISK && emphasized) audit.frictionRepairsSkippedByStyleScale++; // 本会 flag 但被风格/音阶豁免
    if (f.risk < REPAIR_RISK || !emphasized || f.styleScaleExempt) continue;

    audit.frictionPairsFlagged++;
    const key = `${f.intervalClass}:${Math.sign(semis)}:${m12(a.midi)}->${m12(b.midi)}`;
    const occ = (cellCount.get(key) ?? 0) + 1; cellCount.set(key, occ);
    if (isProtected(b, i + 1)) { if (b.occurrenceKind === 'quote') audit.protectedQuoteFrictionCount++; continue; } // exact/varied quote 等不修(计数)
    if (occ <= REPEAT_LIMIT) continue; // 前两次留

    // 第 3 次起:修第二个音 → 合同就近音
    const allowed = new Set<number>([...contract.stablePcs, ...contract.colorPcs, ...contract.scalePcs, ...scalePcs.map(m12)]);
    const target = repairTarget(a, b, next, allowed, scalePcs, style, tonality, keyPc);
    if (target != null && target !== b.midi) {
      b.originalMidi = b.midi;
      b.midi = target;
      b.healingTags = [...(b.healingTags ?? []), 'friction-repaired'];
      audit.frictionPairsRepaired++;
    }
  }
  return { notes: out, audit };
}
