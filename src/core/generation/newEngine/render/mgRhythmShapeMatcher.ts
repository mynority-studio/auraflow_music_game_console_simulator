import type { AbstractMelodyToken, Grammar } from '../knowledge/melodyGrammarTypes';
import { expandGrammarForBrick } from './mgGrammarRuntime';
import type { BrickMatch } from './mgRoadMapParser';

export interface RhythmShapeEvent {
  onsetBeat: number;
  durationBeat: number;
}

/** Rhythm-only identity shared by an authored motif and generated grammar. */
export interface MelodyRhythmShapeProfile {
  spanBeats: number;
  audibleDensity: number;
  restRatio: number;
  meanDurationBeats: number;
  shortNoteRatio: number;
  longNoteRatio: number;
  normalizedOnsets: readonly number[];
  normalizedDurations: readonly number[];
  normalizedIntervals: readonly number[];
  beatPhaseHistogram: readonly number[];
}

const PROFILE_POINTS = 8;
const PHASE_BINS = 4;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function resample(values: readonly number[], points = PROFILE_POINTS): number[] {
  if (values.length === 0) return Array.from({ length: points }, () => 0);
  if (values.length === 1) return Array.from({ length: points }, () => values[0]);
  return Array.from({ length: points }, (_, index) => {
    const at = index * (values.length - 1) / Math.max(1, points - 1);
    const lo = Math.floor(at);
    const hi = Math.min(values.length - 1, Math.ceil(at));
    const mix = at - lo;
    return values[lo] * (1 - mix) + values[hi] * mix;
  });
}

function occupiedRatio(events: readonly RhythmShapeEvent[], spanStartBeat: number, spanBeats: number): number {
  const intervals = events
    .map((event) => ({
      start: Math.max(0, event.onsetBeat - spanStartBeat),
      end: Math.min(spanBeats, event.onsetBeat - spanStartBeat + event.durationBeat),
    }))
    .filter((interval) => interval.end > interval.start + 1e-6)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let occupied = 0;
  let cursorStart = intervals[0]?.start ?? 0;
  let cursorEnd = intervals[0]?.end ?? 0;
  for (const interval of intervals.slice(1)) {
    if (interval.start <= cursorEnd + 1e-6) {
      cursorEnd = Math.max(cursorEnd, interval.end);
    } else {
      occupied += cursorEnd - cursorStart;
      cursorStart = interval.start;
      cursorEnd = interval.end;
    }
  }
  if (intervals.length > 0) occupied += cursorEnd - cursorStart;
  return clamp01(occupied / Math.max(0.001, spanBeats));
}

export function buildMelodyRhythmShapeProfile(
  inputEvents: readonly RhythmShapeEvent[],
  spanStartBeat: number,
  requestedSpanBeats: number,
): MelodyRhythmShapeProfile {
  const spanBeats = Math.max(0.001, requestedSpanBeats);
  const events = inputEvents
    .filter((event) => event.durationBeat > 0
      && event.onsetBeat < spanStartBeat + spanBeats - 1e-6
      && event.onsetBeat + event.durationBeat > spanStartBeat + 1e-6)
    .map((event) => ({
      onsetBeat: Math.max(spanStartBeat, event.onsetBeat),
      durationBeat: Math.min(
        event.durationBeat,
        spanStartBeat + spanBeats - Math.max(spanStartBeat, event.onsetBeat),
      ),
    }))
    .sort((a, b) => a.onsetBeat - b.onsetBeat || b.durationBeat - a.durationBeat);
  const durations = events.map((event) => event.durationBeat);
  const meanDurationBeats = durations.length > 0
    ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length
    : spanBeats;
  const onsets = events.map((event) => clamp01((event.onsetBeat - spanStartBeat) / spanBeats));
  const intervals = events.slice(1).map((event, index) => event.onsetBeat - events[index].onsetBeat);
  const meanInterval = intervals.length > 0
    ? intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length
    : spanBeats;
  const phaseHistogram = Array.from({ length: PHASE_BINS }, () => 0);
  for (const event of events) {
    const phase = ((event.onsetBeat % 1) + 1) % 1;
    phaseHistogram[Math.min(PHASE_BINS - 1, Math.floor(phase * PHASE_BINS))] += 1;
  }
  const phaseTotal = Math.max(1, events.length);

  return {
    spanBeats,
    audibleDensity: events.length / spanBeats,
    restRatio: 1 - occupiedRatio(events, spanStartBeat, spanBeats),
    meanDurationBeats,
    shortNoteRatio: events.length > 0
      ? durations.filter((duration) => duration <= 0.375 + 1e-6).length / events.length
      : 0,
    longNoteRatio: events.length > 0
      ? durations.filter((duration) => duration >= 0.75 - 1e-6).length / events.length
      : 0,
    normalizedOnsets: resample(onsets),
    normalizedDurations: resample(durations.map((duration) => duration / Math.max(0.001, meanDurationBeats))),
    normalizedIntervals: resample(intervals.map((interval) => interval / Math.max(0.001, meanInterval))),
    beatPhaseHistogram: phaseHistogram.map((count) => count / phaseTotal),
  };
}

function tokenEvents(tokens: readonly AbstractMelodyToken[], spanBeats: number): RhythmShapeEvent[] {
  const events: RhythmShapeEvent[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.duration <= 0) continue;
    const room = spanBeats - cursor;
    if (room <= 1e-6) break;
    const durationBeat = Math.min(room, token.duration);
    if (token.kind !== 'R') events.push({ onsetBeat: cursor, durationBeat });
    cursor += durationBeat;
  }
  return events;
}

export function buildGrammarRhythmShapeProfile(
  tokens: readonly AbstractMelodyToken[],
  spanBeats: number,
): MelodyRhythmShapeProfile {
  return buildMelodyRhythmShapeProfile(tokenEvents(tokens, spanBeats), 0, spanBeats);
}

function ratioSimilarity(a: number, b: number): number {
  if (a <= 1e-6 && b <= 1e-6) return 1;
  if (a <= 1e-6 || b <= 1e-6) return 0;
  return Math.exp(-Math.abs(Math.log(a / b)));
}

function sequenceSimilarity(a: readonly number[], b: readonly number[], range = 1): number {
  const count = Math.max(1, Math.min(a.length, b.length));
  let distance = 0;
  for (let index = 0; index < count; index++) distance += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  return clamp01(1 - distance / count / Math.max(0.001, range));
}

/** 0..1 similarity over speed, silence, long/short balance and phrase shape. */
export function melodyRhythmShapeSimilarity(
  target: MelodyRhythmShapeProfile,
  candidate: MelodyRhythmShapeProfile,
): number {
  const density = ratioSimilarity(target.audibleDensity, candidate.audibleDensity);
  const meanDuration = ratioSimilarity(target.meanDurationBeats, candidate.meanDurationBeats);
  const rest = 1 - Math.abs(target.restRatio - candidate.restRatio);
  const shortNotes = 1 - Math.abs(target.shortNoteRatio - candidate.shortNoteRatio);
  const longNotes = 1 - Math.abs(target.longNoteRatio - candidate.longNoteRatio);
  const onsetShape = sequenceSimilarity(target.normalizedOnsets, candidate.normalizedOnsets);
  const durationShape = sequenceSimilarity(target.normalizedDurations, candidate.normalizedDurations, 2);
  const intervalShape = sequenceSimilarity(target.normalizedIntervals, candidate.normalizedIntervals, 2);
  const beatPhase = sequenceSimilarity(target.beatPhaseHistogram, candidate.beatPhaseHistogram);
  return clamp01(
    density * 0.18
    + meanDuration * 0.18
    + rest * 0.12
    + shortNotes * 0.08
    + longNotes * 0.08
    + onsetShape * 0.14
    + durationShape * 0.10
    + intervalShape * 0.06
    + beatPhase * 0.06,
  );
}

export interface RhythmMatchedGrammarExpansion {
  tokens: AbstractMelodyToken[];
  similarity: number;
}

/** Sample a fixed grammar candidate pool, then keep the user's closest rhythmic shape. */
export function expandGrammarForBrickMatchingRhythm(args: {
  grammar: Grammar;
  brick: BrickMatch;
  rng: () => number;
  target: MelodyRhythmShapeProfile;
  attempts?: number;
}): RhythmMatchedGrammarExpansion {
  const attempts = Math.max(1, Math.floor(args.attempts ?? 8));
  let selected: RhythmMatchedGrammarExpansion | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const tokens = expandGrammarForBrick(args.grammar, { brick: args.brick, rng: args.rng });
    const similarity = melodyRhythmShapeSimilarity(
      args.target,
      buildGrammarRhythmShapeProfile(tokens, args.brick.durationBeats),
    );
    if (!selected || similarity > selected.similarity + 1e-9) selected = { tokens, similarity };
  }
  return selected ?? { tokens: [], similarity: 0 };
}
