import { describe, expect, it } from 'vitest';
import { pc } from '../foundation';
import {
  buildSongBundle,
  generateSongFromBundle,
} from '../generation/GenerationController';
import {
  DRUM,
  lofiAuxiliaryTopLoopById,
  lofiDrumPhrases,
  type DrumHit,
} from '../knowledge/grooves';
import { createRandomContext } from '../foundation';
import { planLofiFoundation } from '../arranger/lofiFoundationPlanner';
import {
  listProgressionPrototypes,
  pickProgressionPrototypeWithPolicy,
  progressionPrototypeById,
} from '../knowledge/progressions';

const CORPUS_DERIVED_LOFI_IDS = [
  'lofi_major_plagal_descent_2',
  'lofi_major_whole_step_planing_4',
  'lofi_major_parallel_minor_fall_4',
  'lofi_minor_turnaround_4',
  'lofi_minor_aeolian_ebb_8',
  'lofi_minor_late_cadence_4',
  'lofi_minor_third_bass_vamp_4',
] as const;

const SNARES = new Set<number>([DRUM.SIDESTICK, DRUM.SNARE, DRUM.CLAP, 40]);

function structuralBarSignature(hits: readonly DrumHit[]): string {
  return hits
    .map((hit) => `${hit.drum}@${hit.beat.toFixed(3)}`)
    .sort()
    .join('|');
}

function minimalPeriod(values: readonly string[]): number {
  if (values.length === 0) return 0;
  for (let period = 1; period <= values.length; period++) {
    if (values.every((value, index) => value === values[index % period])) return period;
  }
  return values.length;
}

function hasSnareAt(hits: readonly DrumHit[], beat: number): boolean {
  return hits.some((hit) => SNARES.has(hit.drum) && Math.abs(hit.beat - beat) < 1e-6);
}

describe('LOFI Hip Hop arrangement hard gates', () => {
  it('selects no LOFI plan for other styles and reproduces the complete plan/final notes for one seed', () => {
    const request = {
      seed: 73,
      styleHint: 'lofi',
      mood: 'build',
      targetDuration: 120,
      key: pc(0),
    } as const;
    const first = buildSongBundle(request);
    const second = buildSongBundle(request);
    expect(second.arrangement.lofiFoundationPlan).toEqual(first.arrangement.lofiFoundationPlan);
    expect(second.arrangement.grooveScorePlan).toEqual(first.arrangement.grooveScorePlan);
    expect(second.harmonic).toEqual(first.harmonic);
    const firstResult = generateSongFromBundle(first);
    const secondResult = generateSongFromBundle(second);
    expect(firstResult.status).not.toBe('failed');
    expect(secondResult.status).not.toBe('failed');
    expect(secondResult.ir?.tracks.map((track) => ({ role: track.role, notes: track.notes })))
      .toEqual(firstResult.ir?.tracks.map((track) => ({ role: track.role, notes: track.notes })));

    const pop = buildSongBundle({ ...request, styleHint: 'pop' });
    expect(pop.arrangement.lofiFoundationPlan).toBeUndefined();
  });

  it('KB exposes sixteen indivisible two-bar Boom-bap/Dilla/half-time phrases with legal backbeats', () => {
    const phrases = [
      ...lofiDrumPhrases('tr808-lofi-boombap'),
      ...lofiDrumPhrases('tr808-lofi-dusty-break'),
      ...lofiDrumPhrases('tr808-lofi-soul-halftime'),
    ];
    expect(phrases).toHaveLength(16);
    expect(new Set(phrases.map((phrase) => phrase.id)).size).toBe(16);
    expect(new Set(phrases.map((phrase) => phrase.family))).toEqual(new Set([
      'slow-boombap',
      'dusty-dilla-boombap',
      'slow-soul-halftime',
    ]));

    for (const phrase of phrases) {
      expect(phrase.bars).toHaveLength(2);
      for (const bar of [...phrase.bars, phrase.turnaroundBar]) {
        expect(bar.some((hit) => hit.drum === DRUM.KICK && hit.beat === 0), phrase.id).toBe(true);
        if (phrase.backbeatMode === 'two-four') {
          expect(hasSnareAt(bar, 1), `${phrase.id}: beat 2`).toBe(true);
          expect(hasSnareAt(bar, 3), `${phrase.id}: beat 4`).toBe(true);
        } else {
          expect(hasSnareAt(bar, 2), `${phrase.id}: half-time beat 3`).toBe(true);
        }
      }
    }
  });

  it('Clark-derived grammars are ordinary reachable candidates in the complete LOFI pool, not Foundation-forced identities', () => {
    const selected = new Set<string>();
    const poolIds = new Set(listProgressionPrototypes({ style: 'LOFI' }).map((prototype) => prototype.id));
    for (const mode of ['major', 'minor'] as const) {
      for (let seed = 0; seed < 4096; seed++) {
        const picked = pickProgressionPrototypeWithPolicy({
          style: 'LOFI',
          mode: mode === 'minor' ? 'Minor' : 'Major',
          functionRole: 'loop',
          bars: 16,
          beatsPerBar: 4,
          random: createRandomContext(seed).substream('harmony'),
        });
        expect(picked).not.toBeNull();
        selected.add(picked!.prototypeId);
      }
    }
    for (const id of CORPUS_DERIVED_LOFI_IDS) {
      expect(poolIds.has(id), id).toBe(true);
      expect(selected.has(id), id).toBe(true);
      expect(progressionPrototypeById(id), id).toMatchObject({ id, style: 'LOFI' });
    }
    expect(selected.size).toBeGreaterThan(CORPUS_DERIVED_LOFI_IDS.length);

    const foundation = planLofiFoundation({
      style: 'lofi',
      mode: 'major',
      rng: createRandomContext(73),
    })!;
    expect(foundation.harmonyPoolId).toBe('lofi-progression-pool:major');
    expect(foundation).not.toHaveProperty('harmonicLoopId');
  }, 20_000);

  it('64 seeds keep one song-level phrase, repeat at least 75% of main-loop bars and preserve Lead rests', () => {
    const phraseIds = new Set<string>();
    const families = new Set<string>();

    for (let seed = 0; seed < 64; seed++) {
      const bundle = buildSongBundle({
        seed,
        styleHint: 'lofi',
        mood: 'build',
        targetDuration: 120,
        key: pc(0),
      });
      const { arrangement, instrumentation } = bundle;
      const foundation = arrangement.lofiFoundationPlan;
      expect(foundation, `seed ${seed}`).toBeDefined();
      const loops = arrangement.sections.filter((section) => section.functionTag === 'loop');
      const bars = loops.flatMap((section) => arrangement.grooveScorePlan.bySection[section.id].bars);
      const patterns = loops.flatMap((section) => instrumentation.drumPatternBySectionBar[section.id]);
      expect(patterns).toHaveLength(bars.length);
      expect(bars.length).toBeGreaterThanOrEqual(8);

      const ids = new Set(bars.map((bar) => bar.drumPhraseId));
      expect(ids.size, `seed ${seed}`).toBe(1);
      const phraseId = bars[0].drumPhraseId;
      expect(phraseId, `seed ${seed}`).toBeTruthy();
      expect(phraseId, `seed ${seed}`).toBe(foundation!.drumPhraseId);
      expect(arrangement.songGrooveContractId, `seed ${seed}`).toBe(foundation!.grooveContractId);
      expect(foundation!.harmonyPoolId, `seed ${seed}`)
        .toBe(`lofi-progression-pool:${bundle.band.mode}`);
      phraseIds.add(phraseId!);
      families.add(arrangement.drumPerformanceBySection[loops[0].id].patternFamily);

      const loopAbsoluteBars = new Set(bars.map((bar) => bar.absoluteBar));
      const mutationBars = new Set(bars
        .filter((bar) => bar.structuralMutation)
        .map((bar) => bar.absoluteBar));
      for (const boundary of arrangement.grooveScorePlan.boundaries) {
        if (loopAbsoluteBars.has(boundary.sourceBar)) mutationBars.add(boundary.sourceBar);
      }
      const coreCoverage = 1 - mutationBars.size / bars.length;
      expect(coreCoverage, `seed ${seed}`).toBeGreaterThanOrEqual(0.75);
      expect(mutationBars.size / bars.length, `seed ${seed}`).toBeLessThanOrEqual(0.25);

      const uniqueRatio = new Set(patterns.map(structuralBarSignature)).size / patterns.length;
      expect(uniqueRatio, `seed ${seed}`).toBeLessThanOrEqual(0.35);

      const phrase = lofiDrumPhrases(
        arrangement.songGrooveContract.drum?.timekeeperFamily,
      ).find((candidate) => candidate.id === phraseId)!;
      for (const bar of bars) {
        expect(bar.drumTopLoopId, `seed ${seed}`).toBe(foundation!.topLoopId);
        if (foundation!.topLoopId) {
          expect(lofiAuxiliaryTopLoopById(bar.drumTopLoopId), `seed ${seed}`).toBeDefined();
          expect(bar.drumTopLoopBarIndex, `seed ${seed}`).toBe(bar.absoluteBar % 4);
        }
      }
      expect(arrangement.grooveScorePlan.boundaries, `seed ${seed}`).toHaveLength(0);
      for (const pattern of patterns) {
        if (phrase.backbeatMode === 'two-four') {
          expect(hasSnareAt(pattern, 1), `seed ${seed}: beat 2`).toBe(true);
          expect(hasSnareAt(pattern, 3), `seed ${seed}: beat 4`).toBe(true);
        } else {
          expect(hasSnareAt(pattern, 2), `seed ${seed}: half-time beat 3`).toBe(true);
        }
      }

      const presence = arrangement.lofiLeadPresencePlan!;
      const interaction = arrangement.lofiPhraseInteractionPlan!;
      expect(interaction, `seed ${seed}`).toBeDefined();
      expect(interaction.pocket).toMatchObject({
        kickAnchorMs: 0,
        snareDragMs: 20,
        hatOnbeatMs: 1,
        hatOffbeatMs: 10,
      });
      const active = loops.flatMap((section) => presence.activeBarsBySection[section.id]);
      const coverage = active.length / bars.length;
      expect(coverage, `seed ${seed}`).toBeGreaterThanOrEqual(0.25);
      expect(coverage, `seed ${seed}`).toBeLessThanOrEqual(0.45);
      if (bars.length >= 16) {
        expect(presence.silenceWindows.some((window) =>
          window.endBarInSection - window.startBarInSection >= 4), `seed ${seed}`).toBe(true);
      }
      for (const section of loops) {
        const cues = interaction.bySection[section.id];
        for (const barInSection of presence.activeBarsBySection[section.id]) {
          const cue = cues[barInSection];
          expect(cue.leadRole, `seed ${seed}/${section.id}/${barInSection}`)
            .not.toBe('rest');
          if (barInSection % 8 === 4) expect(cue.leadRole).toBe('statement');
          if (barInSection % 8 === 5) expect(cue.leadRole).toBe('variation');
          if (barInSection % 8 === 7) expect(cue.leadRole).toBe('return');
        }
        for (const cue of cues.filter((candidate) => candidate.compRole === 'answer')) {
          expect(cue.leadRole).toBe('rest');
          expect(cue.drumRole).toBe('answer');
          expect(cue.tensionIntent).toBe('open');
          expect(arrangement.grooveScorePlan.bySection[section.id].bars[cue.barInSection].drumPhraseRole)
            .toBe('turnaround');
        }
        for (const bar of arrangement.grooveScorePlan.bySection[section.id].bars
          .filter((candidate) => candidate.structuralMutation)) {
          expect(bar.lofiPhraseInteraction?.drumRole).toBe('answer');
          expect(bar.lofiPhraseInteraction?.leadRole).toBe('rest');
        }
      }
    }

    expect(families).toEqual(new Set([
      'tr808-lofi-boombap',
      'tr808-lofi-dusty-break',
      'tr808-lofi-soul-halftime',
    ]));
    expect(phraseIds.size).toBeGreaterThanOrEqual(12);
  }, 20_000);

  it('200 seeds choose a 2–4 chord identity loop at least 70% of the time', () => {
    let short = 0;
    const periods: number[] = [];
    for (let seed = 0; seed < 200; seed++) {
      const bundle = buildSongBundle({
        seed,
        styleHint: 'lofi',
        mood: 'build',
        targetDuration: 120,
        key: pc(0),
      });
      const loop = bundle.arrangement.sections.find((section) => section.functionTag === 'loop')!;
      const identities = bundle.harmonic.chordTimeline
        .filter((span) => span.sectionId === loop.id)
        .map((span) => `${span.rootPc}:${span.chordType ?? span.quality}`);
      const period = minimalPeriod(identities);
      periods.push(period);
      if (period >= 2 && period <= 4) short += 1;
      expect(period, `seed ${seed}`).toBeLessThanOrEqual(8);
    }
    expect(short / periods.length).toBeGreaterThanOrEqual(0.7);
  }, 30_000);

  it('fixed review seeds keep realized Lead onsets out of the planned four-bar breathing windows', () => {
    for (const seed of [0, 2, 7, 42, 99]) {
      const bundle = buildSongBundle({
        seed,
        styleHint: 'lofi',
        mood: 'build',
        targetDuration: 120,
        key: pc(0),
      });
      const result = generateSongFromBundle(bundle);
      expect(result.status, `seed ${seed}: ${result.report.findings.map((finding) => finding.ruleId).join(',')}`)
        .not.toBe('failed');
      const leadBeats = (result.ir!.tracks.find((track) => track.role === 'lead')?.notes ?? [])
        .map((note) => (note.startTick as number) / bundle.timebase.ppq);
      for (const window of bundle.arrangement.lofiLeadPresencePlan!.silenceWindows) {
        const interiorOnsets = leadBeats.filter((beat) =>
          beat > window.startBeat + 0.1 && beat < window.endBeat - 0.1);
        expect(interiorOnsets, `seed ${seed}/${window.sectionId}`).toHaveLength(0);
      }
    }
  }, 30_000);
});
