import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHANNELS,
  midiEventToRoutedMessage,
  midiMessageToBytes,
  MIDI_OUT_TRACKS,
  resolveOutputChannel,
  registerMidiPolyphonyAuditionSender,
  schedulerChannelToRole,
  sendMidiPolyphonyAudition,
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
    expect(midiMessageToBytes({ type: 'pitchBend', channel: 1, data1: 0x2000 })).toEqual([0xe0, 0, 64]);
    expect(midiMessageToBytes({ type: 'pitchBend', channel: 16, data1: 0x3fff })).toEqual([0xef, 127, 127]);
  });

  it('encodes the official PC11 Vibraphone selection on the default lead output channel', () => {
    expect(midiMessageToBytes({ type: 'cc', channel: 1, data1: 0, data2: 0 })).toEqual([0xb0, 0, 0]);
    expect(midiMessageToBytes({ type: 'programChange', channel: 1, data1: 11 })).toEqual([0xc0, 0x0b]);
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

  it('uses channel 1 for every role in five-port mode', () => {
    expect(MIDI_OUT_TRACKS.map((track) => resolveOutputChannel(track.role, 'five-port'))).toEqual([1, 1, 1, 1, 1]);
    expect(midiEventToRoutedMessage(
      { ticks: 0, type: 'noteOn', channel: 9, data1: 36, data2: 100 },
      DEFAULT_CHANNELS,
      'five-port',
    )).toEqual({
      role: 'drum',
      message: { type: 'noteOn', channel: 1, data1: 36, data2: 100 },
    });
  });

  it('forwards engine polyphony auditions only while a MIDI output sender is registered', () => {
    const request = {
      role: 'comp' as const,
      bank: 0,
      program: 4,
      notes: [60, 64, 67],
      velocity: 90,
      volume: 100,
      durationMs: 2200,
    };
    expect(sendMidiPolyphonyAudition(request)).toBe(false);
    const received: typeof request[] = [];
    const unregister = registerMidiPolyphonyAuditionSender((value) => {
      received.push(value as typeof request);
      return true;
    });
    expect(sendMidiPolyphonyAudition(request)).toBe(true);
    expect(received).toEqual([request]);
    unregister();
    expect(sendMidiPolyphonyAudition(request)).toBe(false);
  });
});
