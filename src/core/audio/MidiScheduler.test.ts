import { describe, expect, it, vi } from 'vitest';

// 本文件断言 spessa 路径行为（CC95→echo 展开等）。2026-07-09 起默认后端=copych，
// 显式钉 spessa 防环境默认漂移；copych 路径行为见 copychBackend.test.ts。
vi.mock('./synthBackend', () => ({
    getSynthBackend: () => 'spessa' as const,
    isCopychBackend: () => false,
}));

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

  it('notifies external MIDI listeners on panic/all-notes-off', () => {
    const scheduler = new MidiScheduler();
    const seen: MidiEvent[] = [];
    scheduler.addMidiEventListener((event) => seen.push(event));

    scheduler.panic();

    expect(seen).toHaveLength(16);
    expect(seen.every((event) => event.type === 'cc' && event.data1 === 123 && event.data2 === 0)).toBe(true);
  });
});
