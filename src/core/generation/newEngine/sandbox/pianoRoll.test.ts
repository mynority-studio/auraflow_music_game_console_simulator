import { describe, it, expect } from 'vitest';
import { buildPianoRoll, buildTrackLanes, midiToNoteName, noteLabel, resolveAudibleRoles, ROLE_COLOR } from './pianoRoll';
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

  // —— 逐轨泳道 + 音名(独立弹窗用)——
  it('midiToNoteName:60=C4 / 72=C5 / 61=C#4 / 57=A3', () => {
    expect(midiToNoteName(60)).toBe('C4');
    expect(midiToNoteName(72)).toBe('C5');
    expect(midiToNoteName(61)).toBe('C#4');
    expect(midiToNoteName(57)).toBe('A3');
  });

  it('noteLabel:鼓轨用件名(36=Kick/38=Snare/42=HH),其它用音名', () => {
    expect(noteLabel(36, true)).toBe('Kick');
    expect(noteLabel(38, true)).toBe('Snare');
    expect(noteLabel(42, true)).toBe('HH');
    expect(noteLabel(60, false)).toBe('C4');
  });

  it('★ buildTrackLanes:每轨独立泳道 + 分组(lead=melody / 其它=accomp)+ 时间序音名序列', () => {
    const ir = mkIR([
      { role: 'lead', notes: [
        { pitch: midi(67), startTick: ticks(480), durationTicks: ticks(240), velocity: 90 },
        { pitch: midi(72), startTick: ticks(0), durationTicks: ticks(240), velocity: 90 }, // 故意乱序
      ] },
      { role: 'bass', notes: [{ pitch: midi(36), startTick: ticks(0), durationTicks: ticks(480), velocity: 88 }] },
      { role: 'drum', notes: [{ pitch: midi(36), startTick: ticks(0), durationTicks: ticks(60), velocity: 100 }] },
      { role: 'pad', notes: [] }, // 空轨跳过
    ], 1920);
    const lr = buildTrackLanes(ir, { width: 600, laneHeight: 40 });
    const roles = lr.lanes.map((l) => l.role);
    expect(roles).toEqual(['lead', 'bass', 'drum']); // 空 pad 跳过
    const lead = lr.lanes.find((l) => l.role === 'lead')!;
    expect(lead.group).toBe('melody');
    expect(lr.lanes.find((l) => l.role === 'bass')!.group).toBe('accomp');
    expect(lead.sequence).toEqual(['C5', 'G4']); // 按 startTick 排序:tick0=C5 先,tick480=G4 后
    expect(lr.lanes.find((l) => l.role === 'drum')!.sequence).toEqual(['Kick']); // 鼓件名
    expect(lead.color).toBe(ROLE_COLOR.lead);
  });

  it('★ resolveAudibleRoles:无 solo→放未 mute 轨;有 solo→只放 solo 轨(mute 被 solo 覆盖)', () => {
    const roles = ['lead', 'comp', 'bass', 'pad', 'drum'];
    // 无 solo,mute bass+drum → 其余可听
    expect(resolveAudibleRoles(roles, new Set(['bass', 'drum']), new Set())).toEqual(new Set(['lead', 'comp', 'pad']));
    // solo lead → 只 lead(即便没 mute 别的)
    expect(resolveAudibleRoles(roles, new Set(), new Set(['lead']))).toEqual(new Set(['lead']));
    // solo 优先级高于 mute:solo lead + mute lead → 仍只 lead 可听
    expect(resolveAudibleRoles(roles, new Set(['lead']), new Set(['lead']))).toEqual(new Set(['lead']));
    // solo 多轨
    expect(resolveAudibleRoles(roles, new Set(), new Set(['lead', 'bass']))).toEqual(new Set(['lead', 'bass']));
    // 全空 → 全可听
    expect(resolveAudibleRoles(roles, new Set(), new Set())).toEqual(new Set(roles));
  });

  it('泳道音符不溢出 laneHeight,x+w ≤ width', () => {
    const ir = mkIR([{ role: 'comp', notes: [
      { pitch: midi(52), startTick: ticks(0), durationTicks: ticks(240), velocity: 70 },
      { pitch: midi(64), startTick: ticks(1680), durationTicks: ticks(240), velocity: 70 },
    ] }], 1920);
    const lr = buildTrackLanes(ir, { width: 400, laneHeight: 50 });
    for (const lane of lr.lanes) for (const n of lane.notes) {
      expect(n.x + n.w).toBeLessThanOrEqual(400 + 0.001);
      expect(n.y + n.h).toBeLessThanOrEqual(50 + 0.001);
    }
  });
});
