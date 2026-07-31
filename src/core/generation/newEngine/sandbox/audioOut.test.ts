import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../../audio/AudioEngine';
import { claimMidiInputExclusive } from '../../motifSandbox/midi/webMidi';
import {
  auditionControlChange,
  auditionNoteOff,
  auditionNoteOn,
  resolveCurrentLeadAuditionVoice,
  silenceRawMidiAudition,
} from './audioOut';

describe('newEngine/sandbox/audioOut raw MIDI audition gate', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not send raw-pitch audition notes while Q+T owns MIDI input', () => {
    const noteOn = vi.spyOn(AudioEngine, 'noteOn').mockImplementation(() => undefined);
    const noteOff = vi.spyOn(AudioEngine, 'noteOff').mockImplementation(() => undefined);
    const controlChange = vi.spyOn(AudioEngine, 'controllerChange').mockImplementation(() => undefined);
    const programChange = vi.spyOn(AudioEngine, 'programChange').mockImplementation(() => undefined);
    const release = claimMidiInputExclusive('takeover');

    auditionNoteOn(48, 48, 100);
    auditionNoteOff(48);
    auditionControlChange(64, 127);

    expect(noteOn).not.toHaveBeenCalled();
    expect(noteOff).not.toHaveBeenCalled();
    expect(programChange).not.toHaveBeenCalled();
    expect(controlChange).not.toHaveBeenCalled();

    release();
  });

  it('clears every potentially sustained raw audition note on the shared channel', () => {
    const controlChange = vi.spyOn(AudioEngine, 'controllerChange').mockImplementation(() => undefined);

    silenceRawMidiAudition();

    expect(controlChange).toHaveBeenNthCalledWith(1, 15, 64, 0);
    expect(controlChange).toHaveBeenNthCalledWith(2, 15, 123, 0);
    expect(controlChange).toHaveBeenNthCalledWith(3, 15, 120, 0);
  });

  it('resolves raw input to the selected full CC0 + PC address of the live lead', () => {
    const voice = resolveCurrentLeadAuditionVoice({
      styleHint: 'POP',
      ir: {
        tracks: [{ role: 'lead', bank: 8, program: 4 }],
      },
      uiSnapshot: {
        styleHint: 'POP',
        tracks: [{ role: 'lead', bank: 0, program: 0 }],
      },
    } as never);

    expect(voice).toEqual({ bank: 8, program: 4 });
  });

  it('writes bank select before program change when the audition voice changes', () => {
    const controlChange = vi.spyOn(AudioEngine, 'controllerChange').mockImplementation(() => undefined);
    const programChange = vi.spyOn(AudioEngine, 'programChange').mockImplementation(() => undefined);
    const noteOn = vi.spyOn(AudioEngine, 'noteOn').mockImplementation(() => undefined);

    silenceRawMidiAudition();
    controlChange.mockClear();
    auditionNoteOn(60, { bank: 8, program: 4 }, 100);

    expect(controlChange).toHaveBeenNthCalledWith(1, 15, 64, 0);
    expect(controlChange).toHaveBeenNthCalledWith(2, 15, 123, 0);
    expect(controlChange).toHaveBeenNthCalledWith(3, 15, 121, 0);
    expect(controlChange).toHaveBeenNthCalledWith(4, 15, 0, 8);
    expect(programChange).toHaveBeenCalledWith(15, 4);
    expect(noteOn).toHaveBeenCalledWith(15, 60, 100);
  });
});
