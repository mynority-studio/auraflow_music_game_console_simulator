import { describe, it, expect } from 'vitest';
import { compPattern } from './grooves';

describe('knowledge/grooves · compPattern', () => {
  it('pop:四分律动 4 hits', () => {
    expect(compPattern('pop').length).toBe(4);
  });
  it('jazz:有 offbeat 切分(非整拍 hit)', () => {
    const offbeat = compPattern('jazz').some((h) => h.beat % 1 !== 0);
    expect(offbeat).toBe(true);
  });
  it('未知 style → default', () => {
    expect(compPattern('xyz')).toEqual(compPattern('default'));
  });
  it('返回副本(不污染内部表)', () => {
    const a = compPattern('pop');
    a[0].vel = 1;
    expect(compPattern('pop')[0].vel).not.toBe(1);
  });
});
