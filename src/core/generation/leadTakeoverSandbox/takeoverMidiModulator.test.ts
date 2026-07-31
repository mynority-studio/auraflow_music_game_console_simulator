import { describe, expect, it } from 'vitest';

import {
  modulateTakeoverMidiMessage,
  TAKEOVER_MIDI_POSITION_NOTES,
  takeoverPadIndexFromMidiNote,
} from './takeoverMidiModulator';

describe('leadTakeoverSandbox/takeoverMidiModulator', () => {
  it('maps C3 through C5 natural keys to the 3x5 reading-order positions', () => {
    expect(TAKEOVER_MIDI_POSITION_NOTES).toEqual([
      48, 50, 52, 53, 55,
      57, 59, 60, 62, 64,
      65, 67, 69, 71, 72,
    ]);
    expect(takeoverPadIndexFromMidiNote(48)).toBe(0); // C3: top-left
    expect(takeoverPadIndexFromMidiNote(60)).toBe(7); // C4: center
    expect(takeoverPadIndexFromMidiNote(72)).toBe(14); // C5: bottom-right
  });

  it('treats the external note as position-only and preserves velocity separately', () => {
    expect(modulateTakeoverMidiMessage({ type: 'noteOn', channel: 2, note: 60, velocity: 87 })).toEqual({
      type: 'down',
      padIndex: 7,
      sourceMidi: 60,
      sourceChannel: 2,
      sourceId: 'webmidi:2:60',
      velocity: 87,
    });
    expect(modulateTakeoverMidiMessage({ type: 'noteOff', channel: 2, note: 60, velocity: 0 })).toMatchObject({
      type: 'up',
      padIndex: 7,
      sourceId: 'webmidi:2:60',
    });
  });

  it('ignores black keys, out-of-range notes, and non-note messages', () => {
    expect(takeoverPadIndexFromMidiNote(49)).toBeNull(); // C#3
    expect(takeoverPadIndexFromMidiNote(47)).toBeNull();
    expect(takeoverPadIndexFromMidiNote(73)).toBeNull();
    expect(modulateTakeoverMidiMessage({ type: 'controlChange', channel: 0, note: 64, velocity: 127 })).toBeNull();
  });
});
