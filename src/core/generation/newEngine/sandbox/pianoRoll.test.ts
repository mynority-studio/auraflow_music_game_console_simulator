import { describe, it, expect } from 'vitest';
import { buildPianoRoll, ROLE_COLOR } from './pianoRoll';
import { freezeMusicalIR } from '../ir/MusicalIR';
import { createTimebase, midi, ticks } from '../foundation';

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
const mkIR = (tracks: Parameters<typeof freezeMusicalIR>[0]['tracks'], dur = 1920) =>
  freezeMusicalIR({ tracks, timebase, durationTicks: ticks(dur) });

describe('sandbox · piano-roll 几何 (6.1)', () => {
  it('每音符一矩形;x/w ∝ tick', () => {
    const ir = mkIR([
      { role: 'lead', notes: [
        { pitch: midi(72), startTick: ticks(0), durationTicks: ticks(480), velocity: 90 },
        { pitch: midi(67), startTick: ticks(960), durationTicks: ticks(960), velocity: 90 },
      ] },
    ], 1920);
    const roll = buildPianoRoll(ir, { width: 1000, height: 200 });
    expect(roll.notes.length).toBe(2);
    expect(roll.notes[0].x).toBe(0);
    expect(roll.notes[0].w).toBeCloseTo((480 / 1920) * 1000); // 250
    expect(roll.notes[1].x).toBeCloseTo((960 / 1920) * 1000); // 500
    expect(roll.notes[1].w).toBeCloseTo((960 / 1920) * 1000); // 500
  });

  it('★ y 随音高翻转:高音 y 更小(在上)', () => {
    const ir = mkIR([
      { role: 'lead', notes: [
        { pitch: midi(60), startTick: ticks(0), durationTicks: ticks(240), velocity: 90 }, // 低
        { pitch: midi(84), startTick: ticks(240), durationTicks: ticks(240), velocity: 90 }, // 高
      ] },
    ]);
    const roll = buildPianoRoll(ir);
    const low = roll.notes.find((n) => n.pitch === 60)!;
    const high = roll.notes.find((n) => n.pitch === 84)!;
    expect(high.y).toBeLessThan(low.y); // 高音在上
    expect(roll.pitchMin).toBe(60);
    expect(roll.pitchMax).toBe(84);
  });

  it('角色配色:各轨用对应颜色', () => {
    const ir = mkIR([
      { role: 'bass', notes: [{ pitch: midi(40), startTick: ticks(0), durationTicks: ticks(240), velocity: 80 }] },
      { role: 'lead', notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(240), velocity: 80 }] },
    ]);
    const roll = buildPianoRoll(ir);
    expect(roll.notes.find((n) => n.role === 'bass')!.color).toBe(ROLE_COLOR.bass);
    expect(roll.notes.find((n) => n.role === 'lead')!.color).toBe(ROLE_COLOR.lead);
  });

  it('鲁棒:空 IR 不崩(notes 空 + 兜底音域),宽度保留', () => {
    const ir = mkIR([{ role: 'lead', notes: [] }], 0);
    const roll = buildPianoRoll(ir, { width: 300, height: 100 });
    expect(roll.notes).toEqual([]);
    expect(roll.width).toBe(300);
    expect(roll.pitchMin).toBeLessThan(roll.pitchMax); // 兜底音域有效(不除零)
  });

  it('矩形不溢出画布:所有 x+w ≤ width,0 ≤ y ≤ height', () => {
    const ir = mkIR([
      { role: 'comp', notes: [
        { pitch: midi(48), startTick: ticks(0), durationTicks: ticks(480), velocity: 70 },
        { pitch: midi(76), startTick: ticks(1440), durationTicks: ticks(480), velocity: 70 },
      ] },
    ], 1920);
    const roll = buildPianoRoll(ir, { width: 500, height: 150 });
    for (const n of roll.notes) {
      expect(n.x + n.w).toBeLessThanOrEqual(500 + 0.001);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y + n.h).toBeLessThanOrEqual(150 + 0.001);
    }
  });
});
