// ============================================================
// newEngine · sandbox · MIDI File(.mid SMF format 0 编码,纯字节可测)
// ------------------------------------------------------------
// MusicalIR → Standard MIDI File(单轨 format 0)。复用 musicalIRToMidiEvents
// (raw-default:CC121 + Bank/Program/Note + 原声钢琴 CC11/CC64),加 tempo meta,绝对 tick→delta VLQ。
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

// Stable Dream order: note-off → pedal-off → defaults → bank/program →
// expression → pedal-on → note-on.
function midiOrder(ev: MidiEvent): number {
  if (ev.type === 'noteOff') return 0;
  if (ev.type === 'cc' && ev.data1 === 64 && ev.data2 <= 63) return 1;
  if (ev.type === 'cc' && ev.data1 === 121) return 2;
  if (ev.type === 'cc' && ev.data1 === 0) return 3;
  if (ev.type === 'programChange') return 4;
  if (ev.type === 'cc' && ev.data1 === 11) return 5;
  if (ev.type === 'cc' && ev.data1 === 64 && ev.data2 >= 64) return 6;
  if (ev.type === 'cc' || ev.type === 'pitchBend') return 5;
  if (ev.type === 'noteOn') return 7;
  return 8;
}

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
  const events = musicalIRToMidiEvents(ir, roomWetFor(style ?? 'default'), style);

  const timed: TimedBytes[] = [];
  // tempo meta @ tick0:FF 51 03 + 微秒/四分音符
  const usPerQuarter = Math.round(60_000_000 / Math.max(1, bpm));
  timed.push({
    tick: 0, order: 0,
    bytes: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff],
  });
  // Time signature @ tick0. Without FF58, DAWs silently display every export
  // as 4/4 even when the MusicalIR itself is an explicit 5/4 score.
  const meter = ir.timebase.meter;
  const denominatorPower = Math.round(Math.log2(meter.denominator));
  timed.push({
    tick: 0, order: 0,
    bytes: [0xff, 0x58, 0x04, meter.numerator & 0xff, denominatorPower & 0xff, 24, 8],
  });
  for (const ev of events) {
    const bytes = eventBytes(ev);
    if (bytes) timed.push({ tick: ev.ticks, order: midiOrder(ev), bytes });
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
  // Preserve intentional written silence/tail through EOT as well. Otherwise
  // a 5/4 reference with its last note before the final bar loops in a DAW at
  // the last note-off instead of the declared form boundary.
  const scoreEndTick = Math.max(prevTick, ir.durationTicks as number);
  trackData.push(...vlq(scoreEndTick - prevTick), 0xff, 0x2f, 0x00); // end of track

  const header = [...ascii('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(ppq)]; // format 0, 1 track, division=ppq
  const track = [...ascii('MTrk'), ...u32(trackData.length), ...trackData];
  return new Uint8Array([...header, ...track]);
}
