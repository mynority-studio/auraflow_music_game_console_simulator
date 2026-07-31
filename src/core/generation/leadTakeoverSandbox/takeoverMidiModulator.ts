// ============================================================
// leadTakeoverSandbox · Web MIDI position modulator
// ------------------------------------------------------------
// External MIDI never passes its pitch through to Q+T. Natural notes C3..C5
// select one physical 3x5 position; the takeover controller resolves that
// position against its current chord-local safe-note map at playback time.
// ============================================================

import type { ParsedMidiMessage } from '../motifSandbox/midi/webMidi';
import { TAKEOVER_PAD_COUNT } from './padLayout';

export const TAKEOVER_MIDI_POSITION_NOTES = [
  48, 50, 52, 53, 55,
  57, 59, 60, 62, 64,
  65, 67, 69, 71, 72,
] as const;

export interface TakeoverMidiPositionEvent {
  type: 'down' | 'up';
  padIndex: number;
  sourceMidi: number;
  sourceChannel: number;
  sourceId: string;
  velocity: number;
}

const padIndexByMidiNote = new Map<number, number>(
  TAKEOVER_MIDI_POSITION_NOTES.map((midi, padIndex) => [midi, padIndex]),
);

/** C3..C5 natural keys map in reading order: top-left through bottom-right. */
export function takeoverPadIndexFromMidiNote(midi: number): number | null {
  const padIndex = padIndexByMidiNote.get(Math.round(midi));
  return padIndex !== undefined && padIndex >= 0 && padIndex < TAKEOVER_PAD_COUNT ? padIndex : null;
}

/**
 * Converts a raw Web MIDI note event into a Q+T position trigger. The original
 * MIDI pitch is retained only as an input identity for reliable note-off.
 */
export function modulateTakeoverMidiMessage(message: ParsedMidiMessage): TakeoverMidiPositionEvent | null {
  if (message.type !== 'noteOn' && message.type !== 'noteOff') return null;
  const padIndex = takeoverPadIndexFromMidiNote(message.note);
  if (padIndex === null) return null;
  return {
    type: message.type === 'noteOn' ? 'down' : 'up',
    padIndex,
    sourceMidi: message.note,
    sourceChannel: message.channel,
    sourceId: `webmidi:${message.channel}:${message.note}`,
    velocity: Math.max(0, Math.min(127, Math.round(message.velocity))),
  };
}
