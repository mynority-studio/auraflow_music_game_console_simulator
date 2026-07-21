// ============================================================
// videoReplica · Node-safe semantic SMF transport
// ------------------------------------------------------------
// The browser production path remains MusicalIR -> musicalIRToSMF. This small
// transport lets CLI fidelity tools export the same three piano role channels
// without importing the browser-only raw TSV sound-bank registry.
// ============================================================

import type { MusicalIR } from '../ir/MusicalIR';

type ReplicaRole = 'bass' | 'comp' | 'lead';
const CHANNEL: Record<ReplicaRole, number> = { bass: 3, comp: 2, lead: 1 };

interface TimedBytes { tick: number; order: number; bytes: number[]; }

const u16 = (value: number): number[] => [(value >>> 8) & 0xff, value & 0xff];
const u32 = (value: number): number[] => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const ascii = (value: string): number[] => [...value].map((character) => character.charCodeAt(0));

function vlq(value: number): number[] {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`Invalid MIDI delta ${value}`);
  const bytes = [value & 0x7f];
  for (let remaining = value >>> 7; remaining > 0; remaining >>>= 7) bytes.unshift((remaining & 0x7f) | 0x80);
  return bytes;
}
/** SMF format 0; performed ticks pass through and roles remain separate. */
export function videoReplicaToSMF(ir: MusicalIR, bpm: number): Uint8Array {
  const timed: TimedBytes[] = [
    { tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, ...u32(Math.round(60_000_000 / bpm)).slice(1)] },
    { tick: 0, order: 0, bytes: [0xff, 0x58, 0x04, ir.timebase.meter.numerator, Math.log2(ir.timebase.meter.denominator), 24, 8] },
  ];
  for (const track of ir.tracks) {
    if (track.role !== 'bass' && track.role !== 'comp' && track.role !== 'lead') continue;
    const channel = CHANNEL[track.role];
    timed.push({ tick: 0, order: 2, bytes: [0xb0 | channel, 0, (track.bank ?? 0) & 0x7f] });
    timed.push({ tick: 0, order: 3, bytes: [0xc0 | channel, (track.program ?? 0) & 0x7f] });
    for (const note of track.notes) {
      const startTick = note.startTick as number;
      timed.push({ tick: startTick, order: 4, bytes: [0x90 | channel, note.pitch & 0x7f, note.velocity & 0x7f] });
      timed.push({ tick: startTick + (note.durationTicks as number), order: 1, bytes: [0x80 | channel, note.pitch & 0x7f, 0] });
    }
  }
  timed.sort((left, right) => (left.tick - right.tick) || (left.order - right.order));
  let previousTick = 0;
  const body: number[] = [];
  for (const event of timed) {
    body.push(...vlq(event.tick - previousTick), ...event.bytes);
    previousTick = event.tick;
  }
  body.push(...vlq(Math.max(previousTick, ir.durationTicks as number) - previousTick), 0xff, 0x2f, 0x00);
  return new Uint8Array([
    ...ascii('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(ir.timebase.ppq),
    ...ascii('MTrk'), ...u32(body.length), ...body,
  ]);
}
