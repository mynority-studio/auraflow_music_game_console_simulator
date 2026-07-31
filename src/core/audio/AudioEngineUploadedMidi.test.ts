import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from './AudioEngine';
import { Dream5504MidiOutput } from './Dream5504MidiOutput';
import { globalMidiScheduler, type MidiEvent } from './MidiScheduler';

describe('AudioEngine uploaded MIDI native playback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('auto-enables the output and loads every event with a shared hardware-channel claim', async () => {
    const events: MidiEvent[] = [
      { ticks: 0, type: 'cc', channel: 0, data1: 64, data2: 127 },
      { ticks: 0, type: 'noteOn', channel: 0, data1: 60, data2: 100 },
      { ticks: 480, type: 'noteOff', channel: 0, data1: 60, data2: 0 },
      { ticks: 480, type: 'pitchBend', channel: 15, data1: 0x2100, data2: 0 },
    ];
    vi.spyOn(Dream5504MidiOutput, 'isReady').mockReturnValue(false);
    const enableOutput = vi.spyOn(Dream5504MidiOutput, 'enableOutput').mockResolvedValue(undefined);
    vi.spyOn(Dream5504MidiOutput, 'requireReady').mockReturnValue(true);
    vi.spyOn(Dream5504MidiOutput, 'panic').mockImplementation(() => undefined);
    const applyDefaultMaster = vi.spyOn(Dream5504MidiOutput, 'applyDefaultMasterVolume').mockReturnValue(true);
    vi.spyOn(globalMidiScheduler, 'stop').mockImplementation(() => undefined);
    const loadTrack = vi.spyOn(globalMidiScheduler, 'loadTrack').mockImplementation(() => undefined);
    const setVelocityScale = vi.spyOn(globalMidiScheduler, 'setChannelVelocityScale');
    vi.spyOn(globalMidiScheduler, 'start').mockImplementation(() => undefined);

    await AudioEngine.playUploadedMidi(events, 120);

    expect(AudioEngine.getCurrentPlaybackKind()).toBe('uploaded');
    expect(enableOutput).toHaveBeenCalledOnce();
    expect(applyDefaultMaster).toHaveBeenCalled();
    expect(loadTrack).toHaveBeenCalledOnce();
    expect(loadTrack.mock.calls[0][1]).toBe(120);
    expect(loadTrack.mock.calls[0][0]).toEqual(events.map((event) => ({
      ...event,
      outputChannel: event.channel + 1,
    })));

    AudioEngine.setUploadedMidiGainScale(0.9);
    expect(AudioEngine.getUploadedMidiGainScale()).toBe(0.9);
    expect(setVelocityScale).toHaveBeenCalledWith(0, 0.9);
    expect(setVelocityScale).toHaveBeenCalledWith(15, 0.9);

    AudioEngine.stop();
    expect(AudioEngine.getCurrentPlaybackKind()).toBeNull();
    expect(AudioEngine.getUploadedMidiGainScale()).toBe(1);
    expect(setVelocityScale).toHaveBeenCalledWith(0, 1);
    expect(setVelocityScale).toHaveBeenCalledWith(15, 1);

    const callsBeforeStaleGain = setVelocityScale.mock.calls.length;
    AudioEngine.setUploadedMidiGainScale(0.9);
    expect(AudioEngine.getUploadedMidiGainScale()).toBe(1);
    expect(setVelocityScale.mock.calls).toHaveLength(callsBeforeStaleGain);
  });

  it('starts generated playback at the default Master without applying the score master plan', async () => {
    const generated = {
      bpm: 120,
      styleHint: 'pop',
      ir: {
        tracks: [],
        timebase: { ppq: 480 },
        durationTicks: 480,
      },
    } as never;
    vi.spyOn(Dream5504MidiOutput, 'requireReady').mockReturnValue(true);
    vi.spyOn(Dream5504MidiOutput, 'panic').mockImplementation(() => undefined);
    const applyDefaultMaster = vi.spyOn(Dream5504MidiOutput, 'applyDefaultMasterVolume').mockReturnValue(true);
    vi.spyOn(globalMidiScheduler, 'stop').mockImplementation(() => undefined);
    vi.spyOn(globalMidiScheduler, 'loadTrack').mockImplementation(() => undefined);
    vi.spyOn(globalMidiScheduler, 'start').mockImplementation(() => undefined);

    await AudioEngine.playMusicGeneration(generated);

    expect(AudioEngine.getCurrentPlaybackKind()).toBe('generated');
    expect(applyDefaultMaster).toHaveBeenCalledOnce();
    AudioEngine.setUploadedMidiGainScale(0.9);
    expect(AudioEngine.getUploadedMidiGainScale()).toBe(1);
    AudioEngine.stop();
  });
});
