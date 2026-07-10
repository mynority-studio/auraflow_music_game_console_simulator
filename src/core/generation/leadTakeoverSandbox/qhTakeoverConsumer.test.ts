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

function fakeResult(opts: {
  leadProgram?: number;
  styleHint?: string;
  leadDelay?: number;
  leadMix?: Partial<{ volume: number; pan: number; reverb: number; chorus: number; expression: number; delay: number }>;
} = {}): MusicGenerationResult {
  const leadProgram = opts.leadProgram ?? 0;
  const styleHint = opts.styleHint ?? 'pop';
  const leadMix = {
    volume: 82,
    pan: 63,
    reverb: 44,
    chorus: 7,
    expression: 118,
    ...(opts.leadDelay !== undefined ? { delay: opts.leadDelay } : {}),
    ...(opts.leadMix ?? {}),
  };
  return {
    status: 'ok',
    bpm: 96,
    seed: 42,
    styleHint,
    attempts: 1,
    report: {},
    ir: {
      durationTicks: 3840,
      timebase: {} as never,
      tracks: [
        {
          role: 'lead',
          program: leadProgram,
          mix: leadMix,
          notes: [],
        },
      ],
    },
    uiSnapshot: {
      seed: 42,
      styleHint,
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
      tracks: [{ role: 'lead', channel: 1, program: leadProgram, instrumentName: '大钢琴', noteCount: 0 }],
      grooveContract: {
        id: 'jazz_medium_swing',
        name: 'JAZZ medium swing',
        grid: 'swing',
        melodySwingRatio: 0.67,
        melodyStrongPocketMs: [0, 3],
        melodyWeakPocketMs: [0, 8],
        accentPattern: [1, 0.85, 1.05, 0.85],
      },
      grooveContractBySection: {
        A: {
          id: 'jazz_medium_swing',
          name: 'JAZZ medium swing',
          grid: 'swing',
          melodySwingRatio: 0.67,
          melodyStrongPocketMs: [0, 3],
          melodyWeakPocketMs: [0, 8],
          accentPattern: [1, 0.85, 1.05, 0.85],
        },
      },
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

function scheduledTarget(result: MusicGenerationResult | null = fakeResult()): ReturnType<typeof directTarget> & {
  scheduled: Array<{ type: 'on' | 'off'; channel: number; note: number; velocity?: number; audioTime: number }>;
} {
  const target = directTarget(result) as ReturnType<typeof directTarget> & {
    scheduled: Array<{ type: 'on' | 'off'; channel: number; note: number; velocity?: number; audioTime: number }>;
  };
  target.scheduled = [];
  target.getAudioTime = () => 10 + performance.now() / 1000;
  target.noteOnAt = (channel, note, velocity, audioTime) => {
    target.scheduled.push({ type: 'on', channel, note, velocity, audioTime });
  };
  target.noteOffAt = (channel, note, audioTime) => {
    target.scheduled.push({ type: 'off', channel, note, audioTime });
  };
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
    expect(snapshot.grooveContract).toMatchObject({
      id: 'jazz_medium_swing',
      grid: 'swing',
      melodySwingRatio: 0.67,
    });
    expect(snapshot.grooveContractBySection?.A).toMatchObject({
      id: 'jazz_medium_swing',
      melodyWeakPocketMs: [0, 8],
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
    expect(target.events).toContainEqual({ ticks: 961, type: 'programChange', channel: TAKEOVER_USER_CHANNEL, data1: 0, data2: 0 });
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
    expect(target.direct).toContain(`pc:${TAKEOVER_USER_CHANNEL}:0`);
    expect(target.direct).toContain(`on:${TAKEOVER_USER_CHANNEL}:62:104`);
    expect(target.direct).toContain(`off:${TAKEOVER_USER_CHANNEL}:62`);
    expect(target.direct).toContain(`on:${TAKEOVER_USER_CHANNEL}:64:100`);
    expect(target.direct.filter((entry) => entry.startsWith(`pc:${TAKEOVER_USER_CHANNEL}:`))).toHaveLength(1);

    resetLeadTakeoverRuntimeState(target);
  });

  it('sets takeover EP release/brightness and resets them for non-EP voices', () => {
    const epTarget = directTarget(fakeResult({ leadProgram: 5, leadDelay: 16 }));
    executeLeadTakeoverActions(epTarget, [{ type: 'lead-note-on', channel: 1, midi: 64, velocity: 100 }]);
    expect(epTarget.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:72:68`);
    expect(epTarget.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:74:54`);
    expect(epTarget.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:95:0`);
    resetLeadTakeoverRuntimeState(epTarget);

    const pianoTarget = directTarget(fakeResult({ leadProgram: 0 }));
    executeLeadTakeoverActions(pianoTarget, [{ type: 'lead-note-on', channel: 1, midi: 64, velocity: 100 }]);
    expect(pianoTarget.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:72:64`);
    expect(pianoTarget.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:74:64`);
    resetLeadTakeoverRuntimeState(pianoTarget);
  });

  it('uses a bounded takeover mix and force-clears stale sustain/delay state on ch15', () => {
    const target = directTarget(fakeResult({
      leadDelay: 26,
      leadMix: { volume: 110, reverb: 80, chorus: 60, expression: 127, delay: 26 },
    }));

    executeLeadTakeoverActions(target, [{ type: 'lead-note-on', channel: 1, midi: 64, velocity: 100 }]);

    expect(target.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:64:0`);
    expect(target.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:7:72`);
    expect(target.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:91:18`);
    expect(target.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:93:6`);
    expect(target.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:11:112`);
    expect(target.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:95:0`);
    expect(target.direct).not.toContain(`cc:${TAKEOVER_USER_CHANNEL}:95:26`);

    resetLeadTakeoverRuntimeState(target);

    expect(target.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:64:0`);
    expect(target.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:95:0`);
    expect(target.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:123:0`);
    expect(target.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:120:0`);
  });

  it('does not cut a same-MIDI held note until the last note id is released', () => {
    const target = directTarget();

    executeLeadTakeoverActions(target, [{ type: 'lead-note-on', channel: 1, noteId: 'a', midi: 72, velocity: 104 }]);
    executeLeadTakeoverActions(target, [{ type: 'lead-note-on', channel: 1, noteId: 'b', midi: 72, velocity: 100 }]);
    executeLeadTakeoverActions(target, [{ type: 'lead-note-off', channel: 1, noteId: 'a', midi: 72 }]);

    expect(target.direct.filter((entry) => entry === `on:${TAKEOVER_USER_CHANNEL}:72:104`)).toHaveLength(1);
    expect(target.direct.filter((entry) => entry === `on:${TAKEOVER_USER_CHANNEL}:72:100`)).toHaveLength(1);
    expect(target.direct.filter((entry) => entry === `off:${TAKEOVER_USER_CHANNEL}:72`)).toHaveLength(0);

    executeLeadTakeoverActions(target, [{ type: 'lead-note-off', channel: 1, noteId: 'b', midi: 72 }]);

    expect(target.direct.filter((entry) => entry === `off:${TAKEOVER_USER_CHANNEL}:72`)).toHaveLength(1);
    resetLeadTakeoverRuntimeState(target);
  });

  it('clears matching note-id records when a legacy same-MIDI note-off has no note id', () => {
    const target = directTarget();

    executeLeadTakeoverActions(target, [{ type: 'lead-note-on', channel: 1, noteId: 'a', midi: 74, velocity: 104 }]);
    executeLeadTakeoverActions(target, [{ type: 'lead-note-on', channel: 1, noteId: 'b', midi: 74, velocity: 100 }]);
    executeLeadTakeoverActions(target, [{ type: 'lead-note-off', channel: 1, midi: 74 }]);
    resetLeadTakeoverRuntimeState(target);

    expect(target.direct.filter((entry) => entry === `off:${TAKEOVER_USER_CHANNEL}:74`)).toHaveLength(1);
    expect(target.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:123:0`);
  });

  it('delays quantized realtime note-on until the target grid arrives', () => {
    vi.useFakeTimers();
    const target = directTarget();

    executeLeadTakeoverActions(target, [{
      type: 'lead-note-on',
      channel: 1,
      midi: 62,
      velocity: 104,
      timing: {
        sourceBeat: 1.01,
        targetBeat: 1.25,
        delayMs: 120,
        grid: '16th',
        gridStepBeats: 0.25,
      },
    }]);

    expect(target.direct.some((entry) => entry.startsWith(`on:${TAKEOVER_USER_CHANNEL}:62`))).toBe(false);
    vi.advanceTimersByTime(119);
    expect(target.direct.some((entry) => entry.startsWith(`on:${TAKEOVER_USER_CHANNEL}:62`))).toBe(false);
    vi.advanceTimersByTime(1);
    expect(target.direct).toContain(`on:${TAKEOVER_USER_CHANNEL}:62:104`);
    expect(target.events).toEqual([]);
  });

  it('keeps a complete quantized note when key-up happens before delayed note-on', () => {
    vi.useFakeTimers();
    const target = directTarget();

    executeLeadTakeoverActions(target, [{
      type: 'lead-note-on',
      channel: 1,
      midi: 64,
      velocity: 100,
      timing: {
        sourceBeat: 1.01,
        targetBeat: 1.25,
        delayMs: 120,
        grid: '16th',
        gridStepBeats: 0.25,
      },
    }]);
    executeLeadTakeoverActions(target, [{
      type: 'lead-note-off',
      channel: 1,
      midi: 64,
      timing: {
        sourceBeat: 1.02,
        targetBeat: 1.5,
        delayMs: 240,
        grid: '16th',
        gridStepBeats: 0.25,
      },
    }]);

    vi.advanceTimersByTime(119);
    expect(target.direct).not.toContain(`on:${TAKEOVER_USER_CHANNEL}:64:100`);
    expect(target.direct).not.toContain(`off:${TAKEOVER_USER_CHANNEL}:64`);

    vi.advanceTimersByTime(1);
    expect(target.direct).toContain(`on:${TAKEOVER_USER_CHANNEL}:64:100`);
    expect(target.direct).not.toContain(`off:${TAKEOVER_USER_CHANNEL}:64`);

    vi.advanceTimersByTime(120);
    expect(target.direct).toContain(`off:${TAKEOVER_USER_CHANNEL}:64`);
  });

  it('uses audio-clock lookahead for quantized note-on and note-off when available', () => {
    vi.useFakeTimers();
    const target = scheduledTarget();

    executeLeadTakeoverActions(target, [{
      type: 'lead-note-on',
      channel: 1,
      midi: 67,
      velocity: 101,
      timing: {
        sourceBeat: 1.01,
        targetBeat: 1.25,
        delayMs: 120,
        grid: '16th',
        gridStepBeats: 0.25,
      },
    }, {
      type: 'lead-note-off',
      channel: 1,
      midi: 67,
      timing: {
        sourceBeat: 1.02,
        targetBeat: 1.5,
        delayMs: 240,
        grid: '16th',
        gridStepBeats: 0.25,
      },
    }]);

    vi.advanceTimersByTime(94);
    expect(target.scheduled).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(target.scheduled[0]).toMatchObject({ type: 'on', channel: TAKEOVER_USER_CHANNEL, note: 67, velocity: 101 });
    expect(target.scheduled[0]?.audioTime).toBeCloseTo(10.12);

    vi.advanceTimersByTime(119);
    expect(target.scheduled).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(target.scheduled[1]).toMatchObject({ type: 'off', channel: TAKEOVER_USER_CHANNEL, note: 67 });
    expect(target.scheduled[1]?.audioTime).toBeCloseTo(10.24);
  });

  it('cancels pending quantized notes on runtime reset', () => {
    vi.useFakeTimers();
    const target = directTarget();

    executeLeadTakeoverActions(target, [{
      type: 'lead-note-on',
      channel: 1,
      midi: 65,
      velocity: 100,
      timing: {
        sourceBeat: 1.01,
        targetBeat: 1.25,
        delayMs: 120,
        grid: '16th',
        gridStepBeats: 0.25,
      },
    }]);
    resetLeadTakeoverRuntimeState(target);
    vi.advanceTimersByTime(200);

    expect(target.direct.some((entry) => entry.includes(':65'))).toBe(false);
    expect(target.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:123:0`);
  });

  it('tracks immediate takeover notes and releases them on runtime reset', () => {
    const target = directTarget();

    executeLeadTakeoverActions(target, [{ type: 'lead-note-on', channel: 1, midi: 69, velocity: 100 }]);
    resetLeadTakeoverRuntimeState(target);

    expect(target.direct).toContain(`on:${TAKEOVER_USER_CHANNEL}:69:100`);
    expect(target.direct).toContain(`off:${TAKEOVER_USER_CHANNEL}:69`);
    expect(target.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:123:0`);
  });

  it('pairs a future audio-clock note-on with a future note-off when reset happens during lookahead', () => {
    vi.useFakeTimers();
    const target = scheduledTarget();

    executeLeadTakeoverActions(target, [{
      type: 'lead-note-on',
      channel: 1,
      midi: 71,
      velocity: 96,
      timing: {
        sourceBeat: 1.01,
        targetBeat: 1.25,
        delayMs: 120,
        grid: '16th',
        gridStepBeats: 0.25,
      },
    }]);

    vi.advanceTimersByTime(95);
    expect(target.scheduled[0]).toMatchObject({ type: 'on', channel: TAKEOVER_USER_CHANNEL, note: 71, velocity: 96 });

    resetLeadTakeoverRuntimeState(target);

    expect(target.scheduled[1]).toMatchObject({ type: 'off', channel: TAKEOVER_USER_CHANNEL, note: 71 });
    expect(target.scheduled[1]?.audioTime).toBeCloseTo((target.scheduled[0]?.audioTime ?? 0) + 0.01);
    expect(target.direct).toContain(`cc:${TAKEOVER_USER_CHANNEL}:123:0`);
  });

  it('maps Q+T takeover notes through the final Aura25 lead program range', () => {
    const target = directTarget(fakeResult({ leadProgram: 25, styleHint: 'pop' }));

    const logs = executeLeadTakeoverActions(target, [{ type: 'lead-note-on', channel: 1, noteId: 'high-gtr', midi: 95, velocity: 104 }]);
    executeLeadTakeoverActions(target, [{ type: 'lead-note-off', channel: 1, noteId: 'high-gtr', midi: 95 }]);

    expect(logs).toContain('takeover noteOn ch15 95→83 v104');
    expect(target.direct).toContain(`pc:${TAKEOVER_USER_CHANNEL}:25`);
    expect(target.direct).toContain(`on:${TAKEOVER_USER_CHANNEL}:83:104`);
    expect(target.direct).toContain(`off:${TAKEOVER_USER_CHANNEL}:83`);
    resetLeadTakeoverRuntimeState(target);
  });
});
