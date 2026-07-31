import { describe, expect, it } from 'vitest';
import {
  buildSongBundle,
  generateSongFromBundle,
} from '../generation/GenerationController';
import { beats } from '../foundation';
import { TEXTURE_POOL } from '../knowledge/textureProfiles';

const normalizePcs = (values: readonly number[]) =>
  [...new Set(values.map((value) => ((Number(value) % 12) + 12) % 12))];

function admittedPcs(
  bundle: ReturnType<typeof buildSongBundle>,
  spanId: string,
  role: 'anchor' | 'neighbor' | 'passing' | 'color' | 'terminal',
): number[] {
  const avoid = new Set(normalizePcs(bundle.harmonic.avoidNoteMap[spanId] ?? []));
  const stable = normalizePcs(bundle.harmonic.stableToneMap[spanId] ?? []).filter((pc) => !avoid.has(pc));
  const color = normalizePcs(bundle.harmonic.colorToneMap[spanId] ?? []).filter((pc) => !avoid.has(pc));
  const scale = normalizePcs(bundle.harmonic.chordScaleMap[spanId] ?? []).filter((pc) => !avoid.has(pc));
  if (role === 'anchor' || role === 'terminal') {
    const local = scale.length > 0 ? stable.filter((pc) => scale.includes(pc)) : stable;
    return local.length > 0 ? local : stable;
  }
  if (role === 'color') {
    const local = scale.length > 0 ? color.filter((pc) => scale.includes(pc)) : color;
    return local.length > 0 ? local : scale.length > 0 ? scale : stable;
  }
  const moving = scale.filter((pc) => !stable.includes(pc));
  return moving.length > 0 ? moving : scale.length > 0 ? scale : stable;
}

describe('LOFI lead score production wiring', () => {
  it('carries the post-harmony score through the production controller', () => {
    const bundle = buildSongBundle({
      seed: 13,
      styleHint: 'lofi',
      mood: 'build',
      targetDuration: 90,
    });
    const result = generateSongFromBundle(bundle);
    const lead = result.ir?.tracks.find((track) => track.role === 'lead');
    const notes = [...(lead?.notes ?? [])].sort((left, right) =>
      (left.startTick as number) - (right.startTick as number));
    const register = bundle.instrumentation.registerByRole.lead;

    expect(bundle.lofiLeadScorePlan).toBeDefined();
    expect(bundle.lofiLeadScorePlan?.events.length).toBeGreaterThan(0);
    expect(result.status).not.toBe('failed');
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((note) => (note.pitch as number) >= register.lowMidi
      && (note.pitch as number) <= register.highMidi)).toBe(true);
    for (let index = 1; index < notes.length; index++) {
      expect(Math.abs((notes[index]!.pitch as number) - (notes[index - 1]!.pitch as number)))
        .toBeLessThanOrEqual(12);
    }
    for (const event of bundle.lofiLeadScorePlan?.events ?? []) {
      const startTick = bundle.timebase.beatToTick(beats(event.startBeat)) as number;
      const durationTicks = bundle.timebase.beatToTick(beats(event.durationBeats)) as number;
      expect(notes.some((note) =>
        (note.pitch as number) === event.pitchMidi
        && (note.startTick as number) === startTick
        && (note.durationTicks as number) === durationTicks),
      `score event ${event.id} must survive to FinalIR without repitching or retiming`).toBe(true);
      expect(event.admittedSpanIds).toContain(event.sourceSpanId);
      expect(bundle.harmonic.avoidNoteMap[event.sourceSpanId] ?? [])
        .not.toContain(event.pitchClass);
    }
  });

  it('keeps phrase ownership, Comp space and local harmony valid across seeds', () => {
    for (let seed = 0; seed < 16; seed++) {
      const bundle = buildSongBundle({
        seed,
        styleHint: 'lofi',
        mood: 'build',
        targetDuration: 90,
      });
      const blueprint = bundle.arrangement.lofiLeadBlueprintPlan;
      const arrangerRoadMap = bundle.arrangement.lofiLeadRoadMapPlan;
      const score = bundle.lofiLeadScorePlan;
      expect(blueprint, `seed ${seed} blueprint`).toBeDefined();
      expect(arrangerRoadMap, `seed ${seed} Arranger Lead RoadMap`).toBeDefined();
      expect(score, `seed ${seed} score`).toBeDefined();
      expect(score?.events.length, `seed ${seed} must author concrete notes`).toBeGreaterThan(0);
      expect(arrangerRoadMap?.sourceTextureCorpus).toBe('LOFI_ENRICHED_GRAMMAR');
      expect(arrangerRoadMap?.bricks.length)
        .toBe(bundle.arrangement.lofiPhraseInteractionPlan?.bars.length);
      expect(score?.arrangerRoadMap?.bricks).toEqual(arrangerRoadMap?.bricks);
      expect(score?.compiledRoadMapBricks.length).toBe(arrangerRoadMap?.bricks.length);
      expect(score?.harmonicRoadMap?.bricks.length).toBeGreaterThan(0);
      for (const compiled of score?.compiledRoadMapBricks ?? []) {
        const directive = arrangerRoadMap?.bricks.find(
          (brick) => brick.id === compiled.arrangerBrickId,
        );
        expect(directive, `seed ${seed} compiled brick must originate in Arranger`).toBeDefined();
        expect(directive?.textureTagPriority).toContain(compiled.resolvedTextureTag);
        if (compiled.phraseRole !== 'rest') {
          expect(compiled.sourceGrammarRuleId,
            `seed ${seed} active brick ${compiled.arrangerBrickId} must consume a grammar rule`)
            .toBeDefined();
        }
      }
      for (const section of bundle.arrangement.sections.filter((candidate) => candidate.functionTag === 'loop')) {
        const expectedActive = Array.from({ length: section.bars }, (_, index) => index)
          .filter((index) => blueprint?.roleByCycleBar[index % blueprint.cycleBars] !== 'rest');
        expect(bundle.arrangement.lofiLeadPresencePlan?.activeBarsBySection[section.id])
          .toEqual(expectedActive);
        for (const interaction of bundle.arrangement.lofiPhraseInteractionPlan?.bySection[section.id] ?? []) {
          expect(interaction.leadRole)
            .toBe(blueprint?.roleByCycleBar[interaction.barInSection % blueprint.cycleBars]);
        }
      }

      const requiredSpace = blueprint?.requiredCompMelodySpace;
      const textureCases = [
        ...Object.values(bundle.instrumentation.richTextureBySection),
        ...Object.values(bundle.instrumentation.richTextureSwitchBySection).map((entry) => entry.toTexture),
      ];
      for (const textureCase of textureCases) {
        const profile = TEXTURE_POOL.find((candidate) => candidate.textureCase === textureCase);
        expect(profile, `seed ${seed} texture ${textureCase}`).toBeDefined();
        if (requiredSpace && requiredSpace !== 'any') {
          expect(profile?.partPolicy?.melodySpace, `seed ${seed} Comp must yield the authored melodic lane`)
            .toBe(requiredSpace);
        }
      }

      for (const event of score?.events ?? []) {
        expect(event.leadRoadMapBrickId).toBeTruthy();
        expect(event.leadTextureTag).toBeTruthy();
        expect(event.sourceGrammarRuleId,
          `seed ${seed} event ${event.id} must retain consumed grammar provenance`)
          .toBeTruthy();
        expect(event.pitchMidi).toBeGreaterThanOrEqual(bundle.instrumentation.registerByRole.lead.lowMidi);
        expect(event.pitchMidi).toBeLessThanOrEqual(bundle.instrumentation.registerByRole.lead.highMidi);
        expect(admittedPcs(bundle, event.sourceSpanId, event.harmonicRole))
          .toContain(event.pitchClass);
        const soundingSpanIds = bundle.harmonic.chordTimeline
          .filter((span) => {
            const start = span.startBeat as number;
            const end = start + (span.durationBeats as number);
            return event.startBeat < end - 1e-4
              && event.startBeat + event.durationBeats > start + 1e-4;
          })
          .map((span) => span.id);
        expect(event.admittedSpanIds).toEqual(soundingSpanIds);
      }

      const result = generateSongFromBundle(bundle);
      expect(result.status, `seed ${seed}`).not.toBe('failed');
      const notes = result.ir?.tracks.find((track) => track.role === 'lead')?.notes ?? [];
      for (const event of score?.events ?? []) {
        const startTick = bundle.timebase.beatToTick(beats(event.startBeat)) as number;
        const durationTicks = bundle.timebase.beatToTick(beats(event.durationBeats)) as number;
        expect(notes.some((note) =>
          (note.pitch as number) === event.pitchMidi
          && (note.startTick as number) === startTick
          && (note.durationTicks as number) === durationTicks),
        `seed ${seed} event ${event.id}`).toBe(true);
      }
    }
  });
});
