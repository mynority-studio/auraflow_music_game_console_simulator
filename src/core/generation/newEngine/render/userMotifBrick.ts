// ============================================================
// newEngine · render · userMotifBrick
// ------------------------------------------------------------
// Additive Q+N hook: treat a user motif as a melodic brick quote inside
// the normal MG/Q+N lead. It does not generate the full lead by itself.
// ============================================================

import { beats, midi, type Timebase } from '../foundation';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import { fitMidiToProgramRange } from '../knowledge/instruments';
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
  anchorBeats?: readonly number[];
}

type PocketMs = readonly number[];
export interface UserMotifGrooveContract {
  grid?: string;
  melodySwingRatio?: number;
  melodyStrongPocketMs?: PocketMs;
  melodyWeakPocketMs?: PocketMs;
}

function beatN(b: unknown): number {
  return b as number;
}

function motifSpan(notes: readonly UserMotifBrickNote[], quoteBeats?: number): number {
  const span = notes.reduce((m, n) => Math.max(m, n.onsetBeat + n.durationBeat), 0);
  return Math.max(0.25, quoteBeats ?? span);
}

function defaultAnchors(totalBeats: number, quoteBeats: number): number[] {
  const interval = Math.max(quoteBeats, 16);
  const out: number[] = [];
  for (let at = 0; at < totalBeats - 1e-6; at += interval) out.push(at);
  return out;
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
  const needsGridSnap = (contract.grid === 'swing' || contract.grid === 'shuffle' || contract.grid === 'dilla' || contract.grid === 'rubato') || Math.abs(swingRatio - 0.5) > 1e-6;
  if (!hasMelodyPocket && !needsGridSnap) return [...swung];

  const gridStep = contract.grid === 'shuffle' ? 1 / 3 : 0.5;
  const snapWindow = contract.grid === 'rubato' ? 0.24 : 0.18;
  const deltas: Array<{ index: number; sourceOnset: number; delta: number }> = [];
  const out = swung.map((n, index) => {
    const original = source[index] ?? n;
    if (!isStructuralMotifNote(original)) return { ...n };
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
    let best = deltas[0], bestDist = Math.abs(original.onsetBeat - deltas[0].sourceOnset);
    for (const d of deltas.slice(1)) {
      const dist = Math.abs(original.onsetBeat - d.sourceOnset);
      if (dist < bestDist) { best = d; bestDist = dist; }
    }
    if (bestDist > 1.0 || Math.abs(best.delta) > 0.12) return n;
    return { ...n, onsetBeat: Math.max(0, n.onsetBeat + best.delta) };
  });
}

function toNoteIR(n: UserMotifBrickNote, timebase: Timebase, leadProgram?: number): NoteIR {
  const rawPitch = Math.max(0, Math.min(127, Math.round(n.pitch)));
  const pitch = leadProgram === undefined ? rawPitch : fitMidiToProgramRange(rawPitch, 'lead', leadProgram);
  return {
    pitch: midi(pitch),
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

/** Insert user motif quotes into a normal Q+N/MG lead at brick anchors.
 * Existing Q+N lead material is only removed inside quote spans; all other
 * continuation remains generated by Q+N. */
export function applyUserMotifBrickToLead(
  lead: TrackIR,
  brick: UserMotifBrick | undefined,
  timebase: Timebase,
  totalBeats: number,
  options: {
    leadProgram?: number;
    leadProgramForBeat?: (beat: number) => number | undefined;
    swingRatio?: number;
    beatsPerBar?: number;
    grooveContract?: UserMotifGrooveContract;
    tempoBpm?: number;
  } = {},
): TrackIR {
  if (!brick || brick.notes.length === 0) return lead;

  const quoteBeats = Math.min(totalBeats, motifSpan(brick.notes, brick.quoteBeats));
  if (quoteBeats <= 1e-6) return lead;

  const anchors = (brick.anchorBeats?.length ? [...brick.anchorBeats] : defaultAnchors(totalBeats, quoteBeats))
    .filter((at) => at >= 0 && at < totalBeats - 1e-6);
  if (anchors.length === 0) return lead;

  const quoteUnit = brick.notes
    .filter((n) => n.durationBeat > 0 && n.onsetBeat < quoteBeats - 1e-6)
    .map((n) => ({ ...n, durationBeat: Math.min(n.durationBeat, quoteBeats - n.onsetBeat) }));
  if (quoteUnit.length === 0) return lead;

  const protectedSpans = anchors.map((at) => [at, Math.min(totalBeats, at + quoteBeats)] as const);
  const qnNotes = lead.notes.filter((n) => !protectedSpans.some(([lo, hi]) => overlapsSpan(n, lo, hi, timebase)));

  const swingRatio = options.swingRatio ?? 0.5;
  const beatsPerBar = options.beatsPerBar ?? timebase.meter.numerator;
  const injected: NoteIR[] = [];
  for (const at of anchors) {
    const placed = quoteUnit
      .map((n) => ({ ...n, onsetBeat: at + n.onsetBeat }))
      .filter((n) => n.onsetBeat < totalBeats - 1e-6)
      .map((n) => ({ ...n, durationBeat: Math.min(n.durationBeat, totalBeats - n.onsetBeat) }))
      .sort((a, b) => a.onsetBeat - b.onsetBeat);
    const swung = swingMotifNotes(placed, swingRatio, beatsPerBar);
    const grooveAligned = alignStructuralMotifNotesToGroove(placed, swung, options.grooveContract, options.tempoBpm, timebase.ppq, beatsPerBar, swingRatio);
    injected.push(...grooveAligned
      .map((n) => toNoteIR(n, timebase, options.leadProgramForBeat?.(n.onsetBeat) ?? options.leadProgram ?? lead.program)));
  }

  return {
    ...lead,
    notes: sanitizeLeadNoteIR([...qnNotes, ...injected]
      .sort((a, b) => beatN(a.startTick) - beatN(b.startTick) || beatN(a.pitch) - beatN(b.pitch))),
  };
}
