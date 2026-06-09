import { describe, it, expect } from 'vitest';
import { applyMgLofiDenseMelodyComping } from './mgPostMixShaper';
import { createTimebase, ticks, beats } from '../foundation';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { TrackIR } from '../ir/MusicalIR';

const PPQ = 480, BAR = PPQ * 4;
const tb = createTimebase({ meter: { numerator: 4, denominator: 4 } });
// span0 [0,4)=dense, span1 [4,8)=不 dense
const plan = { chordTimeline: [
  { id: 's0', startBeat: beats(0), durationBeats: beats(4) },
  { id: 's1', startBeat: beats(4), durationBeats: beats(4) },
] } as unknown as HarmonicPlan;
const note = (startTick: number, dur = 120, vel = 80, pitch = 60) => ({ pitch: pitch as never, startTick: ticks(startTick), durationTicks: ticks(dur), velocity: vel });

describe('render/mgPostMixShaper · LOFI dense melody comping', () => {
  // span0:12 个旋律音(dense);span1:2 个(不 dense)
  const lead: TrackIR = { role: 'lead', notes: [...Array(12)].map((_, i) => note(i * 150, 120)).concat([note(BAR, 480), note(BAR + 960, 480)]) };
  const comp: TrackIR = { role: 'comp', notes: [note(0, 240), note(480, 240), note(960, 240), note(BAR, 240), note(BAR + 960, 240)] };
  const bass: TrackIR = { role: 'bass', notes: [note(0, 1920, 90, 40), note(480, 480, 90, 40), note(960, 480, 90, 40), note(BAR, 1920, 90, 40)] };
  const out = applyMgLofiDenseMelodyComping([lead, comp, bass], plan, tb);
  const t = (role: string) => out.find((x) => x.role === role)!;

  it('dense 区间(span0)删 comp;非 dense(span1)comp 保留', () => {
    const compNotes = t('comp').notes;
    expect(compNotes.every((n) => (n.startTick as number) >= BAR)).toBe(true); // span0 comp 全删
    expect(compNotes.length).toBe(2); // span1 的 2 个留
  });

  it('dense 区间 bass 减到 1 个,时值≤1.6拍、力度×0.72;非 dense bass 原样', () => {
    const bn = t('bass').notes;
    const s0 = bn.filter((n) => (n.startTick as number) < BAR);
    expect(s0.length).toBe(1);                                  // span0 只留 1 个
    expect(s0[0].startTick).toBe(0);                            // 留第一个
    expect(s0[0].durationTicks as number).toBe(Math.round(1.6 * PPQ)); // 时值缩到 1.6 拍
    expect(s0[0].velocity).toBe(Math.round(90 * 0.72));         // 力度 ×0.72
    const s1 = bn.filter((n) => (n.startTick as number) >= BAR);
    expect(s1.length).toBe(1); expect(s1[0].velocity).toBe(90); // span1 原样
  });

  it('lead 完全不变', () => {
    expect(t('lead')).toBe(lead); // 引用相同 = 未碰
  });

  it('无 dense 区间 → 原样返回', () => {
    const sparse: TrackIR = { role: 'lead', notes: [note(0), note(BAR)] };
    const res = applyMgLofiDenseMelodyComping([sparse, comp, bass], plan, tb);
    expect(res[1]).toBe(comp); expect(res[2]).toBe(bass);
  });
});
