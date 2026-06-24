// ============================================================
// motifSandbox · model · 每和弦音高合同(blues chord contract directive Phase 2)
// ------------------------------------------------------------
// 和声选择 + 旋律 slot 填充【共享】的 per-chord 音高合同。把"某音落在该和弦上合不合法"
// 从隐式(isChordTone / parent-scale)升级为显式分层:
//   stablePcs  —— 强/长/结构音可落(和弦音)
//   colorPcs   —— 和弦支持的色彩音(七/九 + 布鲁斯蓝调色,如 dom7#9 的 b3)
//   scalePcs   —— 弱经过/邻音可落(本和弦音阶 + 布鲁斯音阶)
//   approachPcs—— 半音/蓝调接近音,仅【弱拍 + 级进解决】可用
//   avoidPcs   —— 不宜作结构音(如大三和弦上的纯四度 11)
// 结构音 ⊂ stable∪color;弱音 ⊂ stable∪color∪scale∪approach(approach 须短弱且级进解决)。
// 纯函数 / 确定性 / 无 rng / 无 IO。
// ============================================================

import type { ScaleMode } from './types';
import type { SandboxTonality } from './sandboxScales';
import { TONALITY_INTERVALS } from './sandboxScales';
import { SCALE_INTERVALS } from './scale';
import { effectiveTonePcs, type SandboxChord } from './chords';
import { STRUCTURAL_TONE_MIN } from './melodicBrickTypes';
import type { MotifNote } from './types';

const m12 = (n: number): number => ((n % 12) + 12) % 12;

export type BluesFlavor = 'none' | 'dominant7' | 'blue3' | 'blue5' | 'sus' | 'borrowed' | 'backdoor' | 'secondary';

export interface ChordPitchContract {
  chordIndex: number;
  startBeat: number;
  durationBeats: number;
  stablePcs: number[];
  colorPcs: number[];
  scalePcs: number[];
  approachPcs: number[];
  avoidPcs: number[];
  bluesFlavor: BluesFlavor;
}

export interface PitchContractContext {
  keyPc: number;
  mode: ScaleMode;
  inputTonality?: SandboxTonality;
  isBluesInput: boolean;
  contracts: ChordPitchContract[];
}

export type NoteContractClass =
  | 'structural-supported' | 'color-supported' | 'scale-passing' | 'approach'
  | 'quote-blue' | 'unsupported-structural' | 'unsupported-weak';

/** 母调 7 音 pc。 */
function keyScalePcs(keyPc: number, mode: ScaleMode): number[] {
  return SCALE_INTERVALS[mode].map((iv) => m12(keyPc + iv));
}
/** 布鲁斯/输入音阶 pc(无 inputTonality → 空)。 */
function inputScalePcs(keyPc: number, tonality?: SandboxTonality): number[] {
  if (!tonality) return [];
  return TONALITY_INTERVALS[tonality].map((iv) => m12(keyPc + iv));
}
/** 该 key+tonality 的【特征蓝调音】pc:大调布鲁斯 = b3(key+3);小调布鲁斯 = b5(key+6);否则 null。 */
export function keyBlueNotePc(keyPc: number, tonality?: SandboxTonality): number | null {
  if (tonality === 'majorBlues') return m12(keyPc + 3);
  if (tonality === 'minorBlues') return m12(keyPc + 6);
  return null;
}
export function isBluesTonalityInput(tonality?: SandboxTonality): boolean {
  return tonality === 'majorBlues' || tonality === 'minorBlues';
}
/** 某 pc 是否当前 key/tonality 的蓝调色音。 */
export function isBlueColorPc(pc: number, keyPc: number, tonality: SandboxTonality): boolean {
  const blue = keyBlueNotePc(keyPc, tonality);
  return blue !== null && m12(pc) === blue;
}

const chRoot = (c: SandboxChord): number => c.realRootPc ?? c.rootPc;

/** 该和弦是否能把蓝调音当【色彩音】容纳(seasoned dom7/sus、或功能 D/S、或已含 b7)。 */
function chordAdmitsBlueColor(c: SandboxChord): boolean {
  const root = chRoot(c);
  const tones = effectiveTonePcs(c);
  const hasDom7 = tones.includes(m12(root + 10)); // b7 = 属功能/可加张力
  const func = c.effectiveFunc;
  const type = (c.realType ?? '').toLowerCase();
  return hasDom7 || type.includes('7') || type.includes('sus') || type.includes('dim') || type.includes('m7b5') || func === 'D' || func === 'S';
}

/** 从和弦推 bluesFlavor 标签(调试 + comp voicing 用)。 */
function deriveBluesFlavor(c: SandboxChord, blueNote: number | null): BluesFlavor {
  const root = chRoot(c);
  const tones = effectiveTonePcs(c);
  const type = (c.realType ?? '').toLowerCase();
  const bs = (c.borrowedSource ?? '').toLowerCase();
  if (blueNote !== null && tones.includes(blueNote)) return blueNote === m12(root + 3) ? 'blue3' : 'blue5';
  if (type.includes('m7b5') || type.includes('dim')) return 'blue5';
  if (type.includes('sus')) return 'sus';
  if (bs.includes('secondary')) return 'secondary';
  if (bs.includes('backdoor')) return 'backdoor';
  if (bs.includes('modal') || bs.includes('borrow')) return 'borrowed';
  if (tones.includes(m12(root + 10)) && tones.includes(m12(root + 4))) return 'dominant7';
  return 'none';
}

/** 单和弦 → 合同。 */
function buildChordContract(c: SandboxChord, index: number, keyPc: number, mode: ScaleMode, tonality?: SandboxTonality): ChordPitchContract {
  const root = chRoot(c);
  const stable = [...new Set(effectiveTonePcs(c).map(m12))];
  const ksc = keyScalePcs(keyPc, mode);
  const blue = keyBlueNotePc(keyPc, tonality);

  // color:① 调内的七/九(相对和弦根)未在 stable;② 布鲁斯蓝调音 —— 仅当本和弦能容纳(dom7/sus/D-S/已含)。
  const color = new Set<number>();
  for (const ext of [10, 11, 2, 14, 9 /* b7, maj7, 9, (9 oct), 13 rel root */]) {
    const pc = m12(root + ext);
    if (ksc.includes(pc) && !stable.includes(pc)) color.add(pc);
  }
  if (blue !== null && !stable.includes(blue) && chordAdmitsBlueColor(c)) color.add(blue);
  for (const s of stable) color.delete(s);

  // scale:母调 ∪ 输入音阶(布鲁斯),减 stable∪color = 弱经过/邻音候选。
  const scalePool = new Set<number>([...ksc, ...inputScalePcs(keyPc, tonality)]);
  const scale: number[] = [];
  for (const pc of scalePool) if (!stable.includes(pc) && !color.has(pc)) scale.push(pc);

  // approach:剩余半音(仅弱拍 + 级进解决)。
  const used = new Set<number>([...stable, ...color, ...scale]);
  const approach: number[] = [];
  for (let pc = 0; pc < 12; pc++) if (!used.has(pc)) approach.push(pc);

  // avoid(结构音不宜):大三和弦上的纯四度 11(= 大三 +1 半音)非 sus 时是经典冲突。
  const avoid: number[] = [];
  const type = (c.realType ?? '').toLowerCase();
  if (stable.includes(m12(root + 4)) && !type.includes('sus')) avoid.push(m12(root + 5)); // 大三上的 11

  return {
    chordIndex: index, startBeat: c.startBeat, durationBeats: c.durationBeats,
    stablePcs: stable.sort((a, b) => a - b),
    colorPcs: [...color].sort((a, b) => a - b),
    scalePcs: scale.sort((a, b) => a - b),
    approachPcs: approach.sort((a, b) => a - b),
    avoidPcs: avoid,
    bluesFlavor: deriveBluesFlavor(c, blue),
  };
}

export function buildPitchContractContext(args: {
  progression: readonly SandboxChord[];
  keyPc: number;
  mode: ScaleMode;
  inputTonality?: SandboxTonality;
}): PitchContractContext {
  const { progression, keyPc, mode, inputTonality } = args;
  return {
    keyPc, mode, inputTonality,
    isBluesInput: isBluesTonalityInput(inputTonality),
    contracts: progression.map((c, i) => buildChordContract(c, i, keyPc, mode, inputTonality)),
  };
}

export function contractAtBeat(ctx: PitchContractContext, beat: number): ChordPitchContract {
  const cs = ctx.contracts;
  return cs.find((c) => beat >= c.startBeat - 1e-6 && beat < c.startBeat + c.durationBeats - 1e-6) ?? cs[cs.length - 1];
}

/** 结构音判定:有 structuralToneScore 用阈值;否则退【下拍 或 时长 ≥1 拍】。 */
export function isStructuralMelodyNote(note: MotifNote): boolean {
  if (typeof note.structuralToneScore === 'number') return note.structuralToneScore >= STRUCTURAL_TONE_MIN;
  const onBeat = Math.abs(note.onsetBeat - Math.round(note.onsetBeat)) < 1e-6;
  return onBeat || note.durationBeat >= 1;
}

export function classifyMelodyNoteAgainstContract(args: {
  note: MotifNote;
  prev?: MotifNote;
  next?: MotifNote;
  contract: ChordPitchContract;
  isBlue?: boolean; // 该音是否当前 key 的蓝调色音(调用方据 ctx 算)
}): NoteContractClass {
  const { note, contract } = args;
  const pc = m12(note.midi);
  const structural = isStructuralMelodyNote(note);
  // quote 蓝调音:原样保留,单独归类(不当 unsupported,但审计可见)
  if (note.occurrenceKind === 'quote' && args.isBlue && !contract.stablePcs.includes(pc) && !contract.colorPcs.includes(pc)) return 'quote-blue';
  if (contract.stablePcs.includes(pc)) return 'structural-supported';
  if (contract.colorPcs.includes(pc)) return 'color-supported';
  if (structural) return 'unsupported-structural';
  if (contract.scalePcs.includes(pc)) return 'scale-passing';
  if (contract.approachPcs.includes(pc)) return 'approach';
  return 'unsupported-weak';
}

/** 把 midi 吸到合同允许集里最近的音(保八度,平手按 preferDirection)。
 *  structural=true → 仅 stable∪color;否则 stable∪color∪scale。无解 → 原值。 */
export function nearestContractTone(midi: number, contract: ChordPitchContract, opts: { structural?: boolean; preferDirection?: 1 | -1 | 0 } = {}): number {
  const allowed = opts.structural
    ? [...contract.stablePcs, ...contract.colorPcs]
    : [...contract.stablePcs, ...contract.colorPcs, ...contract.scalePcs];
  if (!allowed.length) return midi;
  const dir = opts.preferDirection ?? 0;
  let best = midi, bestScore = Infinity;
  for (const pc of new Set(allowed)) {
    const base = midi - m12(midi) + pc;
    for (const cand of [base - 12, base, base + 12]) {
      const d = Math.abs(cand - midi);
      // 方向偏好:同距离时,顺 dir 的略优
      const dirPenalty = dir === 0 ? 0 : ((cand - midi) * dir < 0 ? 0.25 : 0);
      const score = d + dirPenalty;
      if (score < bestScore) { bestScore = score; best = cand; }
    }
  }
  return best;
}
