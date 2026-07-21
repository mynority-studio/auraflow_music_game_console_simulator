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
}

export interface AuthoredLeadSpan {
  startBeat: number;
  endBeat: number;
}

type PocketMs = readonly number[];
export const USER_MOTIF_MAX_TIMING_DEVIATION_RATIO = 0.2;
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
    if (scaleFactor < 1 - USER_MOTIF_MAX_TIMING_DEVIATION_RATIO - 1e-6
      || scaleFactor > 1 + USER_MOTIF_MAX_TIMING_DEVIATION_RATIO + 1e-6) return;
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
    const score = supportRatio * 100
      + affinity * 12
      + earlyPreference * 8
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
      if (targetSpanBeats > sourceSpanBeats * (1 + USER_MOTIF_MAX_TIMING_DEVIATION_RATIO) + 1e-6
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
}): AuthoredUserMotifBrickPlan | undefined {
  const { brick, roadMap, harmonicPlan, totalBeats } = args;
  if (brick.notes.length === 0 || roadMap.bricks.length === 0 || totalBeats <= 0) return undefined;
  const sourceStartBeat = Math.min(0, ...brick.notes.map((note) => note.onsetBeat));
  const sourceEndBeat = Math.max(
    brick.quoteBeats ?? 0,
    ...brick.notes.map((note) => note.onsetBeat + note.durationBeat),
  );
  const sourceSpanBeats = Math.max(0.25, sourceEndBeat - sourceStartBeat);
  const candidates = placementCandidates(brick, roadMap, harmonicPlan, totalBeats, sourceStartBeat, sourceSpanBeats);
  const selected = candidates.sort((a, b) => b.score - a.score
    || a.startBeat - b.startBeat
    || Math.abs(1 - a.scaleFactor) - Math.abs(1 - b.scaleFactor))[0];
  if (!selected) return undefined;
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
    timingDeviationRatioLimit: USER_MOTIF_MAX_TIMING_DEVIATION_RATIO,
    fidelityReferenceNotes,
    rhythmShapeProfile: buildMelodyRhythmShapeProfile(sourceNotes, sourceStartBeat, sourceSpanBeats),
    notes: selected.notes,
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
  return plan ? [{ startBeat: plan.startBeat, endBeat: plan.endBeat }] : [];
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
  return fidelityAligned
    .map((note) => {
      const onsetBeat = Math.max(plan.startBeat, Math.min(plan.endBeat - 0.03, note.onsetBeat));
      return {
        ...note,
        onsetBeat,
        durationBeat: Math.max(0.03, Math.min(note.durationBeat, plan.endBeat - onsetBeat)),
      };
    })
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
  const generated = lead.notes.filter((note) => !overlapsSpan(note, plan.startBeat, plan.endBeat, timebase));
  return {
    ...lead,
    notes: sanitizeLeadNoteIR([...generated, ...authoredNotes]
      .sort((a, b) => beatN(a.startTick) - beatN(b.startTick) || beatN(a.pitch) - beatN(b.pitch))),
  };
}
