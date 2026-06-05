// ============================================================
// newEngine · harmony · TonicizationPlanner(离调 / 临时主音)
// ------------------------------------------------------------
// 港自 melodygenerative/src/lib/tonicizationPlanner.ts。在【degree-picker fallback 的
// diatonic 进行】上注入 secondary ii-V / V(临时主音),不改全曲调中心(区别于借和弦)。
// ★ 确定性(无 rng):对 repeatGroup 复用的同输入产同输出 → verse1≡verse2 排比不破。
//   placement = 该风格最高权重(argmax);可离调目标按 TARGET_MULT 取前 maxFires(互不相邻)。
//   prototype 路【不经此】(curated/locked);只补 diatonic fallback 的离调缺口(审计定位)。
// ============================================================

import { beats, mod12 } from '../foundation';
import { narrowQuality } from './progressionRealizer';
import {
  type TonicizeStyle, type BorrowSourceName, targetMult, topPlacement, vTypeFor, iiTypeFor,
} from '../knowledge/tonicizationPolicies';
import type { TonicizationPlacement } from '../knowledge/progressions';
import type { ResolvedChord } from './harmonyEngine';

const MINOR_QUALITIES = new Set(['min', 'm7', 'm7b5', 'dim7', 'm9', 'm11']);

function targetIsMinor(c: ResolvedChord): boolean {
  if (MINOR_QUALITIES.has(c.quality)) return true;
  return c.chordType ? /^m(?!aj)/.test(c.chordType) : false;
}
/** 已着色(借/副属/离调)→ 不再动。 */
function isColored(c: ResolvedChord): boolean {
  return !!c.borrowedSource || !!c.borrowed || c.roman.secondaryTarget !== undefined;
}

/** V/X:目标的属(上方五度);major target→Mixolydian,minor target→Phrygian Dominant。 */
function makeVX(target: ResolvedChord, dur: number, source: BorrowSourceName, minor: boolean, placement: TonicizationPlacement): ResolvedChord {
  const vType = vTypeFor(source, minor);
  return {
    roman: { degree: 5, accidental: 'natural', quality: narrowQuality(vType), secondaryTarget: target.roman },
    rootPc: mod12((target.rootPc as number) + 7),
    quality: narrowQuality(vType),
    chordType: vType,
    durationBeats: beats(dur),
    sectionId: target.sectionId,
    func: 'D',
    borrowedSource: 'secondary_dominant',
    mustResolve: true,
    forcedScale: minor ? 'Phrygian Dominant' : 'Mixolydian',
    localTonalCenterPc: target.rootPc,
    tonicizationPlacement: placement,
    sectionKeyPc: target.sectionKeyPc,
  };
}
/** ii/X:目标的上主音(上方大二度);major→Dorian m7,minor→Locrian m7b5。 */
function makeIIX(target: ResolvedChord, dur: number, source: BorrowSourceName, minor: boolean, placement: TonicizationPlacement): ResolvedChord {
  const iiType = iiTypeFor(source, minor);
  return {
    roman: { degree: 2, accidental: 'natural', quality: narrowQuality(iiType), secondaryTarget: target.roman },
    rootPc: mod12((target.rootPc as number) + 2),
    quality: narrowQuality(iiType),
    chordType: iiType,
    durationBeats: beats(dur),
    sectionId: target.sectionId,
    func: 'S',
    borrowedSource: 'secondary_ii_v',
    mustResolve: true,
    forcedScale: minor ? 'Locrian' : 'Dorian',
    localTonalCenterPc: target.rootPc,
    tonicizationPlacement: placement,
    sectionKeyPc: target.sectionKeyPc,
  };
}

/** 对一段 diatonic resolved 注入离调。返回新序列 + 实际触发次数。 */
export function planTonicization(args: {
  chords: ResolvedChord[];
  style: TonicizeStyle;
  borrowSource: BorrowSourceName;
  maxFires: number;
}): { chords: ResolvedChord[]; fires: number } {
  const { chords, style, borrowSource, maxFires } = args;
  const placement = topPlacement(style);
  const n = chords.length;
  if (!placement || maxFires <= 0 || n < 3) return { chords, fires: 0 };

  // 可离调目标:i = 被牺牲和弦下标(target = i+1);保末两和弦(终止)→ i ≤ n-3。
  const cands: { i: number; mult: number }[] = [];
  for (let i = 1; i <= n - 3; i++) {
    const mult = targetMult(chords[i + 1].roman.degree);
    if (mult <= 0) continue;
    if (isColored(chords[i + 1]) || isColored(chords[i])) continue;
    cands.push({ i, mult });
  }
  cands.sort((a, b) => (b.mult - a.mult) || (a.i - b.i));

  const chosen: number[] = [];
  for (const c of cands) {
    if (chosen.length >= maxFires) break;
    const tooClose = chosen.some((j) => Math.abs(j - c.i) <= (placement === 'full_2bar' ? 2 : 1));
    if (tooClose) continue;
    if (placement === 'full_2bar' && (c.i - 1 < 1 || isColored(chords[c.i - 1]))) continue;
    chosen.push(c.i);
  }
  if (chosen.length === 0) return { chords, fires: 0 };

  // 替换 map:下标 → 该位输出的 chord 列表。
  const repl = new Map<number, ResolvedChord[]>();
  for (const i of chosen) {
    const sac = chords[i];
    const target = chords[i + 1];
    const minor = targetIsMinor(target);
    const dur = sac.durationBeats as number;
    if (placement === 'light') {
      repl.set(i, [makeVX(target, dur, borrowSource, minor, 'light')]);
    } else if (placement === 'approach') {
      repl.set(i, [{ ...sac, durationBeats: beats(dur / 2) }, makeVX(target, dur / 2, borrowSource, minor, 'approach')]);
    } else if (placement === 'iiv_split') {
      repl.set(i, [makeIIX(target, dur / 2, borrowSource, minor, 'iiv_split'), makeVX(target, dur / 2, borrowSource, minor, 'iiv_split')]);
    } else { // full_2bar:前一格 ii/X(整)+ 本格 V/X(整)
      repl.set(i - 1, [makeIIX(target, chords[i - 1].durationBeats as number, borrowSource, minor, 'full_2bar')]);
      repl.set(i, [makeVX(target, dur, borrowSource, minor, 'full_2bar')]);
    }
  }

  const out: ResolvedChord[] = [];
  for (let j = 0; j < n; j++) out.push(...(repl.get(j) ?? [chords[j]]));
  return { chords: out, fires: chosen.length };
}
