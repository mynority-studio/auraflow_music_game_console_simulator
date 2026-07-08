import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHANNELS,
  midiEventToRoutedMessage,
  midiMessageToBytes,
  MIDI_OUT_TRACKS,
  schedulerChannelToRole,
} from './midiOut';

describe('midiOutSandbox/midiOut', () => {
  it('defines five Cubase-facing tracks', () => {
    expect(MIDI_OUT_TRACKS.map((t) => t.role)).toEqual(['lead', 'comp', 'bass', 'pad', 'drum']);
    expect(DEFAULT_CHANNELS).toEqual({ lead: 1, comp: 2, bass: 3, pad: 4, drum: 10 });
  });

  it('encodes Cubase-facing 1..16 channels to raw MIDI 0..15 channels', () => {
    expect(midiMessageToBytes({ type: 'noteOn', channel: 1, data1: 60, data2: 100 })).toEqual([0x90, 60, 100]);
    expect(midiMessageToBytes({ type: 'noteOff', channel: 10, data1: 36, data2: 0 })).toEqual([0x89, 36, 0]);
    expect(midiMessageToBytes({ type: 'cc', channel: 4, data1: 64, data2: 127 })).toEqual([0xb3, 64, 127]);
    expect(midiMessageToBytes({ type: 'programChange', channel: 2, data1: 73 })).toEqual([0xc1, 73]);
  });

  it('maps current scheduler channels to the five Cubase roles', () => {
    expect(schedulerChannelToRole(1)).toBe('lead');
    expect(schedulerChannelToRole(2)).toBe('comp');
    expect(schedulerChannelToRole(3)).toBe('bass');
    expect(schedulerChannelToRole(4)).toBe('pad');
    expect(schedulerChannelToRole(9)).toBe('drum');
    expect(schedulerChannelToRole(15)).toBeNull();
  });

  it('routes real scheduler events onto Cubase-facing output channels', () => {
    expect(midiEventToRoutedMessage({ ticks: 0, type: 'noteOn', channel: 1, data1: 72, data2: 100 })).toEqual({
      role: 'lead',
      message: { type: 'noteOn', channel: 1, data1: 72, data2: 100 },
    });
    expect(midiEventToRoutedMessage({ ticks: 0, type: 'noteOff', channel: 9, data1: 36, data2: 0 })).toEqual({
      role: 'drum',
      message: { type: 'noteOff', channel: 10, data1: 36, data2: 0 },
    });
    expect(midiEventToRoutedMessage({ ticks: 0, type: 'visual', channel: 1, data1: 0, data2: 0 })).toBeNull();
  });
});
