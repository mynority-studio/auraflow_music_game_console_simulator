import { describe, expect, it } from 'vitest';

import { GM128_MAIN_PROGRAMS, GM128_VARIATION_PROGRAMS } from '../../../sound/GMBK5X128Catalog';
import {
  DREAM5504_AUTOMATIC_ARRANGEMENT_VOICE_PROFILES,
  DREAM5504_DRUM_KIT_COUNT,
  DREAM5504_DRUM_VOICE_PROFILES,
  DREAM5504_MANUAL_ONLY_VOICE_PROFILES,
  DREAM5504_MODERN_MELODIC_VOICE_COUNT,
  DREAM5504_MODERN_MELODIC_VOICE_PROFILES,
  DREAM5504_MT32_COMPATIBILITY_VOICE_COUNT,
  dreamVoiceProfileFor,
  dreamVoiceProfilesForFamily,
  dreamVoiceProfilesForPerformanceFamily,
  dreamVoiceProfilesForPerformanceSubfamily,
  dreamVoiceProfilesForRole,
  isDreamVoiceAvailableForAutomaticArrangement,
  isDreamVoiceRoleCapable,
} from './dreamVoiceProfiles';

describe('instrumental/dreamVoiceProfiles', () => {
  it('registers the complete modern-GM address space, never the MT-32 compatibility map', () => {
    const expected = [...GM128_MAIN_PROGRAMS, ...GM128_VARIATION_PROGRAMS.filter((voice) => voice.bank !== 127)]
      .map((voice) => `${voice.bank}/${voice.program}`).sort();
    const actual = DREAM5504_MODERN_MELODIC_VOICE_PROFILES
      .map((voice) => `${voice.address.bank}/${voice.address.program}`).sort();

    expect(DREAM5504_MODERN_MELODIC_VOICE_COUNT).toBe(269);
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(269);
    expect(DREAM5504_MT32_COMPATIBILITY_VOICE_COUNT).toBe(128);
    expect(dreamVoiceProfileFor({ bank: 127, program: 11, role: 'lead' })).toBeUndefined();
    expect(isDreamVoiceAvailableForAutomaticArrangement({ bank: 127, program: 11, role: 'lead' })).toBe(false);
  });

  it('keeps dedicated drum kits separate from the melodic CC0 address space', () => {
    expect(DREAM5504_DRUM_KIT_COUNT).toBe(10);
    expect(DREAM5504_DRUM_VOICE_PROFILES.map((voice) => voice.address.program)).toEqual([0, 8, 16, 24, 25, 32, 40, 48, 56, 127]);
    expect(dreamVoiceProfileFor({ bank: 0, program: 0, role: 'lead' })?.family).toBe('acoustic-piano');
    expect(dreamVoiceProfileFor({ program: 0, role: 'drum' })?.family).toBe('drum-kit');
    expect(DREAM5504_AUTOMATIC_ARRANGEMENT_VOICE_PROFILES.every((voice) => voice.arrangementStatus === 'available')).toBe(true);
    expect(DREAM5504_MANUAL_ONLY_VOICE_PROFILES.every((voice) => voice.arrangementStatus === 'manual-only')).toBe(true);
    expect(DREAM5504_AUTOMATIC_ARRANGEMENT_VOICE_PROFILES.length + DREAM5504_MANUAL_ONLY_VOICE_PROFILES.length).toBe(279);
  });

  it('classifies physical behaviour from the full address rather than from PC alone', () => {
    const organBass = dreamVoiceProfileFor({ bank: 40, program: 16, role: 'bass' });
    expect(organBass).toMatchObject({
      name: 'Organ Bass',
      family: 'organ-bass',
      performanceFamily: 'bass',
      performanceSubfamily: 'organ-bass',
      expressionFamily: 'bass-pluck',
    });
    expect(organBass?.roleCapabilities).toEqual(['bass']);
    expect(isDreamVoiceRoleCapable({ bank: 40, program: 16 }, 'comp')).toBe(false);

    expect(dreamVoiceProfileFor({ bank: 0, program: 46 })?.family).toBe('plucked-string');
    expect(dreamVoiceProfileFor({ bank: 0, program: 47 })?.family).toBe('orchestral-percussion');
    expect(dreamVoiceProfileFor({ bank: 0, program: 44 })?.family).toBe('ensemble-string');
    expect(dreamVoiceProfileFor({ bank: 0, program: 43 })?.roleCapabilities).toEqual(['bass']);
    expect(dreamVoiceProfileFor({ bank: 0, program: 68 })?.expressionFamily).toBe('woodwind-air');
    expect(dreamVoiceProfileFor({ bank: 0, program: 56 })?.expressionFamily).toBe('brass-air');
    expect(dreamVoiceProfileFor({ bank: 8, program: 66 })?.expressionFamily).toBe('sax-air');
    expect(dreamVoiceProfileFor({ bank: 3, program: 89 })?.family).toBe('ensemble-string');
    expect(dreamVoiceProfilesForFamily('organ-bass')).toContainEqual(expect.objectContaining({ name: 'Organ Bass' }));
    expect(dreamVoiceProfilesForRole('bass')).toContainEqual(expect.objectContaining({ name: 'Organ Bass' }));
  });

  it('separates acoustic, electric and synth sources within an instrument family', () => {
    expect(dreamVoiceProfileFor({ bank: 0, program: 0 })).toMatchObject({
      performanceFamily: 'keyboard', performanceSubfamily: 'acoustic-piano',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 2 })).toMatchObject({
      performanceFamily: 'keyboard', performanceSubfamily: 'electric-piano',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 6 })).toMatchObject({
      performanceFamily: 'keyboard', performanceSubfamily: 'acoustic-keyed-pluck',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 7 })).toMatchObject({
      performanceFamily: 'keyboard', performanceSubfamily: 'electric-keyed-pluck',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 32 })).toMatchObject({
      performanceFamily: 'bass', performanceSubfamily: 'acoustic-bass',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 33 })).toMatchObject({
      performanceFamily: 'bass', performanceSubfamily: 'electric-bass',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 38 })).toMatchObject({
      performanceFamily: 'bass', performanceSubfamily: 'synth-bass',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 27 })).toMatchObject({
      performanceFamily: 'guitar', performanceSubfamily: 'electric-guitar',
    });
    expect(dreamVoiceProfileFor({ bank: 8, program: 66 })).toMatchObject({
      performanceFamily: 'wind', performanceSubfamily: 'saxophone',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 42 })).toMatchObject({
      performanceFamily: 'bowed-string', performanceSubfamily: 'bowed-solo-string',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 48 })).toMatchObject({
      family: 'ensemble-string',
      performanceFamily: 'bowed-string',
      performanceSubfamily: 'bowed-ensemble-string',
      expressionFamily: 'bowed-string',
    });
    expect(dreamVoiceProfilesForPerformanceFamily('keyboard')).toEqual(expect.arrayContaining([
      expect.objectContaining({ performanceSubfamily: 'acoustic-piano' }),
      expect.objectContaining({ performanceSubfamily: 'electric-piano' }),
    ]));
    expect(dreamVoiceProfilesForPerformanceSubfamily('saxophone')).toContainEqual(
      expect.objectContaining({ name: 'Tenor Sax' }),
    );
  });
});
