import { describe, expect, it } from 'vitest';
import { generateMusicSync } from '../generation/musicGeneration/MusicGenerationService';
import { musicalIRToMidiEvents } from '../audio/musicalIrToMidi';
import { DRUM } from '../generation/newEngine/knowledge/grooves';
import { fitMidiToProgramRange, playableRangeForRole } from '../generation/newEngine/knowledge/instruments';
import { GM128_FULL_AUDITION_INSTRUMENTS } from './GMBK5X128Catalog';
import {
  AURA25_AUDITION_INSTRUMENTS,
  AURA25_PROGRAMS_BY_ROLE,
  GM128_BREATHY_TENOR_BANK,
  GM128_CHORUS_GUITAR_BANK,
  GM128_CITYPOP_FM_EP_BANK,
  GM128_DRUM_PROGRAMS,
  GM128_MELODIC_PROGRAMS,
  generatedAura25BankForProgram,
  gm128InstrumentName,
  isAura25Program,
  mapMidiProgramToAura25,
  mapProgramToAura25,
  type Aura25Role,
} from './Aura25Palette';

const AURA25_PITCH_AUDIT_CASES = [
  { bank: 0, name: 'Acoustic Grand Piano', role: 'lead', program: 0, range: [21, 108], probes: [[0, 24], [21, 21], [60, 60], [108, 108], [127, 103]] },
  { bank: 16, name: 'St.FM Electric Piano', role: 'comp', program: 5, range: [28, 103], probes: [[0, 36], [28, 28], [64, 64], [103, 103], [127, 103]] },
  { bank: 0, name: 'Nylon-String Guitar', role: 'comp', program: 24, range: [40, 88], probes: [[0, 48], [40, 40], [52, 52], [88, 64], [127, 67]] },
  { bank: 0, name: 'Steel-String Guitar', role: 'comp', program: 25, range: [40, 88], probes: [[0, 48], [40, 40], [52, 52], [88, 64], [95, 59], [127, 67]] },
  { bank: 0, name: 'Acoustic Bass', role: 'bass', program: 32, range: [28, 67], probes: [[0, 36], [28, 28], [40, 40], [67, 67], [127, 67]] },
  { bank: 0, name: 'Synth Bass 1', role: 'bass', program: 38, range: [24, 60], probes: [[0, 24], [24, 24], [36, 36], [60, 60], [127, 55]] },
  { bank: 8, name: 'Breathy Tenor', role: 'lead', program: 66, range: [44, 76], probes: [[0, 48], [43, 55], [44, 44], [50, 50], [66, 66], [76, 76], [96, 72], [127, 67]] },
  { bank: 0, name: 'Baritone Sax', role: 'lead', program: 67, range: [36, 72], probes: [[0, 36], [36, 36], [43, 43], [50, 50], [72, 72], [82, 70], [127, 67]] },
  { bank: 0, name: 'Warm Pad', role: 'pad', program: 89, range: [36, 96], probes: [[0, 36], [36, 36], [55, 55], [96, 96], [127, 91]] },
  { bank: 0, name: 'Kalimba', role: 'lead', program: 108, range: [60, 88], probes: [[0, 60], [60, 60], [72, 72], [88, 76], [96, 72], [127, 79]] },
] as const;

const DRUM_MIDI_KEYS = new Set<number>(Object.values(DRUM));

describe('Aura25Palette compatibility exports (Dream GM128 target)', () => {
  it('keeps the target as full GM128 plus Dream variation banks, not a local SF2 subset', () => {
    expect(GM128_MELODIC_PROGRAMS).toHaveLength(128);
    expect(GM128_MELODIC_PROGRAMS[0]).toBe(0);
    expect(GM128_MELODIC_PROGRAMS[127]).toBe(127);
    expect(GM128_DRUM_PROGRAMS).toEqual([0, 8, 16, 24, 25, 32, 40, 48, 56, 127]);
    expect(generatedAura25BankForProgram('pop', 'comp', 5)).toBe(GM128_CITYPOP_FM_EP_BANK);
    expect(generatedAura25BankForProgram('rnb', 'comp', 27)).toBe(GM128_CHORUS_GUITAR_BANK);
    expect(generatedAura25BankForProgram('jazz', 'lead', 66)).toBe(GM128_BREATHY_TENOR_BANK);
    expect(AURA25_AUDITION_INSTRUMENTS).toBe(GM128_FULL_AUDITION_INSTRUMENTS);
    expect(gm128InstrumentName(GM128_BREATHY_TENOR_BANK, 66, 'lead')).toBe('Breathy Tenor');
    expect(gm128InstrumentName(0, 11, 'lead')).toBe('Vibraphone');
  });

  it('keeps GM128 melodic programs as real Program Change values and only remaps unsupported drum kits', () => {
    expect(mapProgramToAura25(2, 'lead', 'pop')).toBe(2);
    expect(mapProgramToAura25(3, 'comp', 'pop')).toBe(3);
    expect(mapProgramToAura25(73, 'lead', 'pop')).toBe(73);
    expect(mapProgramToAura25(94, 'pad', 'lofi')).toBe(94);
    expect(mapProgramToAura25(35, 'bass', 'jazz')).toBe(35);
    expect(mapProgramToAura25(0, 'bass', 'acg')).toBe(0);
    expect(mapProgramToAura25(26, 'lead', 'jazz')).toBe(26);
    expect(mapProgramToAura25(27, 'comp', 'pop')).toBe(27);
    expect(mapProgramToAura25(11, 'lead', 'modal')).toBe(11);
    expect(mapProgramToAura25(11, 'comp', 'modal')).toBe(11);
    expect(mapProgramToAura25(66, 'lead', 'jazz')).toBe(66);
    expect(mapProgramToAura25(66, 'lead', 'rnb')).toBe(66);
    expect(mapMidiProgramToAura25(65, 1, 'jazz')).toBe(65);
    expect(mapMidiProgramToAura25(24, 9, 'rnb')).toBe(24);
    expect(mapMidiProgramToAura25(7, 9, 'pop')).toBe(8);
  });

  it('accepts the Dream GM128 role palette and drum kit Program Change set', () => {
    for (const p of [1, 4, 7, 11, 27, 33, 34, 39, 49, 66, 80, 81, 98]) expect(isAura25Program(p)).toBe(true);
    for (const p of GM128_DRUM_PROGRAMS) expect(isAura25Program(p, 'drum')).toBe(true);
    for (const p of [7, 23, 31, 47, 49]) expect(isAura25Program(p, 'drum')).toBe(false);
    expect(isAura25Program(26, 'lead')).toBe(false);
    expect(isAura25Program(26, 'comp')).toBe(false);
    expect(isAura25Program(25, 'comp')).toBe(true);
    expect(isAura25Program(11, 'lead')).toBe(true);
    expect(isAura25Program(11, 'comp')).toBe(true);
    expect(isAura25Program(66, 'lead')).toBe(true);
    expect(isAura25Program(67, 'lead')).toBe(true);
    expect(isAura25Program(0, 'bass')).toBe(true);
  });

  it('keeps generated IR and MIDI program changes inside the Dream GM128 target', () => {
    const styles = ['pop', 'jazz', 'lofi', 'rnb', 'acg', 'modal'];
    for (const styleHint of styles) {
      for (let seed = 0; seed < 24; seed++) {
        const result = generateMusicSync({ seed, styleHint, mood: 'build', targetDuration: 90 });
        if (!result.ir) continue;
        for (const track of result.ir.tracks) {
          if (track.program !== undefined) {
            expect(isAura25Program(track.program, track.role), `${styleHint} seed${seed} ${track.role} PC${track.program}`).toBe(true);
            if (track.role === 'drum') {
              for (const note of track.notes) {
                expect(DRUM_MIDI_KEYS.has(note.pitch as number), `${styleHint} seed${seed} drum MIDI ${note.pitch}`).toBe(true);
              }
            } else {
              const [lo, hi] = playableRangeForRole(track.role, track.program);
              for (const note of track.notes) {
                expect(note.pitch, `${styleHint} seed${seed} ${track.role} GM${track.program}`).toBeGreaterThanOrEqual(lo);
                expect(note.pitch, `${styleHint} seed${seed} ${track.role} GM${track.program}`).toBeLessThanOrEqual(hi);
              }
            }
          }
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
  }, 20000);

  it('audits every Dream GM128 audition preset and MIDI pitch-fitting case one by one', () => {
    for (const inst of AURA25_AUDITION_INSTRUMENTS) {
      expect(inst.bank, `${inst.name} CC0 bank`).toBeGreaterThanOrEqual(0);
      expect(inst.bank, `${inst.name} CC0 bank`).toBeLessThanOrEqual(127);
      expect(inst.sampleSizeBytes, `${inst.name} browser sample footprint`).toBe(0);
      expect(inst.sampleSizeLabel.length, `${inst.name} label`).toBeGreaterThan(0);
      expect(gm128InstrumentName(inst.bank, inst.program, inst.role), `${inst.name} official directory lookup`).toBe(inst.name);
    }

    const auditedPairs = new Set<string>();
    for (const c of AURA25_PITCH_AUDIT_CASES) {
      const audition = AURA25_AUDITION_INSTRUMENTS.find((inst) => inst.bank === c.bank && inst.program === c.program);
      expect(audition?.name, `${c.role} GM${c.program}`).toBe(c.name);
      expect(playableRangeForRole(c.role, c.program)).toEqual(c.range);
      expect(fitMidiToProgramRange(audition!.note, c.role, c.program), `${c.name} audition note`).toBe(audition!.note);
      for (const [input, expected] of c.probes) {
        expect(fitMidiToProgramRange(input, c.role, c.program), `${c.name} MIDI ${input}`).toBe(expected);
      }
      auditedPairs.add(`${c.role}:${c.program}`);
    }

    for (const [role, programs] of Object.entries(AURA25_PROGRAMS_BY_ROLE) as [Aura25Role, readonly number[]][]) {
      if (role === 'drum') continue;
      for (const program of programs) {
        const [lo, hi] = playableRangeForRole(role, program);
        for (const input of [0, lo - 12, lo, Math.round((lo + hi) / 2), hi, hi + 12, 127]) {
          const fitted = fitMidiToProgramRange(input, role, program);
          expect(fitted, `${role} GM${program} MIDI ${input}`).toBeGreaterThanOrEqual(lo);
          expect(fitted, `${role} GM${program} MIDI ${input}`).toBeLessThanOrEqual(hi);
        }
        auditedPairs.add(`${role}:${program}`);
      }
    }

    const expectedPairs = Object.entries(AURA25_PROGRAMS_BY_ROLE)
      .flatMap(([role, programs]) => role === 'drum' ? [] : programs.map((program) => `${role}:${program}`))
      .sort();
    expect([...auditedPairs].sort()).toEqual(expectedPairs);
  });
});
