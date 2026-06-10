import { describe, it, expect } from 'vitest';
import { musicalIRToMidiEvents } from './irToMidi';
import { freezeMusicalIR, type TrackMix } from '../ir/MusicalIR';
import { createTimebase, midi, ticks } from '../foundation';

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });

const CC = { volume: 7, pan: 10, reverb: 91, chorus: 93, expression: 11, sustain: 64 } as const;
const CH = { bass: 3, comp: 2, lead: 1, pad: 4, drum: 9 } as const;

const mixA: TrackMix = { volume: 90, pan: 52, reverb: 40, chorus: 58 };
const mixB: TrackMix = { volume: 84, pan: 60, reverb: 30, chorus: 16 };

describe('newEngine/sandbox/irToMidi — ESP32 混音 CC', () => {
  // 全角色都带 mix:验证四个 CC 在 tick0 发齐
  const ir = freezeMusicalIR({
    tracks: (['bass', 'comp', 'pad', 'lead', 'drum'] as const).map((role) => ({
      role,
      mix: { volume: 70, pan: 64, reverb: 20, chorus: 10 } as TrackMix,
      notes: [{ pitch: midi(60), startTick: ticks(0), durationTicks: ticks(240), velocity: 80 }],
    })),
    timebase,
    durationTicks: ticks(480),
  });
  const events = musicalIRToMidiEvents(ir);
  const ccAt = (ch: number, num: number, tick: number) =>
    events.find((e) => e.type === 'cc' && e.channel === ch && e.data1 === num && e.ticks === tick);

  it('CC7/CC10/CC91/CC93 在 tick0 为每条轨发出', () => {
    for (const ch of Object.values(CH)) {
      expect(ccAt(ch, CC.volume, 0), `ch${ch} CC7`).toBeDefined();
      expect(ccAt(ch, CC.pan, 0), `ch${ch} CC10`).toBeDefined();
      expect(ccAt(ch, CC.reverb, 0), `ch${ch} CC91`).toBeDefined();
      expect(ccAt(ch, CC.chorus, 0), `ch${ch} CC93`).toBeDefined();
    }
  });

  it('mix 的值落到 CC data2(读 track.mix,不再用角色默认)', () => {
    expect(ccAt(CH.comp, CC.volume, 0)!.data2).toBe(70);
    expect(ccAt(CH.comp, CC.chorus, 0)!.data2).toBe(10);
  });

  it('CC11(表情)仅在 mix.expression 存在时发出', () => {
    // 默认 mix 无 expression → 无 CC11
    expect(events.find((e) => e.type === 'cc' && e.data1 === CC.expression)).toBeUndefined();
    const ir2 = freezeMusicalIR({
      tracks: [{ role: 'lead', mix: { volume: 80, pan: 64, reverb: 40, chorus: 20, expression: 100 }, notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(240), velocity: 90 }] }],
      timebase, durationTicks: ticks(480),
    });
    const ev2 = musicalIRToMidiEvents(ir2);
    const exp = ev2.find((e) => e.type === 'cc' && e.data1 === CC.expression);
    expect(exp).toBeDefined();
    expect(exp!.data2).toBe(100);
    expect(exp!.ticks).toBe(0);
  });
});

describe('newEngine/sandbox/irToMidi — 段边界 mixChanges + 事件顺序', () => {
  const BOUND = 1920; // 段边界 tick(与 programChange 同 tick)
  const ir = freezeMusicalIR({
    tracks: [{
      role: 'comp',
      program: 4,
      programChanges: [{ atTick: ticks(BOUND), program: 0 }],
      mix: mixA,
      mixChanges: [{ atTick: ticks(BOUND), mix: mixB }],
      notes: [
        { pitch: midi(60), startTick: ticks(0), durationTicks: ticks(240), velocity: 80 },
        { pitch: midi(64), startTick: ticks(BOUND), durationTicks: ticks(240), velocity: 80 }, // 边界处与 pc/cc 同 tick
      ],
    }],
    timebase,
    durationTicks: ticks(BOUND + 480),
  });
  const events = musicalIRToMidiEvents(ir);
  const idxOf = (pred: (e: typeof events[number]) => boolean) => events.findIndex(pred);

  it('programChange 边界发匹配 CC 刷新(同 tick)', () => {
    const ccVolAtBound = events.find((e) => e.type === 'cc' && e.data1 === CC.volume && e.ticks === BOUND);
    const ccChoAtBound = events.find((e) => e.type === 'cc' && e.data1 === CC.chorus && e.ticks === BOUND);
    expect(ccVolAtBound).toBeDefined();
    expect(ccVolAtBound!.data2).toBe(mixB.volume); // 刷新到新段 mix
    expect(ccChoAtBound!.data2).toBe(mixB.chorus);
  });

  it('同 tick:programChange 在 CC 之前', () => {
    const pcIdx = idxOf((e) => e.type === 'programChange' && e.ticks === BOUND);
    const ccIdx = idxOf((e) => e.type === 'cc' && e.ticks === BOUND);
    expect(pcIdx).toBeGreaterThanOrEqual(0);
    expect(ccIdx).toBeGreaterThan(pcIdx);
  });

  it('同 tick:CC 在 noteOn 之前', () => {
    const lastCcIdx = events.reduce((acc, e, i) => (e.type === 'cc' && e.ticks === BOUND ? i : acc), -1);
    const onIdx = idxOf((e) => e.type === 'noteOn' && e.ticks === BOUND);
    expect(lastCcIdx).toBeGreaterThanOrEqual(0);
    expect(onIdx).toBeGreaterThan(lastCcIdx);
  });

  it('tick0:programChange 在 CC 之前,CC 在 noteOn 之前', () => {
    const pc0 = idxOf((e) => e.type === 'programChange' && e.ticks === 0);
    const cc0 = idxOf((e) => e.type === 'cc' && e.ticks === 0);
    const on0 = idxOf((e) => e.type === 'noteOn' && e.ticks === 0);
    expect(pc0).toBeLessThan(cc0);
    expect(cc0).toBeLessThan(on0);
  });
});

describe('newEngine/sandbox/irToMidi — 缺 mix 回退角色默认', () => {
  it('track.mix 缺失 → CC7 走角色默认(comp=93);存在 → 走 mix', () => {
    const ir = freezeMusicalIR({
      tracks: [
        { role: 'comp', notes: [{ pitch: midi(60), startTick: ticks(0), durationTicks: ticks(240), velocity: 80 }] }, // 无 mix
        { role: 'lead', mix: mixA, notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(240), velocity: 80 }] },
      ],
      timebase, durationTicks: ticks(480),
    });
    const ev = musicalIRToMidiEvents(ir);
    const compVol = ev.find((e) => e.type === 'cc' && e.channel === CH.comp && e.data1 === CC.volume)!;
    const leadVol = ev.find((e) => e.type === 'cc' && e.channel === CH.lead && e.data1 === CC.volume)!;
    expect(compVol.data2).toBe(93);          // 角色默认(回退)
    expect(leadVol.data2).toBe(mixA.volume); // 读 mix
    // 回退轨仍发 CC93(默认 chorus=0)
    const compCho = ev.find((e) => e.type === 'cc' && e.channel === CH.comp && e.data1 === CC.chorus)!;
    expect(compCho.data2).toBe(0);
  });
});
