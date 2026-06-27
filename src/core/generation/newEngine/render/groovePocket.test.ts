import { describe, it, expect } from 'vitest';
import { applyGroovePocket, pocketedRoles, type PocketContract } from './groovePocket';
import { ticks, midi } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';

// ============================================================
// MG 升级 Phase 2c part 2 — §7.4 ACG ms-pocket→tick
// ============================================================

const PPQ = 480, BPB = 4, BPM = 120; // 120bpm: 1拍=500ms → 1ms≈0.96 tick

const LEGACY: PocketContract = { bassPocketMs: [0, 0], melodyStrongPocketMs: [0, 0], melodyWeakPocketMs: [0, 0] };
const ACG: PocketContract = { bassPocketMs: [4, 18], melodyStrongPocketMs: [0, 8], melodyWeakPocketMs: [6, 18] };

const note = (tick: number, pitch = 60) => ({ pitch: midi(pitch), startTick: ticks(tick), durationTicks: ticks(240), velocity: 80 });
const tracks = (): TrackIR[] => [
  { role: 'lead', notes: [note(0, 72), note(240, 74), note(480, 76), note(720, 77)] },
  { role: 'bass', notes: [note(0, 36), note(480, 36), note(960, 43)] },
  { role: 'comp', notes: [note(0, 60), note(480, 64)] },
  { role: 'pad', notes: [note(0, 55)] },
];
const starts = (ts: TrackIR[], role: string) => ts.find((t) => t.role === role)!.notes.map((n) => n.startTick as number);

describe('render/groovePocket(MG 升级 2c-2 §7.4)', () => {
  it('★ pocketedRoles:legacy(全 0)→ 空;ACG → {lead,bass}', () => {
    expect(pocketedRoles(LEGACY).size).toBe(0);
    expect([...pocketedRoles(ACG)].sort()).toEqual(['bass', 'lead']);
  });

  it('★ legacy pocket=0 → applyGroovePocket 恒等(非 ACG 零洗牌)', () => {
    const t = tracks();
    const out = applyGroovePocket(t, LEGACY, BPM, PPQ, BPB);
    expect(out).toBe(t); // 早返回同引用
  });

  it('★ ACG:lead+bass onset lay-back(正 pocket → 起音不提前);comp/pad 原样', () => {
    const t = tracks();
    const out = applyGroovePocket(t, ACG, BPM, PPQ, BPB);
    // comp/pad 不动(comp 由 pocketizeBeat 拥有;pad sustain)
    expect(starts(out, 'comp')).toEqual(starts(t, 'comp'));
    expect(starts(out, 'pad')).toEqual(starts(t, 'pad'));
    // lead/bass 每音 ≥ 原(正 pocket 只 lay-back);bass [4,18]ms 必 >0 偏移
    const leadO = starts(out, 'lead'), leadI = starts(t, 'lead');
    leadO.forEach((s, i) => expect(s, `lead[${i}]`).toBeGreaterThanOrEqual(leadI[i]));
    const bassO = starts(out, 'bass'), bassI = starts(t, 'bass');
    bassO.forEach((s, i) => expect(s, `bass[${i}]`).toBeGreaterThan(bassI[i])); // [4,18] 全正 → 必移
    // 偏移量级合理:18ms@120bpm ≈ 17 tick → bass 偏移 ≤ 20 tick
    bassO.forEach((s, i) => expect(s - bassI[i]).toBeLessThanOrEqual(20));
  });

  it('★ 确定性:同输入两次完全一致', () => {
    const s1 = JSON.stringify(applyGroovePocket(tracks(), ACG, BPM, PPQ, BPB).map((t) => starts([t], t.role)));
    const s2 = JSON.stringify(applyGroovePocket(tracks(), ACG, BPM, PPQ, BPB).map((t) => starts([t], t.role)));
    expect(s1).toBe(s2);
  });

  it('★ 负 pocket = push(提前):melodyStrong[-4,-4] → lead 强拍起音 < 原', () => {
    const push: PocketContract = { bassPocketMs: [0, 0], melodyStrongPocketMs: [-4, -4], melodyWeakPocketMs: [0, 0] };
    const t = tracks();
    const out = applyGroovePocket(t, push, BPM, PPQ, BPB);
    // tick 0 与 480 是整拍(强拍)→ 提前(但钳 ≥0,故 tick 0 留 0)
    const leadO = starts(out, 'lead'), leadI = starts(t, 'lead');
    expect(leadO[2]).toBeLessThan(leadI[2]); // 480(强拍)被提前
    expect(leadO[0]).toBe(0);                // 0 钳位不为负
  });
});
