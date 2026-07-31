import { describe, expect, it } from 'vitest';
import type {
  LofiLeadContinuitySlot,
  LofiLeadScoreBar,
  LofiLeadScorePlan,
} from '../arranger/lofiLeadScorePlan';
import { buildChordPart, type MgChordDef } from './mgChordPart';
import type { ScheduledToken } from './mgTokenScheduler';
import { scheduleLofiLeadScoreTokens } from './mgLofiLeadScoreScheduler';

const EPSILON = 1e-6;

type SlotRole = LofiLeadContinuitySlot['role'];
type PhraseRole = LofiLeadContinuitySlot['phraseRole'];

function slot(args: {
  id: string;
  spanId: string;
  start: number;
  end: number;
  role?: SlotRole;
  phraseRole?: PhraseRole;
  barId?: string;
  motifId?: string;
  entryBeat?: number;
  minimum?: number;
  exposedGap?: number;
  bridges?: LofiLeadContinuitySlot['boundaryBridges'];
  allowedShort?: LofiLeadContinuitySlot['allowedShortGestureClasses'];
}): LofiLeadContinuitySlot {
  const role = args.role ?? 'statement-carrier';
  const phraseRole = args.phraseRole ?? 'statement';
  const barId = args.barId ?? `bar-${Math.floor(args.start / 4)}`;
  return {
    id: args.id,
    phraseId: 'phrase-1',
    sourceSpanId: args.spanId,
    startBeat: args.start,
    endBeat: args.end,
    exposedGapBeats: args.exposedGap ?? 1.25,
    minimumWrittenDurationBeats: args.minimum ?? 2,
    releaseGuardBeats: 0.08,
    reentryGuardBeats: 0.0625,
    maxOnsetNudgeBeats: 0.125,
    allowedShortGestureClasses: args.allowedShort ?? ['answer-riff', 'connected-crawl', 'approach-target'],
    shortGestureMustResolve: true,
    harmonicScope: 'current-chord',
    stableRoles: ['root', 'third', 'fifth', 'seventh'],
    boundaryBridges: args.bridges ?? [{ kind: 'release-at-boundary' }],
    barId,
    sectionId: 'verse',
    absoluteBar: Math.floor(args.start / 4),
    phraseRole,
    role,
    ...(args.motifId ? { motifId: args.motifId } : {}),
    ...(args.entryBeat === undefined ? {} : { entryBeat: args.entryBeat }),
    allowedGrammarTags: [],
    conditionalGrammarTags: [],
    roadMapBinding: { brickIndices: [], brickFamilies: [], brickNames: [] },
  };
}

function score(slots: readonly LofiLeadContinuitySlot[]): LofiLeadScorePlan {
  const barsById = new Map<string, LofiLeadScoreBar>();
  for (const item of slots) {
    const previous = barsById.get(item.barId);
    const next: LofiLeadScoreBar = {
      id: item.barId,
      sectionId: item.sectionId,
      absoluteBar: item.absoluteBar,
      phraseId: item.phraseId,
      ...(item.motifId ? { motifId: item.motifId } : {}),
      phraseBarIndex: item.absoluteBar,
      arcPhase: 'settle',
      phraseRole: item.phraseRole,
      role: item.role,
      startBeat: previous ? Math.min(previous.startBeat, item.startBeat) : item.startBeat,
      endBeat: previous ? Math.max(previous.endBeat, item.endBeat) : item.endBeat,
      ...(item.entryBeat === undefined ? {} : { entryBeat: item.entryBeat }),
    };
    barsById.set(item.barId, next);
  }
  const bars = [...barsById.values()].sort((left, right) => left.startBeat - right.startBeat);
  return {
    phraseBars: bars.length,
    silenceWindows: [],
    entryBeats: slots.flatMap((item) => item.entryBeat === undefined ? [] : [item.entryBeat]),
    bars,
    barById: Object.fromEntries(bars.map((bar) => [bar.id, bar])),
    slots,
    slotIdsByAbsoluteBar: Object.fromEntries(slots.map((item) => [String(item.absoluteBar), [item.id]])),
  } as unknown as LofiLeadScorePlan;
}

function part(spec: readonly { spanId: string; duration: number; stable: readonly number[] }[]) {
  const chords: MgChordDef[] = spec.map((item, index) => ({
    root: ['C', 'F', 'G', 'A'][index % 4]!,
    rootMidi: [60, 65, 67, 69][index % 4]!,
    bassMidi: [48, 53, 55, 57][index % 4]!,
    type: 'maj7',
    duration: item.duration,
    spanId: item.spanId,
    stableTonePcs: item.stable,
  }));
  return buildChordPart(chords);
}

function audible(entries: readonly ScheduledToken[]): ScheduledToken[] {
  return entries.filter((entry) => entry.token.duration > 0
    && entry.token.kind !== 'R'
    && entry.token.kind !== 'SlopeEnter'
    && entry.token.kind !== 'SlopeExit');
}

describe('render/mgLofiLeadScoreScheduler', () => {
  it('clips grammar tokens to score slots and writes a real rest for a score-owned rest bar', () => {
    const rest = slot({ id: 'rest', spanId: 's0', start: 0, end: 4, role: 'rest', phraseRole: 'rest' });
    const active = slot({ id: 'active', spanId: 's1', start: 4, end: 8 });
    const out = scheduleLofiLeadScoreTokens([
      { token: { kind: 'C', duration: 2 }, startBeat: 1 },
      { token: { kind: 'C', duration: 5 }, startBeat: 4 },
    ], part([
      { spanId: 's0', duration: 4, stable: [0, 4, 7] },
      { spanId: 's1', duration: 4, stable: [0, 4, 7] },
    ]), score([rest, active]));

    expect(out.find((entry) => entry.startBeat === 0 && entry.token.kind === 'R')).toMatchObject({
      token: { duration: 4 },
      lofiScore: { slotId: 'rest', release: { reason: 'score-rest' } },
    });
    expect(audible(out)).toEqual([expect.objectContaining({
      startBeat: 4,
      token: { kind: 'C', duration: 4 },
      lofiScore: expect.objectContaining({ slotId: 'active' }),
    })]);
    expect(audible(out).every((entry) => entry.startBeat + entry.token.duration <= 8 + EPSILON)).toBe(true);
  });

  it('writes the arranger entry C and upgrades an exposed single into a same-harmony carrier', () => {
    const entrySlot = slot({ id: 'entry', spanId: 's0', start: 0, end: 4, entryBeat: 0.5 });
    const singleSlot = slot({ id: 'single', spanId: 's1', start: 4, end: 8, barId: 'bar-1' });
    const out = scheduleLofiLeadScoreTokens([
      { token: { kind: 'C', duration: 0.25 }, startBeat: 6 },
    ], part([
      { spanId: 's0', duration: 4, stable: [0, 4, 7] },
      { spanId: 's1', duration: 4, stable: [0, 4, 7] },
    ]), score([entrySlot, singleSlot]));

    const entry = out.find((item) => Math.abs(item.startBeat - 0.5) < EPSILON)!;
    expect(entry).toMatchObject({ token: { kind: 'C', duration: 2 }, lofiScore: { entryFallback: true } });
    const carrier = out.find((item) => Math.abs(item.startBeat - 6) < EPSILON)!;
    expect(carrier).toMatchObject({
      token: { kind: 'C', duration: 2 },
      lofiScore: { carrier: { kind: 'breath', minimumDurationBeats: 2 } },
    });
  });

  it('permits a cross-harmony carrier only through the score-proved common tone', () => {
    const source = slot({
      id: 'source', spanId: 's0', start: 0, end: 4,
      bridges: [
        { kind: 'common-tone', targetSpanId: 's1', continuationPcs: [7] },
        { kind: 'release-at-boundary' },
      ],
    });
    const target = slot({ id: 'target', spanId: 's1', start: 4, end: 8, barId: 'bar-1' });
    const out = scheduleLofiLeadScoreTokens([
      { token: { kind: 'C', duration: 0.25 }, startBeat: 3 },
    ], part([
      { spanId: 's0', duration: 4, stable: [0, 4, 7] },
      { spanId: 's1', duration: 4, stable: [2, 7, 11] },
    ]), score([source, target]));

    expect(out.find((item) => item.startBeat === 3)).toMatchObject({
      token: { kind: 'C', duration: 2 },
      lofiScore: {
        harmonicScope: 'common-tone-next-chord',
        carrier: { kind: 'common-tone', targetChordIndex: 1, targetSpanId: 's1', continuationPc: 7 },
      },
    });
  });

  it('releases a boundary click when the Arranger did not pre-prove a common tone', () => {
    const source = slot({ id: 'source', spanId: 's0', start: 0, end: 4 });
    const target = slot({ id: 'target', spanId: 's1', start: 4, end: 8, barId: 'bar-1' });
    const out = scheduleLofiLeadScoreTokens([
      { token: { kind: 'C', duration: 0.25 }, startBeat: 3 },
    ], part([
      { spanId: 's0', duration: 4, stable: [0, 4, 7] },
      { spanId: 's1', duration: 4, stable: [2, 7, 11] },
    ]), score([source, target]));

    expect(out.find((item) => item.startBeat === 3)).toMatchObject({
      token: { kind: 'R', duration: 0.25 },
      lofiScore: { release: { reason: 'no-safe-carrier' } },
    });
  });

  it('keeps approach/crawl atoms only with a real local target', () => {
    const active = slot({ id: 'active', spanId: 's0', start: 0, end: 4 });
    const out = scheduleLofiLeadScoreTokens([
      { token: { kind: 'A', duration: 0.25 }, startBeat: 0.25 },
      { token: { kind: 'C', duration: 0.5 }, startBeat: 0.5 },
      { token: { kind: 'A', duration: 0.25 }, startBeat: 3.75 },
    ], part([{ spanId: 's0', duration: 4, stable: [0, 4, 7] }]), score([active]));

    expect(out.find((item) => item.startBeat === 0.25)).toMatchObject({
      token: { kind: 'A', duration: 0.25 },
      lofiScore: { shortGesture: { class: 'approach-target', targetStartBeat: 0.5, targetSlotId: 'active' } },
    });
    expect(out.find((item) => item.startBeat === 3.75)).toMatchObject({
      token: { kind: 'R', duration: 0.25 },
      lofiScore: { release: { reason: 'unresolved-short-gesture' } },
    });
  });

  it('does not put a chromatic approach on a structural attack even when a target follows', () => {
    const active = slot({ id: 'active', spanId: 's0', start: 0, end: 4 });
    const out = scheduleLofiLeadScoreTokens([
      { token: { kind: 'A', duration: 0.25 }, startBeat: 0 },
      { token: { kind: 'C', duration: 0.5 }, startBeat: 0.25 },
    ], part([{ spanId: 's0', duration: 4, stable: [0, 4, 7] }]), score([active]));

    expect(out.find((item) => item.startBeat === 0)).toMatchObject({
      token: { kind: 'R', duration: 0.25 },
      lofiScore: { release: { reason: 'unsafe-exposed-fragment' } },
    });
  });

  it('writes every admitted approach as a true short connective atom', () => {
    const active = slot({ id: 'active', spanId: 's0', start: 0, end: 4 });
    const out = scheduleLofiLeadScoreTokens([
      { token: { kind: 'A', duration: 1 }, startBeat: 0.25 },
      { token: { kind: 'C', duration: 0.5 }, startBeat: 1.25 },
    ], part([{ spanId: 's0', duration: 4, stable: [0, 4, 7] }]), score([active]));

    expect(out.find((item) => item.startBeat === 0.25)).toMatchObject({
      token: { kind: 'A', duration: 0.5 },
      lofiScore: { shortGesture: { class: 'approach-target', targetStartBeat: 1.25, targetSlotId: 'active' } },
    });
  });

  it('replays statement rhythm as variation/return tokens before pitch realization', () => {
    const statement = slot({ id: 'statement', spanId: 's0', start: 0, end: 4, motifId: 'm', phraseRole: 'statement', barId: 'bar-0', minimum: 0.25 });
    const variation = slot({ id: 'variation', spanId: 's1', start: 4, end: 8, motifId: 'm', phraseRole: 'variation', role: 'answer-riff', barId: 'bar-1', minimum: 0.25 });
    const returning = slot({ id: 'return', spanId: 's2', start: 8, end: 12, motifId: 'm', phraseRole: 'return', role: 'return-hold', barId: 'bar-2', minimum: 0.25 });
    const out = scheduleLofiLeadScoreTokens([
      { token: { kind: 'C', duration: 0.5 }, startBeat: 0 },
      { token: { kind: 'S', duration: 0.5 }, startBeat: 0.5 },
      { token: { kind: 'C', duration: 1 }, startBeat: 1 },
      // These target-bar grammar atoms must be replaced by the score motif.
      { token: { kind: 'L', duration: 1 }, startBeat: 4 },
      { token: { kind: 'H', duration: 1 }, startBeat: 8 },
    ], part([
      { spanId: 's0', duration: 4, stable: [0, 4, 7] },
      { spanId: 's1', duration: 4, stable: [0, 4, 7] },
      { spanId: 's2', duration: 4, stable: [0, 4, 7] },
    ]), score([statement, variation, returning]));

    const variationEvents = audible(out).filter((item) => item.startBeat >= 4 && item.startBeat < 8);
    expect(variationEvents.map((item) => [item.token.kind, item.startBeat, item.token.duration])).toEqual([
      ['C', 4, 0.5], ['S', 4.5, 0.5], ['C', 5.25, 1],
    ]);
    expect(variationEvents.every((item) => item.lofiScore?.motif?.role === 'variation')).toBe(true);
    const returnEvents = audible(out).filter((item) => item.startBeat >= 8 && item.startBeat < 12);
    expect(returnEvents.map((item) => [item.token.kind, item.startBeat, item.token.duration])).toEqual([
      ['C', 8, 0.5], ['S', 8.5, 0.5], ['C', 9, 1],
    ]);
    expect(returnEvents.every((item) => item.lofiScore?.motif?.role === 'return')).toBe(true);
  });
});
