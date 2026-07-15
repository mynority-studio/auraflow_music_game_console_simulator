import { describe, expect, it } from 'vitest';
import {
  GM128_CATALOG_COUNTS,
  GM128_DRUM_KITS,
  GM128_FULL_AUDITION_INSTRUMENTS,
  GM128_MAIN_PROGRAMS,
  GM128_VARIATION_PROGRAMS,
  GMBK5X128_VOICE_WORLD,
  GMBK5X128_VOICE_WORLD_COUNTS,
  type GMBK5X128VoiceWorldFamily,
} from './GMBK5X128Catalog';
import {
  ACG_PIANOSONG_PIANO_VOICES,
  DREAM5504_PROGRAMS_BY_ROLE,
  GM128_GENERATION_VARIATION_VOICES,
  DREAM5504_VOICE_WORLD_COUNTS,
  dream5504VoiceName,
  isGMBK5X128VoiceAddressable,
  mapProgramToDream5504,
  selectGMBK5X128Voice,
} from './GMBK5X128Voices';

describe('GMBK5X128Catalog', () => {
  it('exposes the complete official GMBK5X128 audition catalog', () => {
    expect(GM128_MAIN_PROGRAMS).toHaveLength(128);
    expect(GM128_VARIATION_PROGRAMS).toHaveLength(268);
    expect(GM128_DRUM_KITS.map(item => item.program)).toEqual([0, 8, 16, 24, 25, 32, 40, 48, 56, 127]);
    expect(GM128_CATALOG_COUNTS).toEqual({
      mainPrograms: 128,
      variations: 268,
      drumKits: 10,
      totalAuditionItems: 406,
    });
    expect(GM128_FULL_AUDITION_INSTRUMENTS).toHaveLength(406);
  });

  it('keeps important Dream variations addressable by CC0 plus Program Change', () => {
    expect(GM128_VARIATION_PROGRAMS).toContainEqual(expect.objectContaining({
      bank: 8,
      program: 66,
      name: 'Breathy Tenor',
      role: 'lead',
    }));
    expect(GM128_VARIATION_PROGRAMS).toContainEqual(expect.objectContaining({
      bank: 16,
      program: 5,
      name: 'St.FM Electric Piano',
      role: 'comp',
    }));
    expect(GM128_DRUM_KITS).toContainEqual(expect.objectContaining({
      program: 127,
      name: 'CM Drum-X',
      role: 'drum',
    }));
  });

  it('uses the official Program Change 11 names for its two documented CC0 addresses', () => {
    expect(dream5504VoiceName(0, 11, 'lead')).toBe('Vibraphone');
    expect(dream5504VoiceName(127, 11, 'lead')).toBe('Detuned Organ 1');
  });

  it('keeps every generation-selected Dream variation present in the official table', () => {
    for (const voice of GM128_GENERATION_VARIATION_VOICES) {
      expect(
        isGMBK5X128VoiceAddressable(voice.bank, voice.program, 'lead'),
        `${voice.name} GM${voice.program} CC0=${voice.bank}`,
      ).toBe(true);
    }
  });

  it('puts every safe keyboard, bass, pad and drum address into the Dream 5504 orchestration world', () => {
    expect(GMBK5X128_VOICE_WORLD_COUNTS).toEqual({ keyboard: 80, bass: 31, pad: 9, drum: 10 });
    expect(DREAM5504_VOICE_WORLD_COUNTS).toEqual(GMBK5X128_VOICE_WORLD_COUNTS);

    const roleByFamily: Record<GMBK5X128VoiceWorldFamily, 'comp' | 'bass' | 'pad' | 'drum'> = {
      keyboard: 'comp', bass: 'bass', pad: 'pad', drum: 'drum',
    };
    for (const family of Object.keys(GMBK5X128_VOICE_WORLD) as GMBK5X128VoiceWorldFamily[]) {
      for (const voice of GMBK5X128_VOICE_WORLD[family]) {
        expect(
          isGMBK5X128VoiceAddressable(voice.bank, voice.program, roleByFamily[family]),
          `${family} ${voice.name} CC0=${voice.bank} PC=${voice.program}`,
        ).toBe(true);
      }
    }

    expect(GMBK5X128_VOICE_WORLD.keyboard).toContainEqual(expect.objectContaining({ bank: 40, program: 16, name: 'Organ Bass' }));
    expect(GMBK5X128_VOICE_WORLD.bass).toContainEqual(expect.objectContaining({ bank: 10, program: 38, name: 'Tekno Bass 2' }));
    expect(GMBK5X128_VOICE_WORLD.pad).toContainEqual(expect.objectContaining({ bank: 3, program: 89, name: 'Rotary String' }));
    expect(GMBK5X128_VOICE_WORLD.drum.map(item => item.program)).toEqual([0, 8, 16, 24, 25, 32, 40, 48, 56, 127]);

    // Bank 127 is a cross-family compatibility map: it remains in audition,
    // never in bass/pad where its musical register would be incorrect.
    expect(GMBK5X128_VOICE_WORLD.bass.some(item => item.bank === 127)).toBe(false);
    expect(GMBK5X128_VOICE_WORLD.pad.some(item => item.bank === 127)).toBe(false);
  });

  it('selects actual 5504 banked voices for style-aware generation', () => {
    expect(selectGMBK5X128Voice({ style: 'rnb', role: 'lead', program: 5 })).toMatchObject({
      bank: 16,
      program: 5,
      name: 'St.FM Electric Piano',
    });
    expect(selectGMBK5X128Voice({ style: 'jazz', role: 'lead', program: 66 })).toMatchObject({
      bank: 8,
      program: 66,
      name: 'Breathy Tenor',
    });
    expect(selectGMBK5X128Voice({ style: 'lofi', role: 'bass', program: 38 })).toMatchObject({
      bank: 9,
      program: 38,
      name: 'TB303 Bass',
    });
    expect(selectGMBK5X128Voice({ style: 'pop', role: 'drum', program: 8 })).toMatchObject({
      bank: undefined,
      program: 8,
      source: 'drum',
    });
  });

  it('permits GM0 Grand Piano as a bass-track left-hand voice when orchestration explicitly selects it', () => {
    expect(DREAM5504_PROGRAMS_BY_ROLE.bass).toContain(0);
    expect(mapProgramToDream5504(0, 'bass', 'acg')).toBe(0);
    expect(selectGMBK5X128Voice({ style: 'acg', role: 'bass', program: 0 })).toMatchObject({
      bank: 0,
      program: 0,
    });
  });

  it('curates five official lyrical piano colors for ACG PIANOSONG and permits them as one-piano left hand', () => {
    expect(ACG_PIANOSONG_PIANO_VOICES).toEqual([
      expect.objectContaining({ bank: 0, program: 0, name: 'Acoustic Grand Piano', weight: 8 }),
      expect.objectContaining({ bank: 127, program: 0, name: 'Acou Piano 1', weight: 4 }),
      expect.objectContaining({ bank: 0, program: 1, name: 'Bright Acoustic Piano', weight: 2 }),
      expect.objectContaining({ bank: 0, program: 2, name: 'Electric Grand Piano', weight: 1 }),
      expect.objectContaining({ bank: 8, program: 4, name: 'Soft Electric Piano', weight: 1 }),
    ]);
    for (const voice of ACG_PIANOSONG_PIANO_VOICES) {
      expect(isGMBK5X128VoiceAddressable(voice.bank, voice.program, 'bass')).toBe(true);
      expect(mapProgramToDream5504(voice.program, 'bass', 'acg')).toBe(voice.program);
    }
    // ACG 专属放行不外溢：POP 的 GM4 bass 仍被硬件 guard 回退为正式 bass program。
    expect(mapProgramToDream5504(4, 'bass', 'pop')).toBe(38);
  });
});
