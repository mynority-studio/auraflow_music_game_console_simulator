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

  it('expands CC95 delay send into a short non-recursive echo for browser playback', () => {
    const scheduler = new MidiScheduler();

    scheduler.loadTrack([
      { ticks: 0, type: 'cc', channel: 1, data1: 95, data2: 30 },
      ev(0, 'noteOn', 64),
      ev(240, 'noteOff', 64),
    ], 120);

    const noteOns = scheduler.getChannelEvents(1).filter((event) => event.type === 'noteOn');
    expect(noteOns.map((event) => [event.ticks, event.data1, event.data2])).toEqual([
      [0, 64, 100],
      [240, 64, 33],
    ]);
    expect(scheduler.getChannelEvents(1).filter((event) => event.type === 'noteOff').map((event) => event.ticks)).toEqual([240, 420]);
  });

  it('does not add browser echo when CC95 is absent', () => {
    const scheduler = new MidiScheduler();

    scheduler.loadTrack([ev(0, 'noteOn', 64), ev(240, 'noteOff', 64)], 120);

    expect(scheduler.getChannelEvents(1).filter((event) => event.type === 'noteOn')).toHaveLength(1);
    expect(scheduler.getChannelEvents(1).filter((event) => event.type === 'noteOff')).toHaveLength(1);
  });
});
