import { afterEach, describe, expect, it, vi } from 'vitest';

import { MidiScheduler, type MidiEvent } from './MidiScheduler';

function ev(ticks: number, type: MidiEvent['type'], data1 = 60): MidiEvent {
  return { ticks, type, channel: 1, data1, data2: type === 'noteOn' ? 100 : 0 };
}

describe('core/audio/MidiScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('restores the score-owned program, CC11 and CC64 state when a channel is unmuted', () => {
    vi.useFakeTimers();
    const scheduler = new MidiScheduler();
    const seen: Array<{ event: MidiEvent; timestampMs?: number }> = [];
    scheduler.loadTrack([
      { ticks: 0, type: 'cc', channel: 2, data1: 121, data2: 0, outputChannel: 3 },
      { ticks: 0, type: 'cc', channel: 2, data1: 0, data2: 8, outputChannel: 3 },
      { ticks: 0, type: 'programChange', channel: 2, data1: 0, data2: 0, outputChannel: 3 },
      { ticks: 0, type: 'cc', channel: 2, data1: 11, data2: 96, outputChannel: 3 },
      { ticks: 0, type: 'cc', channel: 2, data1: 64, data2: 127, outputChannel: 3 },
      { ticks: 240, type: 'cc', channel: 2, data1: 64, data2: 0, outputChannel: 3 },
      { ticks: 240, type: 'cc', channel: 2, data1: 0, data2: 0, outputChannel: 3 },
      { ticks: 240, type: 'programChange', channel: 2, data1: 1, data2: 0, outputChannel: 3 },
      { ticks: 240, type: 'cc', channel: 2, data1: 11, data2: 84, outputChannel: 3 },
      { ticks: 240, type: 'cc', channel: 2, data1: 64, data2: 127, outputChannel: 3 },
    ], 120);
    scheduler.addMidiEventListener((event, timestampMs) => seen.push({ event, timestampMs }));
    scheduler.start();
    scheduler.muteChannel(2, true);

    // tick 240 is consumed while muted. Its release is allowed through, while
    // the new voice/expression/pedal-down messages are intentionally blocked.
    vi.advanceTimersByTime(300);
    scheduler.muteChannel(2, false);

    expect(seen.slice(-4)).toEqual([
      { event: expect.objectContaining({ type: 'cc', channel: 2, outputChannel: 3, data1: 0, data2: 0 }), timestampMs: undefined },
      { event: expect.objectContaining({ type: 'programChange', channel: 2, outputChannel: 3, data1: 1 }), timestampMs: undefined },
      { event: expect.objectContaining({ type: 'cc', channel: 2, outputChannel: 3, data1: 11, data2: 84 }), timestampMs: undefined },
      { event: expect.objectContaining({ type: 'cc', channel: 2, outputChannel: 3, data1: 64, data2: 127 }), timestampMs: undefined },
    ]);
    scheduler.stop();
  });

  it('requeues only future events that the timestamp lookahead suppressed during mute', () => {
    vi.useFakeTimers();
    const scheduler = new MidiScheduler();
    const seen: Array<{ event: MidiEvent; timestampMs?: number }> = [];
    scheduler.loadTrack([
      { ticks: 0, type: 'programChange', channel: 1, data1: 0, data2: 0 },
      { ticks: 240, type: 'noteOn', channel: 1, data1: 72, data2: 100 },
      { ticks: 480, type: 'noteOff', channel: 1, data1: 72, data2: 0 },
    ], 120);
    scheduler.addMidiEventListener((event, timestampMs) => seen.push({ event, timestampMs }));
    scheduler.start();
    scheduler.muteChannel(1, true);

    vi.advanceTimersByTime(200);
    expect(seen.some(({ event }) => event.type === 'noteOn' && event.ticks === 240)).toBe(false);
    scheduler.muteChannel(1, false);

    expect(seen).toContainEqual({
      event: expect.objectContaining({ type: 'noteOn', channel: 1, ticks: 240, data1: 72 }),
      timestampMs: 250,
    });
    scheduler.stop();
  });

  it('treats CC121 as a CC11/CC64 reset without forgetting the selected program', () => {
    const scheduler = new MidiScheduler();
    scheduler.loadTrack([
      { ticks: 0, type: 'cc', channel: 1, data1: 0, data2: 8 },
      { ticks: 0, type: 'programChange', channel: 1, data1: 3, data2: 0 },
      { ticks: 0, type: 'cc', channel: 1, data1: 11, data2: 82 },
      { ticks: 0, type: 'cc', channel: 1, data1: 64, data2: 127 },
      { ticks: 240, type: 'cc', channel: 1, data1: 121, data2: 0 },
    ], 120);

    expect(scheduler.getChannelStateAt(1, 241)).toMatchObject({
      bankMsb: 8,
      program: 3,
      expression: 127,
      sustain: 0,
    });
  });

  it('filters only note-ons inside a muted note range', () => {
    const scheduler = new MidiScheduler();
    const seen: MidiEvent[] = [];
    const dispatch = (scheduler as unknown as { dispatchEvent(event: MidiEvent): void }).dispatchEvent.bind(scheduler);
    scheduler.addMidiEventListener((event) => seen.push(event));
    scheduler.muteNoteRange(0, { minMidi: 72, maxMidi: 83 }, true);

    dispatch({ ticks: 0, type: 'noteOn', channel: 0, data1: 71, data2: 100 });
    dispatch({ ticks: 0, type: 'noteOn', channel: 0, data1: 72, data2: 100 });
    dispatch({ ticks: 10, type: 'noteOff', channel: 0, data1: 72, data2: 0 });
    dispatch({ ticks: 20, type: 'noteOn', channel: 0, data1: 84, data2: 100 });

    expect(seen.map((event) => [event.type, event.data1])).toEqual([
      ['noteOn', 71],
      ['noteOff', 72],
      ['noteOn', 84],
    ]);
  });

  it('filters only the extracted top-voice note events, not their channel or pitch globally', () => {
    const scheduler = new MidiScheduler();
    const seen: MidiEvent[] = [];
    const dispatch = (scheduler as unknown as { dispatchEvent(event: MidiEvent): void }).dispatchEvent.bind(scheduler);
    scheduler.addMidiEventListener((event) => seen.push(event));
    const targets = [
      { channel: 0, midi: 76, startTick: 480, endTick: 960 },
      { channel: 0, midi: 79, startTick: 960, endTick: 1440 },
    ];
    scheduler.muteNoteTargets(targets, true);

    dispatch({ ticks: 480, type: 'noteOn', channel: 0, data1: 60, data2: 100 });
    dispatch({ ticks: 480, type: 'noteOn', channel: 0, data1: 76, data2: 100 });
    dispatch({ ticks: 600, type: 'noteOn', channel: 0, data1: 76, data2: 100 });
    dispatch({ ticks: 960, type: 'noteOff', channel: 0, data1: 76, data2: 0 });
    dispatch({ ticks: 960, type: 'noteOn', channel: 1, data1: 79, data2: 100 });

    expect(seen.map((event) => [event.type, event.channel, event.ticks, event.data1])).toEqual([
      ['noteOn', 0, 480, 60],
      ['noteOn', 0, 600, 76],
      ['noteOff', 0, 960, 76],
      ['noteOn', 1, 960, 79],
    ]);
    expect(scheduler.areNoteTargetsMuted(targets)).toBe(true);
    scheduler.muteNoteTargets(targets, false);
    expect(scheduler.areNoteTargetsMuted(targets)).toBe(false);
  });

  it('does not leak takeover mutes or uploaded gain into a newly loaded generated score', () => {
    const scheduler = new MidiScheduler();
    const seen: MidiEvent[] = [];
    const dispatch = (scheduler as unknown as { dispatchEvent(event: MidiEvent): void }).dispatchEvent.bind(scheduler);
    scheduler.addMidiEventListener((event) => seen.push(event));
    const targets = [{ channel: 1, midi: 72, startTick: 0, endTick: 480 }];
    scheduler.loadTrack([ev(0, 'noteOn', 72)], 120);
    scheduler.muteChannel(1, true);
    scheduler.muteNoteRange(2, { minMidi: 72, maxMidi: 84 }, true);
    scheduler.muteNoteTargets(targets, true);
    scheduler.setChannelVelocityScale(1, 0.9);

    scheduler.loadTrack([
      ev(0, 'noteOn', 72),
      { ticks: 0, type: 'noteOn', channel: 2, data1: 76, data2: 100 },
    ], 120);

    expect(scheduler.isChannelMuted(1)).toBe(false);
    expect(scheduler.isNoteRangeMuted(2, { minMidi: 72, maxMidi: 84 })).toBe(false);
    expect(scheduler.areNoteTargetsMuted(targets)).toBe(false);
    expect(scheduler.getChannelVelocityScale(1)).toBe(1);
    dispatch({ ticks: 0, type: 'noteOn', channel: 1, data1: 72, data2: 100 });
    dispatch({ ticks: 0, type: 'noteOn', channel: 2, data1: 76, data2: 100 });
    expect(seen.map((event) => [event.channel, event.data1, event.data2])).toEqual([
      [1, 72, 100],
      [2, 76, 100],
    ]);
  });

  it('scales native score note-on velocity without changing note-off or other channels', () => {
    const scheduler = new MidiScheduler();
    const seen: MidiEvent[] = [];
    const dispatch = (scheduler as unknown as { dispatchEvent(event: MidiEvent): void }).dispatchEvent.bind(scheduler);
    scheduler.addMidiEventListener((event) => seen.push(event));
    scheduler.setChannelVelocityScale(0, 0.8);

    dispatch({ ticks: 0, type: 'noteOn', channel: 0, data1: 60, data2: 100 });
    dispatch({ ticks: 10, type: 'noteOff', channel: 0, data1: 60, data2: 0 });
    dispatch({ ticks: 20, type: 'noteOn', channel: 1, data1: 64, data2: 100 });

    expect(seen.map((event) => [event.type, event.channel, event.data2])).toEqual([
      ['noteOn', 0, 80],
      ['noteOff', 0, 0],
      ['noteOn', 1, 100],
    ]);
    expect(scheduler.getChannelVelocityScale(0)).toBe(0.8);
    expect(scheduler.getChannelVelocityScale(1)).toBe(1);
  });

  it('releases the exact uploaded output channel without clearing unrelated queued user notes', () => {
    vi.useFakeTimers();
    const scheduler = new MidiScheduler();
    const seen: MidiEvent[] = [];
    let queueClears = 0;
    scheduler.loadTrack([
      { ticks: 0, type: 'noteOn', channel: 3, data1: 72, data2: 100, outputChannel: 4 },
      { ticks: 480, type: 'noteOff', channel: 3, data1: 72, data2: 0, outputChannel: 4 },
    ], 120);
    scheduler.addMidiEventListener((event) => seen.push(event));
    scheduler.addMidiQueueClearListener(() => { queueClears += 1; });
    scheduler.start();

    scheduler.muteChannel(3, true);

    expect(queueClears).toBe(0);
    expect(seen.slice(-2)).toEqual([
      expect.objectContaining({ type: 'cc', channel: 3, outputChannel: 4, data1: 64, data2: 0 }),
      expect.objectContaining({ type: 'cc', channel: 3, outputChannel: 4, data1: 123, data2: 0 }),
    ]);
    vi.advanceTimersByTime(120);
    expect(queueClears).toBe(0);
    expect(seen.slice(-2)).toEqual([
      expect.objectContaining({ type: 'cc', channel: 3, outputChannel: 4, data1: 64, data2: 0 }),
      expect.objectContaining({ type: 'cc', channel: 3, outputChannel: 4, data1: 123, data2: 0 }),
    ]);
    scheduler.stop();
  });

  it('blocks the next Lead attack immediately but lets the currently sounding Lead note finish', () => {
    vi.useFakeTimers();
    const scheduler = new MidiScheduler();
    const seen: Array<{ event: MidiEvent; timestampMs?: number }> = [];
    scheduler.loadTrack([
      { ticks: 0, type: 'noteOn', channel: 1, data1: 72, data2: 100, outputChannel: 2 },
      { ticks: 240, type: 'noteOn', channel: 1, data1: 74, data2: 100, outputChannel: 2 },
      { ticks: 360, type: 'noteOff', channel: 1, data1: 74, data2: 0, outputChannel: 2 },
      { ticks: 480, type: 'noteOff', channel: 1, data1: 72, data2: 0, outputChannel: 2 },
    ], 120);
    scheduler.addMidiEventListener((event, timestampMs) => seen.push({ event, timestampMs }));
    scheduler.start();

    scheduler.muteChannelGracefully(1, true);

    expect(scheduler.isChannelMuted(1)).toBe(true);
    expect(seen.some(({ event }) => event.type === 'cc' && event.data1 === 123)).toBe(false);
    vi.advanceTimersByTime(400);
    expect(seen.some(({ event }) => event.type === 'noteOn' && event.data1 === 74)).toBe(false);
    expect(seen).toContainEqual({
      event: expect.objectContaining({ type: 'noteOff', channel: 1, data1: 72 }),
      timestampMs: 500,
    });
    expect(seen.some(({ event }) => event.type === 'cc' && event.data1 === 123)).toBe(false);

    vi.advanceTimersByTime(100);
    expect(seen).toContainEqual({
      event: expect.objectContaining({ type: 'cc', channel: 1, data1: 123 }),
      timestampMs: undefined,
    });
    scheduler.stop();
  });

  it('lets a sustained Lead note finish at pedal-up instead of cutting it at key-up', () => {
    vi.useFakeTimers();
    const scheduler = new MidiScheduler();
    const seen: Array<{ event: MidiEvent; timestampMs?: number }> = [];
    scheduler.loadTrack([
      { ticks: 0, type: 'cc', channel: 1, data1: 64, data2: 127 },
      { ticks: 0, type: 'noteOn', channel: 1, data1: 72, data2: 100 },
      { ticks: 240, type: 'noteOff', channel: 1, data1: 72, data2: 0 },
      { ticks: 480, type: 'cc', channel: 1, data1: 64, data2: 0 },
    ], 120);
    scheduler.addMidiEventListener((event, timestampMs) => seen.push({ event, timestampMs }));
    scheduler.start();

    scheduler.muteChannelGracefully(1, true);
    vi.advanceTimersByTime(400);

    expect(seen).toContainEqual({
      event: expect.objectContaining({ type: 'noteOff', channel: 1, data1: 72 }),
      timestampMs: 250,
    });
    expect(seen).toContainEqual({
      event: expect.objectContaining({ type: 'cc', channel: 1, data1: 64, data2: 0 }),
      timestampMs: 500,
    });
    expect(seen.some(({ event }) => event.type === 'cc' && event.data1 === 123)).toBe(false);

    vi.advanceTimersByTime(100);
    expect(seen.some(({ event }) => event.type === 'cc' && event.data1 === 123)).toBe(true);
    scheduler.stop();
  });

  it('switches immediately when no Lead note is active and neutralizes timestamp-prequeued attacks', () => {
    vi.useFakeTimers();
    const scheduler = new MidiScheduler();
    const seen: Array<{ event: MidiEvent; timestampMs?: number }> = [];
    scheduler.loadTrack([
      { ticks: 48, type: 'noteOn', channel: 3, data1: 72, data2: 100, outputChannel: 4 },
      { ticks: 240, type: 'noteOff', channel: 3, data1: 72, data2: 0, outputChannel: 4 },
    ], 120);
    scheduler.addMidiEventListener((event, timestampMs) => seen.push({ event, timestampMs }));
    scheduler.start();

    scheduler.muteChannelGracefully(3, true);

    const queuedAttack = seen.find(({ event }) => event.type === 'noteOn' && event.data1 === 72);
    const queuedNeutralizer = seen.find(({ event }) =>
      event.type === 'noteOff' && event.ticks === 48 && event.data1 === 72);
    expect(queuedAttack?.timestampMs).toBe(50);
    expect(queuedNeutralizer?.timestampMs).toBe(queuedAttack?.timestampMs);
    expect(seen.slice(-2).map(({ event }) => [event.type, event.data1])).toEqual([
      ['cc', 64],
      ['cc', 123],
    ]);
    expect(scheduler.isChannelMuted(3)).toBe(true);
    scheduler.stop();
  });

  it('gracefully mutes only extracted top-voice targets on a shared piano channel', () => {
    vi.useFakeTimers();
    const scheduler = new MidiScheduler();
    const seen: Array<{ event: MidiEvent; timestampMs?: number }> = [];
    const targets = [
      { channel: 0, midi: 76, startTick: 0, endTick: 480 },
      { channel: 0, midi: 79, startTick: 48, endTick: 240 },
    ];
    scheduler.loadTrack([
      { ticks: 0, type: 'noteOn', channel: 0, data1: 60, data2: 96 },
      { ticks: 0, type: 'noteOn', channel: 0, data1: 76, data2: 96 },
      { ticks: 48, type: 'noteOn', channel: 0, data1: 64, data2: 96 },
      { ticks: 48, type: 'noteOn', channel: 0, data1: 79, data2: 96 },
      { ticks: 240, type: 'noteOff', channel: 0, data1: 64, data2: 0 },
      { ticks: 240, type: 'noteOff', channel: 0, data1: 79, data2: 0 },
      { ticks: 480, type: 'noteOff', channel: 0, data1: 60, data2: 0 },
      { ticks: 480, type: 'noteOff', channel: 0, data1: 76, data2: 0 },
    ], 120);
    scheduler.addMidiEventListener((event, timestampMs) => seen.push({ event, timestampMs }));
    scheduler.start();

    scheduler.muteNoteTargetsGracefully(targets, true);

    expect(seen.some(({ event }) => event.type === 'noteOff' && event.data1 === 76)).toBe(false);
    const futureLeadOn = seen.find(({ event }) =>
      event.type === 'noteOn' && event.ticks === 48 && event.data1 === 79);
    const futureLeadOff = seen.find(({ event }) =>
      event.type === 'noteOff' && event.ticks === 48 && event.data1 === 79);
    expect(futureLeadOff?.timestampMs).toBe(futureLeadOn?.timestampMs);
    expect(seen.some(({ event }) =>
      event.type === 'noteOff' && event.ticks === 48 && event.data1 === 64)).toBe(false);

    vi.advanceTimersByTime(400);
    expect(seen.some(({ event }) =>
      event.type === 'noteOff' && event.ticks === 480 && event.data1 === 76)).toBe(true);
    expect(scheduler.isChannelMuted(0)).toBe(false);
    expect(scheduler.areNoteTargetsMuted(targets)).toBe(true);
    scheduler.stop();
  });

  it('prequeues MIDI with timestamps while keeping visuals on the audible playhead', () => {
    vi.useFakeTimers();
    const scheduler = new MidiScheduler();
    const midi: Array<{ event: MidiEvent; timestampMs?: number }> = [];
    const visuals: string[] = [];
    scheduler.loadTrack([
      ev(96, 'noteOn', 64),
      { ticks: 96, type: 'visual', channel: 1, data1: 0, data2: 0, visualData: 'beat' },
      ev(192, 'noteOn', 67),
    ], 120);
    scheduler.addMidiEventListener((event, timestampMs) => midi.push({ event, timestampMs }));
    scheduler.addVisualListener((data) => visuals.push(String(data)));

    scheduler.start();
    expect(midi.map(({ event }) => event.ticks)).toEqual([96]);
    expect(midi[0]?.timestampMs).toBeCloseTo(100);
    expect(visuals).toEqual([]);

    vi.advanceTimersByTime(99);
    expect(midi.map(({ event }) => event.ticks)).toEqual([96]);
    expect(visuals).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(midi.map(({ event }) => event.ticks)).toEqual([96, 192]);
    expect(midi[1]?.timestampMs).toBeCloseTo(200);
    expect(visuals).toEqual(['beat']);
    scheduler.pause();
  });

  it('reports a live playhead between scheduler maintenance intervals', () => {
    vi.useFakeTimers();
    const scheduler = new MidiScheduler();
    scheduler.loadTrack([ev(480, 'noteOn', 64)], 120);
    scheduler.start();

    vi.advanceTimersByTime(13);

    expect(scheduler.getCurrentTick()).toBeCloseTo(12.48);
    scheduler.pause();
  });

  it('clears native timestamp queues when playback pauses or panics', () => {
    vi.useFakeTimers();
    const scheduler = new MidiScheduler();
    let clears = 0;
    scheduler.addMidiQueueClearListener(() => { clears += 1; });
    scheduler.loadTrack([ev(96, 'noteOn', 64)], 120);

    scheduler.start();
    scheduler.pause();
    expect(clears).toBe(1);

    scheduler.start();
    scheduler.panic();
    expect(clears).toBe(2);
    scheduler.pause();
  });

  it('submits a 22-message same-beat burst without per-event JavaScript timers', () => {
    vi.useFakeTimers();
    const scheduler = new MidiScheduler();
    const timestamps: number[] = [];
    scheduler.loadTrack(
      Array.from({ length: 22 }, (_, index) => ev(96, 'noteOn', 48 + index)),
      120,
    );
    scheduler.addMidiEventListener((_event, timestampMs) => {
      if (timestampMs !== undefined) timestamps.push(timestampMs);
    });

    scheduler.start();

    expect(timestamps).toHaveLength(22);
    expect(new Set(timestamps)).toEqual(new Set([100]));
    expect(vi.getTimerCount()).toBe(1);
    scheduler.pause();
  });

  it('clears queued MIDI before emitting panic controllers', () => {
    const scheduler = new MidiScheduler();
    const order: string[] = [];
    scheduler.addMidiQueueClearListener(() => order.push('clear'));
    scheduler.addMidiEventListener(() => order.push('midi'));

    scheduler.panic();

    expect(order[0]).toBe('clear');
    expect(order.filter((item) => item === 'midi')).toHaveLength(48);
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
