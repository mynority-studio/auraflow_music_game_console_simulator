import { describe, expect, it } from 'vitest';

import { GM128_MAIN_PROGRAMS, GM128_VARIATION_PROGRAMS } from '../../../sound/GMBK5X128Catalog';
import {
  DREAM5504_AUTOMATIC_ARRANGEMENT_VOICE_PROFILES,
  DREAM5504_DRUM_KIT_COUNT,
  DREAM5504_DRUM_VOICE_PROFILES,
  DREAM5504_FULL_AUDITION_VOICE_COUNT,
  DREAM5504_FULL_AUDITION_VOICE_PROFILES,
  DREAM_CC_EXPRESSION_CONTRACTS,
  DREAM_GESTURE_SUBFAMILIES,
  DREAM5504_MANUAL_ONLY_VOICE_PROFILES,
  DREAM5504_MODERN_MELODIC_VOICE_COUNT,
  DREAM5504_MODERN_MELODIC_VOICE_PROFILES,
  DREAM5504_MT32_COMPATIBILITY_VOICE_PROFILES,
  DREAM5504_MT32_COMPATIBILITY_VOICE_COUNT,
  dreamVoiceAuditionProfileFor,
  dreamVoiceProfileFor,
  dreamVoiceProfilesForFamily,
  dreamVoiceProfilesForCcExpressionContract,
  dreamVoiceProfilesForGestureSubfamily,
  dreamVoiceProfilesForInstrumentClass,
  dreamVoiceProfilesForPlayingMechanism,
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
      expressionFamily: 'organ-sustain',
      gestureSubfamily: 'bass-organ-sustain',
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

  it('classifies every shipped address by a reusable gesture subfamily without admitting MT-32 into auto arrangement', () => {
    expect(DREAM5504_FULL_AUDITION_VOICE_COUNT).toBe(407);
    expect(DREAM5504_FULL_AUDITION_VOICE_PROFILES).toHaveLength(407);
    expect(DREAM5504_MT32_COMPATIBILITY_VOICE_PROFILES).toHaveLength(128);
    expect(DREAM5504_FULL_AUDITION_VOICE_PROFILES.every((profile) => !!profile.gestureFamily && !!profile.gestureSubfamily)).toBe(true);
    expect(DREAM5504_MT32_COMPATIBILITY_VOICE_PROFILES.every((profile) => (
      profile.addressSpace === 'mt32-compatibility'
      && profile.arrangementStatus === 'audition-only'
      && profile.roleCapabilities.length === 0
    ))).toBe(true);

    expect(dreamVoiceProfileFor({ bank: 127, program: 78 })).toBeUndefined();
    expect(dreamVoiceAuditionProfileFor({ bank: 127, program: 78 })).toMatchObject({
      name: 'Soprano Sax', gestureFamily: 'wind', gestureSubfamily: 'sax-breath', arrangementStatus: 'audition-only',
    });
    expect(dreamVoiceAuditionProfileFor({ bank: 127, program: 32 })).toMatchObject({
      name: 'Fantasia Pad', gestureSubfamily: 'synth-pad-sustain', arrangementStatus: 'audition-only',
    });
  });

  it('splits voices only when their physical gesture contract differs', () => {
    expect(dreamVoiceProfileFor({ bank: 0, program: 0 })?.gestureSubfamily).toBe('hammered-piano-damper');
    expect(dreamVoiceProfileFor({ bank: 8, program: 4 })?.gestureSubfamily).toBe('electric-piano-keybed');
    expect(dreamVoiceProfileFor({ bank: 0, program: 43 })?.gestureSubfamily).toBe('bowed-contrabass');
    expect(dreamVoiceProfileFor({ bank: 0, program: 44 })?.gestureSubfamily).toBe('bowed-tremolo-ensemble');
    expect(dreamVoiceProfileFor({ bank: 0, program: 49 })?.gestureSubfamily).toBe('bowed-slow-ensemble');
    expect(dreamVoiceProfileFor({ bank: 0, program: 62 })?.gestureSubfamily).toBe('synth-lead-keybed');
    expect(dreamVoiceProfileFor({ bank: 16, program: 61 })?.arrangementStatus).toBe('manual-only');
    expect(dreamVoiceProfileFor({ program: 40, role: 'drum' })?.gestureSubfamily).toBe('drum-brush-kit');
    expect(dreamVoiceProfileFor({ program: 25, role: 'drum' })?.gestureSubfamily).toBe('drum-808-kit');
    expect(dreamVoiceProfilesForGestureSubfamily('sax-breath')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Tenor Sax' }),
      expect.objectContaining({ name: 'Breathy Tenor' }),
    ]));
  });

  it('keeps unlike physical players in separate concrete subfamilies', () => {
    expect(dreamVoiceProfileFor({ bank: 0, program: 34 })?.gestureSubfamily).toBe('bass-picked-pluck');
    expect(dreamVoiceProfileFor({ bank: 0, program: 36 })?.gestureSubfamily).toBe('bass-slap');
    expect(dreamVoiceProfileFor({ bank: 0, program: 21 })?.gestureSubfamily).toBe('accordion-bellows-keyhold');
    expect(dreamVoiceProfileFor({ bank: 0, program: 22 })?.gestureSubfamily).toBe('harmonica-breath');
    expect(dreamVoiceProfileFor({ bank: 0, program: 68 })?.gestureSubfamily).toBe('double-reed-breath');
    expect(dreamVoiceProfileFor({ bank: 0, program: 71 })?.gestureSubfamily).toBe('single-reed-breath');
    expect(dreamVoiceProfileFor({ bank: 0, program: 109 })?.gestureSubfamily).toBe('bagpipe-drone');
    expect(dreamVoiceProfileFor({ bank: 0, program: 111 })?.gestureSubfamily).toBe('world-double-reed-breath');
    expect(dreamVoiceProfileFor({ bank: 0, program: 108 })?.gestureSubfamily).toBe('thumb-pluck');

    const populated = new Set(DREAM5504_FULL_AUDITION_VOICE_PROFILES.map((voice) => voice.gestureSubfamily));
    expect([...DREAM_GESTURE_SUBFAMILIES].every((subfamily) => populated.has(subfamily))).toBe(true);
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

  it('uses playing mechanism → instrument class → source as the canonical hierarchy', () => {
    expect(dreamVoiceProfileFor({ bank: 0, program: 0 })).toMatchObject({
      playingMechanism: 'keybed', instrumentClass: 'acoustic-piano', soundSource: 'acoustic',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 4 })).toMatchObject({
      playingMechanism: 'keybed', instrumentClass: 'electric-piano', soundSource: 'electric',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 80 })).toMatchObject({
      playingMechanism: 'keybed', instrumentClass: 'synth-keyboard', soundSource: 'synth',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 27 })).toMatchObject({
      playingMechanism: 'plucked-string', instrumentClass: 'electric-guitar', soundSource: 'electric',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 32 })).toMatchObject({
      playingMechanism: 'plucked-string', instrumentClass: 'acoustic-bass', soundSource: 'acoustic',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 21 })).toMatchObject({
      playingMechanism: 'bellows-keybed', instrumentClass: 'accordion', soundSource: 'acoustic',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 22 })).toMatchObject({
      playingMechanism: 'blown-wind', instrumentClass: 'harmonica', soundSource: 'acoustic',
    });
    expect(dreamVoiceProfileFor({ bank: 0, program: 25, role: 'drum' })).toMatchObject({
      playingMechanism: 'drum-kit', instrumentClass: 'drum-kit', soundSource: 'electric',
    });
    expect(dreamVoiceProfilesForPlayingMechanism('plucked-string')).toEqual(expect.arrayContaining([
      expect.objectContaining({ instrumentClass: 'acoustic-guitar' }),
      expect.objectContaining({ instrumentClass: 'electric-bass' }),
    ]));
    expect(dreamVoiceProfilesForInstrumentClass('electric-piano')).toEqual(expect.arrayContaining([
      expect.objectContaining({ playingMechanism: 'keybed', soundSource: 'electric' }),
    ]));
  });

  it('maps every shipped voice to one of six reusable CC contracts or a manual-only effect', () => {
    expect(DREAM5504_FULL_AUDITION_VOICE_PROFILES.every((voice) => (
      voice.ccExpressionContract !== undefined || voice.family === 'sfx'
    ))).toBe(true);
    expect(DREAM_CC_EXPRESSION_CONTRACTS).toHaveLength(6);

    expect(dreamVoiceProfileFor({ bank: 0, program: 0 })?.ccExpressionContract).toBe('piano-damper');
    expect(dreamVoiceProfileFor({ bank: 8, program: 4 })?.ccExpressionContract).toBe('electronic-keybed');
    expect(dreamVoiceProfileFor({ bank: 3, program: 89 })?.ccExpressionContract).toBe('continuous-acoustic');
    expect(dreamVoiceProfileFor({ bank: 24, program: 24 })?.ccExpressionContract).toBe('plucked-struck');
    expect(dreamVoiceProfileFor({ bank: 40, program: 16 })?.ccExpressionContract).toBe('keyed-sustain');
    expect(dreamVoiceProfileFor({ program: 25, role: 'drum' })?.ccExpressionContract).toBe('drum');
    expect(dreamVoiceProfileFor({ bank: 8, program: 30 })?.ccExpressionContract).toBeUndefined();

    expect(dreamVoiceProfilesForCcExpressionContract('plucked-struck')).toEqual(expect.arrayContaining([
      expect.objectContaining({ gestureSubfamily: 'guitar-harmonics' }),
    ]));
    expect(dreamVoiceProfilesForCcExpressionContract('continuous-acoustic')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Rotary String', address: { bank: 3, program: 89 } }),
    ]));
  });
});
