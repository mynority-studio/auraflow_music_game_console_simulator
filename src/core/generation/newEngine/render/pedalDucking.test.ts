// ============================================================
// newEngine · render · CC64 踏板 + 伴奏 ducking(融合,2026-06-05)
// ------------------------------------------------------------
// 锁:POP/LOFI/RNB comp 每和弦踩踏板(音尾 ring),JAZZ/BLUES 不踩;
//   comp 撞旋律轻压(×0.82)但仍可听;确定性。
// ============================================================

import { describe, expect, it } from 'vitest';
import { traceGeneration } from '../generation';
import { musicalIRToMidiEvents } from '../sandbox/irToMidi';

const gen = (style: string, seed = 7) => traceGeneration({ seed, styleHint: style, mood: 'x', targetDuration: 120 });
const pedalEvents = (style: string) => musicalIRToMidiEvents(gen(style).ir).filter((e) => e.type === 'cc' && e.data1 === 64);

describe('CC64 踏板 + 伴奏 ducking', () => {
  it('POP/LOFI/RNB comp 踩踏板(成对 down/up);JAZZ/BLUES 不踩', () => {
    for (const s of ['pop', 'lofi', 'rnb']) {
      const ped = pedalEvents(s);
      expect(ped.length, s).toBeGreaterThan(0);
      expect(ped.filter((p) => p.data2 === 127).length, `${s} down`).toBe(ped.filter((p) => p.data2 === 0).length); // 成对
    }
    for (const s of ['jazz', 'blues']) expect(pedalEvents(s).length, s).toBe(0);
  });

  it('踏板:每和弦踩下 + 抬起在和弦末之前(不糊下一和弦)', () => {
    const ped = pedalEvents('pop').sort((a, b) => a.ticks - b.ticks);
    // 第一个事件是踩下(down=127),且 down/up 交替
    expect(ped[0].data2).toBe(127);
    for (let i = 0; i < ped.length - 1; i++) expect(ped[i].data2).not.toBe(ped[i + 1].data2);
  });

  it('ducking:comp 撞旋律比留白处软,但仍可听(轻压,未被埋)', () => {
    const t = gen('pop');
    const comp = t.ir.tracks.find((x) => x.role === 'comp')!;
    const lead = t.ir.tracks.find((x) => x.role === 'lead')!;
    const iv = lead.notes.map((n) => [n.startTick as number, (n.startTick as number) + (n.durationTicks as number)] as const);
    const hits = (n: { startTick: number; durationTicks: number }) => {
      const s = n.startTick as number; const e = s + (n.durationTicks as number);
      return iv.some(([a, b]) => s < b && e > a);
    };
    const ducked = comp.notes.filter((n) => hits(n as never));
    const free = comp.notes.filter((n) => !hits(n as never));
    const avg = (a: typeof comp.notes) => (a.length ? Math.round(a.reduce((x, n) => x + (n.velocity as number), 0) / a.length) : 0);
    if (ducked.length && free.length) expect(avg(ducked)).toBeLessThan(avg(free)); // 撞旋律更软
    expect(avg(ducked)).toBeGreaterThanOrEqual(50); // 但仍可听(没压回'听不见')
  });

  it('确定性:同 seed 两次 lead/comp 一致', () => {
    const a = JSON.stringify(gen('pop').ir.tracks.find((t) => t.role === 'comp')!.notes);
    const b = JSON.stringify(gen('pop').ir.tracks.find((t) => t.role === 'comp')!.notes);
    expect(a).toBe(b);
  });
});
