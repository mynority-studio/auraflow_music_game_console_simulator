import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MusicGenerationResult } from '../generation/musicGeneration/types';
import { AudioEngine } from './AudioEngine';
import { Dream5504MidiOutput } from './Dream5504MidiOutput';
import { globalMidiScheduler } from './MidiScheduler';
import { generateMusicSync } from '../generation/musicGeneration/MusicGenerationService';
import { availableCurrentSongVoices } from '../generation/musicGeneration/currentSongVoiceOverride';
import { isAcousticPianoVoice } from '../sound/GMBK5X128Voices';

const audioEngineState = AudioEngine as unknown as {
  currentMusicGeneration: MusicGenerationResult | null;
};

afterEach(() => {
  audioEngineState.currentMusicGeneration = null;
  vi.restoreAllMocks();
});

describe('AudioEngine stop semantics', () => {
  it('stops playback while preserving the current generated score', () => {
    const result = { seed: 5504, ir: { tracks: [] } } as unknown as MusicGenerationResult;
    audioEngineState.currentMusicGeneration = result;
    const stopScheduler = vi.spyOn(globalMidiScheduler, 'stop').mockImplementation(() => undefined);
    const restoreMaster = vi.spyOn(Dream5504MidiOutput, 'applyDefaultMasterVolume').mockReturnValue(true);
    const previousPlaybackId = AudioEngine.currentPlaybackId();

    AudioEngine.stopPlaybackPreservingCurrentGeneration();

    expect(stopScheduler).toHaveBeenCalledOnce();
    expect(restoreMaster).toHaveBeenCalledOnce();
    expect(AudioEngine.currentPlaybackId()).toBe(previousPlaybackId + 1);
    expect(AudioEngine.getCurrentMusicGeneration()).toBe(result);
  });

  it('keeps full stop available for source changes', () => {
    const result = { seed: 5504, ir: { tracks: [] } } as unknown as MusicGenerationResult;
    audioEngineState.currentMusicGeneration = result;
    vi.spyOn(globalMidiScheduler, 'stop').mockImplementation(() => undefined);
    vi.spyOn(Dream5504MidiOutput, 'applyDefaultMasterVolume').mockReturnValue(true);

    AudioEngine.stop();

    expect(AudioEngine.getCurrentMusicGeneration()).toBeNull();
  });

  it('resets native timestamp lookahead against the replacement live voice channel', () => {
    const result = generateMusicSync({ seed: 1662, styleHint: 'pop', mood: 'build', targetDuration: 90 });
    const nextLead = availableCurrentSongVoices('lead').find((voice) =>
      voice.address.program !== result.ir!.tracks.find((track) => track.role === 'lead')!.program);
    expect(nextLead).toBeDefined();
    audioEngineState.currentMusicGeneration = result;
    vi.spyOn(globalMidiScheduler, 'getCurrentTick').mockReturnValue(241.2);
    const seek = vi.spyOn(globalMidiScheduler, 'setPosition').mockImplementation(() => undefined);
    const replace = vi.spyOn(globalMidiScheduler, 'replaceChannelEvents').mockImplementation(() => undefined);
    const restore = vi.spyOn(globalMidiScheduler, 'restoreChannelState');

    const updated = AudioEngine.overrideCurrentGenerationVoice({
      role: 'lead', bank: nextLead!.address.bank, program: nextLead!.address.program,
    });

    expect(updated?.ir).toBeDefined();
    expect(seek).toHaveBeenCalledWith(242);
    expect(replace).toHaveBeenCalledBefore(seek);
    expect(replace.mock.calls[0]?.[1]).toBe(0);
    expect(replace.mock.calls[0]?.[2]).toContainEqual(expect.objectContaining({
      ticks: 0,
      channel: 1,
      type: 'programChange',
      data1: nextLead!.address.program,
    }));
    expect(restore).toHaveBeenCalledWith(1, expect.objectContaining({
      atTick: 242,
      releaseCurrentSound: true,
      resetControllers: true,
      program: nextLead!.address.program,
    }));
    const stateSource = restore.mock.calls[0]?.[1]?.sourceEvents ?? [];
    expect(stateSource.some((event) => event.channel === 1 && event.type === 'programChange')).toBe(true);
  });

  it('restores the authored pedal-down state when an active ACG comp changes to an acoustic piano', () => {
    const result = generateMusicSync({ seed: 2_345_881_477, styleHint: 'acg', mood: 'build', targetDuration: 120 });
    const piano = availableCurrentSongVoices('comp').find((voice) =>
      isAcousticPianoVoice(voice.address.bank, voice.address.program));
    const compPedalDown = result.ir!.tracks.find((track) => track.role === 'comp')!
      .pedalEvents?.find((event) => event.down);
    expect(piano).toBeDefined();
    expect(compPedalDown).toBeDefined();
    const currentTick = (compPedalDown!.atTick as number) + 1;
    audioEngineState.currentMusicGeneration = result;
    vi.spyOn(globalMidiScheduler, 'getCurrentTick').mockReturnValue(currentTick);
    vi.spyOn(globalMidiScheduler, 'setPosition').mockImplementation(() => undefined);
    vi.spyOn(globalMidiScheduler, 'replaceChannelEvents').mockImplementation(() => undefined);
    const restore = vi.spyOn(globalMidiScheduler, 'restoreChannelState').mockImplementation((channel, options = {}) =>
      globalMidiScheduler.getChannelStateAt(channel, options.atTick ?? 0, options.sourceEvents ?? []));

    AudioEngine.overrideCurrentGenerationVoice({
      role: 'comp', bank: piano!.address.bank, program: piano!.address.program,
    });

    const [channel, options] = restore.mock.calls[0]!;
    const scoreState = globalMidiScheduler.getChannelStateAt(
      channel,
      options.atTick!,
      options.sourceEvents!,
    );
    expect(channel).toBe(2);
    expect(scoreState.sustain).toBeGreaterThanOrEqual(64);
    expect(options).toMatchObject({
      bankMsb: piano!.address.bank ?? 0,
      program: piano!.address.program,
      releaseCurrentSound: true,
      resetControllers: true,
    });
  });
});
