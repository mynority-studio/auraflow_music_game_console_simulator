import { describe, it, expect } from 'vitest';
import { applyWindLeadFeel, isWindLeadProgram } from './windFeel';
import { buildWindLeadCc11Envelopes } from './windExpression';
import type { MgNoteEvent } from './mgMelodyRealizer';
import { midi, ticks } from '../foundation';
import type { NoteIR } from '../ir/MusicalIR';

const ev = (noteNumber: number, time: number, duration: number, velocity = 118): MgNoteEvent =>
  ({ noteNumber, time, duration, velocity, part: 'melody' });

describe('windFeel · 管乐链内 feel(第一层)', () => {
  it('乐句力度成形:天花板压下来、起句轻、句尾收气、峰值突出', () => {
    const out = applyWindLeadFeel([ev(65, 4, 1), ev(69, 5, 1), ev(72, 6, 2), ev(67, 8.5, 1)])
      .filter((e) => e.origin !== 'develop');
    expect(Math.max(...out.map((e) => e.velocity))).toBeLessThanOrEqual(112); // 不再全力吹奏
    expect(out[0].velocity).toBeLessThan(out[2].velocity);                    // 起句 < 峰值(72 长音)
    expect(out[out.length - 1].velocity).toBeLessThan(out[2].velocity);       // 句尾收气
  });

  it('爬音:句首长音前置下方大二度低力度装饰;呼吸:超长连吹被切换气口', () => {
    const out = applyWindLeadFeel([ev(70, 4, 2), ev(72, 6, 2), ev(74, 8, 2), ev(72, 10, 2), ev(70, 12, 2)]);
    const grace = out.find((e) => e.origin === 'develop');
    expect(grace).toBeDefined();
    expect(grace!.noteNumber).toBe(68);                        // 下方大二度
    expect(grace!.time).toBeCloseTo(3.75, 6);                  // 句首前 0.25 拍(16 分网格)
    expect(grace!.velocity).toBeLessThan(70);                  // 低力度
    const mains = out.filter((e) => e.origin !== 'develop');
    const hasBreath = mains.some((e, i) => {
      const next = mains[i + 1];
      return next && next.time - (e.time + e.duration) >= 0.25 - 1e-9;
    });
    expect(hasBreath).toBe(true);                              // 10 拍连吹被切了换气口
  });

  it('门控:GM 管乐族判定;非 melody part 原样', () => {
    expect(isWindLeadProgram(66)).toBe(true);   // tenor sax
    expect(isWindLeadProgram(56)).toBe(true);   // trumpet
    expect(isWindLeadProgram(73)).toBe(true);   // flute
    expect(isWindLeadProgram(0)).toBe(false);
    expect(isWindLeadProgram(80)).toBe(false);
    const bass: MgNoteEvent = { noteNumber: 40, time: 0, duration: 1, velocity: 90, part: 'bass' };
    expect(applyWindLeadFeel([bass])[0]).toEqual(bass);
  });
});

describe('windExpression · CC11 包络(第二层)', () => {
  const PPQ = 480;
  const note = (st: number, dur: number): NoteIR =>
    ({ pitch: midi(70), startTick: ticks(st), durationTicks: ticks(dur), velocity: 90 });

  it('起音软入爬回平台;长音有鼓起与收弧;短音不逐音包络', () => {
    const cc = buildWindLeadCc11Envelopes(
      [note(0, PPQ), note(PPQ, Math.round(PPQ * 0.2)), note(PPQ * 2, PPQ * 2)],
      [{ atTick: 0, value: 90 }], PPQ);
    expect(cc[0]).toMatchObject({ atTick: 0, controller: 11, value: 72 });     // 90-18 软起
    expect(cc.some((e) => e.value === 90)).toBe(true);                          // 爬回平台
    expect(cc.some((e) => e.value === 98)).toBe(true);                          // 长音鼓起 +8
    expect(cc.some((e) => e.value === 84)).toBe(true);                          // 长音收 -6
    expect(cc.filter((e) => e.atTick >= PPQ && e.atTick < PPQ * 1.3).length).toBe(0); // 短音无包络
  });

  it('平台分段生效;相邻等值去重;确定性', () => {
    const a = buildWindLeadCc11Envelopes([note(0, PPQ), note(PPQ * 4, PPQ)],
      [{ atTick: 0, value: 90 }, { atTick: PPQ * 2, value: 70 }], PPQ);
    const late = a.filter((e) => e.atTick >= PPQ * 4);
    expect(late[0].value).toBe(52); // 后段平台 70 → 软起 70-18
    for (let i = 1; i < a.length; i++) expect(a[i].value).not.toBe(a[i - 1].value);
    expect(JSON.stringify(a)).toBe(JSON.stringify(buildWindLeadCc11Envelopes([note(0, PPQ), note(PPQ * 4, PPQ)],
      [{ atTick: 0, value: 90 }, { atTick: PPQ * 2, value: 70 }], PPQ)));
  });
});
