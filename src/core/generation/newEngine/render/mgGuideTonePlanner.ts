// ============================================================
// newEngine · render · MgGuideTonePlanner(MG strict 移植 Loop 5)
// Provenance: ../melodygenerative/src/lib/improvisor/GuideTonePlanner.ts 忠实港(cp + 改 import)。
// 确定性 guide-tone 骨架(每和弦 1-2 锚点,7→3/3→7);realizeTokens 结构音绑它。无 RNG。
// ============================================================

// GuideTonePlanner.ts - Impro-Visor-style melodic backbone.
//
// The planner builds a deterministic guide-tone line over ChordPart
// before lick realization. LickGen can then bind structural melody
// positions to this backbone while leaving passing/color notes free.

import { CHORD_TYPES, MELODY_RANGE } from '../knowledge/mgMusicTheoryTables';
import type { ChordPart, ChordBlock } from './mgChordPart';
import { buildPitchSets, type ChordPitchSets } from './mgPitchClassSets';

const pcOf = (m: number) => ((m % 12) + 12) % 12;

export interface GuideTonePoint {
  chordIndex: number;
  startBeat: number;
  endBeat: number;
  pc: number;
  midi: number;
  priorityRank: number;
  lineIndex: number;
}

export interface GuideTonePlan {
  points: GuideTonePoint[];
  byChordIndex: Map<number, GuideTonePoint[]>;
}

export interface BuildGuideTonePlanArgs {
  chordPart: ChordPart;
  registerCenter?: number;
  lowMidi?: number;
  highMidi?: number;
}

/** Build one or two guide-tone anchors per chord block. Longer chords get
 *  two half-block anchors so the melody can move 7-to-3 / 3-to-7 inside
 *  the same bar instead of sitting on one note for the whole harmony. */
export function buildGuideTonePlan(args: BuildGuideTonePlanArgs): GuideTonePlan {
  const {
    chordPart,
    registerCenter = 67,
    lowMidi = MELODY_RANGE.LOW,
    highMidi = Math.min(MELODY_RANGE.HIGH, 76),
  } = args;

  const points: GuideTonePoint[] = [];
  const byChordIndex = new Map<number, GuideTonePoint[]>();
  let prevMidi: number | null = null;
  let direction: 1 | -1 = 1;

  for (let i = 0; i < chordPart.blocks.length; i++) {
    const chord = chordPart.blocks[i];
    const nextChord = chordPart.blocks[i + 1] ?? null;
    const sets = buildPitchSets({ chord, nextChord });
    const guidePcs = guideTonePcs(sets);
    const segmentCount = chord.durationBeats >= 2 ? 2 : 1;
    const chordPoints: GuideTonePoint[] = [];

    for (let s = 0; s < segmentCount; s++) {
      const segStart = chord.startBeat + (chord.durationBeats * s) / segmentCount;
      const segEnd = chord.startBeat + (chord.durationBeats * (s + 1)) / segmentCount;
      const preferredPc = guidePcs[s % guidePcs.length] ?? sets.rootPc;
      const choice = chooseGuideMidi({
        pcs: guidePcs,
        preferredPc,
        priorityPcs: sets.priorityPcs,
        prevMidi,
        direction,
        registerCenter,
        lowMidi,
        highMidi,
      });

      const point: GuideTonePoint = {
        chordIndex: chord.index,
        startBeat: segStart,
        endBeat: segEnd,
        pc: pcOf(choice),
        midi: choice,
        priorityRank: rankPc(pcOf(choice), sets.priorityPcs),
        lineIndex: s,
      };
      points.push(point);
      chordPoints.push(point);
      prevMidi = choice;

      if (choice >= highMidi - 2) direction = -1;
      else if (choice <= lowMidi + 2) direction = 1;
    }

    byChordIndex.set(chord.index, chordPoints);
  }

  return { points, byChordIndex };
}

/** Find the planned guide-tone point covering a token beat. */
export function guideToneAtBeat(
  plan: GuideTonePlan | null | undefined,
  chord: ChordBlock,
  beat: number,
): GuideTonePoint | null {
  if (!plan) return null;
  const points = plan.byChordIndex.get(chord.index);
  if (!points || points.length === 0) return null;
  return points.find(p => beat >= p.startBeat - 1e-4 && beat < p.endBeat - 1e-4)
      ?? points[points.length - 1];
}

/** Move a planned guide pc into a singable octave near the actual line. */
export function materializeGuideTone(
  point: GuideTonePoint,
  prevMidi: number | null,
  registerCenter = 67,
): number {
  const ref = prevMidi ?? point.midi ?? registerCenter;
  return nearestMidiInRange(point.pc, ref, MELODY_RANGE.LOW, MELODY_RANGE.HIGH);
}

function guideTonePcs(sets: ChordPitchSets): number[] {
  const chordSet = new Set(sets.chordTones);
  const literalGuide: number[] = [];
  const ivs = CHORD_TYPES[sets.chordType];
  if (ivs && ivs.length >= 2) {
    literalGuide.push((sets.rootPc + ivs[1]) % 12);
    if (ivs.length >= 4) literalGuide.push((sets.rootPc + ivs[3]) % 12);
  }

  const guideSet = new Set(literalGuide.filter(pc => chordSet.has(pc)));
  const priorityChord = uniquePcs(sets.priorityPcs.filter(pc => chordSet.has(pc)));
  const priorityGuide = priorityChord.filter(pc => guideSet.has(pc));
  const literalRest = literalGuide.filter(pc => chordSet.has(pc) && !priorityGuide.includes(pc));
  const fallback = priorityChord.filter(pc => !priorityGuide.includes(pc) && !literalRest.includes(pc));

  const out = uniquePcs([...priorityGuide, ...literalRest, ...fallback, ...sets.chordTones]);
  return out.length > 0 ? out : [sets.rootPc];
}

function chooseGuideMidi(args: {
  pcs: number[];
  preferredPc: number;
  priorityPcs: number[];
  prevMidi: number | null;
  direction: 1 | -1;
  registerCenter: number;
  lowMidi: number;
  highMidi: number;
}): number {
  const { pcs, preferredPc, priorityPcs, prevMidi, direction, registerCenter, lowMidi, highMidi } = args;
  let best = nearestMidiInRange(preferredPc, prevMidi ?? registerCenter, lowMidi, highMidi);
  let bestScore = Number.POSITIVE_INFINITY;

  for (const pc of pcs) {
    for (const midi of midiVariants(pc, lowMidi, highMidi)) {
      const ref = prevMidi ?? registerCenter;
      const distance = Math.abs(midi - ref);
      const directionCost = prevMidi === null ? 0
        : direction === 1 && midi < prevMidi ? 1.5
        : direction === -1 && midi > prevMidi ? 1.5
        : 0;
      const preferredCost = pc === preferredPc ? -4 : 0;
      const priorityCost = rankPc(pc, priorityPcs) * 0.25;
      const centerCost = Math.abs(midi - registerCenter) * 0.05;
      const score = guideDistanceCost(distance) + directionCost + preferredCost + priorityCost + centerCost;
      if (score < bestScore) {
        bestScore = score;
        best = midi;
      }
    }
  }

  return best;
}

function guideDistanceCost(distance: number): number {
  const d = Math.min(Math.abs(distance), 6);
  if (d <= 2) return 1;
  if (d <= 4) return 2;
  if (d <= 6) return 3;
  return 4;
}

function rankPc(pc: number, priorityPcs: number[]): number {
  const idx = priorityPcs.indexOf(pc);
  return idx >= 0 ? idx : priorityPcs.length + 2;
}

function midiVariants(pc: number, low: number, high: number): number[] {
  const out: number[] = [];
  for (let m = low; m <= high; m++) {
    if (pcOf(m) === pc) out.push(m);
  }
  return out.length > 0 ? out : [nearestMidiInRange(pc, Math.round((low + high) / 2), low, high)];
}

function nearestMidiInRange(pc: number, refMidi: number, low: number, high: number): number {
  let best = pc;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let oct = -1; oct <= 10; oct++) {
    const midi = pc + oct * 12;
    if (midi < low || midi > high) continue;
    const dist = Math.abs(midi - refMidi);
    if (dist < bestDist) {
      best = midi;
      bestDist = dist;
    }
  }
  while (best < low) best += 12;
  while (best > high) best -= 12;
  return best;
}

function uniquePcs(pcs: number[]): number[] {
  const out: number[] = [];
  for (const pc of pcs) {
    const n = pcOf(pc);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}
