import { describe, expect, it } from 'vitest';

import {
  ACTIVE_ACOUSTIC_SUBSET_IDS,
  ACOUSTIC_SUBSET_RELEASES,
  ACOUSTIC_DEBUG_DRUM_KITS,
  applyAcousticDebugPalette,
  isActiveAcousticDrumProgram,
  isActiveAcousticMelodicVoice,
} from './acousticDebugPalette';
import { dreamVoiceProfileFor } from './dreamVoiceProfiles';
import { ACOUSTIC_INSTRUMENTATION_PROFILES } from '../arranger/acousticInstrumentationProfiles';

describe('instrumental/acousticDebugPalette', () => {
  it('registers staged acoustic release units by exact CC0 plus Program, never a Program-only family guess', () => {
    expect(ACTIVE_ACOUSTIC_SUBSET_IDS).toEqual([
      'piano-damper-core',
      'acoustic-bass-pluck',
      'bowed-ensemble-bed',
      'acoustic-drum-kits',
      'acoustic-piano-variants',
      'solo-bowed-strings',
      'bowed-ensemble-expansion',
    ]);
    expect(ACOUSTIC_SUBSET_RELEASES.filter((subset) => subset.status === 'queued')).toEqual([]);
    expect(ACOUSTIC_SUBSET_RELEASES.filter((subset) => subset.status === 'held').map((subset) => subset.id)).toEqual(expect.arrayContaining([
      'vibraphone-damper', 'mallet-strike-core', 'mallet-strike-expansion',
      'acoustic-plucked-strings', 'acoustic-guitars', 'free-reed',
      'brass', 'saxophone', 'reed-woodwinds', 'flute-woodwinds',
    ]));
    expect(ACOUSTIC_SUBSET_RELEASES.filter((subset) => subset.selectionMode === 'arranger-cue-only').map((subset) => subset.id)).toEqual([
      'orchestral-cue-percussion', 'pitched-percussion-cues',
    ]);

    for (const subset of ACOUSTIC_SUBSET_RELEASES) {
      for (const voice of subset.melodicVoices) {
        expect(voice.bank).not.toBe(127);
        expect(dreamVoiceProfileFor({ ...voice, role: 'lead' }), `${subset.id} CC0=${voice.bank} PC=${voice.program}`).toBeDefined();
      }
    }
  });

  it('keeps the installed GM inventory intact while restricting generated roles to the acoustic audition palette', () => {
    const result = applyAcousticDebugPalette({
      style: 'lofi',
      lineup: ['lead', 'comp', 'bass', 'pad', 'drum'],
      provisional: { lead: 66, comp: 5, bass: 38, pad: 89, drum: 25 },
      requestedDrumProgram: 25,
      palette: 'acoustic-debug',
    });

    expect([0, 1, 3]).toContain(result.roleProgram.comp);
    expect([32, 43]).toContain(result.roleProgram.bass);
    expect([44, 48, 49]).toContain(result.roleProgram.pad);
    expect([0, 1, 3, 40, 41, 42]).toContain(result.roleProgram.lead);
    expect(ACOUSTIC_DEBUG_DRUM_KITS).toContain(result.roleProgram.drum as 0 | 8 | 16 | 32 | 40);
    expect(result.roleProgram.drum).not.toBe(25);
    expect(isActiveAcousticMelodicVoice({ bank: result.roleBank.comp!, program: result.roleProgram.comp! })).toBe(true);
    expect(isActiveAcousticMelodicVoice({ bank: result.roleBank.lead!, program: result.roleProgram.lead! })).toBe(true);
    expect(isActiveAcousticMelodicVoice({ bank: result.roleBank.bass!, program: result.roleProgram.bass! })).toBe(true);
    expect(isActiveAcousticMelodicVoice({ bank: result.roleBank.pad!, program: result.roleProgram.pad! })).toBe(true);
    expect(isActiveAcousticDrumProgram(result.roleProgram.drum!)).toBe(true);
  });

  it('preserves an arranger-selected acoustic kit but rejects electronic kits', () => {
    expect(applyAcousticDebugPalette({
      style: 'jazz', lineup: ['drum'], provisional: {}, requestedDrumProgram: 40, palette: 'acoustic-debug',
    }).roleProgram.drum).toBe(40);
    expect(applyAcousticDebugPalette({
      style: 'rnb', lineup: ['drum'], provisional: {}, requestedDrumProgram: 25, palette: 'acoustic-debug',
    }).roleProgram.drum).toBe(8);
  });

  it('consumes the Arranger template instead of re-deriving a generic acoustic band from style', () => {
    const jazz = applyAcousticDebugPalette({
      style: 'jazz', lineup: ['lead', 'comp', 'bass', 'drum'], provisional: { lead: 66, comp: 5, bass: 32 },
      instrumentationIntent: ACOUSTIC_INSTRUMENTATION_PROFILES['jazz-piano-trio'], palette: 'acoustic-debug',
    });
    expect(jazz.roleProgram).toMatchObject({ lead: 0, comp: 0, bass: 32, drum: 40 });
    expect(jazz.sharedPianoRoles).toEqual(['lead', 'comp']);

    const acg = applyAcousticDebugPalette({
      style: 'acg', lineup: ['lead', 'comp', 'bass'], provisional: { lead: 0, comp: 5, bass: 32 },
      instrumentationIntent: ACOUSTIC_INSTRUMENTATION_PROFILES['acg-piano-solo'], palette: 'acoustic-debug',
    });
    expect([0, 1, 3]).toContain(acg.roleProgram.comp);
    expect(acg.roleProgram.lead).toBe(acg.roleProgram.comp);
    expect(acg.roleProgram.bass).toBe(acg.roleProgram.comp);
    expect(acg.sharedPianoRoles).toEqual(['lead', 'comp', 'bass']);

    const lofi = applyAcousticDebugPalette({
      style: 'lofi', lineup: ['lead', 'comp', 'bass', 'drum'], provisional: { lead: 5, comp: 5, bass: 38 },
      requestedDrumProgram: 25,
      instrumentationIntent: ACOUSTIC_INSTRUMENTATION_PROFILES['lofi-piano-small-group'], palette: 'acoustic-debug',
    });
    expect(lofi.roleProgram.drum).toBe(0);
    expect([0, 1, 3]).toContain(lofi.roleProgram.lead);
    expect(lofi.roleProgram.bass).toBe(32);
  });

  it('makes every active melodic family member reachable by a deterministic seed-derived selection', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 64; n++) {
      const result = applyAcousticDebugPalette({
        style: 'pop', lineup: ['lead', 'comp', 'bass', 'pad'],
        provisional: { lead: n, comp: n * 3, bass: n * 5 }, palette: 'acoustic-debug',
      });
      for (const role of ['lead', 'comp', 'bass', 'pad'] as const) {
        seen.add(`${result.roleBank[role]}/${result.roleProgram[role]}`);
      }
    }
    expect([...seen]).toEqual(expect.arrayContaining([
      '0/0', '0/1', '0/3', '0/32', '0/43',
      '0/40', '0/41', '0/42', '0/44', '0/48', '0/49', '8/48',
    ]));
  });
});
