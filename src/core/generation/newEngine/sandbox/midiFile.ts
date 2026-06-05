// ============================================================
// newEngine · sandbox · MIDI File(.mid SMF format 0 编码,纯字节可测)
// ------------------------------------------------------------
// MusicalIR → Standard MIDI File(单轨 format 0)。复用 musicalIRToMidiEvents
// (含 programChange + CC7/CC10 混音),加 tempo meta,绝对 tick→delta VLQ。
// 纯函数无 DOM;面板用 downloadMidi 包一层 Blob 下载。
// ============================================================

import type { MidiEvent } from '../../../audio/MidiScheduler';
import type { MusicalIR } from '../ir/MusicalIR';
import { musicalIRToMidiEvents } from './irToMidi';
import { roomWetFor } from './mixProfile';

/** variable-length quantity:7 位一组,大端,非末组高位置 1。 */
export function vlq(n: number): number[] {
  if (n < 0) throw new RangeError(`vlq(): 负数 ${n}`);
  let v = n >>> 0;
  const buf = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    buf.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return buf;
}

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number): number[] => [(n >>> 8) & 0xff, n & 0xff];

// 同 tick 内排序:tempo → programChange → cc → noteOff → noteOn(设置先于发音,off 先于 on)
const ORDER: Record<string, number> = { tempo: 0, programChange: 1, cc: 2, noteOff: 3, noteOn: 4 };

function eventBytes(ev: MidiEvent): number[] | null {
  switch (ev.type) {
    case 'noteOn': return [0x90 | (ev.channel & 0x0f), ev.data1 & 0x7f, ev.data2 & 0x7f];
    case 'noteOff': return [0x80 | (ev.channel & 0x0f), ev.data1 & 0x7f, ev.data2 & 0x7f];
    case 'programChange': return [0xc0 | (ev.channel & 0x0f), ev.data1 & 0x7f];
    case 'cc': return [0xb0 | (ev.channel & 0x0f), ev.data1 & 0x7f, ev.data2 & 0x7f];
    default: return null; // pitchBend/visual 等不写入文件
  }
}

interface TimedBytes { tick: number; order: number; bytes: number[]; }

/** MusicalIR + bpm → SMF(.mid)字节。format 0 单轨,division=ppq。style → 共享房间混响。 */
export function musicalIRToSMF(ir: MusicalIR, bpm: number, style?: string): Uint8Array {
  const ppq = ir.timebase.ppq;
  const events = musicalIRToMidiEvents(ir, roomWetFor(style ?? 'default'));

  const timed: TimedBytes[] = [];
  // tempo meta @ tick0:FF 51 03 + 微秒/四分音符
  const usPerQuarter = Math.round(60_000_000 / Math.max(1, bpm));
  timed.push({
    tick: 0, order: ORDER.tempo,
    bytes: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff],
  });
  for (const ev of events) {
    const bytes = eventBytes(ev);
    if (bytes) timed.push({ tick: ev.ticks, order: ORDER[ev.type] ?? 5, bytes });
  }
  // 稳定排序:tick 升序,同 tick 按 order
  timed.sort((a, b) => (a.tick - b.tick) || (a.order - b.order));

  // 绝对 tick → delta VLQ
  const trackData: number[] = [];
  let prevTick = 0;
  for (const t of timed) {
    const delta = t.tick - prevTick;
    prevTick = t.tick;
    trackData.push(...vlq(delta), ...t.bytes);
  }
  trackData.push(...vlq(0), 0xff, 0x2f, 0x00); // end of track

  const header = [...ascii('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(ppq)]; // format 0, 1 track, division=ppq
  const track = [...ascii('MTrk'), ...u32(trackData.length), ...trackData];
  return new Uint8Array([...header, ...track]);
}
