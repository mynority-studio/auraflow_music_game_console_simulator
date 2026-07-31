import { describe, it, expect } from 'vitest';
import {
  diatonicQuality, pickProgressionDegrees,
  PROGRESSION_POOL, listProgressionPrototypes, pickProgressionPrototype, fitProgressionToBars,
  progressionPrototypeById,
} from './progressions';
import { createRandomContext } from '../foundation';
import { isKnownChordType } from './chords';

const CORPUS_DERIVED_LOFI_IDS = [
  'lofi_major_plagal_descent_2',
  'lofi_major_whole_step_planing_4',
  'lofi_major_parallel_minor_fall_4',
  'lofi_minor_turnaround_4',
  'lofi_minor_aeolian_ebb_8',
  'lofi_minor_late_cadence_4',
  'lofi_minor_third_bass_vamp_4',
] as const;

describe('knowledge/progressions', () => {
  it('大调自然 7 和弦品质', () => {
    expect(diatonicQuality(1, 'major')).toBe('maj7'); // Imaj7
    expect(diatonicQuality(2, 'major')).toBe('m7');   // iim7
    expect(diatonicQuality(5, 'major')).toBe('7');    // V7
    expect(diatonicQuality(7, 'major')).toBe('m7b5'); // viiø
  });
  it('小调自然 7 和弦品质', () => {
    expect(diatonicQuality(1, 'minor')).toBe('m7');
    expect(diatonicQuality(2, 'minor')).toBe('m7b5');
    expect(diatonicQuality(3, 'minor')).toBe('maj7');
  });
  it('越界度数 → 抛', () => {
    expect(() => diatonicQuality(9, 'major')).toThrow(RangeError);
  });
  it('pickProgressionDegrees:确定性 + 返回候选之一', () => {
    const rng = createRandomContext(7).substream('harmony');
    const a = pickProgressionDegrees('chorus', rng);
    const rng2 = createRandomContext(7).substream('harmony');
    const b = pickProgressionDegrees('chorus', rng2);
    expect(a).toEqual(b); // 同种子同选
    expect([[1, 5, 6, 4], [4, 5, 1, 1]]).toContainEqual(a);
  });
  it('返回副本(不污染内部表)', () => {
    const rng = createRandomContext(1).substream('harmony');
    const a = pickProgressionDegrees('verse', rng);
    a.push(99);
    const rng2 = createRandomContext(1).substream('harmony');
    expect(pickProgressionDegrees('verse', rng2)).not.toContain(99);
  });
});

describe('progression prototype registry (harmony 迁移 Loop 1)', () => {
  it('POOL includes the original short-loop repair and seven corpus-derived LOFI grammars', () => {
    expect(PROGRESSION_POOL).toHaveLength(63);
    expect(PROGRESSION_POOL.some((p) => p.id.startsWith('legacy_'))).toBe(false);
    expect(new Set(PROGRESSION_POOL.map((p) => p.id)).size).toBe(PROGRESSION_POOL.length);
    expect(PROGRESSION_POOL.filter((p) => p.style === 'ACG')).toHaveLength(12); // 旧 ACG 7 + rooted-minor 5
  });

  it('ACG PIANOSONG rooted-minor profile:短段都有专属原型，非 pedal 默认根音', () => {
    const rooted = listProgressionPrototypes({ style: 'ACG', mode: 'Minor' })
      .filter((p) => p.subStyles?.includes('ACG PIANOSONG Rooted Minor'));
    expect(rooted.map((p) => p.id)).toEqual([
      'acg_piano_minor_pedal_intro_4',
      'acg_piano_minor_aeolian_theme_8',
      'acg_piano_minor_aeolian_cell_4',
      'acg_piano_minor_relative_dorian_lift_4',
      'acg_piano_minor_harmonic_cadence_4',
    ]);

    const intro = rooted.find((p) => p.id === 'acg_piano_minor_pedal_intro_4')!;
    expect(intro.slots.every((s) => s.roman === 'i' && s.bassRole === 'pedal' && s.bassPedalPc === undefined)).toBe(true);

    for (const proto of rooted.filter((p) => p !== intro)) {
      expect(proto.slots.every((s) => s.bassRole === 'root')).toBe(true);
      expect(proto.slots.some((s) => s.bassRole === '3rd' || s.bassRole === '5th')).toBe(false);
    }
  });

  it('ACG rooted-minor:自然小调主干、Dorian 只作 lift 色彩、收尾为 V7→i', () => {
    const acg = (id: string) => PROGRESSION_POOL.find((p) => p.id === id)!;
    const theme = acg('acg_piano_minor_aeolian_theme_8');
    expect(theme.slots.map((s) => s.roman)).toEqual(['i', 'bVI', 'bIII', 'bVII', 'i', 'iv', 'bVI', 'bVII']);
    expect(theme.slots.map((s) => s.type)).not.toContain('maj9');

    const lift = acg('acg_piano_minor_relative_dorian_lift_4');
    expect(lift.slots[0]).toMatchObject({ roman: 'i', type: 'm6/9', forcedScale: 'Dorian' });
    expect(lift.slots[1].roman).toBe('bIII'); // relative-major window

    const coda = acg('acg_piano_minor_harmonic_cadence_4');
    expect(coda.slots.slice(-2).map((s) => [s.roman, s.type, s.mustResolve])).toEqual([
      ['V', '7', true],
      ['i', 'madd9', undefined],
    ]);
  });

  it('ACG rooted-minor:4-bar form 能命中 intro / theme / lift / cadence，而不是退回通用 degree-picker', () => {
    const pick = (functionRole: 'intro' | 'verse' | 'bridge' | 'ending') =>
      pickProgressionPrototype({ style: 'ACG', mode: 'Minor', functionRole, bars: 4, random: { next: () => 0 } });

    expect(pick('intro')!.map((s) => s.roman)).toEqual(['i', 'i', 'i', 'i']);
    expect(pick('verse')!.map((s) => s.roman)).toEqual(['i', 'bVI', 'bIII', 'bVII']);
    expect(pick('bridge')!.map((s) => s.roman)).toEqual(['i', 'bIII', 'bVII', 'V']);
    expect(pick('ending')!.map((s) => s.roman)).toEqual(['iv', 'bVI', 'V', 'i']);
  });

  it('POP major 能选到 pop_canon_8 / pop_4536251_8', () => {
    const ids = listProgressionPrototypes({ style: 'POP', mode: 'Major' }).map((p) => p.id);
    expect(ids).toContain('pop_canon_8');
    expect(ids).toContain('pop_4536251_8');
  });

  it('LOFI major prototype 含 maj9/m9/13sus4 色彩', () => {
    const warm = listProgressionPrototypes({ style: 'LOFI', mode: 'Major' }).find((p) => p.id === 'lofi_major_warm_8')!;
    const types = new Set(warm.slots.map((s) => s.type));
    expect(types.has('maj9')).toBe(true);
    expect(types.has('m9')).toBe(true);
    expect(types.has('13sus4')).toBe(true);
  });

  it('LOFI transformPolicy 禁 tonicization / borrowed', () => {
    const lofi = listProgressionPrototypes({ style: 'LOFI' });
    expect(lofi.length).toBeGreaterThan(0);
    for (const p of lofi) {
      expect(p.transformPolicy?.allowTonicization).toBe(false);
      expect(p.transformPolicy?.allowBorrowed).toBe(false);
    }
  });

  it('corpus-derived LOFI grammar preserves function, harmonic rhythm and playable chord types', () => {
    for (const id of CORPUS_DERIVED_LOFI_IDS) {
      const prototype = progressionPrototypeById(id);
      expect(prototype, id).toBeDefined();
      expect(prototype!.style).toBe('LOFI');
      expect(prototype!.slots.reduce((sum, slot) => sum + (slot.beats ?? 4), 0), id)
        .toBe(prototype!.lengthBars * 4);
      expect(prototype!.slots.every((slot) => isKnownChordType(slot.type)), id).toBe(true);
    }

    expect(progressionPrototypeById('lofi_major_plagal_descent_2')!.slots)
      .toMatchObject([
        { roman: 'IV', type: 'add9', bassRole: '3rd', beats: 1.5 },
        { roman: 'ii', type: 'm9', beats: 2.5 },
        { roman: 'I', type: 'maj7' },
      ]);
    expect(progressionPrototypeById('lofi_major_whole_step_planing_4')!.slots
      .map((slot) => [slot.roman, slot.type, slot.beats]))
      .toEqual([
        ['I', 'maj7', 8],
        ['II', 'maj', 4],
        ['II', 'maj7', 4],
      ]);
    expect(progressionPrototypeById('lofi_major_parallel_minor_fall_4')!.slots
      .map((slot) => [slot.roman, slot.type, slot.beats]))
      .toEqual([
        ['I', 'maj', undefined],
        ['i', 'min', undefined],
        ['bVII', 'maj', 8],
      ]);
    expect(progressionPrototypeById('lofi_minor_turnaround_4')!.slots.map((slot) => slot.roman))
      .toEqual(['III', 'ii', 'V', 'i', 'V', 'V']);
    expect(progressionPrototypeById('lofi_minor_turnaround_4')!.slots.at(-1))
      .toMatchObject({ roman: 'V', type: 'maj', beats: 2 });
    expect(progressionPrototypeById('lofi_minor_aeolian_ebb_8')!.slots.slice(-2)
      .map((slot) => [slot.roman, slot.type]))
      .toEqual([['i', 'min'], ['VII', 'maj']]);
    expect(progressionPrototypeById('lofi_minor_late_cadence_4')!.slots
      .map((slot) => [slot.roman, slot.type, slot.beats]))
      .toEqual([
        ['i', 'min', 8],
        ['VI', 'maj', 6],
        ['VII', 'add9', 2],
      ]);
    expect(progressionPrototypeById('lofi_minor_third_bass_vamp_4')!.slots[0])
      .toMatchObject({ roman: 'i', type: 'm9', bassRole: '3rd', beats: 16 });
  });

  it('descending Soul shell is upgraded to IVmaj9 → iii11 → ii11 → Imaj9', () => {
    const slots = progressionPrototypeById('lofi_descending_soul_4')!.slots;
    expect(slots.map((slot) => [slot.roman, slot.type])).toEqual([
      ['IV', 'maj9'],
      ['iii', 'm11'],
      ['ii', 'm11'],
      ['I', 'maj9'],
    ]);
  });

  it('fitProgressionToBars(8→16 / →4)长度正确', () => {
    const phrase = PROGRESSION_POOL.find((p) => p.id === 'pop_canon_8')!.slots;
    expect(phrase).toHaveLength(8);
    expect(fitProgressionToBars(phrase, 16)).toHaveLength(16);
    expect(fitProgressionToBars(phrase, 4)).toHaveLength(4);
  });

  it('fitProgressionToBars 含半小节槽(beats:2)→ 按【拍】铺满,非按 slot 数(修 outro 被挤掉)', () => {
    // 2-bar phrase = 整小节 I + 半小节 ii + 半小节 V(共 8 拍 = 2 小节)。
    const split = [
      { roman: 'I', type: 'maj7', rootOffset: 0, scaleDegree: 1 },
      { roman: 'ii', type: 'm7', rootOffset: 2, scaleDegree: 2, beats: 2 },
      { roman: 'V', type: '7', rootOffset: 7, scaleDegree: 5, beats: 2 },
    ] as never[];
    const fit = fitProgressionToBars(split, 4); // 4 小节 = 16 拍
    const totalBeats = fit.reduce((n, s: { beats?: number }) => n + (s.beats ?? 4), 0);
    expect(totalBeats).toBe(16);              // ★ 恰好铺满 4 小节(旧实现按 slot 数 → 只有 ~3 小节)
    expect(fit.length).toBeGreaterThan(4);    // split 槽 ⇒ 槽数 > 小节数
  });

  it('pickProgressionPrototype:确定性 + fit 到 bars', () => {
    const a = pickProgressionPrototype({ style: 'POP', mode: 'Major', functionRole: 'chorus', bars: 8, random: createRandomContext(5).substream('harmony') });
    const b = pickProgressionPrototype({ style: 'POP', mode: 'Major', functionRole: 'chorus', bars: 8, random: createRandomContext(5).substream('harmony') });
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    expect(a!.length).toBe(8);
  });

  it('slot:rootOffset=半音(V=7)· lockType 默认 true · scaleDegree 推导 · borrowed metadata 保留', () => {
    const canon = PROGRESSION_POOL.find((p) => p.id === 'pop_canon_8')!;
    const v = canon.slots.find((s) => s.roman === 'V')!;
    expect(v.rootOffset).toBe(7);
    expect(v.lockType).toBe(true);
    expect(v.scaleDegree).toBe(5);
    const epic = PROGRESSION_POOL.find((p) => p.id === 'pop_epic_cadence_8')!;
    expect(epic.slots.some((s) => s.borrowedSource === 'modal_interchange')).toBe(true);
  });
});
