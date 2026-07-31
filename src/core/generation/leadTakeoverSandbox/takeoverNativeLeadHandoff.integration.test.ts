import { afterEach, describe, expect, it, vi } from 'vitest';
import { MidiScheduler, type MidiEvent } from '../../audio/MidiScheduler';
import { musicalIRToMidiEvents, ROLE_CHANNEL } from '../../audio/musicalIrToMidi';
import { generateMusicSync } from '../musicGeneration/MusicGenerationService';
import { LeadTakeoverController } from './leadTakeoverController';
import {
  executeLeadTakeoverActions,
  TAKEOVER_USER_CHANNEL,
  takeoverSnapshotFromMusicGeneration,
  type LeadTakeoverAudioTarget,
} from './qhTakeoverConsumer';

describe('leadTakeoverSandbox/native lead handoff integration', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['pop', 'jazz'])(
    'hands a real generated %s lead over on the first user input while the band keeps playing',
    (styleHint) => {
    const result = generateMusicSync({
      seed: 7,
      styleHint,
      mood: 'build',
      targetDuration: 90,
    });
    expect(result.status).toBe('ok');
    expect(result.ir).toBeTruthy();
    const ir = result.ir!;
    const ppq = ir.timebase.ppq;
    const leadChannel = ROLE_CHANNEL.lead;
    const leadNotes = ir.tracks.find((track) => track.role === 'lead')?.notes ?? [];
    const muteCandidate = leadNotes.find((note) => {
      const beat = (note.startTick as number) / ppq;
      return beat >= 5 && leadNotes.some((later) => {
        const laterBeat = (later.startTick as number) / ppq;
        return laterBeat > beat && laterBeat < beat + 4;
      });
    });
    expect(muteCandidate).toBeTruthy();

    vi.useFakeTimers();
    const scheduler = new MidiScheduler();
    const dispatched: Array<{ event: MidiEvent; timestampMs?: number }> = [];
    const direct: string[] = [];
    scheduler.addMidiEventListener((event, timestampMs) => {
      dispatched.push({ event, timestampMs });
    });
    scheduler.loadTrack(
      musicalIRToMidiEvents(ir, 0, result.styleHint),
      result.bpm,
      undefined,
      ir.durationTicks,
    );

    const beatsPerBar = result.uiSnapshot.timeSignature[0] * (4 / result.uiSnapshot.timeSignature[1]);
    const candidateBeat = (muteCandidate!.startTick as number) / ppq;
    const barStartBeat = Math.floor(candidateBeat / beatsPerBar) * beatsPerBar;
    const firstInputBeat = barStartBeat - 0.2;
    scheduler.setPosition(firstInputBeat * ppq);
    scheduler.start();

    const target: LeadTakeoverAudioTarget = {
      getCurrentTick: () => scheduler.getCurrentTick(),
      getPpq: () => scheduler.ppq,
      getCurrentMusicGeneration: () => result,
      injectMidiEvent: (event) => scheduler.injectEvent(event),
      muteChannel: (channel, muted) => scheduler.muteChannel(channel, muted),
      muteChannelGracefully: (channel, muted) => scheduler.muteChannelGracefully(channel, muted),
      noteOn: (channel, note, velocity) => direct.push(`on:${channel}:${note}:${velocity}`),
      noteOff: (channel, note) => direct.push(`off:${channel}:${note}`),
      programChange: (channel, program) => direct.push(`pc:${channel}:${program}`),
      controllerChange: (channel, controller, value) => direct.push(`cc:${channel}:${controller}:${value}`),
    };
    const controller = new LeadTakeoverController();
    controller.setSnapshot(takeoverSnapshotFromMusicGeneration(result), firstInputBeat);
    const firstInputActions = controller.noteOn(
      0,
      firstInputBeat,
      104,
      'integration:first-input',
    );
    executeLeadTakeoverActions(
      target,
      firstInputActions,
      { hardMuteDelayMs: 0 },
    );
    expect(controller.getState()).toMatchObject({
      mode: 'takeover',
      inputCount: 1,
      leadMuted: true,
    });
    expect(scheduler.isChannelMuted(leadChannel)).toBe(true);
    expect(firstInputActions.map((action) => action.type)).toContain('lead-note-on');
    const outputCountAtMute = dispatched.length;
    const sourceLeadNotesAfterMute = leadNotes.filter((note) => {
      const beat = (note.startTick as number) / ppq;
      return beat > firstInputBeat && beat < firstInputBeat + beatsPerBar;
    });
    expect(sourceLeadNotesAfterMute).not.toHaveLength(0);

    const msPerBeat = 60000 / result.bpm;
    vi.advanceTimersByTime(4 * msPerBeat);
    const postMute = dispatched.slice(outputCountAtMute).map(({ event }) => event);
    expect(postMute.filter((event) => event.type === 'noteOn' && event.channel === leadChannel)).toHaveLength(0);
    expect(postMute.filter((event) => event.type === 'noteOn' && event.channel !== leadChannel)).not.toHaveLength(0);
    const userLeadCountAtMute = direct.filter((entry) => entry.startsWith(`on:${TAKEOVER_USER_CHANNEL}:`)).length;
    executeLeadTakeoverActions(
      target,
      controller.noteOn(1, firstInputBeat + beatsPerBar, 101, 'integration:post-mute-input'),
      { hardMuteDelayMs: 0 },
    );
    vi.advanceTimersByTime(100);
    expect(scheduler.isChannelMuted(leadChannel)).toBe(true);
    expect(direct.filter((entry) => entry.startsWith(`on:${TAKEOVER_USER_CHANNEL}:`)).length)
      .toBe(userLeadCountAtMute + 1);
    scheduler.stop();
    },
  );

  it('hands off uploaded MIDI without a Q+H result and mutes only its analyzed lead channel', () => {
    vi.useFakeTimers();
    const mutedChannels = new Map<number, boolean>();
    const direct: string[] = [];
    const target: LeadTakeoverAudioTarget = {
      getCurrentTick: () => 4 * 480,
      getPpq: () => 480,
      getCurrentMusicGeneration: () => null,
      injectMidiEvent: () => undefined,
      muteChannel: (channel, muted) => mutedChannels.set(channel, muted),
      muteChannelGracefully: (channel, muted) => mutedChannels.set(channel, muted),
      isChannelMuted: (channel) => mutedChannels.get(channel) ?? false,
      noteOn: (channel, note, velocity) => direct.push(`on:${channel}:${note}:${velocity}`),
      noteOff: (channel, note) => direct.push(`off:${channel}:${note}`),
      programChange: () => undefined,
      controllerChange: () => undefined,
    };
    const controller = new LeadTakeoverController({ leadChannel: 3 });
    controller.setSnapshot({
      styleHint: 'pop',
      key: 'C',
      tonality: 'major',
      bpm: 120,
      timeSignature: [4, 4],
      source: 'midi-analysis',
      layoutMode: 'chord-analysis',
      chords: [{ rootPc: 0, quality: 'maj', startBeat: 0, durationBeats: 8 }],
    }, 3.8);

    executeLeadTakeoverActions(
      target,
      controller.noteOn(0, 3.8, 104, 'uploaded:first-input'),
      { nativeLeadChannel: 3, nativeLeadRouting: 'uploaded', hardMuteDelayMs: 0 },
    );
    vi.runOnlyPendingTimers();

    expect(controller.getState()).toMatchObject({ mode: 'takeover', leadMuted: true });
    expect(mutedChannels.get(3)).toBe(true);
    expect(mutedChannels.get(1)).not.toBe(true);
    expect(mutedChannels.get(2)).not.toBe(true);
    expect(direct.some((entry) => entry.startsWith(`on:${TAKEOVER_USER_CHANNEL}:`))).toBe(true);
  });

  it('keeps an external MIDI takeover note held across the uploaded-lead handoff boundary', () => {
    vi.useFakeTimers();
    const scheduler = new MidiScheduler();
    const direct: string[] = [];
    let backingGain = 1;
    let queueClears = 0;
    scheduler.addMidiQueueClearListener(() => { queueClears += 1; });
    scheduler.loadTrack([
      { ticks: 8 * 480, type: 'noteOn', channel: 3, data1: 72, data2: 96, outputChannel: 4 },
      { ticks: 16 * 480, type: 'noteOff', channel: 3, data1: 72, data2: 0, outputChannel: 4 },
    ], 120);
    scheduler.setPosition(3.8 * 480);
    scheduler.start();
    queueClears = 0;
    const target: LeadTakeoverAudioTarget = {
      getCurrentTick: () => scheduler.getCurrentTick(),
      getPpq: () => scheduler.ppq,
      getCurrentMusicGeneration: () => null,
      injectMidiEvent: (event) => scheduler.injectEvent(event),
      muteChannel: (channel, muted) => scheduler.muteChannel(channel, muted),
      muteChannelGracefully: (channel, muted) => scheduler.muteChannelGracefully(channel, muted),
      isChannelMuted: (channel) => scheduler.isChannelMuted(channel),
      noteOn: (channel, note, velocity) => direct.push(`on:${channel}:${note}:${velocity}`),
      noteOff: (channel, note) => direct.push(`off:${channel}:${note}`),
      programChange: () => undefined,
      controllerChange: () => undefined,
      setUploadedMidiGainScale: (scale) => { backingGain = scale; },
      getUploadedMidiGainScale: () => backingGain,
    };
    const controller = new LeadTakeoverController({ leadChannel: 3 });
    controller.setSnapshot({
      styleHint: 'pop',
      key: 'C',
      tonality: 'major',
      bpm: 120,
      timeSignature: [4, 4],
      source: 'midi-analysis',
      chords: [{ rootPc: 0, quality: 'maj', startBeat: 0, durationBeats: 16 }],
    }, 3.8);
    const options = {
      nativeLeadChannel: 3,
      nativeLeadRouting: 'uploaded' as const,
      hardMuteDelayMs: 0,
    };

    executeLeadTakeoverActions(
      target,
      controller.noteOn(7, 3.8, 104, 'webmidi:0:60'),
      options,
    );
    vi.advanceTimersByTime(2_000);

    expect(queueClears).toBe(0);
    expect(backingGain).toBe(0.9);
    expect(direct.filter((entry) => entry.startsWith(`on:${TAKEOVER_USER_CHANNEL}:`))).toHaveLength(1);
    expect(direct.find((entry) => entry.startsWith(`on:${TAKEOVER_USER_CHANNEL}:`)))
      .toContain(':104');
    expect(direct.filter((entry) => entry.startsWith(`off:${TAKEOVER_USER_CHANNEL}:`))).toHaveLength(0);

    executeLeadTakeoverActions(
      target,
      controller.noteOff(7, scheduler.getCurrentTick() / scheduler.ppq, 'webmidi:0:60'),
      options,
    );
    vi.advanceTimersByTime(200);
    expect(direct.filter((entry) => entry.startsWith(`off:${TAKEOVER_USER_CHANNEL}:`))).toHaveLength(1);
    executeLeadTakeoverActions(
      target,
      controller.reset({ restoreNativeLead: true }),
      options,
    );
    expect(backingGain).toBe(1);
    scheduler.stop();
  });

  it('keeps shared-channel accompaniment playing while muting only the extracted top voice', () => {
    vi.useFakeTimers();
    const scheduler = new MidiScheduler();
    const dispatched: MidiEvent[] = [];
    scheduler.addMidiEventListener((event) => dispatched.push(event));
    scheduler.loadTrack([
      { ticks: 4.5 * 480, type: 'noteOn', channel: 0, data1: 60, data2: 96, outputChannel: 1 },
      { ticks: 4.5 * 480, type: 'noteOn', channel: 0, data1: 76, data2: 96, outputChannel: 1 },
      { ticks: 5 * 480, type: 'noteOff', channel: 0, data1: 60, data2: 0, outputChannel: 1 },
      { ticks: 5 * 480, type: 'noteOff', channel: 0, data1: 76, data2: 0, outputChannel: 1 },
    ], 120);
    scheduler.setPosition(3.8 * 480);
    scheduler.start();
    const target: LeadTakeoverAudioTarget = {
      getCurrentTick: () => scheduler.getCurrentTick(),
      getPpq: () => scheduler.ppq,
      getCurrentMusicGeneration: () => null,
      injectMidiEvent: (event) => scheduler.injectEvent(event),
      muteChannel: (channel, muted) => scheduler.muteChannel(channel, muted),
      isChannelMuted: (channel) => scheduler.isChannelMuted(channel),
      muteNoteTargets: (targets, muted) => scheduler.muteNoteTargets(targets, muted),
      muteNoteTargetsGracefully: (targets, muted) =>
        scheduler.muteNoteTargetsGracefully(targets, muted),
      areNoteTargetsMuted: (targets) => scheduler.areNoteTargetsMuted(targets),
    };
    const controller = new LeadTakeoverController({ leadChannel: 0 });
    controller.setSnapshot({
      styleHint: 'pop',
      key: 'C',
      tonality: 'major',
      bpm: 120,
      timeSignature: [4, 4],
      source: 'midi-analysis',
      chords: [{ rootPc: 0, quality: 'maj', startBeat: 0, durationBeats: 8 }],
    }, 3.8);
    executeLeadTakeoverActions(
      target,
      controller.noteOn(0, 3.8, 104, 'fallback:first-input'),
      {
        nativeLeadChannel: 0,
        nativeLeadNoteTargets: [{
          channel: 0,
          midi: 76,
          startTick: 4.5 * 480,
          endTick: 5 * 480,
        }],
        nativeLeadRouting: 'uploaded',
      },
    );
    vi.advanceTimersByTime(400);

    const scoreNoteOns = dispatched.filter((event) =>
      event.type === 'noteOn' && event.ticks === 4.5 * 480);
    expect(scoreNoteOns.map((event) => event.data1)).toEqual([60]);
    expect(scheduler.isChannelMuted(0)).toBe(false);
    expect(scheduler.areNoteTargetsMuted([{
      channel: 0,
      midi: 76,
      startTick: 4.5 * 480,
      endTick: 5 * 480,
    }])).toBe(true);
    scheduler.stop();
  });
});
