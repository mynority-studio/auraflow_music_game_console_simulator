// ============================================================
// newEngine · knowledge · ChordIntervalRoles(和弦内音程角色,B-port 乐理事实)
// ------------------------------------------------------------
// Provenance:port 自 melodygenerative/src/lib/musicTheory.ts(CHORD_VOICING_AESTHETICS)。
//   按【和弦品质族】逐音程(相对根音 pc)给角色:
//     CHORD_TONE(骨干) · AVAILABLE_TENSION(可用张力 9/13…可加色) ·
//     ALTERED_TENSION(改变张力,属和弦专属) · AVOID_NOTE(避免)。
//   每项带 tensionLevel(0..1)+ registerHint(low/mid/high/flex)。
// 用途:voicer 参考它给 comp 加可用张力出彩色 voicing;melody/audit 参考它判音的色彩角色。
// 纯乐理事实。比 tensionModel(stable/acceptable/avoid 三分)多了 altered + 力度 + 音区提示。
// ============================================================

import { mod12, type PitchClass } from '../foundation';
import { chordTypeIntervals, type ChordQuality } from './chords';

export type NoteFunctionRole = 'CHORD_TONE' | 'AVAILABLE_TENSION' | 'ALTERED_TENSION' | 'AVOID_NOTE';
export type RegisterHint = 'low' | 'mid' | 'high' | 'flex';

export interface ChordIntervalAesthetic {
  role: NoteFunctionRole;
  tensionLevel: number;     // 0..1
  register: RegisterHint;
}

type Fam = 'maj' | 'min' | 'dom' | 'm7b5' | 'sus';

// 逐音程(0..11,相对根音)→ [role, tensionLevel, register]。port 自 CHORD_VOICING_AESTHETICS,逐值忠实。
const C = (r: NoteFunctionRole, t: number, reg: RegisterHint): ChordIntervalAesthetic => ({ role: r, tensionLevel: t, register: reg });

const TABLE: Record<Fam, readonly ChordIntervalAesthetic[]> = {
  maj: [C('CHORD_TONE', 0.0, 'flex'), C('AVOID_NOTE', 1.0, 'flex'), C('AVAILABLE_TENSION', 0.3, 'high'), C('AVOID_NOTE', 0.9, 'flex'), C('CHORD_TONE', 0.1, 'low'), C('AVOID_NOTE', 0.85, 'flex'), C('AVAILABLE_TENSION', 0.6, 'high'), C('CHORD_TONE', 0.05, 'mid'), C('AVOID_NOTE', 0.85, 'flex'), C('AVAILABLE_TENSION', 0.4, 'high'), C('AVOID_NOTE', 0.75, 'flex'), C('CHORD_TONE', 0.2, 'low')],
  min: [C('CHORD_TONE', 0.0, 'flex'), C('AVOID_NOTE', 0.9, 'flex'), C('AVAILABLE_TENSION', 0.35, 'high'), C('CHORD_TONE', 0.1, 'low'), C('AVOID_NOTE', 0.95, 'flex'), C('AVAILABLE_TENSION', 0.4, 'high'), C('AVOID_NOTE', 0.8, 'flex'), C('CHORD_TONE', 0.05, 'mid'), C('AVOID_NOTE', 0.75, 'flex'), C('AVAILABLE_TENSION', 0.5, 'high'), C('CHORD_TONE', 0.2, 'low'), C('AVAILABLE_TENSION', 0.65, 'low')],
  dom: [C('CHORD_TONE', 0.0, 'flex'), C('ALTERED_TENSION', 0.8, 'high'), C('AVAILABLE_TENSION', 0.4, 'high'), C('ALTERED_TENSION', 0.85, 'high'), C('CHORD_TONE', 0.1, 'low'), C('AVOID_NOTE', 0.95, 'flex'), C('ALTERED_TENSION', 0.75, 'high'), C('CHORD_TONE', 0.1, 'mid'), C('ALTERED_TENSION', 0.8, 'high'), C('AVAILABLE_TENSION', 0.5, 'high'), C('CHORD_TONE', 0.15, 'low'), C('AVOID_NOTE', 1.0, 'flex')],
  m7b5: [C('CHORD_TONE', 0.0, 'flex'), C('AVAILABLE_TENSION', 0.7, 'high'), C('AVAILABLE_TENSION', 0.6, 'high'), C('CHORD_TONE', 0.1, 'low'), C('AVOID_NOTE', 1.0, 'flex'), C('AVAILABLE_TENSION', 0.5, 'high'), C('CHORD_TONE', 0.3, 'mid'), C('AVOID_NOTE', 0.9, 'flex'), C('AVAILABLE_TENSION', 0.6, 'high'), C('AVOID_NOTE', 0.8, 'flex'), C('CHORD_TONE', 0.1, 'low'), C('AVOID_NOTE', 1.0, 'flex')],
  sus: [C('CHORD_TONE', 0.0, 'flex'), C('ALTERED_TENSION', 0.7, 'high'), C('CHORD_TONE', 0.1, 'mid'), C('ALTERED_TENSION', 0.7, 'high'), C('AVOID_NOTE', 0.95, 'flex'), C('CHORD_TONE', 0.1, 'mid'), C('AVAILABLE_TENSION', 0.6, 'high'), C('CHORD_TONE', 0.1, 'mid'), C('ALTERED_TENSION', 0.7, 'high'), C('AVAILABLE_TENSION', 0.4, 'high'), C('CHORD_TONE', 0.1, 'low'), C('AVOID_NOTE', 0.9, 'flex')],
};

// 我方 ChordQuality → 品质族(dim7 复用 m7b5 表,同减族读法)
function familyOf(quality: ChordQuality): Fam {
  switch (quality) {
    case 'maj': case 'maj7': return 'maj';
    case 'min': case 'm7': return 'min';
    case '7': return 'dom';
    case 'm7b5': case 'dim7': return 'm7b5';
    default: return 'maj';
  }
}

/** 某品质下,相对根音 pc 的音程角色 + 力度 + 音区提示。 */
export function chordIntervalRole(quality: ChordQuality, intervalFromRoot: number): ChordIntervalAesthetic {
  return TABLE[familyOf(quality)][mod12(intervalFromRoot)];
}

/**
 * 从候选 pc(通常 colorToneMap)里挑【可用张力】出来:
 *   只取 AVAILABLE_TENSION,按 tensionLevel 升序(先 9 再 13 再 #11,温和优先),取前 count 个。
 * 返回绝对 pc[]。count<=0 或无可用 → []。(给旋律/宽和弦 producer 参考,不给 comp 加色 —— 见 feedback)
 */
export function pickColorTones(quality: ChordQuality, rootPc: PitchClass, candidatePcs: readonly number[], count: number): PitchClass[] {
  if (count <= 0) return [];
  return candidatePcs
    .map((pc) => ({ pc, a: chordIntervalRole(quality, mod12(pc - rootPc)) }))
    .filter((x) => x.a.role === 'AVAILABLE_TENSION')
    .sort((x, y) => x.a.tensionLevel - y.a.tensionLevel)
    .slice(0, count)
    .map((x) => mod12(x.pc));
}

// —— 宽 chordType 字符串版(供统一评判器 evaluateNoteInChordContext)——
// port 自 melodygenerative musicTheory.ts:逐音程角色按 chordType 字符串 dispatch + avoid 物理法则。

/** chordType 字符串 → 12 音程角色表(dispatch 顺序载重:sus→maj→m7b5→min→dom7,逐值忠实)。 */
export function getChordVoicingAesthetics(chordType: string): readonly ChordIntervalAesthetic[] {
  if (chordType.includes('sus')) return TABLE.sus;
  if (chordType.includes('maj') || chordType === 'add9' || chordType === 'aug') return TABLE.maj;
  if (chordType.includes('m7b5') || chordType.includes('m9b5') || chordType.includes('m11b5') || chordType.includes('dim') || (chordType.startsWith('m') && chordType.includes('b5'))) return TABLE.m7b5;
  if (chordType.includes('m') || chordType === 'min') return TABLE.min;
  if (chordType === '11' || chordType === '13' || chordType.includes('7') || chordType.includes('9')) return TABLE.dom;
  if (chordType === '6' || chordType === '6/9') return TABLE.maj;
  if (chordType === '5') return TABLE.maj;
  if (chordType === 'quartal') return TABLE.min;
  return TABLE.maj; // 兜底
}

/** 属族判定:非 maj/min,且有 b7(10)+(大三 4 或 4 度 5)。 */
export function isDomFamilyChord(chordType: string, intervals: readonly number[]): boolean {
  if (chordType.startsWith('maj')) return false;
  if (chordType.startsWith('m') && !chordType.startsWith('maj')) return false;
  return intervals.includes(10) && (intervals.includes(4) || intervals.includes(5));
}

// 调式特征音(相对音阶根音半音);modal context 下免 avoid 判。port 自 MODAL_CHARACTERISTIC_NOTES。
export const MODAL_CHARACTERISTIC_NOTES: Record<string, readonly number[]> = {
  'Dorian': [9], 'Phrygian': [1], 'Lydian': [6], 'Mixolydian': [10], 'Locrian': [1, 6], 'Aeolian': [8],
  'Harmonic Minor': [8, 11], 'Melodic Minor': [9, 11], 'Blues': [3, 6, 10], 'Major Blues': [3],
  'Lydian Dominant': [6, 10], 'Phrygian Dominant': [1, 8], 'Altered': [1, 3, 6, 8], 'Bebop Dominant': [10, 11], 'Bebop Major': [8, 9],
};

/** avoid note 物理判据(小九度碰撞 + 三全音泄露 + 属例外 + 破坏音)。port 自 isAvoidNote,逐条忠实。 */
export function isAvoidNote(interval: number, chordType: string, scaleName = '', isModalContext = false, func: 'T' | 'S' | 'D' | string = 'T'): boolean {
  const pc = mod12(interval);
  const chordIvs = chordTypeIntervals(chordType);
  if (chordIvs.some((iv) => mod12(iv) === pc)) return false; // 0. chord literal 永远安全

  const isHalfDim = chordType === 'm7b5' || chordType === 'm9b5';
  const isDim = chordType === 'dim' || chordType === 'dim7';
  const isMinor = !isHalfDim && !isDim && (chordType === 'min' || (chordType.startsWith('m') && !chordType.startsWith('maj')));
  const isDom = !isMinor && !isHalfDim && !isDim && (chordType === '7' || chordType.startsWith('7') || chordType === '9' || chordType === '11' || chordType === '13' || chordType.includes('alt'));
  const isSus = chordType.includes('sus');
  const isAug = chordType === 'aug' || chordType.includes('#5');
  const third = isSus ? 5 : (isMinor || isHalfDim || isDim ? 3 : 4);
  const fifth = isHalfDim || isDim ? 6 : isAug ? 8 : 7;

  // 1. modal 特征音免死
  if (isModalContext && scaleName && MODAL_CHARACTERISTIC_NOTES[scaleName]?.includes(pc)) return false;
  // 2. 属和弦例外:全张力合法,仅避纯 4 度(非 sus)与 maj7
  if (isDom || func === 'D') {
    if (pc === 5 && !isSus) return true;
    if (pc === 11) return true;
    return false;
  }
  // 3. 破坏和弦性质的核心音
  if (isSus && (pc === 3 || pc === 4)) return true;
  if (!isMinor && !isHalfDim && !isSus && !isDim && pc === 3) return true; // 大调避 b3
  if ((isMinor || isHalfDim) && !isSus && pc === 4) return true;            // 小调避 maj3
  // 4. 法则1:小九度碰撞(1/3/5 上方半音)
  for (const bone of [0, third, fifth]) if (pc === mod12(bone + 1)) return true;
  // 5. 法则2:三全音泄露(小和弦上的 M6,func 非 D/S)
  if (!isModalContext && func !== 'D' && func !== 'S' && (isMinor || isHalfDim) && pc === 9) return true;
  return false;
}

/** 和弦可接受色彩集(global contract):品质决定哪些张力是"声音内色彩"。port 自 computeGlobalContract。 */
export function computeGlobalContract(chordType: string, chordRootPc: number): { intervals: number[]; pcs: Set<number> } {
  const intervals: number[] = [...chordTypeIntervals(chordType)];
  const isHalfDim = chordType === 'm7b5' || chordType === 'm9b5';
  const isMin = !isHalfDim && (chordType === 'min' || (chordType.startsWith('m') && !chordType.startsWith('maj') && chordType !== 'maj'));
  const isDim = chordType === 'dim' || chordType === 'dim7';
  const isDom = !isMin && !isDim && !isHalfDim && (chordType === '7' || chordType === '9' || chordType.startsWith('7'));
  const isMaj = !isMin && !isDim && !isHalfDim && !isDom && chordType !== 'aug';
  const add = (iv: number) => { if (!intervals.includes(iv)) intervals.push(iv); };
  if (isMaj) { add(14); add(9); add(18); }                         // 9, 13, #11
  if (isMin) { add(14); add(17); add(9); add(10); }                // 9, 11, 13, b7
  if (isDom) { add(14); add(21); add(13); add(15); add(18); add(20); } // 9,13,b9,#9,#11,b13
  if (isHalfDim) { add(17); add(20); }                             // 11, b13
  const rootPc = mod12(chordRootPc);
  return { intervals, pcs: new Set(intervals.map((i) => mod12(rootPc + i))) };
}

export type NoteRole = 'chord_tone' | 'stable_tension' | 'characteristic' | 'avoid' | 'chromatic';

/** 单音在和弦中的角色(优先级 chord_tone > avoid > characteristic > stable_tension > chromatic)。port 自 classifyNoteRole。 */
export function classifyNoteRole(pc: number, chordType: string, chordRootPc: number, scaleName = '', isModalContext = false, func: 'T' | 'S' | 'D' | string = 'T', scaleRootPc = -1, runScalePcs: ReadonlySet<number> | null = null): NoteRole {
  const normPc = mod12(pc);
  const rootPc = mod12(chordRootPc);
  const ivFromRoot = mod12(normPc - rootPc);
  if (chordTypeIntervals(chordType).some((iv) => mod12(iv) === ivFromRoot)) return 'chord_tone';
  if (isAvoidNote(ivFromRoot, chordType, scaleName, isModalContext, func)) return 'avoid';
  if (isModalContext && scaleName && MODAL_CHARACTERISTIC_NOTES[scaleName]) {
    const sr = scaleRootPc >= 0 ? scaleRootPc : rootPc;
    if (MODAL_CHARACTERISTIC_NOTES[scaleName].includes(mod12(normPc - sr))) return 'characteristic';
  }
  if (computeGlobalContract(chordType, chordRootPc).pcs.has(normPc)) return 'stable_tension';
  if (runScalePcs && runScalePcs.has(normPc)) return 'stable_tension';
  return 'chromatic';
}
