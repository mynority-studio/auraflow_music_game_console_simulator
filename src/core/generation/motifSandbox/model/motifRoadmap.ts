// ============================================================
// motifSandbox · model · 实现 + 旋律 RoadMap(directive §10/D)
// ------------------------------------------------------------
// realizeToSandboxChords:选中模板 slots → SandboxChord[](保半小节 beats);每和弦带:
//   ① 调内三和弦(degree/tonePcs)—— 旋律 adapt 用,保调内;
//   ② 真实和声(realRoman/realType/realRootPc/realTonePcs/borrowed/func)—— 伴奏 + RoadMap + UI 用。
// buildMotifRoadmap:slots → ChordPart → parseRoadMap 出【真 BrickMatch】+ userBrick 锚点槽。
// ============================================================

import type { ProgressionSlot } from '../../newEngine/knowledge/progressions';
import { chordTypeIntervals, normalizeChordType } from '../../newEngine/knowledge/chords';
import { buildChordPart, type MgChordDef } from '../../newEngine/render/mgChordPart';
import { parseRoadMap, type BrickMatch } from '../../newEngine/render/mgRoadMapParser';
import { makeChord, type SandboxChord } from './chords';
import { isInScale } from './scale';
import type { ScaleMode } from './types';
import type { SelectedMotifProgression, MotifMelodicRoadmap, RoadmapBrickSlot, RoadmapBrickType } from './melodicBrickTypes';

const BAR = 4;
const m12 = (n: number): number => ((n % 12) + 12) % 12;
const deg17 = (d: number): number => ((d - 1) % 7 + 7) % 7 + 1;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function slotAtBeat(chords: readonly SandboxChord[], beat: number): SandboxChord {
  return chords.find((c) => beat >= c.startBeat - 1e-6 && beat < c.startBeat + c.durationBeats - 1e-6) ?? chords[chords.length - 1];
}

// —— Phase 3:BrickMatch → RoadmapBrickSlot 规范化 ——
const FAMILY_TYPE: Record<string, RoadmapBrickType> = {
  'Major-On': 'Tonic', 'Minor-On': 'Tonic',
  'Cadence': 'Cadence', 'Launcher': 'Launcher', 'Turnaround': 'Turnaround',
  'GenDom': 'Approach', 'GenII': 'Approach',
  'GenVI': 'Cycle', 'Dropback': 'Cycle',
  'Blues': 'Other', 'Borrowed': 'Other', 'Unknown': 'Other',
};
const chordId = (c: SandboxChord): string => `ch@${c.startBeat}`;
/** SandboxChord 功能:effectiveFunc 优先,否则从级数推(5/7=D,2/4=S,余 T)。 */
function chordFunc(c: SandboxChord): 'T' | 'S' | 'D' {
  if (c.effectiveFunc) return c.effectiveFunc;
  const d = deg17(c.degree);
  return d === 5 || d === 7 ? 'D' : d === 2 || d === 4 ? 'S' : 'T';
}
function coveredChords(chords: readonly SandboxChord[], startBeat: number, durationBeats: number): SandboxChord[] {
  return chords.filter((c) => c.startBeat >= startBeat - 1e-6 && c.startBeat < startBeat + durationBeats - 1e-6);
}
/** 真 BrickMatch[] → RoadmapBrickSlot[](type/beat范围/chordIds/entry-exit func/recurrenceKey)。 */
function bricksToSlots(bricks: readonly BrickMatch[], chords: readonly SandboxChord[], sectionId?: string): RoadmapBrickSlot[] {
  return bricks.map((b, i) => {
    const cov = coveredChords(chords, b.startBeat, b.durationBeats);
    const romans = cov.map((c) => c.realRoman ?? c.roman);
    const type = FAMILY_TYPE[b.family] ?? 'Other';
    const endsOnTonic = cov.length > 0 && deg17(cov[cov.length - 1].degree) === 1;
    return {
      id: `rb-${i}-${b.startBeat}`,
      name: b.name,
      type,
      startBeat: b.startBeat,
      durationBeats: b.durationBeats,
      sectionId,
      chordIds: cov.map(chordId),
      entryFunction: cov.length ? chordFunc(cov[0]) : undefined,
      exitFunction: cov.length ? chordFunc(cov[cov.length - 1]) : undefined,
      cadenceStrength: type === 'Cadence' ? (endsOnTonic ? 'strong' : 'weak') : 'none',
      // 结构等价键:粗类型 + 覆盖和弦的真 roman 序列(同序列 = 可接 motif 复用)。
      recurrenceKey: `${type}|${romans.join('-')}`,
    };
  });
}
/** parse 失败兜底:逐和弦一个 slot(非静默回退到固定 phrase loop;UI 报 warning)。 */
function fallbackSlotsPerChord(chords: readonly SandboxChord[], sectionId?: string): RoadmapBrickSlot[] {
  return chords.map((c, i) => ({
    id: `rb-fb-${i}-${c.startBeat}`,
    name: c.realRoman ?? c.roman,
    type: 'Other' as RoadmapBrickType,
    startBeat: c.startBeat,
    durationBeats: c.durationBeats,
    sectionId,
    chordIds: [chordId(c)],
    entryFunction: chordFunc(c),
    exitFunction: chordFunc(c),
    cadenceStrength: 'none' as const,
    recurrenceKey: `chord|${c.realRoman ?? c.roman}`,
  }));
}

/** 调内 chordType 串(由【根→各和弦音】音程推):走 A narrowQuality 用,保 7 窄品质可分类。 */
function typeFromTones(rootPc: number, tonePcs: readonly number[]): string {
  const ivs = new Set(tonePcs.map((pc) => m12(pc - rootPc)));
  const dim = ivs.has(3) && ivs.has(6), maj7 = ivs.has(11), dom7 = ivs.has(10);
  if (dim) return dom7 ? 'm7b5' : 'dim';
  if (ivs.has(3)) return dom7 ? 'm7' : maj7 ? 'mMaj7' : 'min';
  return maj7 ? 'maj7' : dom7 ? '7' : 'maj';
}

/** 选中模板 slots → SandboxChord[]:逐 slot(保半小节 beats),带【调内三和弦 + 真实和声】。
 *  ★ 约束在旋律调内(用户 2026-06-22):真实和声若带调外音(副属/借和弦/7b13/7b9/m9…)→ 退到调内三和弦
 *  + 保留【调内延伸(七/九)】,丢调外音;effectiveTonePcs/realRootPc/realRoman/realType 全部回调内,
 *  → 旋律/伴奏/bass/走A 与旋律音阶【正交】。全调内的真实和声(如 V7/IVmaj7)原样保留色彩。 */
export function realizeToSandboxChords(slots: readonly ProgressionSlot[], keyPc: number, mode: ScaleMode): SandboxChord[] {
  const out: SandboxChord[] = [];
  let beat = 0;
  const inKey = (pc: number): boolean => isInScale(60 + pc, keyPc, mode);
  for (const s of slots) {
    const beats = s.beats ?? BAR;
    const diatonic = makeChord(deg17(s.scaleDegree), keyPc, mode, beat, beats); // 旋律用(保调内)
    const realRootRaw = m12(keyPc + s.rootOffset);
    const ivs = chordTypeIntervals(normalizeChordType(s.type) ?? 'maj');
    const rawReal = [...new Set(ivs.map((iv) => m12(realRootRaw + iv)))];
    const outOfKey = !inKey(realRootRaw) || rawReal.some((pc) => !inKey(pc));
    if (!outOfKey) {
      // 全调内 → 原样保留真实和声色彩(V7 / IVmaj7 / ii9 等)
      out.push({ ...diatonic, realRoman: s.roman, realType: s.type, realRootPc: realRootRaw, realTonePcs: rawReal, borrowedSource: s.borrowedSource, effectiveFunc: s.effectiveFunc });
    } else {
      // ★ 退到调内:调内三和弦 + 调内延伸(七/九);根/roman/type 全回调内,丢 borrowed/secondary
      const hasExt = /(7|9|11|13)/.test(s.type ?? '');
      const inKeyExt = rawReal.filter((pc) => inKey(pc) && !diatonic.tonePcs.includes(pc)); // 调内的延伸(七/九)音
      const realTonePcs = hasExt ? [...new Set([...diatonic.tonePcs, ...inKeyExt])] : [...diatonic.tonePcs];
      out.push({ ...diatonic, realRoman: diatonic.roman, realType: typeFromTones(diatonic.rootPc, realTonePcs), realRootPc: diatonic.rootPc, realTonePcs, borrowedSource: undefined, effectiveFunc: s.effectiveFunc });
    }
    beat += beats;
  }
  return out;
}

/** 旋律 roadmap:真 harmonicBricks(slots→ChordPart→parseRoadMap)→ 规范化 brickSlots(供 Phase 4
 *  melodicSlotPlanner 按【RoadMap 结构】排 motif,无固定 0/16/32/48 假设)。 */
export function buildMotifRoadmap(selected: SelectedMotifProgression, keyPc: number, mode: ScaleMode, totalBars = 16): MotifMelodicRoadmap {
  const chords = realizeToSandboxChords(selected.slots, keyPc, mode);
  const harmonicRomans: string[] = [];
  for (let bar = 0; bar < totalBars; bar++) {
    const c = slotAtBeat(chords, bar * BAR);
    harmonicRomans.push(c.realRoman ?? ROMAN[deg17(c.degree) - 1]);
  }

  // 真 RoadMap:realized chords → MgChordDef[] → ChordPart → parseRoadMap(失败不静默吞 → roadmapError)。
  let harmonicBricks: MotifMelodicRoadmap['harmonicBricks'];
  let brickSlots: RoadmapBrickSlot[];
  let brickSlotsFromFallback = false;
  let roadmapError: string | undefined;
  try {
    const defs: MgChordDef[] = chords.map((c) => {
      const rootPc = c.realRootPc ?? c.rootPc;
      return { roman: c.realRoman ?? c.roman, root: PC_NAMES[rootPc], rootMidi: rootPc + 48, type: normalizeChordType(c.realType ?? 'maj') ?? 'maj', bassMidi: rootPc + 48, duration: c.durationBeats, effectiveFunc: c.effectiveFunc };
    });
    harmonicBricks = parseRoadMap({ part: buildChordPart(defs), songKeyPc: keyPc }).bricks;
    brickSlots = (harmonicBricks && harmonicBricks.length) ? bricksToSlots(harmonicBricks, chords) : fallbackSlotsPerChord(chords);
    brickSlotsFromFallback = !(harmonicBricks && harmonicBricks.length);
  } catch (err) {
    roadmapError = err instanceof Error ? err.message : String(err);
    brickSlots = fallbackSlotsPerChord(chords); // 非静默:逐和弦 span + brickSlotsFromFallback=true + roadmapError 暴露 UI
    brickSlotsFromFallback = true;
  }

  return { totalBars, harmonicRomans, harmonicBricks, brickSlots, brickSlotsFromFallback, roadmapError };
}
