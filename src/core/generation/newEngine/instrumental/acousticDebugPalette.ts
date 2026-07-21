// ============================================================
// newEngine · instrumental · acoustic debug palette
// ------------------------------------------------------------
// A reversible selection policy for tuning the Dream 5504's acoustic core.
// It never removes voices from the GMBK catalog; it only constrains automatic
// orchestration before the renderer sees a Program Change.
// ============================================================

import type { InstrumentRoleName } from '../band/BandSpec';
import type { AcousticInstrumentationIntent, AcousticInstrumentationProfileId } from '../arranger/acousticInstrumentationProfiles';

export type DreamOrchestrationPaletteId = 'full-modern-gm' | 'acoustic-debug';
export type AcousticSubsetReleaseStatus = 'active' | 'queued' | 'held';
export type AcousticSubsetSelectionMode = 'five-track-ready' | 'arranger-cue-only';

/** A modern GMBK melodic address. CC0=127 compatibility remaps never appear here. */
export interface AcousticMelodicVoiceAddress {
  bank: number;
  program: number;
}

export interface AcousticSubsetRelease {
  id: string;
  label: string;
  status: AcousticSubsetReleaseStatus;
  /** Shared physical expression contract; this is the audit/release unit. */
  expression: string;
  automaticControllers: readonly number[];
  auditionControllers: readonly number[];
  /** Exact CC0 + Program addresses, never a Program-only wildcard. */
  melodicVoices: readonly AcousticMelodicVoiceAddress[];
  drumPrograms?: readonly number[];
  /** Five-track roles may select ready voices; cue-only voices need an Arranger event. */
  selectionMode: AcousticSubsetSelectionMode;
}

/** The application starts in acoustic audition mode until the broader palette is re-audited. */
declare const __AURA_TEST_DEFAULT_DREAM_PALETTE__: DreamOrchestrationPaletteId | undefined;
export const ACTIVE_DREAM_ORCHESTRATION_PALETTE: DreamOrchestrationPaletteId = typeof __AURA_TEST_DEFAULT_DREAM_PALETTE__ === 'undefined'
  ? 'acoustic-debug'
  : __AURA_TEST_DEFAULT_DREAM_PALETTE__;

export const ACOUSTIC_DEBUG_DRUM_KITS = [0, 8, 16, 32, 40] as const;
const bank0 = (...programs: number[]): readonly AcousticMelodicVoiceAddress[] =>
  programs.map((program) => ({ bank: 0, program }));

/**
 * All acoustically playable GMBK groups are registered here before they enter
 * automatic arrangement. A group is released only after its shared gesture
 * and CC response have been auditioned on the 5504.
 */
export const ACOUSTIC_SUBSET_RELEASES: readonly AcousticSubsetRelease[] = Object.freeze([
  {
    id: 'piano-damper-core', label: '原声钢琴核心', status: 'active',
    expression: 'piano-damper / CC64 PedalPlan + phrase CC11', automaticControllers: [11, 64], auditionControllers: [67],
    melodicVoices: bank0(0), selectionMode: 'five-track-ready',
  },
  {
    id: 'vibraphone-damper', label: '颤音琴', status: 'held',
    expression: 'mallet-damper / CC64 needs audition', automaticControllers: [], auditionControllers: [64],
    melodicVoices: bank0(11), selectionMode: 'five-track-ready',
  },
  {
    id: 'mallet-strike-core', label: '马林巴', status: 'held',
    expression: 'mallet-strike / velocity and duration only', automaticControllers: [], auditionControllers: [],
    melodicVoices: bank0(12), selectionMode: 'five-track-ready',
  },
  {
    id: 'acoustic-bass-pluck', label: '原声 Bass', status: 'active',
    expression: 'bass-pluck / note timing and velocity', automaticControllers: [], auditionControllers: [],
    melodicVoices: bank0(32), selectionMode: 'five-track-ready',
  },
  {
    id: 'bowed-ensemble-bed', label: '弓弦乐组', status: 'active',
    expression: 'bowed-string / CC11; CC76/77/78 needs audition', automaticControllers: [11], auditionControllers: [76, 77, 78],
    melodicVoices: bank0(48), selectionMode: 'five-track-ready',
  },
  {
    id: 'acoustic-drum-kits', label: '原声鼓组', status: 'active',
    expression: 'drum-rudiment / note, velocity and timing', automaticControllers: [], auditionControllers: [],
    melodicVoices: [], drumPrograms: ACOUSTIC_DEBUG_DRUM_KITS, selectionMode: 'five-track-ready',
  },
  {
    id: 'acoustic-piano-variants', label: '亮钢琴与 Honky-tonk 钢琴', status: 'active',
    expression: 'piano-damper / CC64 PedalPlan + phrase CC11', automaticControllers: [11, 64], auditionControllers: [67],
    melodicVoices: bank0(1, 3), selectionMode: 'five-track-ready',
  },
  {
    id: 'mallet-strike-expansion', label: 'Celesta、钟琴、Music Box、木琴、管钟、扬琴', status: 'held',
    expression: 'mallet-strike / velocity and duration only', automaticControllers: [], auditionControllers: [],
    melodicVoices: [...bank0(8, 9, 10, 13, 14, 15), { bank: 16, program: 12 }, { bank: 8, program: 14 }, { bank: 9, program: 14 }, { bank: 1, program: 15 }],
    selectionMode: 'five-track-ready',
  },
  {
    id: 'solo-bowed-strings', label: '小提琴、中提琴、大提琴、低音提琴', status: 'active',
    expression: 'bowed-string / CC11; CC76/77/78 needs audition', automaticControllers: [11], auditionControllers: [76, 77, 78],
    melodicVoices: bank0(40, 41, 42, 43), selectionMode: 'five-track-ready',
  },
  {
    id: 'bowed-ensemble-expansion', label: '颤弓、慢弦乐与 Orchestra 2', status: 'active',
    expression: 'bowed-string / CC11; CC76/77/78 needs audition', automaticControllers: [11], auditionControllers: [76, 77, 78],
    melodicVoices: [...bank0(44, 49), { bank: 8, program: 48 }], selectionMode: 'five-track-ready',
  },
  {
    id: 'acoustic-plucked-strings', label: '羽管键琴、拨奏弦乐、竖琴', status: 'held',
    expression: 'plucked-string / note timing and velocity', automaticControllers: [], auditionControllers: [],
    melodicVoices: bank0(6, 45, 46), selectionMode: 'five-track-ready',
  },
  {
    id: 'acoustic-guitars', label: '尼龙、钢弦、爵士吉他与曼陀林', status: 'held',
    expression: 'guitar-pluck / note timing and velocity', automaticControllers: [], auditionControllers: [],
    melodicVoices: [
      ...bank0(24, 25, 26), { bank: 8, program: 24 }, { bank: 16, program: 24 },
      { bank: 1, program: 25 }, { bank: 16, program: 25 }, { bank: 24, program: 25 }, { bank: 32, program: 25 }, { bank: 8, program: 26 },
    ],
    selectionMode: 'five-track-ready',
  },
  {
    id: 'free-reed', label: '手风琴、口琴、探戈手风琴', status: 'held',
    expression: 'free-reed sustain / no automatic CC yet', automaticControllers: [], auditionControllers: [],
    melodicVoices: [...bank0(21, 22, 23), { bank: 8, program: 21 }], selectionMode: 'five-track-ready',
  },
  {
    id: 'brass', label: '铜管', status: 'held',
    expression: 'brass-air / CC11; CC76/77/78 needs audition', automaticControllers: [11], auditionControllers: [76, 77, 78],
    melodicVoices: [
      ...bank0(56, 57, 58, 59, 60, 61), { bank: 1, program: 56 }, { bank: 2, program: 56 }, { bank: 8, program: 56 }, { bank: 24, program: 56 },
      { bank: 1, program: 59 }, { bank: 2, program: 59 }, { bank: 8, program: 61 }, { bank: 16, program: 61 },
    ],
    selectionMode: 'five-track-ready',
  },
  {
    id: 'saxophone', label: '萨克斯', status: 'held',
    expression: 'sax-air / CC11; CC76/77/78 needs audition', automaticControllers: [11], auditionControllers: [76, 77, 78],
    melodicVoices: [...bank0(64, 65, 66, 67), { bank: 1, program: 64 }, { bank: 1, program: 65 }, { bank: 8, program: 65 }, { bank: 8, program: 66 }, { bank: 1, program: 67 }],
    selectionMode: 'five-track-ready',
  },
  {
    id: 'reed-woodwinds', label: '双簧、英国管、巴松、单簧管', status: 'held',
    expression: 'woodwind-air / CC11; CC76/77/78 needs audition', automaticControllers: [11], auditionControllers: [76, 77, 78],
    melodicVoices: [...bank0(68, 69, 70, 71), { bank: 1, program: 69 }, { bank: 1, program: 70 }, { bank: 8, program: 71 }],
    selectionMode: 'five-track-ready',
  },
  {
    id: 'flute-woodwinds', label: '长笛、短笛、竖笛、排箫等', status: 'held',
    expression: 'woodwind-air / CC11; CC76/77/78 needs audition', automaticControllers: [11], auditionControllers: [76, 77, 78],
    melodicVoices: bank0(72, 73, 74, 75, 76, 77, 78, 79), selectionMode: 'five-track-ready',
  },
  {
    id: 'world-plucked', label: '西塔琴、班卓、三味线、古筝、卡林巴', status: 'held',
    expression: 'plucked-string / note timing and velocity', automaticControllers: [], auditionControllers: [],
    melodicVoices: [...bank0(104, 105, 106, 107, 108), { bank: 8, program: 107 }], selectionMode: 'five-track-ready',
  },
  {
    id: 'world-bowed-and-wind', label: '提琴、风笛与唢呐', status: 'held',
    expression: 'separate bow/air contracts required before release', automaticControllers: [], auditionControllers: [11, 76, 77, 78],
    melodicVoices: bank0(109, 110, 111), selectionMode: 'five-track-ready',
  },
  {
    id: 'orchestral-cue-percussion', label: '定音鼓与管弦乐 Hit', status: 'held',
    expression: 'score-cue percussion / note, velocity and timing', automaticControllers: [], auditionControllers: [],
    melodicVoices: [...bank0(47, 55), { bank: 8, program: 55 }, { bank: 9, program: 55 }], selectionMode: 'arranger-cue-only',
  },
  {
    id: 'pitched-percussion-cues', label: '铃、阿哥哥、钢鼓、木鱼与响板', status: 'held',
    expression: 'pitched-percussion / note, velocity and timing', automaticControllers: [], auditionControllers: [],
    melodicVoices: [...bank0(112, 113, 114, 115), { bank: 8, program: 115 }], selectionMode: 'arranger-cue-only',
  },
]);

export const ACTIVE_ACOUSTIC_SUBSET_IDS = Object.freeze(
  ACOUSTIC_SUBSET_RELEASES.filter((subset) => subset.status === 'active').map((subset) => subset.id),
);

export const ACTIVE_ACOUSTIC_SUBSETS = Object.freeze(
  ACOUSTIC_SUBSET_RELEASES.filter((subset) => subset.status === 'active'),
);

const activeMelodicVoiceKeys = new Set(
  ACTIVE_ACOUSTIC_SUBSETS.flatMap((subset) => subset.melodicVoices)
    .map((voice) => `${voice.bank}/${voice.program}`),
);
const activeDrumPrograms = new Set(
  ACTIVE_ACOUSTIC_SUBSETS.flatMap((subset) => subset.drumPrograms ?? []),
);

export function isActiveAcousticMelodicVoice(voice: AcousticMelodicVoiceAddress): boolean {
  return activeMelodicVoiceKeys.has(`${voice.bank}/${voice.program}`);
}

export function isActiveAcousticDrumProgram(program: number): boolean {
  return activeDrumPrograms.has(program);
}

const ACOUSTIC_PIANO_VOICES = bank0(0, 1, 3);
const ACOUSTIC_BOWED_LEAD_VOICES = bank0(40, 41, 42);
const ACOUSTIC_BASS_VOICES = bank0(32, 32, 32, 43);
const ACOUSTIC_BOWED_PAD_VOICES: readonly AcousticMelodicVoiceAddress[] = [
  ...bank0(44, 48, 49),
  { bank: 8, program: 48 },
];

export interface AcousticTemplateVoices {
  comp: readonly AcousticMelodicVoiceAddress[];
  lead: readonly AcousticMelodicVoiceAddress[];
  bass: readonly AcousticMelodicVoiceAddress[];
  pad: readonly AcousticMelodicVoiceAddress[];
  drumProgram: number;
  sharedPianoRoles?: readonly InstrumentRoleName[];
}

/**
 * These are mappings, not style guesses. The Arranger has already selected
 * one id in AcousticInstrumentationIntent; Instrumental only resolves its
 * audited piano/bass/string address choices.
 */
export const ACOUSTIC_TEMPLATE_VOICES: Readonly<Record<AcousticInstrumentationProfileId, AcousticTemplateVoices>> = {
  'pop-piano-strings': {
    comp: ACOUSTIC_PIANO_VOICES,
    lead: [...ACOUSTIC_PIANO_VOICES, ...ACOUSTIC_BOWED_LEAD_VOICES],
    bass: ACOUSTIC_BASS_VOICES,
    pad: ACOUSTIC_BOWED_PAD_VOICES,
    drumProgram: 8,
  },
  'jazz-piano-trio': {
    comp: bank0(0), lead: bank0(0), bass: bank0(32), pad: ACOUSTIC_BOWED_PAD_VOICES,
    drumProgram: 40,
    sharedPianoRoles: ['lead', 'comp'],
  },
  'lofi-piano-small-group': {
    comp: ACOUSTIC_PIANO_VOICES,
    lead: ACOUSTIC_PIANO_VOICES,
    bass: bank0(32),
    pad: ACOUSTIC_BOWED_PAD_VOICES,
    drumProgram: 0,
  },
  'rnb-piano-strings': {
    comp: ACOUSTIC_PIANO_VOICES,
    lead: [...ACOUSTIC_PIANO_VOICES, ...bank0(42)],
    bass: ACOUSTIC_BASS_VOICES,
    pad: ACOUSTIC_BOWED_PAD_VOICES,
    drumProgram: 8,
  },
  'acg-piano-solo': {
    comp: ACOUSTIC_PIANO_VOICES,
    lead: ACOUSTIC_PIANO_VOICES,
    bass: ACOUSTIC_PIANO_VOICES,
    pad: ACOUSTIC_BOWED_PAD_VOICES,
    drumProgram: 0,
    sharedPianoRoles: ['lead', 'comp', 'bass'],
  },
};

function acousticDrumKit(style: string, requestedProgram: number | undefined): number {
  if (requestedProgram !== undefined && (ACOUSTIC_DEBUG_DRUM_KITS as readonly number[]).includes(requestedProgram)) {
    return requestedProgram;
  }
  switch (style.toLowerCase()) {
    case 'jazz': return 40; // Brush Drum
    case 'pop':
    case 'rnb': return 8;   // Room Drum
    case 'lofi':
    case 'acg': return 0;   // Standard Drum EQ
    default: return 16;     // Power Drum
  }
}

function selectorIndex(
  provisional: Partial<Record<InstrumentRoleName, number>>,
  salt: number,
  count: number,
): number {
  const signature = Math.abs(
    (provisional.lead ?? 0) * 17
    + (provisional.comp ?? 0) * 11
    + (provisional.bass ?? 0) * 7
    + salt,
  );
  return signature % count;
}

function selectVoice(
  voices: readonly AcousticMelodicVoiceAddress[],
  provisional: Partial<Record<InstrumentRoleName, number>>,
  salt: number,
): AcousticMelodicVoiceAddress {
  return voices[selectorIndex(provisional, salt, voices.length)]!;
}

export interface AcousticDebugPaletteResult {
  roleProgram: Partial<Record<InstrumentRoleName, number>>;
  roleBank: Partial<Record<InstrumentRoleName, number>>;
  sharedPianoRoles?: readonly InstrumentRoleName[];
  decisions: readonly string[];
}

/**
 * The current listening palette is intentionally constrained to four full
 * acoustic families: piano, acoustic bass, bowed strings and acoustic drums.
 * Each role selects only a physically suitable member of those active groups.
 *
 * Winds, guitars, electric/synth keys, electric/synth basses, synth pads,
 * electronic/808 kits and all other catalog entries remain installed but are
 * not selected by automatic generation in this mode.
 */
export function applyAcousticDebugPalette(args: {
  style: string;
  lineup: readonly InstrumentRoleName[];
  provisional: Partial<Record<InstrumentRoleName, number>>;
  requestedDrumProgram?: number;
  /** The score-level ensemble template has been chosen by Arranger. */
  instrumentationIntent?: AcousticInstrumentationIntent;
  palette?: DreamOrchestrationPaletteId;
}): AcousticDebugPaletteResult {
  if ((args.palette ?? ACTIVE_DREAM_ORCHESTRATION_PALETTE) !== 'acoustic-debug') {
    return { roleProgram: {}, roleBank: {}, decisions: ['palette=full-modern-gm'] };
  }

  const roleProgram: Partial<Record<InstrumentRoleName, number>> = {};
  const roleBank: Partial<Record<InstrumentRoleName, number>> = {};
  const template = args.instrumentationIntent ? ACOUSTIC_TEMPLATE_VOICES[args.instrumentationIntent.id] : undefined;
  const pianoSharedVoice = template?.sharedPianoRoles
    ? selectVoice(template.comp, args.provisional, 19)
    : undefined;
  const sharedVoiceFor = (role: InstrumentRoleName): AcousticMelodicVoiceAddress | undefined =>
    template?.sharedPianoRoles?.includes(role) ? pianoSharedVoice : undefined;
  if (args.lineup.includes('comp')) {
    const voice = sharedVoiceFor('comp') ?? selectVoice(template?.comp ?? ACOUSTIC_PIANO_VOICES, args.provisional, 3);
    roleProgram.comp = voice.program;
    roleBank.comp = voice.bank;
  }
  if (args.lineup.includes('lead')) {
    const voice = sharedVoiceFor('lead') ?? selectVoice(template?.lead ?? [...ACOUSTIC_PIANO_VOICES, ...ACOUSTIC_BOWED_LEAD_VOICES], args.provisional, 5);
    roleProgram.lead = voice.program;
    roleBank.lead = voice.bank;
  }
  if (args.lineup.includes('bass')) {
    const voice = sharedVoiceFor('bass') ?? selectVoice(template?.bass ?? ACOUSTIC_BASS_VOICES, args.provisional, 7);
    roleProgram.bass = voice.program;
    roleBank.bass = voice.bank;
  }
  if (args.lineup.includes('pad')) {
    const voice = selectVoice(template?.pad ?? ACOUSTIC_BOWED_PAD_VOICES, args.provisional, 13);
    roleProgram.pad = voice.program;
    roleBank.pad = voice.bank;
  }
  if (args.lineup.includes('drum')) roleProgram.drum = template?.drumProgram ?? acousticDrumKit(args.style, args.requestedDrumProgram);

  for (const role of ['comp', 'lead', 'bass', 'pad'] as const) {
    if (roleProgram[role] !== undefined && !isActiveAcousticMelodicVoice({ bank: roleBank[role] ?? 0, program: roleProgram[role]! })) {
      throw new Error(`Acoustic palette resolved an unreleased voice for ${role}: CC0=${roleBank[role] ?? 0} PC=${roleProgram[role]}`);
    }
  }
  if (roleProgram.drum !== undefined && !isActiveAcousticDrumProgram(roleProgram.drum)) {
    throw new Error(`Acoustic palette resolved an unreleased drum kit: PC=${roleProgram.drum}`);
  }

  return {
    roleProgram,
    roleBank,
    sharedPianoRoles: template?.sharedPianoRoles,
    decisions: [
      'palette=acoustic-debug',
      `arranger-template=${args.instrumentationIntent?.id ?? 'legacy-acoustic-fallback'}`,
      `active-subsets=${ACTIVE_ACOUSTIC_SUBSET_IDS.join(',')}`,
      'allowed: Acoustic Grand/Bright/Honky-tonk Piano; Acoustic/Contrabass; bowed solo and ensemble strings; Standard/Room/Power/Jazz/Brush drums',
      'blocked: mallets, plucked strings and guitars, free-reed, winds, electric/synth keys, electric/synth basses, synth pads, electronic/808 drums',
    ],
  };
}
