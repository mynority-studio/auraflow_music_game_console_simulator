import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  JAZZ_FIVE_FOUR_MIDI_ORACLE,
  type JazzFiveFourCanonicalEvent,
} from './jazzFiveFourEvidence';
import {
  JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS,
  JAZZ_FIVE_FOUR_ACOUSTIC_BASS_FAMILY,
  JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS,
  JAZZ_FIVE_FOUR_PIANO_FOUNDATION_FAMILY,
  JAZZ_FIVE_FOUR_ROLE_BAR_TICKS,
  JAZZ_FIVE_FOUR_ROLE_ENGINE_PPQ,
  JAZZ_FIVE_FOUR_ROLE_GROUP_BOUNDARY_TICKS,
  JAZZ_FIVE_FOUR_ROLE_KB,
  JAZZ_FIVE_FOUR_ROLE_SOURCE_SHA256,
  JAZZ_FIVE_FOUR_UPPER_COMP_CELLS,
  JAZZ_FIVE_FOUR_UPPER_COMP_FAMILY,
  jazzFiveFourRoleBeatToEngineTicks,
  jazzFiveFourRoleCells,
  type JazzFiveFourRoleCell,
} from './jazzFiveFourRoleKnowledge';

function expectOracleParity(
  cells: readonly JazzFiveFourRoleCell[],
  oracleEvents: readonly JazzFiveFourCanonicalEvent[],
): void {
  expect(cells).toHaveLength(oracleEvents.length);
  expect(cells.map((cell, index) => ({
    cellId: cell.cellId,
    phaseTicks: cell.phase.engineTicks,
    phaseFromRational: jazzFiveFourRoleBeatToEngineTicks(cell.phase.beats),
    durationTicks: cell.duration.engineTicks,
    durationFromRational: jazzFiveFourRoleBeatToEngineTicks(cell.duration.beats),
    velocity: cell.velocity,
    sourcePitch: cell.sourcePitch.midi,
    sourceSha256: cell.sourceSha256,
    oracle: {
      cellId: oracleEvents[index]?.id,
      phaseTicks: oracleEvents[index]?.engineExpected.projectedPhaseTick,
      durationTicks: oracleEvents[index]?.engineExpected.projectedDurationTicks,
      velocity: oracleEvents[index]?.velocity,
      sourcePitch: oracleEvents[index]?.pitch,
      sourceSha256: JAZZ_FIVE_FOUR_MIDI_ORACLE.source.sha256,
    },
  }))).toEqual(oracleEvents.map((event) => ({
    cellId: event.id,
    phaseTicks: event.engineExpected.projectedPhaseTick,
    phaseFromRational: event.engineExpected.projectedPhaseTick,
    durationTicks: event.engineExpected.projectedDurationTicks,
    durationFromRational: event.engineExpected.projectedDurationTicks,
    velocity: event.velocity,
    sourcePitch: event.pitch,
    sourceSha256: JAZZ_FIVE_FOUR_MIDI_ORACLE.source.sha256,
    oracle: {
      cellId: event.id,
      phaseTicks: event.engineExpected.projectedPhaseTick,
      durationTicks: event.engineExpected.projectedDurationTicks,
      velocity: event.velocity,
      sourcePitch: event.pitch,
      sourceSha256: JAZZ_FIVE_FOUR_MIDI_ORACLE.source.sha256,
    },
  })));
}

describe('knowledge/jazzFiveFourRoleKnowledge · product/runtime role cells', () => {
  it('owns the reusable PPQ480 5/4 clock without a source-global timeline', () => {
    expect(JAZZ_FIVE_FOUR_ROLE_ENGINE_PPQ).toBe(480);
    expect(JAZZ_FIVE_FOUR_ROLE_BAR_TICKS).toBe(2_400);
    expect(JAZZ_FIVE_FOUR_ROLE_GROUP_BOUNDARY_TICKS).toBe(1_440);
    expect(JAZZ_FIVE_FOUR_ROLE_KB.clock).toEqual({
      ppq: 480,
      meter: { numerator: 5, denominator: 4 },
      grouping: [3, 2],
      barTicks: 2_400,
      groupBoundaryTick: 1_440,
    });

    const serialized = JSON.stringify(JAZZ_FIVE_FOUR_ROLE_KB);
    expect(serialized).not.toMatch(/absolute(?:Tick|Bar)|barIndex|originTick|contentOrigin/i);
    expect(Object.isFrozen(JAZZ_FIVE_FOUR_ROLE_KB)).toBe(true);
    expect(Object.isFrozen(JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS[0])).toBe(true);
  });

  it('derives canonical Piano foundation cells exactly from the read-only MIDI oracle', () => {
    expectOracleParity(
      JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS,
      JAZZ_FIVE_FOUR_MIDI_ORACLE.canonicalSimultaneousBar.piano.foundation,
    );
    expect(JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS.every((cell) =>
      cell.family === JAZZ_FIVE_FOUR_PIANO_FOUNDATION_FAMILY
      && cell.sublayer === 'piano-foundation'
      && cell.semanticAction.kind === 'harmony-bass-anchor'
      && cell.registerGesture.kind === 'source-relative-octave'
      && cell.registerGesture.sourceMidi === cell.sourcePitch.midi)).toBe(true);
  });

  it('derives canonical upper Comp cells and their semantic voice order exactly', () => {
    expectOracleParity(
      JAZZ_FIVE_FOUR_UPPER_COMP_CELLS,
      JAZZ_FIVE_FOUR_MIDI_ORACLE.canonicalSimultaneousBar.piano.upperComp,
    );
    expect(JAZZ_FIVE_FOUR_UPPER_COMP_CELLS.map((cell) => ({
      family: cell.family,
      sublayer: cell.sublayer,
      phase: cell.phase.engineTicks,
      actionVoice: cell.semanticAction.voiceIndex,
      gestureVoice: cell.registerGesture.voiceIndex,
    }))).toEqual([
      { family: JAZZ_FIVE_FOUR_UPPER_COMP_FAMILY, sublayer: 'piano-upper-comp', phase: 305, actionVoice: 0, gestureVoice: 0 },
      { family: JAZZ_FIVE_FOUR_UPPER_COMP_FAMILY, sublayer: 'piano-upper-comp', phase: 305, actionVoice: 1, gestureVoice: 1 },
      { family: JAZZ_FIVE_FOUR_UPPER_COMP_FAMILY, sublayer: 'piano-upper-comp', phase: 305, actionVoice: 2, gestureVoice: 2 },
      { family: JAZZ_FIVE_FOUR_UPPER_COMP_FAMILY, sublayer: 'piano-upper-comp', phase: 960, actionVoice: 0, gestureVoice: 0 },
      { family: JAZZ_FIVE_FOUR_UPPER_COMP_FAMILY, sublayer: 'piano-upper-comp', phase: 960, actionVoice: 1, gestureVoice: 1 },
      { family: JAZZ_FIVE_FOUR_UPPER_COMP_FAMILY, sublayer: 'piano-upper-comp', phase: 960, actionVoice: 2, gestureVoice: 2 },
      { family: JAZZ_FIVE_FOUR_UPPER_COMP_FAMILY, sublayer: 'piano-upper-comp', phase: 1_920, actionVoice: 0, gestureVoice: 0 },
      { family: JAZZ_FIVE_FOUR_UPPER_COMP_FAMILY, sublayer: 'piano-upper-comp', phase: 1_920, actionVoice: 1, gestureVoice: 1 },
      { family: JAZZ_FIVE_FOUR_UPPER_COMP_FAMILY, sublayer: 'piano-upper-comp', phase: 1_920, actionVoice: 2, gestureVoice: 2 },
    ]);
  });

  it('derives canonical Acoustic Bass cells exactly and exposes pure sublayer lookup', () => {
    expectOracleParity(
      JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS,
      JAZZ_FIVE_FOUR_MIDI_ORACLE.canonicalSimultaneousBar.acousticBass,
    );
    expect(JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS.every((cell) =>
      cell.family === JAZZ_FIVE_FOUR_ACOUSTIC_BASS_FAMILY
      && cell.sublayer === 'acoustic-bass'
      && cell.semanticAction.kind === 'harmony-bass-anchor')).toBe(true);
    expect(jazzFiveFourRoleCells('piano-foundation')).toBe(JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS);
    expect(jazzFiveFourRoleCells('piano-upper-comp')).toBe(JAZZ_FIVE_FOUR_UPPER_COMP_CELLS);
    expect(jazzFiveFourRoleCells('acoustic-bass')).toBe(JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS);
    expect(JAZZ_FIVE_FOUR_ROLE_SOURCE_SHA256).toBe(JAZZ_FIVE_FOUR_MIDI_ORACLE.source.sha256);
  });

  it('does not import the evidence oracle into product runtime knowledge', () => {
    const source = readFileSync(new URL('./jazzFiveFourRoleKnowledge.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+['"][^'"]*jazzFiveFourEvidence['"]/);
    expect(source).not.toContain('JAZZ_FIVE_FOUR_MIDI_ORACLE');
  });

  it('fails closed when a rational beat cannot be represented at the target PPQ', () => {
    expect(() => jazzFiveFourRoleBeatToEngineTicks({ numerator: 1, denominator: 7 }))
      .toThrow('is not exact at PPQ 480');
  });
});
