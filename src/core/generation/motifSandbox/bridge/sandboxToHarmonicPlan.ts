// ============================================================
// motifSandbox · bridge · Q+R 和声 → Q+N HarmonicPlan(走 A · PR2)
// ------------------------------------------------------------
// 把 Q+R 选出的 progression(SandboxChord[],带 realRoman/realType/realRootPc/borrowedSource/effectiveFunc)
// 转成 Q+N 的【权威 HarmonicPlan】—— 复用 harmony 引擎的 assemble() 自动算全套张力/音阶 map。
// 这样喂进 generateSongFromMotif 后,Q+N 的 bass/comp/pad/drum 全部吃这套和声(单一真源,自动跟随)。
// ★ 边界:只复用 harmony 知识(assemble),不改 Q+N 行为;sandbox 和声做权威,Q+N 只渲染。
// ============================================================

import { assemble, type ResolvedChord } from '../../newEngine/harmony/harmonyEngine';
import type { HarmonicPlan, HarmonicFunction, RomanChord } from '../../newEngine/harmony/HarmonicPlan';
import { chordTypeIntervals, normalizeChordType, type ChordQuality } from '../../newEngine/knowledge/chords';
import type { PitchClass } from '../../newEngine/foundation';
import type { SandboxChord } from '../model/chords';
import type { ScaleMode } from '../model/types';

const m12 = (n: number): number => ((n % 12) + 12) % 12;
const clampDegree = (d: number): RomanChord['degree'] => (((Math.round(d) - 1) % 7 + 7) % 7 + 1) as RomanChord['degree'];

/** 宽 chordType(realType,如 '7b9'/'maj9'/'m7b5')→ 窄 ChordQuality(7 种)。按和弦音程分类。 */
function narrowQuality(chordType: string | undefined): ChordQuality {
  const id = normalizeChordType(chordType ?? 'maj');
  const ivs = new Set(chordTypeIntervals(id ?? 'maj').map(m12));
  const min3 = ivs.has(3), maj3 = ivs.has(4), dim5 = ivs.has(6), min7 = ivs.has(10), maj7i = ivs.has(11), dim7i = ivs.has(9);
  if (min3 && dim5 && dim7i) return 'dim7';
  if (min3 && dim5 && min7) return 'm7b5';
  if (min3 && min7) return 'm7';
  if (min3) return 'min';
  if (maj3 && maj7i) return 'maj7';
  if (maj3 && min7) return '7';
  return 'maj';
}

/** 级数 → T/S/D(5/7=D,2/4=S,余 T);effectiveFunc 优先。 */
function funcOf(c: SandboxChord): HarmonicFunction {
  if (c.effectiveFunc) return c.effectiveFunc;
  const d = ((Math.round(c.degree) - 1) % 7 + 7) % 7 + 1;
  return d === 5 || d === 7 ? 'D' : d === 2 || d === 4 ? 'S' : 'T';
}

const BORROW_SOURCES = new Set(['secondary_dominant', 'modal_interchange', 'backdoor_dominant', 'neapolitan', 'tritone_sub', 'chromatic_mediant']);

/** SandboxChord → ResolvedChord(harmony 引擎装配输入)。 */
function toResolvedChord(c: SandboxChord, sectionId: string): ResolvedChord {
  const rootPc = m12(c.realRootPc ?? c.rootPc) as PitchClass;
  const quality = narrowQuality(c.realType);
  const chordType = normalizeChordType(c.realType ?? quality) ?? undefined;
  const func = funcOf(c);
  const borrowedSource = c.borrowedSource && BORROW_SOURCES.has(c.borrowedSource) ? (c.borrowedSource as ResolvedChord['borrowedSource']) : undefined;
  return {
    roman: { degree: clampDegree(c.degree), accidental: 'natural', quality },
    rootPc,
    quality,
    durationBeats: c.durationBeats,
    sectionId,
    func,
    chordType,            // 宽权威类型 → assemble 据它算张力(9/13 进 color)
    borrowedSource,
    effectiveFunc: func,
    borrowedFrom: c.realRoman, // 保留作者 roman 标签(render 只读;display/trace 用)
  };
}

/** Q+R progression → Q+N HarmonicPlan(整曲权威和声;下游伴奏自动跟随)。 */
export function sandboxProgressionToHarmonicPlan(progression: readonly SandboxChord[], keyPc: number, mode: ScaleMode, sectionId = 'verse-1'): HarmonicPlan {
  if (progression.length === 0) throw new RangeError('sandboxProgressionToHarmonicPlan: 空 progression');
  const resolved = progression.map((c) => toResolvedChord(c, sectionId));
  return assemble(resolved, m12(keyPc) as PitchClass, mode);
}
