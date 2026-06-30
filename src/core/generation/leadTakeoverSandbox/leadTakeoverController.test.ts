import { describe, expect, it } from 'vitest';
import { LeadTakeoverController } from './leadTakeoverController';
import type { TakeoverMusicSnapshot } from './types';

const snapshot: TakeoverMusicSnapshot = {
  styleHint: 'pop',
  key: 'C',
  tonality: 'major',
  bpm: 100,
  timeSignature: [4, 4],
  chords: [
    { rootPc: 0, quality: 'maj', roman: 'I', startBeat: 0, durationBeats: 4 },
    { rootPc: 5, quality: 'maj', roman: 'IV', startBeat: 4, durationBeats: 4 },
    { rootPc: 7, quality: '7', roman: 'V', startBeat: 8, durationBeats: 4 },
  ],
};

describe('leadTakeoverSandbox/LeadTakeoverController', () => {
  it('arms after three note-ons and mutes lead after current bar plus next bar', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1.2);

    c.noteOn(0, 1.2);
    c.noteOn(1, 1.4);
    c.noteOn(2, 1.6);

    expect(c.getState().mode).toBe('pending-handoff');
    expect(c.getState().muteAtBeat).toBe(8);
    expect(c.tick(7.9)).toEqual([]);
    expect(c.tick(8)).toEqual([{ type: 'lead-mute', channel: 1, muted: true }]);
    expect(c.getState().mode).toBe('takeover');
  });

  it('unmutes native lead after one silent bar in takeover mode', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1);
    c.noteOn(0, 1);
    c.noteOn(1, 1.1);
    c.noteOn(2, 1.2);
    c.tick(8);

    expect(c.tick(11.99)).toEqual([]);
    const actions = c.tick(12);
    expect(actions).toContainEqual({ type: 'lead-mute', channel: 1, muted: false });
    expect(actions).toContainEqual({ type: 'panic', channel: 1 });
    expect(c.getState().mode).toBe('idle');
  });

  it('keeps pending handoff until the scheduled bar boundary', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 0.1);
    c.noteOn(0, 0.1);
    c.noteOn(1, 0.2);
    c.noteOn(2, 0.3);
    expect(c.getState().mode).toBe('pending-handoff');

    expect(c.tick(4.3)).toEqual([]);
    expect(c.getState().mode).toBe('pending-handoff');
    expect(c.tick(8)).toEqual([{ type: 'lead-mute', channel: 1, muted: true }]);
  });

  it('returns note-off actions for held pads and reset cleanup actions', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1);
    const on = c.noteOn(0, 1);
    expect(on[0]?.type).toBe('lead-note-on');
    const midi = on[0]?.type === 'lead-note-on' ? on[0].midi : -1;
    expect(c.noteOff(0)).toEqual([{ type: 'lead-note-off', channel: 1, midi }]);
  });
});
