import { describe, it, expect } from 'vitest';
import { musicalIRToSMF, vlq } from './midiFile';
import { freezeMusicalIR } from '../ir/MusicalIR';
import { createTimebase, midi, ticks } from '../foundation';
import { parseSMF } from '../../../audio/smfParser';

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } }); // ppq 480
const ir = freezeMusicalIR({
  tracks: [
    { role: 'bass', notes: [{ pitch: midi(36), startTick: ticks(0), durationTicks: ticks(480), velocity: 90 }] },
    { role: 'lead', notes: [{ pitch: midi(72), startTick: ticks(480), durationTicks: ticks(240), velocity: 95 }] },
  ],
  timebase,
  durationTicks: ticks(960),
});

const find = (hay: Uint8Array, needle: number[]): number => {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
};
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe('sandbox · MIDI 文件导出 SMF (6.2)', () => {
  it('VLQ:7 位一组,大端,非末组高位置 1', () => {
    expect(vlq(0)).toEqual([0x00]);
    expect(vlq(127)).toEqual([0x7f]);
    expect(vlq(128)).toEqual([0x81, 0x00]);
    expect(vlq(480)).toEqual([0x83, 0x60]); // 480 = 0b11_1100000 → 0x83 0x60
  });

  const smf = musicalIRToSMF(ir, 120);

  it('MThd 头:format 0 · 1 轨 · division=ppq(480)', () => {
    expect([...smf.slice(0, 4)]).toEqual(ascii('MThd'));
    expect([...smf.slice(4, 8)]).toEqual([0, 0, 0, 6]); // header length 6
    expect([...smf.slice(8, 10)]).toEqual([0, 0]); // format 0
    expect([...smf.slice(10, 12)]).toEqual([0, 1]); // 1 track
    expect([...smf.slice(12, 14)]).toEqual([0x01, 0xe0]); // division 480 = 0x01E0
  });

  it('含 MTrk + tempo meta(FF 51 03,120bpm=500000us)', () => {
    expect(find(smf, ascii('MTrk'))).toBeGreaterThan(0);
    const tempoIdx = find(smf, [0xff, 0x51, 0x03]);
    expect(tempoIdx).toBeGreaterThan(0);
    // 120bpm → 500000us = 0x07A120
    expect([...smf.slice(tempoIdx + 3, tempoIdx + 6)]).toEqual([0x07, 0xa1, 0x20]);
  });

  it('writes the MusicalIR time signature instead of making DAWs assume 4/4', () => {
    expect(find(smf, [0xff, 0x58, 0x04, 4, 2, 24, 8])).toBeGreaterThan(0);
  });

  it('writes a dotted-quarter metronome click for compound 6/8', () => {
    const sixEightIr = freezeMusicalIR({
      tracks: [],
      timebase: createTimebase({ meter: { numerator: 6, denominator: 8 } }),
      durationTicks: ticks(1440),
    });
    expect(find(musicalIRToSMF(sixEightIr, 120), [0xff, 0x58, 0x04, 6, 3, 36, 8])).toBeGreaterThan(0);
  });

  it('含 noteOn/noteOff + 结尾 end-of-track(FF 2F 00)', () => {
    expect(find(smf, [0x90 | 1, 72, 95])).toBeGreaterThan(0); // lead noteOn ch1 pitch72 vel95
    expect(find(smf, [0x80 | 3, 36, 0])).toBeGreaterThan(0);  // bass noteOff ch3 pitch36
    expect([...smf.slice(smf.length - 3)]).toEqual([0xff, 0x2f, 0x00]); // EOT
  });

  it('keeps the declared IR duration through end-of-track rather than cutting at the final note-off', () => {
    // Fixture's final note-off is tick 720; durationTicks is 960, so EOT has a
    // 240-tick (VLQ 81 70) silent tail before it.
    expect([...smf.slice(-5)]).toEqual([0x81, 0x70, 0xff, 0x2f, 0x00]);
  });

  it('MTrk 长度字段 = 实际 track 数据字节数(自洽)', () => {
    const mtrk = find(smf, ascii('MTrk'));
    const len = (smf[mtrk + 4] << 24) | (smf[mtrk + 5] << 16) | (smf[mtrk + 6] << 8) | smf[mtrk + 7];
    expect(mtrk + 8 + len).toBe(smf.length); // 头(14)+MTrk头(8)+数据 = 文件尾
  });

  it('确定性:同 IR+bpm 两次导出字节完全一致', () => {
    expect([...musicalIRToSMF(ir, 120)]).toEqual([...musicalIRToSMF(ir, 120)]);
  });

  it('ACG 导出保留钢琴左手的非零 Program，而不回退成真实 Bass', () => {
    const acgPianoIr = freezeMusicalIR({
      tracks: [{
        role: 'bass',
        bank: 8,
        program: 4, // Soft Electric Piano: ACG piano palette 中最容易暴露 style 遗失的地址
        notes: [{ pitch: midi(40), startTick: ticks(0), durationTicks: ticks(240), velocity: 80 }],
      }],
      timebase,
      durationTicks: ticks(480),
    });
    const events = parseSMF(musicalIRToSMF(acgPianoIr, 120, 'acg')).events;
    const bank = events.find((event) => event.type === 'cc' && event.channel === 3 && event.data1 === 0);
    const program = events.find((event) => event.type === 'programChange' && event.channel === 3);

    expect(bank).toMatchObject({ data2: 8 });
    expect(program).toMatchObject({ data1: 4 });
  });

  it('原生默认 SMF 在钢琴切换时先抬 CC64，再 bank/program，最后 noteOn', () => {
    const boundary = 480;
    const handoffIr = freezeMusicalIR({
      tracks: [{
        role: 'comp', program: 0, bank: 0,
        programChanges: [{ atTick: ticks(boundary), program: 5, bank: 2 }],
        mix: { volume: 93, pan: 50, reverb: 50, chorus: 0 },
        mixChanges: [{ atTick: ticks(boundary), mix: { volume: 93, pan: 50, reverb: 50, chorus: 0 } }],
        pedalEvents: [{ atTick: ticks(0), down: true }, { atTick: ticks(boundary), down: false }, { atTick: ticks(boundary), down: true }],
        notes: [
          { pitch: midi(60), startTick: ticks(0), durationTicks: ticks(boundary), velocity: 80 },
          { pitch: midi(64), startTick: ticks(boundary), durationTicks: ticks(240), velocity: 80 },
        ],
      }],
      timebase,
      durationTicks: ticks(960),
    });
    const parsed = parseSMF(musicalIRToSMF(handoffIr, 120));
    const atBoundary = parsed.events
      .filter((event) => event.ticks === boundary && event.channel === 2)
      .map((event) => [event.type, event.data1, event.data2]);

    expect(atBoundary).toEqual([
      ['noteOff', 60, 0],
      ['cc', 64, 0],
      ['cc', 0, 2],
      ['programChange', 5, 0],
      ['noteOn', 64, 80],
    ]);
  });
});
