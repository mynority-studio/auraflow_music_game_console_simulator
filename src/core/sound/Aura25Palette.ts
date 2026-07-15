// ============================================================
// Dream GMBK5X128 / GM128 target palette
// ------------------------------------------------------------
// 5504 方案不再把音乐收口到浏览器小 SF2 的少量 preset。Program
// 保持 GM128 语义；GMBK5X128 的 variation 使用 CC0(Bank Select MSB)
// 选择，鼓组在 ch10 只用 Program Change，不发 bank。
//
// 文件名和 Aura25* 导出名暂保留为兼容层，避免大面积迁移破坏旧调用点。
// ============================================================

import {
  GM128_FULL_AUDITION_INSTRUMENTS,
  type GM128Role,
} from './GMBK5X128Catalog';
import { ACG_PIANOSONG_PIANO_PROGRAMS, dream5504VoiceName } from './GMBK5X128Voices';

export type { GM128Role } from './GMBK5X128Catalog';
export type Aura25Role = GM128Role;

export const GM128_TARGET_ID = 'dream-gmbk5x128';
export const GM128_LABEL = 'Dream GMBK5X128 GM128';
export const GM128_HINT = 'Dream5504/SAM5000 CleanWave GM128：Program 0-127，variation 用 CC0，鼓组 ch10 只发 Program Change';

export const GM128_CITYPOP_FM_EP_BANK = 16;
export const GM128_HARD_FM_EP_BANK = 24;
export const GM128_SOFT_EP_BANK = 8;
export const GM128_CHORUS_GUITAR_BANK = 8;
export const GM128_BREATHY_TENOR_BANK = 8;
export const GM128_FM_EP_PROGRAM = 5;
export const GM128_TENOR_SAX_PROGRAM = 66;

export const GM128_MELODIC_PROGRAMS = Array.from({ length: 128 }, (_, i) => i) as readonly number[];
export const GM128_DRUM_PROGRAMS = [0, 8, 16, 24, 25, 32, 40, 48, 56, 127] as const;

export const GM128_PROGRAMS_BY_ROLE: Record<GM128Role, readonly number[]> = {
  lead: [0, 1, 2, 4, 5, 11, 12, 24, 25, 27, 64, 65, 66, 67, 75, 77, 107, 108],
  comp: [0, 1, 2, 4, 5, 11, 12, 24, 25, 27],
  // ACG PIANOSONG 白名单钢琴可作为左手 bass；其余仍是正式 bass 世界。
  bass: [...ACG_PIANOSONG_PIANO_PROGRAMS, 32, 33, 34, 35, 36, 37, 38, 39],
  pad: [48, 49, 50, 88, 89, 90, 91, 92, 93, 94, 95],
  drum: GM128_DRUM_PROGRAMS,
};

/**
 * Compatibility export for old Aura25 callers. This is intentionally the
 * complete official GMBK5X128 table, parsed from Dream's TSV, rather than a
 * separately maintained localized subset.
 */
export const GM128_AUDITION_INSTRUMENTS = GM128_FULL_AUDITION_INSTRUMENTS;

export function gm128PresetName(bank: number, program: number, role?: GM128Role): string | undefined {
  return dream5504VoiceName(bank, program, role ?? 'lead');
}

export function gm128DrumKitName(program: number | undefined): string {
  const p = programNumber(program ?? 0);
  return dream5504VoiceName(undefined, p, 'drum') ?? `Dream5504 Drum PC${p}`;
}

export function gm128InstrumentName(bank: number | undefined, program: number | undefined, role?: GM128Role): string | undefined {
  if (program === undefined) return undefined;
  if (role === 'drum') return gm128DrumKitName(program);
  return dream5504VoiceName(bank, program, role ?? 'lead');
}

const drumSet = new Set<number>(GM128_DRUM_PROGRAMS);
const normStyle = (style?: string): string => (style ?? '').toLowerCase();
const programNumber = (p: number): number => Math.max(0, Math.min(127, Math.round(p)));

export function isGM128Program(p: number, role?: GM128Role): boolean {
  const n = programNumber(p);
  if (role === 'drum') return drumSet.has(n);
  if (role) return GM128_PROGRAMS_BY_ROLE[role].includes(n);
  return n >= 0 && n <= 127;
}

function styleFallback(role: GM128Role, style?: string): number {
  const s = normStyle(style);
  if (role === 'drum') {
    if (s === 'jazz' || s === 'blues') return 40;
    if (s === 'lofi' || s === 'rnb' || s === 'modal') return 25;
    return 8;
  }
  if (role === 'bass') return s === 'jazz' || s === 'acg' ? 32 : 38;
  if (role === 'pad') return 89;
  if (role === 'comp') return s === 'rnb' || s === 'lofi' || s === 'pop' ? 5 : 0;
  if (s === 'jazz' || s === 'blues') return 66;
  if (s === 'lofi' || s === 'modal') return 108;
  if (s === 'rnb') return 5;
  return 0;
}

function mapDrum(p: number, style?: string): number {
  if (drumSet.has(p)) return p;
  if (p >= 24 && p <= 31) return 25;
  if (p >= 16 && p <= 23) return 16;
  if (p >= 32 && p <= 47) return 40;
  if (p >= 48) return 48;
  return styleFallback('drum', style);
}

function roleAllowsProgram(role: GM128Role | undefined, p: number, style?: string): boolean {
  if (!role) return true;
  if (role === 'drum') return drumSet.has(p);
  if (role === 'bass') return p === 0 || (normStyle(style) === 'acg' && ACG_PIANOSONG_PIANO_PROGRAMS.includes(p)) || (p >= 32 && p <= 39);
  if (role === 'pad') return (p >= 48 && p <= 55) || (p >= 88 && p <= 103) || (p >= 16 && p <= 23);
  if (role === 'comp') return (p >= 0 && p <= 15) || (p >= 24 && p <= 31) || p === 107 || p === 108;
  return p >= 0 && p <= 127;
}

export function mapProgramToGM128(p: number, role?: GM128Role, style?: string): number {
  const n = programNumber(p);
  if (role === 'drum') return mapDrum(n, style);
  if (roleAllowsProgram(role, n, style)) return n;
  return styleFallback(role ?? 'lead', style);
}

export function mapMidiProgramToGM128(p: number, channel: number, style?: string): number {
  const role =
    channel === 9 ? 'drum'
      : channel === 3 ? 'bass'
        : channel === 2 ? 'comp'
          : channel === 4 ? 'pad'
            : channel === 1 ? 'lead'
              : undefined;
  return mapProgramToGM128(p, role, style);
}

export function generatedGM128BankForProgram(style: string | undefined, role: GM128Role, p: number): number | undefined {
  if (role === 'drum') return undefined;
  const s = normStyle(style);
  if (p === 5 && (s === 'pop' || s === 'rnb' || s === 'lofi' || s === 'modal')) return GM128_CITYPOP_FM_EP_BANK;
  if (p === 4 && (s === 'pop' || s === 'rnb' || s === 'lofi')) return GM128_SOFT_EP_BANK;
  if (p === 27 && (s === 'pop' || s === 'rnb' || s === 'lofi' || s === 'modal')) return GM128_CHORUS_GUITAR_BANK;
  if (p === 25 && (s === 'pop' || s === 'rnb' || s === 'modal')) return 1;
  if (p === 25 && s === 'lofi') return 9;
  if (p === 24 && (s === 'lofi' || s === 'modal')) return 16;
  if (p === 33 && (s === 'pop' || s === 'rnb' || s === 'lofi')) return 2;
  if (p === 34 && (s === 'pop' || s === 'rnb' || s === 'lofi')) return 1;
  if (p === 38 && s === 'lofi') return 9;
  if (p === 38 && (s === 'pop' || s === 'rnb' || s === 'modal')) return 16;
  if (p === 39 && s === 'lofi') return 17;
  if (p === 39 && (s === 'pop' || s === 'rnb' || s === 'modal')) return 19;
  if (p === 66 && (s === 'jazz' || s === 'blues')) return GM128_BREATHY_TENOR_BANK;
  if (p === 67 && (s === 'jazz' || s === 'blues' || s === 'modal')) return 1;
  if (p === 89 && (s === 'pop' || s === 'rnb' || s === 'lofi' || s === 'modal')) return 3;
  if (p === 107 && (s === 'lofi' || s === 'modal')) return 8;
  if (p === 12 && (s === 'lofi' || s === 'modal')) return 16;
  return 0;
}

export function mapRoleProgramsToGM128<T extends Partial<Record<GM128Role, number>>>(programs: T, style?: string): T {
  let changed = false;
  const out: Partial<Record<GM128Role, number>> = { ...programs };
  for (const role of Object.keys(out) as GM128Role[]) {
    const current = out[role];
    if (current === undefined) continue;
    const mapped = mapProgramToGM128(current, role, style);
    if (mapped !== current) changed = true;
    out[role] = mapped;
  }
  return (changed ? out : programs) as T;
}

// Backward-compatible aliases for old Aura25 imports. They now mean GM128/Dream5504,
// not a local browser-rendered SF2 package.
export const AURA25_DRUM_BANK_MSB = 0;
export const AURA25_DRUM_BANK_LSB = 0;
export const AURA25_CHORUSED_FM_EP_BANK = GM128_CITYPOP_FM_EP_BANK;
export const AURA25_CHORUSED_FM_EP_PROGRAM = GM128_FM_EP_PROGRAM;
export const AURA25_MELODIC_PROGRAMS = GM128_MELODIC_PROGRAMS;
export const AURA25_DRUM_PROGRAMS = GM128_DRUM_PROGRAMS;
export const AURA25_PROGRAMS_BY_ROLE = GM128_PROGRAMS_BY_ROLE;
export const AURA25_AUDITION_INSTRUMENTS = GM128_AUDITION_INSTRUMENTS;
export const aura25PresetName = gm128PresetName;
export const aura25InstrumentName = gm128InstrumentName;
export const aura25DrumKitName = gm128DrumKitName;
export const isAura25Program = isGM128Program;
export const mapProgramToAura25 = mapProgramToGM128;
export const mapMidiProgramToAura25 = mapMidiProgramToGM128;
export const generatedAura25BankForProgram = generatedGM128BankForProgram;
export const mapRoleProgramsToAura25 = mapRoleProgramsToGM128;
