// ============================================================
// newEngine · render · 气声 lead 气口减弱(2026-06-11,用户)
// ============================================================
import { describe, it, expect } from 'vitest';
import { isWindFamily, windBreathCcEvents } from './windBreath';
import { traceGeneration } from '../generation';
import { createTimebase, midi, ticks, type Timebase } from '../foundation';
import type { NoteIR } from '../ir/MusicalIR';

const tb: Timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
const note = (start: number, dur: number, pitch = 72): NoteIR => ({ pitch: midi(pitch), startTick: ticks(start), durationTicks: ticks(dur), velocity: 90 });

describe('render/windBreath — isWindFamily', () => {
  it('GM 72-79 = 气声管乐;其余否', () => {
    for (const p of [72, 73, 74, 75, 77, 79]) expect(isWindFamily(p), `GM${p}`).toBe(true);
    for (const p of [0, 4, 11, 12, 40, 56, 71, 80]) expect(isWindFamily(p), `GM${p}`).toBe(false);
  });
});

describe('render/windBreath — CC11 气口包络', () => {
  it('每音起点复位满气(FULL=112)', () => {
    const cc = windBreathCcEvents([note(0, 240), note(480, 240), note(960, 240)], tb);
    for (const start of [0, 480, 960]) {
      const e = cc.find((x) => x.atTick === start)!;
      expect(e.value).toBe(112);
      expect(e.controller).toBe(11);
    }
  });

  it('短音(< 1.25 拍)不减弱(只 1 个起点 FULL)', () => {
    const cc = windBreathCcEvents([note(0, 240)], tb); // 0.5 拍
    expect(cc.length).toBe(1);
    expect(cc[0].value).toBe(112);
  });

  it('★ 长音尾部 ramp FULL→SOFT(气口减弱),且全在音内、单调下降', () => {
    const cc = windBreathCcEvents([note(0, 1920)], tb); // 4 拍长音
    expect(cc.length).toBeGreaterThan(1);
    expect(cc[0]).toEqual({ atTick: 0, controller: 11, value: 112 }); // 起点满气
    const taper = cc.slice(1);
    // 单调下降到 ~SOFT
    for (let i = 1; i < taper.length; i++) expect(taper[i].value).toBeLessThanOrEqual(taper[i - 1].value);
    expect(taper[taper.length - 1].value).toBeLessThan(112);   // 确实减弱了
    expect(taper[taper.length - 1].value).toBeGreaterThanOrEqual(60); // 不至于全静音
    for (const e of taper) { expect(e.atTick).toBeGreaterThan(0); expect(e.atTick).toBeLessThan(1920); } // 全在音内
  });

  it('确定性 + 同 tick 去重(后者覆盖)', () => {
    const notes = [note(0, 1920), note(1920, 240)]; // 长音尾减弱 @接近1920,下一音@1920 复位 FULL
    const cc = windBreathCcEvents(notes, tb);
    expect(windBreathCcEvents(notes, tb)).toEqual(cc);
    const at1920 = cc.filter((e) => e.atTick === 1920);
    expect(at1920.length).toBe(1);            // 去重
    expect(at1920[0].value).toBe(112);        // 新音满气覆盖减弱尾
  });
});

describe('render/windBreath — 端到端兼容', () => {
  it('生产路径的 sax 气息来自器配 gesture plan,不是旧 pipe-wind GM 判断', () => {
    const sax = traceGeneration({ seed: 1, styleHint: 'jazz', mood: 'build', targetDuration: 90 });
    const lead = sax.ir.tracks.find((t) => t.role === 'lead')!;
    expect(lead.program).toBe(66);
    expect(isWindFamily(lead.program!)).toBe(false); // sax 不走旧 72-79 pipe wind 判定
    const controllers = new Set((lead.ccEvents ?? []).map((e) => e.controller));
    expect(controllers.has(11)).toBe(true);
    expect(controllers.has(2)).toBe(false);
    expect(controllers.has(65)).toBe(false);
    expect(controllers.has(5)).toBe(false);
    expect(controllers.has(84)).toBe(false);
    expect(controllers.has(1)).toBe(false);
    expect(lead.pitchBendEvents).toBeUndefined();
    expect(sax.lines.some((line) => line.includes('lead:sax PC66:sax-breath-legato'))).toBe(true);
  });
});
