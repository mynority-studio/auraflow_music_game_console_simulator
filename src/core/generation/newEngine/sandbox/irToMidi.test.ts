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
        { role: 'lead', program: 67, notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(240), velocity: 90 }] }, // Baritone Sax
        { role: 'bass', notes: [{ pitch: midi(40), startTick: ticks(0), durationTicks: ticks(240), velocity: 80 }] }, // 无 program
      ],
      timebase, durationTicks: ticks(480),
    });
    const ev = musicalIRToMidiEvents(ir2);
    const leadPc = ev.find((e) => e.type === 'programChange' && e.channel === 1)!;
    const bassPc = ev.find((e) => e.type === 'programChange' && e.channel === 3)!;
    expect(leadPc.data1).toBe(67);  // 用 track.program
    expect(bassPc.data1).toBe(38);  // 缺省收口到 24k nano 包内 Synth Bass 1
  });

  it('带 bank 的轨会在 programChange 前发 CC0/CC32 bank select', () => {
    const ir2 = freezeMusicalIR({
      tracks: [
        {
          role: 'lead',
          bank: 8,
          program: 5,
          programChanges: [{ atTick: ticks(480), bank: 0, program: 0 }],
          notes: [
            { pitch: midi(64), startTick: ticks(0), durationTicks: ticks(240), velocity: 90 },
            { pitch: midi(67), startTick: ticks(480), durationTicks: ticks(240), velocity: 90 },
          ],
        },
      ],
      timebase,
      durationTicks: ticks(960),
    });
    const ev = musicalIRToMidiEvents(ir2);
    const idx = (pred: (e: typeof ev[number]) => boolean) => ev.findIndex(pred);
    const bank8Msb = idx((e) => e.type === 'cc' && e.channel === 1 && e.ticks === 0 && e.data1 === 0);
    const bank8Lsb = idx((e) => e.type === 'cc' && e.channel === 1 && e.ticks === 0 && e.data1 === 32);
    const pc8 = idx((e) => e.type === 'programChange' && e.channel === 1 && e.ticks === 0);
    expect(ev[bank8Msb]).toMatchObject({ data2: 0 });
    expect(ev[bank8Lsb]).toMatchObject({ data2: 8 });
    expect(ev[pc8]).toMatchObject({ data1: 5 });
    expect(bank8Msb).toBeLessThan(bank8Lsb);
    expect(bank8Lsb).toBeLessThan(pc8);

    const bank0Msb = idx((e) => e.type === 'cc' && e.channel === 1 && e.ticks === 480 && e.data1 === 0);
    const bank0Lsb = idx((e) => e.type === 'cc' && e.channel === 1 && e.ticks === 480 && e.data1 === 32);
    const pc0 = idx((e) => e.type === 'programChange' && e.channel === 1 && e.ticks === 480);
    expect(ev[bank0Msb]).toMatchObject({ data2: 0 });
    expect(ev[bank0Lsb]).toMatchObject({ data2: 0 });
    expect(ev[pc0]).toMatchObject({ data1: 0 });
    expect(bank0Lsb).toBeLessThan(pc0);
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

  it('★ 音量:bass 最弱(−25%)· pad 抬起(+30%,用户)· comp fader 补低 velocity · 全合法范围', () => {
    const vol = (ch: number) => cc(ch, 7).data2;
    // bass 降到旋律之下、现为骨干最弱(用户 −25%)
    expect(vol(CH.bass)).toBeLessThan(vol(CH.lead));
    expect(vol(CH.bass)).toBeLessThan(vol(CH.pad));
    // comp fader 高(补它最低的 source velocity)
    expect(vol(CH.comp)).toBeGreaterThanOrEqual(vol(CH.lead));
    // ★ pad CC7 抬起(+30%)即便高于 lead 的【通道音量】,有效响度=CC7×velocity 仍低于 lead
    //   (pad velocity ~35 远低于 lead ~85)→ 软 pad 抬亮但不埋旋律。
    expect(vol(CH.pad)).toBeGreaterThan(vol(CH.bass));
    for (const ch of Object.values(CH)) { expect(vol(ch)).toBeGreaterThan(0); expect(vol(ch)).toBeLessThanOrEqual(127); }
  });

  it('声像:comp 偏左(<64)/ pad 偏右(>64)/ bass·lead·drum 居中(=64)', () => {
    const pan = (ch: number) => cc(ch, 10).data2;
    expect(pan(CH.comp)).toBeLessThan(64);
    expect(pan(CH.pad)).toBeGreaterThan(64);
    expect(pan(CH.bass)).toBe(64);
    expect(pan(CH.lead)).toBe(64);
    expect(pan(CH.drum)).toBe(64);
  });

  it('带 delay 的轨会导出 CC95 给共享 delay bus', () => {
    const delayIR = freezeMusicalIR({
      tracks: [
        {
          role: 'lead',
          program: 5,
          mix: { volume: 92, pan: 64, reverb: 52, chorus: 66, delay: 26 },
          notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(240), velocity: 90 }],
        },
      ],
      timebase,
      durationTicks: ticks(480),
    });
    const delayEvents = musicalIRToMidiEvents(delayIR);
    const delayCC = delayEvents.find((e) => e.type === 'cc' && e.channel === CH.lead && e.data1 === 95);
    const firstNoteOnIndex = delayEvents.findIndex((e) => e.type === 'noteOn' && e.channel === CH.lead);
    const delayCCIndex = delayEvents.findIndex((e) => e === delayCC);

    expect(delayCC).toMatchObject({ ticks: 0, data2: 26 });
    expect(delayCCIndex).toBeGreaterThanOrEqual(0);
    expect(delayCCIndex).toBeLessThan(firstNoteOnIndex);
  });

  it('pitchBendEvents 导出为 14-bit pitchBend MIDI 事件', () => {
    const bendIR = freezeMusicalIR({
      tracks: [
        {
          role: 'lead',
          program: 67,
          pitchBendEvents: [{ atTick: ticks(120), value: 7000 }, { atTick: ticks(180), value: 8192 }],
          notes: [{ pitch: midi(55), startTick: ticks(120), durationTicks: ticks(240), velocity: 90 }],
        },
      ],
      timebase,
      durationTicks: ticks(480),
    });
    const bendEvents = musicalIRToMidiEvents(bendIR).filter((e) => e.type === 'pitchBend');
    expect(bendEvents).toEqual([
      { ticks: ticks(120), type: 'pitchBend', channel: CH.lead, data1: 7000, data2: 0 },
      { ticks: ticks(180), type: 'pitchBend', channel: CH.lead, data1: 8192, data2: 0 },
    ]);
  });
});
