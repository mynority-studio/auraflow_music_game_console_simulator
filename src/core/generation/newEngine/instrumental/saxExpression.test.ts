import { describe, it, expect } from 'vitest';
import { midi, ticks } from '../foundation';
import type { NoteIR } from '../ir/MusicalIR';
import {
  buildSaxBreathCcEvents,
  buildSaxPitchBendEvents,
  buildSaxPortamentoCcEvents,
  isSaxProgram,
  SAX_CC,
  shapeSaxLegatoNotes,
} from './saxExpression';

const note = (start: number, dur: number, pitch = 60, velocity = 88): NoteIR => ({
  pitch: midi(pitch),
  startTick: ticks(start),
  durationTicks: ticks(dur),
  velocity,
});

describe('instrumental/saxExpression', () => {
  it('识别 GM sax family,不把 pipe wind/键盘当 sax', () => {
    for (const p of [64, 65, 66, 67]) expect(isSaxProgram(p), `GM${p}`).toBe(true);
    for (const p of [0, 4, 11, 72, 75, 77, 80]) expect(isSaxProgram(p), `GM${p}`).toBe(false);
  });

  it('每音生成 CC11+CC2 气压包络,不发 CC1 避免小 SF2 音准摆动', () => {
    const cc = buildSaxBreathCcEvents([note(0, 960, 57, 96)], { ppq: 480 });
    const controllers = new Set(cc.map((e) => e.controller));
    expect(controllers.has(SAX_CC.expression)).toBe(true);
    expect(controllers.has(SAX_CC.breath)).toBe(true);
    expect(controllers.has(SAX_CC.modulation)).toBe(false);
    expect(cc.some((e) => e.controller === SAX_CC.expression && e.atTick === ticks(0))).toBe(true);
    expect(cc.some((e) => e.controller === SAX_CC.expression && (e.atTick as number) > 0 && (e.atTick as number) < 960)).toBe(true);
  });

  it('连续不同音高会做极短 overlap 并弱化内部换指触发,模拟 sax 连吹换指', () => {
    const shaped = shapeSaxLegatoNotes([note(0, 120, 60, 90), note(240, 120, 62, 90)], { ppq: 480 });
    expect(shaped[0].durationTicks as number).toBeGreaterThan(240);
    expect(shaped[0].durationTicks as number).toBeLessThanOrEqual(252);
    expect(shaped[1].velocity).toBeLessThan(90);
  });

  it('连续换指默认不发 portamento CC5/65/84,避免 bebop 线条被听成合成滑音', () => {
    const shaped = shapeSaxLegatoNotes([note(0, 120, 55, 92), note(120, 120, 57, 90), note(240, 240, 60, 94)], { ppq: 480 });
    const cc = buildSaxPortamentoCcEvents(shaped, { ppq: 480 });
    const controllers = new Set(cc.map((e) => e.controller));
    expect(controllers.has(SAX_CC.portamentoOn)).toBe(false);
    expect(controllers.has(SAX_CC.portamentoTime)).toBe(false);
    expect(controllers.has(SAX_CC.portamentoControl)).toBe(false);
    expect(cc).toEqual([]);
  });

  it('连续 bebop 线条默认不生成 pitch bend,音准优先且不把换指误写成滑音', () => {
    const shaped = shapeSaxLegatoNotes([
      note(0, 120, 55, 92),
      note(120, 120, 57, 90),
      note(240, 120, 58, 88),
      note(360, 240, 60, 94),
    ], { ppq: 480 });
    const bends = buildSaxPitchBendEvents(shaped, { ppq: 480 });
    expect(bends).toEqual([]);
  });

  it('连吹第二个音不重新低气压起音,前一音也不做收气 release', () => {
    const shaped = shapeSaxLegatoNotes([note(0, 120, 60, 92), note(240, 360, 62, 92)], { ppq: 480 });
    const cc = buildSaxBreathCcEvents(shaped, { ppq: 480 });
    const expr = cc.filter((e) => e.controller === SAX_CC.expression);
    const firstStart = expr.find((e) => e.atTick === ticks(0))!;
    const secondStart = expr.find((e) => e.atTick === ticks(240))!;
    expect(secondStart.value).toBeGreaterThan(firstStart.value + 12);
    expect(expr.some((e) => (e.atTick as number) > 120 && (e.atTick as number) < 240 && e.value < secondStart.value - 8)).toBe(false);
  });

  it('快速 16 分 bebop 线条在同一气口内保持高气压,不是每音重启 attack', () => {
    const shaped = shapeSaxLegatoNotes([
      note(0, 120, 55, 92),
      note(120, 120, 57, 90),
      note(240, 120, 58, 88),
      note(360, 240, 60, 94),
    ], { ppq: 480 });
    const expr = buildSaxBreathCcEvents(shaped, { ppq: 480 }).filter((e) => e.controller === SAX_CC.expression);
    const starts = [0, 120, 240, 360].map((tick) => expr.find((e) => e.atTick === ticks(tick))!.value);
    expect(starts[1]).toBeGreaterThan(starts[0] + 1);
    expect(starts[2]).toBeGreaterThan(starts[0] + 1);
    expect(starts[3]).toBeGreaterThan(starts[0] + 1);
    expect((shaped[0].startTick as number) + (shaped[0].durationTicks as number)).toBeGreaterThan(120);
    expect((shaped[1].startTick as number) + (shaped[1].durationTicks as number)).toBeGreaterThan(240);
  });

  it('事件确定性、排序稳定、值域合法且都落在音符内部', () => {
    const notes = [note(0, 960, 60, 90), note(960, 180, 62, 78), note(1200, 720, 64, 100)];
    const cc = buildSaxBreathCcEvents(notes, { ppq: 480 });
    expect(buildSaxBreathCcEvents(notes, { ppq: 480 })).toEqual(cc);
    for (let i = 1; i < cc.length; i++) {
      expect(cc[i].atTick as number).toBeGreaterThanOrEqual(cc[i - 1].atTick as number);
    }
    for (const e of cc) {
      expect(e.value).toBeGreaterThanOrEqual(0);
      expect(e.value).toBeLessThanOrEqual(127);
      expect(Number.isInteger(e.value)).toBe(true);
      expect(e.atTick as number).toBeLessThan(1920);
    }
  });

  it('同 tick+同 controller 去重,避免控制器流爆量', () => {
    const cc = buildSaxBreathCcEvents([note(0, 1, 60, 90)], { ppq: 480 });
    const keys = cc.map((e) => `${e.atTick as number}:${e.controller}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
