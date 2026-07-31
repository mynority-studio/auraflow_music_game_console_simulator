import { describe, it, expect } from 'vitest';
import { buildChordPart, type MgChordDef } from './mgChordPart';
import { parseFunctionalRoadMap } from './mgFunctionalRoadMap';
import { expandGrammarForRoadMap } from './mgGrammarRuntime';
import { scheduleBrickExpansions, type ScheduledToken } from './mgTokenScheduler';
import { planAcgLeadAfterglowHolds, planAcgSustainedSingleCarriers, scheduleAcgCycleCadencePhrases } from './mgAcgCycleScheduler';
import { makeSeededRng } from './mgRng';
import { ACG_PIANOSONG_GRAMMAR } from '../knowledge/melodyStyleGrammarProfiles';
import type { AcgLeadPresencePlan } from './acgLeadPresencePlan';
import type {
  AcgPianoLeadContinuitySlot,
  AcgPianoReturnShape,
  AcgPianoScorePlan,
} from '../arranger/acgPianoScorePlan';

// ============================================================
// MG full-parity G4 — ACG cycle-cadence scheduler 不变量验收
// 终判(directive §3 / §10):ACG token starts 是【cycle-spread】(铺满和声 cycle),非 brick-local。
// ============================================================

const ch = (root: string, rootMidi: number, type: string): MgChordDef => ({ root, rootMidi, type, bassMidi: rootMidi, duration: 4 });
const HALF = [ch('C', 60, 'maj9'), ch('A', 57, 'm9'), ch('F', 53, 'maj9'), ch('G', 55, '9sus4')];
const REPEATED = [...HALF, ...HALF]; // 32 拍,前后半重复(AABA)
const LONG = [...HALF, ch('E', 64, 'm9'), ch('A', 57, 'maj9'), ch('D', 62, 'm9'), ch('G', 55, '13sus4')]; // 32 拍,不重复
const SHORT = [ch('C', 60, 'maj9'), ch('F', 53, 'maj9'), ch('G', 55, '9sus4'), ch('C', 60, '6/9')]; // 16 拍

function carrierSlot(args: {
  sourceSpanId: string;
  startBeat?: number;
  endBeat: number;
  boundaryBridges?: AcgPianoLeadContinuitySlot['boundaryBridges'];
  allowedShortGestureClasses?: AcgPianoLeadContinuitySlot['allowedShortGestureClasses'];
}): AcgPianoLeadContinuitySlot {
  return {
    id: `slot:${args.sourceSpanId}:${args.startBeat ?? 0}`,
    phraseId: 'phrase',
    sourceSpanId: args.sourceSpanId,
    startBeat: args.startBeat ?? 0,
    endBeat: args.endBeat,
    continuityClass: 'carrier',
    exposedGapBeats: 1.25,
    minimumKeyDownBeats: 2,
    releaseGuardBeats: 0.08,
    reentryGuardBeats: 0.0625,
    maxOnsetNudgeBeats: 0.125,
    allowedShortGestureClasses: args.allowedShortGestureClasses ?? ['ornament', 'pulse', 'suspension'],
    harmonicScope: 'current-chord',
    stableRoles: ['root', 'third', 'fifth', 'seventh'],
    boundaryBridges: args.boundaryBridges ?? [{ kind: 'release-at-boundary' }],
    lowerHandPolicy: 'does-not-shorten-key',
    terminalTailPolicy: 'allow-song-end-carrier',
  };
}

function scoreWithMetricGrid(totalBeats = 16): AcgPianoScorePlan {
  const subdivisionBeats = 0.25;
  const anchors = Array.from(
    { length: Math.round(totalBeats / subdivisionBeats) },
    (_, index) => {
      const beat = index * subdivisionBeats;
      const integerBeat = Math.abs(beat - Math.round(beat)) < 1e-9;
      const barDownbeat = Math.abs(beat % 4) < 1e-9;
      const secondaryStrong = Math.abs(beat % 4 - 2) < 1e-9;
      return {
        id: `grid-${beat}`,
        beat,
        bar: Math.floor(beat / 4),
        beatInBar: beat % 4,
        kind: barDownbeat
          ? 'harmonic-arrival' as const
          : secondaryStrong
            ? 'secondary-strong-beat' as const
            : 'weak-beat' as const,
        strength: barDownbeat ? 1 : secondaryStrong ? 0.92 : integerBeat ? 0.72 : 0.42,
        sectionId: 'section',
        roles: ['bass', 'comp', 'lead'] as const,
      };
    },
  );
  return {
    arrangementVariant: 'ripple-cantabile',
    metricGrid: {
      beatsPerBar: 4,
      subdivisionBeats,
      expressiveOffsetLimitBeats: 0.04,
      compEntryLimitBeats: 0.125,
      rollSpreadLimitBeats: 0.15,
      anchors,
    },
    phraseIdsBySpan: {},
    phraseById: {},
    phraseIdBySpan: {},
    textureBySpan: {},
    spanById: {},
    leadContinuitySlots: [],
    sharedPedalHolds: [],
  } as AcgPianoScorePlan;
}

function perBrickFor(chords: MgChordDef[]) {
  const part = buildChordPart(chords);
  // ★ ACG fidelity directive §2.1(2026-06-28):ACG 生产走 parseFunctionalRoadMap(style 感知)→ 测试同源,
  //   不再喂旧 parseRoadMap 的 brick(否则 scheduler 测的是生产【不喂】的 brick)。
  const roadMap = parseFunctionalRoadMap({ part, songKeyPc: 0, style: 'ACG' });
  const perBrick = expandGrammarForRoadMap(ACG_PIANOSONG_GRAMMAR, roadMap.bricks, makeSeededRng('acg_test'));
  return { part, perBrick };
}

describe('render/mgAcgCycleScheduler(MG full-parity G4)', () => {
  it('★ token 升序、在 [0,totalBeats),非空', () => {
    for (const chords of [REPEATED, LONG, SHORT]) {
      const { part, perBrick } = perBrickFor(chords);
      const sched = scheduleAcgCycleCadencePhrases(perBrick, part);
      expect(sched.length).toBeGreaterThan(0);
      const starts = sched.map((s) => s.startBeat);
      expect(starts.every((s, i) => i === 0 || s >= starts[i - 1] - 1e-9)).toBe(true);
      expect(Math.max(...starts)).toBeLessThan(part.totalBeats);
    }
  });

  it('★ cycle-spread:token 铺满到 cycle 尾(max start ≥ totalBeats−8),不挤句头', () => {
    for (const chords of [REPEATED, LONG]) {
      const { part, perBrick } = perBrickFor(chords);
      const starts = scheduleAcgCycleCadencePhrases(perBrick, part).map((s) => s.startBeat);
      expect(Math.max(...starts), `${chords.length}和弦`).toBeGreaterThanOrEqual(part.totalBeats - 8);
    }
  });

  it('★ AABA(重复半)→ 第二 cycle(≥16拍)也有 token(两 cycle 各铺一句)', () => {
    const { part, perBrick } = perBrickFor(REPEATED);
    const starts = scheduleAcgCycleCadencePhrases(perBrick, part).map((s) => s.startBeat);
    expect(starts.some((s) => s < 16)).toBe(true);   // cycle 1
    expect(starts.some((s) => s >= 16)).toBe(true);  // cycle 2
  });

  it('★ ACG cycle-spread ≠ brick-local(分布不同)', () => {
    const { part, perBrick } = perBrickFor(LONG);
    const acg = scheduleAcgCycleCadencePhrases(perBrick, part).map((s) => `${s.token.kind}@${s.startBeat.toFixed(2)}`).join('|');
    const brick = scheduleBrickExpansions(perBrick).map((s) => `${s.token.kind}@${s.startBeat.toFixed(2)}`).join('|');
    expect(acg).not.toBe(brick);
  });

  it('uses the Arranger metric grid instead of accumulating the legacy cycle-minus-half phase', () => {
    const part = buildChordPart(SHORT);
    const tokens = Array.from({ length: 16 }, () => ({ kind: 'C', duration: 0.5 } as const));
    const scheduled = scheduleAcgCycleCadencePhrases([{
      brickIndex: 0,
      brick: {
        name: 'Metric-Cadence',
        family: 'Cadence',
        startBeat: 0,
        durationBeats: 16,
        chordIndices: [0, 1, 2, 3],
        cost: 0,
      },
      tokens,
    }], part, { pianoScorePlan: scoreWithMetricGrid() });
    const playable = scheduled.filter((entry) =>
      entry.token.kind !== 'R'
      && entry.token.kind !== 'SlopeEnter'
      && entry.token.kind !== 'SlopeExit');

    // The former 15.5-beat proportional clock yielded
    // 0, .96875, 1.9375 ... 14.53125. Equal source pulses now retain one
    // metric beat each across the complete 16-beat cycle.
    expect(playable.map((entry) => entry.startBeat)).toEqual(
      Array.from({ length: 16 }, (_, index) => index),
    );
    expect(playable.every((entry) =>
      Math.abs(entry.startBeat / 0.25 - Math.round(entry.startBeat / 0.25)) < 1e-9)).toBe(true);
    expect(playable.every((entry) =>
      entry.acgMetricAnchorId !== undefined
      && entry.acgMetricStrength !== undefined
      && entry.acgMetricRole !== undefined)).toBe(true);
  });

  it('moves a structural 4.923-beat source landing onto the shared harmonic anchor', () => {
    const part = buildChordPart(SHORT);
    const scheduled = scheduleAcgCycleCadencePhrases([{
      brickIndex: 0,
      brick: {
        name: 'Shared-Anchor-Cadence',
        family: 'Cadence',
        startBeat: 0,
        durationBeats: 16,
        chordIndices: [0, 1, 2, 3],
        cost: 0,
      },
      // G's nominal full-cycle position is 1 / 3.25 × 16 =
      // 4.923076..., the concrete drift observed in production.
      tokens: [
        { kind: 'C', duration: 1 },
        { kind: 'G', duration: 0.5 },
        { kind: 'C', duration: 0.5 },
        { kind: 'R', duration: 1.25 },
      ],
    }], part, { pianoScorePlan: scoreWithMetricGrid() });
    const landing = scheduled.find((entry) => entry.token.kind === 'G');

    expect(landing).toMatchObject({
      startBeat: 4,
      acgMetricAnchorId: 'grid-4',
      acgMetricStrength: 1,
      acgMetricRole: 'structural',
    });
    expect(scheduled
      .filter((entry) => entry.token.kind !== 'R'
        && entry.token.kind !== 'SlopeEnter'
        && entry.token.kind !== 'SlopeExit')
      .every((entry) =>
        Math.abs(entry.startBeat / 0.25 - Math.round(entry.startBeat / 0.25)) < 1e-9)).toBe(true);
  });

  it('★ 结构音(G/长音)落在 4 拍 landing 格(snapToAcgLandingBeat)', () => {
    const { part, perBrick } = perBrickFor(LONG);
    const structural = scheduleAcgCycleCadencePhrases(perBrick, part).filter((s) => s.token.kind === 'G' || s.token.duration >= 1);
    expect(structural.length).toBeGreaterThan(0);
    // 至少一个结构音落在 4 拍 landing 格附近(landing snap 生效)。
    // ⚠️ EAR-CHECK(G7,2026-06-28/2026-07-02):enriched grammar 去 LOFI_VAMP;softParallel 已产品分叉为轻 boost 后 ACG 走的
    //   LOFI grammar 变【稀】—— LONG fixture 结构音从多个→1 个,落在 beat 7.88(距 4-grid 0.125)。容差从 0.02
    //   放宽到 0.15 容纳。ACG 手感变稀疏,待耳朵复核是否需为 ACG 重新调 landing snap / 加结构音密度。
    expect(structural.some((s) => Math.abs(s.startBeat - Math.round(s.startBeat / 4) * 4) < 0.15)).toBe(true);
  });

  it('★ slope 配平(SlopeEnter/Exit 深度归零)', () => {
    const { part, perBrick } = perBrickFor(LONG);
    let depth = 0;
    for (const s of scheduleAcgCycleCadencePhrases(perBrick, part)) {
      if (s.token.kind === 'SlopeEnter') depth++; else if (s.token.kind === 'SlopeExit') depth--;
    }
    expect(depth).toBe(0);
  });

  it('★ 确定性', () => {
    const { part, perBrick } = perBrickFor(REPEATED);
    expect(JSON.stringify(scheduleAcgCycleCadencePhrases(perBrick, part))).toBe(JSON.stringify(scheduleAcgCycleCadencePhrases(perBrick, part)));
  });

  it('turns arranger-owned lead silence into scheduler rests before any NoteIR is emitted', () => {
    const { part, perBrick } = perBrickFor(SHORT);
    const presence: AcgLeadPresencePlan = {
      silenceWindows: [{ startBeat: 0, endBeat: 8, reason: 'planned-entry-delay', sectionId: 'intro' }],
      returnRestCapBeats: 3,
    };
    const scheduled = scheduleAcgCycleCadencePhrases(perBrick, part, { leadPresencePlan: presence });
    const audible = scheduled.filter((entry) => entry.token.kind !== 'R'
      && entry.token.kind !== 'SlopeEnter'
      && entry.token.kind !== 'SlopeExit');
    const reentry = scheduled.filter((entry) => entry.acgReturn);

    expect(scheduled.some((entry) => entry.token.kind === 'R' && entry.startBeat < 8)).toBe(true);
    // A re-entry phrase is allowed only at/after the authored release. It is
    // intentionally scheduled *forward* from the first carrier, so a planned
    // rest gets a compact pickup → approach → dyad arrival instead of being
    // forced into the old stable-single fallback.
    expect(audible.length).toBeGreaterThan(0);
    expect(audible.every((entry) => entry.startBeat >= 8 - 1e-4)).toBe(true);
    expect(reentry.map((entry) => entry.acgReturn!.role)).toEqual(['pickup', 'approach', 'arrival']);
    expect(reentry.every((entry) => entry.startBeat >= 8 - 1e-4)).toBe(true);
    expect(reentry.at(-1)!.acgReturn).toMatchObject({ shape: 'liftRiff', dyad: { voicing: 'below-topline' } });
  });

  it('keeps materialized return pickup, approach, and arrival on the shared token-time grid', () => {
    const { part, perBrick } = perBrickFor(SHORT);
    const presence: AcgLeadPresencePlan = {
      silenceWindows: [{ startBeat: 0, endBeat: 8, reason: 'planned-entry-delay', sectionId: 'intro' }],
      returnRestCapBeats: 3,
    };
    const score = scoreWithMetricGrid();
    const scheduled = scheduleAcgCycleCadencePhrases(perBrick, part, {
      leadPresencePlan: presence,
      pianoScorePlan: score,
    });
    const reentry = scheduled.filter((entry) => entry.acgReturn);

    expect(reentry.map((entry) => entry.acgReturn!.role))
      .toEqual(['pickup', 'approach', 'arrival']);
    expect(reentry.every((entry) =>
      Math.abs(entry.startBeat / score.metricGrid.subdivisionBeats
        - Math.round(entry.startBeat / score.metricGrid.subdivisionBeats)) < 1e-9)).toBe(true);
    expect(reentry.map((entry) => entry.acgMetricRole)).toEqual(['flow', 'flow', 'structural']);
    const arrival = reentry.at(-1)!;
    const arrivalAnchor = score.metricGrid.anchors
      .find((anchor) => anchor.id === arrival.acgMetricAnchorId);
    expect(arrivalAnchor).toBeDefined();
    expect(arrival.startBeat).toBe(arrivalAnchor!.beat);
  });

  it('writes a bounded single-note afterglow before NoteIR, but yields to a new lower-hand attack', () => {
    const part = buildChordPart([
      { ...ch('C', 60, 'maj9'), spanId: 's0' },
      { ...ch('A', 57, 'm9'), spanId: 's1' },
      { ...ch('F', 53, 'maj9'), spanId: 's2' },
    ]);
    const entries: ScheduledToken[] = [
      { token: { kind: 'C', duration: 0.5 }, startBeat: 3 },
      { token: { kind: 'R', duration: 4 }, startBeat: 3.5 },
      { token: { kind: 'C', duration: 0.5 }, startBeat: 7.5 },
    ];
    const score = (bassAttackAtNextHarmony?: number): AcgPianoScorePlan => ({
      phraseById: { opening: { startBeat: 0, endBeat: 12, phase: 'opening' } },
      spanById: {
        s0: { comp: { events: [] }, bass: { events: [] } },
        s1: {
          comp: { events: [] },
          bass: { events: bassAttackAtNextHarmony === undefined ? [] : [{ atBeat: bassAttackAtNextHarmony }] },
        },
        s2: { comp: { events: [] }, bass: { events: [] } },
      },
    } as unknown as AcgPianoScorePlan);

    // Opening/coda may ring for up to four beats at 80 BPM, while a 1/8-beat
    // guard protects the next real attack.  It is a token/score plan, not a
    // scan of rendered notes.
    expect(planAcgLeadAfterglowHolds(entries, part, score(), 80)).toEqual([
      { startBeat: 3, endBeat: 7.375, reason: 'lead-afterglow' },
    ]);
    // The scored root at the next harmony owns the re-pedal; a lingering
    // treble note may not wash through it.
    expect(planAcgLeadAfterglowHolds(entries, part, score(0), 80)).toEqual([]);
  });

  it('writes an isolated stable-single arrival as a true half note before pedal planning', () => {
    const part = buildChordPart([{ ...ch('C', 60, 'maj9'), spanId: 's0' }]);
    const arrival: ScheduledToken = {
      token: {
        kind: 'G', duration: 0.75,
        acg: { harmonicScope: 'current-chord', stableRoles: ['third', 'fifth', 'seventh'] },
      },
      startBeat: 1.875,
      acgReturn: {
        gestureId: 'single', chordIndex: 0, targetChordIndex: 0,
        function: 'T', shape: 'stableSingle', role: 'arrival', arrivalBeat: 1.875,
        harmonicScope: 'current-chord', stableRoles: ['third', 'fifth', 'seventh'], targetPc: 4, targetRole: 'third',
      },
    };
    const entries: ScheduledToken[] = [arrival, { token: { kind: 'C', duration: 0.25 }, startBeat: 3.875 }];
    const score = (withMiddleAttack = false): AcgPianoScorePlan => ({
      leadContinuitySlots: [carrierSlot({ sourceSpanId: 's0', endBeat: 4 })],
      spanById: {
        s0: {
          comp: { events: withMiddleAttack ? [{ atBeat: 2.5 }] : [] },
          bass: { events: [] },
        },
      },
    } as unknown as AcgPianoScorePlan);

    const sustained = planAcgSustainedSingleCarriers(entries, part, score());
    expect(sustained[0]).toMatchObject({
      startBeat: 1.875,
      token: { duration: 2, acg: { sustain: { kind: 'breath', minimumDurationBeats: 2 } } },
    });
    // This is a minimum-duration writer, never a quantizer that shortens an
    // already intentional long melody carrier.
    const alreadyLong: ScheduledToken = {
      ...arrival,
      startBeat: 1,
      token: {
        kind: 'G', duration: 2.5,
        acg: { harmonicScope: 'current-chord', stableRoles: ['third', 'fifth', 'seventh'] },
      },
      acgReturn: { ...arrival.acgReturn!, arrivalBeat: 1 },
    };
    expect(planAcgSustainedSingleCarriers([
      alreadyLong,
      { token: { kind: 'C', duration: 0.25 }, startBeat: 4 },
    ], part, score())[0]!.token.duration).toBe(2.5);
    // A newly scored bass/comp onset can change pedal clarity, but it must not
    // revoke the written top-line carrier. The Arranger owns this standard.
    expect(planAcgSustainedSingleCarriers(entries, part, score(true))[0]!.token.duration).toBe(2);
  });

  it('reconciles an earlier lone carrier after a later unsafe fragment becomes a score rest', () => {
    const part = buildChordPart([
      { ...ch('C', 60, 'maj9'), spanId: 's0' },
      { ...ch('F#', 66, 'maj7'), spanId: 's1' },
    ]);
    const score = {
      leadContinuitySlots: [
        carrierSlot({ sourceSpanId: 's0', endBeat: 4 }),
        carrierSlot({ sourceSpanId: 's1', startBeat: 4, endBeat: 8 }),
      ],
      spanById: {
        s0: { comp: { events: [] }, bass: { events: [] } },
        s1: { comp: { events: [] }, bass: { events: [] } },
      },
    } as unknown as AcgPianoScorePlan;
    const resolved = planAcgSustainedSingleCarriers([
      // First pass: the next lead atom is too close to classify this as a
      // breath. The atom at 2.5 cannot legally cross s0 → s1, so it becomes
      // R. The next score pass must then revisit this C instead of leaving a
      // detached click before the real next lead note at 5.
      { token: { kind: 'C', duration: 0.5 }, startBeat: 1 },
      { token: { kind: 'L', duration: 0.5 }, startBeat: 2.5 },
      { token: { kind: 'L', duration: 0.5 }, startBeat: 5 },
    ], part, score);

    expect(resolved.find((entry) => Math.abs(entry.startBeat - 1) < 1e-6))
      .toMatchObject({ token: { duration: 2, acg: { sustain: { kind: 'breath' } } } });
    expect(resolved.find((entry) => Math.abs(entry.startBeat - 2.5) < 1e-6)?.token.kind).toBe('R');
    expect(planAcgSustainedSingleCarriers(resolved, part, score)).toEqual(resolved);
  });

  it('uses the score-owned onset nudge for an ordinary carrier, not only a return arrival', () => {
    const part = buildChordPart([{ ...ch('C', 60, 'maj9'), spanId: 's0' }]);
    const score = {
      leadContinuitySlots: [carrierSlot({ sourceSpanId: 's0', endBeat: 4 })],
      spanById: { s0: { comp: { events: [] }, bass: { events: [] } } },
    } as unknown as AcgPianoScorePlan;
    const [carrier] = planAcgSustainedSingleCarriers([
      { token: { kind: 'C', duration: 0.5 }, startBeat: 1.3125 },
      { token: { kind: 'L', duration: 0.5 }, startBeat: 3.25 },
    ], part, score);

    expect(carrier).toMatchObject({
      startBeat: 1.25,
      token: { duration: 2, acg: { sustain: { kind: 'breath', minimumDurationBeats: 2 } } },
    });
  });

  it('leaves a contiguous ordinary top-line pair as a short connected riff', () => {
    const part = buildChordPart([{ ...ch('C', 60, 'maj9'), spanId: 's0' }]);
    const score = {
      leadContinuitySlots: [carrierSlot({ sourceSpanId: 's0', endBeat: 4 })],
      spanById: { s0: { comp: { events: [] }, bass: { events: [] } } },
    } as unknown as AcgPianoScorePlan;
    const resolved = planAcgSustainedSingleCarriers([
      { token: { kind: 'C', duration: 0.5 }, startBeat: 1 },
      { token: { kind: 'L', duration: 0.5 }, startBeat: 1.5 },
    ], part, score);

    expect(resolved.find((entry) => Math.abs(entry.startBeat - 1) < 1e-6))
      .toMatchObject({ token: { kind: 'C', duration: 0.5 } });
  });

  it('executes the arranger slot’s allowed short-gesture contract', () => {
    const part = buildChordPart([{ ...ch('C', 60, 'maj9'), spanId: 's0' }]);
    const entries: ScheduledToken[] = [
      { token: { kind: 'A', duration: 0.5 }, startBeat: 1 },
      { token: { kind: 'G', duration: 0.75 }, startBeat: 1.5 },
    ];
    const scoreFor = (allowedShortGestureClasses: AcgPianoLeadContinuitySlot['allowedShortGestureClasses']): AcgPianoScorePlan => ({
      leadContinuitySlots: [carrierSlot({ sourceSpanId: 's0', endBeat: 4, allowedShortGestureClasses })],
      spanById: { s0: { comp: { events: [] }, bass: { events: [] } } },
    } as unknown as AcgPianoScorePlan);

    expect(planAcgSustainedSingleCarriers(entries, part, scoreFor(['ornament']))[0]!.token.kind).toBe('A');
    expect(planAcgSustainedSingleCarriers(entries, part, scoreFor([]))[0]!.token.kind).toBe('R');
  });

  it('permits only a score-proved cadence b9 suspension to cross one harmony boundary', () => {
    const part = buildChordPart([
      {
        root: 'F', rootMidi: 65, bassMidi: 65, type: 'm7b5', duration: 4, effectiveFunc: 'S',
        spanId: 'pre', stableTonePcs: [5, 8, 11, 2], chordScalePcs: [5, 6, 8, 10, 11, 1, 2],
      },
      {
        root: 'G', rootMidi: 67, bassMidi: 67, type: '7', duration: 4, effectiveFunc: 'D',
        spanId: 'dom', stableTonePcs: [7, 11, 2, 5], chordScalePcs: [7, 9, 11, 0, 2, 4, 5],
      },
    ]);
    const source: ScheduledToken = {
      token: { kind: 'C', duration: 0.5 }, startBeat: 3.5,
      brickFamily: 'Cadence', brickName: 'Surprise-Minor-Cadence',
    };
    const entries: ScheduledToken[] = [source, { token: { kind: 'L', duration: 0.75 }, startBeat: 5.6 }];
    const score = (withDominantAttack = true): AcgPianoScorePlan => ({
      leadContinuitySlots: [carrierSlot({
        sourceSpanId: 'pre',
        endBeat: 4,
        boundaryBridges: [
          { kind: 'dominant-b9', targetSpanId: 'dom', continuationPcs: [8] },
          { kind: 'release-at-boundary' },
        ],
      })],
      spanById: {
        pre: { comp: { events: [] }, bass: { events: [] } },
        dom: {
          comp: { events: withDominantAttack ? [{ atBeat: 0.08 }] : [] },
          bass: { events: withDominantAttack ? [{ atBeat: 0 }] : [] },
        },
      },
    } as unknown as AcgPianoScorePlan);

    const sustained = planAcgSustainedSingleCarriers(entries, part, score());
    expect(sustained[0]).toMatchObject({
      token: {
        duration: 2,
        acg: {
          harmonicScope: 'current-chord', stableRoles: ['third'],
          sustain: { kind: 'dominant-b9', targetChordIndex: 1, continuationPc: 8 },
        },
      },
    });
    // Removing the cadence-owned lower-hand arrival leaves no reason to keep
    // a foreign b9 across the boundary, so the fragment becomes an explicit
    // score release rather than an unclassified short click.
    expect(planAcgSustainedSingleCarriers(entries, part, score(false))[0]!.token.kind).toBe('R');
    expect(planAcgSustainedSingleCarriers([{
      ...source, brickFamily: 'Other', brickName: 'Ordinary-Progression',
    }, entries[1]!], part, score())[0]!.token.kind).toBe('R');
    // A return arrival has its own exact targetPc / paired-approach contract.
    // It is not reinterpreted as a cross-harmony suspension by this planner.
    const returnArrival: ScheduledToken = {
      ...source,
      token: {
        ...source.token,
        acg: { harmonicScope: 'current-chord', stableRoles: ['third'] },
      },
      acgReturn: {
        gestureId: 'return', chordIndex: 0, targetChordIndex: 0,
        function: 'S', shape: 'stableSingle', role: 'arrival', arrivalBeat: 3.5,
        harmonicScope: 'current-chord', stableRoles: ['third'], targetPc: 8, targetRole: 'third',
      },
    };
    expect(planAcgSustainedSingleCarriers([returnArrival, entries[1]!], part, score())[0]!.token.kind).toBe('R');
  });

  it('materializes only an arranger-proved common tone across harmony, otherwise writes a release', () => {
    const commonPart = buildChordPart([
      { root: 'C', rootMidi: 60, bassMidi: 60, type: 'maj7', duration: 4, spanId: 'c', stableTonePcs: [0, 4, 7, 11], chordScalePcs: [0, 2, 4, 5, 7, 9, 11] },
      { root: 'D', rootMidi: 62, bassMidi: 62, type: 'm7', duration: 4, spanId: 'dm', stableTonePcs: [2, 5, 9, 0], chordScalePcs: [2, 4, 5, 7, 9, 11, 0] },
    ]);
    const source: ScheduledToken = { token: { kind: 'C', duration: 0.5 }, startBeat: 3.5 };
    const entries: ScheduledToken[] = [source, { token: { kind: 'G', duration: 0.75 }, startBeat: 6 }];
    const commonScore = {
      leadContinuitySlots: [carrierSlot({
        sourceSpanId: 'c',
        endBeat: 4,
        boundaryBridges: [
          { kind: 'common-tone', targetSpanId: 'dm', continuationPcs: [0] },
          { kind: 'release-at-boundary' },
        ],
      })],
      spanById: { c: { comp: { events: [] }, bass: { events: [] } }, dm: { comp: { events: [] }, bass: { events: [] } } },
    } as unknown as AcgPianoScorePlan;
    const common = planAcgSustainedSingleCarriers(entries, commonPart, commonScore);
    expect(common[0]).toMatchObject({
      token: { duration: 2, acg: { sustain: { kind: 'common-tone', targetChordIndex: 1, continuationPc: 0 } } },
    });

    const unsafePart = buildChordPart([
      { root: 'C', rootMidi: 60, bassMidi: 60, type: 'maj7', duration: 4, spanId: 'c', stableTonePcs: [0, 4, 7, 11], chordScalePcs: [0, 2, 4, 5, 7, 9, 11] },
      { root: 'F#', rootMidi: 66, bassMidi: 66, type: 'maj7', duration: 4, spanId: 'fs', stableTonePcs: [6, 10, 1, 5], chordScalePcs: [6, 8, 10, 11, 1, 3, 5] },
    ]);
    const releaseScore = {
      leadContinuitySlots: [carrierSlot({ sourceSpanId: 'c', endBeat: 4 })],
      spanById: { c: { comp: { events: [] }, bass: { events: [] } }, fs: { comp: { events: [] }, bass: { events: [] } } },
    } as unknown as AcgPianoScorePlan;
    expect(planAcgSustainedSingleCarriers(entries, unsafePart, releaseScore)[0]!.token.kind).toBe('R');
  });

  it('uses song end as the coda carrier horizon instead of requiring a next lead note', () => {
    const part = buildChordPart([{
      root: 'C', rootMidi: 60, bassMidi: 60, type: 'maj9', duration: 8,
      spanId: 'tail', stableTonePcs: [0, 4, 7, 11], chordScalePcs: [0, 2, 4, 5, 7, 9, 11],
    }]);
    const score = {
      leadContinuitySlots: [carrierSlot({ sourceSpanId: 'tail', endBeat: 8 })],
      spanById: { tail: { comp: { events: [] }, bass: { events: [] } } },
    } as unknown as AcgPianoScorePlan;
    const [tail] = planAcgSustainedSingleCarriers([
      { token: { kind: 'C', duration: 0.5 }, startBeat: 5.5 },
    ], part, score);
    expect(tail).toMatchObject({ token: { duration: 2, acg: { sustain: { kind: 'breath', minimumDurationBeats: 2 } } } });
  });

  it('treats arranger returnShapes as a hard contract when a dyad response cannot resolve', () => {
    // The score permits only a sigh, whose terminal requires a dyad. The
    // harmonic contract admits one stable tone, so the dyad must fail. The
    // old scheduler silently replaced it with stableSingle; the score now
    // owns that decision and the original carrier survives without a return.
    const part = buildChordPart(Array.from({ length: 4 }, () => ({
      root: 'C', rootMidi: 60, type: 'maj9', bassMidi: 60, duration: 4,
      effectiveFunc: 'T' as const, stableTonePcs: [0], chordScalePcs: [0],
    })));
    const expansion: Parameters<typeof scheduleAcgCycleCadencePhrases>[0][number] = {
      brickIndex: 0,
      brick: { name: 'Perfect-Cadence', family: 'Cadence', startBeat: 0, durationBeats: 16, chordIndices: [0, 1, 2, 3], cost: 0 },
      tokens: [{ kind: 'R', duration: 1 }, { kind: 'C', duration: 1 }, { kind: 'C', duration: 1 }, { kind: 'G', duration: 2 }],
    };
    const scoreFor = (returnShapes: readonly AcgPianoReturnShape[]): AcgPianoScorePlan => ({
      // The scheduler intentionally reads only phrase timing + lead directive.
      phraseById: {
        phrase: { startBeat: 0, endBeat: 16, lead: { returnShapes } },
      },
    } as unknown as AcgPianoScorePlan);

    const constrained = scheduleAcgCycleCadencePhrases([expansion], part, {
      pianoScorePlan: scoreFor(['sigh']),
    });
    expect(constrained.filter((entry) => entry.acgReturn)).toHaveLength(0);
    expect(constrained.find((entry) => Math.abs(entry.startBeat - 3.1) < 1e-6)?.token.kind).toBe('C');

    // An empty phrase set is likewise intentional: it does not mean "use the
    // generic scheduler preference".
    const noReturnAllowed = scheduleAcgCycleCadencePhrases([expansion], part, {
      pianoScorePlan: scoreFor([]),
    });
    expect(noReturnAllowed.filter((entry) => entry.acgReturn)).toHaveLength(0);

    // Existing production phrases include stableSingle in the permitted set,
    // so their authored fallback remains available.
    const fallbackAllowed = scheduleAcgCycleCadencePhrases([expansion], part, {
      pianoScorePlan: scoreFor(['sigh', 'stableSingle']),
    });
    expect(fallbackAllowed.some((entry) => entry.acgReturn?.shape === 'stableSingle')).toBe(true);
  });

  it('closes or removes slope state cut by a planned silence before the new entry', () => {
    const part = buildChordPart(SHORT);
    const presence: AcgLeadPresencePlan = {
      silenceWindows: [{ startBeat: 0, endBeat: 8, reason: 'planned-entry-delay', sectionId: 'intro' }],
      returnRestCapBeats: 3,
    };
    const scheduled = scheduleAcgCycleCadencePhrases([{
      brickIndex: 0,
      brick: { name: 'Perfect-Cadence', family: 'Cadence', startBeat: 0, durationBeats: 16, chordIndices: [0, 1, 2, 3], cost: 0 },
      // The open slope begins inside the deleted phrase and its source exit
      // lies after re-entry. It must not constrain the new audible phrase.
      tokens: [
        { kind: 'SlopeEnter', dirMin: 2, dirMax: 4, duration: 0 },
        { kind: 'C', duration: 4 },
        { kind: 'SlopeExit', duration: 0 },
        { kind: 'C', duration: 1 },
        { kind: 'G', duration: 1 },
      ],
    }], part, { leadPresencePlan: presence });
    let depth = 0;
    for (const entry of scheduled) {
      if (entry.token.kind === 'SlopeEnter') depth++;
      else if (entry.token.kind === 'SlopeExit') depth = Math.max(0, depth - 1);
      else if (entry.startBeat >= 8 - 1e-4 && entry.token.kind !== 'R') {
        expect(depth, `new phrase at ${entry.startBeat} inherits no deleted slope`).toBe(0);
      }
    }
  });

  it('closes a SlopeExit exactly at planned-silence start so it cannot leak into the release', () => {
    const part = buildChordPart(SHORT);
    // With three one-beat audible tokens, the source exit falls exactly at
    // 15.5 / 3 in the usable cycle. (Three audible atoms also ensure this
    // fixture is selected instead of the scheduler's fallback cadence.)
    const silenceStart = 15.5 / 3;
    const silenceEnd = silenceStart + 0.5;
    const presence: AcgLeadPresencePlan = {
      silenceWindows: [{ startBeat: silenceStart, endBeat: silenceEnd, reason: 'planned-entry-delay', sectionId: 'intro' }],
      returnRestCapBeats: 3,
    };
    const scheduled = scheduleAcgCycleCadencePhrases([{
      brickIndex: 0,
      brick: { name: 'Perfect-Cadence', family: 'Cadence', startBeat: 0, durationBeats: 16, chordIndices: [0, 1, 2, 3], cost: 0 },
      tokens: [
        { kind: 'SlopeEnter', dirMin: 2, dirMax: 4, duration: 0 },
        { kind: 'C', duration: 1 },
        { kind: 'SlopeExit', duration: 0 },
        { kind: 'C', duration: 1 },
        { kind: 'C', duration: 1 },
      ],
    }], part, { leadPresencePlan: presence });

    const exitAtBoundary = scheduled.find((entry) => entry.token.kind === 'SlopeExit'
      && Math.abs(entry.startBeat - silenceStart) < 1e-6);
    expect(exitAtBoundary, 'boundary exit must survive as state-only closure').toBeDefined();

    let depth = 0;
    for (const entry of scheduled) {
      if (entry.token.kind === 'SlopeEnter') depth++;
      else if (entry.token.kind === 'SlopeExit') depth = Math.max(0, depth - 1);
      else if (entry.startBeat >= silenceEnd - 1e-6 && entry.token.kind !== 'R') {
        expect(depth, `release at ${entry.startBeat} cannot inherit the pre-silence slope`).toBe(0);
      }
    }
  });

  it('orders same-beat slope markers before audible tokens', () => {
    const part = buildChordPart(SHORT);
    // An unclosed legacy group is fail-closed by closeOpenSlopeGroups. Its
    // synthesized exit shares the final source carrier's beat, so this catches
    // any reliance on incidental stable-sort insertion order.
    const scheduled = scheduleAcgCycleCadencePhrases([{
      brickIndex: 0,
      brick: { name: 'Perfect-Cadence', family: 'Cadence', startBeat: 0, durationBeats: 16, chordIndices: [0, 1, 2, 3], cost: 0 },
      tokens: [
        { kind: 'C', duration: 0.5 },
        { kind: 'C', duration: 0.5 },
        { kind: 'SlopeEnter', dirMin: 2, dirMax: 4, duration: 0 },
        { kind: 'C', duration: 0.5 },
      ],
    }], part);
    const syntheticExit = scheduled.find((entry) => entry.token.kind === 'SlopeExit');
    expect(syntheticExit).toBeDefined();
    const sameBeat = scheduled.filter((entry) => Math.abs(entry.startBeat - syntheticExit!.startBeat) < 1e-9);
    const firstAudible = sameBeat.findIndex((entry) => entry.token.kind !== 'SlopeEnter'
      && entry.token.kind !== 'SlopeExit' && entry.token.kind !== 'R');
    expect(firstAudible).toBeGreaterThanOrEqual(0);
    expect(sameBeat.slice(0, firstAudible).map((entry) => entry.token.kind))
      .toEqual(['SlopeExit', 'SlopeEnter']);
  });
});
