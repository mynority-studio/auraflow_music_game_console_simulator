// ============================================================
// newEngine · knowledge · Instruments(编制 + 乐器选配)
// ------------------------------------------------------------
// BandEngine 的"乐器"要素:按 style + seed 决定
//   ① 编制 lineup(可变 2–5 件;lead 必有 + ≥1 和声承载 comp/pad/bass);
//   ② 每个角色的具体乐器(GM program)。
// 纯数据 + 确定性挑选(rng)。renderSongFull 只渲 lineup 内的轨;irToMidi 读 program 发声。
// ============================================================

import type { Rng } from '../foundation';
import type { InstrumentRoleName } from '../band/BandSpec';

interface LineupRule {
  always: InstrumentRoleName[];                          // 必有(含 lead + 和声承载)
  optional: { role: InstrumentRoleName; prob: number }[]; // 按概率随 seed 加入
}

// 各 style 编制规则:always 保证 ≥2 件且含 lead + 和声;optional 让编制大小可变。
const LINEUP_RULES: Record<string, LineupRule> = {
  jazz: { always: ['lead', 'bass', 'comp'], optional: [{ role: 'drum', prob: 0.85 }, { role: 'pad', prob: 0.15 }] },
  pop: { always: ['lead', 'bass', 'comp'], optional: [{ role: 'drum', prob: 0.9 }, { role: 'pad', prob: 0.6 }] },
  // LOFI rich textures in MG all declare bass:required; keeping bass optional can
  // drop the sustaining anchor and make one-shot/chop bars feel like playback stalls.
  lofi: { always: ['lead', 'bass', 'comp'], optional: [{ role: 'pad', prob: 0.85 }, { role: 'drum', prob: 0.6 }] },
  rnb: { always: ['lead', 'bass', 'comp'], optional: [{ role: 'drum', prob: 0.8 }, { role: 'pad', prob: 0.55 }] }, // neo-soul:Rhodes comp + pocket 鼓
  modal: { always: ['lead', 'pad'], optional: [{ role: 'bass', prob: 0.6 }, { role: 'comp', prob: 0.5 }, { role: 'drum', prob: 0.35 }] },
  default: { always: ['lead', 'comp', 'bass'], optional: [{ role: 'drum', prob: 0.7 }, { role: 'pad', prob: 0.5 }] },
};

// 各 style 各角色的乐器候选(GM program);随 seed 选一。
// ★ lead 改为【钢琴 + 舒缓键盘 + 马林巴/颤音琴】路线(删长笛/小号/萨克斯/合成 lead 等高频刺耳)。
//   comp 本就是舒缓键盘(钢琴/Rhodes/FM),bass/pad 非高频 → 保留。
const INSTRUMENTS: Record<string, Partial<Record<InstrumentRoleName, number[]>>> = {
  jazz: { lead: [11, 4, 12], comp: [0, 4], bass: [32], pad: [49], drum: [0] },       // 颤音琴/Rhodes/马林巴 · 钢琴/Rhodes · 立式贝斯 · 弦乐
  pop: { lead: [1, 4, 12], comp: [1, 4], bass: [38, 33], pad: [89, 50], drum: [0] }, // 亮钢琴/Rhodes/马林巴 · 亮钢琴/Rhodes · 合成/指弹贝斯 · 暖/合成弦 pad
  lofi: { lead: [4, 11, 12], comp: [4, 5], bass: [33, 39], pad: [89, 91], drum: [0] }, // Rhodes/颤音琴/马林巴 · Rhodes/FM EP · 软贝斯 · 暖/合唱 pad
  rnb: { lead: [4, 5, 11], comp: [4, 5], bass: [33, 39], pad: [89, 91], drum: [0] }, // Rhodes/FM EP/颤音琴 · Rhodes/FM EP · 指弹/合成贝斯 · 暖/合唱 pad
  modal: { lead: [12, 11, 8], comp: [4, 0], bass: [32, 33], pad: [89, 48, 91], drum: [0] }, // 马林巴/颤音琴/Celesta · Rhodes/钢琴 · 立式 · 暖/弦/合唱 pad
  default: { lead: [0, 4, 12], comp: [0, 4], bass: [33], pad: [89], drum: [0] },     // 大钢琴/Rhodes/马林巴
};

const FALLBACK_PROGRAM: Record<InstrumentRoleName, number> = { bass: 33, comp: 0, lead: 0, pad: 89, drum: 0 };
const ROLE_ORDER: InstrumentRoleName[] = ['bass', 'comp', 'pad', 'lead', 'drum'];

export interface BandInstrumentation {
  lineup: InstrumentRoleName[];                       // 实际编制(2–5,规范顺序)
  roleProgram: Record<InstrumentRoleName, number>;    // 每件乐器的 GM program(仅 lineup 内)
}

// —— 乐器类型 + 真实音域(MIDI)——
//   ★ comp 色彩决策按此分流:keyboard 族(钢琴/电钢/Celesta)可 voice 宽和弦色彩(9/13);
//     非键盘 / 超出该乐器音域的色彩 → 交给旋律承载(见 accompanimentRenderer)。
export type InstrumentFamily = 'keyboard' | 'mallet' | 'bass' | 'pad' | 'wind' | 'percussion' | 'other';
export interface InstrumentInfo { family: InstrumentFamily; range: readonly [number, number]; }

const INSTRUMENT_INFO: Record<number, InstrumentInfo> = {
  0: { family: 'keyboard', range: [21, 108] }, 1: { family: 'keyboard', range: [21, 108] }, 2: { family: 'keyboard', range: [21, 108] },
  4: { family: 'keyboard', range: [28, 103] }, 5: { family: 'keyboard', range: [28, 103] }, // Rhodes / FM-EP
  8: { family: 'keyboard', range: [60, 108] }, // Celesta(高音区键盘)
  11: { family: 'mallet', range: [53, 89] },   // 颤音琴
  12: { family: 'mallet', range: [45, 96] },   // 马林巴
  32: { family: 'bass', range: [28, 67] }, 33: { family: 'bass', range: [28, 67] },
  38: { family: 'bass', range: [24, 60] }, 39: { family: 'bass', range: [24, 60] },
  48: { family: 'pad', range: [40, 100] }, 49: { family: 'pad', range: [40, 100] }, 50: { family: 'pad', range: [36, 100] },
  89: { family: 'pad', range: [36, 96] }, 91: { family: 'pad', range: [36, 96] },
};
const DEFAULT_INFO: InstrumentInfo = { family: 'other', range: [36, 96] };

/** GM program → 类型 + 音域(未知回退 other/[36,96])。 */
export function instrumentInfo(program: number): InstrumentInfo {
  return INSTRUMENT_INFO[program] ?? DEFAULT_INFO;
}
/** 是否键盘族(钢琴/电钢/Celesta)→ comp 可 voice 宽和弦色彩。 */
export function isKeyboardFamily(program: number | undefined): boolean {
  return program !== undefined && instrumentInfo(program).family === 'keyboard';
}

/** 同族备选音色(供器配层 per-段落切音色):池里与 primary【同族】且 ≠primary 的 program。
 *  同族 = 同一个乐手换声音(键盘 Rhodes↔钢琴 / 效果器开关),非换乐手 → 不影响 voicing 分流。 */
export function sameFamilyAlternates(style: string, role: InstrumentRoleName, primary: number): number[] {
  const inst = INSTRUMENTS[style] ?? INSTRUMENTS.default;
  const pool = inst[role] ?? [];
  const fam = instrumentInfo(primary).family;
  return pool.filter((p) => p !== primary && instrumentInfo(p).family === fam);
}

// —— view-only:GM program → 名(仅覆盖本编制用到的;展示用,不参与生成)——
const GM_NAME: Record<number, string> = {
  0: '大钢琴', 1: '亮钢琴', 4: '电钢 Rhodes', 5: '电钢 FM', 8: 'Celesta', 11: '颤音琴', 12: '马林巴',
  32: '立式贝斯', 33: '指弹贝斯', 38: '合成贝斯1', 39: '合成贝斯2',
  48: '弦乐合奏1', 49: '弦乐合奏2', 50: '合成弦乐1',
  89: '暖 Pad', 91: '合唱 Pad',
};
/** GM program → 中文名(未知回退 "GM n")。 */
export function gmName(program: number): string {
  return GM_NAME[program] ?? `GM ${program}`;
}

export interface InstrumentCatalogStyle {
  style: string;
  always: InstrumentRoleName[];
  optional: { role: InstrumentRoleName; prob: number }[];
  roles: { role: InstrumentRoleName; programs: number[] }[];
}
/** view-only:导出编制目录(每 style 的编制规则 + 每角色候选乐器)。不参与生成,供 UI 展示。 */
export function getInstrumentCatalog(): InstrumentCatalogStyle[] {
  return Object.keys(LINEUP_RULES).map((style) => {
    const rule = LINEUP_RULES[style];
    const inst = INSTRUMENTS[style] ?? {};
    return {
      style,
      always: rule.always,
      optional: rule.optional,
      roles: ROLE_ORDER.filter((r) => inst[r] && inst[r]!.length > 0).map((r) => ({ role: r, programs: inst[r]! })),
    };
  });
}

// ============================================================
// ★ 音色世界(TimbreWorld)统一性(CODEX instrumentation_combination_rules 吸纳;只在器配层消费)
//   器配层据此【理解音色世界】+ 主动防风格错配。当前 per-style INSTRUMENTS 池已隐式守住 hard-reject,
//   此处把概念显式化:① 分类世界(可观测)② worldMismatches/repair 主动 guard(dormant 但 live,扩库即生效)
//   ③ sameInstrumentPairs 同乐器对(记录不拒绝,钢琴可同时 lead/comp)。纯函数、确定性。
// ============================================================
export type TimbreWorld =
  | 'acousticPianoBand' | 'brightPopHybrid' | 'electricKeys'
  | 'lofiTapeKeys' | 'jazzCombo' | 'modalAmbient' | 'syntheticSoft';

export type TimbreSource = 'acoustic' | 'electric' | 'synth';
const TIMBRE_SOURCE: Record<number, TimbreSource> = {
  0: 'acoustic', 1: 'acoustic', 8: 'acoustic', 11: 'acoustic', 12: 'acoustic', 32: 'acoustic', 48: 'acoustic', 49: 'acoustic',
  4: 'electric', 5: 'electric', 33: 'electric',
  38: 'synth', 39: 'synth', 50: 'synth', 89: 'synth', 91: 'synth',
};
/** GM program → 音色来源(acoustic/electric/synth;未知回退 synth)。 */
export function timbreSource(program: number): TimbreSource {
  return TIMBRE_SOURCE[program] ?? 'synth';
}

type RoleProgramView = Partial<Record<InstrumentRoleName, number>>;

/** 据选定 roleProgram + style 分类音色世界(确定性,可观测)。 */
export function classifyTimbreWorld(rp: RoleProgramView, style: string): TimbreWorld {
  const cs = rp.comp !== undefined ? timbreSource(rp.comp) : 'electric';
  const bs = rp.bass !== undefined ? timbreSource(rp.bass) : 'electric';
  switch (style) {
    case 'jazz': return 'jazzCombo';
    case 'modal': return bs === 'synth' ? 'syntheticSoft' : 'modalAmbient';
    case 'rnb': return bs === 'synth' ? 'syntheticSoft' : 'electricKeys';
    case 'lofi': return 'lofiTapeKeys';
    case 'pop':
    default:
      if (cs === 'acoustic' && bs === 'acoustic') return 'acousticPianoBand';
      if (cs === 'acoustic') return 'brightPopHybrid';  // acoustic comp + electric/synth 节奏组
      return bs === 'synth' ? 'syntheticSoft' : 'brightPopHybrid';
  }
}

/** 风格错配检测(hard-reject;当前池已守住 → 多返回空,作主动 guard / 回归网)。 */
export function worldMismatches(rp: RoleProgramView, style: string): string[] {
  const out: string[] = [];
  if (style === 'jazz' && rp.bass !== undefined && [38, 39].includes(rp.bass)) out.push('jazz≠synth-bass');
  if (style === 'lofi' && rp.comp === 1) out.push('lofi≠bright-piano-comp');
  if (style === 'jazz' && rp.pad !== undefined && [89, 91].includes(rp.pad)) out.push('jazz≠choir/warm-pad');
  return out;
}

/** 修复风格错配:从同 style 池换一个【不错配】候选(确定性,无 rng);无错配 → 原对象返回。 */
export function repairWorldMismatches(rp: Record<InstrumentRoleName, number>, style: string): Record<InstrumentRoleName, number> {
  if (worldMismatches(rp, style).length === 0) return rp;
  const pool = INSTRUMENTS[style] ?? INSTRUMENTS.default;
  const out = { ...rp };
  const fix = (role: InstrumentRoleName, bad: (p: number) => boolean, fallback: number) => {
    if (out[role] === undefined || !bad(out[role])) return;
    out[role] = (pool[role] ?? []).find((p) => !bad(p)) ?? fallback;
  };
  if (style === 'jazz') { fix('bass', (p) => [38, 39].includes(p), 32); fix('pad', (p) => [89, 91].includes(p), 49); }
  if (style === 'lofi') fix('comp', (p) => p === 1, 4);
  return out;
}

/** 同乐器对(lead==comp):记录事实,不拒绝(同一乐器可同时承担多角色)。 */
export function sameInstrumentPairs(rp: RoleProgramView): { a: InstrumentRoleName; b: InstrumentRoleName; program: number }[] {
  const out: { a: InstrumentRoleName; b: InstrumentRoleName; program: number }[] = [];
  if (rp.lead !== undefined && rp.lead === rp.comp) out.push({ a: 'lead', b: 'comp', program: rp.lead });
  return out;
}

/** 按 style + rng 选编制 + 乐器。确定性(同 seed 同结果);lineup 含 lead + ≥1 和声,最少 2 件。 */
export function pickBandInstrumentation(style: string, rng: Rng): BandInstrumentation {
  const rule = LINEUP_RULES[style] ?? LINEUP_RULES.default;
  const chosen = new Set<InstrumentRoleName>(rule.always);
  for (const o of rule.optional) if (rng.next() < o.prob) chosen.add(o.role);
  const lineup = ROLE_ORDER.filter((r) => chosen.has(r)); // 规范顺序

  const inst = INSTRUMENTS[style] ?? INSTRUMENTS.default;
  const roleProgram = {} as Record<InstrumentRoleName, number>;
  for (const r of lineup) {
    const cands = inst[r] ?? [FALLBACK_PROGRAM[r]];
    roleProgram[r] = rng.pick(cands);
  }
  return { lineup, roleProgram };
}
