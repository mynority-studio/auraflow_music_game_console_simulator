import { describe, expect, it } from 'vitest';
import { musicalIRToMidiEvents } from '../../audio/musicalIrToMidi';
import { isAcousticPianoVoice } from '../../sound/GMBK5X128Voices';
import { generateMusicSync } from './MusicGenerationService';
import { applyCurrentSongVoiceOverride, availableCurrentSongVoices } from './currentSongVoiceOverride';

describe('musicGeneration/currentSongVoiceOverride', () => {
  it('只改当前歌曲 comp 的完整 Dream 地址，保留乐谱并清除自动段落换音色', () => {
    const original = generateMusicSync({ seed: 1662, styleHint: 'pop', mood: 'build', targetDuration: 90 });
    const guitar = availableCurrentSongVoices('comp').find((voice) => voice.address.bank === 0 && voice.address.program === 24);
    expect(guitar?.name).toBeTruthy();

    const changed = applyCurrentSongVoiceOverride(original, {
      role: 'comp', bank: guitar!.address.bank, program: guitar!.address.program,
    });
    const before = original.ir!.tracks.find((track) => track.role === 'comp')!;
    const after = changed.ir!.tracks.find((track) => track.role === 'comp')!;
    expect(after.notes).toEqual(before.notes);
    expect(after.program).toBe(24);
    expect(after.bank).toBe(0);
    expect(after.programChanges).toBeUndefined();
    expect(after.pedalEvents).toEqual(before.pedalEvents);
    expect(after.ccEvents).toEqual(before.ccEvents?.filter((event) => event.controller === 11));
    expect(changed.uiSnapshot.roster.find((player) => player.role === 'comp')).toMatchObject({
      program: 24, bank: 0, instrumentName: guitar!.name,
    });

    const compProgram = musicalIRToMidiEvents(changed.ir!, 0, changed.styleHint)
      .find((event) => event.channel === 2 && event.type === 'programChange');
    expect(compProgram?.data1).toBe(24);
  });

  it('琴→非琴→琴不会丢掉谱面原有的 CC64 lane', () => {
    const original = generateMusicSync({ seed: 2_345_881_477, styleHint: 'acg', mood: 'build', targetDuration: 120 });
    const before = original.ir!.tracks.find((track) => track.role === 'comp')!;
    const guitar = availableCurrentSongVoices('comp').find((voice) =>
      voice.address.bank === 0 && voice.address.program === 24)!;
    const piano = availableCurrentSongVoices('comp').find((voice) =>
      isAcousticPianoVoice(voice.address.bank, voice.address.program))!;
    expect(before.pedalEvents?.length ?? 0).toBeGreaterThan(0);

    const asGuitar = applyCurrentSongVoiceOverride(original, {
      role: 'comp', bank: guitar.address.bank, program: guitar.address.program,
    });
    const guitarTrack = asGuitar.ir!.tracks.find((track) => track.role === 'comp')!;
    expect(guitarTrack.pedalEvents).toEqual(before.pedalEvents);
    expect(musicalIRToMidiEvents(asGuitar.ir!, 0, asGuitar.styleHint)
      .some((event) => event.channel === 2 && event.type === 'cc' && event.data1 === 64)).toBe(false);

    const backToPiano = applyCurrentSongVoiceOverride(asGuitar, {
      role: 'comp', bank: piano.address.bank, program: piano.address.program,
    });
    const restoredTrack = backToPiano.ir!.tracks.find((track) => track.role === 'comp')!;
    expect(restoredTrack.pedalEvents).toEqual(before.pedalEvents);
    expect(musicalIRToMidiEvents(backToPiano.ir!, 0, backToPiano.styleHint)
      .some((event) => event.channel === 2 && event.type === 'cc' && event.data1 === 64)).toBe(true);
  });

  it('下拉候选只有可由对应声道真实承载的现代 Dream 音色', () => {
    const bass = availableCurrentSongVoices('bass');
    expect(bass.length).toBeGreaterThan(0);
    expect(bass.every((voice) => voice.roleCapabilities.includes('bass'))).toBe(true);
    expect(bass.every((voice) => (voice.address.bank ?? 0) !== 127)).toBe(true);
  });
});
