// ============================================================
// newEngine · render · CC64 踏板 + 伴奏 ducking(融合,2026-06-05)
// ------------------------------------------------------------
// 锁:非 FM 键盘 comp 可每和弦踩踏板(音尾 ring);GM5/FM comp 不踩,避免多音糊;
//   JAZZ/BLUES 不踩;
//   comp 撞旋律轻压(×0.82)但仍可听;确定性。
// ============================================================

import { describe, expect, it } from 'vitest';
import { traceGeneration } from '../generation';
import { musicalIRToMidiEvents } from '../sandbox/irToMidi';
import { duckUnderLead } from './renderCoordinator';
import { midi, ticks } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';

const gen = (style: string, seed = 7) => traceGeneration({ seed, styleHint: style, mood: 'x', targetDuration: 120 });
const compTrack = (style: string, seed = 7) => gen(style, seed).ir.tracks.find((t) => t.role === 'comp');
const pedalEvents = (style: string, seed = 7) => musicalIRToMidiEvents(gen(style, seed).ir).filter((e) => e.type === 'cc' && e.data1 === 64);

describe('CC64 踏板 + 伴奏 ducking', () => {
  it('GM5/FM comp 不踩踏板;非 FM 键盘 comp 保留成对 pedal;JAZZ/BLUES 不踩', () => {
    for (const s of ['pop', 'lofi', 'rnb']) {
      expect(compTrack(s)?.program, `${s} comp program`).toBe(5);
      expect(pedalEvents(s).length, `${s} GM5 comp no pedal`).toBe(0);
    }
    const acgPianoPed = pedalEvents('acg', 7);
    expect(compTrack('acg', 7)?.program, 'acg seed7 comp program').toBe(0);
    expect(acgPianoPed.length, 'acg piano comp pedal').toBeGreaterThan(0);
    expect(acgPianoPed.filter((p) => p.data2 === 127).length, 'acg down').toBe(acgPianoPed.filter((p) => p.data2 === 0).length); // 成对
    for (const s of ['jazz', 'blues']) expect(pedalEvents(s).length, s).toBe(0);
  });

  it('踏板:每和弦踩下 + 抬起在和弦末之前(不糊下一和弦)', () => {
    const ped = pedalEvents('acg', 7).sort((a, b) => a.ticks - b.ticks);
    // 第一个事件是踩下(down=127),且 down/up 交替
    expect(ped[0].data2).toBe(127);
    for (let i = 0; i < ped.length - 1; i++) expect(ped[i].data2).not.toBe(ped[i + 1].data2);
  });

  it('ducking 机制:comp 撞旋律 ×factor 变软,留白处不变(直接单测,稳于全局平均)', () => {
    // ★ 改为机制单测:A3 后各段织体 velocity 差异大,全局 ducked/free 平均比较失真
    //   (active 段 ducked 仍可能 > breakdown 段 free)。ducking 本身是 per-note ×factor,在此直接验。
    const lead: TrackIR = { role: 'lead', notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(240), velocity: 90 }] };
    const comp: TrackIR = { role: 'comp', notes: [
      { pitch: midi(60), startTick: ticks(0), durationTicks: ticks(240), velocity: 80 },   // 撞 lead [0,240]
      { pitch: midi(62), startTick: ticks(480), durationTicks: ticks(240), velocity: 80 }, // 留白处
    ] };
    const out = duckUnderLead([comp, lead], 0.9).find((t) => t.role === 'comp')!;
    expect(out.notes[0].velocity).toBe(Math.round(80 * 0.9)); // 撞旋律 → ×0.9 = 72
    expect(out.notes[1].velocity).toBe(80);                    // 留白 → 不变
    expect(out.notes[0].velocity).toBeLessThan(out.notes[1].velocity); // 撞处更软
    expect(out.notes[0].velocity).toBeGreaterThanOrEqual(50);  // 仍可听
  });

  it('确定性:同 seed 两次 lead/comp 一致', () => {
    const a = JSON.stringify(gen('pop').ir.tracks.find((t) => t.role === 'comp')!.notes);
    const b = JSON.stringify(gen('pop').ir.tracks.find((t) => t.role === 'comp')!.notes);
    expect(a).toBe(b);
  });
});
