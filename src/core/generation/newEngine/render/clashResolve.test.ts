import { describe, it, expect } from 'vitest';
import { resolveInteractions } from './interactionResolver';
import { voiceComp } from '../knowledge/voicings';
import { createTimebase, midi, ticks } from '../foundation';
import type { MusicalIRData } from '../ir/MusicalIR';
import type { OccupationMap } from './OccupationMap';

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } }); // ppq 480
const occ: OccupationMap = {
  occupiedRegisters: [], // 空 → lead 音域 pass 不动
  onsetTicks: [],
  reservedMelodyRegister: { lowMidi: 60, highMidi: 96 },
};
const n = (pitch: number, start: number, dur: number) => ({ pitch: midi(pitch), startTick: ticks(start), durationTicks: ticks(dur), velocity: 80 });

describe('render · P1-3 修撞音(Resolver voicing-around-melody)', () => {
  it('★ comp 与 lead 实际小二度同响 → 丢该 comp 声部(其余保留)', () => {
    const draft: MusicalIRData = {
      tracks: [
        { role: 'lead', notes: [n(72, 0, 480)] },               // C5
        { role: 'comp', notes: [n(71, 0, 480), n(67, 0, 480)] },// B4(撞 m2)+ G4(不撞)
      ],
      timebase, durationTicks: ticks(480),
    };
    const r = resolveInteractions(draft, occ);
    const comp = r.data.tracks.find((t) => t.role === 'comp')!.notes.map((x) => x.pitch as number);
    expect(comp).not.toContain(71); // 撞音声部被丢
    expect(comp).toContain(67);     // 不撞的保留
    expect(r.adjustments).toBeGreaterThanOrEqual(1);
  });

  it('小九度(13 半音)也算撞音 → 丢;非 1/13 半音不动', () => {
    const draft: MusicalIRData = {
      tracks: [
        { role: 'lead', notes: [n(72, 0, 480)] },
        { role: 'comp', notes: [n(59, 0, 480), n(64, 0, 480)] }, // B3=小九度撞 / E4=不撞
      ],
      timebase, durationTicks: ticks(480),
    };
    const comp = resolveInteractions(draft, occ).data.tracks.find((t) => t.role === 'comp')!.notes.map((x) => x.pitch as number);
    expect(comp).toEqual([64]); // 59 丢,64 留
  });

  it('重叠不足半拍 → 不算撞音(短促擦过不丢)', () => {
    const draft: MusicalIRData = {
      tracks: [
        { role: 'lead', notes: [n(72, 0, 120)] },               // 仅 1/4 拍
        { role: 'comp', notes: [n(71, 0, 480)] },
      ],
      timebase, durationTicks: ticks(480),
    };
    const comp = resolveInteractions(draft, occ).data.tracks.find((t) => t.role === 'comp')!.notes;
    expect(comp.length).toBe(1); // 重叠 <半拍,不丢
  });
});

describe('knowledge · P1-3 声部进行(voiceComp 全声部 voice-leading)', () => {
  it('★ prevVoicing 给定 → 每个新声部贴最近上一声部(总动量小)', () => {
    const prev = [60, 64, 67]; // C E G
    const G7 = [7, 11, 2, 5];  // G B D F
    const led = voiceComp(G7, 'pop', undefined, prev);
    // 每个输出音都在某个 prev 声部 ±6 半音内(最近贴)
    for (const m of led) {
      const nearest = Math.min(...prev.map((p) => Math.abs(m - p)));
      expect(nearest).toBeLessThanOrEqual(6);
    }
    // 全是 chord tone + 落 comp 区
    for (const m of led) { expect(new Set(G7).has(m % 12)).toBe(true); expect(m).toBeGreaterThanOrEqual(52); expect(m).toBeLessThanOrEqual(76); }
  });

  it('voice-led 总动量 ≤ 旧 spread(更连贯)', () => {
    const prev = voiceComp([0, 4, 7, 11], 'pop', 67);     // Cmaj7
    const G7 = [7, 11, 2, 5];
    const led = voiceComp(G7, 'pop', undefined, prev);    // voice-led
    const spread = voiceComp(G7, 'pop', prev[prev.length - 1]); // 旧:顶音贴 + 向下 spread
    const motion = (v: number[]) => v.reduce((s, m) => s + Math.min(...prev.map((p) => Math.abs(m - p))), 0);
    expect(motion(led)).toBeLessThanOrEqual(motion(spread));
  });

  it('无 prevVoicing → 退回顶音 voice-leading(向后兼容,3 参不变)', () => {
    const v = voiceComp([0, 4, 7, 11], 'jazz', 67);
    expect(v.length).toBe(3); // rootless
    expect(v.some((m) => m % 12 === 0)).toBe(false);
  });
});
