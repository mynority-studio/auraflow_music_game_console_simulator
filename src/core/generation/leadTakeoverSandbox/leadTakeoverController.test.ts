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

const swingSnapshot: TakeoverMusicSnapshot = {
  ...snapshot,
  grooveContract: {
    id: 'jazz_medium_swing',
    grid: 'swing',
    melodySwingRatio: 0.67,
    melodyStrongPocketMs: [0, 0],
    melodyWeakPocketMs: [0, 0],
  },
};

describe('leadTakeoverSandbox/LeadTakeoverController', () => {
  it('arms after three note-ons and mutes lead one bar after first input', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1.2);

    c.noteOn(0, 1.2);
    c.noteOn(1, 1.4);
    c.noteOn(2, 1.6);

    expect(c.getState().mode).toBe('pending-handoff');
    expect(c.getState().firstInputBeat).toBe(1.2);
    expect(c.getState().muteAtBeat).toBeCloseTo(5.2);
    expect(c.tick(5.19)).toEqual([]);
    expect(c.tick(5.2)).toEqual([{ type: 'lead-mute', channel: 1, muted: true }]);
    expect(c.getState().mode).toBe('takeover');
  });

  it('quantizes note-on timing while keeping handoff anchored to source beat', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 3.99);

    const actions = c.noteOn(7, 3.99);
    const note = actions.find((a) => a.type === 'lead-note-on');

    expect(note).toMatchObject({
      type: 'lead-note-on',
      timing: {
        sourceBeat: 3.99,
        targetBeat: 4,
        grid: '16th',
      },
    });
    if (note?.type === 'lead-note-on') {
      expect(note.timing?.delayMs).toBeGreaterThan(0);
      expect(note.timing?.delayMs).toBeLessThan(20);
      expect(note.midi % 12).toBe(9); // target beat 4 belongs to F chord; pad 7 maps to its 3rd.
    }
    expect(c.getState().firstInputBeat).toBe(3.99);
    expect(c.getState().lastInputBeat).toBe(3.99);
  });

  it('catches live note-ons near a strong beat without waiting for the next 16th', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1.01);

    const note = c.noteOn(7, 1.01).find((a) => a.type === 'lead-note-on');

    expect(note).toMatchObject({
      type: 'lead-note-on',
      timing: {
        sourceBeat: 1.01,
        baseTargetBeat: 1,
        targetBeat: 1.01,
        grid: '16th',
        gridStepBeats: 0.25,
      },
    });
    if (note?.type === 'lead-note-on') {
      expect(note.timing?.delayMs).toBe(0);
    }
  });

  it('uses 32nd quantization for very fast releases after the quantized note-on', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1.01);

    const on = c.noteOn(7, 1.01).find((a) => a.type === 'lead-note-on');
    const off = c.noteOff(7, 1.02).find((a) => a.type === 'lead-note-off');

    expect(on).toMatchObject({
      type: 'lead-note-on',
      timing: {
        sourceBeat: 1.01,
        baseTargetBeat: 1,
        targetBeat: 1.01,
        grid: '16th',
      },
    });
    expect(off).toMatchObject({
      type: 'lead-note-off',
      timing: {
        sourceBeat: 1.02,
        targetBeat: 1.1916666666666667,
        grid: '32nd',
        gridStepBeats: 0.125,
      },
    });
    if (off?.type === 'lead-note-off') {
      expect(off.timing?.delayMs).toBeCloseTo(103);
    }
  });

  it('extends late-caught short taps from the real note-on point, not only the rhythm anchor', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1.12);

    const on = c.noteOn(7, 1.12).find((a) => a.type === 'lead-note-on');
    const off = c.noteOff(7, 1.13).find((a) => a.type === 'lead-note-off');

    expect(on).toMatchObject({
      type: 'lead-note-on',
      timing: {
        sourceBeat: 1.12,
        baseTargetBeat: 1,
        targetBeat: 1.12,
        grid: '16th',
      },
    });
    expect(off).toMatchObject({
      type: 'lead-note-off',
      timing: {
        sourceBeat: 1.13,
        targetBeat: 1.3066666666666666,
        grid: '32nd',
        gridStepBeats: 0.125,
      },
    });
  });


  it('keeps normal releases on the preferred 16th grid', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1.01);

    c.noteOn(7, 1.01);
    const off = c.noteOff(7, 1.3).find((a) => a.type === 'lead-note-off');

    expect(off).toMatchObject({
      type: 'lead-note-off',
      timing: {
        sourceBeat: 1.3,
        targetBeat: 1.5566666666666666,
        grid: '16th',
        gridStepBeats: 0.25,
      },
    });
  });

  it('uses 32nd quantization for rapid repeated note-ons', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1.01);

    const first = c.noteOn(0, 1.01).find((a) => a.type === 'lead-note-on');
    const second = c.noteOn(1, 1.05).find((a) => a.type === 'lead-note-on');

    expect(first).toMatchObject({
      type: 'lead-note-on',
      timing: {
        baseTargetBeat: 1,
        targetBeat: 1.01,
        grid: '16th',
      },
    });
    expect(second).toMatchObject({
      type: 'lead-note-on',
      timing: {
        baseTargetBeat: 1,
        targetBeat: 1.05,
        grid: '32nd',
        gridStepBeats: 0.125,
      },
    });
  });

  it('uses the active groove contract for quantized note-on timing', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(swingSnapshot, 1.49);

    const note = c.noteOn(7, 1.49).find((a) => a.type === 'lead-note-on');

    expect(note).toMatchObject({
      type: 'lead-note-on',
      timing: {
        sourceBeat: 1.49,
        baseTargetBeat: 1.5,
        grooveContractId: 'jazz_medium_swing',
        grid: '16th',
      },
    });
    if (note?.type === 'lead-note-on') {
      expect(note.timing?.targetBeat).toBeCloseTo(1.67);
      expect(note.timing?.grooveOffsetMs).toBeCloseTo(102);
      expect(note.timing?.delayMs).toBeCloseTo(108);
    }
  });

  it('keeps note-off after the grooved note-on target for a complete grid duration', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(swingSnapshot, 1.49);

    c.noteOn(7, 1.49);
    const off = c.noteOff(7, 1.5).find((a) => a.type === 'lead-note-off');

    expect(off).toMatchObject({
      type: 'lead-note-off',
      timing: {
        sourceBeat: 1.5,
        gridStepBeats: 0.125,
        grid: '32nd',
        grooveContractId: 'jazz_medium_swing',
      },
    });
    if (off?.type === 'lead-note-off') {
      expect(off.timing?.targetBeat).toBeCloseTo(1.8516666666666666);
      expect(off.timing?.delayMs).toBeCloseTo(211);
    }
  });

  it('unmutes native lead after one silent bar in takeover mode', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1);
    c.noteOn(0, 1);
    c.noteOn(1, 1.1);
    c.noteOn(2, 1.2);
    c.tick(5);
    c.noteOff(0, 5);
    c.noteOff(1, 5);
    c.noteOff(2, 5);

    expect(c.tick(8.99)).toEqual([]);
    const actions = c.tick(9);
    expect(actions).toContainEqual({ type: 'lead-mute', channel: 1, muted: false });
    expect(actions).toContainEqual({ type: 'panic', channel: 1 });
    expect(c.getState().mode).toBe('idle');
  });

  it('does not treat a held long note as silence', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1);
    c.noteOn(0, 1);
    c.noteOn(1, 1.1);
    c.noteOn(2, 1.2);
    expect(c.tick(5)).toEqual([{ type: 'lead-mute', channel: 1, muted: true }]);

    expect(c.tick(9.5)).toEqual([]);
    expect(c.getState().mode).toBe('takeover');

    c.noteOff(0, 9.5);
    c.noteOff(1, 9.5);
    c.noteOff(2, 9.5);

    expect(c.tick(13.49)).toEqual([]);
    const release = c.tick(13.5);
    expect(release).toContainEqual({ type: 'lead-mute', channel: 1, muted: false });
    expect(release).toContainEqual({ type: 'panic', channel: 1 });
  });

  it('keeps pending handoff until one bar after the first input', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 0.1);
    c.noteOn(0, 0.1);
    c.noteOn(1, 0.2);
    c.noteOn(2, 0.3);
    expect(c.getState().mode).toBe('pending-handoff');

    expect(c.tick(4.09)).toEqual([]);
    expect(c.getState().mode).toBe('pending-handoff');
    expect(c.tick(4.1)).toEqual([{ type: 'lead-mute', channel: 1, muted: true }]);
  });

  it('returns note-off actions for held pads and reset cleanup actions', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1);
    const on = c.noteOn(0, 1);
    expect(on[0]?.type).toBe('lead-note-on');
    const midi = on[0]?.type === 'lead-note-on' ? on[0].midi : -1;
    expect(c.noteOff(0)).toMatchObject([{ type: 'lead-note-off', channel: 1, midi }]);
  });

  it('ignores duplicate note-on for an already held pad', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1);

    expect(c.noteOn(0, 1)).toHaveLength(1);
    expect(c.noteOn(0, 1.01)).toEqual([]);
    expect(c.getState().inputCount).toBe(1);
  });

  it('adds stable note ids so duplicate MIDI pads can release independently', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1);

    const a = c.noteOn(0, 1).find((x) => x.type === 'lead-note-on');
    const b = c.noteOn(1, 1.3).find((x) => x.type === 'lead-note-on');
    const offA = c.noteOff(0, 1.6).find((x) => x.type === 'lead-note-off');
    const offB = c.noteOff(1, 1.7).find((x) => x.type === 'lead-note-off');

    expect(a?.type === 'lead-note-on' ? a.noteId : null).toBeTruthy();
    expect(b?.type === 'lead-note-on' ? b.noteId : null).toBeTruthy();
    expect(a?.type === 'lead-note-on' && b?.type === 'lead-note-on' ? a.noteId !== b.noteId : false).toBe(true);
    expect(offA?.type === 'lead-note-off' ? offA.noteId : null).toBe(a?.type === 'lead-note-on' ? a.noteId : null);
    expect(offB?.type === 'lead-note-off' ? offB.noteId : null).toBe(b?.type === 'lead-note-on' ? b.noteId : null);
  });
});
