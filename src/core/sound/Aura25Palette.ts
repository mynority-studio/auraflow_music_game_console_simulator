export type Aura25Role = 'bass' | 'comp' | 'pad' | 'lead' | 'drum';

export const AURA25_SF2_URL = '/Aura25_GM128_generaluser_folkguitar_24k_locked.sf2?v=20260707-guitar-comp-dry-rake';
export const AURA25_SF2_BANK_ID = 'aura25-guitar-comp-dry-rake';
export const AURA25_SF2_SIZE_LABEL = '1.24MB';
export const AURA25_DRUM_BANK_MSB = 1;
export const AURA25_DRUM_BANK_LSB = 0;

export const AURA25_MELODIC_PROGRAMS = [
  0, 5, 11, 24, 25,
  32, 38,
  67, 89, 108,
] as const;

export const AURA25_DRUM_PROGRAMS = [0] as const;

export const AURA25_PROGRAMS_BY_ROLE: Record<Aura25Role, readonly number[]> = {
  lead: [0, 5, 11, 24, 25, 67, 108],
  comp: [0, 5, 11, 24, 25],
  bass: [32, 38],
  pad: [89],
  drum: AURA25_DRUM_PROGRAMS,
};

export const AURA25_AUDITION_INSTRUMENTS = [
  { bank: 0, program: 0, role: 'lead', name: '大钢琴', note: 60, sampleSizeBytes: 197928, sampleSizeLabel: '0.189MB' },
  { bank: 0, program: 5, role: 'comp', name: 'CityPop FM 电钢', note: 64, sampleSizeBytes: 231564, sampleSizeLabel: '0.221MB' },
  { bank: 0, program: 11, role: 'lead', name: '颤音琴', note: 72, sampleSizeBytes: 13470, sampleSizeLabel: '0.013MB' },
  { bank: 0, program: 24, role: 'comp', name: '尼龙吉他', note: 52, sampleSizeBytes: 17276, sampleSizeLabel: '0.016MB' },
  { bank: 0, program: 25, role: 'comp', name: '民谣木吉他', note: 52, sampleSizeBytes: 341680, sampleSizeLabel: '0.326MB' },
  { bank: 0, program: 32, role: 'bass', name: '原声贝斯', note: 40, sampleSizeBytes: 7106, sampleSizeLabel: '0.007MB' },
  { bank: 0, program: 38, role: 'bass', name: '合成贝斯 1', note: 36, sampleSizeBytes: 10584, sampleSizeLabel: '0.010MB' },
  { bank: 0, program: 67, role: 'lead', name: '上低音萨克斯', note: 50, sampleSizeBytes: 130842, sampleSizeLabel: '0.125MB' },
  { bank: 0, program: 89, role: 'pad', name: '暖 Pad', note: 55, sampleSizeBytes: 38530, sampleSizeLabel: '0.037MB' },
  { bank: 0, program: 108, role: 'lead', name: '卡林巴', note: 72, sampleSizeBytes: 6122, sampleSizeLabel: '0.006MB' },
  { bank: 128, program: 0, role: 'drum', name: '标准鼓组', note: 36, sampleSizeBytes: 276608, sampleSizeLabel: '0.264MB' },
] as const;

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
  if (role === 'drum') return 0;
  if (role === 'bass') return s === 'jazz' || s === 'acg' ? 32 : 38;
  if (role === 'pad') return 89;
  if (role === 'comp') return s === 'rnb' || s === 'lofi' || s === 'pop' ? 5 : 0;
  if (s === 'lofi') return 108;
  if (s === 'modal') return 11;
  if (s === 'rnb') return 5;
  if (s === 'jazz' || s === 'blues') return 67;
  if (s === 'pop') return 0;
  if (s === 'acg') return 0;
  return 0;
}

function mapBass(p: number, style?: string): number {
  if (p === 32 || p === 38) return p;
  if (p >= 32 && p <= 37) return normStyle(style) === 'jazz' || normStyle(style) === 'acg' ? 32 : 38;
  if (p === 39) return 38;
  return styleFallback('bass', style);
}

function mapDrum(p: number, style?: string): number {
  void p;
  void style;
  return 0;
}

function mapKeyboardLike(p: number, style?: string): number {
  if (p <= 3) return 0;
  if (p >= 4 && p <= 7) return 5;
  if (p === 11) return 11;
  if (p >= 8 && p <= 15) return p === 12 || p === 13 || normStyle(style) === 'lofi' ? 108 : 11;
  return -1;
}

function mapGuitarLike(p: number): number {
  if (p === 25) return 25;
  if (p === 24 || p === 26) return 24;
  if (p >= 27 && p <= 31) return 25;
  return -1;
}

function mapPadLike(p: number, style?: string): number {
  void style;
  if (p === 89) return p;
  if (p >= 16 && p <= 23) return 89;
  if (p >= 40 && p <= 55) return 89;
  if (p >= 88 && p <= 95) return 89;
  if (p >= 96 && p <= 103) return 89;
  if (p === 107 || p === 108) return 89;
  return styleFallback('pad', style);
}

function mapLeadLike(p: number, style?: string): number {
  if (AURA25_PROGRAMS_BY_ROLE.lead.includes(p)) return p;
  const key = mapKeyboardLike(p, style);
  if (key >= 0) return key;
  const guitar = mapGuitarLike(p);
  if (guitar >= 0) return guitar;
  if (p >= 32 && p <= 39) return normStyle(style) === 'rnb' ? 5 : 0;
  if (p >= 64 && p <= 79) return normStyle(style) === 'jazz' || normStyle(style) === 'blues' ? 67 : styleFallback('lead', style);
  if (p >= 40 && p <= 63) return styleFallback('lead', style);
  if (p >= 80 && p <= 87) return 5;
  if (p >= 88 && p <= 103) return 108;
  if (p >= 104 && p <= 119) return 108;
  return styleFallback('lead', style);
}

function mapCompLike(p: number, style?: string): number {
  if (AURA25_PROGRAMS_BY_ROLE.comp.includes(p)) return p;
  const key = mapKeyboardLike(p, style);
  if (key >= 0) return key;
  const guitar = mapGuitarLike(p);
  if (guitar >= 0) return guitar;
  if (p >= 40 && p <= 55) return styleFallback('comp', style);
  if (p >= 80 && p <= 103) return 5;
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
