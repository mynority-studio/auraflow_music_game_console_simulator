import { describe, it, expect } from 'vitest';
import { musicalIRToSMF, vlq } from './midiFile';
import { freezeMusicalIR } from '../ir/MusicalIR';
import { createTimebase, midi, ticks } from '../foundation';

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

  it('含 noteOn/noteOff + 结尾 end-of-track(FF 2F 00)', () => {
    expect(find(smf, [0x90 | 1, 72, 95])).toBeGreaterThan(0); // lead noteOn ch1 pitch72 vel95
    expect(find(smf, [0x80 | 3, 36, 0])).toBeGreaterThan(0);  // bass noteOff ch3 pitch36
    expect([...smf.slice(smf.length - 3)]).toEqual([0xff, 0x2f, 0x00]); // EOT
  });

  it('MTrk 长度字段 = 实际 track 数据字节数(自洽)', () => {
    const mtrk = find(smf, ascii('MTrk'));
    const len = (smf[mtrk + 4] << 24) | (smf[mtrk + 5] << 16) | (smf[mtrk + 6] << 8) | smf[mtrk + 7];
    expect(mtrk + 8 + len).toBe(smf.length); // 头(14)+MTrk头(8)+数据 = 文件尾
  });

  it('确定性:同 IR+bpm 两次导出字节完全一致', () => {
    expect([...musicalIRToSMF(ir, 120)]).toEqual([...musicalIRToSMF(ir, 120)]);
  });
});
