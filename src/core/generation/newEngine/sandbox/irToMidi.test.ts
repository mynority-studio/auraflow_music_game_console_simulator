import { describe, it, expect } from 'vitest';
import { musicalIRToMidiEvents } from './irToMidi';
import { freezeMusicalIR } from '../ir/MusicalIR';
import { createTimebase, midi, ticks } from '../foundation';

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });

describe('newEngine/sandbox/irToMidi', () => {
  const ir = freezeMusicalIR({
    tracks: [
      { role: 'bass', notes: [{ pitch: midi(36), startTick: ticks(0), durationTicks: ticks(480), velocity: 90 }] },
      { role: 'lead', notes: [{ pitch: midi(72), startTick: ticks(480), durationTicks: ticks(240), velocity: 95 }] },
    ],
    timebase,
    durationTicks: ticks(960),
  });
  const events = musicalIRToMidiEvents(ir);

  it('每轨先发 programChange,再 noteOn/noteOff', () => {
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'programChange').length).toBe(2);
    expect(types.filter((t) => t === 'noteOn').length).toBe(2);
    expect(types.filter((t) => t === 'noteOff').length).toBe(2);
  });

  it('角色 → 通道映射(bass=3 / lead=1)', () => {
    const bassOn = events.find((e) => e.type === 'noteOn' && e.data1 === 36)!;
    const leadOn = events.find((e) => e.type === 'noteOn' && e.data1 === 72)!;
    expect(bassOn.channel).toBe(3);
    expect(leadOn.channel).toBe(1);
  });

  it('tick 直传(PPQ=480 一致);noteOff = start+dur', () => {
    const leadOn = events.find((e) => e.type === 'noteOn' && e.data1 === 72)!;
    const leadOff = events.find((e) => e.type === 'noteOff' && e.data1 === 72)!;
    expect(leadOn.ticks).toBe(480);
    expect(leadOff.ticks).toBe(720); // 480 + 240
  });

  it('velocity 透传到 data2', () => {
    const bassOn = events.find((e) => e.type === 'noteOn' && e.data1 === 36)!;
    expect(bassOn.data2).toBe(90);
  });

  it('★ track.program(BandEngine 选的乐器)优先;缺省走角色默认', () => {
    const ir2 = freezeMusicalIR({
      tracks: [
        { role: 'lead', program: 66, notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(240), velocity: 90 }] }, // TenSax
        { role: 'bass', notes: [{ pitch: midi(40), startTick: ticks(0), durationTicks: ticks(240), velocity: 80 }] }, // 无 program
      ],
      timebase, durationTicks: ticks(480),
    });
    const ev = musicalIRToMidiEvents(ir2);
    const leadPc = ev.find((e) => e.type === 'programChange' && e.channel === 1)!;
    const bassPc = ev.find((e) => e.type === 'programChange' && e.channel === 3)!;
    expect(leadPc.data1).toBe(66);  // 用 track.program
    expect(bassPc.data1).toBe(33);  // 缺省 = Finger Bass 默认
  });

  // —— 混音 (5.4) ——
  const mixIR = freezeMusicalIR({
    tracks: (['bass', 'comp', 'pad', 'lead', 'drum'] as const).map((role) => ({
      role,
      notes: [{ pitch: midi(60), startTick: ticks(0), durationTicks: ticks(240), velocity: 80 }],
    })),
    timebase,
    durationTicks: ticks(480),
  });
  const mixEvents = musicalIRToMidiEvents(mixIR);
  const cc = (channel: number, ccNum: number) =>
    mixEvents.find((e) => e.type === 'cc' && e.channel === channel && e.data1 === ccNum)!;
  // 角色→通道
  const CH = { bass: 3, comp: 2, lead: 1, pad: 4, drum: 9 };

  it('每轨发 CC7(音量)+ CC10(声像),ticks=0 且在 noteOn 前', () => {
    for (const ch of Object.values(CH)) {
      expect(cc(ch, 7)).toBeDefined();
      expect(cc(ch, 10)).toBeDefined();
      expect(cc(ch, 7).ticks).toBe(0);
    }
    // CC 在该通道首个 noteOn 之前
    const firstLeadCCIdx = mixEvents.findIndex((e) => e.type === 'cc' && e.channel === CH.lead);
    const firstLeadOnIdx = mixEvents.findIndex((e) => e.type === 'noteOn' && e.channel === CH.lead);
    expect(firstLeadCCIdx).toBeLessThan(firstLeadOnIdx);
  });

  it('★ 音量均衡 = CC7 补偿各轨 velocity(非 CC7 相等):comp fader 最高(velocity 最低),lead 不顶', () => {
    const vol = (ch: number) => cc(ch, 7).data2;
    // 均衡看【有效响度 = CC7 × velocity】,不是 CC7 相等:comp 源 velocity 最低 → fader 最高补偿
    expect(vol(CH.comp)).toBeGreaterThanOrEqual(vol(CH.lead));
    expect(vol(CH.comp)).toBeGreaterThanOrEqual(vol(CH.bass));
    expect(vol(CH.comp)).toBeGreaterThanOrEqual(vol(CH.pad));
    // lead velocity 高 → fader 拉低,不再最响(用户:lead 不突出、与 comp 平均)
    expect(vol(CH.lead)).toBeLessThanOrEqual(vol(CH.comp));
    expect(vol(CH.lead)).toBeLessThanOrEqual(vol(CH.pad));
    // 全在合法 MIDI 范围
    for (const ch of Object.values(CH)) expect(vol(ch)).toBeGreaterThan(0), expect(vol(ch)).toBeLessThanOrEqual(127);
  });

  it('声像:comp 偏左(<64)/ pad 偏右(>64)/ bass·lead·drum 居中(=64)', () => {
    const pan = (ch: number) => cc(ch, 10).data2;
    expect(pan(CH.comp)).toBeLessThan(64);
    expect(pan(CH.pad)).toBeGreaterThan(64);
    expect(pan(CH.bass)).toBe(64);
    expect(pan(CH.lead)).toBe(64);
    expect(pan(CH.drum)).toBe(64);
  });
});
