export type Aura25Role = 'bass' | 'comp' | 'pad' | 'lead' | 'drum';

export const AURA25_SF2_URL = '/Aura25_GM128.sf2?v=20260714-v47-direct-balance-allpass';
export const AURA25_SF2_BANK_ID = 'aura25-gu-cp80-chorusedfm';
export const AURA25_SF2_SIZE_LABEL = '1.29MB';
export const AURA25_DRUM_BANK_MSB = 1;
export const AURA25_DRUM_BANK_LSB = 0;
export const AURA25_CHORUSED_FM_EP_BANK = 8;
export const AURA25_CHORUSED_FM_EP_PROGRAM = 5;

export const AURA25_MELODIC_PROGRAMS = [
  0, 5, 24, 25,
  32, 38,
  67, 89, 108,
] as const;

export const AURA25_DRUM_PROGRAMS = [8, 25, 40] as const;

export const AURA25_PROGRAMS_BY_ROLE: Record<Aura25Role, readonly number[]> = {
  lead: [0, 5, 24, 25, 67, 108],
  comp: [0, 5, 24, 25],
  bass: [32, 38],
  pad: [89],
  drum: AURA25_DRUM_PROGRAMS,
};

export const AURA25_AUDITION_INSTRUMENTS = [
  { bank: 0, program: 0, role: 'lead', name: '大钢琴', note: 60, sampleSizeBytes: 197928, sampleSizeLabel: '0.189MB' },
  { bank: 0, program: 5, role: 'comp', name: 'GU Electric Grand', note: 64, sampleSizeBytes: 332568, sampleSizeLabel: '0.317MB' },
  { bank: 8, program: 5, role: 'comp', name: 'GU Chorused FM EP', note: 64, sampleSizeBytes: 231564, sampleSizeLabel: '0.221MB' },
  { bank: 0, program: 24, role: 'comp', name: '尼龙吉他', note: 52, sampleSizeBytes: 17276, sampleSizeLabel: '0.016MB' },
  { bank: 0, program: 25, role: 'comp', name: '民谣木吉他', note: 52, sampleSizeBytes: 17276, sampleSizeLabel: '0.016MB' },
  { bank: 0, program: 32, role: 'bass', name: '原声贝斯', note: 40, sampleSizeBytes: 7106, sampleSizeLabel: '0.007MB' },
  { bank: 0, program: 38, role: 'bass', name: '合成贝斯 1', note: 36, sampleSizeBytes: 10584, sampleSizeLabel: '0.010MB' },
  { bank: 0, program: 67, role: 'lead', name: '上低音萨克斯', note: 50, sampleSizeBytes: 130842, sampleSizeLabel: '0.125MB' },
  { bank: 0, program: 89, role: 'pad', name: '暖 Pad', note: 55, sampleSizeBytes: 38530, sampleSizeLabel: '0.037MB' },
  { bank: 0, program: 108, role: 'lead', name: '卡林巴', note: 72, sampleSizeBytes: 6122, sampleSizeLabel: '0.006MB' },
  { bank: 128, program: 8, role: 'drum', name: 'Room 鼓组', note: 36, sampleSizeBytes: 284048, sampleSizeLabel: '0.271MB' },
  { bank: 128, program: 25, role: 'drum', name: 'TR-808 鼓组', note: 36, sampleSizeBytes: 231830, sampleSizeLabel: '0.221MB' },
  { bank: 128, program: 40, role: 'drum', name: 'Brush 鼓组', note: 38, sampleSizeBytes: 277868, sampleSizeLabel: '0.265MB' },
] as const;

export function aura25PresetName(bank: number, program: number): string | undefined {
  return AURA25_AUDITION_INSTRUMENTS.find((item) => item.bank === bank && item.program === program)?.name;
}

export function aura25InstrumentName(bank: number | undefined, program: number | undefined, role?: Aura25Role): string | undefined {
  if (program === undefined) return undefined;
  if (role === 'drum') return aura25DrumKitName(program);
  return aura25PresetName(bank ?? 0, program);
}

export function aura25DrumKitName(program: number | undefined): string {
  return aura25PresetName(128, program ?? 0) ?? '鼓组';
}

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
  if (role === 'drum') {
    if (s === 'jazz' || s === 'blues') return 40;
    if (s === 'lofi') return 25;
    if (s === 'rnb') return 25;
    if (s === 'modal') return 25;
    if (s === 'acg') return 8;
    if (s === 'pop') return 8;
    return 8;
  }
  if (role === 'bass') return s === 'jazz' || s === 'acg' ? 32 : 38;
  if (role === 'pad') return 89;
  if (role === 'comp') return s === 'rnb' || s === 'lofi' || s === 'pop' ? 5 : 0;
  if (s === 'lofi') return 108;
  if (s === 'modal') return 108;
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
  if (drumSet.has(p)) return p;
  if (p === 0) return 8;
  if (p === 16) return 25;
  if (p === 24) return 25;
  if (p === 32) return 40;
  if (p === 48) return 8;
  if (p >= 24 && p <= 31) return 25;
  if (p >= 16 && p <= 23) return 25;
  if (p >= 8 && p <= 15) return 8;
  if (p >= 32 && p <= 47) return 40;
  if (p >= 48) return 8;
  return styleFallback('drum', style);
}

function mapKeyboardLike(p: number, style?: string): number {
  if (p <= 3) return 0;
  if (p >= 4 && p <= 7) return 5;
  if (p === 11) return 108;
  if (p >= 8 && p <= 15) return 108;
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
  if (key >= 0) return AURA25_PROGRAMS_BY_ROLE.comp.includes(key) ? key : styleFallback('comp', style);
  const guitar = mapGuitarLike(p);
  if (guitar >= 0) return guitar;
  if (p >= 40 && p <= 55) return styleFallback('comp', style);
  if (p >= 80 && p <= 103) return 5;
  if (p >= 104 && p <= 119) return styleFallback('comp', style);
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

export function generatedAura25BankForProgram(style: string | undefined, role: Aura25Role, p: number): number {
  if (role === 'drum') return 128;
  const s = normStyle(style);
  if (role === 'lead' && p === AURA25_CHORUSED_FM_EP_PROGRAM && (s === 'rnb' || s === 'lofi')) {
    return AURA25_CHORUSED_FM_EP_BANK;
  }
  return 0;
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
