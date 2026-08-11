// ============================================================
// newEngine · render · userMotifBrick
// ------------------------------------------------------------
// Additive Q+N hook: treat a user motif as a melodic brick quote inside
// the normal MG/Q+N lead. It does not generate the full lead by itself.
// ============================================================

import { beats, midi, type Timebase } from '../foundation';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import type { RoadMap } from './mgRoadMapParser';
import {
  buildMelodyRhythmShapeProfile,
  type MelodyRhythmShapeProfile,
} from './mgRhythmShapeMatcher';
import { isInProtectedFastRun } from './leadGridTiming';
import { sanitizeLeadNoteIR } from './leadSanitizer';
import { swingFrac } from './swing';

export interface UserMotifBrickNote {
  pitch: number;
  onsetBeat: number;
  durationBeat: number;
  velocity: number;
  accent?: number;
  structuralToneScore?: number;
}

export interface UserMotifBrick {
  notes: readonly UserMotifBrickNote[];
  quoteBeats?: number;
  sourceMotifId?: string;
  primaryFunction?: 'opening' | 'approach' | 'cadence' | 'resolution' | 'launcher'
    | 'answer' | 'passing' | 'neighbor' | 'arpeggio' | 'sequence' | 'ambiguous';
  /** 编曲角色潜质(redesign 一期):hook>theme → 落位偏向副歌/hook 段;反之偏段落头。 */
  rolePotential?: { hook: number; theme: number };
  /** 输入置信档(redesign 二期):fidelity=原样;refine/heal=允许经过音插入+弱音降级。 */
  confidenceTier?: 'fidelity' | 'refine' | 'heal';
}

/** 辨识度审计(redesign 三期,report-only):每次再现与动机陈述的相似度证据。 */
export interface MotifOccurrenceRecognizability {
  kind: string;
  transform: string;
  startBeat: number;
  rhythmSimilarity: number;    // 与陈述节奏形状的相似度 0..1
  pitchOrderPreserved: boolean; // 非装饰音是否为陈述音高的保序子序列(不变量校验)
  noteCountRatio: number;      // 再现音数 / 陈述音数
}
export interface MotifRecognizabilityAudit {
  occurrenceCount: number;
  minRhythmSimilarity: number; // 无 occurrence 时 = 1
  allPitchOrderPreserved: boolean;
  occurrences: MotifOccurrenceRecognizability[];
  warnings: string[];          // report-only;阈值校准后可升级为硬门
}

/** 发展弧线中的一次 motif 再现。二期:音高保真组变奏;P1(墨盒任务书)追加谱系字段 ——
 *  pitchPolicy='contour' 的发展节点允许保轮廓换音高(用户裁决 2026-08-11,倒影解禁)。 */
export interface AuthoredMotifDevelopmentOccurrence {
  kind: 'develop' | 'return';
  transform: string;
  startBeat: number;
  endBeat: number;
  notes: readonly UserMotifBrickNote[];
  fidelityReferenceNotes: readonly UserMotifBrickNote[];
  harmonicSupportRatio: number;
  note: string;
  // —— P1 谱系 provenance(v2 路径写入;v1 缺省)——
  nodeId?: string;
  parentNodeId?: string;          // 'root' | 前一节点 id(链式生长,不再全部从 root 克隆)
  formalFunction?: string;        // presentation/continuation/development/return
  pitchPolicy?: 'exact' | 'contour';
  introducedFeatures?: readonly string[];
  similarityToRoot?: number;      // 双向距离带的实测值
}

/** Arrangement section context for placement: role/functionTag drive hook/theme affinity. */
export interface AuthoredMotifSectionInfo {
  id: string;
  role?: string;
  functionTag?: string;
  startBeat: number;
  endBeat: number;
}

/** exact=±20% 内正常落位;relaxed=放宽到 ±35%;forced=保底强制安置(绝不静默丢弃)。 */
export type AuthoredMotifPlacementQuality = 'exact' | 'relaxed' | 'forced';

/** Arrangement sections → 落位段落上下文。生产(renderCoordinator)与镜像测试共用,保证推导一致。 */
export function authoredMotifSectionInfos(
  sections: readonly { id: string; role?: string; functionTag?: string; bars: number }[],
  beatsPerBar: number,
): AuthoredMotifSectionInfo[] {
  let cursor = 0;
  return sections.map((section) => {
    const startBeat = cursor;
    cursor += section.bars * beatsPerBar;
    return { id: section.id, role: section.role, functionTag: section.functionTag, startBeat, endBeat: cursor };
  });
}

/** Production ownership contract for one exact user-authored melodic brick. */
export interface AuthoredUserMotifBrickPlan {
  sourceMotifId?: string;
  roadMapBrickIndices: readonly number[];
  roadMapBrickNames: readonly string[];
  startBeat: number;
  endBeat: number;
  sourceSpanBeats: number;
  targetSpanBeats: number;
  scaleFactor: number;
  harmonicSupportRatio: number;
  placementScore: number;
  /** Hard fidelity budget across uniform fitting plus GrooveContract alignment. */
  timingDeviationRatioLimit: number;
  /** Original hand-played timing translated to the selected RoadMap start, without stretching. */
  fidelityReferenceNotes: readonly UserMotifBrickNote[];
  /** Rhythm identity used to select continuation grammar, not only the harmonic RoadMap family. */
  rhythmShapeProfile: MelodyRhythmShapeProfile;
  /** Absolute-beat notes after one uniform scale. Groove micro-alignment happens at materialization. */
  notes: readonly UserMotifBrickNote[];
  placementQuality?: AuthoredMotifPlacementQuality;
  placementNote?: string;
  /** 发展弧线(redesign 二期):陈述之外的再现/片段化/回归段。缺省 = 只有一次陈述(一期行为)。 */
  occurrences?: readonly AuthoredMotifDevelopmentOccurrence[];
  /** 辨识度审计(redesign 三期,report-only)。 */
  recognizability?: MotifRecognizabilityAudit;
}

export interface AuthoredLeadSpan {
  startBeat: number;
  endBeat: number;
}

type PocketMs = readonly number[];
export const USER_MOTIF_MAX_TIMING_DEVIATION_RATIO = 0.2;
export const USER_MOTIF_RELAXED_DEVIATION_RATIO = 0.35;
export interface UserMotifGrooveContract {
  grid?: string;
  melodySwingRatio?: number;
  melodyStrongPocketMs?: PocketMs;
  melodyWeakPocketMs?: PocketMs;
}

function beatN(b: unknown): number {
  return b as number;
}

const mod12 = (value: number): number => ((value % 12) + 12) % 12;

function harmonicSpanAtBeat(plan: HarmonicPlan, beat: number) {
  return plan.chordTimeline.find((span) => beat >= (span.startBeat as number) - 1e-6
    && beat < (span.startBeat as number) + (span.durationBeats as number) - 1e-6);
}

function harmonicSpansOverlapping(plan: HarmonicPlan, startBeat: number, endBeat: number) {
  return plan.chordTimeline.filter((span) => {
    const start = span.startBeat as number;
    const end = start + (span.durationBeats as number);
    return startBeat < end - 1e-6 && endBeat > start + 1e-6;
  });
}

function noteSupportedByHarmony(note: UserMotifBrickNote, plan: HarmonicPlan): boolean {
  const pitchClass = mod12(note.pitch);
  const structural = isStructuralMotifNote(note);
  if (!structural) {
    const span = harmonicSpanAtBeat(plan, note.onsetBeat);
    if (!span) return false;
    const admitted = plan.chordScaleMap[span.id] ?? [
      ...(plan.stableToneMap[span.id] ?? []),
      ...(plan.colorToneMap[span.id] ?? []),
    ];
    return admitted.some((pc) => mod12(pc as number) === pitchClass);
  }

  const overlaps = harmonicSpansOverlapping(plan, note.onsetBeat, note.onsetBeat + note.durationBeat);
  if (overlaps.length === 0) return false;
  return overlaps.every((span) => {
    const admitted = [...(plan.stableToneMap[span.id] ?? []), ...(plan.colorToneMap[span.id] ?? [])];
    return admitted.some((pc) => mod12(pc as number) === pitchClass);
  });
}

function harmonicSupportRatio(notes: readonly UserMotifBrickNote[], plan: HarmonicPlan): number {
  let supported = 0;
  let total = 0;
  for (const note of notes) {
    const weight = isStructuralMotifNote(note) ? 2 + Math.min(2, note.durationBeat) : 0.5;
    total += weight;
    if (noteSupportedByHarmony(note, plan)) supported += weight;
  }
  return total > 0 ? supported / total : 0;
}

function functionAffinity(
  primaryFunction: UserMotifBrick['primaryFunction'],
  family: string,
): number {
  if (!primaryFunction || primaryFunction === 'ambiguous') return 0.5;
  if ((primaryFunction === 'cadence' || primaryFunction === 'resolution') && family === 'Cadence') return 1;
  if ((primaryFunction === 'approach' || primaryFunction === 'launcher')
      && (family === 'Launcher' || family === 'GenDom' || family === 'Dropback')) return 1;
  if ((primaryFunction === 'opening' || primaryFunction === 'arpeggio')
      && (family === 'Major-On' || family === 'Minor-On' || family === 'Turnaround')) return 1;
  if ((primaryFunction === 'answer' || primaryFunction === 'sequence')
      && (family === 'Turnaround' || family === 'Dropback')) return 0.9;
  if ((primaryFunction === 'passing' || primaryFunction === 'neighbor') && family !== 'Cadence') return 0.75;
  return 0;
}

/** 段落亲和(redesign 一期):hook 型 → 副歌/hook 段;theme 型 → 段落头陈述。无段落数据 → 0.5 中性。 */
function sectionAffinityScore(
  sections: readonly AuthoredMotifSectionInfo[] | undefined,
  rolePotential: UserMotifBrick['rolePotential'],
  startBeat: number,
): number {
  if (!sections || sections.length === 0) return 0.5;
  const section = sections.find((s) => startBeat >= s.startBeat - 1e-6 && startBeat < s.endBeat - 1e-6);
  if (!section) return 0.5;
  const role = section.role ?? '';
  const isHookSection = role === 'chorus' || section.functionTag === 'hook';
  const atSectionHead = startBeat - section.startBeat < 4 - 1e-6;
  if (!rolePotential) return atSectionHead ? 0.75 : 0.5;
  if (rolePotential.hook > rolePotential.theme) {
    if (isHookSection) return 1;
    return role === 'verse' ? 0.45 : 0.3;
  }
  if (atSectionHead) return role === 'intro' ? 0.8 : 1; // theme 完整陈述通常留给 verse/chorus 头
  return isHookSection ? 0.55 : 0.4;
}

interface PlacementCandidate {
  brickIndices: number[];
  startBeat: number;
  endBeat: number;
  scaleFactor: number;
  notes: UserMotifBrickNote[];
  supportRatio: number;
  boundaryAligned: boolean;
  score: number;
}

function placementCandidates(
  brick: UserMotifBrick,
  roadMap: RoadMap,
  harmonicPlan: HarmonicPlan,
  totalBeats: number,
  sourceStartBeat: number,
  sourceSpanBeats: number,
  sections: readonly AuthoredMotifSectionInfo[] | undefined,
  deviationLimit: number,
): PlacementCandidate[] {
  const candidates: PlacementCandidate[] = [];
  const ordered = roadMap.bricks
    .map((roadMapBrick, originalIndex) => ({ roadMapBrick, originalIndex }))
    .filter(({ roadMapBrick }) => roadMapBrick.durationBeats > 0 && roadMapBrick.startBeat < totalBeats - 1e-6)
    .sort((a, b) => a.roadMapBrick.startBeat - b.roadMapBrick.startBeat);
  const sourceNotes = brick.notes
    .filter((note) => note.durationBeat > 0)
    .sort((a, b) => a.onsetBeat - b.onsetBeat);

  const addCandidate = (
    brickIndices: number[],
    startBeat: number,
    endBeat: number,
    boundaryAligned: boolean,
  ): void => {
    const targetSpanBeats = endBeat - startBeat;
    const scaleFactor = targetSpanBeats / sourceSpanBeats;
    if (scaleFactor < 1 - deviationLimit - 1e-6
      || scaleFactor > 1 + deviationLimit + 1e-6) return;
    const notes = sourceNotes.map((note) => ({
      ...note,
      onsetBeat: startBeat + (note.onsetBeat - sourceStartBeat) * scaleFactor,
      durationBeat: note.durationBeat * scaleFactor,
    })).filter((note) => note.onsetBeat < endBeat - 1e-6)
      .map((note) => ({ ...note, durationBeat: Math.min(note.durationBeat, endBeat - note.onsetBeat) }));
    if (notes.length !== sourceNotes.length) return;

    const supportRatio = harmonicSupportRatio(notes, harmonicPlan);
    const timingDeviation = Math.abs(1 - scaleFactor);
    const earlyPreference = Math.max(0, 1 - startBeat / Math.max(1, totalBeats * 0.5));
    const first = roadMap.bricks[brickIndices[0]];
    const affinity = functionAffinity(brick.primaryFunction, first?.family ?? 'Unknown');
    const sectionFit = sectionAffinityScore(sections, brick.rolePotential, startBeat);
    // hook 型不追求"越早越好",追求 hook 段位(仅在有段落数据时改变权重,保持旧行为可回归)
    const hookish = (brick.rolePotential?.hook ?? 0) > (brick.rolePotential?.theme ?? 0);
    const earlyWeight = sections?.length && hookish ? 2 : 8;
    const score = supportRatio * 100
      + affinity * 12
      + sectionFit * 12
      + earlyPreference * earlyWeight
      + (boundaryAligned ? 3 : 0)
      - timingDeviation * 30;
    candidates.push({
      brickIndices,
      startBeat,
      endBeat,
      scaleFactor,
      notes,
      supportRatio,
      boundaryAligned,
      score,
    });
  };

  for (let startIndex = 0; startIndex < ordered.length; startIndex++) {
    const first = ordered[startIndex].roadMapBrick;
    let previousEnd = first.startBeat;
    let exactSpanAdded = false;
    for (let endIndex = startIndex; endIndex < Math.min(ordered.length, startIndex + 12); endIndex++) {
      const current = ordered[endIndex].roadMapBrick;
      if (endIndex > startIndex && Math.abs(current.startBeat - previousEnd) > 1e-4) break;
      previousEnd = current.startBeat + current.durationBeats;
      const startBeat = first.startBeat;
      const endBeat = Math.min(totalBeats, previousEnd);
      const targetSpanBeats = endBeat - startBeat;
      if (targetSpanBeats <= 0.01) continue;
      const brickIndices = ordered.slice(startIndex, endIndex + 1).map(({ originalIndex }) => originalIndex);
      addCandidate(brickIndices, startBeat, endBeat, true);

      // A user-authored melodic brick may end inside a harmonic RoadMap brick.
      // Preserve the player's tempo instead of stretching to that harmonic boundary.
      if (!exactSpanAdded && targetSpanBeats >= sourceSpanBeats - 1e-6) {
        addCandidate(brickIndices, startBeat, startBeat + sourceSpanBeats, false);
        exactSpanAdded = true;
      }
      if (targetSpanBeats > sourceSpanBeats * (1 + deviationLimit) + 1e-6
        && exactSpanAdded) break;
    }
  }
  return candidates;
}

/**
 * Fit the complete user motif into one production RoadMap-owned melodic slot.
 * Every onset and duration receives the same scale factor; no pitch is changed.
 */
export function planAuthoredUserMotifBrick(args: {
  brick: UserMotifBrick;
  roadMap: RoadMap;
  harmonicPlan: HarmonicPlan;
  totalBeats: number;
  sections?: readonly AuthoredMotifSectionInfo[];
}): AuthoredUserMotifBrickPlan | undefined {
  const { brick, roadMap, harmonicPlan, totalBeats, sections } = args;
  if (brick.notes.length === 0 || roadMap.bricks.length === 0 || totalBeats <= 0) return undefined;
  const sourceStartBeat = Math.min(0, ...brick.notes.map((note) => note.onsetBeat));
  const sourceEndBeat = Math.max(
    brick.quoteBeats ?? 0,
    ...brick.notes.map((note) => note.onsetBeat + note.durationBeat),
  );
  const sourceSpanBeats = Math.max(0.25, sourceEndBeat - sourceStartBeat);
  // 降级安置阶梯(redesign 一期,修静默消失):exact ±20% → relaxed ±35% → forced 不限。
  // 用户 motif 绝不因找不到完美时值窗而整段丢弃;降级档位写进 plan 供审计/UI。
  const ladder: Array<{ quality: AuthoredMotifPlacementQuality; limit: number; note?: string }> = [
    { quality: 'exact', limit: USER_MOTIF_MAX_TIMING_DEVIATION_RATIO },
    { quality: 'relaxed', limit: USER_MOTIF_RELAXED_DEVIATION_RATIO, note: '±20% 内无候选 → 放宽至 ±35%' },
    { quality: 'forced', limit: Number.POSITIVE_INFINITY, note: '放宽仍无候选 → 强制安置' },
  ];
  let selected: PlacementCandidate | undefined;
  let quality: AuthoredMotifPlacementQuality = 'exact';
  let placementNote: string | undefined;
  for (const step of ladder) {
    const candidates = placementCandidates(brick, roadMap, harmonicPlan, totalBeats, sourceStartBeat, sourceSpanBeats, sections, step.limit);
    const best = candidates.sort((a, b) => b.score - a.score
      || a.startBeat - b.startBeat
      || Math.abs(1 - a.scaleFactor) - Math.abs(1 - b.scaleFactor))[0];
    if (best) { selected = best; quality = step.quality; placementNote = step.note; break; }
  }
  if (!selected) return undefined; // 仅剩退化输入(空 roadmap/零音符,上方已 guard)
  const sourceNotes = brick.notes
    .filter((note) => note.durationBeat > 0)
    .sort((a, b) => a.onsetBeat - b.onsetBeat);
  const fidelityReferenceNotes = sourceNotes.map((note) => ({
    ...note,
    onsetBeat: selected.startBeat + note.onsetBeat - sourceStartBeat,
  }));
  return {
    sourceMotifId: brick.sourceMotifId,
    roadMapBrickIndices: selected.brickIndices,
    roadMapBrickNames: selected.brickIndices.map((index) => roadMap.bricks[index]?.name ?? `brick-${index}`),
    startBeat: selected.startBeat,
    endBeat: selected.endBeat,
    sourceSpanBeats,
    targetSpanBeats: selected.endBeat - selected.startBeat,
    scaleFactor: selected.scaleFactor,
    harmonicSupportRatio: selected.supportRatio,
    placementScore: selected.score,
    // 降级档位下 fidelity 预算随实际缩放放宽,否则 materialize 会跟选定 scale 打架
    timingDeviationRatioLimit: quality === 'exact'
      ? USER_MOTIF_MAX_TIMING_DEVIATION_RATIO
      : Math.max(USER_MOTIF_RELAXED_DEVIATION_RATIO, Math.abs(1 - selected.scaleFactor)),
    fidelityReferenceNotes,
    rhythmShapeProfile: buildMelodyRhythmShapeProfile(sourceNotes, sourceStartBeat, sourceSpanBeats),
    notes: selected.notes,
    placementQuality: quality,
    ...(placementNote ? { placementNote: `${placementNote}(scale ${selected.scaleFactor.toFixed(2)})` } : {}),
  };
}

function swingBeat(beat: number, swingRatio: number): number {
  if (swingRatio <= 0.5 + 1e-6) return beat;
  const whole = Math.floor(beat);
  return whole + swingFrac(beat - whole, swingRatio);
}

function swingMotifNotes(notes: readonly UserMotifBrickNote[], swingRatio: number, beatsPerBar: number): UserMotifBrickNote[] {
  if (swingRatio <= 0.5 + 1e-6) return [...notes];
  const sorted = [...notes].sort((a, b) => a.onsetBeat - b.onsetBeat);
  const events = sorted.map((n) => ({ time: n.onsetBeat, duration: n.durationBeat }));
  return sorted.map((n, i) => {
    if (isInProtectedFastRun(events, i, beatsPerBar)) return n;
    const on = swingBeat(n.onsetBeat, swingRatio);
    const off = swingBeat(n.onsetBeat + n.durationBeat, swingRatio);
    return { ...n, onsetBeat: on, durationBeat: Math.max(0.03, off - on) };
  });
}

const pLo = (p: PocketMs | undefined): number => p?.[0] ?? 0;
const pHi = (p: PocketMs | undefined): number => p?.[1] ?? p?.[0] ?? 0;
const hasPocket = (p: PocketMs | undefined): boolean => pLo(p) !== 0 || pHi(p) !== 0;

function hash01(n: number): number {
  let h = (Math.imul(n | 0, 2654435761) >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function pocketBeatOffset(p: PocketMs | undefined, key: number, tempoBpm: number, ppq: number): number {
  if (!hasPocket(p)) return 0;
  const ms = pLo(p) + (pHi(p) - pLo(p)) * hash01(key);
  return Math.round((ms * tempoBpm) / 60000 * ppq) / ppq;
}

function beatPhase(beat: number, beatsPerBar: number): number {
  return ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
}

function isStructuralMotifNote(n: UserMotifBrickNote): boolean {
  return (n.structuralToneScore ?? 0) >= 0.58
    || (n.accent ?? 0) >= 0.72
    || n.durationBeat >= 0.75
    || (n.velocity >= 104 && Math.abs(n.onsetBeat - Math.round(n.onsetBeat)) <= 0.08);
}

function nearestGridBeat(beat: number, gridStep: number): number {
  return Math.round(beat / gridStep) * gridStep;
}

function roundBeatToPpq(beat: number, ppq: number): number {
  return Math.round(beat * ppq) / ppq;
}

function msToBeat(ms: number, tempoBpm: number): number {
  return (ms * tempoBpm) / 60000;
}

/** Align only structural user-motif tones to the song GrooveContract.
 * Ornament notes keep their hand-played relationship by following the nearest
 * structural anchor's small offset instead of being snapped one by one. */
function alignStructuralMotifNotesToGroove(
  source: readonly UserMotifBrickNote[],
  swung: readonly UserMotifBrickNote[],
  contract: UserMotifGrooveContract | undefined,
  tempoBpm: number | undefined,
  ppq: number,
  beatsPerBar: number,
  swingRatio: number,
): UserMotifBrickNote[] {
  if (!contract || tempoBpm === undefined) return [...swung];
  const hasMelodyPocket = hasPocket(contract.melodyStrongPocketMs) || hasPocket(contract.melodyWeakPocketMs);
  const needsGridSnap = (contract.grid === 'straight' || contract.grid === 'swing' || contract.grid === 'shuffle' || contract.grid === 'dilla' || contract.grid === 'rubato') || Math.abs(swingRatio - 0.5) > 1e-6;
  if (!hasMelodyPocket && !needsGridSnap) return [...swung];

  const gridStep = contract.grid === 'shuffle' ? 1 / 3 : 0.5;
  const snapWindow = contract.grid === 'rubato' ? 0.24 : 0.18;
  const deltas: Array<{ index: number; sourceOnset: number; delta: number }> = [];
  const localSnapIndexes = new Set<number>();
  const out = swung.map((n, index) => {
    const original = source[index] ?? n;
    if (!isStructuralMotifNote(original)) {
      const localStep = contract.grid === 'shuffle' ? 1 / 3 : 0.25;
      const localGrid = nearestGridBeat(original.onsetBeat, localStep);
      const localWindow = contract.grid === 'rubato' ? 0.08 : 0.04;
      if (Math.abs(original.onsetBeat - localGrid) > localWindow) return { ...n };
      const swungGrid = swingBeat(localGrid, swingRatio);
      localSnapIndexes.add(index);
      return { ...n, onsetBeat: Math.max(0, swungGrid) };
    }
    const grid = nearestGridBeat(original.onsetBeat, gridStep);
    if (Math.abs(original.onsetBeat - grid) > snapWindow) return { ...n };
    const swungGrid = swingBeat(grid, swingRatio);
    const phase = beatPhase(grid, beatsPerBar);
    const onBeat = Math.abs(phase - Math.round(phase)) < 0.12;
    const p = onBeat ? contract.melodyStrongPocketMs : contract.melodyWeakPocketMs;
    const key = Math.round(swungGrid * ppq) + Math.round(original.pitch);
    const target = Math.max(0, swungGrid + pocketBeatOffset(p, key, tempoBpm, ppq));
    const delta = target - n.onsetBeat;
    deltas.push({ index, sourceOnset: original.onsetBeat, delta });
    return { ...n, onsetBeat: target };
  });

  if (deltas.length === 0) return out;
  return out.map((n, index) => {
    const original = source[index] ?? n;
    if (isStructuralMotifNote(original)) return n;
    if (localSnapIndexes.has(index)) return n;
    let best = deltas[0], bestDist = Math.abs(original.onsetBeat - deltas[0].sourceOnset);
    for (const d of deltas.slice(1)) {
      const dist = Math.abs(original.onsetBeat - d.sourceOnset);
      if (dist < bestDist) { best = d; bestDist = dist; }
    }
    if (bestDist > 1.0 || Math.abs(best.delta) > 0.12) return n;
    return { ...n, onsetBeat: Math.max(0, n.onsetBeat + best.delta) };
  });
}

function durationCandidatesForGrid(grid: string | undefined): readonly number[] {
  return grid === 'shuffle'
    ? [1 / 6, 1 / 3, 0.5, 2 / 3, 1, 4 / 3, 1.5, 2, 3, 4]
    : [0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5, 2, 3, 4];
}

function nearestDurationBeat(durationBeat: number, grid: string | undefined): number {
  const candidates = durationCandidatesForGrid(grid);
  let best = candidates[0], bestDist = Math.abs(durationBeat - candidates[0]);
  for (const c of candidates.slice(1)) {
    const dist = Math.abs(durationBeat - c);
    if (dist < bestDist) { best = c; bestDist = dist; }
  }
  return best;
}

function snapDurationBeat(original: UserMotifBrickNote, contract: UserMotifGrooveContract, tempoBpm: number): number {
  const raw = Math.max(0.03, original.durationBeat);
  const snapped = nearestDurationBeat(raw, contract.grid);
  const structuralOrLong = isStructuralMotifNote(original) || raw >= 0.75;
  const window = structuralOrLong
    ? Math.max(0.08, Math.min(0.28, msToBeat(120, tempoBpm)))
    : Math.max(0.035, Math.min(0.16, msToBeat(70, tempoBpm)));
  return Math.abs(raw - snapped) <= window ? snapped : raw;
}

function durationOnsetBasis(original: UserMotifBrickNote, contract: UserMotifGrooveContract): number {
  const step = contract.grid === 'shuffle' || contract.grid === 'swing' ? 0.5 : 0.25;
  const grid = nearestGridBeat(original.onsetBeat, step);
  const window = contract.grid === 'rubato' ? 0.24 : 0.18;
  return Math.abs(original.onsetBeat - grid) <= window ? grid : original.onsetBeat;
}

function releaseGapBeat(tempoBpm: number, ppq: number): number {
  return Math.max(1 / ppq, Math.min(0.08, msToBeat(24, tempoBpm)));
}

/** After onset pocketing, repair note lengths against the same groove clock.
 * This preserves a player's long/short intent while turning near-quarter,
 * eighth, triplet, or sixteenth gestures into stable musical durations. */
function alignMotifDurationsToGroove(
  source: readonly UserMotifBrickNote[],
  aligned: readonly UserMotifBrickNote[],
  contract: UserMotifGrooveContract | undefined,
  tempoBpm: number | undefined,
  ppq: number,
  swingRatio: number,
  quoteEndBeat: number,
): UserMotifBrickNote[] {
  if (!contract || tempoBpm === undefined) return [...aligned];
  const release = releaseGapBeat(tempoBpm, ppq);
  const minDur = Math.max(1 / ppq, 0.03);
  return aligned.map((n, index) => {
    const original = source[index] ?? n;
    const basis = durationOnsetBasis(original, contract);
    const repairedDur = snapDurationBeat(original, contract, tempoBpm);
    let endBeat = Math.min(quoteEndBeat, swingBeat(basis + repairedDur, swingRatio));

    const nextOriginal = source[index + 1];
    const nextAligned = aligned[index + 1];
    if (nextOriginal && nextAligned && original.onsetBeat + original.durationBeat <= nextOriginal.onsetBeat + 0.05) {
      if (endBeat > nextAligned.onsetBeat + 1e-6) endBeat = Math.min(endBeat, nextAligned.onsetBeat - release);
    }

    if (endBeat <= n.onsetBeat + minDur) {
      endBeat = Math.min(quoteEndBeat, n.onsetBeat + Math.max(minDur, repairedDur));
      if (nextAligned && endBeat > nextAligned.onsetBeat + 1e-6) endBeat = Math.min(endBeat, nextAligned.onsetBeat - release);
    }

    const durationBeat = Math.max(minDur, roundBeatToPpq(endBeat - n.onsetBeat, ppq));
    return { ...n, durationBeat };
  });
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Keep every local inter-onset interval and duration inside the user's fidelity budget. */
function enforceMotifTimingFidelity(
  reference: readonly UserMotifBrickNote[],
  candidate: readonly UserMotifBrickNote[],
  ratioLimit: number,
  startBeat: number,
  endBeat: number,
  ppq: number,
): UserMotifBrickNote[] {
  if (reference.length !== candidate.length || reference.length === 0) return [...candidate];
  const minDur = Math.max(1 / ppq, 0.03);
  const out: UserMotifBrickNote[] = [];
  const firstReference = reference[0];

  for (let index = 0; index < candidate.length; index++) {
    const ref = reference[index];
    const current = candidate[index];
    let onsetBeat: number;
    if (index === 0) {
      const nextIoi = reference[1]
        ? Math.max(0, reference[1].onsetBeat - ref.onsetBeat)
        : 0;
      const localUnit = Math.max(0.125, ref.durationBeat, nextIoi);
      const maxShift = Math.min(0.25, localUnit * ratioLimit);
      onsetBeat = clamp(current.onsetBeat, ref.onsetBeat - maxShift, ref.onsetBeat + maxShift);
    } else {
      const previous = out[index - 1];
      const previousReference = reference[index - 1];
      const referenceIoi = Math.max(1 / ppq, ref.onsetBeat - previousReference.onsetBeat);
      const localLo = previous.onsetBeat + referenceIoi * (1 - ratioLimit);
      const localHi = previous.onsetBeat + referenceIoi * (1 + ratioLimit);
      const elapsed = Math.max(0, ref.onsetBeat - firstReference.onsetBeat);
      const phraseLo = out[0].onsetBeat + elapsed * (1 - ratioLimit);
      const phraseHi = out[0].onsetBeat + elapsed * (1 + ratioLimit);
      onsetBeat = clamp(current.onsetBeat, localLo, localHi);
      onsetBeat = clamp(onsetBeat, phraseLo, phraseHi);
    }
    onsetBeat = roundBeatToPpq(clamp(onsetBeat, startBeat, endBeat - minDur), ppq);

    const durationLo = Math.max(minDur, ref.durationBeat * (1 - ratioLimit));
    const durationHi = Math.max(durationLo, ref.durationBeat * (1 + ratioLimit));
    let durationBeat = roundBeatToPpq(clamp(current.durationBeat, durationLo, durationHi), ppq);
    durationBeat = Math.max(minDur, Math.min(durationBeat, endBeat - onsetBeat));
    out.push({ ...current, onsetBeat, durationBeat });
  }
  return out;
}

/** 四期(用户裁决 §0.5):时值向后延展连贯 —— 异音高且间隙 ≤1 拍 → 连到下一音(留 release);
 *  末音连到 span 末;同音重复 = 有意断奏不连(镜像 healer);只延长不缩短,onset 不动。 */
function sustainFillMotifNotes(
  notes: readonly UserMotifBrickNote[],
  endBeat: number,
  tempoBpm: number | undefined,
  ppq: number,
  harmonicPlan: HarmonicPlan | undefined,
): UserMotifBrickNote[] {
  const release = releaseGapBeat(tempoBpm ?? 100, ppq);
  return notes.map((n, i) => {
    const next = notes[i + 1];
    const currentEnd = n.onsetBeat + n.durationBeat;
    let target = currentEnd;
    if (!next) {
      target = Math.max(currentEnd, endBeat - release);
    } else if (next.pitch !== n.pitch) {
      const gapToNext = next.onsetBeat - currentEnd;
      if (gapToNext > 1e-6 && gapToNext <= 1 + 1e-6) target = next.onsetBeat - release;
    }
    if (target <= currentEnd + 1e-6) return n;
    let extended: UserMotifBrickNote = { ...n, durationBeat: Math.max(n.durationBeat, target - n.onsetBeat) };
    // 和声感知:延展把音推过 1 拍暴露线时,接不住的音把延展压回线下(不短于原时值)
    if (harmonicPlan && extended.durationBeat >= 1 - 1e-6) {
      const capped = capUnsupportedLongExposure([extended], harmonicPlan)[0];
      extended = { ...extended, durationBeat: Math.max(n.durationBeat, capped.durationBeat) };
    }
    return extended;
  });
}

function toExactNoteIR(n: UserMotifBrickNote, timebase: Timebase): NoteIR {
  return {
    pitch: midi(Math.max(0, Math.min(127, Math.round(n.pitch)))),
    startTick: timebase.beatToTick(beats(n.onsetBeat)),
    durationTicks: timebase.beatToTick(beats(Math.max(0.03, n.durationBeat))),
    velocity: Math.max(1, Math.min(127, Math.round(n.velocity))),
  };
}

function overlapsSpan(n: NoteIR, loBeat: number, hiBeat: number, timebase: Timebase): boolean {
  const startBeat = beatN(n.startTick) / timebase.ppq;
  const endBeat = startBeat + beatN(n.durationTicks) / timebase.ppq;
  return startBeat < hiBeat - 1e-6 && endBeat > loBeat + 1e-6;
}

export function authoredLeadSpans(plan: AuthoredUserMotifBrickPlan | undefined): AuthoredLeadSpan[] {
  if (!plan) return [];
  return [
    { startBeat: plan.startBeat, endBeat: plan.endBeat },
    ...(plan.occurrences ?? []).map((o) => ({ startBeat: o.startBeat, endBeat: o.endBeat })),
  ];
}

/** 发展模块用:结构音加权和声支持度(与落位打分同一把尺)。 */
export function motifHarmonicSupportRatio(notes: readonly UserMotifBrickNote[], plan: HarmonicPlan): number {
  return harmonicSupportRatio(notes, plan);
}

/** 单音判定:长时值暴露是否被覆盖和弦的 stable/color 音接住(镜像 avoid-long-exposure 审计)。 */
function noteLongExposureSupported(note: UserMotifBrickNote, plan: HarmonicPlan): boolean {
  if (note.durationBeat < 1 - 1e-6) return true;
  const overlaps = harmonicSpansOverlapping(plan, note.onsetBeat, note.onsetBeat + note.durationBeat);
  if (overlaps.length === 0) return false;
  const pitchClass = mod12(note.pitch);
  return overlaps.every((span) => [
    ...(plan.stableToneMap[span.id] ?? []),
    ...(plan.colorToneMap[span.id] ?? []),
  ].some((p) => mod12(p as number) === pitchClass));
}

/** 发展模块用:全部长音的暴露是否被接住。 */
export function motifLongExposureSupported(notes: readonly UserMotifBrickNote[], plan: HarmonicPlan): boolean {
  return notes.every((note) => noteLongExposureSupported(note, plan));
}

/** 发展模块用:全部结构音是否被 stable/color 接住(镜像 structural-tone-outside-intersection 审计)。 */
export function motifStructuralNotesSupported(notes: readonly UserMotifBrickNote[], plan: HarmonicPlan): boolean {
  return notes.every((note) => !isStructuralMotifNote(note) || noteSupportedByHarmony(note, plan));
}

/** 接不住的长音把时值压到审计线下(0.9 拍),音高/落拍不动(用户裁决:时值不神圣)。
 *  这是 authored 音"绝不静默丢弃 + 绝不改音高"前提下通过 avoid-long-exposure 的唯一自由度。 */
export function capUnsupportedLongExposure(notes: readonly UserMotifBrickNote[], plan: HarmonicPlan): UserMotifBrickNote[] {
  return notes.map((note) => noteLongExposureSupported(note, plan)
    ? note
    : { ...note, durationBeat: Math.min(note.durationBeat, 0.9) });
}

/** 发展模块用:某拍上被 chord-scale 准入的 pitch-class 集(经过音插入的合法池)。 */
export function admittedPcsAtBeat(plan: HarmonicPlan, beat: number): number[] {
  const span = harmonicSpanAtBeat(plan, beat);
  if (!span) return [];
  const admitted = plan.chordScaleMap[span.id] ?? [
    ...(plan.stableToneMap[span.id] ?? []),
    ...(plan.colorToneMap[span.id] ?? []),
  ];
  return admitted.map((p) => mod12(p as number));
}

/** Materialize a planned brick without instrument-range or harmony pitch rewriting. */
export function materializeAuthoredUserMotifBrick(
  plan: AuthoredUserMotifBrickPlan | undefined,
  timebase: Timebase,
  options: {
    swingRatio?: number;
    beatsPerBar?: number;
    grooveContract?: UserMotifGrooveContract;
    tempoBpm?: number;
    /** 四期:时值向后延展连贯(sustain/踏板感);同音断奏不连,只延不缩。 */
    sustainFill?: boolean;
    /** sustain 的和声感知:延展越过 1 拍暴露线时按 stable/color 判定并压回。 */
    harmonicPlan?: HarmonicPlan;
  } = {},
): NoteIR[] {
  if (!plan || plan.notes.length === 0) return [];
  const source = [...plan.notes].sort((a, b) => a.onsetBeat - b.onsetBeat);
  const swingRatio = options.swingRatio ?? 0.5;
  const beatsPerBar = options.beatsPerBar ?? timebase.meter.numerator;
  const swung = swingMotifNotes(source, swingRatio, beatsPerBar);
  const grooveAligned = alignStructuralMotifNotesToGroove(
    source,
    swung,
    options.grooveContract,
    options.tempoBpm,
    timebase.ppq,
    beatsPerBar,
    swingRatio,
  );
  const durationAligned = alignMotifDurationsToGroove(
    source,
    grooveAligned,
    options.grooveContract,
    options.tempoBpm,
    timebase.ppq,
    swingRatio,
    plan.endBeat,
  );
  const fidelityAligned = enforceMotifTimingFidelity(
    [...plan.fidelityReferenceNotes].sort((a, b) => a.onsetBeat - b.onsetBeat),
    durationAligned,
    plan.timingDeviationRatioLimit,
    plan.startBeat,
    plan.endBeat,
    timebase.ppq,
  );
  const clamped = fidelityAligned.map((note) => {
    const onsetBeat = Math.max(plan.startBeat, Math.min(plan.endBeat - 0.03, note.onsetBeat));
    return {
      ...note,
      onsetBeat,
      durationBeat: Math.max(0.03, Math.min(note.durationBeat, plan.endBeat - onsetBeat)),
    };
  });
  const sustained = options.sustainFill
    ? sustainFillMotifNotes(clamped, plan.endBeat, options.tempoBpm, timebase.ppq, options.harmonicPlan)
    : clamped;
  return sustained
    .map((note) => toExactNoteIR(note, timebase))
    .sort((a, b) => beatN(a.startTick) - beatN(b.startTick) || beatN(a.pitch) - beatN(b.pitch));
}

/**
 * One and only product assembly point. The generated scheduler already owns no
 * events in this span; filtering here is a guard against later replay/humanize
 * drift, not a post-generation quote replacement strategy.
 */
export function assembleAuthoredUserMotifLead(
  lead: TrackIR,
  plan: AuthoredUserMotifBrickPlan | undefined,
  authoredNotes: readonly NoteIR[],
  timebase: Timebase,
): TrackIR {
  if (!plan || authoredNotes.length === 0) return lead;
  const spans = authoredLeadSpans(plan);
  const ppq = timebase.ppq;
  const beatOf = (n: NoteIR): number => beatN(n.startTick) / ppq;
  const generated = lead.notes
    .filter((note) => !spans.some((s) => overlapsSpan(note, s.startBeat, s.endBeat, timebase)))
    .map((note) => ({ ...note }));
  let authored = authoredNotes.map((note) => ({ ...note }));

  // —— 演奏外衣三件套(融合度修复):motif 音符内容不动,穿上这首歌的演奏特征 ——
  for (const span of spans) {
    const inSpan = (n: NoteIR): boolean => beatOf(n) >= span.startBeat - 1e-4 && beatOf(n) < span.endBeat - 1e-4;
    const spanNotes = authored.filter(inSpan);
    if (spanNotes.length === 0) continue;
    const context = generated.filter((n) => beatOf(n) >= span.startBeat - 8 && beatOf(n) < span.endBeat + 8);
    // 1) 力度融入:匹配邻域生成 lead 的力度均值(保留 motif 内部相对重音);废掉响度地板的孤立感
    if (context.length >= 3) {
      const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
      const ctxMean = mean(context.map((n) => n.velocity as number));
      const spanMean = mean(spanNotes.map((n) => n.velocity as number));
      if (spanMean > 0) {
        const scale = Math.max(0.6, Math.min(1.4, ctxMean / spanMean));
        for (const n of spanNotes) n.velocity = Math.max(1, Math.min(127, Math.round((n.velocity as number) * scale)));
      }
    }
    // 2) 音区连续:入口与前一个生成音落差 >12 半音 → 整段按八度对齐(音级/轮廓/相对关系不变)
    const before = context.filter((n) => beatOf(n) < span.startBeat - 1e-4);
    const prevNote = before[before.length - 1];
    const firstAuthored = [...spanNotes].sort((a, b) => beatN(a.startTick) - beatN(b.startTick))[0];
    if (prevNote && firstAuthored) {
      let shift = 0;
      let gap = (firstAuthored.pitch as number) - (prevNote.pitch as number);
      for (let guard = 0; guard < 3 && Math.abs(gap + shift) > 12; guard++) shift += gap + shift > 0 ? -12 : 12;
      if (shift !== 0 && spanNotes.every((n) => {
        const moved = (n.pitch as number) + shift;
        return moved >= 40 && moved <= 96;
      })) {
        for (const n of spanNotes) n.pitch = midi((n.pitch as number) + shift);
      }
    }
    // 3) 边界缝合:前一个生成音 legato 桥接进 motif 入口(间隙 ≤2 拍时延到入口留 release;只延不缩)
    if (prevNote) {
      const prevEnd = beatOf(prevNote) + beatN(prevNote.durationTicks) / ppq;
      const gapBeats = span.startBeat - prevEnd;
      if (gapBeats > 0.05 && gapBeats <= 2) {
        const target = span.startBeat - 0.06;
        const nextDur = Math.max(beatN(prevNote.durationTicks) / ppq, target - beatOf(prevNote));
        prevNote.durationTicks = timebase.beatToTick(beats(nextDur));
      }
    }
  }
  return {
    ...lead,
    notes: sanitizeLeadNoteIR([...generated, ...authored]
      .sort((a, b) => beatN(a.startTick) - beatN(b.startTick) || beatN(a.pitch) - beatN(b.pitch))),
  };
}
