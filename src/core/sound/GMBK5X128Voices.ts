import {
  GMBK5X128_DRUM_PROGRAMS,
  GMBK5X128_VOICE_WORLD,
  GMBK5X128_VOICE_WORLD_COUNTS,
  GM128_DRUM_KITS,
  GM128_MAIN_PROGRAMS,
  GM128_VARIATION_PROGRAMS,
  type GM128CatalogItem,
  type GM128CatalogSource,
  type GM128Role,
} from './GMBK5X128Catalog';

export type { GM128Role } from './GMBK5X128Catalog';

export interface GM128VoiceSelection {
  role: GM128Role;
  program: number;
  bank?: number;
  name: string;
  source: GM128CatalogSource;
  sampleSizeLabel: string;
}

export interface GM128VoiceRequest {
  style?: string;
  role: GM128Role;
  program: number | undefined;
  /** Explicit CC0 chosen by an orchestration-world candidate. */
  bank?: number;
  timbreWorld?: string;
}

/**
 * ACG PIANOSONG 的整首钢琴调色板。这里存的是 Dream 官方可寻址的
 * CC0 + Program 地址；编曲层会把同一个地址同时下发给右手旋律、和声
 * 与左手 bass，避免三条轨被误听成三台不同键盘。
 *
 * 自动调色板只放已经验证能消费 CC64 的原声钢琴。电钢仍可供显式
 * audition/手动编制使用，但不进入会写抒情长尾的自动 ACG 选择；否则
 * 同一首“钢琴曲”会随机落到没有可靠 damper 的声音上。
 */
const ACG_PIANOSONG_PIANO_ADDRESSES = [
  { bank: 0, program: 0, weight: 12 },  // Acoustic Grand Piano
  { bank: 0, program: 1, weight: 3 },   // Bright Acoustic Piano
  { bank: 0, program: 3, weight: 1 },   // Honky-tonk Piano (small weathered color)
] as const;

export interface AcgPianoSongVoice {
  bank: number;
  program: number;
  name: string;
  source: GM128CatalogSource;
  weight: number;
}

function acgPianoSongCatalogTone(bank: number, program: number): GM128CatalogItem {
  const tone = bank === 0
    ? GM128_MAIN_PROGRAMS.find((item) => item.program === program)
    : GM128_VARIATION_PROGRAMS.find((item) => item.bank === bank && item.program === program);
  if (!tone) throw new Error(`Missing official ACG PIANOSONG voice: CC0=${bank}, PC=${program}`);
  return tone;
}

/** 仅保留适合抒情日式钢琴短篇的官方 GMBK5X128 声音。 */
export const ACG_PIANOSONG_PIANO_VOICES: readonly AcgPianoSongVoice[] = Object.freeze(
  ACG_PIANOSONG_PIANO_ADDRESSES.map((address) => {
    const tone = acgPianoSongCatalogTone(address.bank, address.program);
    return { ...address, name: tone.name, source: tone.source };
  }),
);

/**
 * ACG 左手允许的 GM Program。自动 palette 以外的 Electric/Soft Electric
 * Piano 保留给显式 audition，不可据此推断它们支持自动 CC64。
 */
export const ACG_PIANOSONG_PIANO_PROGRAMS: readonly number[] = Object.freeze(
  [...new Set([...ACG_PIANOSONG_PIANO_VOICES.map((voice) => voice.program), 2, 4])],
);

export function isAcgPianoSongPianoProgram(program: number | undefined): boolean {
  return program !== undefined && ACG_PIANOSONG_PIANO_PROGRAMS.includes(program);
}

/** Bank-0 acoustic piano family used by the audited acoustic arrangement profiles. */
export function isAcousticPianoProgram(program: number | undefined): boolean {
  return program === 0 || program === 1 || program === 3;
}

/**
 * Automatic piano controllers are intentionally keyed by the complete Dream
 * address. PC0/1/3 in a variation or MT-32 compatibility bank must never
 * inherit the Bank-0 acoustic-piano pedal/expression policy.
 */
export function isAcousticPianoVoice(bank: number | undefined, program: number | undefined): boolean {
  return (bank ?? 0) === 0 && isAcousticPianoProgram(program);
}

/** Bank-0 表情键盘族(原声钢琴 + EG/EP 电钢 0-5):乐句级 CC11 的家族门;
 *  具体音色能否自动发 CC 仍由 dreamCcCapabilities 注册表最终仲裁。 */
export function isExpressiveKeyboardVoice(bank: number | undefined, program: number | undefined): boolean {
  return (bank ?? 0) === 0 && program !== undefined && program >= 0 && program <= 5;
}

const GM128_GENERATION_VARIATION_ADDRESSES = [
  { bank: 8, program: 4 }, { bank: 16, program: 5 }, { bank: 24, program: 5 },
  { bank: 16, program: 24 }, { bank: 1, program: 25 }, { bank: 8, program: 25 }, { bank: 9, program: 25 },
  { bank: 8, program: 27 }, { bank: 2, program: 33 }, { bank: 1, program: 34 },
  { bank: 9, program: 38 }, { bank: 16, program: 38 }, { bank: 17, program: 39 },
  { bank: 19, program: 39 }, { bank: 8, program: 66 }, { bank: 1, program: 67 },
  { bank: 3, program: 89 }, { bank: 8, program: 107 }, { bank: 16, program: 12 },
] as const;

/**
 * Curated variation addresses, with labels resolved from the complete Dream catalog.
 * They remain available to explicit full-address orchestration/audition; being
 * present here does not make a variation interchangeable with its Bank-0 voice.
 */
export const GM128_GENERATION_VARIATION_VOICES = GM128_GENERATION_VARIATION_ADDRESSES.map((address) => {
  const tone = GM128_VARIATION_PROGRAMS.find((item) => item.bank === address.bank && item.program === address.program);
  if (!tone) throw new Error(`Missing official GMBK5X128 variation: CC0=${address.bank}, PC=${address.program}`);
  return { ...address, name: tone.name };
});

const normStyle = (style?: string): string => (style ?? '').toLowerCase();
const clampProgram = (program: number | undefined): number => Math.max(0, Math.min(127, Math.round(program ?? 0)));

function catalogTone(role: GM128Role, program: number, bank: number): GM128CatalogItem | undefined {
  if (role === 'drum') return GM128_DRUM_KITS.find((item) => item.program === program);
  if (bank > 0) return GM128_VARIATION_PROGRAMS.find((item) => item.bank === bank && item.program === program);
  return GM128_MAIN_PROGRAMS.find((item) => item.program === program);
}

const drumProgramSet = new Set<number>(GMBK5X128_DRUM_PROGRAMS);

export const DREAM5504_TARGET_ID = 'dream-gmbk5x128';
export const DREAM5504_LABEL = 'Dream 5504 · GMBK5X128';
export const DREAM5504_HINT = 'Dream5504 GMBK5X128: melodic voices use CC0 + Program Change; drum kits use Program Change on channel 10.';
export const DREAM5504_MELODIC_PROGRAMS = Array.from({ length: 128 }, (_, index) => index) as readonly number[];
export const DREAM5504_DRUM_PROGRAMS = GMBK5X128_DRUM_PROGRAMS;
/**
 * @deprecated Compatibility export for the old four-family browser list.
 * NewEngine orchestration resolves full CC0 + PC profiles in
 * `instrumental/dreamVoiceProfiles` instead.
 */
export const DREAM5504_VOICE_WORLD = GMBK5X128_VOICE_WORLD;
/** @deprecated See DREAM5504_VOICE_WORLD. */
export const DREAM5504_VOICE_WORLD_COUNTS = GMBK5X128_VOICE_WORLD_COUNTS;

export const DREAM5504_PROGRAMS_BY_ROLE: Readonly<Record<GM128Role, readonly number[]>> = Object.freeze({
  // Keyboard world is shared by lead and comp. The orchestration capability
  // guard still keeps sustained organs out of rhythmic comping.
  lead: GMBK5X128_VOICE_WORLD.keyboard.map(item => item.program),
  comp: GMBK5X128_VOICE_WORLD.keyboard.map(item => item.program),
  // ACG PIANOSONG 的白名单钢琴可作为左手 bass；其余仍是官方 bass 世界。
  bass: [...ACG_PIANOSONG_PIANO_PROGRAMS, ...GMBK5X128_VOICE_WORLD.bass.map(item => item.program)],
  pad: [...new Set([
    ...GMBK5X128_VOICE_WORLD.pad.map(item => item.program),
    ...GMBK5X128_VOICE_WORLD.keyboard.filter(item => item.program >= 16 && item.program <= 23).map(item => item.program),
  ])],
  drum: DREAM5504_DRUM_PROGRAMS,
});

export function findGMBK5X128Tone(bank: number | undefined, program: number, role: GM128Role): GM128CatalogItem | undefined {
  return catalogTone(role, clampProgram(program), role === 'drum' ? 0 : (bank ?? 0));
}

export function isGMBK5X128VoiceAddressable(bank: number | undefined, program: number, role: GM128Role): boolean {
  return !!findGMBK5X128Tone(bank, program, role);
}

export function selectGMBK5X128Voice(request: GM128VoiceRequest): GM128VoiceSelection {
  const role = request.role;
  const program = clampProgram(request.program);
  // Catalog lookup resolves only the full address supplied by orchestration.
  // A style name must never silently turn a Bank-0 instrument into a different
  // resonant/FX variation that happens to share the same Program number.
  const preferredBank = role === 'drum' ? undefined : (request.bank ?? 0);
  const tone = catalogTone(role, program, preferredBank ?? 0)
    ?? catalogTone(role, program, 0)
    ?? catalogTone(role, 0, 0);
  const bank = role === 'drum' ? undefined : (tone?.bank ?? 0);
  return {
    role,
    program: tone?.program ?? program,
    bank,
    name: tone?.name ?? `GM${program}`,
    source: tone?.source ?? 'gm',
    sampleSizeLabel: tone?.sampleSizeLabel ?? 'GM主音色',
  };
}

/** Official 5504 name for a concrete CC0 + Program address. */
export function dream5504VoiceName(bank: number | undefined, program: number | undefined, role: GM128Role): string | undefined {
  if (program === undefined) return undefined;
  return findGMBK5X128Tone(bank, program, role)?.name
    ?? findGMBK5X128Tone(0, program, role)?.name;
}

function styleFallback(role: GM128Role, style?: string): number {
  const normalized = normStyle(style);
  if (role === 'drum') {
    if (normalized === 'jazz' || normalized === 'blues') return 40;
    if (normalized === 'lofi' || normalized === 'rnb' || normalized === 'modal') return 25;
    return 8;
  }
  if (role === 'bass') return normalized === 'jazz' || normalized === 'acg' ? 32 : 38;
  if (role === 'pad') return 89;
  if (role === 'comp') return normalized === 'rnb' || normalized === 'lofi' || normalized === 'pop' ? 5 : 0;
  if (normalized === 'jazz' || normalized === 'blues') return 66;
  if (normalized === 'lofi' || normalized === 'modal') return 108;
  if (normalized === 'rnb') return 5;
  return 0;
}

/**
 * Last-line hardware safety mapper. The planner owns artistic selection;
 * this only prevents malformed program numbers from reaching the 5504.
 */
export function mapProgramToDream5504(program: number, role?: GM128Role, style?: string): number {
  const value = clampProgram(program);
  if (!role) return value;
  if (role === 'drum') return drumProgramSet.has(value) ? value : styleFallback(role, style);
  // 允许 ACG PIANOSONG 的白名单钢琴在 bass 轨演奏左手低音；音区由器配 register 合同限制在 E1-G3。
  if (role === 'bass') {
    // ACG passes its style entitlement through the MIDI adapter so the full
    // approved piano palette can remain on the left-hand role. Keep the
    // bank-0 acoustic pianos legal for legacy direct-IR callers as well.
    const pianoLeftHand = isAcousticPianoProgram(value)
      || (normStyle(style) === 'acg' && isAcgPianoSongPianoProgram(value));
    // Contrabass is the bowed member of the active acoustic string family.
    // It is admitted only as an explicit orchestration choice, never as a
    // fallback for an arbitrary malformed bass program.
    return pianoLeftHand || value === 43 || (value >= 32 && value <= 39) ? value : styleFallback(role, style);
  }
  // Sustained acoustic string sections are valid pad-role voices too. This is
  // required by the acoustic-debug palette and remains a safe GM capability
  // for any future explicit orchestration profile.
  if (role === 'pad') return value === 44 || (value >= 16 && value <= 23) || (value >= 48 && value <= 55) || (value >= 88 && value <= 95)
    ? value
    : styleFallback(role, style);
  if (role === 'comp') return value >= 0 && value <= 31 ? value : styleFallback(role, style);
  return value;
}

export function mapRoleProgramsToDream5504<T extends Partial<Record<GM128Role, number>>>(programs: T, style?: string): T {
  let changed = false;
  const mapped: Partial<Record<GM128Role, number>> = { ...programs };
  for (const role of Object.keys(mapped) as GM128Role[]) {
    const program = mapped[role];
    if (program === undefined) continue;
    const next = mapProgramToDream5504(program, role, style);
    if (next !== program) changed = true;
    mapped[role] = next;
  }
  return (changed ? mapped : programs) as T;
}

export function gmbkVoiceLabel(voice: GM128VoiceSelection): string {
  const bank = voice.bank === undefined ? 'drum' : `CC0=${voice.bank}`;
  return `${voice.name}(GM${voice.program},${bank})`;
}
