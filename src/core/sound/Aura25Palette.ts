export type Aura25Role = 'bass' | 'comp' | 'pad' | 'lead' | 'drum';

export const AURA25_SF2_URL = '/Aura25_GM128.sf2';
export const AURA25_SF2_BANK_ID = 'aura25-gm128';
export const AURA25_SF2_SIZE_LABEL = '1.79MB';

export const AURA25_MELODIC_PROGRAMS = [
  0, 1, 4, 5, 7, 11, 16,
  24, 67,
  32, 33, 34, 38, 39,
  48, 49, 89,
  66, 80, 81, 98, 108,
] as const;

export const AURA25_DRUM_PROGRAMS = [0, 25, 40] as const;

export const AURA25_PROGRAMS_BY_ROLE: Record<Aura25Role, readonly number[]> = {
  lead: [0, 1, 4, 5, 7, 11, 24, 66, 67, 80, 81, 98, 108],
  comp: [0, 1, 4, 5, 7, 11, 24],
  bass: [32, 33, 34, 38, 39],
  pad: [16, 48, 49, 89, 98],
  drum: AURA25_DRUM_PROGRAMS,
};

const melodicSet = new Set<number>(AURA25_MELODIC_PROGRAMS);
const drumSet = new Set<number>(AURA25_DRUM_PROGRAMS);

const normStyle = (style?: string): string => (style ?? '').toLowerCase();
const program = (p: number): number => Math.max(0, Math.min(127, Math.round(p)));

export function isAura25Program(p: number, role?: Aura25Role): boolean {
  const n = program(p);
  if (role === 'drum') return drumSet.has(n);
  if (role) return AURA25_PROGRAMS_BY_ROLE[role].includes(n);
  return melodicSet.has(n) || drumSet.has(n);
}

function styleFallback(role: Aura25Role, style?: string): number {
  const s = normStyle(style);
  if (role === 'drum') return s === 'jazz' ? 40 : s === 'rnb' || s === 'lofi' ? 25 : 0;
  if (role === 'bass') return s === 'jazz' || s === 'acg' ? 32 : s === 'pop' || s === 'modal' ? 38 : 33;
  if (role === 'pad') return s === 'jazz' || s === 'acg' ? 49 : s === 'modal' ? 98 : 89;
  if (role === 'comp') return s === 'rnb' || s === 'lofi' ? 4 : s === 'pop' ? 1 : 0;
  if (s === 'lofi') return 108;
  if (s === 'rnb') return 4;
  if (s === 'jazz' || s === 'pop') return 66;
  if (s === 'acg') return 0;
  return 1;
}

function mapBass(p: number, style?: string): number {
  if (p === 32 || p === 33 || p === 34 || p === 38 || p === 39) return p;
  if (p === 35) return normStyle(style) === 'jazz' || normStyle(style) === 'acg' ? 32 : 33;
  if (p === 36 || p === 37) return normStyle(style) === 'rnb' ? 33 : 34;
  return styleFallback('bass', style);
}

function mapDrum(p: number, style?: string): number {
  if (drumSet.has(p)) return p;
  if (p === 24 || p === 25 || normStyle(style) === 'rnb' || normStyle(style) === 'lofi') return 25;
  if (p === 32 || p === 40 || normStyle(style) === 'jazz') return 40;
  return 0;
}

function mapKeyboardLike(p: number): number {
  if (p <= 1) return p;
  if (p === 2 || p === 3) return 4;
  if (p === 4 || p === 5 || p === 7 || p === 11) return p;
  if (p === 6) return 7;
  if (p >= 8 && p <= 15) return p === 12 || p === 13 ? 108 : 11;
  return -1;
}

function mapGuitarLike(p: number): number {
  if (p === 24 || p === 25) return 24;
  if (p >= 26 && p <= 31) return 24;
  return -1;
}

function mapPadLike(p: number, style?: string): number {
  if (p === 16 || p === 48 || p === 49 || p === 89 || p === 98) return p;
  if (p >= 16 && p <= 23) return 16;
  if (p >= 40 && p <= 55) return p === 48 || p === 50 ? 48 : 49;
  if (p >= 88 && p <= 95) return 89;
  if (p >= 96 && p <= 103) return 98;
  if (p === 107 || p === 108) return normStyle(style) === 'modal' ? 98 : 108;
  return styleFallback('pad', style);
}

function mapLeadLike(p: number, style?: string): number {
  if (AURA25_PROGRAMS_BY_ROLE.lead.includes(p)) return p;
  const key = mapKeyboardLike(p);
  if (key >= 0) return key;
  const guitar = mapGuitarLike(p);
  if (guitar >= 0) return guitar;
  if (p >= 32 && p <= 39) return normStyle(style) === 'rnb' ? 4 : 0;
  if (p >= 64 && p <= 79) return 66;
  if (p >= 40 && p <= 63) return styleFallback('lead', style);
  if (p >= 80 && p <= 87) return p === 80 ? 80 : 81;
  if (p >= 88 && p <= 103) return 98;
  if (p >= 104 && p <= 119) return 108;
  return styleFallback('lead', style);
}

function mapCompLike(p: number, style?: string): number {
  if (AURA25_PROGRAMS_BY_ROLE.comp.includes(p)) return p;
  const key = mapKeyboardLike(p);
  if (key >= 0) return key;
  const guitar = mapGuitarLike(p);
  if (guitar >= 0) return guitar;
  if (p >= 40 && p <= 55) return styleFallback('comp', style);
  if (p >= 80 && p <= 103) return normStyle(style) === 'lofi' || normStyle(style) === 'rnb' ? 4 : 1;
  if (p >= 104 && p <= 119) return 11;
  return styleFallback('comp', style);
}

export function mapProgramToAura25(p: number, role?: Aura25Role, style?: string): number {
  const n = program(p);
  if (role && isAura25Program(n, role)) return n;
  if (!role && isAura25Program(n)) return n;
  switch (role) {
    case 'drum': return mapDrum(n, style);
    case 'bass': return mapBass(n, style);
    case 'pad': return mapPadLike(n, style);
    case 'comp': return mapCompLike(n, style);
    case 'lead': return mapLeadLike(n, style);
    default:
      if (n >= 32 && n <= 39) return mapBass(n, style);
      if (n >= 88 && n <= 103) return mapPadLike(n, style);
      return mapLeadLike(n, style);
  }
}

export function mapMidiProgramToAura25(p: number, channel: number, style?: string): number {
  const role =
    channel === 9 ? 'drum'
      : channel === 3 ? 'bass'
        : channel === 2 ? 'comp'
          : channel === 4 ? 'pad'
            : channel === 1 ? 'lead'
              : undefined;
  return mapProgramToAura25(p, role, style);
}

export function mapRoleProgramsToAura25<T extends Partial<Record<Aura25Role, number>>>(programs: T, style?: string): T {
  let changed = false;
  const out: Partial<Record<Aura25Role, number>> = { ...programs };
  for (const role of Object.keys(out) as Aura25Role[]) {
    const current = out[role];
    if (current === undefined) continue;
    const mapped = mapProgramToAura25(current, role, style);
    if (mapped !== current) changed = true;
    out[role] = mapped;
  }
  return (changed ? out : programs) as T;
}
