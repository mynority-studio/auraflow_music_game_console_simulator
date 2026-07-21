import { describe, expect, it } from 'vitest';

import { MidiScheduler, type MidiEvent } from './MidiScheduler';

function ev(ticks: number, type: MidiEvent['type'], data1 = 60): MidiEvent {
  return { ticks, type, channel: 1, data1, data2: type === 'noteOn' ? 100 : 0 };
}

describe('core/audio/MidiScheduler', () => {
  it('keeps injected events ordered without requiring a full resort', () => {
    const scheduler = new MidiScheduler();

    scheduler.loadTrack([ev(20, 'noteOn', 64), ev(20, 'noteOff', 64), ev(40, 'noteOn', 67)], 120);
    scheduler.injectEvent(ev(10, 'noteOn', 60));
    scheduler.injectEvent(ev(20, 'cc', 7));

    expect(scheduler.getChannelEvents(1).map((event) => [event.ticks, event.type, event.data1])).toEqual([
      [10, 'noteOn', 60],
      [20, 'noteOff', 64],
      [20, 'cc', 7],
      [20, 'noteOn', 64],
      [40, 'noteOn', 67],
    ]);
  });

  it('keeps CC95 delay send as a hardware FX-bus event without synthetic echo notes', () => {
    const scheduler = new MidiScheduler();

    scheduler.loadTrack([
      { ticks: 0, type: 'cc', channel: 1, data1: 95, data2: 30 },
      ev(0, 'noteOn', 64),
      ev(240, 'noteOff', 64),
    ], 120);

    const noteOns = scheduler.getChannelEvents(1).filter((event) => event.type === 'noteOn');
    expect(noteOns.map((event) => [event.ticks, event.data1, event.data2])).toEqual([[0, 64, 100]]);
    expect(scheduler.getChannelEvents(1).filter((event) => event.type === 'noteOff').map((event) => event.ticks)).toEqual([240]);
    expect(scheduler.getChannelEvents(1).filter((event) => event.type === 'cc' && event.data1 === 95)).toHaveLength(1);
  });

  it('does not add synthetic echo notes', () => {
    const scheduler = new MidiScheduler();

    scheduler.loadTrack([ev(0, 'noteOn', 64), ev(240, 'noteOff', 64)], 120);

    expect(scheduler.getChannelEvents(1).filter((event) => event.type === 'noteOn')).toHaveLength(1);
    expect(scheduler.getChannelEvents(1).filter((event) => event.type === 'noteOff')).toHaveLength(1);
  });

  it('holds a written score tail until its declared duration rather than looping at the last note-off', () => {
    const scheduler = new MidiScheduler();
    scheduler.loadTrack([ev(0, 'noteOn', 64), ev(240, 'noteOff', 64)], 120, undefined, 2_400);

    expect((scheduler as unknown as { trackEndTick: number }).trackEndTick).toBe(2_400);
  });

  it('notifies external MIDI listeners for audible non-visual events', () => {
    const scheduler = new MidiScheduler();
    const seen: MidiEvent[] = [];
    const dispatch = (scheduler as unknown as { dispatchEvent(event: MidiEvent): void }).dispatchEvent.bind(scheduler);
    const unsubscribe = scheduler.addMidiEventListener((event) => seen.push(event));

    dispatch(ev(0, 'noteOn', 64));
    dispatch({ ticks: 0, type: 'visual', channel: 1, data1: 0, data2: 0 });
    scheduler.muteChannel(1, true);
    dispatch(ev(10, 'noteOn', 67));
    unsubscribe();
    scheduler.muteChannel(1, false);
    dispatch(ev(20, 'noteOn', 69));

    expect(seen.map((event) => [event.ticks, event.type, event.data1])).toEqual([[0, 'noteOn', 64]]);
  });

  it('lifts sustain, sends all-notes-off, then restores board controller defaults during panic', () => {
    const scheduler = new MidiScheduler();
    const seen: MidiEvent[] = [];
    scheduler.addMidiEventListener((event) => seen.push(event));

    scheduler.panic();

    expect(seen).toHaveLength(48);
    for (let channel = 0; channel < 16; channel++) {
      const channelEvents = seen.filter((event) => event.channel === channel).map((event) => [event.channel, event.data1, event.data2]);
      expect(channelEvents).toEqual([[channel, 64, 0], [channel, 123, 0], [channel, 121, 0]]);
    }
  });

  it('orders a same-tick program handoff as noteOff, CC64-off, CC121, bank/program, CC11, CC64-on, noteOn', () => {
    const scheduler = new MidiScheduler();
    scheduler.loadTrack([
      ev(480, 'noteOn', 60),
      ev(480, 'noteOff', 60),
      { ticks: 480, type: 'cc', channel: 1, data1: 64, data2: 127 },
      { ticks: 480, type: 'cc', channel: 1, data1: 121, data2: 0 },
      { ticks: 480, type: 'programChange', channel: 1, data1: 5, data2: 0 },
      { ticks: 480, type: 'cc', channel: 1, data1: 0, data2: 1 },
      { ticks: 480, type: 'cc', channel: 1, data1: 11, data2: 90 },
      { ticks: 480, type: 'cc', channel: 1, data1: 64, data2: 0 },
    ], 120);

    expect(scheduler.getChannelEvents(1).map((event) => [event.type, event.data1, event.data2])).toEqual([
      ['noteOff', 60, 0],
      ['cc', 64, 0],
      ['cc', 121, 0],
      ['cc', 0, 1],
      ['programChange', 5, 0],
      ['cc', 11, 90],
      ['cc', 64, 127],
      ['noteOn', 60, 100],
    ]);
  });
});
