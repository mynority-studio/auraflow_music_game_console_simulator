// ============================================================
// leadTakeoverSandbox · Web MIDI position modulator
// ------------------------------------------------------------
// External MIDI never passes its pitch through to Q+T. Natural notes C3..C5
// select one physical 3x5 position; the takeover controller resolves that
// position against its current chord-local safe-note map at playback time.
// ============================================================

import type { ParsedMidiMessage } from '../motifSandbox/midi/webMidi';
import { PAD_POSITION_MIDI_NOTES, padIndexFromPositionNote } from '../motifSandbox/midi/positionInput';
import { TAKEOVER_PAD_COUNT } from './padLayout';

export const TAKEOVER_MIDI_POSITION_NOTES = PAD_POSITION_MIDI_NOTES;

export interface TakeoverMidiPositionEvent {
  type: 'down' | 'up';
  padIndex: number;
  sourceMidi: number;
  sourceChannel: number;
  sourceId: string;
  velocity: number;
}

/** C3..C5 natural keys map in reading order: top-left through bottom-right. */
export function takeoverPadIndexFromMidiNote(midi: number): number | null {
  const padIndex = padIndexFromPositionNote(midi);
  return padIndex !== null && padIndex < TAKEOVER_PAD_COUNT ? padIndex : null;
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
