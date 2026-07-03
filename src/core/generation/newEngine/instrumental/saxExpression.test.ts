import { describe, it, expect } from 'vitest';
import { midi, ticks } from '../foundation';
import type { NoteIR } from '../ir/MusicalIR';
import { buildSaxBreathCcEvents, isSaxProgram, SAX_CC, shapeSaxLegatoNotes } from './saxExpression';

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

  it('每音生成 CC11+CC2 气压包络,长音生成 CC1 vibrato', () => {
    const cc = buildSaxBreathCcEvents([note(0, 960, 57, 96)], { ppq: 480 });
    const controllers = new Set(cc.map((e) => e.controller));
    expect(controllers.has(SAX_CC.expression)).toBe(true);
    expect(controllers.has(SAX_CC.breath)).toBe(true);
    expect(controllers.has(SAX_CC.modulation)).toBe(true);
    expect(cc.some((e) => e.controller === SAX_CC.expression && e.atTick === ticks(0))).toBe(true);
    expect(cc.some((e) => e.controller === SAX_CC.expression && (e.atTick as number) > 0 && (e.atTick as number) < 960)).toBe(true);
  });

  it('连续不同音高会做极短 overlap,模拟 sax 连吹换指', () => {
    const shaped = shapeSaxLegatoNotes([note(0, 120, 60, 90), note(240, 120, 62, 90)], { ppq: 480 });
    expect(shaped[0].durationTicks as number).toBeGreaterThan(240);
    expect(shaped[0].durationTicks as number).toBeLessThan(280);
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
