import { describe, expect, it } from 'vitest';
import {
  buildTakeoverMetronomeHits,
  TAKEOVER_METRONOME_CHANNEL,
  TakeoverMetronomeRuntime,
  type TakeoverMetronomeAudioTarget,
} from './takeoverMetronome';
import type { TakeoverMusicSnapshot } from './types';

const snapshot: TakeoverMusicSnapshot = {
  styleHint: 'pop',
  key: 'C',
  tonality: 'major',
  bpm: 100,
  timeSignature: [4, 4],
  chords: [
    { rootPc: 0, quality: 'maj7', roman: 'I', startBeat: 0, durationBeats: 4, sectionId: 'A' },
  ],
  grooveContract: {
    id: 'test_pocket',
    melodySwingRatio: 0.5,
    melodyStrongPocketMs: [12, 12],
    melodyWeakPocketMs: [4, 4],
    accentPattern: [1, 0.82, 1.05, 0.82],
  },
};

function scheduledTarget(): TakeoverMetronomeAudioTarget & {
  scheduled: Array<{ type: 'on' | 'off' | 'pc' | 'cc'; channel: number; note: number; velocity?: number; audioTime: number }>;
} {
  const target = {
    scheduled: [] as Array<{ type: 'on' | 'off' | 'pc' | 'cc'; channel: number; note: number; velocity?: number; audioTime: number }>,
    getAudioTime: () => 10,
    noteOnAt: (channel: number, note: number, velocity: number, audioTime: number) => {
      target.scheduled.push({ type: 'on', channel, note, velocity, audioTime });
    },
    noteOffAt: (channel: number, note: number, audioTime: number) => {
      target.scheduled.push({ type: 'off', channel, note, audioTime });
    },
    noteOff: (channel: number, note: number) => {
      target.scheduled.push({ type: 'off', channel, note, audioTime: -1 });
    },
    programChange: (channel: number, program: number) => {
      target.scheduled.push({ type: 'pc', channel, note: program, audioTime: -3 });
    },
    controllerChange: (channel: number, controller: number, value: number) => {
      target.scheduled.push({ type: 'cc', channel, note: controller, velocity: value, audioTime: -2 });
    },
  };
  return target;
}

describe('leadTakeoverSandbox/takeoverMetronome', () => {
  it('uses an independent non-drum channel for ordinary metronome clicks', () => {
    expect(TAKEOVER_METRONOME_CHANNEL).toBe(14);
  });

  it('marks the bar downbeat with one higher click on the grooved strong pocket', () => {
    const hits = buildTakeoverMetronomeHits(snapshot, 0);

    expect(hits.map((hit) => hit.note)).toEqual([84]);
    expect(hits.every((hit) => hit.downbeat && hit.strong)).toBe(true);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.grooveBeat).toBeCloseTo(0.02);
  });

  it('uses accentPattern to separate strong beat guide hits from weak clicks', () => {
    const weak = buildTakeoverMetronomeHits(snapshot, 1);
    const strong = buildTakeoverMetronomeHits(snapshot, 2);

    expect(weak).toMatchObject([{ note: 78, strong: false }]);
    expect(strong.map((hit) => hit.note)).toEqual([81]);
    expect(strong.every((hit) => hit.strong && !hit.downbeat)).toBe(true);
  });

  it('schedules each base beat once with audio-clock note-offs and clears on stop', () => {
    const target = scheduledTarget();
    const runtime = new TakeoverMetronomeRuntime();

    runtime.schedule(target, snapshot, 0);
    runtime.schedule(target, snapshot, 0);

    const noteOns = target.scheduled.filter((event) => event.type === 'on');
    expect(noteOns.map((event) => `${event.channel}:${event.note}`)).toEqual([
      `${TAKEOVER_METRONOME_CHANNEL}:84`,
      `${TAKEOVER_METRONOME_CHANNEL}:78`,
    ]);
    expect(target.scheduled).toContainEqual({ type: 'pc', channel: TAKEOVER_METRONOME_CHANNEL, note: 108, audioTime: -3 });
    expect(target.scheduled).toContainEqual({ type: 'cc', channel: TAKEOVER_METRONOME_CHANNEL, note: 7, velocity: 62, audioTime: -2 });
    expect(noteOns[0]?.audioTime).toBeCloseTo(10.012);

    runtime.stop(target);
    expect(target.scheduled).toContainEqual({ type: 'cc', channel: TAKEOVER_METRONOME_CHANNEL, note: 123, velocity: 0, audioTime: -2 });
  });
});
