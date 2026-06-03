import { describe, it, expect } from 'vitest';
import { createTimebase } from './timebase';
import { beats, ticks } from './brandedPrimitives';

describe('foundation/timebase', () => {
  const tb = createTimebase({ meter: { numerator: 4, denominator: 4 } });

  it('默认 ppq = 480', () => {
    expect(tb.ppq).toBe(480);
  });

  it('beatToTick = beat * ppq', () => {
    expect(tb.beatToTick(beats(1))).toBe(480);
    expect(tb.beatToTick(beats(2))).toBe(960);
    expect(tb.beatToTick(beats(0.5))).toBe(240);
  });

  it('tickToBeat = tick / ppq', () => {
    expect(tb.tickToBeat(ticks(480))).toBe(1);
    expect(tb.tickToBeat(ticks(240))).toBe(0.5);
  });

  it('beat → tick → beat 往返', () => {
    expect(tb.tickToBeat(tb.beatToTick(beats(3)))).toBe(3);
  });

  it('分数拍 round 到整数 tick', () => {
    expect(tb.beatToTick(beats(1 / 3))).toBe(160); // 480/3 = 160
  });

  it('barToBeat 按拍号(四分音符拍)', () => {
    expect(createTimebase({ meter: { numerator: 4, denominator: 4 } }).barToBeat(1)).toBe(4);
    expect(createTimebase({ meter: { numerator: 3, denominator: 4 } }).barToBeat(1)).toBe(3);
    expect(createTimebase({ meter: { numerator: 6, denominator: 8 } }).barToBeat(1)).toBe(3);
    expect(createTimebase({ meter: { numerator: 4, denominator: 4 } }).barToBeat(2)).toBe(8);
  });

  it('自定义 ppq', () => {
    const tb96 = createTimebase({ ppq: 96, meter: { numerator: 4, denominator: 4 } });
    expect(tb96.beatToTick(beats(1))).toBe(96);
  });

  it('非法 ppq / meter → 抛', () => {
    expect(() => createTimebase({ ppq: 0, meter: { numerator: 4, denominator: 4 } })).toThrow(RangeError);
    expect(() => createTimebase({ ppq: 1.5, meter: { numerator: 4, denominator: 4 } })).toThrow(RangeError);
    expect(() => createTimebase({ meter: { numerator: 0, denominator: 4 } })).toThrow(RangeError);
    expect(() => createTimebase({ meter: { numerator: 4, denominator: -1 } })).toThrow(RangeError);
  });

  it('返回对象冻结(ppq 不可改)+ meter / tempoMap 冻结', () => {
    expect(Object.isFrozen(tb)).toBe(true);
    expect(() => { (tb as unknown as { ppq: number }).ppq = 96; }).toThrow(TypeError);
    expect(Object.isFrozen(tb.meter)).toBe(true);
    expect(Object.isFrozen(tb.tempoMap)).toBe(true);
  });
});
