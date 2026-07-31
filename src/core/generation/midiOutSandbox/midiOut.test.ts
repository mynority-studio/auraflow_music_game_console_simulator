import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHANNELS,
  DREAM5504_RAW_DEFAULT_OUTPUT,
  isDream5504RawDefaultMessageAllowed,
  midiEventToRoutedMessage,
  midiMessageToBytes,
  MIDI_OUT_TRACKS,
  resolveOutputChannel,
  resolveSchedulerOutputChannel,
  registerMidiPolyphonyAuditionSender,
  schedulerChannelToRole,
  sendNrpn7,
  sendDream5504NeutralOutputBaseline,
  sendPanic,
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

  it('uses one hardware-channel claim model for generated and uploaded MIDI events', () => {
    const generatedLead = midiEventToRoutedMessage(
      { ticks: 0, type: 'noteOn', channel: 1, data1: 60, data2: 100 },
    );
    const uploadedChannelOne = midiEventToRoutedMessage(
      { ticks: 0, type: 'noteOn', channel: 0, data1: 60, data2: 100, outputChannel: 1 },
    );
    expect(uploadedChannelOne).toEqual(generatedLead);
    expect(midiEventToRoutedMessage(
      { ticks: 0, type: 'cc', channel: 9, data1: 91, data2: 72, outputChannel: 10 },
    )).toEqual({
      role: 'drum',
      message: { type: 'cc', channel: 10, data1: 91, data2: 72 },
    });
    expect(midiEventToRoutedMessage(
      { ticks: 0, type: 'pitchBend', channel: 15, data1: 0x2345, data2: 0, outputChannel: 16 },
    )).toEqual({
      role: 'lead',
      message: { type: 'pitchBend', channel: 16, data1: 0x2345, data2: 0 },
    });
  });

  it('keeps official 5504 role channels in five-port upstream routing', () => {
    expect(MIDI_OUT_TRACKS.map((track) => resolveOutputChannel(track.role, 'five-port'))).toEqual([1, 2, 3, 4, 10]);
    expect(midiEventToRoutedMessage(
      { ticks: 0, type: 'noteOn', channel: 9, data1: 36, data2: 100 },
      DEFAULT_CHANNELS,
      'five-port',
    )).toEqual({
      role: 'drum',
      message: { type: 'noteOn', channel: 10, data1: 36, data2: 100 },
    });
  });

  it('never changes role channels between single-port and five-port routing', () => {
    expect(MIDI_OUT_TRACKS.map((track) => resolveOutputChannel(track.role, 'single-port')))
      .toEqual(MIDI_OUT_TRACKS.map((track) => resolveOutputChannel(track.role, 'five-port')));
  });

  it('keeps realtime audition channel 15 on MIDI channel 16 instead of overwriting Lead', () => {
    expect(resolveSchedulerOutputChannel(15, 'single-port')).toBe(16);
    expect(resolveSchedulerOutputChannel(15, 'five-port')).toBe(16);
    expect(resolveSchedulerOutputChannel(1, 'single-port')).toBe(1);
    expect(resolveSchedulerOutputChannel(9, 'single-port')).toBe(10);
  });

  it('forwards engine polyphony auditions only while a MIDI output sender is registered', () => {
    const request = {
      role: 'comp' as const,
      bank: 0,
      program: 4,
      notes: [60, 64, 67],
      velocity: 90,
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

  it('panic only sends transport safety reset and centered pitch bend', () => {
    const sent: number[][] = [];
    const output = { send: (bytes: number[]) => sent.push([...bytes]) } as unknown as MIDIOutput;
    sendPanic(output, 0);

    for (let rawChannel = 0; rawChannel < 16; rawChannel++) {
      const status = 0xb0 | rawChannel;
      const channelMessages = sent.filter((bytes) => (bytes[0] & 0x0f) === rawChannel);
      expect(channelMessages, `raw ch${rawChannel}`).toEqual([
        [status, 64, 0],
        [status, 120, 0],
        [status, 123, 0],
        [status, 121, 0],
        [0xe0 | rawChannel, 0, 64],
      ]);
    }
  });

  it('generated raw-default policy admits the LOFI channel mix macro but still blocks unrelated processing', () => {
    expect(DREAM5504_RAW_DEFAULT_OUTPUT).toBe(true);
    expect(isDream5504RawDefaultMessageAllowed({ type: 'noteOn', channel: 1, data1: 60, data2: 90 })).toBe(true);
    expect(isDream5504RawDefaultMessageAllowed({ type: 'programChange', channel: 1, data1: 5 })).toBe(true);
    expect(isDream5504RawDefaultMessageAllowed({ type: 'cc', channel: 1, data1: 0, data2: 16 })).toBe(true);
    expect(isDream5504RawDefaultMessageAllowed({ type: 'cc', channel: 4, data1: 1, data2: 28 })).toBe(false);
    expect(isDream5504RawDefaultMessageAllowed({ type: 'cc', channel: 1, data1: 1, data2: 28 }, 'lead')).toBe(false);
    expect(isDream5504RawDefaultMessageAllowed({ type: 'cc', channel: 16, data1: 7, data2: 100 }, 'lead')).toBe(false);
    expect(isDream5504RawDefaultMessageAllowed({ type: 'cc', channel: 1, data1: 7, data2: 96 }, 'lead', 'lofi-channel-mix')).toBe(true);
    expect(isDream5504RawDefaultMessageAllowed({ type: 'cc', channel: 1, data1: 11, data2: 127 }, 'lead')).toBe(true);
    expect(isDream5504RawDefaultMessageAllowed({ type: 'cc', channel: 1, data1: 11, data2: 90 }, 'lead')).toBe(false);
    expect(isDream5504RawDefaultMessageAllowed({ type: 'cc', channel: 4, data1: 11, data2: 90 }, 'pad')).toBe(false);
    expect(isDream5504RawDefaultMessageAllowed({ type: 'cc', channel: 2, data1: 64, data2: 127 }, 'comp')).toBe(true);
    expect(isDream5504RawDefaultMessageAllowed({ type: 'cc', channel: 4, data1: 64, data2: 127 }, 'pad')).toBe(false);
    for (const controller of [7, 10, 91, 93]) {
      expect(isDream5504RawDefaultMessageAllowed({ type: 'cc', channel: 1, data1: controller, data2: 0 }), `unclaimed CC${controller}`).toBe(false);
      expect(isDream5504RawDefaultMessageAllowed(
        { type: 'cc', channel: 1, data1: controller, data2: 127 },
        'lead',
        'lofi-channel-mix',
      ), `claimed CC${controller}`).toBe(true);
    }
    for (const controller of [71, 72, 74, 78, 98, 99]) {
      expect(isDream5504RawDefaultMessageAllowed({ type: 'cc', channel: 1, data1: controller, data2: 0 }), `CC${controller}`).toBe(false);
    }
    for (const controller of [64, 120, 121, 123]) {
      expect(isDream5504RawDefaultMessageAllowed({ type: 'cc', channel: 1, data1: controller, data2: 0 }), `CC${controller}=0`).toBe(true);
      expect(isDream5504RawDefaultMessageAllowed({ type: 'cc', channel: 1, data1: controller, data2: 127 }), `CC${controller}=127`).toBe(false);
    }
    expect(isDream5504RawDefaultMessageAllowed({ type: 'pitchBend', channel: 1, data1: 8192 })).toBe(false);
  });

  it('encodes Dream NRPN 3707h master volume and deselects the parameter', () => {
    const sent: number[][] = [];
    const output = { send: (bytes: number[]) => sent.push([...bytes]) } as unknown as MIDIOutput;
    sendNrpn7(output, 1, 0x3707, 104, 0);
    expect(sent).toEqual([
      [0xb0, 99, 0x37],
      [0xb0, 98, 0x07],
      [0xb0, 6, 104],
      [0xb0, 99, 0x7f],
      [0xb0, 98, 0x7f],
    ]);
  });

  it('writes the official Dream neutral EQ/front-output NRPN baseline', () => {
    const sent: number[][] = [];
    const output = { send: (bytes: number[]) => sent.push([...bytes]) } as unknown as MIDIOutput;
    sendDream5504NeutralOutputBaseline(output, 0);

    const parameters = sent
      .map((bytes, index) => ({ bytes, index }))
      .filter(({ bytes }) => bytes[1] === 99 && bytes[2] !== 0x7f)
      .map(({ bytes, index }) => ({
        parameter: (bytes[2] << 8) | sent[index + 1][2],
        value: sent[index + 2][2],
      }));
    expect(parameters).toEqual([
      { parameter: 0x3755, value: 0 },
      { parameter: 0x3708, value: 0x40 },
      { parameter: 0x370b, value: 0x40 },
      { parameter: 0x375e, value: 0x40 },
    ]);
  });
});
