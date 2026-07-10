// smfParser 单测（上传播放批）——两路证伪：
// ① writer↔parser 往返（musicalIRToSMF 输出 → parseSMF → 事件与 writer 输入同源比对）
// ② 手工字节 SMF（独立 oracle）：running status / vel0→noteOff / 多轨合并 /
//    division 重标定 / tempo 缺省与多段变速 warning / format2·SMPTE 拒绝
import { describe, expect, it } from 'vitest';
import { parseSMF } from './smfParser';
import { musicalIRToSMF } from '../generation/newEngine/sandbox/midiFile';
import { freezeMusicalIR } from '../generation/newEngine/ir/MusicalIR';
import { createTimebase, midi, ticks } from '../generation/newEngine/foundation';

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } }); // ppq 480
const ir = freezeMusicalIR({
    tracks: [
        { role: 'bass', notes: [{ pitch: midi(36), startTick: ticks(0), durationTicks: ticks(480), velocity: 90 }] },
        { role: 'lead', notes: [{ pitch: midi(72), startTick: ticks(480), durationTicks: ticks(240), velocity: 95 }] },
    ],
    timebase,
    durationTicks: ticks(960),
});

/** 手工 SMF 构造（独立于 writer）。 */
const bytes = (...xs: Array<number | number[]>): Uint8Array => new Uint8Array(xs.flat());
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const head = (fmt: number, ntrk: number, div: number) =>
    [0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, fmt, 0, ntrk, (div >> 8) & 0xff, div & 0xff];
const trk = (...evs: Array<number | number[]>) => {
    const body = evs.flat();
    return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body];
};

describe('smfParser', () => {
    it('writer↔parser 往返：musicalIRToSMF 输出解析回同源事件', () => {
        const smf = musicalIRToSMF(ir, 120);
        const r = parseSMF(smf);
        expect(r.bpm).toBeCloseTo(120, 6);
        expect(r.division).toBe(480);
        expect(r.noteCount).toBe(2);
        expect(r.warnings).toEqual([]);
        const ons = r.events.filter(e => e.type === 'noteOn');
        expect(ons).toHaveLength(2);
        expect(ons[0]).toMatchObject({ ticks: 0, data1: 36, data2: 90 });      // bass ch/pitch/vel
        expect(ons[1]).toMatchObject({ ticks: 480, data1: 72, data2: 95 });    // lead
        const offs = r.events.filter(e => e.type === 'noteOff');
        expect(offs.map(o => o.ticks).sort((a, b) => a - b)).toEqual([480, 720]);
        // writer 还写入 programChange/CC 混音——解析应保留
        expect(r.events.some(e => e.type === 'programChange')).toBe(true);
    });

    it('running status + vel0→noteOff 规范化', () => {
        // ch0: noteOn 60 v100 → (running) noteOn 64 v0(=off) → (running) noteOn 67 v80
        const smf = bytes(head(0, 1, 480), trk(
            [0x00, 0x90, 60, 100],
            [0x10, 64, 0],        // running status, vel0 → noteOff
            [0x10, 67, 80],       // running status noteOn
            [0x00, 0xff, 0x2f, 0x00],
        ));
        const r = parseSMF(smf);
        expect(r.noteCount).toBe(2);
        expect(r.events.map(e => e.type)).toEqual(['noteOn', 'noteOff', 'noteOn']);
        expect(r.events[1]).toMatchObject({ ticks: 16, data1: 64 });
        expect(r.events[2]).toMatchObject({ ticks: 32, data1: 67, data2: 80 });
    });

    it('division 重标定：ppq96 文件 tick×5 → 480 域', () => {
        const smf = bytes(head(0, 1, 96), trk(
            [0x60, 0x90, 60, 100],   // delta 96(=1 拍@ppq96) → 480
            [0x00, 0xff, 0x2f, 0x00],
        ));
        const r = parseSMF(smf);
        expect(r.events[0].ticks).toBe(480);
        expect(r.durationTicks).toBe(480);
    });

    it('多轨合并（format 1）：tick 稳定排序 + tempo 取首段/多段变速 warning', () => {
        const smf = bytes(head(1, 2, 480),
            trk([0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20],   // 120bpm
                [0x80, 0x60, 0xff, 0x51, 0x03, 0x05, 0x16, 0x15],  // +480tick 处变速 140bpm → 忽略+warning
                [0x00, 0xff, 0x2f, 0x00]),
            trk([0x00, 0x90, 60, 100], [0x00, 0xff, 0x2f, 0x00]),
        );
        const r = parseSMF(smf);
        expect(r.bpm).toBeCloseTo(120, 6);
        expect(r.warnings.some(w => w.includes('变速'))).toBe(true);
        expect(r.trackCount).toBe(2);
        expect(r.events).toHaveLength(1);
    });

    it('无 tempo → 120 缺省 + warning；pitchBend 14bit 合成', () => {
        const smf = bytes(head(0, 1, 480), trk(
            [0x00, 0xe3, 0x00, 0x60],   // ch3 pitchBend lsb=0 msb=0x60 → 0x3000
            [0x00, 0xff, 0x2f, 0x00],
        ));
        const r = parseSMF(smf);
        expect(r.bpm).toBe(120);
        expect(r.warnings.some(w => w.includes('120'))).toBe(true);
        expect(r.events[0]).toMatchObject({ type: 'pitchBend', channel: 3, data1: 0x3000 });
    });

    it('format 2 / SMPTE / 非 SMF 拒绝', () => {
        expect(() => parseSMF(bytes(head(2, 1, 480), trk([0x00, 0xff, 0x2f, 0x00])))).toThrow(/format 2/);
        expect(() => parseSMF(bytes(head(0, 1, 0xe250), trk([0x00, 0xff, 0x2f, 0x00])))).toThrow(/SMPTE/);
        expect(() => parseSMF(bytes([0x00, 0x01, 0x02, 0x03, 0, 0, 0, 6]))).toThrow(/MThd/);
    });

    it('SysEx/未知 meta 跳过；aftertouch 丢弃不报错', () => {
        const smf = bytes(head(0, 1, 480), trk(
            [0x00, 0xf0, 0x03, 0x01, 0x02, 0xf7],   // SysEx len3
            [0x00, 0xff, 0x03, 0x04, 0x54, 0x65, 0x73, 0x74],   // track name meta
            [0x00, 0xa0, 60, 50],   // poly aftertouch → 丢弃
            [0x00, 0xd0, 70],        // channel aftertouch → 丢弃
            [0x00, 0x90, 60, 100],
            [0x00, 0xff, 0x2f, 0x00],
        ));
        const r = parseSMF(smf);
        expect(r.events).toHaveLength(1);
        expect(r.events[0].type).toBe('noteOn');
    });
});
