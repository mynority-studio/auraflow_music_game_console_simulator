import { describe, expect, it } from 'vitest';
import { buildSongBundle, generateSongFromBundle } from '../generation/GenerationController';
import {
  ACG_PIANO_ARRANGEMENT_SUBSETS,
  ACG_PIANO_TEXTURE_CASES,
  buildAcgPianoScorePlan,
} from './acgPianoScorePlan';
import type { ArrangementPlan } from './ArrangementPlan';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { AcgLeadPresencePlan } from '../render/acgLeadPresencePlan';
import { ACG_PIANO_CONTINUITY_RELEASE_GUARD_BEATS } from '../knowledge/acgPianoContinuityKnowledge';
import { acgPianoOrchestrationSceneForId } from '../knowledge/acgPianoArrangementKnowledge';

function activeAcgSections(bundle: ReturnType<typeof buildSongBundle>): Set<string> {
  const active = new Set<string>();
  for (const [sectionId, texture] of Object.entries(bundle.instrumentation.textureBySection)) {
    const roles = bundle.instrumentation.activeRolesBySection[sectionId] ?? [];
    const compFallback = roles.includes('comp') && !roles.includes('pad');
    if (bundle.instrumentation.textureYieldPolicy[texture] === 'active' || compFallback) active.add(sectionId);
  }
  return active;
}

function scoreFor(seed: number, targetDuration = 90) {
  const bundle = buildSongBundle({ seed, styleHint: 'acg', mood: 'lyrical', targetDuration });
  return {
    bundle,
    // Production builds this post-harmony score exactly once before render. Keep
    // the direct-builder fallback so the unit remains useful if the bundle API is
    // intentionally exercised without ACG.
    score: bundle.acgPianoScorePlan ?? buildAcgPianoScorePlan({
      seed: bundle.seedRng.seed,
      arrangement: bundle.arrangement,
      harmonic: bundle.harmonic,
      activeSectionIds: activeAcgSections(bundle),
      grooveContract: bundle.arrangement.songGrooveContract,
    }),
  };
}

function fixtureArrangement(): ArrangementPlan {
  return {
    meter: { numerator: 4, denominator: 4 },
    sections: [{ id: 's', role: 'bridge', functionTag: 'build', bars: 2, hookPolicy: 'none' }],
    phrases: [
      { id: 'p1', sectionId: 's', bars: 1, phraseSlot: 0, role: 'cadence', cadenceTarget: 'authentic', skeletonRole: 'cadence' },
      { id: 'p2', sectionId: 's', bars: 1, phraseSlot: 1, role: 'consequent', cadenceTarget: 'open', skeletonRole: 'connector' },
    ],
  } as unknown as ArrangementPlan;
}

function fixtureHarmony(
  spans: Array<{ id: string; startBeat: number; durationBeats: number; rootPc: number }>,
  functions: readonly ('T' | 'S' | 'D')[],
): HarmonicPlan {
  return {
    chordTimeline: spans.map((span) => ({
      ...span,
      sectionId: 's',
      roman: { degree: 1, accidental: 'natural', quality: 'maj' },
      quality: 'maj',
    })),
    chordFunctionTimeline: functions,
  } as unknown as HarmonicPlan;
}

function fixtureScore(args: {
  seed: number;
  harmony: HarmonicPlan;
  leadPresencePlan?: AcgLeadPresencePlan;
}) {
  return fixtureScoreForArrangement({
    seed: args.seed,
    arrangement: fixtureArrangement(),
    harmony: args.harmony,
    leadPresencePlan: args.leadPresencePlan,
  });
}

function fixtureScoreForArrangement(args: {
  seed: number;
  arrangement: ArrangementPlan;
  harmony: HarmonicPlan;
  leadPresencePlan?: AcgLeadPresencePlan;
}) {
  return buildAcgPianoScorePlan({
    seed: args.seed,
    arrangement: args.arrangement,
    harmonic: args.harmony,
    activeSectionIds: new Set(args.arrangement.sections.map((section) => section.id)),
    leadPresencePlan: args.leadPresencePlan,
  });
}

function compSurfaceFamily(gesture: string): 'broken' | 'vertical' | 'pulse' | 'air' | 'answer' {
  if (gesture === 'arp-up' || gesture === 'arp-down' || gesture === 'broken-wave') return 'broken';
  if (gesture === 'block' || gesture === 'rolled-block') return 'vertical';
  if (gesture === 'pulse') return 'pulse';
  if (gesture === 'answer-dyad') return 'answer';
  return 'air';
}

describe('arranger/acgPianoScorePlan · internal ACG arrangement subsets', () => {
  it('keeps every phase candidate reachable inside its compact cue palette', () => {
    for (const subset of ACG_PIANO_ARRANGEMENT_SUBSETS) {
      const palette = new Set(subset.songPalette);
      // Tremolo replaces one arrival colour in the pulse cue rather than
      // expanding a song into an unrestricted texture grab-bag.
      expect(palette.size, `${subset.id} song palette`).toBeLessThanOrEqual(6);

      for (const [phase, candidates] of Object.entries(subset.palette)) {
        expect(candidates.length, `${subset.id} ${phase} candidates`).toBeGreaterThan(0);
        for (const candidate of candidates) {
          expect(
            palette.has(candidate),
            `${subset.id} ${phase} must not silently filter ${candidate}`,
          ).toBe(true);
        }
      }

      // These can be prepended to a phase request by the planner, so they
      // must be just as reachable as the phase-local candidates.
      for (const candidate of [...subset.upward, ...subset.arrivals]) {
        expect(palette.has(candidate), `${subset.id} supplemental candidate ${candidate}`).toBe(true);
      }
    }
  });

  it('is deterministic, hidden inside ACG, and varies the middle arrangement across seeds', () => {
    const variants = new Set<string>();
    const signatures = new Set<string>();
    for (const seed of Array.from({ length: 20 }, (_, index) => index)) {
      const a = scoreFor(seed);
      const b = scoreFor(seed);
      expect(a.score).toEqual(b.score);
      variants.add(a.score.arrangementVariant);
      signatures.add(`${a.score.arrangementVariant}|${Object.values(a.score.textureBySpan).join(',')}|${Object.values(a.score.spanById).map((span) => span.bass.maxNotesPerSpan).join(',')}`);

      const directives = Object.values(a.score.spanById);
      expect(directives.length).toBeGreaterThan(0);
      expect(directives.every((span) => ACG_PIANO_TEXTURE_CASES.includes(span.textureCase))).toBe(true);
      expect(directives.every((span) => span.comp.floorMidi === 48 && span.comp.ceilingMidi === 60)).toBe(true);
      expect(directives.every((span) => span.comp.gesture && span.bass.rootAnchorRequired)).toBe(true);

      const phrases = Object.values(a.score.phraseById).sort((left, right) => left.startBeat - right.startBeat);
      expect(phrases.length, `seed ${seed} phrase score`).toBe(a.bundle.arrangement.phrases.length);
      expect(new Set(phrases.map((phrase) => phrase.surfaceSignature)).size,
        `seed ${seed} phrase hand-shape variety`).toBeGreaterThanOrEqual(Math.min(3, phrases.length));
      for (let index = 1; index < phrases.length; index++) {
        const previous = phrases[index - 1]!;
        const phrase = phrases[index]!;
        expect(phrase.startBeat, `seed ${seed} phrase order`).toBeGreaterThanOrEqual(previous.endBeat);
        if (phrase.repeatPolicy === 'forbid-adjacent-repeat') {
          expect(phrase.surfaceSignature, `seed ${seed} adjacent phrases ${previous.phraseId}/${phrase.phraseId}`)
            .not.toBe(previous.surfaceSignature);
        }
      }
      for (const phrase of phrases) {
        const scene = acgPianoOrchestrationSceneForId(phrase.orchestrationSceneId);
        expect(scene.bass.lane, `${phrase.phraseId} bass lane`).toBe('low');
        expect(scene.comp.lane, `${phrase.phraseId} COMP lane`).toBe('middle');
        expect(scene.lead.lane, `${phrase.phraseId} lead lane`).toBe('top');
        expect(scene.lead.allowedGrammarSubsets, `${phrase.phraseId} grammar contract`)
          .toContain(phrase.lead.grammarSubset);
      }
    }
    expect(variants.size, 'internal subset should vary without adding a UI style').toBeGreaterThanOrEqual(3);
    expect(signatures.size, 'arrangement texture/density should vary across seeds').toBeGreaterThanOrEqual(8);
  });

  it('compiles KB continuity into every phrase × harmony lead slot before scheduling', () => {
    const { bundle, score } = scoreFor(17);
    const phrases = Object.values(score.phraseById);
    const timeline = bundle.harmonic.chordTimeline;
    expect(score.leadContinuitySlots.length).toBeGreaterThan(0);

    for (const phrase of phrases) {
      expect(phrase.lead.continuityProfile).toMatchObject({
        continuityClass: 'carrier',
        minimumKeyDownBeats: 2,
        allowedShortGestureClasses: ['ornament', 'pulse', 'suspension'],
        lowerHandPolicy: 'does-not-shorten-key',
        terminalTailPolicy: 'allow-song-end-carrier',
      });
      for (const span of timeline) {
        const startBeat = span.startBeat as number;
        const endBeat = startBeat + (span.durationBeats as number);
        if (startBeat >= phrase.endBeat - 1e-4 || endBeat <= phrase.startBeat + 1e-4) continue;
        expect(score.leadContinuitySlots.some((slot) =>
          slot.phraseId === phrase.phraseId
            && slot.sourceSpanId === span.id
            && slot.startBeat < slot.endBeat), `${phrase.phraseId}/${span.id}`).toBe(true);
      }
    }

    for (const slot of score.leadContinuitySlots) {
      expect(slot).toMatchObject({
        continuityClass: 'carrier',
        minimumKeyDownBeats: 2,
        harmonicScope: 'current-chord',
        stableRoles: ['root', 'third', 'fifth', 'seventh'],
        allowedShortGestureClasses: ['ornament', 'pulse', 'suspension'],
        lowerHandPolicy: 'does-not-shorten-key',
      });
      expect(slot.boundaryBridges.at(-1)).toEqual({ kind: 'release-at-boundary' });
      for (const bridge of slot.boundaryBridges) {
        if (bridge.kind === 'release-at-boundary') continue;
        const target = timeline.find((span) => span.id === bridge.targetSpanId);
        const sourceStable = new Set((bundle.harmonic.stableToneMap[slot.sourceSpanId] ?? []).map(Number));
        expect(target, `${slot.id} target`).toBeDefined();
        expect(bridge.continuationPcs?.length, `${slot.id} bridge pcs`).toBeGreaterThan(0);
        if (bridge.kind === 'common-tone') {
          const targetStable = new Set((bundle.harmonic.stableToneMap[target!.id] ?? []).map(Number));
          for (const pitchClass of bridge.continuationPcs ?? []) {
            expect(sourceStable.has(pitchClass), `${slot.id} source common tone`).toBe(true);
            expect(targetStable.has(pitchClass), `${slot.id} target common tone`).toBe(true);
          }
        } else {
          const sourceIndex = timeline.findIndex((span) => span.id === slot.sourceSpanId);
          const targetIndex = timeline.findIndex((span) => span.id === target!.id);
          expect(bundle.harmonic.chordFunctionTimeline[sourceIndex]).toBe('S');
          expect(bundle.harmonic.chordFunctionTimeline[targetIndex]).toBe('D');
          for (const pitchClass of bridge.continuationPcs ?? []) {
            expect(sourceStable.has(pitchClass), `${slot.id} source b9`).toBe(true);
            expect(pitchClass).toBe(((Number(target!.rootPc) + 1) % 12 + 12) % 12);
          }
        }
      }
    }
  });

  it('writes per-hand rest semantics so isolated short COMP/BASS events cannot bypass the pedal contract', () => {
    const { score } = scoreFor(17);
    const events = Object.values(score.spanById).flatMap((span) => [
      ...span.comp.events,
      ...span.bass.events,
    ]);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.continuity !== undefined)).toBe(true);
    expect(events.filter((event) => event.continuity?.continuityClass === 'exposed-carrier').length)
      .toBeGreaterThan(0);
    expect(events.every((event) => event.continuity?.continuityClass === 'fast-run'
      ? event.continuity.damperPolicy === 'dry-allowed'
      : event.continuity?.damperPolicy === 'pedal-default')).toBe(true);
  });

  it('keeps both middle development and coda hand-shapes variable across seeds', () => {
    const middleTextures = new Set<string>();
    const codaTextures = new Set<string>();
    for (const seed of Array.from({ length: 64 }, (_, index) => index)) {
      const { score } = scoreFor(seed);
      for (const span of Object.values(score.spanById)) {
        if (span.phase === 'development' || span.phase === 'lift' || span.phase === 'return') {
          middleTextures.add(span.textureCase);
        }
        if (span.phase === 'coda') codaTextures.add(span.textureCase);
      }
    }
    expect(middleTextures.size, 'middle must not collapse to an intro hand-shape').toBeGreaterThanOrEqual(3);
    expect(codaTextures.size, 'coda must retain a selectable closing colour').toBeGreaterThanOrEqual(2);
  });

  it('turns hidden arrangement profiles into audible score sentences, not just different texture labels', () => {
    const profiles = new Set<string>();
    const arrangementVariants = new Set<string>();
    const textureCases = new Set<string>();
    const openingSignatures = new Set<string>();
    const codaSignatures = new Set<string>();
    const sentenceIds = new Set<string>();
    const attackSignaturesByGesture = new Map<string, Set<string>>();

    for (const seed of Array.from({ length: 96 }, (_, index) => index)) {
      const { bundle, score } = scoreFor(seed);
      profiles.add(bundle.arrangement.acgPianoArrangementProfileId ?? 'legacy-fallback');
      arrangementVariants.add(score.arrangementVariant);
      const firstSectionId = bundle.arrangement.sections[0]?.id;
      for (const directive of Object.values(score.spanById)) {
        const sentenceId = directive.comp.sentenceId;
        expect(sentenceId, `seed ${seed} ${directive.spanId} concrete sentence`).toBeDefined();
        if (!sentenceId) continue;
        sentenceIds.add(sentenceId);
        textureCases.add(directive.textureCase);
        const attackSignature = `${sentenceId}:${directive.comp.events
          .map((event) => `${event.atBeat.toFixed(2)}/${event.voices}/${event.attack}`)
          .join(',')}`;
        if (directive.sectionId === firstSectionId && directive.comp.events.length > 0) {
          openingSignatures.add(attackSignature);
        }
        if (directive.phase === 'coda' && directive.comp.events.length > 0) {
          codaSignatures.add(attackSignature);
        }
        if (directive.comp.events.length > 0) {
          const byGesture = attackSignaturesByGesture.get(directive.comp.gesture) ?? new Set<string>();
          byGesture.add(attackSignature);
          attackSignaturesByGesture.set(directive.comp.gesture, byGesture);
        }
      }
    }

    expect(profiles, 'internal profiles must vary without a UI style fork').toHaveLength(5);
    expect(arrangementVariants, 'profiles must expose all existing internal material subsets to the score').toHaveLength(4);
    expect(sentenceIds.size, 'score must use a real sentence pool').toBeGreaterThanOrEqual(8);
    expect(textureCases, 'the former unreachable tremolo colour must now be score-reachable').toContain('ACG_Bass_Tremolo_Color');
    expect(openingSignatures.size, 'opening must have several audible hand shapes').toBeGreaterThanOrEqual(3);
    expect(codaSignatures.size, 'coda must have several audible hand shapes').toBeGreaterThanOrEqual(3);
    expect([...attackSignaturesByGesture.values()].filter((signatures) => signatures.size >= 2).length,
      'several structural gestures must compile to distinct attack grids').toBeGreaterThanOrEqual(4);
  });

  it('writes contrasting phrase-level middle surfaces and never leaves an unbroken arpeggio wash', () => {
    const seenContrast = new Set<string>();
    for (const seed of Array.from({ length: 64 }, (_, index) => index)) {
      const { bundle, score } = scoreFor(seed);
      const timeline = bundle.harmonic.chordTimeline
        .map((span) => score.spanById[span.id])
        .filter((span): span is NonNullable<typeof span> => !!span);
      let brokenRun = 0;
      for (const span of timeline) {
        const middle = span.phase === 'development' || span.phase === 'lift' || span.phase === 'return';
        if (!middle) {
          brokenRun = 0;
          continue;
        }
        const family = compSurfaceFamily(span.comp.gesture);
        if (family === 'broken') {
          brokenRun++;
          expect(brokenRun, `seed ${seed} middle broken-motion run`).toBeLessThanOrEqual(5);
        } else {
          brokenRun = 0;
          seenContrast.add(family);
        }
      }

      for (const phrase of Object.values(score.phraseById)) {
        expect(phrase.spanGestureCycle.length, `seed ${seed} ${phrase.phraseId} comp surface`).toBeGreaterThan(0);
        if (phrase.gesture === 'block-arrival') {
          expect(phrase.spanGestureCycle.at(-1), `seed ${seed} ${phrase.phraseId} retains its terminal block`).toBe('block');
          expect(new Set(phrase.spanGestureCycle.slice(0, -1)).size,
            `seed ${seed} ${phrase.phraseId} does not loop one rolled block`).toBeGreaterThanOrEqual(2);
        }
      }
    }
    for (const family of ['vertical', 'pulse', 'air']) {
      expect(seenContrast, `middle score must include ${family} contrast across the cue pool`).toContain(family);
    }
  });

  it('links every harmonic span to an owning phrase and keeps authored events inside that span', () => {
    for (const seed of [0, 7, 42, 99, 12345]) {
      const { bundle, score } = scoreFor(seed);
      const harmonicById = new Map(bundle.harmonic.chordTimeline.map((span) => [span.id, span]));

      for (const [spanId, phraseId] of Object.entries(score.phraseIdBySpan)) {
        const harmonicSpan = harmonicById.get(spanId);
        const phrase = score.phraseById[phraseId];
        expect(harmonicSpan, `seed ${seed} ${spanId} harmonic span`).toBeDefined();
        expect(phrase, `seed ${seed} ${spanId} phrase link`).toBeDefined();
        const startBeat = harmonicSpan!.startBeat as number;
        expect(startBeat, `seed ${seed} ${spanId} starts in ${phraseId}`).toBeGreaterThanOrEqual(phrase!.startBeat - 1e-4);
        expect(startBeat, `seed ${seed} ${spanId} ends in ${phraseId}`).toBeLessThan(phrase!.endBeat - 1e-4);
      }

      for (const [spanId, scoreSpan] of Object.entries(score.spanById)) {
        const harmonicSpan = harmonicById.get(spanId)!;
        const duration = harmonicSpan.durationBeats as number;
        expect(scoreSpan.phraseId, `seed ${seed} ${spanId} score phrase`).toBe(score.phraseIdBySpan[spanId]);
        expect(score.phraseById[scoreSpan.phraseId], `seed ${seed} ${spanId} phrase exists`).toBeDefined();
        for (const event of scoreSpan.comp.events) {
          expect(event.atBeat, `seed ${seed} ${spanId} ${event.id} onset`).toBeGreaterThanOrEqual(0);
          expect(event.durationBeats, `seed ${seed} ${spanId} ${event.id} duration`).toBeGreaterThan(0);
          expect(event.atBeat + event.durationBeats, `seed ${seed} ${spanId} ${event.id} boundary`)
            .toBeLessThanOrEqual(duration + 1e-4);
        }
        if (scoreSpan.comp.gesture === 'tacet') {
          expect(scoreSpan.comp.events, `seed ${seed} ${spanId} tacet events`).toHaveLength(0);
          expect(scoreSpan.comp.silenceWindows.some((window) => window.startBeat <= 1e-4 && window.endBeat >= duration - 1e-4),
            `seed ${seed} ${spanId} tacet window`).toBe(true);
        } else {
          expect(scoreSpan.comp.events.length, `seed ${seed} ${spanId} active score events`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('writes an audible low-root + middle-COMP opening before any NoteIR exists', () => {
    const arrangement = {
      meter: { numerator: 4, denominator: 4 },
      acgPianoArrangementProfileId: 'ripple-journey',
      sections: [{ id: 'open', role: 'intro', functionTag: 'setup', bars: 2, hookPolicy: 'none' }],
      phrases: [{
        id: 'open-p', sectionId: 'open', bars: 2, phraseSlot: 0,
        role: 'antecedent', cadenceTarget: 'open', skeletonRole: 'connector',
      }],
    } as unknown as ArrangementPlan;
    const harmony = {
      chordTimeline: [
        { id: 'o0', sectionId: 'open', startBeat: 0, durationBeats: 4, rootPc: 0, roman: { degree: 1, accidental: 'natural', quality: 'maj' }, quality: 'maj' },
        { id: 'o1', sectionId: 'open', startBeat: 4, durationBeats: 4, rootPc: 5, roman: { degree: 4, accidental: 'natural', quality: 'maj' }, quality: 'maj' },
      ],
      chordFunctionTimeline: ['T', 'S'],
    } as unknown as HarmonicPlan;

    const score = fixtureScoreForArrangement({ seed: 0, arrangement, harmony });
    expect(score.phraseById['open-p']).toMatchObject({
      phase: 'opening',
      gesture: 'pedal-breath',
      orchestrationSceneId: 'opening-seed',
      spanGestureCycle: ['pedal-hold', 'arp-up', 'broken-wave', 'rolled-block'],
      lead: {
        interlock: {
          whenLeadActive: 'underlay',
          whenLeadRest: 'underlay',
        },
      },
    });
    for (const spanId of ['o0', 'o1'] as const) {
      expect(score.spanById[spanId]!.comp.gesture, `${spanId} middle hand`).not.toBe('tacet');
      expect(score.spanById[spanId]!.comp.events.length, `${spanId} scored middle hand`).toBeGreaterThan(0);
      expect(score.spanById[spanId]!.bass.events[0]).toMatchObject({ atBeat: 0, voice: 'root' });
    }
    expect(score.spanById.o0!.bass.events[0]!.durationBeats,
      'the pedal opening retains its left-hand carrier')
      .toBeCloseTo(4 - ACG_PIANO_CONTINUITY_RELEASE_GUARD_BEATS, 8);
  });

  it('writes a D→T terminal into the next T score span, never onto the outgoing dominant', () => {
    const harmonic = fixtureHarmony([
      { id: 'd', startBeat: 0, durationBeats: 4, rootPc: 7 },
      { id: 't', startBeat: 4, durationBeats: 4, rootPc: 0 },
    ], ['D', 'T']);
    const score = Array.from({ length: 24 }, (_, seed) => fixtureScore({ seed, harmony: harmonic }))
      .find((candidate) => candidate.spanById.t?.comp.events.some((event) => event.resolutionSourceSpanId === 'd'));
    expect(score, 'fixture needs an authored D→T terminal').toBeDefined();
    if (!score) return;

    const source = score.spanById.d!;
    const target = score.spanById.t!;
    const terminal = target.comp.events.filter((event) => event.resolutionSourceSpanId === 'd');
    expect(source.comp.events.some((event) => event.role === 'arrival')).toBe(false);
    expect(terminal.length).toBeGreaterThan(0);
    for (const event of terminal) {
      expect(event.atBeat).toBeCloseTo(0, 8);
      expect(event.harmonicTarget).toBe('current');
      expect(event.role).toBe('arrival');
      expect(event.atBeat + event.durationBeats).toBeLessThanOrEqual(4 + 1e-4);
    }
  });

  it('carries a D→T terminal across a section boundary into the target T phrase', () => {
    const arrangement = {
      meter: { numerator: 4, denominator: 4 },
      sections: [
        { id: 'source', role: 'bridge', functionTag: 'build', bars: 1, hookPolicy: 'none' },
        { id: 'target', role: 'chorus', functionTag: 'headOut', bars: 1, hookPolicy: 'light' },
      ],
      phrases: [
        { id: 'source-p', sectionId: 'source', bars: 1, phraseSlot: 0, role: 'cadence', cadenceTarget: 'authentic', skeletonRole: 'cadence' },
        { id: 'target-p', sectionId: 'target', bars: 1, phraseSlot: 0, role: 'cadence', cadenceTarget: 'authentic', skeletonRole: 'cadence' },
      ],
    } as unknown as ArrangementPlan;
    const harmony = {
      chordTimeline: [
        { id: 'd', sectionId: 'source', startBeat: 0, durationBeats: 4, rootPc: 7, roman: { degree: 5, accidental: 'natural', quality: 'maj' }, quality: 'maj' },
        { id: 't', sectionId: 'target', startBeat: 4, durationBeats: 4, rootPc: 0, roman: { degree: 1, accidental: 'natural', quality: 'maj' }, quality: 'maj' },
      ],
      chordFunctionTimeline: ['D', 'T'],
    } as unknown as HarmonicPlan;
    const score = fixtureScoreForArrangement({ seed: 7, arrangement, harmony });
    const source = score.spanById.d!;
    const target = score.spanById.t!;
    const terminal = target.comp.events.filter((event) => event.resolutionSourceSpanId === 'd');

    expect(source.comp.events.some((event) => event.role === 'arrival')).toBe(false);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({ atBeat: 0, role: 'arrival', harmonicTarget: 'current' });
  });

  it('coalesces a target downbeat block with its inherited D→T terminal instead of double-writing it', () => {
    const arrangement = {
      meter: { numerator: 4, denominator: 4 },
      sections: [{ id: 's', role: 'bridge', functionTag: 'build', bars: 2, hookPolicy: 'none' }],
      phrases: [
        { id: 'p1', sectionId: 's', bars: 1, phraseSlot: 0, role: 'cadence', cadenceTarget: 'authentic', skeletonRole: 'cadence' },
        { id: 'p2', sectionId: 's', bars: 1, phraseSlot: 1, role: 'cadence', cadenceTarget: 'authentic', skeletonRole: 'cadence' },
      ],
    } as unknown as ArrangementPlan;
    const harmony = fixtureHarmony([
      { id: 'd', startBeat: 0, durationBeats: 4, rootPc: 7 },
      { id: 't', startBeat: 4, durationBeats: 4, rootPc: 0 },
    ], ['D', 'T']);
    const score = Array.from({ length: 64 }, (_, seed) => fixtureScoreForArrangement({ seed, arrangement, harmony }))
      .find((candidate) => candidate.spanById.t?.comp.events.some((event) =>
        event.id.startsWith('p2:t:') && event.gesture === 'block' && event.resolutionSourceSpanId === 'd'));
    expect(score, 'fixture needs a target-authored block arrival').toBeDefined();
    if (!score) return;

    const target = score.spanById.t!;
    const downbeatVerticals = target.comp.events.filter((event) =>
      event.atBeat <= 1e-4 && (event.gesture === 'block' || event.gesture === 'rolled-block'));
    expect(downbeatVerticals, 'the target block itself carries the D→T provenance').toHaveLength(1);
    expect(downbeatVerticals[0]!.resolutionSourceSpanId).toBe('d');
  });

  it('splits a cross-phrase harmonic span into authored phrase slices without leaking past either boundary', () => {
    const score = fixtureScore({
      seed: 7,
      harmony: fixtureHarmony([
        { id: 'cross', startBeat: 2, durationBeats: 4, rootPc: 0 },
        { id: 'tail', startBeat: 6, durationBeats: 2, rootPc: 5 },
      ], ['T', 'S']),
    });
    const cross = score.spanById.cross!;
    expect(score.phraseIdsBySpan.cross).toEqual(['p1', 'p2']);

    // The second phrase owns [4, 6], which is [2, 4] relative to `cross`.
    // It must carry either written comp material or an explicit scored silence,
    // plus its own left-hand root anchor—never an accidental renderer fallback.
    const secondSliceHasCompOwnership = cross.comp.events.some((event) => event.atBeat >= 2 - 1e-4)
      || cross.comp.silenceWindows.some((window) => window.startBeat <= 2 + 1e-4 && window.endBeat >= 4 - 1e-4);
    expect(secondSliceHasCompOwnership).toBe(true);
    expect(cross.bass.events.some((event) => event.atBeat >= 2 - 1e-4)).toBe(true);
    for (const event of cross.comp.events) {
      expect(event.atBeat + event.durationBeats).toBeLessThanOrEqual(4 + 1e-4);
    }
    for (const event of cross.bass.events) {
      expect(event.atBeat + event.durationBeats).toBeLessThanOrEqual(4 + 1e-4);
    }
  });

  it('makes lead/comp interlock executable: answers stay inside lead rests and body COMP keeps an underlay', () => {
    let sawUnderlayPhrase = false;
    let sawAnswer = false;
    for (const seed of Array.from({ length: 48 }, (_, index) => index)) {
      const { bundle, score } = scoreFor(seed, 120);
      const harmonicById = new Map(bundle.harmonic.chordTimeline.map((span) => [span.id, span]));
      const silence = score.leadPresencePlan?.silenceWindows ?? [];
      for (const [spanId, directive] of Object.entries(score.spanById)) {
        const span = harmonicById.get(spanId)!;
        for (const event of directive.comp.events.filter((candidate) => candidate.gesture === 'answer-dyad')) {
          const startBeat = (span.startBeat as number) + event.atBeat;
          const endBeat = startBeat + event.durationBeats;
          expect(silence.some((window) => startBeat >= window.startBeat - 1e-4 && endBeat <= window.endBeat + 1e-4),
            `seed ${seed} ${event.id} must fit entirely in a scheduler silence`).toBe(true);
          sawAnswer = true;
        }
      }
      for (const phrase of Object.values(score.phraseById)) {
        expect(phrase.lead.interlock.whenLeadActive, `seed ${seed} ${phrase.phraseId}`)
          .toBe('underlay');
        sawUnderlayPhrase = true;
      }
      for (const directive of Object.values(score.spanById)) {
        if (directive.phase === 'coda') continue;
        expect(directive.comp.gesture, `seed ${seed} ${directive.spanId} body COMP`).not.toBe('tacet');
        expect(directive.comp.events.length, `seed ${seed} ${directive.spanId} middle support`)
          .toBeGreaterThan(0);
      }
      for (const phrase of Object.values(score.phraseById).filter((candidate) => candidate.phase === 'coda')) {
        const codaTacet = Object.values(score.spanById).filter((directive) =>
          directive.phraseId === phrase.phraseId && directive.comp.gesture === 'tacet');
        expect(codaTacet.length, `seed ${seed} ${phrase.phraseId} coda air budget`)
          .toBeLessThanOrEqual(2);
      }
    }
    expect(sawUnderlayPhrase, 'fixture sweep needs an audible underlay phrase').toBe(true);
    expect(sawAnswer, 'fixture sweep needs at least one scheduled answer dyad').toBe(true);

    const tooShortForDyad = fixtureScore({
      seed: 11,
      harmony: fixtureHarmony([{ id: 'short', startBeat: 0, durationBeats: 4, rootPc: 0 }], ['T']),
      leadPresencePlan: {
        silenceWindows: [{ startBeat: 1, endBeat: 1.10, reason: 'planned-entry-delay', sectionId: 's' }],
        returnRestCapBeats: 3,
      },
    });
    expect(Object.values(tooShortForDyad.spanById)
      .flatMap((span) => span.comp.events)
      .filter((event) => event.gesture === 'answer-dyad')).toHaveLength(0);
    expect(Object.values(tooShortForDyad.spanById)
      .every((span) => span.comp.gesture !== 'tacet' && span.comp.events.length > 0)).toBe(true);
  });

  it('authors each planned arp-down as one real roll-down, not an ascending rebound in a narrow voicing', () => {
    const planned = Array.from({ length: 48 }, (_, seed) => scoreFor(seed).score)
      .flatMap((score) => Object.values(score.spanById))
      .flatMap((span) => span.comp.events)
      .find((event) => event.gesture === 'arp-down');
    expect(planned, 'fixture sweep needs an arp-down').toBeDefined();
    expect(planned).toMatchObject({ voices: 'all', attack: 'roll-down' });
  });

  it('is consumed end-to-end: comp executes planned rests/events in the middle register and every span keeps a root anchor', () => {
    for (const seed of [0, 7, 99]) {
      const { bundle, score } = scoreFor(seed);
      const result = generateSongFromBundle(bundle);
      expect(result.status, `seed ${seed} generation`).not.toBe('failed');
      expect(result.ir, `seed ${seed} IR`).toBeDefined();
      const comp = result.ir!.tracks.find((track) => track.role === 'comp')!;
      const bass = result.ir!.tracks.find((track) => track.role === 'bass')!;
      const lead = result.ir!.tracks.find((track) => track.role === 'lead')!;
      expect(comp.notes.length, `seed ${seed} comp`).toBeGreaterThan(0);
      expect(lead.notes.length, `seed ${seed} lead`).toBeGreaterThan(0);
      expect(comp.notes.every((note) => (note.pitch as number) >= 48 && (note.pitch as number) <= 60), `seed ${seed} planned middle hand`).toBe(true);
      expect(bass.notes.every((note) => (note.pitch as number) >= 28 && (note.pitch as number) <= 55), `seed ${seed} planned low foundation`).toBe(true);
      expect(lead.notes.every((note) => (note.pitch as number) > 60), `seed ${seed} planned top line`).toBe(true);
      expect(Math.max(...comp.notes.map((note) => note.pitch as number)),
        `seed ${seed} COMP must stay below the lead lane`)
        .toBeLessThan(Math.min(...lead.notes.map((note) => note.pitch as number)));

      for (const [spanId, scoreSpan] of Object.entries(score.spanById)) {
        const harmonicSpan = bundle.harmonic.chordTimeline.find((span) => span.id === spanId)!;
        const startTick = (harmonicSpan.startBeat as number) * bundle.timebase.ppq;
        const endTick = startTick + (harmonicSpan.durationBeats as number) * bundle.timebase.ppq;
        const attacks = comp.notes.filter((note) => {
          const tick = note.startTick as number;
          return tick >= startTick - 1e-4 && tick < endTick - 1e-4;
        });
        if (scoreSpan.comp.gesture === 'tacet') {
          expect(attacks, `seed ${seed} ${spanId} planned comp rest`).toHaveLength(0);
        } else {
          expect(attacks.length, `seed ${seed} ${spanId} planned comp events`).toBeGreaterThan(0);
        }
      }

      for (const span of bundle.harmonic.chordTimeline) {
        if (!score.spanById[span.id]) continue;
        const start = (span.startBeat as number) * bundle.timebase.ppq;
        const rootPc = ((span.rootPc as number) % 12 + 12) % 12;
        const hasRoot = bass.notes.some((note) => {
          const tick = note.startTick as number;
          return tick >= start - bundle.timebase.ppq * 0.25
            && tick < start + bundle.timebase.ppq
            && (((note.pitch as number) % 12 + 12) % 12) === rootPc;
        });
        expect(hasRoot, `seed ${seed} ${span.id} root anchor`).toBe(true);
      }
    }
  });
});
