import { describe, expect, it } from 'vitest';
import type {
  AcgPianoCompEvent,
  AcgPianoMetricAnchor,
  AcgPianoScorePlan,
} from '../arranger/acgPianoScorePlan';
import {
  buildSongBundle,
  generateSongFromBundle,
  type SongBundle,
} from '../generation/GenerationController';

const SCORE_SEEDS = [0, 1, 3, 7, 11, 19, 42] as const;
const FINAL_IR_SEEDS = [0, 1, 7, 19] as const;
const EPSILON = 1e-6;

type PianoRole = 'bass' | 'comp' | 'lead';

function acgBundle(seed: number): SongBundle {
  return buildSongBundle({
    seed,
    styleHint: 'acg',
    mood: 'lyrical',
    targetDuration: 90,
  });
}

function scoreOf(bundle: SongBundle): AcgPianoScorePlan {
  const score = bundle.acgPianoScorePlan;
  expect(score, 'production ACG must publish PianoScorePlan.metricGrid before rendering').toBeDefined();
  if (!score) throw new Error('missing ACG PianoScorePlan');
  return score;
}

function distanceToGrid(beat: number, subdivision: number): number {
  return Math.abs(beat - Math.round(beat / subdivision) * subdivision);
}

function maximumVoiceCount(
  event: AcgPianoCompEvent,
  scoreSpan: AcgPianoScorePlan['spanById'][string],
): number {
  if (event.voices === 'all') return scoreSpan.comp.maxVoices;
  if (event.voices === 'lower-dyad' || event.voices === 'upper-dyad') return 2;
  return 1;
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function startsInBeats(
  bundle: SongBundle,
  role: PianoRole,
  ir: NonNullable<ReturnType<typeof generateSongFromBundle>['ir']>,
): number[] {
  const track = ir.tracks.find((candidate) => candidate.role === role);
  expect(track, `${role} track`).toBeDefined();
  return uniqueSorted((track?.notes ?? []).map((note) => (note.startTick as number) / (bundle.timebase.ppq as number)));
}

function nearestStart(starts: readonly number[], beat: number): number | undefined {
  let nearest: number | undefined;
  let distance = Infinity;
  for (const candidate of starts) {
    const nextDistance = Math.abs(candidate - beat);
    if (nextDistance < distance) {
      nearest = candidate;
      distance = nextDistance;
    }
  }
  return nearest;
}

describe('render/acgMetricAlignmentRegression · one shared piano clock', () => {
  it('publishes a .25-beat metric grid and binds only structural BASS/COMP attacks to a tight anchor budget', () => {
    let sharedStructuralAnchors = 0;
    let expressiveEvents = 0;

    for (const seed of SCORE_SEEDS) {
      const bundle = acgBundle(seed);
      const score = scoreOf(bundle);
      const grid = score.metricGrid;
      const anchors = new Map(grid.anchors.map((anchor) => [anchor.id, anchor]));
      const harmonicById = new Map(bundle.harmonic.chordTimeline.map((span) => [span.id, span]));

      expect(grid.beatsPerBar).toBeGreaterThan(0);
      expect(grid.subdivisionBeats, `seed ${seed} shared onset subdivision`).toBeCloseTo(0.25, 8);
      expect(grid.expressiveOffsetLimitBeats).toBeLessThanOrEqual(0.08 + EPSILON);
      expect(grid.compEntryLimitBeats).toBeLessThanOrEqual(0.125 + EPSILON);
      expect(grid.rollSpreadLimitBeats).toBeLessThanOrEqual(0.15 + EPSILON);
      expect(grid.anchors.length).toBeGreaterThan(0);
      expect(new Set(grid.anchors.map((anchor) => anchor.id)).size).toBe(grid.anchors.length);

      for (const anchor of grid.anchors) {
        expect(distanceToGrid(anchor.beat, grid.subdivisionBeats), `${anchor.id} lies on shared subdivision`)
          .toBeLessThanOrEqual(EPSILON);
        expect(anchor.strength).toBeGreaterThanOrEqual(0);
        expect(anchor.strength).toBeLessThanOrEqual(1);
        expect(anchor.roles.length).toBeGreaterThan(0);
      }

      const linkedByAnchor = new Map<string, { bass: number[]; comp: number[] }>();
      for (const scoreSpan of Object.values(score.spanById)) {
        const harmonic = harmonicById.get(scoreSpan.spanId);
        expect(harmonic, `seed ${seed} ${scoreSpan.spanId} harmonic owner`).toBeDefined();
        if (!harmonic) continue;
        const spanStart = harmonic.startBeat as number;

        for (const event of scoreSpan.bass.events) {
          expect(event.metricAnchorId, `seed ${seed} ${scoreSpan.spanId} BASS metricAnchorId`).toBeDefined();
          expect(event.metricRole, `seed ${seed} ${scoreSpan.spanId} BASS metricRole`).toBeDefined();
          const anchor = anchors.get(event.metricAnchorId!);
          expect(anchor, `seed ${seed} ${scoreSpan.spanId} BASS anchor exists`).toBeDefined();
          if (!anchor) continue;
          const onset = spanStart + event.atBeat;
          expect(onset - anchor.beat).toBeCloseTo(event.metricOffsetBeats ?? Number.NaN, 6);
          expect(anchor.roles).toContain('bass');
          if (event.metricRole === 'structural') {
            expect(event.voice).toBe('root');
            expect(Math.abs(event.metricOffsetBeats ?? Infinity), 'structural root is the shared clock').toBeLessThanOrEqual(EPSILON);
            const linked = linkedByAnchor.get(anchor.id) ?? { bass: [], comp: [] };
            linked.bass.push(onset);
            linkedByAnchor.set(anchor.id, linked);
          } else {
            expressiveEvents += 1;
          }
        }

        for (const event of scoreSpan.comp.events) {
          expect(event.metricAnchorId, `seed ${seed} ${event.id} COMP metricAnchorId`).toBeDefined();
          expect(event.metricRole, `seed ${seed} ${event.id} COMP metricRole`).toBeDefined();
          const anchor = anchors.get(event.metricAnchorId!);
          expect(anchor, `seed ${seed} ${event.id} COMP anchor exists`).toBeDefined();
          if (!anchor) continue;
          const onset = spanStart + event.atBeat;
          expect(onset - anchor.beat).toBeCloseTo(event.metricOffsetBeats ?? Number.NaN, 6);
          expect(anchor.roles).toContain('comp');
          if (event.metricRole === 'structural') {
            expect(Math.abs(event.metricOffsetBeats ?? Infinity), `${event.id} structural COMP entry`)
              .toBeLessThanOrEqual(grid.compEntryLimitBeats + EPSILON);
            const linked = linkedByAnchor.get(anchor.id) ?? { bass: [], comp: [] };
            linked.comp.push(onset);
            linkedByAnchor.set(anchor.id, linked);
          } else {
            // Flow, pickup and answer are deliberately not forced onto a
            // strong beat. They retain their semantic role and only consume
            // the shared subdivision clock.
            expressiveEvents += 1;
          }
          if (event.role === 'arrival') expect(event.metricRole).toBe('structural');
        }
      }

      for (const [anchorId, linked] of linkedByAnchor) {
        if (linked.bass.length === 0 || linked.comp.length === 0) continue;
        const skew = Math.min(...linked.bass.flatMap((bass) => linked.comp.map((comp) => Math.abs(comp - bass))));
        expect(skew, `seed ${seed} ${anchorId} BASS/COMP structural flam`)
          .toBeLessThanOrEqual(grid.compEntryLimitBeats + EPSILON);
        sharedStructuralAnchors += 1;
      }
    }

    expect(sharedStructuralAnchors, 'seed sweep must exercise shared BASS/COMP structural anchors').toBeGreaterThan(8);
    expect(expressiveEvents, 'contract must retain flow/answer/underlay material').toBeGreaterThan(0);
  });

  it('keeps production FinalIR BASS/LEAD on the shared subdivision and structural three-hand attacks inside the declared anchor budget', () => {
    let finalStructuralPairs = 0;
    let actualLeadLandings = 0;

    for (const seed of FINAL_IR_SEEDS) {
      const bundle = acgBundle(seed);
      const score = scoreOf(bundle);
      const result = generateSongFromBundle(bundle);
      expect(result.ir, `seed ${seed} FinalIR`).toBeDefined();
      if (!result.ir) continue;

      const starts = {
        bass: startsInBeats(bundle, 'bass', result.ir),
        comp: startsInBeats(bundle, 'comp', result.ir),
        lead: startsInBeats(bundle, 'lead', result.ir),
      };
      const oneTick = 1 / (bundle.timebase.ppq as number);
      for (const role of ['bass', 'lead'] as const) {
        for (const onset of starts[role]) {
          expect(distanceToGrid(onset, score.metricGrid.subdivisionBeats), `seed ${seed} FinalIR ${role}@${onset}`)
            .toBeLessThanOrEqual(oneTick + EPSILON);
        }
      }

      const anchors = new Map(score.metricGrid.anchors.map((anchor) => [anchor.id, anchor]));
      const harmonicById = new Map(bundle.harmonic.chordTimeline.map((span) => [span.id, span]));
      const linked = new Map<string, { anchor: AcgPianoMetricAnchor; bass?: number; comp?: number }>();
      for (const scoreSpan of Object.values(score.spanById)) {
        const harmonic = harmonicById.get(scoreSpan.spanId);
        if (!harmonic) continue;
        const spanStart = harmonic.startBeat as number;
        for (const event of scoreSpan.bass.events.filter((candidate) => candidate.metricRole === 'structural')) {
          const anchor = anchors.get(event.metricAnchorId ?? '');
          const rendered = nearestStart(starts.bass, spanStart + event.atBeat);
          expect(rendered).toBeDefined();
          expect(Math.abs((rendered ?? Infinity) - (spanStart + event.atBeat))).toBeLessThanOrEqual(oneTick + EPSILON);
          if (anchor) linked.set(anchor.id, { ...(linked.get(anchor.id) ?? { anchor }), bass: rendered });
        }
        for (const event of scoreSpan.comp.events.filter((candidate) => candidate.metricRole === 'structural')) {
          const anchor = anchors.get(event.metricAnchorId ?? '');
          const rendered = nearestStart(starts.comp, spanStart + event.atBeat);
          expect(rendered).toBeDefined();
          expect(Math.abs((rendered ?? Infinity) - (spanStart + event.atBeat))).toBeLessThanOrEqual(oneTick + EPSILON);
          if (anchor) linked.set(anchor.id, { ...(linked.get(anchor.id) ?? { anchor }), comp: rendered });
        }
      }

      for (const { anchor, bass, comp } of linked.values()) {
        if (bass === undefined || comp === undefined) continue;
        expect(Math.abs(comp - bass), `seed ${seed} FinalIR BASS/COMP @ ${anchor.id}`)
          .toBeLessThanOrEqual(score.metricGrid.compEntryLimitBeats + oneTick);
        finalStructuralPairs += 1;

        // roles grants permission, not a mandatory attack. Only an actually
        // present top-line landing is measured; authored breaths remain valid.
        const lead = nearestStart(starts.lead, anchor.beat);
        if (lead === undefined || Math.abs(lead - anchor.beat) > score.metricGrid.expressiveOffsetLimitBeats + oneTick) continue;
        expect(Math.max(bass, comp, lead) - Math.min(bass, comp, lead), `seed ${seed} FinalIR three-hand anchor ${anchor.id}`)
          .toBeLessThanOrEqual(score.metricGrid.compEntryLimitBeats + oneTick);
        actualLeadLandings += 1;
      }
    }

    expect(finalStructuralPairs, 'FinalIR seed sweep must render shared lower/middle anchors').toBeGreaterThan(4);
    expect(actualLeadLandings, 'FinalIR seed sweep must include real top-line structural landings').toBeGreaterThan(0);
  });

  it('keeps every observable production roll cluster inside the total-spread budget, not a per-voice budget', () => {
    let multiVoiceRolls = 0;

    for (const seed of FINAL_IR_SEEDS) {
      const bundle = acgBundle(seed);
      const score = scoreOf(bundle);
      const result = generateSongFromBundle(bundle);
      expect(result.ir, `seed ${seed} FinalIR`).toBeDefined();
      if (!result.ir) continue;
      const compStarts = startsInBeats(bundle, 'comp', result.ir);
      const harmonicById = new Map(bundle.harmonic.chordTimeline.map((span) => [span.id, span]));
      const oneTick = 1 / (bundle.timebase.ppq as number);

      for (const scoreSpan of Object.values(score.spanById)) {
        const harmonic = harmonicById.get(scoreSpan.spanId);
        if (!harmonic) continue;
        const spanStart = harmonic.startBeat as number;
        const events = [...scoreSpan.comp.events].sort((left, right) => left.atBeat - right.atBeat);
        for (let index = 0; index < events.length; index++) {
          const event = events[index]!;
          if (event.attack === 'simultaneous') continue;
          const voiceCount = maximumVoiceCount(event, scoreSpan);
          if (voiceCount <= 1) continue;
          const start = spanStart + event.atBeat;
          const nextEventStart = events[index + 1]
            ? spanStart + events[index + 1]!.atBeat
            : spanStart + (harmonic.durationBeats as number);
          const legacyHorizon = scoreSpan.comp.rollStepBeats * Math.max(1, voiceCount - 1);
          const horizon = Math.min(
            nextEventStart - oneTick,
            start + Math.max(legacyHorizon, score.metricGrid.rollSpreadLimitBeats) + oneTick,
          );
          const cluster = compStarts
            .filter((beat) => beat >= start - oneTick && beat <= horizon + EPSILON)
            .slice(0, voiceCount);
          // A target-harmony terminal may be coalesced with the target span's
          // own arrival. It remains valid score metadata but no longer has a
          // separately observable FinalIR onset cluster.
          if (cluster.length === 0) continue;
          if (cluster.length < 2) continue;
          expect(cluster.at(-1)! - cluster[0]!, `seed ${seed} ${event.id} complete roll spread`)
            .toBeLessThanOrEqual(score.metricGrid.rollSpreadLimitBeats + oneTick);
          multiVoiceRolls += 1;
        }
      }
    }

    expect(multiVoiceRolls, 'seed sweep must observe rendered multi-voice rolls').toBeGreaterThan(4);
  });
});
