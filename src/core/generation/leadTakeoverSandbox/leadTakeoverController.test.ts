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
  it('reuses the same pad map while polling inside one unchanged chord', () => {
    const c = new LeadTakeoverController();
    const first = c.setSnapshot(snapshot, 1);
    const polled = c.setSnapshot(snapshot, 1.125);

    expect(polled).toBe(first);
    expect(c.getPadMap(1.25)).toBe(first);
  });

  it('refreshes selection layouts by measure and hands off on the first user note', () => {
    const measureSnapshot: TakeoverMusicSnapshot = {
      ...snapshot,
      source: 'midi-analysis',
      layoutMode: 'measure-notes',
      measures: [
        {
          id: 'm0',
          label: 'M0',
          startBeat: 0,
          durationBeats: 1,
          notes: [{
            id: 'pickup',
            sourceMidi: 59,
            priority: 400,
            structuralRole: 'backbone',
            metricLevel: 'strongBeat',
            melodicFunction: 'chordTone',
          }],
        },
        {
          id: 'm1',
          label: 'M1',
          startBeat: 1,
          durationBeats: 4,
          notes: [{
            id: 'main',
            sourceMidi: 64,
            priority: 400,
            structuralRole: 'backbone',
            metricLevel: 'downbeat',
            melodicFunction: 'chordTone',
          }],
        },
      ],
    };
    const c = new LeadTakeoverController();
    const pickupMap = c.setSnapshot(measureSnapshot, 0.5);

    expect(c.getPadMap(0.75)).toBe(pickupMap);
    expect(c.getPadMap(1.1)).not.toBe(pickupMap);
    expect(c.noteOn(0, 0.5)).toContainEqual({
      type: 'lead-mute',
      channel: 1,
      muted: true,
    });
    expect(c.getState()).toMatchObject({
      mode: 'takeover',
      leadMuted: true,
    });
    expect(c.tick(1)).toEqual([]);
  });

  it.each(['pop', 'jazz', 'lofi', 'rnb', 'acg'])(
    'mutes new native Lead attacks on the first %s user note-on',
    (styleHint) => {
      const c = new LeadTakeoverController();
      c.setSnapshot({ ...snapshot, styleHint }, 1.2);

      const actions = c.noteOn(0, 1.2);

      expect(actions[0]).toEqual({ type: 'lead-mute', channel: 1, muted: true });
      expect(c.getState().mode).toBe('takeover');
      expect(c.getState().firstInputBeat).toBe(1.2);
      expect(c.getState().inputCount).toBe(1);
      expect(c.getState().leadMuted).toBe(true);
      expect(c.tick(3.99)).toEqual([]);
      expect(c.tick(4)).toEqual([]);
    },
  );

  it('plays the takeover layout without muting an unsafe shared native channel', () => {
    const c = new LeadTakeoverController({ nativeLeadMuteEnabled: false });
    c.setSnapshot(snapshot, 1.2);

    expect(c.noteOn(0, 1.2)).toEqual([
      expect.objectContaining({ type: 'lead-note-on', channel: 1 }),
    ]);
    expect(c.getState()).toMatchObject({
      mode: 'takeover',
      leadMuted: false,
    });
    expect(c.tick(4)).toEqual([]);
  });

  it('ducks uploaded MIDI backing once on first input and restores it on exit', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot({ ...snapshot, source: 'midi-analysis' }, 1.2);

    expect(c.noteOn(0, 1.2)).toEqual([
      { type: 'lead-mute', channel: 1, muted: true },
      { type: 'backing-gain', scale: 0.9 },
      expect.objectContaining({ type: 'lead-note-on' }),
    ]);
    expect(c.getState().backingDucked).toBe(true);
    c.noteOff(0, 1.4);
    expect(c.noteOn(1, 1.5).some((action) => action.type === 'backing-gain')).toBe(false);

    expect(c.reset({ restoreNativeLead: true }))
      .toContainEqual({ type: 'backing-gain', scale: 1 });
    expect(c.getState().backingDucked).toBe(false);
  });

  it('does not duck generated Q+H backing on first input', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot({ ...snapshot, source: 'generated' }, 1.2);

    expect(c.noteOn(0, 1.2).some((action) => action.type === 'backing-gain')).toBe(false);
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
      expect(note.midi).toBe(c.getPadMap(4)?.cells[7]?.midi);
      const ordered = c.getPadMap(4)?.cells.map((cell) => cell.midi) ?? [];
      expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    }
    expect(c.getState().firstInputBeat).toBe(3.99);
    expect(c.getState().lastInputBeat).toBe(3.99);
  });

  it('hands off immediately even when input lands exactly on a bar line', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 4);

    c.noteOn(7, 4);

    expect(c.getState()).toMatchObject({
      mode: 'takeover',
      firstInputBeat: 4,
      leadMuted: true,
    });
    expect(c.tick(7.99)).toEqual([]);
    expect(c.tick(8)).toEqual([]);
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
        targetBeat: 1.3016666666666667,
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
        targetBeat: 1.3566666666666667,
        grid: '16th',
        gridStepBeats: 0.25,
      },
    });
  });

  it('uses distinct 32nd targets for rapid repeated note-ons', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1.16);

    const first = c.noteOn(0, 1.16).find((a) => a.type === 'lead-note-on');
    const second = c.noteOn(1, 1.21).find((a) => a.type === 'lead-note-on');

    expect(first).toMatchObject({
      type: 'lead-note-on',
      timing: {
        baseTargetBeat: 1.25,
        targetBeat: 1.25,
        grid: '16th',
      },
    });
    expect(second).toMatchObject({
      type: 'lead-note-on',
      timing: {
        grid: '32nd',
        gridStepBeats: 0.125,
      },
    });
    if (first?.type === 'lead-note-on' && second?.type === 'lead-note-on') {
      expect(second.timing?.targetBeat).toBeGreaterThan(first.timing?.targetBeat ?? 0);
      expect(second.timing?.delayMs).toBeLessThanOrEqual(60);
    }
  });

  it('uses the active groove contract for quantized note-on timing', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(swingSnapshot, 1.6);

    const note = c.noteOn(7, 1.6).find((a) => a.type === 'lead-note-on');

    expect(note).toMatchObject({
      type: 'lead-note-on',
      timing: {
        sourceBeat: 1.6,
        baseTargetBeat: 1.5,
        grooveContractId: 'jazz_medium_swing',
        grid: '16th',
      },
    });
    if (note?.type === 'lead-note-on') {
      expect(note.timing?.targetBeat).toBeCloseTo(1.67);
      expect(note.timing?.grooveOffsetMs).toBeCloseTo(102);
      expect(note.timing?.delayMs).toBeCloseTo(42);
    }
  });

  it('keeps note-off after the grooved note-on target for a complete grid duration', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(swingSnapshot, 1.6);

    c.noteOn(7, 1.6);
    const off = c.noteOff(7, 1.61).find((a) => a.type === 'lead-note-off');

    expect(off).toMatchObject({
      type: 'lead-note-off',
      timing: {
        sourceBeat: 1.61,
        gridStepBeats: 0.125,
        grid: '32nd',
        grooveContractId: 'jazz_medium_swing',
      },
    });
    if (off?.type === 'lead-note-off') {
      expect(off.timing?.targetBeat).toBeCloseTo(1.8516666666666666);
      expect(off.timing?.delayMs).toBeCloseTo(145);
    }
  });

  it('keeps native lead muted through silence until Q+T explicitly exits', () => {
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
    expect(c.tick(9)).toEqual([]);
    expect(c.getState()).toMatchObject({ mode: 'takeover', leadMuted: true });

    const exitActions = c.reset({ restoreNativeLead: true });
    expect(exitActions).toContainEqual({ type: 'lead-mute', channel: 1, muted: false });
    expect(exitActions).toContainEqual({ type: 'panic', channel: 1 });
    expect(c.getState().mode).toBe('idle');
  });

  it('reasserts native lead mute when a live result swap resets the sandbox', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot({ ...snapshot, styleHint: 'jazz' }, 1);
    c.noteOn(0, 1);
    c.tick(4);

    expect(c.reset()).toContainEqual({ type: 'lead-mute', channel: 1, muted: true });
    expect(c.getState()).toMatchObject({ mode: 'takeover', leadMuted: true });
  });

  it('keeps a muted lead muted after long-held notes are released', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1);
    c.noteOn(0, 1);
    c.noteOn(1, 1.1);
    c.noteOn(2, 1.2);
    expect(c.tick(5)).toEqual([]);

    expect(c.tick(9.5)).toEqual([]);
    expect(c.getState().mode).toBe('takeover');

    c.noteOff(0, 9.5);
    c.noteOff(1, 9.5);
    c.noteOff(2, 9.5);

    expect(c.tick(13.49)).toEqual([]);
    expect(c.tick(13.5)).toEqual([]);
    expect(c.getState()).toMatchObject({ mode: 'takeover', leadMuted: true });
  });

  it('emits the native Lead mute only once on the first user attack', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 0.1);
    const first = c.noteOn(0, 0.1);
    const second = c.noteOn(1, 0.2);

    expect(first.filter((action) => action.type === 'lead-mute')).toEqual([
      { type: 'lead-mute', channel: 1, muted: true },
    ]);
    expect(second.some((action) => action.type === 'lead-mute')).toBe(false);
    expect(c.getState()).toMatchObject({ mode: 'takeover', leadMuted: true });
  });

  it('returns note-off actions for held pads and reset cleanup actions', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1);
    const on = c.noteOn(0, 1);
    const noteOn = on.find((action) => action.type === 'lead-note-on');
    expect(noteOn?.type).toBe('lead-note-on');
    const midi = noteOn?.type === 'lead-note-on' ? noteOn.midi : -1;
    expect(c.noteOff(0)).toMatchObject([{ type: 'lead-note-off', channel: 1, midi }]);
  });

  it('releases the center pad with its pressed pitch after the chord layout changes', () => {
    const c = new LeadTakeoverController({ quantizeEnabled: false });
    c.setSnapshot(snapshot, 3.9);

    const on = c.noteOn(7, 3.9, 100, 'webmidi:0:60')
      .find((action) => action.type === 'lead-note-on');
    const pressedMidi = on?.type === 'lead-note-on' ? on.midi : -1;
    const nextLayoutMidi = c.getPadMap(4.1)?.cells[7]?.midi;
    const off = c.noteOff(7, 4.1, 'webmidi:0:60')
      .find((action) => action.type === 'lead-note-off');

    expect(nextLayoutMidi).not.toBe(pressedMidi);
    expect(off).toMatchObject({
      type: 'lead-note-off',
      noteId: on?.type === 'lead-note-on' ? on.noteId : undefined,
      midi: pressedMidi,
    });
  });

  it('ignores duplicate note-on for an already held pad', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1);

    expect(c.noteOn(0, 1)).toHaveLength(2);
    expect(c.noteOn(0, 1.01)).toEqual([]);
    expect(c.getState().inputCount).toBe(1);
  });

  it('keeps TapArea and Web MIDI holds on the same position independent', () => {
    const c = new LeadTakeoverController();
    c.setSnapshot(snapshot, 1);

    const tapOn = c.noteOn(7, 1, 104, 'tap:7').find((x) => x.type === 'lead-note-on');
    const midiOn = c.noteOn(7, 1.1, 83, 'webmidi:0:60').find((x) => x.type === 'lead-note-on');
    const midiOff = c.noteOff(7, 1.2, 'webmidi:0:60').find((x) => x.type === 'lead-note-off');

    expect(tapOn?.type === 'lead-note-on' ? tapOn.noteId : null).toBeTruthy();
    expect(midiOn?.type === 'lead-note-on' ? midiOn.noteId : null).toBeTruthy();
    expect(midiOff?.type === 'lead-note-off' ? midiOff.noteId : null)
      .toBe(midiOn?.type === 'lead-note-on' ? midiOn.noteId : null);
    expect(c.noteOff(7, 1.3, 'tap:7')).toMatchObject([{ type: 'lead-note-off' }]);
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
