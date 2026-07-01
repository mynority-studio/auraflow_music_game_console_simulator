import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MidiEvent } from '../../audio/MidiScheduler';
import type { MusicGenerationResult } from '../musicGeneration/types';
import {
  executeLeadTakeoverActions,
  resetLeadTakeoverRuntimeState,
  TAKEOVER_USER_CHANNEL,
  takeoverSnapshotFromMusicGeneration,
  type LeadTakeoverAudioTarget,
} from './qhTakeoverConsumer';
import type { LeadTakeoverAction } from './types';

function fakeResult(): MusicGenerationResult {
  return {
    status: 'ok',
    bpm: 96,
    seed: 42,
    styleHint: 'pop',
    attempts: 1,
    report: {},
    ir: {
      durationTicks: 3840,
      timebase: {} as never,
      tracks: [
        {
          role: 'lead',
          program: 65,
          mix: { volume: 82, pan: 63, reverb: 44, chorus: 7, expression: 118 },
          notes: [],
        },
      ],
    },
    uiSnapshot: {
      seed: 42,
      styleHint: 'pop',
      key: 'C',
      tonality: 'major',
      bpm: 96,
      timeSignature: [4, 4],
      sections: [],
      chords: [
        { roman: 'I', label: 'Cmaj7', rootPc: 0, quality: 'maj7', startBeat: 0, durationBeats: 4, sectionId: 'A' },
        { roman: 'V', label: 'G7', rootPc: 7, quality: '7', startBeat: 4, durationBeats: 4, sectionId: 'A' },
      ],
      roster: [],
      tracks: [{ role: 'lead', channel: 1, program: 65, instrumentName: 'Alto Sax', noteCount: 0 }],
      world: 'test',
      spaceProfile: 'small',
    },
  } as unknown as MusicGenerationResult;
}

function fakeTarget(result: MusicGenerationResult | null = fakeResult()): LeadTakeoverAudioTarget & { events: MidiEvent[]; mutes: Array<[number, boolean]> } {
  const events: MidiEvent[] = [];
  const mutes: Array<[number, boolean]> = [];
  return {
    events,
    mutes,
    getCurrentTick: () => 960,
    getPpq: () => 480,
    getCurrentMusicGeneration: () => result,
    injectMidiEvent: (ev) => { events.push(ev); },
    muteChannel: (channel, muted) => { mutes.push([channel, muted]); },
  };
}

function directTarget(result: MusicGenerationResult | null = fakeResult()): ReturnType<typeof fakeTarget> & {
  direct: string[];
} {
  const target = fakeTarget(result) as ReturnType<typeof fakeTarget> & { direct: string[] };
  target.direct = [];
  target.noteOn = (channel, note, velocity) => { target.direct.push(`on:${channel}:${note}:${velocity}`); };
  target.noteOff = (channel, note) => { target.direct.push(`off:${channel}:${note}`); };
  target.programChange = (channel, program) => { target.direct.push(`pc:${channel}:${program}`); };
  target.controllerChange = (channel, controller, value) => { target.direct.push(`cc:${channel}:${controller}:${value}`); };
  return target;
}

describe('leadTakeoverSandbox/qhTakeoverConsumer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds takeover snapshot from the current Q+H musicGeneration uiSnapshot', () => {
    const snapshot = takeoverSnapshotFromMusicGeneration(fakeResult());

    expect(snapshot.styleHint).toBe('pop');
    expect(snapshot.key).toBe('C');
    expect(snapshot.timeSignature).toEqual([4, 4]);
    expect(snapshot.chords).toHaveLength(2);
    expect(snapshot.chords[0]).toMatchObject({
      rootPc: 0,
      quality: 'maj7',
      chordType: 'maj7',
      roman: 'I',
      startBeat: 0,
      durationBeats: 4,
    });
  });

  it('routes user takeover notes to an independent channel and keeps native lead mute separate', () => {
    vi.useFakeTimers();
    const target = fakeTarget();
    const actions: LeadTakeoverAction[] = [
      { type: 'lead-note-on', channel: 1, midi: 62, velocity: 104 },
      { type: 'lead-note-off', channel: 1, midi: 62 },
      { type: 'lead-mute', channel: 1, muted: true },
      { type: 'lead-mute', channel: 1, muted: false },
      { type: 'panic', channel: 1 },
    ];

    const logs = executeLeadTakeoverActions(target, actions);
    vi.advanceTimersByTime(30);

    expect(logs).toContain('takeover noteOn ch15 62 v104');
    expect(logs).toContain('hardMute native lead ch1');
    expect(target.events).toContainEqual({ ticks: 961, type: 'programChange', channel: TAKEOVER_USER_CHANNEL, data1: 65, data2: 0 });
    expect(target.events).toContainEqual({ ticks: 962, type: 'noteOn', channel: TAKEOVER_USER_CHANNEL, data1: 62, data2: 104 });
    expect(target.events).toContainEqual({ ticks: 961, type: 'noteOff', channel: TAKEOVER_USER_CHANNEL, data1: 62, data2: 0 });
    expect(target.events).toContainEqual({ ticks: 961, type: 'cc', channel: 1, data1: 123, data2: 0 });
    expect(target.events).toContainEqual({ ticks: 961, type: 'cc', channel: 1, data1: 7, data2: 0 });
    expect(target.events).toContainEqual({ ticks: 961, type: 'cc', channel: 1, data1: 7, data2: 82 });
    expect(target.events).toContainEqual({ ticks: 961, type: 'cc', channel: TAKEOVER_USER_CHANNEL, data1: 123, data2: 0 });
    expect(target.mutes).toEqual([[1, false]]);
  });

  it('hard-mutes native lead after all-notes-off has a chance to flush', () => {
    vi.useFakeTimers();
    const target = fakeTarget();

    executeLeadTakeoverActions(target, [{ type: 'lead-mute', channel: 1, muted: true }]);
    expect(target.mutes).toEqual([]);

    vi.advanceTimersByTime(30);
    expect(target.mutes).toEqual([[1, true]]);
  });

  it('uses realtime synth hooks for user notes and does not grow scheduler events', () => {
    const target = directTarget();

    executeLeadTakeoverActions(target, [{ type: 'lead-note-on', channel: 1, midi: 62, velocity: 104 }]);
    executeLeadTakeoverActions(target, [{ type: 'lead-note-off', channel: 1, midi: 62 }]);
    executeLeadTakeoverActions(target, [{ type: 'lead-note-on', channel: 1, midi: 64, velocity: 100 }]);

    expect(target.events).toEqual([]);
    expect(target.direct).toContain(`pc:${TAKEOVER_USER_CHANNEL}:65`);
    expect(target.direct).toContain(`on:${TAKEOVER_USER_CHANNEL}:62:104`);
    expect(target.direct).toContain(`off:${TAKEOVER_USER_CHANNEL}:62`);
    expect(target.direct).toContain(`on:${TAKEOVER_USER_CHANNEL}:64:100`);
    expect(target.direct.filter((entry) => entry.startsWith(`pc:${TAKEOVER_USER_CHANNEL}:`))).toHaveLength(1);

    resetLeadTakeoverRuntimeState(target);
  });
});
