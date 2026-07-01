// ============================================================
// newEngine · render · ACG lead 落点塑形(忠实 port MG tuckAcgMelodyLandings,musicEngine.ts:7134-7181)
// ------------------------------------------------------------
// MG 对 ACG 旋律做【落点塑形】(不是替换生成 —— MG 的 topline 系统 shapeAcgTopVoiceOwnership 是死代码,从不调用;
// 真实 ACG 旋律 = grammar 生成 + shapeTopVoicePianoTouch 塑形流水线,tuck 是其首步):
//   ① 音域上浮:低于 A4(69)的旋律音逐八度上移进 soprano [69,86]。
//   ② 落点重定位:主落点移到【comp 琶音 apex 之后 72ms】—— 旋律在和弦"绽放"后进入(电影钢琴招牌相位)。
//   ③ 瘦身:落点周围的碎音删掉(留结构落点)→ 稀疏歌唱句,不是连续跑动。
//   ④ 锁时值:落点延到下一音/bar 末。
// 需 comp(算 apex)→ 放 late 塑形阶段(lead/comp 都 final 后)。只 ACG、只改 lead。
// ============================================================

import { ticks, midi, type Ticks } from '../foundation';
import type { TrackIR, NoteIR } from '../ir/MusicalIR';

const st = (n: NoteIR) => n.startTick as number;
const du = (n: NoteIR) => n.durationTicks as number;
const pit = (n: NoteIR) => n.pitch as number;
const MELODY_HIGH = 86;

/** comp 琶音 apex(bar 内 ≥60 的 comp,从 bar 头起连续琶音的最后一个 onset;gap>0.56拍断)。返回 tick 或 null。 */
function acgArpeggioApex(comp: readonly NoteIR[], barStart: number, barDur: number, ppq: number): number | null {
  const barEnd = barStart + barDur;
  const chordEv = comp.filter((e) => du(e) > 0 && pit(e) >= 60 && st(e) >= barStart - 1 && st(e) < barEnd - 1).sort((a, b) => st(a) - st(b) || pit(a) - pit(b));
  if (chordEv.length === 0) return null;
  const windowEnd = barStart + Math.min(barDur - 0.22 * ppq, 1.92 * ppq);
  const approach: NoteIR[] = [];
  let prev: NoteIR | null = null;
  for (const e of chordEv) {
    if (st(e) < barStart + 0.015 * ppq) continue;
    if (st(e) > windowEnd) break;
    if (prev && st(e) - st(prev) > 0.56 * ppq && approach.length > 0) break;
    approach.push(e); prev = e;
  }
  return approach.length === 0 ? null : st(approach[approach.length - 1]);
}

/** ACG lead 落点塑形(全 tuck:音域上浮 + 落点重定位到 comp apex 后 + 瘦身 + 锁时值)。 */
export function tuckAcgLead(lead: TrackIR, comp: TrackIR, barTicks: number, ppq: number, bpm: number): TrackIR {
  const B = (beat: number) => beat * ppq;
  const MS = (ms: number) => (ms * bpm / 60000) * ppq;
  const nBars = Math.max(1, Math.ceil(Math.max(0, ...lead.notes.map(st)) / barTicks) + 1);
  const notes = lead.notes.map((n) => ({ ...n, _p: pit(n), _t: st(n), _d: du(n) }));
  const remove = new Set<typeof notes[number]>();

  // ① 音域上浮(无条件,所有 bar)—— MG 把它 apex-gate,但我们无条件上浮给更稳定的 soprano 歌唱(质量取向,偏差极小)。
  for (const n of notes) { while (n._p < 69 && n._p + 12 <= MELODY_HIGH) n._p += 12; }

  for (let bar = 0; bar < nBars; bar++) {
    const barStart = bar * barTicks, barEnd = barStart + barTicks;
    // ②③④ 落点重定位 / 瘦身 / 锁时值:需 comp 琶音 apex(apex===null → 不重排,保原句)。
    const apex = acgArpeggioApex(comp.notes, barStart, barTicks, ppq);
    if (apex === null) continue;
    const inBar = notes.filter((n) => n._d > 0.035 * ppq && n._t >= barStart - 1 && n._t < barEnd - 1)
      .sort((a, b) => a._t - b._t || b._d - a._d);
    if (inBar.length === 0) continue;
    // ② 落点 + ③ 瘦身
    const landing = inBar.find((n) => n._d >= 0.45 * ppq) ?? inBar[0];
    const targetTime = Math.min(barEnd - B(0.22), Math.max(landing._t, apex + MS(72)));
    for (const n of inBar) {
      if (n === landing) continue;
      if (n._t < targetTime - B(0.015)) remove.add(n);
      else if (n._t < targetTime + B(0.68)) remove.add(n);
    }
    landing._t = targetTime;
    // ④ 锁时值
    const nextMel = inBar.filter((n) => n !== landing && !remove.has(n) && n._t > targetTime + B(0.04)).sort((a, b) => a._t - b._t)[0];
    const phraseEnd = nextMel ? nextMel._t - B(0.08) : barEnd - B(0.08);
    const maxHold = Math.max(B(0.30), phraseEnd - landing._t);
    landing._d = Math.max(B(0.18), Math.min(Math.max(landing._d, B(0.72)), maxHold));
  }

  const out = notes.filter((n) => !remove.has(n)).map((n): NoteIR => ({
    pitch: n._p === pit(n) ? n.pitch : midi(n._p),
    startTick: (n._t === st(n) ? n.startTick : ticks(Math.max(0, Math.round(n._t)))) as Ticks,
    durationTicks: (n._d === du(n) ? n.durationTicks : ticks(Math.max(1, Math.round(n._d)))) as Ticks,
    velocity: n.velocity,
  }));
  return { ...lead, notes: out };
}
