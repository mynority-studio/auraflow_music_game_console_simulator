import { describe, expect, it } from 'vitest';
import { generateMusicSync } from '../generation/musicGeneration/MusicGenerationService';
import { musicalIRToMidiEvents } from '../audio/musicalIrToMidi';
import { isAura25Program, mapMidiProgramToAura25, mapProgramToAura25 } from './Aura25Palette';

describe('Aura25Palette', () => {
  it('maps deleted GM programs back into the 25-slot palette', () => {
    expect(mapProgramToAura25(2, 'lead', 'pop')).toBe(4);
    expect(mapProgramToAura25(3, 'comp', 'pop')).toBe(4);
    expect(mapProgramToAura25(73, 'lead', 'pop')).toBe(66);
    expect(mapProgramToAura25(94, 'pad', 'lofi')).toBe(89);
    expect(mapProgramToAura25(35, 'bass', 'jazz')).toBe(32);
    expect(mapProgramToAura25(26, 'lead', 'jazz')).toBe(24);
    expect(mapProgramToAura25(27, 'comp', 'pop')).toBe(24);
    expect(mapProgramToAura25(67, 'lead', 'jazz')).toBe(67);
    expect(mapMidiProgramToAura25(65, 1, 'jazz')).toBe(66);
    expect(mapMidiProgramToAura25(24, 9, 'rnb')).toBe(25);
  });

  it('keeps Jazz Guitar deleted from the runtime role palette', () => {
    expect(isAura25Program(26, 'lead')).toBe(false);
    expect(isAura25Program(26, 'comp')).toBe(false);
    expect(isAura25Program(67, 'lead')).toBe(true);
  });

  it('keeps generated IR and MIDI program changes inside Aura25', () => {
    const styles = ['pop', 'jazz', 'lofi', 'rnb', 'acg'];
    for (const styleHint of styles) {
      for (let seed = 0; seed < 10; seed++) {
        const result = generateMusicSync({ seed, styleHint, mood: 'build', targetDuration: 90 });
        if (!result.ir) continue;
        for (const track of result.ir.tracks) {
          if (track.program !== undefined) expect(isAura25Program(track.program, track.role)).toBe(true);
          for (const pc of track.programChanges ?? []) expect(isAura25Program(pc.program, track.role)).toBe(true);
        }
        for (const ev of musicalIRToMidiEvents(result.ir)) {
          if (ev.type !== 'programChange') continue;
          const role = ev.channel === 9 ? 'drum'
            : ev.channel === 3 ? 'bass'
              : ev.channel === 2 ? 'comp'
                : ev.channel === 4 ? 'pad'
                  : ev.channel === 1 ? 'lead'
                    : undefined;
          expect(isAura25Program(ev.data1, role)).toBe(true);
        }
      }
    }
  });

  it('keeps generated Tenor Sax lead in a realistic thick jazz range', () => {
    let sawTenorSax = false;
    for (let seed = 0; seed < 24; seed++) {
      const result = generateMusicSync({ seed, styleHint: 'jazz', mood: 'build', targetDuration: 90 });
      const lead = result.ir?.tracks.find((track) => track.role === 'lead');
      if (!lead || lead.program !== 66) continue;
      sawTenorSax = true;
      for (const note of lead.notes) {
        expect(note.pitch, `seed ${seed} sax note`).toBeGreaterThanOrEqual(48);
        expect(note.pitch, `seed ${seed} sax note`).toBeLessThanOrEqual(72);
      }
    }
    expect(sawTenorSax).toBe(true);
  });
});
