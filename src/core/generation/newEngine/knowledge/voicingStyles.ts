// ============================================================
// newEngine · knowledge · VoicingStyles(排列风格 + pc 选择 + 排列变换,B-port 纯规则)
// ------------------------------------------------------------
// Provenance:port 自 melodygenerative/src/lib/musicTheory.ts:
//   VoicingStylePreference / STYLE_* 预设 / resolveClash / assembleVoicing
//   / ArrangementMode / applyArrangement(drop2/drop3/spread)+ muddy 后置校正。
// 只产 pc(assembleVoicing)与 MIDI 变换(applyArrangement),不写事件(render 层职责)。
// 八度落点 = voicingPlacement.ts 的 placeVoicingMidi。
// ============================================================

import { mod12 } from '../foundation';
import { chordTypeIntervals } from './chords';
import { getChordVoicingAesthetics, type NoteFunctionRole } from './chordIntervalRoles';

export interface VoicingStylePreference {
  /** comp 排列是否含根音。 */
  rootPolicy: 'include' | 'omit' | 'keep_if_open';
  /** 目标声部数(受和弦字面音数上限约束)。 */
  density: number;
  /**
   * true 时给不含 9 的三和弦 / 7 和弦补 9(Bill Evans rootless / cluster);
   * shell / full / blues 通常 false。
   */
  addColorOnTriad?: boolean;
}

// 5 种排列风格预设(realizeProgression 的 5 mode)。
export const STYLE_SHELL: VoicingStylePreference = { rootPolicy: 'include', density: 4, addColorOnTriad: false };
export const STYLE_ROOTLESS: VoicingStylePreference = { rootPolicy: 'omit', density: 4, addColorOnTriad: true }; // Bill Evans
export const STYLE_CLUSTER: VoicingStylePreference = { rootPolicy: 'omit', density: 4, addColorOnTriad: true };
export const STYLE_FULL: VoicingStylePreference = { rootPolicy: 'include', density: 5, addColorOnTriad: false };
export const STYLE_BLUES: VoicingStylePreference = { rootPolicy: 'include', density: 4, addColorOnTriad: false };

// —— pc 间小二度撞音消解 ——
export type ClashResolution = { keep: 'both'; reason: string } | { drop: number; reason: string };

/** 两 pc 距 1 半音时的取舍:AVOID 先掉;非 sus 时纯 5 度让位于 ALTERED;其它八度分隔保留。 */
export function resolveClash(pcA: number, pcB: number, chordType: string, chordRootPc: number): ClashResolution {
  const table = getChordVoicingAesthetics(chordType);
  const intervalA = mod12(pcA - chordRootPc);
  const intervalB = mod12(pcB - chordRootPc);
  const a = table[intervalA];
  const b = table[intervalB];
  if (!a || !b) return { keep: 'both', reason: 'no aesthetic entry' };

  // Rule 1: AVOID 永远掉
  if (a.role === 'AVOID_NOTE' && b.role !== 'AVOID_NOTE') return { drop: pcA, reason: `pc${pcA} is AVOID_NOTE in ${chordType}` };
  if (b.role === 'AVOID_NOTE' && a.role !== 'AVOID_NOTE') return { drop: pcB, reason: `pc${pcB} is AVOID_NOTE in ${chordType}` };

  // Rule 2: 非 sus 时,纯 5 度(7)撞 ALTERED_TENSION → 5 让位(bass 泛音含 5,冗余)
  const PERFECT_FIFTH = 7;
  const isSusFamily = chordType.includes('sus');
  if (!isSusFamily) {
    if (intervalA === PERFECT_FIFTH && a.role === 'CHORD_TONE' && b.role === 'ALTERED_TENSION') return { drop: pcA, reason: `5 yields to altered tension` };
    if (intervalB === PERFECT_FIFTH && b.role === 'CHORD_TONE' && a.role === 'ALTERED_TENSION') return { drop: pcB, reason: `5 yields to altered tension` };
  }

  // Rule 3: 其它距 1 对都保留 —— voicing placer 用八度分隔成 M7/复合 M7 音响,非撞音
  return { keep: 'both', reason: `${a.role} / ${b.role} kept — placer octave-separates` };
}

// 丢弃优先级:AVOID(0)< AVAILABLE(1)< ALTERED(2)< CHORD_TONE(3);identity 音 = 1000 不可丢。
function dropPriority(role: NoteFunctionRole, tensionLevel: number, isIdentityTone = false): number {
  if (isIdentityTone) return 1000;
  const roleBase = role === 'AVOID_NOTE' ? 0 : role === 'AVAILABLE_TENSION' ? 1 : role === 'ALTERED_TENSION' ? 2 : 3;
  return roleBase + tensionLevel;
}

// 和弦 identity 音程(去掉就毁和弦品质的 pc,相对根音)。逐类忠实 port。
function chordIdentityIntervals(chordType: string): Set<number> {
  const result = new Set<number>();
  if (chordType === 'maj' || chordType === 'add9' || chordType === '6' || chordType === '6/9') { result.add(4); return result; }
  if (chordType.includes('maj')) { result.add(4); result.add(11); return result; }
  if (chordType === 'm7b5' || chordType === 'm9b5' || chordType === 'm11b5' || chordType.includes('dim') || (chordType.startsWith('m') && chordType.includes('b5'))) {
    result.add(3); result.add(6);
    if (!chordType.includes('dim') || chordType === 'dim7') result.add(10);
    return result;
  }
  if (chordType === 'sus2') { result.add(2); return result; }
  if (chordType === 'sus4') { result.add(5); return result; }
  if (chordType === '7sus4' || chordType === '9sus4') { result.add(5); result.add(10); return result; }
  if (chordType.startsWith('m') && !chordType.startsWith('maj')) {
    result.add(3);
    if (chordType !== 'm' && chordType !== 'min') result.add(10);
    if (chordType === 'm11') result.add(mod12(17));
    return result;
  }
  if (chordType === '11') { result.add(5); result.add(10); return result; }
  if (chordType === '13' || chordType.startsWith('13')) { result.add(4); result.add(10); result.add(mod12(21)); return result; }
  if (chordType.includes('7') || chordType.includes('9') || chordType === 'aug') { result.add(4); result.add(10); return result; }
  result.add(4);
  return result;
}

/**
 * 从和弦字面 + 风格,选出 comp 排列的 pc(升序):
 *   ① 字面 pc → ② 可选补 9 → ③ 小二度撞音消解 → ④ rootPolicy → ⑤ 超 density 按优先级丢(identity 1000 不丢)。
 * 只产 pc;八度落点交 placeVoicingMidi。
 */
export function assembleVoicing(chordType: string, chordRootPc: number, style: VoicingStylePreference): number[] {
  const intervals = chordTypeIntervals(chordType);
  let pcs = Array.from(new Set(intervals.map((iv) => mod12(chordRootPc + iv))));

  // ② addColorOnTriad:给 ≤4 音且无 9 的和弦补 9
  if (style.addColorOnTriad) {
    const ninthPc = mod12(chordRootPc + 2);
    if (!pcs.includes(ninthPc) && pcs.length <= 4) pcs.push(ninthPc);
  }

  // ③ 成对小二度撞音消解(每次掉一个后重判)
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < pcs.length; i++) {
      for (let j = i + 1; j < pcs.length; j++) {
        const a = pcs[i], b = pcs[j];
        const dist = Math.min(mod12(a - b), mod12(b - a));
        if (dist !== 1) continue;
        const res = resolveClash(a, b, chordType, chordRootPc);
        if ('drop' in res) { pcs = pcs.filter((pc) => pc !== res.drop); changed = true; break; }
      }
      if (changed) break;
    }
  }

  // ④ rootPolicy
  if (style.rootPolicy === 'omit' && pcs.length > 1) pcs = pcs.filter((pc) => pc !== chordRootPc);

  // ⑤ 超 density:按优先级丢低分(identity 音 1000 不可丢)
  if (pcs.length > style.density) {
    const table = getChordVoicingAesthetics(chordType);
    const identityIvs = chordIdentityIntervals(chordType);
    const scored = pcs.map((pc) => {
      const iv = mod12(pc - chordRootPc);
      const entry = table[iv];
      const isIdentity = identityIvs.has(iv);
      return { pc, priority: entry ? dropPriority(entry.role, entry.tensionLevel, isIdentity) : (isIdentity ? 1000 : 0) };
    });
    scored.sort((x, y) => y.priority - x.priority);
    pcs = scored.slice(0, style.density).map((s) => s.pc);
  }

  return pcs.sort((a, b) => a - b);
}

// —— 排列变换:close/drop2/drop3/spread(placeVoicingMidi 之后施加)——
export type ArrangementMode = 'close' | 'drop2' | 'drop3' | 'spread';

const ARRANGEMENT_BASS_SAFETY = 4;
const ARRANGEMENT_ABSOLUTE_FLOOR = 33; // A1
const MUDDY_M2_BELOW_MIDI = 64;        // E4
const MUDDY_M2_GAP_BELOW_MIDI = 50;    // D3

/** 检测 voicing 相对 bass 是否浑浊(低区相邻 m2/M2,或 bass 上方 13/25 半音的 m9 cluster)。 */
function hasMuddyInterval(midis: number[], bassMidi: number): boolean {
  if (midis.length < 2) return false;
  const sorted = midis.slice().sort((a, b) => a - b);
  const b9Pc = mod12(mod12(bassMidi) + 1);
  for (const m of sorted) {
    const intervalToBass = m - bassMidi;
    if (intervalToBass < 8 || intervalToBass > 25) continue;
    if (mod12(m) === b9Pc && (intervalToBass === 13 || intervalToBass === 25)) return true;
  }
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    const lowerMidi = sorted[i - 1];
    if (gap === 1 && lowerMidi < MUDDY_M2_BELOW_MIDI) return true;
    if (gap === 2 && lowerMidi < MUDDY_M2_GAP_BELOW_MIDI) return true;
  }
  return false;
}

/**
 * 把 close voicing 变 drop2/drop3/spread(把第 N-from-top 声部下移八度)。
 * 安全:落点低于 bass+4 或 < 33 → 拒绝;落点产生新 muddy → 拒绝回退 close。bass 永不动。
 */
export function applyArrangement(midis: number[], mode: ArrangementMode, bassMidi?: number): number[] {
  const sorted = midis.slice().sort((a, b) => a - b);
  if (mode === 'close' || sorted.length < 3) return sorted;

  const safetyFloor = bassMidi !== undefined ? bassMidi + ARRANGEMENT_BASS_SAFETY : ARRANGEMENT_ABSOLUTE_FLOOR;
  const tryDrop = (arr: number[], idx: number): number[] | null => {
    if (idx < 0 || idx >= arr.length) return null;
    const dropped = arr[idx] - 12;
    if (dropped < safetyFloor || dropped < ARRANGEMENT_ABSOLUTE_FLOOR) return null;
    const out = arr.slice();
    out[idx] = dropped;
    const result = out.sort((a, b) => a - b);
    if (bassMidi !== undefined && hasMuddyInterval(result, bassMidi)) return null;
    return result;
  };

  if (mode === 'drop2') return tryDrop(sorted, sorted.length - 2) ?? sorted;
  if (mode === 'drop3') return sorted.length < 4 ? sorted : (tryDrop(sorted, sorted.length - 3) ?? sorted);
  if (mode === 'spread') {
    if (sorted.length < 4) return tryDrop(sorted, sorted.length - 2) ?? sorted;
    const fourthFromTopOrig = sorted[sorted.length - 4];
    const afterDrop2 = tryDrop(sorted, sorted.length - 2);
    if (!afterDrop2) return sorted;
    const newIdx4 = afterDrop2.indexOf(fourthFromTopOrig);
    if (newIdx4 < 0) return afterDrop2;
    return tryDrop(afterDrop2, newIdx4) ?? afterDrop2;
  }
  return sorted;
}
