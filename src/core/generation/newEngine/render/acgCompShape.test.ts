import { describe, expect, it } from 'vitest';
import { beats, midi, pc, ticks } from '../foundation';
import type { ChordSpan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import { shapeAcgComp } from './acgCompShape';

const PPQ = 480;
const BAR_TICKS = PPQ * 4;

const note = (pitch: number, startBeat: number, durationBeats = 0.36, velocity = 58): NoteIR => ({
  pitch: midi(pitch),
  startTick: ticks(Math.round(startBeat * PPQ)),
  durationTicks: ticks(Math.round(durationBeats * PPQ)),
  velocity,
});

const timeline: ChordSpan[] = [
  {
    id: 'bar-0', sectionId: 'theme', startBeat: beats(0), durationBeats: beats(4), rootPc: pc(0), quality: 'maj', chordType: 'maj',
    roman: { degree: 1, accidental: 'natural', quality: 'maj' },
  },
  {
    id: 'bar-1', sectionId: 'theme', startBeat: beats(4), durationBeats: beats(4), rootPc: pc(0), quality: 'maj', chordType: 'maj',
    roman: { degree: 1, accidental: 'natural', quality: 'maj' },
  },
];

const inBar = (track: TrackIR, bar: number) => track.notes.filter((event) => {
  const at = event.startTick as number;
  return at >= bar * BAR_TICKS && at < (bar + 1) * BAR_TICKS;
});

describe('render/acgCompShape · ACG piano score register contract', () => {
  it('lead 在场时 comp 保持中部且不删成空；lead 留白 bar 才保留轻 air', () => {
    const comp: TrackIR = {
      role: 'comp',
      // 两个明显上行手型：第二个 bar 是 lead 留白，顶端可以作为柔和回应而不是抢主题。
      notes: [
        note(48, 0.00), note(55, 0.50), note(60, 1.00), note(70, 1.50),
        note(48, 4.00), note(55, 4.50), note(60, 5.00), note(84, 5.50),
      ],
    };
    const lead: TrackIR = { role: 'lead', notes: [note(84, 0, 3.75, 86)] };

    const shaped = shapeAcgComp(comp, lead, timeline, BAR_TICKS, PPQ, 80, 9);
    const withLead = inBar(shaped, 0);
    const leadRest = inBar(shaped, 1);

    // 不靠删掉 arpeggio 解决碰撞：原始八个分解音仍都在，且高音被八度换到中部。
    expect(shaped.notes.length).toBeGreaterThanOrEqual(comp.notes.length);
    expect(withLead.length).toBeGreaterThanOrEqual(4);
    expect(withLead.every((event) => (event.pitch as number) >= 48 && (event.pitch as number) <= 67)).toBe(true);
    expect(Math.max(...withLead.map((event) => event.pitch as number))).toBeLessThan(84);
    expect(withLead.some((event) => (event.pitch as number) === 58), '高 A♯ 应保 pitch class 并换至 A♯3').toBe(true);

    // 旋律整 bar 留白时可有但仅有中上部 air（C5），不会变成第二条高音主旋律。
    expect(leadRest.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...leadRest.map((event) => event.pitch as number))).toBe(72);
  });

  it('旋律尾音只要跨入下一小节，下一小节的 comp 也不抢顶声部', () => {
    const comp: TrackIR = {
      role: 'comp',
      // G4/A♯4 是前一逻辑会在 "lead rest" bar 放行的高位琶音。
      notes: [note(60, 4.2), note(68, 4.7), note(70, 5.1)],
    };
    const lead: TrackIR = {
      role: 'lead',
      // 前一 bar 的尾音仅跨入 bar 1 一 tick；最终合同仍将它视为 bar 1 有 lead。
      notes: [{ ...note(79, 3.2, 0.8), durationTicks: ticks(PPQ * 0.8 + 1) }],
    };

    const shaped = shapeAcgComp(comp, lead, timeline, BAR_TICKS, PPQ, 80, 9);
    const barOne = inBar(shaped, 1);

    expect(barOne.length).toBeGreaterThan(0);
    expect(Math.max(...barOne.map((event) => event.pitch as number))).toBeLessThanOrEqual(67);
  });
});
