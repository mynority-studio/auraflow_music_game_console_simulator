// ============================================================
// Layer 1 · DX7 / Electric-Key Tail(three-layer mix plan, Checkpoint 1)
// ------------------------------------------------------------
// 验收:EP(GM4/5)的尾音先由 note gate 表达；CC72/74 在 Dream 5504
// 具体音色未完成实板标定前不能自动写入，EP 也不能继承 CC64。
// ============================================================

import { describe, it, expect } from 'vitest';
import { gestureExpressionForProgram, applyGestureExpressionToTrack, isElectricKeyProgram } from './gestureExpression';
import { createTimebase, midi, ticks } from '../foundation';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

const TB = createTimebase({ meter: { numerator: 4, denominator: 4 } });
const leadTrack = (program: number): TrackIR => ({
  role: 'lead', program,
  notes: [
    { pitch: midi(72), startTick: ticks(0), durationTicks: ticks(240), velocity: 90 },
    { pitch: midi(74), startTick: ticks(960), durationTicks: ticks(240), velocity: 88 }, // 后有空拍(release 响进来)
  ] as NoteIR[],
} as unknown as TrackIR);

const compTrack = (program: number): TrackIR => ({
  role: 'comp', program,
  notes: [
    { pitch: midi(60), startTick: ticks(0), durationTicks: ticks(480), velocity: 72 },
    { pitch: midi(64), startTick: ticks(0), durationTicks: ticks(480), velocity: 68 },
    { pitch: midi(67), startTick: ticks(0), durationTicks: ticks(480), velocity: 70 },
  ] as NoteIR[],
} as unknown as TrackIR);

describe('Layer 1 · DX7/electric-key tail(Checkpoint 1)', () => {
  it('isElectricKeyProgram:GM4/5=电钢', () => {
    expect(isElectricKeyProgram(4)).toBe(true);
    expect(isElectricKeyProgram(5)).toBe(true);
    expect(isElectricKeyProgram(0)).toBe(false); // 原声钢琴
  });

  it('EP lead(program5):tailPolicy=electric-key-tail · 不自动写 CC72/74/CC64', () => {
    const g = gestureExpressionForProgram('lead', 5, 'pop');
    expect(g.tailPolicy).toBe('electric-key-tail');
    expect(g.releaseCc).toBeUndefined();
    expect(g.pedalPolicy).toBe('none');
    expect(g.ccControllers).not.toContain(72);
    expect(g.ccControllers).not.toContain(74);
    expect(g.ccControllers).not.toContain(64); // ★ lead 永不 blanket pedal
  });

  it('EP comp(program5,pop):禁用 harmonic-change pedal(CC64)与未标定的 CC72/74', () => {
    const g = gestureExpressionForProgram('comp', 5, 'pop');
    expect(g.tailPolicy).toBe('electric-key-tail');
    expect(g.pedalPolicy).toBe('none');
    expect(g.ccControllers).not.toContain(64);
    expect(g.ccControllers).not.toContain(72);
    expect(g.ccControllers).not.toContain(74);
    expect(g.releaseCc).toBeUndefined();
  });

  it('非 EP 键盘 lead(program0 钢琴):tailPolicy=keyboard-natural · 无 CC72', () => {
    const g = gestureExpressionForProgram('lead', 0, 'pop');
    expect(g.tailPolicy).toBe('keyboard-natural');
    expect(g.releaseCc).toBeUndefined();
    expect(g.ccControllers).not.toContain(72);
  });

  it('EP lead 落地:延长短 gate 并执行既有 soft 触键，不写未标定 CC', () => {
    const track = leadTrack(5);
    const g = gestureExpressionForProgram('lead', 5, 'lofi');
    const out = applyGestureExpressionToTrack(track, g, TB);
    expect(out.notes.map((n) => [n.pitch, n.startTick, n.durationTicks, n.velocity]))
      .toEqual([
        [midi(72), ticks(0), ticks(960), 81],
        [midi(74), ticks(960), ticks(240), 79],
      ]);
    expect((out.ccEvents ?? []).some((e) => e.controller === 72 || e.controller === 74 || e.controller === 64)).toBe(false);
    // 乐器尾音不由 reverb/chorus send(CC91/93)伪造—— 分层
    expect((out.ccEvents ?? []).some((e) => e.controller === 91 || e.controller === 93)).toBe(false);
  });

  it('EP comp 落地:不写未标定的 Sound Controller,且不混入 reverb/chorus send', () => {
    const out = applyGestureExpressionToTrack(compTrack(5), gestureExpressionForProgram('comp', 5, 'pop'), TB);
    expect((out.ccEvents ?? []).some((e) => [64, 72, 74].includes(e.controller))).toBe(false);
    expect((out.ccEvents ?? []).some((e) => e.controller === 91 || e.controller === 93)).toBe(false);
  });

  it('非 EP lead(钢琴)落地:不发 CC72', () => {
    const out = applyGestureExpressionToTrack(leadTrack(0), gestureExpressionForProgram('lead', 0, 'pop'), TB);
    expect((out.ccEvents ?? []).some((e) => e.controller === 72)).toBe(false);
  });

  it('同轨分段换进/换出 EP:不由手势层伪造 CC72/CC74 参数切换', () => {
    const track: TrackIR = {
      ...leadTrack(0),
      programChanges: [
        { atTick: ticks(960), program: 5 },
        { atTick: ticks(1920), program: 0 },
      ],
    };
    const out = applyGestureExpressionToTrack(track, gestureExpressionForProgram('lead', 0, 'pop'), TB);
    expect((out.ccEvents ?? []).filter((e) => e.controller === 72 || e.controller === 74)).toEqual([]);
  });
});
