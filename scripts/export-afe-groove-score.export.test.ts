// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-groove-score — planGrooveScore raw golden exporter（P2-4c 步3；方案 A 独立）
// ------------------------------------------------------------
// 步4/5 的 C 主体 `afe_plan_groove_score`（v5 净新写）需要一个**先于实现**冻结的逐位对账靶：
// 本 exporter 手构造 fixtures，直调**生产** planGrooveScore（零触碰 src/），把 (输入, 期望 plan)
// 成对投影成 core/tests/golden/afe_groove_score_golden.json，由 core 侧转换器
// gen_groove_score_golden.py 生成 C golden .h（对锁 G1 afe_groove.h 的 flat-pool ABI）。
//
// 覆盖设计（拆步3 蓝图；boundary 生产路径见 grooveScorePlanner.ts:331-502）：
//   opening[pickupFill] / internal cadence / repeat-group suppression / strict（禁 boundary+cadence）
//   / setup 禁（profile.allowSetupPickup=false）/ climax fallback（末 chorus）·显式空 climaxMap
//   / 5-4 take-five role cells（bass+comp timed-cells + lead grammar-marker）/ 空 boundaries 池
//   / 三个**可达** boundary kind（pickup·fill·dropout）/ 全 11 functionTag / climax 回退取末 chorus
//   / **.06·.07 阈值的 binary64 刀锋**（整数 permille 判定会给出相反结果，见 ENERGY_EDGE fixture）。
//   **'break' 无生产路径 → 不伪造**（boundaryKind 只产 dropout/pickup/fill）。
//
// ★ 冻结的 emission 序合同（C 步4/5 必须逐条遵守，否则 flat-pool 逐位对账失败）：
//   sections[]        = 输入 sections 声明序
//   bars[]            = 段序 × 段内 barInSection 序（section.bars_off/bars_n 指向本池连续切片）
//   boundaries[]      = planGrooveScore 末尾 sort(sourceBar, opening) 之后的序；**须稳定排序**
//                       （TS Array#sort 自 ES2019 稳定）：同 sourceBar 且同 opening 时保持插入序
//                       = 段界（段序）→ opening（unshift 到首）→ internal cadence（段序 × 段内序）
//   fill_hits[]       = **排序后** boundaries 序 × hit 序
//   rhythm_cells[]    = 段序 × role 序(bass,comp,lead) × cell 序（lead=grammar-marker 无 cell）
//   voice_durations[] = rhythm_cells 序 × 元素序
//
// 数值制度（afe_groove.h 头注 + 设计门分叉5）：round-half-up = JS Math.round（tie→+∞）；
//   [0,1]→afe_permille_t；accent 倍率→afe_milli_ratio_t；beat 域→afe_groove_rational_t（约分/den>0）。
//   本 exporter 另导出**被量化前的 binary64 位型**（*RawBits，十六进制串）供转换器做 tie-margin
//   自检——量化落在 .5 刀锋上会让 C 侧 parity 变脆（步2 round-half-up 教训的前置防御）。
// provenance：静态字段（无动态 HEAD/dirty）；tooling pin 由 G6 机器锁负责。
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-groove-score.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as ts from 'typescript';

import {
  GROOVE_CONTRACT_POOL,
  grooveContractById,
  grooveRhythmProfileForContract,
  type GrooveContract,
} from '../src/core/generation/newEngine/knowledge/grooveContracts';
import { JAZZ_WALKING_BASS_PATTERN_ID } from '../src/core/generation/newEngine/knowledge/grooveBassPatterns';
import {
  BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID,
  COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID,
  LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID,
  ROLE_RHYTHM_PATTERN_IDS,
  type RoleRhythmPatternReferenceByRole,
} from '../src/core/generation/newEngine/knowledge/roleRhythmPatterns';
import { planGrooveScore, type GrooveScoreOptions } from '../src/core/generation/newEngine/arranger/grooveScorePlanner';
import type {
  ClimaxPoint,
  OpeningGesturePlan,
  Section,
  SectionEntry,
  SectionId,
} from '../src/core/generation/newEngine/arranger/ArrangementPlan';

const SCHEMA_VERSION = 'groove_score_golden_v1';
const ENGINE_BASE_COMMIT = 'fb33e9eaa74cee6a1c882b3d710391e969e0462e'; // Newengine_Demo-v5.0 规格锚（非工装 pin）
const SPEC_ANCHOR = 'Newengine_Demo-v5.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const EXPORTER_REL = 'scripts/export-afe-groove-score.export.test.ts';
const OUT_DIR = join(HERE, '..', '..', 'core', 'tests', 'golden');
const OUT = join(OUT_DIR, 'afe_groove_score_golden.json');

// ---- G1 ABI 容量上界（afe_groove.h:57-63；导出侧先行 fail-closed，勿等 C 侧溢出）----
const CAP = {
  sections: 8, barsPerSection: 48, bars: 384, boundaries: 96,
  fillHits: 768, rhythmCells: 96, voiceDurations: 256,
  beatsPerBar: 5, subdivAccent: 4,
} as const;

// ============================================================
// enum 局部序（1:1 afe_groove.h / afe_p2org 冻结值；转换器与 C 头对锁）
// ============================================================
const CONTRACT_ID_IDX: Record<string, number> = {
  jazz_combo_swing: 0, jazz_take_five_5_4: 1, pop_radio_straight: 2, pop_citypop_boogie: 3,
  pop_jpop_push_8ths: 4, pop_ballad_halftime: 5, lofi_lazy_dilla: 6, lofi_tape_late_chords: 7,
  lofi_halftime_dusty: 8, rnb_neo_soul_laidback: 9, rnb_dilla_pocket: 10, rnb_gospel_triplet: 11,
  rnb_motown_backbeat: 12, rnb_trap_soul_halftime: 13, jazz_smooth_backbeat: 14, jazz_medium_swing: 15,
  jazz_ballad_loose: 16, jazz_bossa_straight_latin: 17, acg_hisaishi_rubato_arp: 18,
  acg_planing_wash: 19, acg_jpop_456_drive: 20,
};
// P2-0a 冻结空间（gen_p2org_{a,b}.py）
const SECTION_ROLE_IDX: Record<string, number> = { intro: 0, verse: 1, chorus: 2, bridge: 3, outro: 4 };
const FUNCTION_TAG_IDX: Record<string, number> = {
  setup: 0, story: 1, build: 2, hook: 3, breakdown: 4, loop: 5,
  head: 6, solo: 7, headOut: 8, tag: 9, outro: 10,
};
const FUNCTION_TAG_ABSENT = 0xFF;
// afe_groove_section_entry_t（0=NONE/1=downbeat/2=lead-in，复用 P2-0a entry_mode）
const ENTRY_IDX: Record<string, number> = { downbeat: 1, 'lead-in': 2 };
const OPENING_MODE_IDX: Record<string, number> = {
  coldDownbeat: 0, pickupFill: 1, textureFadeIn: 2, riffFirst: 3, drumsFirst: 4, rubatoKeys: 5,
};
const OPENING_INTENSITY_IDX: Record<string, number> = { soft: 0, medium: 1, bold: 2 };
const BAR_ROLE_IDX: Record<string, number> = { base: 0, answer: 1, lift: 2, turnaround: 3, breakdown: 4 };
const TRAJ_IDX: Record<string, number> = { settled: 0, rising: 1, arrival: 2, peak: 3, falling: 4 };
const BOUNDARY_KIND_IDX: Record<string, number> = { pickup: 0, fill: 1, break: 2, dropout: 3 };
const BASE_MASK_IDX: Record<string, number> = { keep: 0, 'mask-window': 1, 'replace-bar': 2 };
const LANDING_IDX: Record<string, number> = { none: 0, kick: 1, 'kick-crash': 2, ride: 3, 'kick-ride': 4 };
const KICK_FOLLOW_IDX: Record<string, number> = { pulse: 0, bass: 1 };
const SNARE_FOLLOW_IDX: Record<string, number> = { backbeat: 0, 'lead-accents': 1, comping: 2 };
const SUBDIVISION_IDX: Record<string, number> = { eighth: 0, sixteenth: 1, triplet: 2 };
const FILL_FAMILY_IDX: Record<string, number> = {
  'pop-tom-build': 0, 'pop-snare-pickup': 1, 'motown-tom-bridge': 2, 'rnb-pocket-turn': 3,
  'rnb-gospel-triplet': 4, 'trap-snare-roll': 5, 'lofi-one-shot': 6, 'jazz-triplet-setup': 7,
  'jazz-bossa-cross-stick': 8,
};
const FILL_FN_IDX: Record<string, number> = {
  opening: 0, continuation: 1, setup: 2, lift: 3, climax: 4, release: 5,
};
const FILL_RC_IDX: Record<string, number> = {
  'straight-sixteenth': 0, 'broken-sixteenth': 1, 'syncopated-sixteenth': 2,
};
const FILL_ORCH_IDX: Record<string, number> = {
  snare: 0, 'snare-tom-cascade': 1, 'descending-toms': 2, 'linear-hand-foot': 3,
};
const FILL_VOICE_IDX: Record<string, number> = {
  kick: 0, snare: 1, 'tom-high': 2, 'tom-mid': 3, 'tom-low': 4,
};
const FILL_VOCAB_IDX: Record<string, number> = { 'pop-rock-60-v1': 0 };
const REALIZATION_IDX: Record<string, number> = { 'timed-cells': 0, 'grammar-marker': 1 };
const VOICE_ACTION_IDX: Record<string, number> = { foundation: 0, chord: 1 };
// afe_groove_role_rhythm_id_t（= ROLE_RHYTHM_PATTERN_IDS 声明序，拆步1 KB 已冻结）
const ROLE_RHYTHM_ID_IDX: Record<string, number> = Object.fromEntries(
  ROLE_RHYTHM_PATTERN_IDS.map((id, i) => [id, i]));
// afe_groove_bass_pattern_ref_id_t（7 值：0..5 同 contract bass enum，6=jazz-walking pass-through）
const BASS_REF_IDX: Record<string, number> = {
  rnb_neo_soul_sparse: 0, dilla_pocket: 1, rnb_gospel_triplet: 2, rnb_motown_syncopated: 3,
  rnb_trap_soul_halftime: 4, [BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID]: 5,
  [JAZZ_WALKING_BASS_PATTERN_ID]: 6,
};
const ID_NONE = 0xFFFF;   // AFE_ID_NONE

function _lk(map: Record<string, number>, key: string, what: string): number {
  if (!(key in map)) throw new Error(`未知 ${what}: ${key}（fail-closed）`);
  return map[key];
}

// ---- 量化原语（afe_groove.h 数值制度）----
// afe_permille_t([0,1]×1000) 与 afe_milli_ratio_t(ratio×1000，可 >1) 的量化**同式**：
//   ×1000 + round-half-up（JS Math.round，tie→+∞）。C 类型不同但数值行为一致。
//
// ★ tie 普查（步2 round-half-up 教训的前置防御）：x*1000 的小数部分**恰为 0.5** 时，结果完全取决于
//   "half→+∞"这一条约定，C 侧任何等价重排（整数/有理数路径）都必须复现同一方向。这类刀锋值不是
//   假设不存在，而是**逐条登记进 meta.quantizationTies**，让步4/5 实现者与复核者直接看到清单。
interface QuantVal { q: number; rawBits: string; }
interface TieRecord { case: string; path: string; rawBits: string; scaled: string; q: number; }
const TIES: TieRecord[] = [];
let TIE_CASE = '';

const quant = (x: number, path: string): QuantVal => {
  const scaled = x * 1000;
  const q = Math.round(scaled);
  if (scaled >= 0 && scaled - Math.floor(scaled) === 0.5) {
    TIES.push({ case: TIE_CASE, path, rawBits: dbitsHex(x), scaled: dbitsHex(scaled), q });
    if (q !== Math.floor(scaled) + 1) throw new Error(`${path}: tie 未按 half→+∞ 取整（fail-closed）`);
  }
  return { q, rawBits: dbitsHex(x) };
};

/** binary64 位型（十六进制 16 位串；JSON number 无法承载"量化前原值"的可核验位型）。 */
function dbitsHex(x: number): string {
  const buf = Buffer.alloc(8);
  buf.writeDoubleLE(x, 0);
  return buf.readBigUInt64LE(0).toString(16).padStart(16, '0');
}

interface Rational { num: number; den: number; }

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = a % b; a = b; b = t; }
  return a || 1;
}

function reduceRational(num: number, den: number): Rational {
  if (!Number.isInteger(num) || !Number.isInteger(den) || den === 0)
    throw new Error(`非整数/零分母 rational ${num}/${den}`);
  if (den < 0) { num = -num; den = -den; }  // den 恒正，负号仅 num
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

/** beat 域 float → 精确 rational。生产值域恒在 1/4 网格上（durationBeats∈{0.5,1,2}；
 *  fill offsetBeatsFromEnd=(step-8)*0.25）；不在网格上即 fail-closed（不做浮点近似）。 */
function ratFromQuarterGrid(x: number, label: string): Rational {
  const num = x * 4;
  if (!Number.isFinite(num) || !Number.isInteger(num))
    throw new Error(`${label}: ${x} 不在 1/4 beat 网格（fail-closed，禁近似）`);
  const r = reduceRational(num, 4);
  if (r.num / r.den !== x) throw new Error(`${label}: rational ${r.num}/${r.den} ≠ ${x}`);
  return r;
}

/** 递归拒绝非 JSON 值（同 export-afe-groove-kb）。 */
function assertJsonSafe(v: unknown, path: string): void {
  if (v === null) return;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return;
  if (t === 'number') {
    if (!Number.isFinite(v as number)) throw new Error(`非 JSON 数值 at ${path}: ${String(v)}`);
    return;
  }
  if (t === 'function' || t === 'undefined' || t === 'symbol' || t === 'bigint')
    throw new Error(`非 JSON 值(${t}) at ${path}`);
  if (v instanceof Map || v instanceof Set) throw new Error(`Map/Set at ${path}`);
  if (Array.isArray(v)) { v.forEach((x, i) => assertJsonSafe(x, `${path}[${i}]`)); return; }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) assertJsonSafe(x, `${path}.${k}`);
}

// ============================================================
// role-rhythm cell rational（AST 源码字面 + 运行时 float 双校验；同拆步1 制度）
// ------------------------------------------------------------
// plan 的 roleRhythmByRole 是 KB pattern 的深拷贝，cell phase/duration 为 binary64 有损值
// （`61 / 96` 等）。G1 afe_groove_role_rhythm_cell_t 存**约分**分数，故从源码 AST 取字面
// num/den 并断言 == 运行时 float。刻意不复用拆步1 exporter 的实现：那份文件已随 pin
// f2aba9f6/c4e02f91 冻结进 KB 产物链，共享重构会改其 exporterSha 而波及已合入的 KB 数据。
// ============================================================
const ROLE_RHYTHM_SRC = join(
  HERE, '..', 'src', 'core', 'generation', 'newEngine', 'knowledge', 'roleRhythmPatterns.ts');
const EXPECTED_PATTERN_KEY_IDENTS = [
  'BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID',
  'COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID',
  'LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID',
] as const;

function nodeToRational(node: ts.Expression): Rational {
  if (ts.isNumericLiteral(node)) return reduceRational(Number(node.text), 1);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken
      && ts.isNumericLiteral(node.operand)) return reduceRational(-Number(node.operand.text), 1);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.SlashToken
      && ts.isNumericLiteral(node.left) && ts.isNumericLiteral(node.right))
    return reduceRational(Number(node.left.text), Number(node.right.text));
  throw new Error(`role-rhythm 数值字面须 NumericLiteral / a/b / -a（fail-closed）: ${node.getText()}`);
}

function extractRoleRhythmCellLiterals(): Map<string, Array<Record<string, Rational | Rational[]>>> {
  const text = readFileSync(ROLE_RHYTHM_SRC, 'utf-8');
  const sf = ts.createSourceFile('roleRhythmPatterns.ts', text, ts.ScriptTarget.ES2020, true);
  let patternsObj: ts.ObjectLiteralExpression | undefined;
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'PATTERNS' && n.initializer) {
      let init: ts.Expression = n.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) patternsObj = init;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!patternsObj) throw new Error('未找到 PATTERNS ObjectLiteral（fail-closed）');
  if (patternsObj.properties.length !== ROLE_RHYTHM_PATTERN_IDS.length)
    throw new Error(`PATTERNS property 数 ${patternsObj.properties.length} ≠ ${ROLE_RHYTHM_PATTERN_IDS.length}（fail-closed）`);
  const out = new Map<string, Array<Record<string, Rational | Rational[]>>>();
  patternsObj.properties.forEach((prop, idx) => {
    if (!ts.isPropertyAssignment(prop) || !ts.isComputedPropertyName(prop.name)
        || !ts.isObjectLiteralExpression(prop.initializer))
      throw new Error(`PATTERNS[${idx}] 非 computed-key PropertyAssignment/ObjectLiteral value（fail-closed）`);
    const keyExpr = prop.name.expression;
    if (!ts.isIdentifier(keyExpr) || keyExpr.text !== EXPECTED_PATTERN_KEY_IDENTS[idx])
      throw new Error(`PATTERNS[${idx}] computed key ${keyExpr.getText()} ≠ ${EXPECTED_PATTERN_KEY_IDENTS[idx]}（fail-closed）`);
    const patId = ROLE_RHYTHM_PATTERN_IDS[idx];
    const cellsProp = prop.initializer.properties.find(
      (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'cells');
    if (!cellsProp) { out.set(patId, []); return; }  // lead grammar-marker 无 cells
    if (!ts.isPropertyAssignment(cellsProp) || !ts.isArrayLiteralExpression(cellsProp.initializer))
      throw new Error(`${patId}.cells 非 ArrayLiteral（fail-closed）`);
    const cells = cellsProp.initializer.elements.map((el) => {
      if (!ts.isObjectLiteralExpression(el)) throw new Error('role-rhythm cell 非 ObjectLiteral');
      const rec: Record<string, Rational | Rational[]> = {};
      for (const f of el.properties) {
        if (!ts.isPropertyAssignment(f) || !ts.isIdentifier(f.name)) continue;
        const key = f.name.text;
        if (key === 'phaseBeats' || key === 'durationBeats') rec[key] = nodeToRational(f.initializer);
        else if (key === 'voiceDurationBeats' && ts.isArrayLiteralExpression(f.initializer))
          rec[key] = f.initializer.elements.map((x) => nodeToRational(x as ts.Expression));
      }
      return rec;
    });
    out.set(patId, cells);
  });
  return out;
}

function assertRatEqFloat(r: Rational, f: number, label: string): void {
  expect(r.num / r.den, `${label}: rational ${r.num}/${r.den} ≠ 运行时 ${f}`).toBe(f);
}

// ============================================================
// fixtures
// ============================================================
interface Fixture {
  name: string;
  note: string;
  sections: Section[];
  contractId: Record<SectionId, string>;
  energy: Record<SectionId, number>;
  entry: Record<SectionId, SectionEntry>;
  opening: OpeningGesturePlan;
  options?: GrooveScoreOptions & { climaxMap?: readonly ClimaxPoint[] };
}

const opening = (sectionId: string, overrides: Partial<OpeningGesturePlan> = {}): OpeningGesturePlan => ({
  sectionId,
  mode: 'textureFadeIn',
  drumEntry: 'hatsOnly',
  textureEntry: 'pianoRiff',
  roleDelayBars: { drum: 0 },
  pickupBars: 0,
  intensity: 'medium',
  ...overrides,
});

const uniformContract = (sections: readonly Section[], id: string): Record<SectionId, string> =>
  Object.fromEntries(sections.map((s) => [s.id, id]));

const POP_TRIO: Section[] = [
  { id: 'intro', role: 'intro', functionTag: 'setup', bars: 4, hookPolicy: 'none' },
  { id: 'verse', role: 'verse', functionTag: 'story', bars: 8, hookPolicy: 'light' },
  { id: 'chorus', role: 'chorus', functionTag: 'hook', bars: 8, hookPolicy: 'main' },
];
const POP_TRIO_ENERGY = { intro: 0.2, verse: 0.48, chorus: 0.82 };
const POP_TRIO_ENTRY: Record<SectionId, SectionEntry> = {
  intro: 'downbeat', verse: 'downbeat', chorus: 'lead-in',
};

const DRAMATIC: Section[] = [
  { id: 'verse1', role: 'verse', functionTag: 'story', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
  { id: 'chorus1', role: 'chorus', functionTag: 'hook', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
  { id: 'verse2', role: 'verse', functionTag: 'story', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
  { id: 'chorus2', role: 'chorus', functionTag: 'hook', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
  { id: 'outro', role: 'outro', functionTag: 'outro', bars: 4, hookPolicy: 'none' },
];

// 两个 chorus + 不给 climaxMap ⇒ 回退必须取**末个** chorus（planner:514
// `[...sections].reverse().find(role==='chorus')`）。少了这条 fixture，取首个 chorus 的错误实现
// 也能全绿通过 golden——这是对账靶的判别力缺口，故单列。
const TWO_CHORUS: Section[] = [
  { id: 'verseOne', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
  { id: 'chorusEarly', role: 'chorus', functionTag: 'hook', bars: 4, hookPolicy: 'main' },
  { id: 'verseTwo', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
  { id: 'chorusLate', role: 'chorus', functionTag: 'hook', bars: 4, hookPolicy: 'main' },
];

// 同 repeatGroup 的**抑制 / 放行配对**（planner:358-359 `repeated && entry !== 'lead-in'`）：
// verseA→verseB 走 downbeat ⇒ 抑制；verseB→verseC 同组但 entry=lead-in ⇒ **放行**。
// 只有抑制路径的话，"对同组无条件抑制"的错误实现照样全绿（Codex 三轮 F2）。
const REPEATED: Section[] = [
  { id: 'verseA', role: 'verse', functionTag: 'story', bars: 4, repeatGroup: 'V', hookPolicy: 'light' },
  { id: 'verseB', role: 'verse', functionTag: 'story', bars: 4, repeatGroup: 'V', hookPolicy: 'light' },
  { id: 'verseC', role: 'verse', functionTag: 'story', bars: 4, repeatGroup: 'V', hookPolicy: 'light' },
  { id: 'bridge', role: 'bridge', functionTag: 'build', bars: 4, repeatGroup: 'B', hookPolicy: 'light' },
  { id: 'hookEnd', role: 'chorus', functionTag: 'hook', bars: 4, repeatGroup: 'H', hookPolicy: 'main' },
];

const TAKE_FIVE: Section[] = [
  { id: 'intro54', role: 'intro', functionTag: 'setup', bars: 4, hookPolicy: 'none' },
  { id: 'head54', role: 'verse', functionTag: 'head', bars: 8, hookPolicy: 'main' },
  { id: 'solo54', role: 'verse', functionTag: 'solo', bars: 8, hookPolicy: 'light' },
  { id: 'out54', role: 'outro', functionTag: 'headOut', bars: 4, hookPolicy: 'none' },
];

const BALLAD_LONG: Section[] = [
  { id: 'longVerse', role: 'verse', functionTag: 'story', bars: 12, hookPolicy: 'light' },
];

// functionTag 'loop' / 'tag' 的分支闭合：'tag' 同时驱动三条判定——boundaryFunction 的
// `next.functionTag==='tag'` → release、popRockLanding → 'none'、sectionBarRole/allowsInternalCadence
// 把 tag 段压成 breakdown 且禁内部 cadence。'loop' 则是 sectionBarRole 的**穿透**分支（既不塌
// breakdown 也不升 lift）。补齐后本 golden 覆盖全部 11 个合法 functionTag。
// ★ 条件隔离（Codex 二轮 F3）：两段**等能量**（0.55/0.55）⇒ release 与 landing=none 只能由
//   `next.functionTag==='tag'` 规则产生，不会被能量下降通道"顺便"判对；tagOut 给到 **12 bar**
//   （> pop cadence 周期 8）⇒ 若错误实现允许 tag 段内部 cadence，就会多产一条 boundary 而转红。
const LOOP_TAG: Section[] = [
  { id: 'loopBody', role: 'verse', functionTag: 'loop', bars: 12, hookPolicy: 'light' },
  { id: 'tagOut', role: 'outro', functionTag: 'tag', bars: 12, hookPolicy: 'none' },
];

// **.06 / .07 阈值的 binary64 刀锋**（G1 设计门点名的 parity 难点；Codex 步3 首轮 F3 反例）：
//   boundaryFunction / barTrajectory 用 `next < energy - 0.06` 与 `next > energy + 0.07` 判定，
//   而这两个减/加在 binary64 下有表示误差：
//     0.66 - 0.06 = 0.6000000000000001 ⇒ TS: 0.60 < 阈值 = **true**；整数 permille: 600 < 600 = false
//     0.60 + 0.07 = 0.6699999999999999 ⇒ TS: 0.67 > 阈值 = **true**；整数 permille: 670 > 670 = false
//   ⇒ 用整数 permille 重排比较的 C 实现会在这两点上判反（release↔continuation / rising↔settled）。
//   三段全 verse/story 且 entry=downbeat：屏蔽 functionTag 与 pickup 通道，让判定**只**由能量比较决定。
//   仅有"正向触发"还不够：0.66→0.60 与 0.60→0.67 这两点上，整数写成 `<=`/`>=` 的**补偿实现**
//   恰好与 TS 同号。故必须配**反向控制**（TS 判 false 而整数 `<=`/`>=` 判 true）：
//     0.50 - 0.06 = 0.44（精确）        ⇒ TS: 0.44 < 0.44 = false；整数 440 <= 440 = true
//     0.50 + 0.07 = 0.5700000000000001 ⇒ TS: 0.57 > 阈值 = false；整数 570 >= 570 = true
//   （Codex 步3 二轮 F3：条件混叠/缺反向控制 = 第四类判别缺口）
// functionTag **缺省**（→ 0xFF 哨兵）：legacy formPlanner 的模板段就不带 functionTag
// （formPlanner.ts:22 起 TEMPLATES），G1 afe_groove.h:369 也明确允许 0xFF。把它判成 ERR_BAD_FORM
// 的 C 实现在现有 fixture 上全绿 ⇒ 必须有真实缺省样本。缺省时 sectionBarRole 走**穿透**分支
// （既不塌 breakdown 也不升 lift，直接用 phraseShape 的 role）。
const NO_FUNCTION_TAG: Section[] = [
  { id: 'plainIntro', role: 'intro', bars: 4, hookPolicy: 'none' },
  { id: 'plainVerse', role: 'verse', bars: 8, hookPolicy: 'light' },
  { id: 'plainChorus', role: 'chorus', bars: 8, hookPolicy: 'main' },
];

// opening intensity='soft'（→1）：lofi 的 pickupFill 候选就是 soft（openingGesturePlanner.ts:71 起），
// 现有 fixture 只有 bold/medium ⇒ 把 soft 错映射成 medium 的实现不会被抓。
const LOFI_SOFT_OPENING: Section[] = [
  { id: 'softIntro', role: 'intro', functionTag: 'setup', bars: 4, hookPolicy: 'none' },
  { id: 'softVerse', role: 'verse', functionTag: 'story', bars: 8, hookPolicy: 'light' },
];

// **精确相等**的阈值刀锋（步4 变异测试暴露）：步3 的反向控制只排除了"整数 permille 写成 <=/>="
// 的补偿实现，未覆盖 **double 层把 `>` 写成 `>=`** 的实现。permille accept 集上存在 599 组
// `next == energy+0.07` 与 576 组 `next == energy-0.06` 的**精确相等**对（binary64 意义），
// 取音乐上合理的一组：0.35→0.42 令 `>` 假而 `>=` 真；0.35→0.29 令 `<` 假而 `<=` 真。
// 全段 verse/story + entry=downbeat + 无 chorus ⇒ 判定只由能量比较决定。
// **乘法结合序**锁（步4 变异测试暴露）：barEnergy 的 rising 分支是
//   `energy + max(0, next-energy) * progress * 0.75`，binary64 下 `(d*p)*0.75` ≠ `d*(p*0.75)`。
// bars=4 / progress=2/3 / 0.3→0.563 时两者量化后得 431 vs 432 ⇒ 改写结合序即被抓。
// （progress=1 的末小节两者相同，故必须靠中间小节。）
const ASSOC_ORDER: Section[] = [
  { id: 'assocFrom', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
  { id: 'assocTo', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
];

// falling 分支的**代数改写**锁：`energy*(1 - progress*0.1)` 与展开式 `energy - energy*progress*0.1`
// 在 binary64 下不等；bars=4 / progress=1 / energy=0.305 时量化得 275 vs 274。
// 用 outro 段（functionTag='outro' ⇒ 整段 falling，不依赖能量落差通道）隔离该判定。
// **常量精度**锁（步4 变异测试暴露；直指设计文档"新写模块优先 float32"最可能诱发的改写）：
// 若把 `climaxIntensity * 0.05` 的 0.05 写成 float32 常量（提升回 double = 0.05000000074505806），
// energy=0.204 × climaxIntensity=0.37 时量化得 222 vs 223。显式 climaxMap 承载非 1.0 强度即可触达。
const CLIMAX_CONST: Section[] = [
  { id: 'ccLead', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
  { id: 'ccPeak', role: 'chorus', functionTag: 'hook', bars: 4, hookPolicy: 'main' },
];

const FALL_ALGEBRA: Section[] = [
  { id: 'fallBody', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
  { id: 'fallOutro', role: 'outro', functionTag: 'outro', bars: 4, hookPolicy: 'none' },
];

const THRESH_EQ: Section[] = [
  { id: 'eqBase', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
  { id: 'eqUpEq', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
  { id: 'eqMid', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
  { id: 'eqDownEq', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
];

const ENERGY_EDGE: Section[] = [
  { id: 'edgeHi', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
  { id: 'edgeLo', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
  { id: 'edgeUp', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
  { id: 'ctrlFallA', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
  { id: 'ctrlFallB', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
  { id: 'ctrlRiseA', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
  { id: 'ctrlRiseB', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
];

// sparse 合同的 climax fill 强度降级（planner:268 `density==='sparse' && intensity===3 → 2`）：
// pop_ballad_halftime 是唯一同时满足 sparse + fillVocabulary=pop-rock-60-v1 的族，漏掉该降级的
// C 实现会用 baseVelocity 90 而非 78 → fill hit velocity 全体偏高，被冻结的 velocity 抓死。
const BALLAD_CLIMAX: Section[] = [
  { id: 'balladVerse', role: 'verse', functionTag: 'story', bars: 4, hookPolicy: 'light' },
  { id: 'balladHook', role: 'chorus', functionTag: 'hook', bars: 4, hookPolicy: 'main' },
];

// density='active' ⇒ kickResponseLimit base=3，lift/answer 段再 +1（min(4,·)）——现有 fixture 只
// 覆盖 medium/sparse，active 映射写错不会被抓。
const CITYPOP_ACTIVE: Section[] = [
  { id: 'cityStory', role: 'verse', functionTag: 'story', bars: 8, hookPolicy: 'light' },
  { id: 'cityHook', role: 'chorus', functionTag: 'hook', bars: 8, hookPolicy: 'main' },
];

// landing='ride'（jazz_ballad_loose / jazz_bossa 可达）+ comping×sparse 的 responseLimit 组合。
const JAZZ_BALLAD: Section[] = [
  { id: 'jbHead', role: 'verse', functionTag: 'head', bars: 4, hookPolicy: 'main' },
  { id: 'jbSolo', role: 'verse', functionTag: 'solo', bars: 4, hookPolicy: 'light' },
];

const RNB_PAIR: Section[] = [
  { id: 'groove', role: 'verse', functionTag: 'story', bars: 8, hookPolicy: 'light' },
  { id: 'breakdown', role: 'bridge', functionTag: 'breakdown', bars: 4, hookPolicy: 'none' },
  { id: 'lift', role: 'chorus', functionTag: 'hook', bars: 8, hookPolicy: 'main' },
];

const ACG_PAIR: Section[] = [
  { id: 'rubatoA', role: 'intro', functionTag: 'setup', bars: 4, hookPolicy: 'none' },
  { id: 'rubatoB', role: 'verse', functionTag: 'story', bars: 8, hookPolicy: 'light' },
];

const FIXTURES: Fixture[] = [
  {
    name: 'pop_basic_climax_fallback',
    note: 'pop_radio_straight 三段；climaxMap 未给 → 回退末 chorus（has_climax_map=false）；'
      + 'setup→verse=pickup、verse→chorus=climax lift；verse 8 bar 无内部 cadence（cadenceEveryBars=8）。',
    sections: POP_TRIO, contractId: uniformContract(POP_TRIO, 'pop_radio_straight'),
    energy: POP_TRIO_ENERGY, entry: POP_TRIO_ENTRY, opening: opening('intro'),
  },
  {
    name: 'pop_opening_pickup_fill',
    note: 'opening.mode=pickupFill + pickupBars=1 + intensity=bold → opening boundary（sourceBar 0，'
      + 'baseMask=replace-bar，fillFunction=opening，opening=true，排序后置于同 sourceBar 之后）。',
    sections: POP_TRIO, contractId: uniformContract(POP_TRIO, 'pop_radio_straight'),
    energy: POP_TRIO_ENERGY, entry: POP_TRIO_ENTRY,
    opening: opening('intro', { mode: 'pickupFill', drumEntry: 'tomPickup', pickupBars: 1, intensity: 'bold' }),
    options: { fillVariantSeed: 7 },
  },
  {
    name: 'pop_two_chorus_fallback_last',
    note: '两个 chorus 段 + 未给 climaxMap ⇒ 回退高潮必须落在**末个** chorus（chorusLate），'
      + 'chorusEarly 只拿 lift。**chorusEarly 能量(0.86) 高于 chorusLate(0.72)**，故"取首个 chorus"'
      + '与"取能量最高 chorus"两种错误实现都会在此 case 上转红（Codex 二轮 F3：排除条件混叠）。',
    sections: TWO_CHORUS, contractId: uniformContract(TWO_CHORUS, 'pop_radio_straight'),
    energy: { verseOne: 0.5, chorusEarly: 0.86, verseTwo: 0.52, chorusLate: 0.72 },
    entry: { verseOne: 'downbeat', chorusEarly: 'lead-in', verseTwo: 'downbeat', chorusLate: 'lead-in' },
    opening: opening('verseOne'),
    options: { fillVariantSeed: 23 },
  },
  {
    name: 'pop_dramatic_explicit_climax',
    note: '显式 climaxMap=[chorus2] → lift/climax/release 分化 + outro release landing=none；'
      + 'V/C 交替 repeatGroup 不触发抑制；trajectory 覆盖 rising/settled/falling/arrival/peak。',
    sections: DRAMATIC, contractId: uniformContract(DRAMATIC, 'pop_radio_straight'),
    energy: { verse1: 0.52, chorus1: 0.8, verse2: 0.52, chorus2: 0.86, outro: 0.3 },
    entry: { verse1: 'downbeat', chorus1: 'lead-in', verse2: 'downbeat', chorus2: 'lead-in', outro: 'downbeat' },
    opening: opening('verse1'),
    options: { climaxMap: [{ sectionId: 'chorus2', intensity: 1 }], fillVariantSeed: 3 },
  },
  {
    name: 'pop_repeat_group_suppression_empty_climax',
    note: 'verseA/verseB 同 repeatGroup=V 且 entry≠lead-in → 该段界被抑制（repeat-group suppression）；'
      + '**显式空 climaxMap** → 无高潮（has_climax_map=true 但逐段 has_climax 全 0，区别于回退末 chorus）；'
      + 'verseB→verseC 同组但 entry=lead-in ⇒ **放行**（与 verseA→verseB 的抑制成对，排除"无条件抑制"实现）。',
    sections: REPEATED, contractId: uniformContract(REPEATED, 'pop_radio_straight'),
    energy: { verseA: 0.5, verseB: 0.5, verseC: 0.5, bridge: 0.62, hookEnd: 0.84 },
    entry: { verseA: 'downbeat', verseB: 'downbeat', verseC: 'lead-in', bridge: 'downbeat', hookEnd: 'lead-in' },
    opening: opening('verseA'),
    options: { climaxMap: [], fillVariantSeed: 11 },
  },
  {
    name: 'pop_strict_downbeat',
    note: 'strictDownbeatBoundaries=true → 段界 + 内部 cadence 全禁，**但 opening boundary 不受 strict 管辖**'
      + '（planOpeningBoundary 在 strict 分支之外，planner:609-615）——刻意用 pickupFill 锁死这条非对称语义；'
      + 'bar 侧 role 因无段界/ cadence 而不被改写为 turnaround。',
    sections: POP_TRIO, contractId: uniformContract(POP_TRIO, 'pop_radio_straight'),
    energy: POP_TRIO_ENERGY, entry: POP_TRIO_ENTRY,
    opening: opening('intro', { mode: 'pickupFill', pickupBars: 1 }),
    options: { strictDownbeatBoundaries: true },
  },
  {
    name: 'lofi_dropout_kind',
    note: 'lofi_lazy_dilla：fillFamily=lofi-one-shot 且 next=hook/entry=lead-in → kind=dropout；'
      + '合同无 pop-rock fillVocabulary 时 fillScore 缺省（presence 位清）。',
    sections: POP_TRIO, contractId: uniformContract(POP_TRIO, 'lofi_lazy_dilla'),
    energy: { intro: 0.2, verse: 0.4, chorus: 0.8 }, entry: POP_TRIO_ENTRY, opening: opening('intro'),
    options: { fillVariantSeed: 5 },
  },
  {
    name: 'jazz_take_five_54_role_cells',
    note: '5/4 take-five：rolePatternBySection 三 role（bass/comp timed-cells + lead grammar-marker）'
      + '→ rhythm_cells/voice_durations 池；profile.allowSetupPickup=false → setup 段界被禁；'
      + 'cadenceEveryBars=4 → 8 bar 段产内部 cadence；beatGrouping=[3,2] 驱动 5 拍 structural beats。',
    sections: TAKE_FIVE, contractId: uniformContract(TAKE_FIVE, 'jazz_take_five_5_4'),
    energy: { intro54: 0.35, head54: 0.62, solo54: 0.7, out54: 0.4 },
    entry: { intro54: 'downbeat', head54: 'downbeat', solo54: 'lead-in', out54: 'downbeat' },
    opening: opening('intro54', { drumEntry: 'rideOnly' }),
    options: {
      fillVariantSeed: 2,
      bassPatternIdBySection: { head54: BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID, solo54: JAZZ_WALKING_BASS_PATTERN_ID },
      rolePatternBySection: {
        head54: {
          bass: BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID,
          comp: COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID,
          lead: LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID,
        } as RoleRhythmPatternReferenceByRole,
        solo54: { comp: COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID } as RoleRhythmPatternReferenceByRole,
      },
    },
  },
  {
    name: 'pop_ballad_internal_cadence',
    note: '单段 12 bar：只产内部 cadence（sourceInSection=7，末 bar 不被 cadence 占）；'
      + 'halftime family 驱动 structuralSnareBeats 单点分支。',
    sections: BALLAD_LONG, contractId: uniformContract(BALLAD_LONG, 'pop_ballad_halftime'),
    energy: { longVerse: 0.45 }, entry: { longVerse: 'downbeat' }, opening: opening('longVerse'),
    options: { fillVariantSeed: 13 },
  },
  {
    name: 'pop_loop_tag_function_tags',
    note: "functionTag 'loop'（sectionBarRole 穿透分支）+ 'tag'（→release / landing=none / 段内 role 塌"
      + ' breakdown / 禁内部 cadence）；loopBody 12 bar 另产内部 cadence。补齐全 11 functionTag 覆盖。',
    sections: LOOP_TAG, contractId: uniformContract(LOOP_TAG, 'pop_radio_straight'),
    energy: { loopBody: 0.55, tagOut: 0.55 },
    entry: { loopBody: 'downbeat', tagOut: 'downbeat' },
    opening: opening('loopBody'),
    options: { fillVariantSeed: 29 },
  },
  {
    name: 'pop_energy_threshold_edge',
    note: '.06/.07 阈值的 binary64 刀锋：0.66→0.60 与 0.60→0.67 两段落差在 TS 判 release/rising，'
      + '而整数 permille 重排判 continuation/settled（相反）。锁死 boundaryFunction 与 barTrajectory '
      + '的比较必须在 binary64 语义下进行。',
    sections: ENERGY_EDGE, contractId: uniformContract(ENERGY_EDGE, 'pop_radio_straight'),
    energy: {
      edgeHi: 0.66, edgeLo: 0.6, edgeUp: 0.67,            // 正向触发（TS true / 整数 < > false）
      ctrlFallA: 0.5, ctrlFallB: 0.44,                     // 反向控制（TS false / 整数 <= true）
      ctrlRiseA: 0.5, ctrlRiseB: 0.57,                     // 反向控制（TS false / 整数 >= true）
    },
    entry: {
      edgeHi: 'downbeat', edgeLo: 'downbeat', edgeUp: 'downbeat',
      ctrlFallA: 'downbeat', ctrlFallB: 'downbeat', ctrlRiseA: 'downbeat', ctrlRiseB: 'downbeat',
    },
    opening: opening('edgeHi'),
    options: { fillVariantSeed: 31 },
  },
  {
    name: 'pop_climax_constant_precision',
    note: 'climax 系数常量精度锁：显式 climaxMap intensity=0.37 且段 energy=0.204 ⇒ arrival/peak 小节 '
      + 'energy = 222permille（0.05 为 double 常量）；若写成 0.05f 则得 223。',
    sections: CLIMAX_CONST, contractId: uniformContract(CLIMAX_CONST, 'pop_radio_straight'),
    energy: { ccLead: 0.5, ccPeak: 0.204 },
    entry: { ccLead: 'downbeat', ccPeak: 'lead-in' },
    opening: opening('ccLead'),
    options: { climaxMap: [{ sectionId: 'ccPeak', intensity: 0.37 }], fillVariantSeed: 71 },
  },
  {
    name: 'pop_energy_falling_algebra',
    note: "falling 分支代数形式锁：outro 段整段 falling，energy=0.305 且 bars=4 ⇒ 末小节 "
      + '`e*(1-p*0.1)`=275permille 而展开式 `e - e*p*0.1`=274 ⇒ 改写代数形式即被抓。',
    sections: FALL_ALGEBRA, contractId: uniformContract(FALL_ALGEBRA, 'pop_radio_straight'),
    energy: { fallBody: 0.5, fallOutro: 0.305 },
    entry: { fallBody: 'downbeat', fallOutro: 'downbeat' },
    opening: opening('fallBody'),
    options: { fillVariantSeed: 67 },
  },
  {
    name: 'pop_energy_assoc_order',
    note: 'barEnergy rising 分支的乘法结合序：0.3→0.563 且 bars=4（progress=2/3）时，'
      + '(d*progress)*0.75 = 431permille 而 d*(progress*0.75) = 432 ⇒ 锁死与 TS 逐字一致的左结合。',
    sections: ASSOC_ORDER, contractId: uniformContract(ASSOC_ORDER, 'pop_radio_straight'),
    energy: { assocFrom: 0.3, assocTo: 0.563 },
    entry: { assocFrom: 'downbeat', assocTo: 'downbeat' },
    opening: opening('assocFrom'),
    options: { fillVariantSeed: 61 },
  },
  {
    name: 'pop_threshold_exact_equality',
    note: '阈值**精确相等**：0.35→0.42 满足 next == energy+0.07（binary64 精确），故 `>` 为假 ⇒ '
      + 'continuation/settled；把 `>` 写成 `>=` 的实现会判成 lift/rising。0.35→0.29 同理对 `<`。',
    sections: THRESH_EQ, contractId: uniformContract(THRESH_EQ, 'pop_radio_straight'),
    energy: { eqBase: 0.35, eqUpEq: 0.42, eqMid: 0.35, eqDownEq: 0.29 },
    entry: { eqBase: 'downbeat', eqUpEq: 'downbeat', eqMid: 'downbeat', eqDownEq: 'downbeat' },
    opening: opening('eqBase'),
    options: { fillVariantSeed: 59 },
  },
  {
    name: 'pop_ballad_sparse_climax_downgrade',
    note: 'pop_ballad_halftime（sparse + pop-rock vocab）+ 回退高潮 ⇒ boundary intensity=3，但 fill '
      + 'materialize 因 density=sparse 降级为 2（baseVelocity 78 而非 90）——漏降级的实现 velocity 全偏高。',
    sections: BALLAD_CLIMAX, contractId: uniformContract(BALLAD_CLIMAX, 'pop_ballad_halftime'),
    energy: { balladVerse: 0.5, balladHook: 0.85 },
    entry: { balladVerse: 'downbeat', balladHook: 'lead-in' },
    opening: opening('balladVerse'),
    options: { fillVariantSeed: 37 },
  },
  {
    name: 'pop_citypop_active_response_limits',
    note: "density='active' ⇒ kickResponseLimit base=3；hook 段 bar role=lift 再 +1 ⇒ 4（上沿）。"
      + '补齐 sparse/medium/active 三档密度映射的对账。',
    sections: CITYPOP_ACTIVE, contractId: uniformContract(CITYPOP_ACTIVE, 'pop_citypop_boogie'),
    energy: { cityStory: 0.6, cityHook: 0.88 },
    entry: { cityStory: 'downbeat', cityHook: 'lead-in' },
    opening: opening('cityStory'),
    options: { fillVariantSeed: 41 },
  },
  {
    name: 'jazz_ballad_ride_landing',
    note: "jazz_ballad_loose（sparse × comping × landing='ride'，非 pop-rock vocab ⇒ fillScore 缺省）："
      + '补齐 landing=ride 与 comping×sparse 的 responseLimit 组合。',
    sections: JAZZ_BALLAD, contractId: uniformContract(JAZZ_BALLAD, 'jazz_ballad_loose'),
    energy: { jbHead: 0.5, jbSolo: 0.62 },
    entry: { jbHead: 'downbeat', jbSolo: 'downbeat' },
    opening: opening('jbHead', { drumEntry: 'brushLoop' }),
    options: { fillVariantSeed: 43 },
  },
  {
    name: 'pop_absent_function_tag',
    note: 'functionTag 全部缺省 ⇒ 输入侧 0xFF 哨兵（G1 允许，legacy formPlanner 模板即如此）；'
      + 'sectionBarRole 走穿透分支，段内 role 直接取 phraseShape。判别用途：把 0xFF 判成 '
      + 'ERR_BAD_FORM、或对缺省 tag 误塌 breakdown/lift 的实现会在此 case 转红。',
    sections: NO_FUNCTION_TAG, contractId: uniformContract(NO_FUNCTION_TAG, 'pop_radio_straight'),
    energy: { plainIntro: 0.3, plainVerse: 0.5, plainChorus: 0.8 },
    entry: { plainIntro: 'downbeat', plainVerse: 'downbeat', plainChorus: 'lead-in' },
    opening: opening('plainIntro'),
    options: { fillVariantSeed: 47 },
  },
  {
    name: 'lofi_opening_soft_intensity',
    note: "opening.mode=pickupFill + intensity='soft' ⇒ opening boundary intensity=1（lofi 生产候选）；"
      + 'lofi 无 pop-rock vocab ⇒ 该 opening boundary 的 fillScore 缺省（另覆盖"opening 且无 fillScore"）。',
    sections: LOFI_SOFT_OPENING, contractId: uniformContract(LOFI_SOFT_OPENING, 'lofi_lazy_dilla'),
    energy: { softIntro: 0.25, softVerse: 0.45 },
    entry: { softIntro: 'downbeat', softVerse: 'downbeat' },
    opening: opening('softIntro', { mode: 'pickupFill', drumEntry: 'kickOnly', pickupBars: 1, intensity: 'soft' }),
    options: { fillVariantSeed: 53 },
  },
  {
    name: 'rnb_breakdown_bass_pattern',
    note: 'rnb_neo_soul_laidback + bassPatternIdBySection（contract KB bass ref）；breakdown 段 '
      + 'functionTag→bar role=breakdown、内部 cadence 被 allowsInternalCadence 禁。',
    sections: RNB_PAIR, contractId: uniformContract(RNB_PAIR, 'rnb_neo_soul_laidback'),
    energy: { groove: 0.55, breakdown: 0.3, lift: 0.85 },
    entry: { groove: 'downbeat', breakdown: 'downbeat', lift: 'lead-in' },
    opening: opening('groove'),
    options: {
      fillVariantSeed: 17,
      bassPatternIdBySection: { groove: 'rnb_neo_soul_sparse', lift: 'rnb_motown_syncopated' },
    },
  },
  {
    name: 'acg_setup_suppressed_empty_boundaries',
    note: 'acg_hisaishi_rubato_arp（profile rubato-four：allowSetupPickup=false, cadenceEveryBars=8）：'
      + '唯一段界的源段是 setup → 被抑制；两段皆无内部 cadence（setup 段禁 / story 段 8 bar 不足）；'
      + 'opening=textureFadeIn 不产 opening boundary ⇒ **boundaries 池为空**（n_boundaries=0 的物理边界靶）。',
    sections: ACG_PAIR, contractId: uniformContract(ACG_PAIR, 'acg_hisaishi_rubato_arp'),
    energy: { rubatoA: 0.3, rubatoB: 0.5 },
    entry: { rubatoA: 'downbeat', rubatoB: 'downbeat' }, opening: opening('rubatoA'),
  },
];

// ============================================================
// 投影：GrooveScorePlan → flat-pool（对锁 afe_groove_score_plan_t）
// ============================================================
function buildCase(fx: Fixture, cellLiterals: Map<string, Array<Record<string, Rational | Rational[]>>>) {
  TIE_CASE = fx.name;
  const contractBySection: Record<SectionId, GrooveContract> = {};
  for (const s of fx.sections) {
    const c = grooveContractById(fx.contractId[s.id]);
    if (!c) throw new Error(`${fx.name}: 未知合同 ${fx.contractId[s.id]}`);
    contractBySection[s.id] = c;
  }
  const options: GrooveScoreOptions = { ...(fx.options ?? {}) };
  const plan = planGrooveScore(fx.sections, contractBySection, fx.energy, fx.entry, fx.opening, options);

  const sectionIndex = new Map(fx.sections.map((s, i) => [s.id, i]));
  const climaxBySection = new Map((fx.options?.climaxMap ?? []).map((p) => [p.sectionId, p.intensity]));

  // ---- section 字符串池（id + repeatGroup 共池，首现序；C 侧 id_off/repeat_group_off 索引之）----
  const poolStrings: string[] = [];
  const poolOffset = new Map<string, number>();
  let poolCursor = 0;
  const intern = (s: string): number => {
    const hit = poolOffset.get(s);
    if (hit !== undefined) return hit;
    poolOffset.set(s, poolCursor);
    poolStrings.push(s);
    poolCursor += Buffer.byteLength(s, 'utf-8') + 1;   // NUL 终止
    return poolOffset.get(s)!;
  };
  for (const s of fx.sections) intern(s.id);
  for (const s of fx.sections) if (s.repeatGroup !== undefined) intern(s.repeatGroup);

  // ---- 输入投影（C afe_groove_score_input_t / afe_groove_section_input_t 就绪）----
  const inputSections = fx.sections.map((s) => {
    const energy = fx.energy[s.id];
    if (energy === undefined) throw new Error(`${fx.name}: 段 ${s.id} 缺 energy（输入适配器契约要求逐段提供）`);
    const rolePat = fx.options?.rolePatternBySection?.[s.id];
    const refFor = (r: string | undefined): number =>
      r === undefined ? ID_NONE : _lk(ROLE_RHYTHM_ID_IDX, r, 'role rhythm id');
    const bassRef = fx.options?.bassPatternIdBySection?.[s.id];
    const climax = climaxBySection.get(s.id);
    return {
      sectionId: s.id,
      idOff: poolOffset.get(s.id)!,
      role: s.role, roleIdx: _lk(SECTION_ROLE_IDX, s.role, 'section role'),
      functionTag: s.functionTag ?? null,
      functionTagIdx: s.functionTag === undefined
        ? FUNCTION_TAG_ABSENT : _lk(FUNCTION_TAG_IDX, s.functionTag, 'function tag'),
      repeatGroup: s.repeatGroup ?? null,
      repeatGroupOff: s.repeatGroup === undefined ? ID_NONE : poolOffset.get(s.repeatGroup)!,
      bars: s.bars,
      contractId: fx.contractId[s.id],
      contractIdEnum: _lk(CONTRACT_ID_IDX, fx.contractId[s.id], 'contract id'),
      energy: quant(energy, `input.sections[${s.id}].energy`),
      entry: fx.entry[s.id], entryIdx: _lk(ENTRY_IDX, fx.entry[s.id], 'section entry'),
      bassPatternRef: bassRef === undefined ? ID_NONE : _lk(BASS_REF_IDX, bassRef, 'bass pattern ref'),
      rolePattern: [refFor(rolePat?.bass), refFor(rolePat?.comp), refFor(rolePat?.lead)],
      climaxIntensity: quant(climax ?? 0, `input.sections[${s.id}].climaxIntensity`),
      hasClimax: climax !== undefined,
    };
  });

  const input = {
    sectionIdPool: poolStrings,
    sectionIdPoolLen: poolCursor,
    sections: inputSections,
    openingSectionIndex: sectionIndex.get(fx.opening.sectionId) ?? -1,
    openingMode: fx.opening.mode, openingModeIdx: _lk(OPENING_MODE_IDX, fx.opening.mode, 'opening mode'),
    openingPickupBars: fx.opening.pickupBars,
    openingIntensity: fx.opening.intensity,
    openingIntensityIdx: _lk(OPENING_INTENSITY_IDX, fx.opening.intensity, 'opening intensity'),
    strictDownbeatBoundaries: fx.options?.strictDownbeatBoundaries ?? false,
    hasClimaxMap: fx.options?.climaxMap !== undefined,
    fillVariantSeed: fx.options?.fillVariantSeed ?? 0,
  };
  if (input.openingSectionIndex < 0) throw new Error(`${fx.name}: opening.sectionId 不在 sections`);

  // ---- 输出投影：flat pools ----
  const bars: unknown[] = [];
  const rhythmCells: unknown[] = [];
  const voiceDurations: Rational[] = [];
  const sections = fx.sections.map((s, si) => {
    const sec = plan.bySection[s.id];
    if (!sec) throw new Error(`${fx.name}: bySection 缺段 ${s.id}`);
    const barsOff = bars.length;
    for (const bar of sec.bars) {
      const di = bar.drumInteraction;
      if (!di) throw new Error(`${fx.name}: bar 缺 drumInteraction（planGrooveScore 恒产出）`);
      if (bar.energy === undefined || bar.trajectory === undefined)
        throw new Error(`${fx.name}: bar 缺 energy/trajectory（planGrooveScore 恒产出）`);
      if (bar.beatStrength.length > CAP.beatsPerBar || bar.subdivisionAccent.length > CAP.subdivAccent)
        throw new Error(`${fx.name}: beatStrength/subdivisionAccent 超 ABI 上界`);
      for (const b of [...di.structuralKickBeats, ...di.structuralSnareBeats]) {
        if (!Number.isInteger(b) || b < 0 || b >= CAP.beatsPerBar)
          throw new Error(`${fx.name}: structural beat ${b} 非 [0,${CAP.beatsPerBar}) 整数（C 侧 uint8 存整拍）`);
      }
      const bi = bars.length;   // 本 bar 在 flat 池中的下标（tie 路径锚）
      bars.push({
        sectionIndex: si,
        barInSection: bar.barInSection,
        absoluteBar: bar.absoluteBar,
        phraseIndex: bar.phraseIndex,
        phraseBarIndex: bar.phraseBarIndex,
        role: _lk(BAR_ROLE_IDX, bar.role, 'bar role'),
        beatStrength: bar.beatStrength.map((x, k) => quant(x, `bars[${bi}].beatStrength[${k}]`)),
        subdivision: _lk(SUBDIVISION_IDX, bar.subdivision, 'subdivision'),
        subdivisionAccent: bar.subdivisionAccent.map((x, k) => quant(x, `bars[${bi}].subdivisionAccent[${k}]`)),
        phraseAccent: quant(bar.phraseAccent, `bars[${bi}].phraseAccent`),
        energy: quant(bar.energy, `bars[${bi}].energy`),
        trajectory: _lk(TRAJ_IDX, bar.trajectory, 'trajectory'),
        drumInteraction: {
          kickFollow: _lk(KICK_FOLLOW_IDX, di.kickFollow, 'kick follow'),
          snareFollow: _lk(SNARE_FOLLOW_IDX, di.snareFollow, 'snare follow'),
          structuralKickBeats: di.structuralKickBeats.slice(),
          structuralSnareBeats: di.structuralSnareBeats.slice(),
          kickResponseLimit: di.kickResponseLimit,
          snareResponseLimit: di.snareResponseLimit,
        },
        presence: ['ENERGY', 'TRAJECTORY', 'DRUM_INTERACTION'],
      });
    }
    // roleRhythm[3]：bass/comp/lead（id=NONE 表无），cells 进 rhythm_cells 池
    const roleRhythm = (['bass', 'comp', 'lead'] as const).map((role) => {
      const p = sec.roleRhythmByRole?.[role];
      if (!p) return { role, id: ID_NONE, realization: 0, beatsPerBar: 0, cellOff: 0, cellN: 0 };
      const lit = cellLiterals.get(p.id) ?? [];
      const cellOff = rhythmCells.length;
      const cells = 'cells' in p ? (p as { cells: readonly unknown[] }).cells : [];
      if (cells.length !== lit.length)
        throw new Error(`${fx.name}: ${p.id} AST cell 数 ${lit.length} ≠ 运行时 ${cells.length}`);
      cells.forEach((raw, i) => {
        const c = raw as {
          phaseBeats: number; durationBeats: number; velocity: number;
          voiceAction?: string; voiceDurationBeats?: readonly number[];
        };
        const L = lit[i];
        const phase = L.phaseBeats as Rational;
        const dur = L.durationBeats as Rational;
        assertRatEqFloat(phase, c.phaseBeats, `${p.id}[${i}].phaseBeats`);
        assertRatEqFloat(dur, c.durationBeats, `${p.id}[${i}].durationBeats`);
        const vdOff = voiceDurations.length;
        let vdN = 0;
        if (c.voiceDurationBeats) {
          const vlit = L.voiceDurationBeats as Rational[] | undefined;
          if (!vlit || vlit.length !== c.voiceDurationBeats.length)
            throw new Error(`${fx.name}: ${p.id}[${i}].voiceDurationBeats AST/运行时 长度不符`);
          vlit.forEach((r, k) => assertRatEqFloat(r, c.voiceDurationBeats![k], `${p.id}[${i}].voiceDur[${k}]`));
          voiceDurations.push(...vlit);
          vdN = vlit.length;
        }
        rhythmCells.push({
          phaseBeats: phase, durationBeats: dur, velocity: c.velocity,
          // bass cell 无 voiceAction 字段 → 物理缺省 foundation(0)（C designated-init 同）
          voiceAction: c.voiceAction === undefined ? 0 : _lk(VOICE_ACTION_IDX, c.voiceAction, 'voice action'),
          voiceDurOff: vdN === 0 ? 0 : vdOff, voiceDurN: vdN,
        });
      });
      return {
        role,
        id: _lk(ROLE_RHYTHM_ID_IDX, p.id, 'role rhythm id'),
        realization: _lk(REALIZATION_IDX, p.realization, 'realization'),
        beatsPerBar: p.beatsPerBar,
        cellOff: cells.length === 0 ? 0 : cellOff,
        cellN: cells.length,
      };
    });
    const bassPatternId = sec.bassPatternId;
    return {
      sectionIndex: si,
      sectionId: s.id,
      contractId: _lk(CONTRACT_ID_IDX, sec.grooveContractId, 'contract id'),
      bassPattern: bassPatternId === undefined ? ID_NONE : _lk(BASS_REF_IDX, bassPatternId, 'bass pattern ref'),
      roleRhythm,
      barsOff, barsN: sec.bars.length,
    };
  });

  // ---- boundaries（已按 sourceBar/opening 稳定排序）+ fill_hits 池 ----
  const fillHits: unknown[] = [];
  const boundaries = plan.boundaries.map((b, bi) => {
    const presence: string[] = [];
    if (b.fromSectionId !== undefined) presence.push('FROM');
    if (b.fillFunction !== undefined) presence.push('FILL_FUNCTION');
    let fillScore: Record<string, unknown> | null = null;
    if (b.fillScore) {
      presence.push('FILL_SCORE');
      const hitsOff = fillHits.length;
      for (const h of b.fillScore.hits) {
        fillHits.push({
          offsetBeatsFromEnd: ratFromQuarterGrid(h.offsetBeatsFromEnd, `${fx.name}/${b.id}.offset`),
          voice: _lk(FILL_VOICE_IDX, h.voice, 'fill voice'),
          velocity: h.velocity,
        });
      }
      fillScore = {
        vocabularyId: _lk(FILL_VOCAB_IDX, b.fillScore.vocabularyId, 'fill vocab'),
        function: _lk(FILL_FN_IDX, b.fillScore.function, 'fill function'),
        rhythmClass: _lk(FILL_RC_IDX, b.fillScore.rhythmClass, 'fill rhythm class'),
        orchestration: _lk(FILL_ORCH_IDX, b.fillScore.orchestration, 'fill orch'),
        hitsOff: b.fillScore.hits.length === 0 ? 0 : hitsOff,
        hitsN: b.fillScore.hits.length,
        recipeId: b.fillScore.recipeId,   // 诊断字段（G1 排除清单：不入 C struct，仅本 JSON 溯源）
      };
    }
    const fromIdx = b.fromSectionId === undefined ? undefined : sectionIndex.get(b.fromSectionId);
    const toIdx = sectionIndex.get(b.toSectionId);
    if (toIdx === undefined) throw new Error(`${fx.name}: boundary toSectionId ${b.toSectionId} 不在 sections`);
    if (b.fromSectionId !== undefined && fromIdx === undefined)
      throw new Error(`${fx.name}: boundary fromSectionId ${b.fromSectionId} 不在 sections`);
    return {
      boundaryIndex: bi,
      diagId: b.id,                       // 诊断字段（不入 C struct）
      // optional payload 一律 null 表缺省（**不在 exporter 侧写物理缺省值**）：presence 由转换器
      // 从 payload 反算并双向核对（步2 教训①），物理缺省 0 由转换器统一物化并入 digest（教训②）。
      fromSectionIndex: fromIdx ?? null,
      toSectionIndex: toIdx,
      sourceBar: b.sourceBar,
      landingBar: b.landingBar,
      kind: _lk(BOUNDARY_KIND_IDX, b.kind, 'boundary kind'),
      intensity: b.intensity,
      durationBeats: ratFromQuarterGrid(b.durationBeats, `${fx.name}/${b.id}.durationBeats`),
      durationBeatsRawBits: dbitsHex(b.durationBeats),
      baseMask: _lk(BASE_MASK_IDX, b.baseMask, 'base mask'),
      drumFillFamily: _lk(FILL_FAMILY_IDX, b.drumFillFamily, 'fill family'),
      fillFunction: b.fillFunction === undefined ? null : _lk(FILL_FN_IDX, b.fillFunction, 'fill function'),
      fillScore,
      landing: _lk(LANDING_IDX, b.landing, 'landing'),
      opening: b.opening,
      presence,
    };
  });

  // ---- 容量 fail-closed（ABI 上界；导出侧先红，不留给 C 侧溢出）----
  const capCheck: [string, number, number][] = [
    ['sections', sections.length, CAP.sections], ['bars', bars.length, CAP.bars],
    ['boundaries', boundaries.length, CAP.boundaries], ['fill_hits', fillHits.length, CAP.fillHits],
    ['rhythm_cells', rhythmCells.length, CAP.rhythmCells],
    ['voice_durations', voiceDurations.length, CAP.voiceDurations],
  ];
  for (const [what, n, cap] of capCheck)
    if (n > cap) throw new Error(`${fx.name}: ${what}=${n} 超 ABI 上界 ${cap}（fail-closed）`);
  for (const s of fx.sections)
    if (s.bars > CAP.barsPerSection) throw new Error(`${fx.name}: 段 ${s.id} bars=${s.bars} 超 ${CAP.barsPerSection}`);
  if (bars.length !== fx.sections.reduce((n, s) => n + s.bars, 0))
    throw new Error(`${fx.name}: bars 池长 ≠ Σ section.bars`);

  return {
    name: fx.name,
    note: fx.note,
    input,
    expected: {
      songContractId: _lk(CONTRACT_ID_IDX, plan.grooveContractId, 'contract id'),
      sections, bars, boundaries, fillHits, rhythmCells, voiceDurations,
    },
  };
}

describe('export afe groove score golden（P2-4c 步3）', () => {
  it('freezes planGrooveScore fixtures as the C parity oracle', () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const exporterSha = createHash('sha256')
      .update(readFileSync(join(HERE, 'export-afe-groove-score.export.test.ts'))).digest('hex');
    const cellLiterals = extractRoleRhythmCellLiterals();
    const cases = FIXTURES.map((fx) => buildCase(fx, cellLiterals));

    // ---- 覆盖自检（fail-closed；断言的是**设计覆盖真的达成**，非事后描述）----
    expect(new Set(cases.map((c) => c.name)).size, 'case name distinct').toBe(cases.length);
    const allBoundaries = cases.flatMap((c) => c.expected.boundaries);
    const allBars = cases.flatMap((c) => c.expected.bars as Array<{ role: number; trajectory: number }>);
    const kinds = new Set(allBoundaries.map((b) => b.kind));
    expect(kinds, 'boundary kind 覆盖 pickup(0)/fill(1)/dropout(3)').toEqual(new Set([0, 1, 3]));
    expect(kinds.has(BOUNDARY_KIND_IDX.break), "'break' 无生产路径，不得出现").toBe(false);
    const fns = new Set(allBoundaries.map((b) => b.fillFunction));
    expect(fns, 'fillFunction 覆盖全 6 值').toEqual(new Set([0, 1, 2, 3, 4, 5]));
    expect(new Set(allBars.map((b) => b.trajectory)), 'trajectory 覆盖全 5 值')
      .toEqual(new Set([0, 1, 2, 3, 4]));
    expect(new Set(allBars.map((b) => b.role)).size, 'bar role ≥3 种').toBeGreaterThanOrEqual(3);
    expect(allBoundaries.some((b) => b.opening), 'opening boundary 覆盖').toBe(true);
    expect(allBoundaries.some((b) => b.fillScore === null), 'fillScore 缺省覆盖').toBe(true);
    expect(allBoundaries.some((b) => b.fillScore !== null), 'fillScore 存在覆盖').toBe(true);
    expect(allBoundaries.some((b) => !b.presence.includes('FROM')), 'from 缺省覆盖').toBe(true);
    const byName = new Map(cases.map((c) => [c.name, c]));
    // strict 只禁段界/内部 cadence；opening boundary 仍产（planner:609-615 在 strict 分支外）——
    // 该非对称是 C 步4/5 最易实现错的点，故正面锁死而非绕开。
    const strictCase = byName.get('pop_strict_downbeat')!;
    expect(strictCase.expected.boundaries.length, 'strict 下只剩 opening boundary').toBe(1);
    expect(strictCase.expected.boundaries[0].opening, 'strict 幸存者须是 opening').toBe(true);
    // 无段界/cadence ⇒ 无 role 改写 ⇒ 段内 role 必须严格按 phraseBars 周期平铺
    // （turnaround 本身可由 phraseShape 语法产生，故不能断言"无 turnaround"——那是过强的假命题）。
    {
      const p = grooveRhythmProfileForContract(grooveContractById('pop_radio_straight')!).phraseShape.length;
      const bars = strictCase.expected.bars as Array<{ sectionIndex: number; barInSection: number; role: number }>;
      const first = new Map<string, number>();
      for (const b of bars) {
        const key = `${b.sectionIndex}:${b.barInSection % p}`;
        if (!first.has(key)) first.set(key, b.role);
        expect(b.role, `strict: 段${b.sectionIndex} bar${b.barInSection} role 破 phrase 周期（=发生了改写）`)
          .toBe(first.get(key));
      }
    }
    expect(byName.get('acg_setup_suppressed_empty_boundaries')!.expected.boundaries.length,
      'setup 抑制 + 无 cadence + 无 opening ⇒ boundaries 池为空').toBe(0);
    // repeat-group suppression：verseA(idx0)→verseB 段界须缺席，verseB→bridge 段界须在
    const rep = byName.get('pop_repeat_group_suppression_empty_climax')!;
    expect(rep.expected.boundaries.some((b) => b.presence.includes('FROM') && b.fromSectionIndex === 0
      && b.toSectionIndex === 1), 'verseA→verseB 段界须被 repeat-group 抑制').toBe(false);
    expect(rep.expected.boundaries.some((b) => b.fromSectionIndex === 1 && b.toSectionIndex === 2),
      'verseB→bridge 段界须在').toBe(true);
    expect(rep.input.hasClimaxMap, '显式空 climaxMap → hasClimaxMap=true').toBe(true);
    expect(rep.input.sections.every((s) => !s.hasClimax), '显式空 → 逐段 hasClimax 全 0').toBe(true);
    // .06/.07 binary64 刀锋：整数 permille 重排会把这两条判反，故正面锁死期望值。
    {
      const ee = byName.get('pop_energy_threshold_edge')!;
      const b01 = ee.expected.boundaries.find((b) => b.fromSectionIndex === 0 && b.toSectionIndex === 1)!;
      const b12 = ee.expected.boundaries.find((b) => b.fromSectionIndex === 1 && b.toSectionIndex === 2)!;
      expect(b01.fillFunction, '0.66→0.60：next < E-0.06(=0.6000000000000001) 为真 ⇒ release')
        .toBe(FILL_FN_IDX.release);
      expect(b12.fillFunction, '0.60→0.67：next > E+0.07(=0.6699999999999999) 为真 ⇒ lift')
        .toBe(FILL_FN_IDX.lift);
      const trajOfSec = (si: number) => (ee.expected.bars as Array<{ sectionIndex: number; trajectory: number }>)
        .filter((b) => b.sectionIndex === si).map((b) => b.trajectory);
      expect(trajOfSec(0).slice(-2), 'edgeHi 末两 bar falling（同一 .06 刀锋）')
        .toEqual([TRAJ_IDX.falling, TRAJ_IDX.falling]);
      expect(trajOfSec(1).slice(-2), 'edgeLo 末两 bar rising（同一 .07 刀锋）')
        .toEqual([TRAJ_IDX.rising, TRAJ_IDX.rising]);
      // 反向控制：TS 判 false 而整数 `<=`/`>=` 判 true 的两点，必须**不**触发 release/lift。
      // 少了这两条，把比较写成 <=/>= 的"补偿实现"能与 TS 全部同号而蒙混过关。
      const b34 = ee.expected.boundaries.find((b) => b.fromSectionIndex === 3 && b.toSectionIndex === 4)!;
      const b56 = ee.expected.boundaries.find((b) => b.fromSectionIndex === 5 && b.toSectionIndex === 6)!;
      expect(b34.fillFunction, '0.50→0.44：0.44 < 0.44 为假 ⇒ 不得判 release')
        .toBe(FILL_FN_IDX.continuation);
      expect(b56.fillFunction, '0.50→0.57：0.57 > 0.5700000000000001 为假 ⇒ 不得判 lift')
        .toBe(FILL_FN_IDX.continuation);
      expect(trajOfSec(3).every((t) => t !== TRAJ_IDX.falling), 'ctrlFallA 不得 falling').toBe(true);
      expect(trajOfSec(5).every((t) => t !== TRAJ_IDX.rising), 'ctrlRiseA 不得 rising').toBe(true);
    }
    // climax 常量精度：peak 段小节 energy 必须是 222（0.05f 会得 223）
    {
      const cc = byName.get('pop_climax_constant_precision')!;
      const pb = (cc.expected.bars as Array<{ sectionIndex: number; energy: { q: number };
        trajectory: number }>).filter((b) => b.sectionIndex === 1);
      expect(pb[0].trajectory, 'climax 段首小节 arrival').toBe(TRAJ_IDX.arrival);
      expect(new Set(pb.map((b) => b.energy.q)), 'climax 段 energy 恒 222（0.05f 会得 223）')
        .toEqual(new Set([222]));
    }
    // falling 代数形式：outro 段末小节 energy 必须是 275（展开式得 274）
    {
      const fa = byName.get('pop_energy_falling_algebra')!;
      const ob = (fa.expected.bars as Array<{ sectionIndex: number; energy: { q: number };
        trajectory: number }>).filter((b) => b.sectionIndex === 1);
      expect(ob.every((b) => b.trajectory === TRAJ_IDX.falling), 'outro 段整段 falling').toBe(true);
      expect(ob[ob.length - 1].energy.q, 'outro 末小节 energy=275（展开式会得 274）').toBe(275);
    }
    // 乘法结合序：第 2 小节 energy 必须是左结合的 431（右结合得 432）
    {
      const ao = byName.get('pop_energy_assoc_order')!;
      const bars0 = (ao.expected.bars as Array<{ sectionIndex: number; barInSection: number;
        energy: { q: number }; trajectory: number }>).filter((b) => b.sectionIndex === 0);
      expect(bars0[2].trajectory, 'assoc 第2小节须 rising').toBe(TRAJ_IDX.rising);
      expect(bars0[2].energy.q, 'assoc 第2小节 energy=431（左结合；右结合会得 432）').toBe(431);
    }
    // 精确相等对：`>` vs `>=` / `<` vs `<=` 的 double 层判别（步4 变异测试暴露的盲区）
    {
      const eq = byName.get('pop_threshold_exact_equality')!;
      const b01 = eq.expected.boundaries.find((b) => b.fromSectionIndex === 0 && b.toSectionIndex === 1)!;
      const b23 = eq.expected.boundaries.find((b) => b.fromSectionIndex === 2 && b.toSectionIndex === 3)!;
      expect(b01.fillFunction, '0.35→0.42：next == E+0.07 精确相等 ⇒ `>` 假 ⇒ continuation')
        .toBe(FILL_FN_IDX.continuation);
      expect(b23.fillFunction, '0.35→0.29：next == E-0.06 精确相等 ⇒ `<` 假 ⇒ continuation')
        .toBe(FILL_FN_IDX.continuation);
      const tr = (si: number) => (eq.expected.bars as Array<{ sectionIndex: number; trajectory: number }>)
        .filter((b) => b.sectionIndex === si).map((b) => b.trajectory);
      expect(tr(0).every((t) => t !== TRAJ_IDX.rising), '精确相等 ⇒ 不得 rising').toBe(true);
      expect(tr(2).every((t) => t !== TRAJ_IDX.falling), '精确相等 ⇒ 不得 falling').toBe(true);
    }
    // 密度/landing/sparse-降级 三组补缺的判别锚
    {
      const bal = byName.get('pop_ballad_sparse_climax_downgrade')!;
      const climaxB = bal.expected.boundaries.find((b) => b.fillFunction === FILL_FN_IDX.climax)!;
      expect(climaxB.intensity, 'sparse 合同 boundary intensity 仍记 3').toBe(3);
      expect(climaxB.fillScore !== null, 'pop-rock vocab ⇒ fillScore 在').toBe(true);
      const city = byName.get('pop_citypop_active_response_limits')!;
      const limits = new Set((city.expected.bars as Array<{ drumInteraction: { kickResponseLimit: number } }>)
        .map((b) => b.drumInteraction.kickResponseLimit));
      expect(limits.has(3), 'active 密度 ⇒ kickResponseLimit base=3').toBe(true);
      expect(limits.has(4), 'active × lift ⇒ kickResponseLimit 上沿 4').toBe(true);
      const jb = byName.get('jazz_ballad_ride_landing')!;
      expect(jb.expected.boundaries.some((b) => b.landing === LANDING_IDX.ride), 'landing=ride 覆盖').toBe(true);
    }
    // 三条决策分支的判别锚（Codex 三轮 F2）
    {
      const nt = byName.get('pop_absent_function_tag')!;
      expect(nt.input.sections.every((x) => x.functionTag === null && x.functionTagIdx === 0xFF),
        'functionTag 缺省 ⇒ 0xFF 哨兵').toBe(true);
      const so = byName.get('lofi_opening_soft_intensity')!;
      const ob = so.expected.boundaries.find((b) => b.opening)!;
      expect(ob.intensity, "opening intensity='soft' ⇒ 1").toBe(1);
      expect(ob.fillScore, 'lofi opening 无 pop-rock vocab ⇒ fillScore 缺省').toBe(null);
      // 同 repeatGroup：downbeat 抑制 / lead-in 放行 **配对**
      const rp2 = byName.get('pop_repeat_group_suppression_empty_climax')!;
      expect(rp2.input.sections[1].repeatGroupOff, 'verseB/verseC 同 repeatGroup')
        .toBe(rp2.input.sections[2].repeatGroupOff);
      expect(rp2.input.sections[2].entryIdx, 'verseC entry=lead-in').toBe(ENTRY_IDX['lead-in']);
      expect(rp2.expected.boundaries.some((b) => b.fromSectionIndex === 1 && b.toSectionIndex === 2),
        '同组但 lead-in ⇒ 段界须放行（排除"无条件抑制"实现）').toBe(true);
    }
    expect(new Set(cases.map((c) => c.input.openingIntensityIdx)), 'opening intensity 覆盖 soft/medium/bold')
      .toEqual(new Set([0, 1, 2]));
    expect(cases.some((c) => c.input.sections.some((x) => x.functionTagIdx === 0xFF)),
      'functionTag 缺省(0xFF) 覆盖').toBe(true);
    // 生产可达的 landing / responseLimit 值域覆盖（Codex 二轮问④的第四类缺口自查产物）：
    // snareFollow='lead-accents' 经核 21 合同无人使用 ⇒ 记入 coverageGaps，不伪造。
    const allDrum = cases.flatMap((c) => (c.expected.bars as Array<{ drumInteraction: {
      kickResponseLimit: number; snareResponseLimit: number; snareFollow: number } }>).map((b) => b.drumInteraction));
    expect(new Set(allDrum.map((d) => d.kickResponseLimit)), 'kickResponseLimit 覆盖 0..4')
      .toEqual(new Set([0, 1, 2, 3, 4]));
    expect(new Set(allBoundaries.map((b) => b.landing)).has(LANDING_IDX.ride), 'landing=ride 可达且已覆盖')
      .toBe(true);
    for (const c of GROOVE_CONTRACT_POOL)
      expect(c.drum?.snareFollow, `合同 ${c.id} 用了 lead-accents：该分支已可达，须补 fixture`)
        .not.toBe('lead-accents');
    // functionTag 全覆盖：11 个合法值一个不缺（sectionBarRole/allowsInternalCadence/boundaryFunction/
    // popRockLanding 的分支判定全挂在此域上；漏一个 = 该分支无对账靶）。
    const tagsCovered = new Set(cases.flatMap((c) => c.input.sections
      .map((s) => s.functionTag).filter((t): t is string => t !== null)));
    expect(tagsCovered, 'functionTag 须全 11 值覆盖').toEqual(new Set(Object.keys(FUNCTION_TAG_IDX)));
    // 'tag' 段语义锚：作为 next 时 → release + landing=none
    {
      const lt = byName.get('pop_loop_tag_function_tags')!;
      const toTag = lt.expected.boundaries.find((b) => b.toSectionIndex === 1)!;
      expect(toTag.fillFunction, 'next=tag ⇒ fn=release').toBe(FILL_FN_IDX.release);
      expect(toTag.landing, 'next=tag ⇒ landing=none').toBe(LANDING_IDX.none);
      // sectionBarRole 首行 `if (role==='turnaround') return role`（planner:132）令 phraseShape 的
      // turnaround 槽**穿透**塌陷 ⇒ tag 段 role ∈ {breakdown, turnaround}，且非 turnaround 槽必为 breakdown。
      const tagBars = (lt.expected.bars as Array<{ sectionIndex: number; phraseBarIndex: number; role: number }>)
        .filter((b) => b.sectionIndex === 1);
      expect(tagBars.every((b) => b.role === BAR_ROLE_IDX.breakdown || b.role === BAR_ROLE_IDX.turnaround),
        'tag 段 role ∈ {breakdown, turnaround}').toBe(true);
      expect(tagBars.some((b) => b.role === BAR_ROLE_IDX.breakdown), 'tag 段至少一 bar 塌 breakdown').toBe(true);
      expect(lt.expected.boundaries.some((b) => b.fromSectionIndex === 1 && b.toSectionIndex === 1),
        'tag 段禁内部 cadence').toBe(false);
    }
    // climax 回退判别力：两 chorus + 无 map ⇒ 末个 chorus(idx3) 拿 climax，首个(idx1) 不拿。
    // 缺这条断言，"取首个 chorus"的错误 C 实现能全绿混过 golden。
    {
      const tc = byName.get('pop_two_chorus_fallback_last')!;
      expect(tc.input.hasClimaxMap, '回退路径 hasClimaxMap=false').toBe(false);
      const toLate = tc.expected.boundaries.find((b) => b.toSectionIndex === 3)!;
      const toEarly = tc.expected.boundaries.find((b) => b.toSectionIndex === 1)!;
      expect(toLate.fillFunction, '末 chorus 段界 fn=climax').toBe(FILL_FN_IDX.climax);
      expect(toEarly.fillFunction, '首 chorus 段界 fn≠climax').not.toBe(FILL_FN_IDX.climax);
      const trajOf = (si: number) => (tc.expected.bars as Array<{ sectionIndex: number; trajectory: number }>)
        .filter((b) => b.sectionIndex === si).map((b) => b.trajectory);
      expect(trajOf(3).includes(TRAJ_IDX.arrival), '末 chorus 有 arrival').toBe(true);
      expect(trajOf(1).some((t) => t === TRAJ_IDX.arrival || t === TRAJ_IDX.peak),
        '首 chorus 不得被判为高潮（无 arrival/peak）').toBe(false);
    }
    const fb = byName.get('pop_basic_climax_fallback')!;
    expect(fb.input.hasClimaxMap, '未给 climaxMap → hasClimaxMap=false（C 侧自行回退末 chorus）').toBe(false);
    expect(fb.input.sections.every((s) => !s.hasClimax), '回退路径逐段 hasClimax 全 0').toBe(true);
    // 内部 cadence：fromSectionIndex==toSectionIndex 的 boundary
    expect(allBoundaries.some((b) => b.presence.includes('FROM') && b.fromSectionIndex === b.toSectionIndex),
      'internal cadence 覆盖').toBe(true);
    // 5/4 role cells + voiceDurations 池
    const jazz = byName.get('jazz_take_five_54_role_cells')!;
    expect(jazz.expected.rhythmCells.length, '5/4 rhythm cells 非空').toBeGreaterThan(0);
    expect(jazz.expected.voiceDurations.length, 'comp voiceDurations 非空').toBeGreaterThan(0);
    expect(jazz.expected.sections[1].roleRhythm.map((r) => r.id),
      'head54 三 role 全解析').toEqual([0, 1, 2]);
    expect(jazz.expected.sections[1].bassPattern, 'head54 bass ref=5').toBe(5);
    expect(jazz.expected.sections[2].bassPattern, 'solo54 jazz-walking pass-through=6').toBe(6);
    expect(jazz.expected.sections[0].roleRhythm.every((r) => r.id === ID_NONE),
      'intro54 无 role pattern → 全 NONE').toBe(true);
    // setup 抑制（allowSetupPickup=false）：intro54(idx0)→head54 段界须缺席
    expect(jazz.expected.boundaries.some((b) => b.presence.includes('FROM') && b.fromSectionIndex === 0
      && b.toSectionIndex === 1), 'take-five setup 段界须被 allowSetupPickup=false 抑制').toBe(false);
    // 5 拍合同：beatStrength 长 5
    const jazzBar0 = jazz.expected.bars[0] as { beatStrength: unknown[] };
    expect(jazzBar0.beatStrength.length, 'take-five 5 拍 accent').toBe(5);
    // 覆盖缺口记账（fail-closed）：以下两条**在生产域不可达**，故不覆盖也**不伪造**——
    //   ① boundary kind 'break'：boundaryKind() 只产 dropout/pickup/fill，无生产路径；
    //   ② contract.drum 缺省分支：v5 GROOVE_CONTRACT_POOL 21 合同**全部**有 drum。
    // 若哪天 KB 新增无 drum 合同，本断言转红，提醒补 fixture（而非静默留缺口）。
    for (const c of GROOVE_CONTRACT_POOL) {
      expect(c.drum !== undefined, `合同 ${c.id} 无 drum：drum 缺省分支已可达，须补 fixture`).toBe(true);
    }
    // boundaries 排序合同：sourceBar 非降；同 sourceBar 时 opening 在后
    for (const c of cases) {
      const bs = c.expected.boundaries;
      for (let i = 1; i < bs.length; i++) {
        expect(bs[i - 1].sourceBar <= bs[i].sourceBar, `${c.name}: boundaries sourceBar 非降`).toBe(true);
        if (bs[i - 1].sourceBar === bs[i].sourceBar)
          expect(Number(bs[i - 1].opening) <= Number(bs[i].opening), `${c.name}: 同 sourceBar opening 在后`).toBe(true);
      }
    }

    const out = {
      meta: {
        layer: 'groove score plan golden (planGrooveScore raw)',
        schemaVersion: SCHEMA_VERSION,
        generator: EXPORTER_REL,
        exporterSha,
        engineBaseCommit: ENGINE_BASE_COMMIT,
        specAnchor: SPEC_ANCHOR,
        note: '手构造 fixtures 直调生产 planGrooveScore；(输入,期望 plan) 成对冻结，供 P2-4c 步4/5 的 '
          + 'C afe_plan_groove_score 逐位对账。emission 序合同见 exporter 头注（sections=声明序 / '
          + 'bars=段序×段内序 / boundaries=稳定 sort(sourceBar,opening) / fill_hits=排序后 boundary 序 / '
          + 'rhythm_cells=段序×role(bass,comp,lead)×cell 序 / voice_durations=cell 序）。量化 round-half-up；'
          + '*RawBits=量化前 binary64 位型（转换器做 tie-margin 自检）。诊断字段 diagId/recipeId 不入 C struct。',
        // 量化刀锋清单：x*1000 小数部分**恰为 0.5** 的全部落点（round-half-up 方向唯一决定结果）。
        // 步4/5 的 C 实现必须在这些点上复现 half→+∞；转换器 --selftest 对本清单做 fail-closed 复算。
        quantizationTies: TIES,
        // 两类分开记账（Codex 步3 首轮 F4）：**不可达** = 生产域没有产生该状态的路径，伪造它等于
        // 给 C 立一个真源里不存在的合同；**延后** = 可达但按任务边界归后续步骤的独立靶。
        coverageGaps: [
          "[不可达] boundary kind 'break'：boundaryKind()(planner:331-340) 只产 dropout/pickup/fill——"
            + '生产域无路径，不伪造',
          '[不可达] contract.drum 缺省分支：v5 GROOVE_CONTRACT_POOL 21 合同全部有 drum（exporter 断言'
            + '看守，一旦 KB 新增无 drum 合同即转红要求补 fixture）',
          '[不可达] opening_section_index ≠ 0：planOpeningBoundary(planner:405-438) **只看 sections[0]**，'
            + '完全不读 opening.sectionId；且生产侧 openingGesturePlanner.ts:158 恒填首段 id。'
            + '故不构造错位输入（C 侧亦须用 sections[0]，勿以 opening_section_index 为准）',
          "[不可达] snareFollow='lead-accents'：v5 21 合同全部用 backbeat 或 comping，无人使用该值"
            + '（exporter 断言看守，一旦 KB 启用即转红要求补 fixture）',
          '[延后·可达] fill 60-recipe 全量 materialize（15 cell × 4 orch 的 hits/velocity 浮点链）：'
            + '本 golden 只覆盖 fixtures 触达的少数 recipe，全量对账归 P2-4c 步5 独立靶',
        ],
        emissionOrder: {
          sections: '输入声明序',
          bars: '段序 × barInSection',
          boundaries: '稳定 sort(sourceBar, opening)：段界(段序) → opening → internal cadence(段序×段内序)',
          fillHits: '排序后 boundary 序 × hit 序',
          rhythmCells: '段序 × role(bass,comp,lead) × cell 序',
          voiceDurations: 'rhythmCells 序 × 元素序',
        },
      },
      cases,
    };
    assertJsonSafe(out, 'root');
    writeFileSync(OUT, JSON.stringify(out, null, 1));
    expect(readFileSync(OUT, 'utf-8').length).toBeGreaterThan(0);
  });
});
