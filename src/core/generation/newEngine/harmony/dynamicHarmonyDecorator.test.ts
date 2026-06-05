// ============================================================
// newEngine · harmony · DynamicHarmonyDecorator / Loop 3 测试
// ------------------------------------------------------------
// 锁:getDynamicTsdRules 5 风格 · analyzeResolutionTarget 分类 ·
// decorateChordType(POP 不出 13/7alt · LOFI 偏 sus9/13 · JAZZ MinorTarget 出 7b9/7alt · 锁定不改)。
// ============================================================

import { describe, expect, it } from 'vitest';
import { getDynamicTsdRules, DYNAMIC_TSD_DICTIONARY } from '../knowledge/dynamicTsdDictionary';
import { analyzeResolutionTarget, decorateChordType } from './dynamicHarmonyDecorator';
import { createRandomContext } from '../foundation';

const rng = () => createRandomContext(7).substream('harmony');

describe('getDynamicTsdRules', () => {
  it('5 风格 × T/S/D 都有规则', () => {
    for (const s of ['POP', 'JAZZ', 'RNB', 'BLUES', 'LOFI']) {
      for (const f of ['T', 'S', 'D'] as const) expect(getDynamicTsdRules(s, f).length).toBeGreaterThan(0);
    }
    expect(DYNAMIC_TSD_DICTIONARY.POP.D.length).toBe(4);
  });
  it('未知风格 → 空', () => {
    expect(getDynamicTsdRules('NOPE', 'D')).toEqual([]);
  });
});

describe('analyzeResolutionTarget', () => {
  it('D 未解决到 T → Deceptive', () => {
    expect(analyzeResolutionTarget('D', 'S', 'IV', 'maj7')).toBe('Deceptive');
  });
  it('下一是小品质 → MinorTarget(maj7 不误判)', () => {
    expect(analyzeResolutionTarget('D', 'T', 'vi', 'm7')).toBe('MinorTarget');
    expect(analyzeResolutionTarget('D', 'T', 'I', 'maj7')).toBe('MajorTarget'); // maj7 不当 minor
  });
  it('空 roman → Default', () => {
    expect(analyzeResolutionTarget('S', 'T', '', '')).toBe('Default');
  });
});

describe('decorateChordType', () => {
  const base = { slotFunc: 'D' as const, slotType: 'maj', slotLockType: false, nextFunc: 'T' as const, nextRoman: 'I', nextType: 'maj7', colorBudget: 0.9 };

  it('锁定槽(lockType=true)→ 原样不改', () => {
    expect(decorateChordType({ ...base, style: 'JAZZ', slotType: 'maj9', slotLockType: true, random: rng() })).toBe('maj9');
  });

  it('POP D→MajorTarget:不产生 13 / 7alt(只 7/sus/7sus4)', () => {
    for (let i = 0; i < 20; i++) {
      const t = decorateChordType({ ...base, style: 'POP', colorBudget: 0.9, random: createRandomContext(i).substream('harmony') });
      expect(['7', 'sus4', '7sus4']).toContain(t);
      expect(t).not.toMatch(/13|alt/);
    }
  });

  it('LOFI D→MajorTarget:偏 9sus4 / 13sus4', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(decorateChordType({ ...base, style: 'LOFI', colorBudget: 0.5, random: createRandomContext(i).substream('harmony') }));
    expect([...seen].every((t) => ['9sus4', '13sus4', '7sus4'].includes(t))).toBe(true);
    expect(seen.has('9sus4') || seen.has('13sus4')).toBe(true);
  });

  it('JAZZ D→MinorTarget(colorLevel2):可产生 7alt / 13b9', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(decorateChordType({ ...base, style: 'JAZZ', nextType: 'm7', nextRoman: 'vi', colorBudget: 0.9, random: createRandomContext(i).substream('harmony') }));
    expect([...seen].every((t) => ['7alt', '13b9'].includes(t))).toBe(true); // colorLevel 2 = ['7alt','13b9']
  });

  it('空字典风格 → 回退原 type', () => {
    expect(decorateChordType({ ...base, style: 'NOPE', random: rng() })).toBe('maj');
  });
});
