// ============================================================
// Layer 1 · DX7 / Electric-Key Tail(three-layer mix plan, Checkpoint 1)
// ------------------------------------------------------------
// 验收:EP(GM4/5)lead 尾音靠 CC72 release(保 MG parity,不改音符)+ 无 blanket pedal;
//   EP comp 保留 harmonic-change pedal(CC64);tail(CC72)与 reverb/chorus send(CC91/93)分开。
// ============================================================

import { describe, it, expect } from 'vitest';
import { gestureExpressionForProgram, applyGestureExpressionToTrack, isElectricKeyProgram } from './gestureExpression';
import { midi, ticks, type Timebase } from '../foundation';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

const TB: Timebase = { ppq: ticks(480) } as unknown as Timebase;
const leadTrack = (program: number): TrackIR => ({
  role: 'lead', program,
  notes: [
    { pitch: midi(72), startTick: ticks(0), durationTicks: ticks(240), velocity: 90 },
    { pitch: midi(74), startTick: ticks(960), durationTicks: ticks(240), velocity: 88 }, // 后有空拍(release 响进来)
  ] as NoteIR[],
} as unknown as TrackIR);

describe('Layer 1 · DX7/electric-key tail(Checkpoint 1)', () => {
  it('isElectricKeyProgram:GM4/5=电钢', () => {
    expect(isElectricKeyProgram(4)).toBe(true);
    expect(isElectricKeyProgram(5)).toBe(true);
    expect(isElectricKeyProgram(0)).toBe(false); // 原声钢琴
  });

  it('EP lead(program5):tailPolicy=electric-key-tail · releaseCc=72 · 无 blanket pedal(pedalPolicy none·无 CC64)', () => {
    const g = gestureExpressionForProgram('lead', 5, 'pop');
    expect(g.tailPolicy).toBe('electric-key-tail');
    expect(g.releaseCc).toBe(72);
    expect(g.pedalPolicy).toBe('none');
    expect(g.ccControllers).toContain(72);
    expect(g.ccControllers).not.toContain(64); // ★ lead 永不 blanket pedal
  });

  it('EP comp(program5,pop):保留 harmonic-change pedal(CC64)· tailPolicy=electric-key-tail', () => {
    const g = gestureExpressionForProgram('comp', 5, 'pop');
    expect(g.tailPolicy).toBe('electric-key-tail');
    expect(g.pedalPolicy).toBe('harmonic-change');
    expect(g.ccControllers).toContain(64);
    expect(g.releaseCc).toBeUndefined(); // comp 靠 pedal,不靠 CC72
  });

  it('非 EP 键盘 lead(program0 钢琴):tailPolicy=keyboard-natural · 无 CC72', () => {
    const g = gestureExpressionForProgram('lead', 0, 'pop');
    expect(g.tailPolicy).toBe('keyboard-natural');
    expect(g.releaseCc).toBeUndefined();
    expect(g.ccControllers).not.toContain(72);
  });

  it('EP lead 落地:发 CC72 release 增强(>64)· 且【不改音符】(保 MG lead parity)', () => {
    const track = leadTrack(5);
    const g = gestureExpressionForProgram('lead', 5, 'lofi');
    const out = applyGestureExpressionToTrack(track, g, TB);
    // notes 逐字节不变(parity)
    expect(out.notes.map((n) => [n.pitch, n.startTick, n.durationTicks, n.velocity]))
      .toEqual(track.notes.map((n) => [n.pitch, n.startTick, n.durationTicks, n.velocity]));
    // 发了 CC72,值 >64(release 增强)
    const cc72 = (out.ccEvents ?? []).filter((e) => e.controller === 72);
    expect(cc72.length).toBe(1);
    expect(cc72[0].value).toBeGreaterThan(64);
    // tail(CC72)不是 reverb/chorus send(CC91/93)—— 分层
    expect((out.ccEvents ?? []).some((e) => e.controller === 91 || e.controller === 93)).toBe(false);
  });

  it('非 EP lead(钢琴)落地:不发 CC72', () => {
    const out = applyGestureExpressionToTrack(leadTrack(0), gestureExpressionForProgram('lead', 0, 'pop'), TB);
    expect((out.ccEvents ?? []).some((e) => e.controller === 72)).toBe(false);
  });
});
