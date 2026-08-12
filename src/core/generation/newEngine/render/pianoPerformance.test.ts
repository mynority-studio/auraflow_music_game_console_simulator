import { describe, it, expect } from 'vitest';
import { humanizePianoBlockChords, isGmAcousticPianoProgram } from './pianoPerformance';
import { midi, ticks } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';

const PPQ = 480;
const chord = (st: number, pitches: number[], vel = 80, dur = PPQ): TrackIR => ({
  role: 'comp',
  notes: pitches.map((p) => ({ pitch: midi(p), startTick: ticks(st), durationTicks: ticks(dur), velocity: vel })),
});

describe('pianoPerformance · 柱式和弦人性化(表情三件套 A)', () => {
  it('声部差异力度:顶音突出/内声收敛/底音持平;自下而上微 roll,release 对齐', () => {
    const [out] = humanizePianoBlockChords([chord(960, [48, 60, 64, 67])], { compProgram: 0, style: 'pop', ppq: PPQ });
    const sorted = [...out.notes].sort((a, b) => (a.pitch as number) - (b.pitch as number));
    expect(sorted[0].velocity).toBe(80);                        // 底音持平
    expect(sorted[1].velocity).toBe(72);                        // 内声 -8
    expect(sorted[3].velocity).toBe(87);                        // 顶音 +7
    const offsets = sorted.map((n) => (n.startTick as number) - 960);
    expect(offsets[0]).toBe(0);                                 // 底音在拍上
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThan(offsets[i - 1]); // 自下而上
    expect(Math.max(...offsets)).toBeLessThanOrEqual(12);       // 总展开 ≤12 tick
    for (const n of sorted) {                                    // release 对齐:end 不超原 end
      expect((n.startTick as number) + (n.durationTicks as number)).toBeLessThanOrEqual(960 + PPQ);
    }
  });

  it('门控:ACG 豁免;非钢琴 program 豁免;LOFI 只做力度不 roll;短促击点不 roll;双音不处理', () => {
    const acg = humanizePianoBlockChords([chord(0, [60, 64, 67])], { compProgram: 0, style: 'acg', ppq: PPQ });
    expect(acg[0].notes.every((n) => (n.startTick as number) === 0 && n.velocity === 80)).toBe(true);
    const strings = humanizePianoBlockChords([chord(0, [60, 64, 67])], { compProgram: 48, style: 'pop', ppq: PPQ });
    expect(strings[0].notes.every((n) => n.velocity === 80)).toBe(true);
    const lofi = humanizePianoBlockChords([chord(0, [60, 64, 67])], { compProgram: 0, style: 'lofi', ppq: PPQ });
    expect(lofi[0].notes.every((n) => (n.startTick as number) === 0)).toBe(true);  // 不 roll
    expect(new Set(lofi[0].notes.map((n) => n.velocity)).size).toBeGreaterThan(1); // 但有力度差异
    const stab = humanizePianoBlockChords([chord(0, [60, 64, 67], 80, 100)], { compProgram: 0, style: 'pop', ppq: PPQ });
    expect(stab[0].notes.every((n) => (n.startTick as number) === 0)).toBe(true);  // <0.4 拍不 roll
    const dyad = humanizePianoBlockChords([chord(0, [60, 67])], { compProgram: 0, style: 'pop', ppq: PPQ });
    expect(dyad[0].notes.every((n) => n.velocity === 80)).toBe(true);              // N<3 原样
  });

  it('确定性:同输入同输出;电钢 program 5 同样人性化', () => {
    const a = humanizePianoBlockChords([chord(1920, [55, 60, 64, 67])], { compProgram: 5, style: 'rnb', ppq: PPQ });
    const b = humanizePianoBlockChords([chord(1920, [55, 60, 64, 67])], { compProgram: 5, style: 'rnb', ppq: PPQ });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(new Set(a[0].notes.map((n) => n.startTick as number)).size).toBeGreaterThan(1); // EP 也 roll
    expect(isGmAcousticPianoProgram(5)).toBe(true);
    expect(isGmAcousticPianoProgram(48)).toBe(false);
  });
});
