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
const INSTRUMENTS: Record<string, Partial<Record<InstrumentRoleName, number[]>>> = {
  jazz: { lead: [66, 65, 56, 11], comp: [0, 4], bass: [32], pad: [49], drum: [0] },     // 萨克斯/小号/颤音琴 · 钢琴/Rhodes · 立式贝斯 · 弦乐
  pop: { lead: [80, 73, 65], comp: [1, 4], bass: [38, 33], pad: [89, 50], drum: [0] },   // 合成 lead/长笛/萨克斯 · 亮钢琴/Rhodes · 合成/指弹贝斯 · 暖/合成弦 pad
  lofi: { lead: [11, 73, 4], comp: [4, 5], bass: [33, 39], pad: [89, 91], drum: [0] },    // 颤音琴/长笛/EP · Rhodes/FM EP · 软贝斯 · 暖/合唱 pad
  modal: { lead: [73, 64, 82], comp: [4, 0], bass: [32, 33], pad: [89, 48, 91], drum: [0] }, // 长笛/高音萨克斯/calliope · Rhodes/钢琴 · 立式 · 暖/弦/合唱 pad
  default: { lead: [73, 65], comp: [0, 4], bass: [33], pad: [89], drum: [0] },
};

const FALLBACK_PROGRAM: Record<InstrumentRoleName, number> = { bass: 33, comp: 0, lead: 73, pad: 89, drum: 0 };
const ROLE_ORDER: InstrumentRoleName[] = ['bass', 'comp', 'pad', 'lead', 'drum'];

export interface BandInstrumentation {
  lineup: InstrumentRoleName[];                       // 实际编制(2–5,规范顺序)
  roleProgram: Record<InstrumentRoleName, number>;    // 每件乐器的 GM program(仅 lineup 内)
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
