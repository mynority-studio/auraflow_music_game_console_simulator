import { describe, expect, it } from 'vitest';

import { musicalIRToMidiEvents, ROLE_CHANNEL } from '../../audio/musicalIrToMidi';
import { dream5504VoiceName } from '../../sound/GMBK5X128Voices';
import { isAcousticPianoVoice } from '../../sound/GMBK5X128Voices';
import {
  ACTIVE_DREAM_ORCHESTRATION_PALETTE,
  isActiveAcousticDrumProgram,
  isActiveAcousticMelodicVoice,
} from '../newEngine/instrumental/acousticDebugPalette';
import { generateMusicSync } from './MusicGenerationService';
import type { QnRole } from './types';

const STYLES = ['pop', 'jazz', 'lofi', 'rnb', 'acg'] as const;
const SEEDS = Array.from({ length: 64 }, (_, index) => index);

interface RenderedVoiceTrack {
  readonly bank?: number;
  readonly program?: number;
  readonly programChanges?: readonly { readonly atTick: number; readonly bank?: number; readonly program: number }[];
}

function expectedVoices(track: RenderedVoiceTrack): Array<{ tick: number; bank: number; program: number }> {
  return [
    { tick: 0, bank: track.bank ?? 0, program: track.program ?? 0 },
    ...(track.programChanges ?? []).map((change) => ({
      tick: change.atTick as number,
      bank: change.bank ?? track.bank ?? 0,
      program: change.program,
    })),
  ];
}

function voiceAtTick(track: RenderedVoiceTrack, tick: number): { bank: number; program: number } {
  let bank = track.bank ?? 0;
  let program = track.program ?? 0;
  for (const change of track.programChanges ?? []) {
    if (change.atTick > tick) break;
    bank = change.bank ?? bank;
    program = change.program;
  }
  return { bank, program };
}

describe('musicGeneration/acousticPaletteConsumption', () => {
  const itWithAcousticDefault = ACTIVE_DREAM_ORCHESTRATION_PALETTE === 'acoustic-debug' ? it : it.skip;

  itWithAcousticDefault('production acoustic default never leaks held sounds and UI addresses equal the final Dream MIDI stream', () => {
    const consumedMelodic = new Set<string>();
    const consumedDrum = new Set<number>();
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const result = generateMusicSync({ seed, styleHint: style, mood: 'build', targetDuration: 90 });
        expect(result.ir, `${style}/${seed} generated IR`).toBeTruthy();
        const ir = result.ir!;
        const midi = musicalIRToMidiEvents(ir);

        for (const track of ir.tracks) {
          const role = track.role as QnRole;
          const uiTrack = result.uiSnapshot.tracks.find((candidate) => candidate.role === role);
          const uiPlayer = result.uiSnapshot.roster.find((candidate) => candidate.role === role);
          expect(uiTrack, `${style}/${seed}/${role} UI track`).toBeDefined();
          expect(uiPlayer, `${style}/${seed}/${role} UI roster`).toBeDefined();
          const trackMidi = midi.filter((event) => event.channel === ROLE_CHANNEL[role]);
          expect(trackMidi.some((event) => event.type === 'cc' && event.ticks === 0 && event.data1 === 121 && event.data2 === 0), `${style}/${seed}/${role} CC121 defaults`).toBe(true);
          expect(trackMidi.filter((event) => event.type === 'cc').every((event) => [0, 11, 64, 121].includes(event.data1)), `${style}/${seed}/${role} no CC7/CC10/FX shaping`).toBe(true);

          for (const controller of trackMidi.filter((event) => event.type === 'cc' && (event.data1 === 11 || event.data1 === 64))) {
            const current = voiceAtTick(track, controller.ticks);
            const previous = voiceAtTick(track, controller.ticks - 1);
            const validPianoState = isAcousticPianoVoice(current.bank, current.program)
              || (controller.data1 === 64 && controller.data2 <= 63 && isAcousticPianoVoice(previous.bank, previous.program));
            expect(validPianoState, `${style}/${seed}/${role} CC${controller.data1}@${controller.ticks} only Bank-0 acoustic piano`).toBe(true);
          }

          for (const planned of (track.ccEvents ?? []).filter((event) => event.controller === 11)) {
            const address = voiceAtTick(track, planned.atTick as number);
            const emitted = trackMidi.some((event) => event.type === 'cc'
              && event.ticks === planned.atTick && event.data1 === 11 && event.data2 === planned.value);
            expect(emitted, `${style}/${seed}/${role} planned piano CC11 must reach MIDI`).toBe(isAcousticPianoVoice(address.bank, address.program));
          }
          for (const planned of track.pedalEvents ?? []) {
            const current = voiceAtTick(track, planned.atTick as number);
            const previous = voiceAtTick(track, (planned.atTick as number) - 1);
            const emitted = trackMidi.some((event) => event.type === 'cc'
              && event.ticks === planned.atTick && event.data1 === 64 && event.data2 === (planned.down ? 127 : 0));
            const expected = isAcousticPianoVoice(current.bank, current.program)
              || (!planned.down && isAcousticPianoVoice(previous.bank, previous.program));
            expect(emitted, `${style}/${seed}/${role} planned piano CC64 must reach MIDI`).toBe(expected);
          }

          for (const voice of expectedVoices(track)) {
            if (role === 'drum') {
              expect(isActiveAcousticDrumProgram(voice.program), `${style}/${seed}/drum PC${voice.program}`).toBe(true);
              consumedDrum.add(voice.program);
            } else {
              expect(
                isActiveAcousticMelodicVoice({ bank: voice.bank, program: voice.program }),
                `${style}/${seed}/${role} CC0=${voice.bank} PC=${voice.program}`,
              ).toBe(true);
              consumedMelodic.add(`${voice.bank}/${voice.program}`);
            }

            const channelEvents = midi.filter((event) => event.channel === ROLE_CHANNEL[role] && event.ticks === voice.tick);
            const programChange = channelEvents.find((event) => event.type === 'programChange');
            expect(programChange?.data1, `${style}/${seed}/${role} MIDI PC@${voice.tick}`).toBe(voice.program);
            if (role !== 'drum') {
              const bankSelect = channelEvents.find((event) => event.type === 'cc' && event.data1 === 0);
              expect(bankSelect?.data2, `${style}/${seed}/${role} MIDI CC0@${voice.tick}`).toBe(voice.bank);
            }
          }

          const initial = expectedVoices(track)[0]!;
          const expectedName = dream5504VoiceName(role === 'drum' ? undefined : initial.bank, initial.program, role);
          expect(uiTrack!.program, `${style}/${seed}/${role} UI track PC`).toBe(initial.program);
          expect(uiTrack!.bank ?? 0, `${style}/${seed}/${role} UI track CC0`).toBe(initial.bank);
          expect(uiTrack!.instrumentName, `${style}/${seed}/${role} UI track name`).toBe(expectedName);
          expect(uiPlayer!.program, `${style}/${seed}/${role} UI roster PC`).toBe(initial.program);
          expect(uiPlayer!.bank ?? 0, `${style}/${seed}/${role} UI roster CC0`).toBe(initial.bank);
          expect(uiPlayer!.instrumentName, `${style}/${seed}/${role} UI roster name`).toBe(expectedName);
        }
      }
    }

    expect([...consumedMelodic].sort()).toEqual([
      '0/0', '0/1', '0/3', '0/32', '0/40', '0/41', '0/42', '0/43', '0/44', '0/48', '0/49', '8/48',
    ]);
    expect([...consumedDrum].sort((left, right) => left - right)).toEqual([0, 8, 40]);
  });
});
