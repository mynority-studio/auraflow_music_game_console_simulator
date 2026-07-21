import { midi, ticks, type Timebase } from '../foundation';
import type {
  DrumPerformanceContract,
  GrooveBarScore,
  GrooveBoundaryScore,
  GrooveScorePlan,
} from '../arranger/ArrangementPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import {
  drumFeelProfile,
  type DrumFeelProfile,
  type DrumVelocityBand,
} from '../knowledge/drumPerformanceKnowledge';
import { DRUM } from '../knowledge/grooves';
import { projectDrumPitchForKit } from '../knowledge/drumKitCapabilities';

export interface DrumPerformanceRealizerOptions {
  timebase: Timebase;
  beatsPerBar: number;
  tempoBpm: number;
  grooveScorePlan: Readonly<GrooveScorePlan>;
  performanceBySection: Readonly<Record<string, Readonly<DrumPerformanceContract>>>;
  /**
   * A compiled reference score already owns pitch, onset, gate and velocity.
   * In that mode this stage is a transparent boundary: it must not dedupe,
   * enforce a kit surface, humanize, remap, stretch or choke any event.
   */
  performanceMode?: 'profiled' | 'reference-zero';
}

type HitKind = 'kick' | 'snare' | 'timekeeper' | 'tom' | 'crash' | 'percussion';

interface HitContext {
  note: NoteIR;
  index: number;
  kind: HitKind;
  absoluteBar: number;
  beatInBar: number;
  score: Readonly<GrooveBarScore> | undefined;
  boundary: Readonly<GrooveBoundaryScore> | undefined;
  landing: Readonly<GrooveBoundaryScore> | undefined;
  performance: Readonly<DrumPerformanceContract> | undefined;
  profile: Readonly<DrumFeelProfile> | undefined;
  structural: boolean;
  fill: boolean;
}

const KICK_PITCHES = new Set<number>([35, DRUM.KICK]);
const SNARE_PITCHES = new Set<number>([DRUM.SIDESTICK, DRUM.SNARE, DRUM.CLAP, 40]);
const TIMEKEEPER_PITCHES = new Set<number>([
  DRUM.CHAT, DRUM.OHAT, DRUM.PHAT, DRUM.RIDE, DRUM.RIDE_BELL, DRUM.TAMB, DRUM.SHAKER,
]);
const TOM_PITCHES = new Set<number>([41, 43, DRUM.TOM_LO, DRUM.TOM_MID, 48, DRUM.TOM_HI, 58]);
const CRASH_PITCHES = new Set<number>([DRUM.CRASH, 52, 55, 57]);
const HAND_PITCHES = new Set<number>([
  DRUM.SIDESTICK, DRUM.SNARE, 40,
  41, 43, DRUM.TOM_LO, DRUM.TOM_MID, 48, DRUM.TOM_HI, 58,
  DRUM.CHAT, DRUM.OHAT, DRUM.RIDE, DRUM.RIDE_BELL,
  DRUM.CRASH, 52, 55, 57,
]);

function hitKind(pitch: number): HitKind {
  if (KICK_PITCHES.has(pitch)) return 'kick';
  if (SNARE_PITCHES.has(pitch)) return 'snare';
  if (TIMEKEEPER_PITCHES.has(pitch)) return 'timekeeper';
  if (TOM_PITCHES.has(pitch)) return 'tom';
  if (CRASH_PITCHES.has(pitch)) return 'crash';
  return 'percussion';
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function stableSigned(...values: readonly number[]): number {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= Math.round(value * 1000);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash / 0xffffffff) * 2 - 1;
}

function nearBeat(value: number, target: number, tolerance = 0.13): boolean {
  return Math.abs(value - target) <= tolerance;
}

function isOnBeat(beat: number): boolean {
  return Math.abs(beat - Math.round(beat)) <= 0.11;
}

function isStructural(
  kind: HitKind,
  pitch: number,
  beat: number,
  score: Readonly<GrooveBarScore> | undefined,
  fill: boolean,
  landing: Readonly<GrooveBoundaryScore> | undefined,
): boolean {
  if (fill || (landing && nearBeat(beat, 0))) return true;
  if (kind === 'kick') {
    return score?.drumInteraction?.structuralKickBeats.some((candidate) => nearBeat(beat, candidate))
      ?? nearBeat(beat, 0);
  }
  if (kind === 'snare') {
    return score?.drumInteraction?.structuralSnareBeats.some((candidate) => nearBeat(beat, candidate))
      ?? (nearBeat(beat, 1) || nearBeat(beat, 3));
  }
  if (kind === 'timekeeper') {
    if (pitch === DRUM.OHAT) return true;
    if (pitch === DRUM.RIDE || pitch === DRUM.RIDE_BELL) {
      return isOnBeat(beat) && Math.round(beat) % 2 === 0;
    }
    return isOnBeat(beat);
  }
  return kind === 'crash';
}

function velocityInBand(
  raw: number,
  band: Readonly<DrumVelocityBand>,
  phraseFactor: number,
  variation: number,
): number {
  const width = Math.max(0, band.max - band.min);
  const position = 0.18 + clamp(raw / 127, 0, 1) * 0.72;
  const value = (band.min + width * position + width * variation * 0.06) * phraseFactor;
  return Math.round(clamp(value, band.min, band.max));
}

function layerBand(profile: Readonly<DrumFeelProfile>): DrumVelocityBand {
  const min = profile.velocity.snareGhost.max + 4;
  return { min, max: Math.max(min, profile.velocity.snareAccent.min - 6) };
}

function velocityBand(context: HitContext): Readonly<DrumVelocityBand> | undefined {
  const profile = context.profile;
  if (!profile) return undefined;
  const pitch = context.note.pitch as number;
  if (context.kind === 'kick') return context.structural ? profile.velocity.kickAnchor : profile.velocity.kickResponse;
  if (context.kind === 'snare') {
    if (context.fill) return profile.velocity.tomFill;
    if ((pitch === DRUM.CLAP || pitch === DRUM.SIDESTICK) && context.structural) return layerBand(profile);
    return context.structural ? profile.velocity.snareAccent : profile.velocity.snareGhost;
  }
  if (context.kind === 'timekeeper') return context.structural ? profile.velocity.timekeeperAccent : profile.velocity.timekeeperTap;
  if (context.kind === 'tom') return profile.velocity.tomFill;
  if (context.kind === 'crash') return profile.velocity.crash;
  return undefined;
}

function timingMs(context: HitContext): number {
  const profile = context.profile;
  if (!profile) return 0;
  const grammar = profile.timing;
  let base = 0;
  if (context.kind === 'kick') base = context.structural ? grammar.kickAnchorMs : grammar.kickOffbeatMs;
  else if (context.kind === 'snare') base = context.structural ? grammar.snareAccentMs : grammar.snareGhostMs;
  else if (context.kind === 'timekeeper') base = context.structural ? grammar.timekeeperOnbeatMs : grammar.timekeeperOffbeatMs;

  const amount = (context.performance?.humanizeAmount ?? 1) / 3;
  const phraseIndex = (context.score?.phraseBarIndex ?? context.absoluteBar) % 4;
  const phraseDrift = grammar.phraseDriftMs[phraseIndex] ?? 0;
  const variationSpan = Math.min(10, grammar.maxAbsoluteMs * (0.65 + amount * 0.2));
  const kindCode = context.kind === 'kick' ? 1
    : context.kind === 'snare' ? 2
      : context.kind === 'timekeeper' ? 3
        : context.kind === 'tom' ? 4 : 5;
  const barDrift = stableSigned(context.absoluteBar, kindCode, 17) * variationSpan * 0.42;
  const strokeCycle = [0, 0.34, -0.18, 0.22] as const;
  const cycleIndex = ((Math.round(context.beatInBar * 4) % 4) + 4) % 4;
  const cycleScale = context.kind === 'timekeeper' ? 1
    : context.kind === 'snare' ? 0.48
      : context.kind === 'kick' ? 0.34 : 0.22;
  const cycleDrift = strokeCycle[cycleIndex] * variationSpan * cycleScale;
  const limbVariation = stableSigned(
    context.absoluteBar,
    context.note.pitch as number,
    Math.round(context.beatInBar * 1000),
    context.index,
  ) * variationSpan * 0.24;
  const value = base + phraseDrift * amount + barDrift + cycleDrift + limbVariation;
  return clamp(value, -grammar.maxAbsoluteMs, grammar.maxAbsoluteMs);
}

function durationFor(context: HitContext, ppq: number): number {
  const current = context.note.durationTicks as number;
  const pitch = context.note.pitch as number;
  if (context.kind === 'kick' || context.kind === 'snare' || context.kind === 'tom') {
    return Math.max(1, Math.min(current, Math.round(ppq * 0.18)));
  }
  if (pitch === DRUM.CHAT || pitch === DRUM.PHAT || pitch === DRUM.SHAKER || pitch === DRUM.TAMB) {
    return Math.max(1, Math.min(current, Math.round(ppq * 0.16)));
  }
  if (pitch === DRUM.OHAT) return Math.max(current, Math.round(ppq * 0.55));
  if (pitch === DRUM.RIDE || pitch === DRUM.RIDE_BELL) return Math.max(current, Math.round(ppq * 0.6));
  if (context.kind === 'crash') return Math.max(current, Math.round(ppq * 1.25));
  return current;
}

function handPriority(pitch: number): number {
  if (CRASH_PITCHES.has(pitch)) return 100;
  if (pitch === DRUM.SNARE || pitch === DRUM.SIDESTICK || pitch === 40) return 90;
  if (TOM_PITCHES.has(pitch)) return 80;
  if (pitch === DRUM.RIDE_BELL || pitch === DRUM.RIDE) return 72;
  if (pitch === DRUM.OHAT) return 70;
  if (pitch === DRUM.CHAT) return 64;
  return 50;
}

/** Enforce the acoustic two-hand surface while retaining foot and sample layers. */
function playableNotes(notes: readonly NoteIR[], collisionTicks: number): NoteIR[] {
  const groups: NoteIR[][] = [];
  for (const note of [...notes].sort((a, b) => (a.startTick as number) - (b.startTick as number))) {
    const group = groups.at(-1);
    const groupStart = group?.[0]?.startTick as number | undefined;
    if (!group || groupStart === undefined || (note.startTick as number) - groupStart > collisionTicks) {
      groups.push([{ ...note }]);
    } else {
      group.push({ ...note });
    }
  }

  const out: NoteIR[] = [];
  for (const group of groups) {
    const hasCrash = group.some((note) => CRASH_PITCHES.has(note.pitch as number));
    const hasOpenHat = group.some((note) => (note.pitch as number) === DRUM.OHAT);
    const nonHands = group.filter((note) => !HAND_PITCHES.has(note.pitch as number));
    const hands = group
      .filter((note) => HAND_PITCHES.has(note.pitch as number))
      .filter((note) => !(hasCrash && TIMEKEEPER_PITCHES.has(note.pitch as number) && !CRASH_PITCHES.has(note.pitch as number)))
      .filter((note) => !(hasOpenHat && (note.pitch as number) === DRUM.CHAT))
      .sort((a, b) => handPriority(b.pitch as number) - handPriority(a.pitch as number) || b.velocity - a.velocity)
      .slice(0, 2);
    out.push(...nonHands, ...hands);
  }
  return out.sort((a, b) => (a.startTick as number) - (b.startTick as number) || (a.pitch as number) - (b.pitch as number));
}

function strokeFactor(context: HitContext, beatsPerBar: number): number {
  const profile = context.profile;
  if (!profile) return 1;
  const sixteenthIndex = Math.round(context.beatInBar * 4);
  if (context.kind === 'timekeeper' && profile.physical.timekeeperHand === 'alternating') {
    return sixteenthIndex % 2 === 0 ? 1.035 : 0.965;
  }
  if (context.kind === 'snare' && !context.structural && profile.physical.ghostHand === 'alternating') {
    return sixteenthIndex % 2 === 0 ? 1.025 : 0.975;
  }
  if (context.fill && context.boundary) {
    const duration = Math.max(0.25, context.boundary.durationBeats);
    const start = beatsPerBar - Math.min(beatsPerBar, duration);
    const progress = clamp((context.beatInBar - start) / duration, 0, 1);
    if (context.boundary.fillFunction === 'release') return 1.04 - progress * 0.1;
    if (context.boundary.fillFunction === 'climax') return 0.92 + progress * 0.16;
    if (context.boundary.fillFunction === 'lift' || context.boundary.fillFunction === 'setup'
      || context.boundary.fillFunction === 'opening') return 0.95 + progress * 0.11;
    return 0.98 + progress * 0.05;
  }
  return 1;
}

function dedupe(notes: readonly NoteIR[]): NoteIR[] {
  const byKey = new Map<string, NoteIR>();
  for (const note of notes) {
    const key = `${note.pitch as number}:${note.startTick as number}`;
    const current = byKey.get(key);
    if (!current || note.velocity > current.velocity) byKey.set(key, { ...note });
  }
  return [...byKey.values()].sort((a, b) =>
    (a.startTick as number) - (b.startTick as number) || (a.pitch as number) - (b.pitch as number));
}

function chokeOpenHats(notes: readonly NoteIR[], ppq: number): NoteIR[] {
  const closedTicks = notes
    .filter((note) => (note.pitch as number) === DRUM.CHAT || (note.pitch as number) === DRUM.PHAT)
    .map((note) => note.startTick as number)
    .sort((a, b) => a - b);
  return notes.map((note) => {
    if ((note.pitch as number) !== DRUM.OHAT) return note;
    const start = note.startTick as number;
    const close = closedTicks.find((tick) => tick > start && tick - start <= ppq);
    if (close === undefined) return note;
    return { ...note, durationTicks: ticks(Math.max(1, close - start - 1)) };
  });
}

export function realizeDrumPerformanceTrack(
  track: TrackIR,
  options: DrumPerformanceRealizerOptions,
): TrackIR {
  if (track.role !== 'drum' || track.notes.length === 0) return track;
  if (options.performanceMode === 'reference-zero') return track;
  const { timebase, beatsPerBar, tempoBpm, grooveScorePlan, performanceBySection } = options;
  const ppq = timebase.ppq;
  const barTicks = ppq * beatsPerBar;
  const scoreByBar = new Map<number, Readonly<GrooveBarScore>>();
  for (const section of Object.values(grooveScorePlan.bySection)) {
    for (const bar of section.bars) scoreByBar.set(bar.absoluteBar, bar);
  }
  const boundaryBySource = new Map<number, Readonly<GrooveBoundaryScore>>();
  const boundaryByLanding = new Map<number, Readonly<GrooveBoundaryScore>>();
  for (const boundary of grooveScorePlan.boundaries) {
    boundaryBySource.set(boundary.sourceBar, boundary);
    boundaryByLanding.set(boundary.landingBar, boundary);
  }

  const collisionTicks = Math.max(1, Math.round(ppq * tempoBpm * 0.006 / 60));
  const source = playableNotes(track.notes, collisionTicks);
  const contexts: HitContext[] = source.map((note, index) => {
    const tick = note.startTick as number;
    const absoluteBar = Math.max(0, Math.floor((tick + 2) / barTicks));
    const beatInBar = (tick - absoluteBar * barTicks) / ppq;
    const score = scoreByBar.get(absoluteBar);
    const boundary = boundaryBySource.get(absoluteBar);
    const landing = boundaryByLanding.get(absoluteBar);
    const performance = score ? performanceBySection[score.sectionId] : undefined;
    const profile = performance ? drumFeelProfile(performance.feelProfileId) : undefined;
    const fillStart = boundary ? beatsPerBar - Math.min(beatsPerBar, Math.max(0.25, boundary.durationBeats)) : Number.POSITIVE_INFINITY;
    const fill = !!boundary && beatInBar >= fillStart - 0.08;
    const kind = hitKind(note.pitch as number);
    return {
      note, index, kind, absoluteBar, beatInBar, score, boundary, landing, performance, profile, fill,
      structural: isStructural(kind, note.pitch as number, beatInBar, score, fill, landing),
    };
  });

  const realized = contexts.map((context) => {
    if (!context.profile || !context.performance) return { ...context.note };
    const band = velocityBand(context);
    const phraseIndex = (context.score?.phraseBarIndex ?? context.absoluteBar) % 4;
    const phraseFactor = (context.profile.phrase.velocityContour[phraseIndex] ?? 1)
      * strokeFactor(context, beatsPerBar);
    const variation = stableSigned(context.absoluteBar, context.index, context.note.pitch as number, context.note.velocity);
    const velocity = band
      ? velocityInBand(context.note.velocity, band, phraseFactor, variation)
      : Math.round(clamp(context.note.velocity * phraseFactor, 1, 127));

    let moveTicks = Math.round(timingMs(context) * ppq * tempoBpm / 60_000);
    const contractLimit = Math.max(0, Math.round(context.performance.maxMoveTicks * ppq / 480));
    moveTicks = clamp(moveTicks, -contractLimit, contractLimit);
    const barStart = context.absoluteBar * barTicks;
    const barEnd = barStart + barTicks - 1;
    const pitch = context.note.pitch as number;
    const exactLanding = context.landing && nearBeat(context.beatInBar, 0)
      && (KICK_PITCHES.has(pitch) || CRASH_PITCHES.has(pitch));
    const exactSectionAnchor = nearBeat(context.beatInBar, 0)
      && (context.absoluteBar === 0 || context.score?.barInSection === 0)
      && (KICK_PITCHES.has(pitch) || CRASH_PITCHES.has(pitch));
    const startTick = exactLanding || exactSectionAnchor
      ? barStart
      : clamp((context.note.startTick as number) + moveTicks, barStart, barEnd);
    const projectedPitch = projectDrumPitchForKit(context.performance.kitProgram, pitch);
    return {
      ...context.note,
      pitch: midi(projectedPitch),
      startTick: ticks(Math.round(startTick)),
      durationTicks: ticks(durationFor(context, ppq)),
      velocity,
    };
  });

  return {
    ...track,
    notes: chokeOpenHats(dedupe(realized), ppq),
  };
}
