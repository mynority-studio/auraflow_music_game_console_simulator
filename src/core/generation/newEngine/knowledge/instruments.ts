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
  lofi: { always: ['lead', 'comp'], optional: [{ role: 'bass', prob: 0.7 }, { role: 'pad', prob: 0.85 }, { role: 'drum', prob: 0.6 }] },
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
