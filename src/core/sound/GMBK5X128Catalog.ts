import gmbk5x128MidiTsv from '../../../components/samvs/DREAM_SDK_20250802/Free_Sounds/GMBK5X128_SoundBank/GMBK5X128_Midi.tsv?raw';

/** Canonical roles used by the Dream 5504 generation and MIDI-output path. */
export type GM128Role = 'bass' | 'comp' | 'pad' | 'lead' | 'drum';

/**
 * Hardware-facing sound families. These are deliberately separate from an
 * arrangement role: keyboard voices can be used by comp or lead, while a
 * drum kit is always selected on channel 10.
 */
export type GMBK5X128VoiceWorldFamily = 'keyboard' | 'bass' | 'pad' | 'drum';

export type GM128CatalogSource = 'gm' | 'variation' | 'drum';

export type GM128CatalogItem = {
  bank: number;
  program: number;
  role: GM128Role;
  name: string;
  note: number;
  sampleSizeBytes: number;
  sampleSizeLabel: string;
  source: GM128CatalogSource;
};

type MainProgramRow = {
  program: number;
  name: string;
};

type VariationRow = {
  bank: number;
  program: number;
  name: string;
};

const clampMidiProgram = (program: number): number => Math.max(0, Math.min(127, Math.round(program)));

export function gm128CatalogRoleForProgram(program: number): GM128Role {
  const p = clampMidiProgram(program);
  if (p >= 32 && p <= 39) return 'bass';
  if ((p >= 48 && p <= 55) || (p >= 88 && p <= 95)) return 'pad';
  if (p <= 31 || (p >= 44 && p <= 47)) return 'comp';
  return 'lead';
}

export function gm128CatalogNoteForProgram(program: number, role: GM128Role): number {
  const p = clampMidiProgram(program);
  if (role === 'drum') return 36;
  if (role === 'bass') return p >= 38 ? 36 : 40;
  if (role === 'pad') return 55;
  if (p >= 24 && p <= 31) return 52;
  if (p >= 8 && p <= 15) return p === 11 ? 65 : 72;
  if (p >= 40 && p <= 47) return 60;
  if (p >= 56 && p <= 63) return 58;
  if (p >= 64 && p <= 71) return p === 66 ? 50 : p === 67 ? 48 : 60;
  if (p >= 72 && p <= 79) return 72;
  if (p >= 104 && p <= 111) return 72;
  return 60;
}

function parseMainAndVariationRows(tsv: string): { main: MainProgramRow[]; variations: VariationRow[] } {
  const main: MainProgramRow[] = [];
  const variations: VariationRow[] = [];
  for (const line of tsv.split(/\r?\n/)) {
    const programMatch = line.match(/^\s*(\d{1,3}):\s*([^\t]+)/);
    if (!programMatch) continue;
    const program = Number(programMatch[1]);
    if (!Number.isFinite(program) || program < 0 || program > 127) continue;
    main.push({ program, name: programMatch[2].trim() });
    const variationPattern = /\(,(\d+)\):\s*([^\t]+)/g;
    let variationMatch: RegExpExecArray | null;
    while ((variationMatch = variationPattern.exec(line))) {
      const bank = Number(variationMatch[1]);
      if (!Number.isFinite(bank) || bank < 0 || bank > 127) continue;
      variations.push({ bank, program, name: variationMatch[2].trim() });
    }
  }
  return { main, variations };
}

function parseDrumKitRows(tsv: string): MainProgramRow[] {
  const lines = tsv.split(/\r?\n/);
  const nameLineIndex = lines.findIndex(line => line.includes('Standard Drum EQ') && line.includes('CM Drum-X'));
  if (nameLineIndex < 0) return [];
  const pcLine = lines.slice(nameLineIndex + 1).find(line => line.includes('Pc:'));
  if (!pcLine) return [];
  const names = lines[nameLineIndex].split('\t').map(part => part.trim()).filter(Boolean);
  const programs = [...pcLine.matchAll(/Pc:\s*(\d+)/g)].map(match => Number(match[1]));
  return programs.map((program, index) => ({
    program,
    name: names[index] ?? `Drum Kit PC${program}`,
  })).filter(row => Number.isFinite(row.program) && row.program >= 0 && row.program <= 127);
}

const parsed = parseMainAndVariationRows(gmbk5x128MidiTsv);
const parsedDrumKits = parseDrumKitRows(gmbk5x128MidiTsv);

export const GM128_MAIN_PROGRAMS: readonly GM128CatalogItem[] = parsed.main.map(row => {
  const role = gm128CatalogRoleForProgram(row.program);
  return {
    bank: 0,
    program: row.program,
    role,
    name: row.name,
    note: gm128CatalogNoteForProgram(row.program, role),
    sampleSizeBytes: 0,
    sampleSizeLabel: 'GM主音色',
    source: 'gm',
  };
});

export const GM128_VARIATION_PROGRAMS: readonly GM128CatalogItem[] = parsed.variations.map(row => {
  const role = gm128CatalogRoleForProgram(row.program);
  return {
    bank: row.bank,
    program: row.program,
    role,
    name: row.name,
    note: gm128CatalogNoteForProgram(row.program, role),
    sampleSizeBytes: 0,
    sampleSizeLabel: row.bank === 127 ? 'MT-32 CC0 127' : `CC0 ${row.bank}`,
    source: 'variation',
  };
});

export const GM128_DRUM_KITS: readonly GM128CatalogItem[] = parsedDrumKits.map(row => ({
  bank: 0,
  program: row.program,
  role: 'drum',
  name: row.name,
  note: row.program === 32 || row.program === 40 ? 38 : 36,
  sampleSizeBytes: 0,
  sampleSizeLabel: `Drum PC ${row.program}`,
  source: 'drum',
}));

export const GM128_FULL_AUDITION_INSTRUMENTS: readonly GM128CatalogItem[] = [
  ...GM128_MAIN_PROGRAMS,
  ...GM128_VARIATION_PROGRAMS,
  ...GM128_DRUM_KITS,
];

const programRange = (start: number, end: number): readonly number[] =>
  Array.from({ length: end - start + 1 }, (_, index) => start + index);

/** Piano, chromatic keyboard and organ groups in the official GM layout. */
export const GMBK5X128_KEYBOARD_PROGRAMS = programRange(0, 23);
/** The eight GM bass programs. */
export const GMBK5X128_BASS_PROGRAMS = programRange(32, 39);
/** The eight dedicated GM pad programs. Strings/choirs remain separate families. */
export const GMBK5X128_PAD_PROGRAMS = programRange(88, 95);
export const GMBK5X128_DRUM_PROGRAMS = GM128_DRUM_KITS.map(item => item.program);

const keyboardPrograms = new Set<number>(GMBK5X128_KEYBOARD_PROGRAMS);
const bassPrograms = new Set<number>(GMBK5X128_BASS_PROGRAMS);
const padPrograms = new Set<number>(GMBK5X128_PAD_PROGRAMS);

/**
 * Assign an official GMBK5X128 address to its playable hardware family.
 * Bank 127 contains cross-family compatibility remaps (for example PC32 is
 * Fantasia Pad rather than a bass). Those remain auditionable in the full
 * catalog, but are not put in a role whose register/gesture contract would
 * be wrong for the actual sound.
 */
export function gmbk5x128VoiceWorldFamilyFor(item: GM128CatalogItem): GMBK5X128VoiceWorldFamily | undefined {
  if (item.source === 'drum') return 'drum';
  if (keyboardPrograms.has(item.program)) return 'keyboard';
  if (item.bank === 127) return undefined;
  if (bassPrograms.has(item.program)) return 'bass';
  if (padPrograms.has(item.program)) return 'pad';
  return undefined;
}

function worldItemsFor(family: GMBK5X128VoiceWorldFamily): readonly GM128CatalogItem[] {
  return GM128_FULL_AUDITION_INSTRUMENTS.filter(item => gmbk5x128VoiceWorldFamilyFor(item) === family);
}

/**
 * Complete Dream 5504 inventory consumed by the orchestration layer. It
 * holds every official keyboard, bass, dedicated-pad and drum-kit address
 * that can safely share that family's musical register and gesture rules.
 */
export const GMBK5X128_VOICE_WORLD: Readonly<Record<GMBK5X128VoiceWorldFamily, readonly GM128CatalogItem[]>> = Object.freeze({
  keyboard: worldItemsFor('keyboard'),
  bass: worldItemsFor('bass'),
  pad: worldItemsFor('pad'),
  drum: worldItemsFor('drum'),
});

export const GMBK5X128_VOICE_WORLD_COUNTS: Readonly<Record<GMBK5X128VoiceWorldFamily, number>> = Object.freeze({
  keyboard: GMBK5X128_VOICE_WORLD.keyboard.length,
  bass: GMBK5X128_VOICE_WORLD.bass.length,
  pad: GMBK5X128_VOICE_WORLD.pad.length,
  drum: GMBK5X128_VOICE_WORLD.drum.length,
});

export const GM128_CATALOG_COUNTS = {
  mainPrograms: GM128_MAIN_PROGRAMS.length,
  variations: GM128_VARIATION_PROGRAMS.length,
  drumKits: GM128_DRUM_KITS.length,
  totalAuditionItems: GM128_FULL_AUDITION_INSTRUMENTS.length,
} as const;
