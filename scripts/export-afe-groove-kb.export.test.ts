// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-groove-kb — Groove Score KB owner 前置切片 exporter（P2-4c 步1；方案 A 独立）
// ------------------------------------------------------------
// planGrooveScore（v5 净新写，P2-4c）依赖 4 个「owner 尚未落地但已被引用」的只读 KB 切片。
// 用户裁决 2026-07-24：允许 owner 只读 KB 前置切片，owner 名义唯一、后续 owner 任务只补
// planner/render 不重建 KB（解 P2 依赖死结）。本 exporter 从**生产 exported API** 物化 4 切片
// → core/data/src/groove/afe_groove_kb.json（frozen 生产数据源）：
//   ① drum-pattern-family registry（owner=P2-10A）：GROOVE_CONTRACT_POOL 全 drum 的
//      timekeeper/lift/pickup/breakdown family distinct 集（首现序）+ HALFTIME/MINIMAL 派生 flags
//      （替代 grooveScorePlanner.structuralSnareBeats 的运行时 `.includes('halftime'/'minimal')` 子串扫描）。
//   ② fill vocabulary（owner=P2-10A-b）：pop-rock-60-v1 的 60 recipe（15 cell × 4 orch）注册表
//      + function→canonicalClass/combinations 映射（materialization 算法/cell steps·accents 归 P2-4c 步5）。
//   ③ 5/4 role-rhythm KB（owner=P2J-b）：Take-Five bass ostinato / comp interlock / lead phrase marker。
//   ④ texture-case registry（owner=P2-8a）：contract preferred/allowed/forbidden textureCases distinct 池（首现序）。
// 引擎源零触碰纪律：只在 scripts/；4 切片全由生产 KB API 物化，不改 src/（不 export 私有常量）。
// provenance：静态字段（无动态 HEAD/dirty；非 parity patch）；tooling pin 由 G6 机器锁负责，
//   Python 转换器 gen_groove_kb.py 逐字段精确锁 schema + exporterSha + engineBaseCommit + specAnchor。
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-groove-kb.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as ts from 'typescript';

import {
  GROOVE_CONTRACT_POOL,
  GROOVE_RHYTHM_PROFILES,
  grooveRhythmProfileForContract,
  type GrooveDrumIntent,
  type GrooveRhythmProfileId,
} from '../src/core/generation/newEngine/knowledge/grooveContracts';
import {
  POP_ROCK_FILL_VOCABULARY_ID,
  POP_ROCK_FILL_ORCHESTRATIONS,
  popRockFillRecipeDescriptors,
  popRockRhythmClassForFunction,
  popRockFillCombinationsForFunction,
  type GrooveDrumFillFunction,
  type GrooveDrumFillRhythmClass,
  type GrooveDrumFillOrchestration,
} from '../src/core/generation/newEngine/knowledge/drumFillVocabulary';
import {
  ROLE_RHYTHM_PATTERN_IDS,
  roleRhythmPattern,
} from '../src/core/generation/newEngine/knowledge/roleRhythmPatterns';

const SCHEMA_VERSION = 'groove_kb_v2';  // v2: +拆步2 contract KB + rhythm_profile
const ENGINE_BASE_COMMIT = 'fb33e9eaa74cee6a1c882b3d710391e969e0462e'; // Newengine_Demo-v5.0 规格锚（非工装 pin）
const SPEC_ANCHOR = 'Newengine_Demo-v5.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const EXPORTER_REL = 'scripts/export-afe-groove-kb.export.test.ts';
const OUT_DIR = join(HERE, '..', '..', 'core', 'data', 'src', 'groove');
const OUT = join(OUT_DIR, 'afe_groove_kb.json');

// GrooveDrumFillFunction union 声明序（drumFillVocabulary.ts:22-28）——function→class/combinations 键序锚。
const FILL_FUNCTIONS = [
  'opening', 'continuation', 'setup', 'lift', 'climax', 'release',
] as const satisfies readonly GrooveDrumFillFunction[];
const FILL_RHYTHM_CLASSES = [
  'straight-sixteenth', 'broken-sixteenth', 'syncopated-sixteenth',
] as const satisfies readonly GrooveDrumFillRhythmClass[];
const FILL_ORCHESTRATIONS = [
  'snare', 'snare-tom-cascade', 'descending-toms', 'linear-hand-foot',
] as const satisfies readonly GrooveDrumFillOrchestration[];

/** 递归拒绝非 JSON 值（function/undefined/NaN/Inf/Map/Set）——序列化前 fail-closed（同 export-afe-band）。 */
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

function createHashHex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

// ---- rational 提取（role-rhythm cell；AST 源码字面 + 运行时 float 双校验）----
// roleRhythmPatterns.ts cell 的 phase/duration 是有理数字面（`86 / 192` 等，运行时=binary64 有损）。
// G1 afe_groove_rational_t{int16 num;uint16 den} 存**约分**分数（phaseBeats=157/96）。从源码 AST 取字面
// num/den（NumericLiteral / a/b / -a），约分（den>0/负号仅 num），并断言约分后 == 运行时 float（fail-closed）。
const ROLE_RHYTHM_SRC = join(
  HERE, '..', 'src', 'core', 'generation', 'newEngine', 'knowledge', 'roleRhythmPatterns.ts');

// PATTERNS computed-key 的常量标识符名（声明序）——显式绑定 ROLE_RHYTHM_PATTERN_IDS[idx]，
// 结构错位/重排即抛（Codex 实现门 F5：不再仅按位置静默绑定）。
const EXPECTED_PATTERN_KEY_IDENTS = [
  'BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID',
  'COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID',
  'LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID',
] as const;

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

/** 源码数值字面表达式 → rational（NumericLiteral / <int>/<int> / -<int>；否则 fail-closed）。 */
function nodeToRational(node: ts.Expression): Rational {
  if (ts.isNumericLiteral(node)) return reduceRational(Number(node.text), 1);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken
      && ts.isNumericLiteral(node.operand)) return reduceRational(-Number(node.operand.text), 1);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.SlashToken
      && ts.isNumericLiteral(node.left) && ts.isNumericLiteral(node.right))
    return reduceRational(Number(node.left.text), Number(node.right.text));
  throw new Error(`role-rhythm 数值字面须 NumericLiteral / a/b / -a（fail-closed）: ${node.getText()}`);
}

/** AST 提取 PATTERNS 每 pattern 的 cells 字面 rational（按声明序，= ROLE_RHYTHM_PATTERN_IDS 序）。 */
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
  // fail-closed：PATTERNS property 数须 == ROLE_RHYTHM_PATTERN_IDS 数（结构演进/spread 插入即抛，非静默错位）
  if (patternsObj.properties.length !== ROLE_RHYTHM_PATTERN_IDS.length)
    throw new Error(`PATTERNS property 数 ${patternsObj.properties.length} ≠ ${ROLE_RHYTHM_PATTERN_IDS.length}（fail-closed）`);
  const out = new Map<string, Array<Record<string, Rational | Rational[]>>>();
  patternsObj.properties.forEach((prop, idx) => {
    // 非 PropertyAssignment/computed-key/ObjectLiteral value 一律抛（非静默 return）
    if (!ts.isPropertyAssignment(prop) || !ts.isComputedPropertyName(prop.name)
        || !ts.isObjectLiteralExpression(prop.initializer))
      throw new Error(`PATTERNS[${idx}] 非 computed-key PropertyAssignment/ObjectLiteral value（fail-closed）`);
    // computed key 的 Identifier 名须 == ROLE_RHYTHM_PATTERN_IDS[idx] 对应常量名（声明序绑定显式化；
    //   运行时 float 校验再兜底值层错位）
    const keyExpr = prop.name.expression;
    if (!ts.isIdentifier(keyExpr) || keyExpr.text !== EXPECTED_PATTERN_KEY_IDENTS[idx])
      throw new Error(`PATTERNS[${idx}] computed key ${keyExpr.getText()} ≠ ${EXPECTED_PATTERN_KEY_IDENTS[idx]}（fail-closed）`);
    const patId = ROLE_RHYTHM_PATTERN_IDS[idx];
    const cellsProp = prop.initializer.properties.find(
      (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'cells');
    if (!cellsProp) {
      out.set(patId, []);  // lead grammar-marker 无 cells
      return;
    }
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

/** 约分 rational → 校验其值 == 运行时 float（binary64 恒等，否则 AST 错位/字面错，fail-closed）。 */
function assertRatEqFloat(r: Rational, f: number, label: string): void {
  expect(r.num / r.den, `${label}: rational ${r.num}/${r.den} ≠ 运行时 ${f}`).toBe(f);
}

// ============================================================
// 拆步2：全量 v5 contract KB + rhythm_profile（对锁 G1 afe_groove.h afe_groove_contract_t）
// ============================================================
// v5 enum 局部序（对齐 afe_groove.h / afe_p2org.h afe_style_t 冻结值；转换器/C 测试对锁）
const STYLE_IDX: Record<string, number> = { POP: 0, JAZZ: 1, LOFI: 2, RNB: 3, ACG: 4, BLUES: 5 };
const GRID_IDX: Record<string, number> = { straight: 0, swing: 1, shuffle: 2, dilla: 3, rubato: 4 };
const DENSITY_IDX: Record<string, number> = { sparse: 0, medium: 1, active: 2 };
const ARTIC_IDX: Record<string, number> = { legato: 0, short: 1, bebop: 2, ballad: 3 };
const SWING_SRC_IDX: Record<string, number> = { 'straight-eighths': 0, 'straight-sixteenths': 1, authored: 2 };
const SWING_CURVE_IDX: Record<string, number> = { fixed: 0, 'jazz-tempo': 1 };
const BAR_ORIGIN_IDX: Record<string, number> = { 'song-global': 0 };
const LANDING_IDX: Record<string, number> = { none: 0, kick: 1, 'kick-crash': 2, ride: 3, 'kick-ride': 4 };
const KICK_FOLLOW_IDX: Record<string, number> = { pulse: 0, bass: 1 };
const SNARE_FOLLOW_IDX: Record<string, number> = { backbeat: 0, 'lead-accents': 1, comping: 2 };
const FILL_FAMILY_IDX: Record<string, number> = {
  'pop-tom-build': 0, 'pop-snare-pickup': 1, 'motown-tom-bridge': 2, 'rnb-pocket-turn': 3,
  'rnb-gospel-triplet': 4, 'trap-snare-roll': 5, 'lofi-one-shot': 6, 'jazz-triplet-setup': 7,
  'jazz-bossa-cross-stick': 8,
};
const PHASE_LANE_IDX: Record<string, number> = {
  quarter: 0, 'triplet-late': 1, 'authored-61-96': 2, 'development-5-8': 3,
  'straight-sixteenth': 4, 'lead-thirtieth-bar-cell': 5,
};
const RHYTHM_PROFILE_IDX: Record<string, number> = {
  'pop-straight': 0, 'pop-ballad': 1, 'rnb-sixteenth': 2, 'rnb-triplet': 3, 'lofi-pocket': 4,
  'jazz-swing': 5, 'jazz-five-four-triplet': 6, 'jazz-bossa': 7, 'rubato-four': 8,
};
const SUBDIVISION_IDX: Record<string, number> = { eighth: 0, sixteenth: 1, triplet: 2 };
const BAR_ROLE_IDX: Record<string, number> = { base: 0, answer: 1, lift: 2, turnaround: 3, breakdown: 4 };
const BASE_MASK_IDX: Record<string, number> = { keep: 0, 'mask-window': 1, 'replace-bar': 2 };
const BASS_PATTERN_IDX: Record<string, number> = {
  rnb_neo_soul_sparse: 0, dilla_pocket: 1, rnb_gospel_triplet: 2, rnb_motown_syncopated: 3,
  rnb_trap_soul_halftime: 4, 'bass.jazz-five-four-ostinato.v1': 5,
};
const CONTRACT_ID_IDX: Record<string, number> = {
  jazz_combo_swing: 0, jazz_take_five_5_4: 1, pop_radio_straight: 2, pop_citypop_boogie: 3,
  pop_jpop_push_8ths: 4, pop_ballad_halftime: 5, lofi_lazy_dilla: 6, lofi_tape_late_chords: 7,
  lofi_halftime_dusty: 8, rnb_neo_soul_laidback: 9, rnb_dilla_pocket: 10, rnb_gospel_triplet: 11,
  rnb_motown_backbeat: 12, rnb_trap_soul_halftime: 13, jazz_smooth_backbeat: 14, jazz_medium_swing: 15,
  jazz_ballad_loose: 16, jazz_bossa_straight_latin: 17, acg_hisaishi_rubato_arp: 18,
  acg_planing_wash: 19, acg_jpop_456_drive: 20,
};

const FILL_VOCAB_IDX: Record<string, number> = { 'pop-rock-60-v1': 0 };  // afe_groove_fill_vocab_id_t

function _lk(map: Record<string, number>, key: string, what: string): number {
  if (!(key in map)) throw new Error(`未知 ${what}: ${key}（fail-closed）`);
  return map[key];
}

// 量化（afe_groove.h 数值制度；round-half-up = Math.round tie→+∞，设计门分叉5）
const permille = (x: number): number => Math.round(x * 1000);      // afe_permille_t [0,1]×1000
const milliRatio = (x: number): number => Math.round(x * 1000);    // afe_milli_ratio_t ratio×1000
const swingPermille = (x: number): number => Math.round(x * 1000); // afe_swing_permille_t
const weightHalf = (x: number): number => Math.round(x * 2);       // weight×2

/** AST：grooveContracts.ts 每个 contract（有 id）的 tempoBpm 字面 → 精确 rational（take-five=60000000/359281；
 * 整数 bpm=n/1）。afe_groove_tempo_ratio_t{uint32 num,den}。运行时 float 校验兜底。 */
function extractTempoRationals(): Map<string, Rational> {
  const srcPath = join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'knowledge', 'grooveContracts.ts');
  const sf = ts.createSourceFile('grooveContracts.ts', readFileSync(srcPath, 'utf-8'), ts.ScriptTarget.ES2020, true);
  const out = new Map<string, Rational>();
  const visit = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n)) {
      let idVal: string | undefined;
      let tempoNode: ts.Expression | undefined;
      for (const p of n.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
        if (p.name.text === 'id' && ts.isStringLiteral(p.initializer)) idVal = p.initializer.text;
        if (p.name.text === 'tempoBpm') tempoNode = p.initializer;
      }
      if (idVal !== undefined && tempoNode !== undefined) out.set(idVal, nodeToRational(tempoNode));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

// ---- ① drum-pattern-family registry（owner=P2-10A）----
// 消费方 grooveScorePlanner.familyForBar 读 contract.drum 的 timekeeper/lift/pickup/breakdown（此声明序）。
// canonical id = distinct family 首现序（POOL 序 × 四字段声明序）。flags = 生产逻辑
// structuralSnareBeats(planner:186) 的 `family.includes('halftime') / .includes('minimal')` 忠实派生。
interface DrumFamilyEntry { id: number; name: string; halftime: boolean; minimal: boolean; }
function buildDrumPatternFamilies(): DrumFamilyEntry[] {
  const seen = new Set<string>();
  const out: DrumFamilyEntry[] = [];
  for (const c of GROOVE_CONTRACT_POOL) {
    const d = c.drum;
    if (!d) continue;
    for (const fam of [d.timekeeperFamily, d.liftFamily, d.pickupFamily, d.breakdownFamily]) {
      if (fam == null || seen.has(fam)) continue;
      seen.add(fam);
      out.push({ id: out.length, name: fam, halftime: fam.includes('halftime'), minimal: fam.includes('minimal') });
    }
  }
  return out;
}

// ---- ④ texture-case registry（owner=P2-8a）----
// distinct textureCase 首现序（POOL 序 × preferred→allowed→forbidden × 数组内序）。groove 侧 [off,count]
// 引本池；owner=P2-8a 落地时复用不重建/不重编号（afe_foreign_ids.h:afe_texture_case_id_t 落点）。
interface TextureCaseEntry { id: number; name: string; }
function buildTextureCases(): TextureCaseEntry[] {
  const seen = new Set<string>();
  const out: TextureCaseEntry[] = [];
  for (const c of GROOVE_CONTRACT_POOL) {
    for (const arr of [c.preferredTextureCases, c.allowedTextureCases, c.forbiddenTextureCases]) {
      if (!arr) continue;
      for (const name of arr) {
        if (seen.has(name)) continue;
        seen.add(name);
        out.push({ id: out.length, name });
      }
    }
  }
  return out;
}

// ---- ② fill vocabulary（owner=P2-10A-b）----
function buildFillVocabulary() {
  const recipes = popRockFillRecipeDescriptors().map((d, i) => ({
    id: i, recipeId: d.recipeId, rhythmClass: d.rhythmClass, orchestration: d.orchestration,
  }));
  const functionCanonicalClass = FILL_FUNCTIONS.map((fn) => ({
    function: fn, rhythmClass: popRockRhythmClassForFunction(fn),
  }));
  const functionCombinations = FILL_FUNCTIONS.map((fn) => ({
    function: fn,
    combinations: popRockFillCombinationsForFunction(fn).map((x) => ({
      rhythmClass: x.rhythmClass, orchestration: x.orchestration,
    })),
  }));
  return {
    ownerTask: 'P2-10A-b',
    vocabularyId: POP_ROCK_FILL_VOCABULARY_ID,
    orchestrations: POP_ROCK_FILL_ORCHESTRATIONS.slice(),
    rhythmClasses: FILL_RHYTHM_CLASSES.slice(),
    functions: FILL_FUNCTIONS.slice(),
    recipes,
    functionCanonicalClass,
    functionCombinations,
  };
}

// ---- ③ 5/4 role-rhythm KB（owner=P2J-b）----
// phase/duration 存约分 rational（AST 源码字面 + 运行时 float 校验），对齐 G1 afe_groove_rational_t。
// velocity=MIDI 整数。lead=grammar-marker 无 cells。
function buildRoleRhythm() {
  const literals = extractRoleRhythmCellLiterals();
  const patterns = ROLE_RHYTHM_PATTERN_IDS.map((id) => {
    const p = roleRhythmPattern(id);
    if (!p) throw new Error(`role-rhythm pattern 缺失: ${id}`);
    const base = {
      id: p.id, role: p.role, beatsPerBar: p.beatsPerBar,
      realization: p.realization, sourceKind: p.source.kind, sourceSha256: p.source.sha256,
    };
    if (p.role === 'bass' || p.role === 'comp') {
      const lit = literals.get(id) ?? [];
      if (lit.length !== p.cells.length)
        throw new Error(`${id}: AST cell 数 ${lit.length} ≠ 运行时 ${p.cells.length}`);
      const cells = p.cells.map((c, i) => {
        const L = lit[i];
        const phase = L.phaseBeats as Rational;
        const dur = L.durationBeats as Rational;
        assertRatEqFloat(phase, c.phaseBeats, `${id}[${i}].phaseBeats`);
        assertRatEqFloat(dur, c.durationBeats, `${id}[${i}].durationBeats`);
        if (p.role === 'bass') {
          return { phaseBeats: phase, durationBeats: dur, velocity: (c as { velocity: number }).velocity };
        }
        const cc = c as { velocity: number; voiceAction: string; voiceDurationBeats?: readonly number[] };
        let voiceDur: Rational[] | null = null;
        if (cc.voiceDurationBeats) {
          const vlit = L.voiceDurationBeats as Rational[] | undefined;
          if (!vlit || vlit.length !== cc.voiceDurationBeats.length)
            throw new Error(`${id}[${i}].voiceDurationBeats: AST/运行时 长度不符`);
          vlit.forEach((r, k) => assertRatEqFloat(r, cc.voiceDurationBeats![k], `${id}[${i}].voiceDur[${k}]`));
          voiceDur = vlit;
        }
        return {
          phaseBeats: phase, durationBeats: dur, velocity: cc.velocity,
          voiceAction: cc.voiceAction, voiceDurationBeats: voiceDur,
        };
      });
      return { ...base, cells };
    }
    // lead：grammar-marker（无 onset cells，保留 phrase-grammar 标记）
    return {
      ...base,
      grammarMarker: p.grammarMarker,
      useGlobalBarOrigin: p.useGlobalBarOrigin,
      preserveIntentionalRests: p.preserveIntentionalRests,
      subdivisionGrammar: p.subdivisionGrammar,
    };
  });
  return { ownerTask: 'P2J-b', patterns };
}

// ---- 拆步2: drum intent / contract KB / rhythm_profile 投影（量化 + presence + 外键 id）----
function buildDrumIntent(d: GrooveDrumIntent, drumFamByName: Map<string, number>) {
  const famId = (name: string): number => {
    const id = drumFamByName.get(name);
    if (id === undefined) throw new Error(`drum family 未在 registry: ${name}`);
    return id;
  };
  return {
    kitProgram: d.kitProgram,
    timekeeperFamily: famId(d.timekeeperFamily),
    liftFamily: d.liftFamily != null ? famId(d.liftFamily) : null,
    pickupFamily: d.pickupFamily != null ? famId(d.pickupFamily) : null,
    breakdownFamily: d.breakdownFamily != null ? famId(d.breakdownFamily) : null,
    fillLight: _lk(FILL_FAMILY_IDX, d.fillFamilies.light, 'fill family'),
    fillStrong: _lk(FILL_FAMILY_IDX, d.fillFamilies.strong, 'fill family'),
    fillPickup: _lk(FILL_FAMILY_IDX, d.fillFamilies.pickup, 'fill family'),
    fillVocabulary: d.fillVocabulary != null ? _lk(FILL_VOCAB_IDX, d.fillVocabulary, 'fill vocab') : null,
    landing: _lk(LANDING_IDX, d.landing, 'landing'),
    kickFollow: _lk(KICK_FOLLOW_IDX, d.kickFollow, 'kick follow'),
    snareFollow: _lk(SNARE_FOLLOW_IDX, d.snareFollow, 'snare follow'),
    hasLift: d.liftFamily != null, hasPickup: d.pickupFamily != null,
    hasBreakdown: d.breakdownFamily != null, hasFillVocabulary: d.fillVocabulary != null,
  };
}

function buildContractKb(drumFamByName: Map<string, number>, texByName: Map<string, number>) {
  const tempoRat = extractTempoRationals();
  const texRefs = (arr: readonly string[] | undefined): number[] =>
    (arr ?? []).map((name) => {
      const id = texByName.get(name);
      if (id === undefined) throw new Error(`contract texture ref 未在 registry: ${name}`);
      return id;
    });
  const contracts = GROOVE_CONTRACT_POOL.map((c) => {
    const presence: string[] = [];
    let meter: { num: number; den: number } | null = null;
    if (c.meter) { meter = { num: c.meter.numerator, den: c.meter.denominator }; presence.push('METER'); }
    let barOriginPolicy: number | null = null;
    if (c.barOriginPolicy) { barOriginPolicy = _lk(BAR_ORIGIN_IDX, c.barOriginPolicy, 'bar origin'); presence.push('BAR_ORIGIN'); }
    const phaseLanes = (c.phaseLanes ?? []).map((pl) => ({
      id: pl.id, idx: _lk(PHASE_LANE_IDX, pl.id, 'phase lane'),
      offset: reduceRational(pl.offset.numerator, pl.offset.denominator),
    }));
    let tempoBpm: { num: number; den: number } | null = null;
    if (c.tempoBpm !== undefined) {
      const tr = tempoRat.get(c.id);
      if (!tr) throw new Error(`tempo AST 缺: ${c.id}`);
      assertRatEqFloat(tr, c.tempoBpm, `${c.id}.tempoBpm`);
      tempoBpm = { num: tr.num, den: tr.den }; presence.push('TEMPO');
    }
    let tempoRange: number | null = null;
    if (c.tempoRange !== undefined) { tempoRange = c.tempoRange; presence.push('TEMPO_RANGE'); }
    let rhythmProfile: number | null = null;
    if (c.rhythmProfile) { rhythmProfile = _lk(RHYTHM_PROFILE_IDX, c.rhythmProfile, 'rhythm profile'); presence.push('RHYTHM_PROFILE'); }
    const eff = grooveRhythmProfileForContract(c);
    const effId = (Object.keys(GROOVE_RHYTHM_PROFILES) as GrooveRhythmProfileId[]).find((k) => GROOVE_RHYTHM_PROFILES[k] === eff);
    if (!effId) throw new Error(`effective profile 反查失败: ${c.id}`);
    let rhythmSwingSource: number | null = null;
    if (c.rhythmSwingSource) { rhythmSwingSource = _lk(SWING_SRC_IDX, c.rhythmSwingSource, 'swing src'); presence.push('RHYTHM_SWING'); }
    let swingCurve: number | null = null;
    if (c.swingCurve) { swingCurve = _lk(SWING_CURVE_IDX, c.swingCurve, 'swing curve'); presence.push('SWING_CURVE'); }
    let pushProbability: number | null = null;
    if (c.pushProbability !== undefined) { pushProbability = permille(c.pushProbability); presence.push('PUSH'); }
    let bassPattern: number | null = null;
    if (c.bassPattern) { bassPattern = _lk(BASS_PATTERN_IDX, c.bassPattern, 'bass pattern'); presence.push('BASS_PATTERN'); }
    let drum = null;
    if (c.drum) { drum = buildDrumIntent(c.drum, drumFamByName); presence.push('DRUM'); }
    return {
      id: c.id, idEnum: _lk(CONTRACT_ID_IDX, c.id, 'contract id'),
      styleName: c.style, style: _lk(STYLE_IDX, c.style, 'style'),
      weightHalf: weightHalf(c.weight),
      meter, beatGrouping: c.beatGrouping ? c.beatGrouping.slice() : [],
      barOriginPolicy, phaseLanes, tempoBpm, tempoRange,
      grid: _lk(GRID_IDX, c.grid, 'grid'), density: _lk(DENSITY_IDX, c.density, 'density'),
      rhythmProfile, effectiveRhythmProfile: _lk(RHYTHM_PROFILE_IDX, effId, 'eff profile'),
      compSwing: swingPermille(c.compSwingRatio), melodySwing: swingPermille(c.melodySwingRatio),
      rhythmSwingSource, swingCurve,
      bassPocketMs: c.bassPocketMs.slice(), chordPocketMs: c.chordPocketMs.slice(),
      melodyStrongPocketMs: c.melodyStrongPocketMs.slice(), melodyWeakPocketMs: c.melodyWeakPocketMs.slice(),
      velocityHumanize: permille(c.velocityHumanize),
      accentPattern: c.accentPattern.map((x) => milliRatio(x)),
      articulation: _lk(ARTIC_IDX, c.articulation, 'artic'),
      drum, pushProbability, bassPattern,
      preferredTextureCases: texRefs(c.preferredTextureCases),
      allowedTextureCases: texRefs(c.allowedTextureCases),
      forbiddenTextureCases: texRefs(c.forbiddenTextureCases),
      presence: presence.slice().sort(),
    };
  });
  return { ownerTask: 'P2-4', poolOrder: contracts.map((c) => c.idEnum), contracts };
}

function buildRhythmProfiles() {
  const profiles = (Object.keys(GROOVE_RHYTHM_PROFILES) as GrooveRhythmProfileId[]).map((id) => {
    const p = GROOVE_RHYTHM_PROFILES[id];
    return {
      id, idx: _lk(RHYTHM_PROFILE_IDX, id, 'rhythm profile'),
      subdivision: _lk(SUBDIVISION_IDX, p.subdivision, 'subdivision'),
      subdivisionAccent: p.subdivisionAccent.map((x) => permille(x)),
      phraseShape: p.phraseShape.map((r) => _lk(BAR_ROLE_IDX, r, 'bar role')),
      phraseAccent: p.phraseAccent.map((x) => milliRatio(x)),
      transition: {
        lightBeatsQ: Math.round(p.transition.lightBeats * 2),
        strongBeatsQ: Math.round(p.transition.strongBeats * 2),
        openingPickupBeats: p.transition.openingPickupBeats,
        cadenceEveryBars: p.transition.cadenceEveryBars,
        allowSetupPickup: p.transition.allowSetupPickup,
        lightBaseMask: _lk(BASE_MASK_IDX, p.transition.lightBaseMask, 'base mask'),
        strongBaseMask: _lk(BASE_MASK_IDX, p.transition.strongBaseMask, 'base mask'),
      },
    };
  });
  return { ownerTask: 'P2-4', profiles };
}

describe('export afe groove KB owner 前置切片（P2-4c 步1）', () => {
  it('materializes 4 owner slices from production KB API', () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const exporterSha = createHashHex(readFileSync(join(HERE, 'export-afe-groove-kb.export.test.ts')));

    const drumPatternFamilies = buildDrumPatternFamilies();
    const textureCases = buildTextureCases();
    const fillVocabulary = buildFillVocabulary();
    const roleRhythm = buildRoleRhythm();
    const drumFamByName = new Map(drumPatternFamilies.map((f) => [f.name, f.id]));
    const texByName = new Map(textureCases.map((t) => [t.name, t.id]));
    const contract = buildContractKb(drumFamByName, texByName);
    const rhythmProfile = buildRhythmProfiles();

    // ---- 域自检（fail-closed；数值偶合防御，非依赖数据偶然满足）----
    // ① drum-family：至少 halftime/minimal 各命中；flags 与子串测试一致。
    expect(drumPatternFamilies.length, 'drum-family 非空').toBeGreaterThan(0);
    expect(drumPatternFamilies.filter((f) => f.halftime).length, 'HALFTIME 派生非空').toBeGreaterThan(0);
    expect(drumPatternFamilies.filter((f) => f.minimal).length, 'MINIMAL 派生非空').toBeGreaterThan(0);
    for (const f of drumPatternFamilies) {
      expect(f.halftime, `${f.name} halftime flag`).toBe(f.name.includes('halftime'));
      expect(f.minimal, `${f.name} minimal flag`).toBe(f.name.includes('minimal'));
    }
    expect(new Set(drumPatternFamilies.map((f) => f.name)).size, 'drum-family distinct').toBe(drumPatternFamilies.length);
    // ② fill：恰 60 recipe（15 cell × 4 orch）；recipe 域合法。
    expect(fillVocabulary.recipes.length, '60 recipe').toBe(60);
    expect(fillVocabulary.orchestrations.length, '4 orch').toBe(4);
    for (const r of fillVocabulary.recipes) {
      expect(FILL_RHYTHM_CLASSES).toContain(r.rhythmClass);
      expect(FILL_ORCHESTRATIONS).toContain(r.orchestration);
      expect(r.recipeId.startsWith(`${POP_ROCK_FILL_VOCABULARY_ID}:`), 'recipeId 前缀').toBe(true);
    }
    expect(new Set(fillVocabulary.recipes.map((r) => r.recipeId)).size, 'recipe distinct').toBe(60);
    // ③ role-rhythm：3 pattern，role 唯一。
    expect(roleRhythm.patterns.length, '3 role pattern').toBe(3);
    expect(roleRhythm.patterns.map((p) => p.role), 'role 序').toEqual(['bass', 'comp', 'lead']);
    for (const p of roleRhythm.patterns) expect(p.beatsPerBar, '5/4 拍').toBe(5);
    // ④ texture：非空 distinct。
    expect(textureCases.length, 'texture-case 非空').toBeGreaterThan(0);
    expect(new Set(textureCases.map((t) => t.name)).size, 'texture distinct').toBe(textureCases.length);
    // ⑤ contract KB（拆步2）：21 合同，poolOrder 长 21，idEnum distinct，drum kit 域。
    expect(contract.contracts.length, '21 合同').toBe(21);
    expect(contract.poolOrder.length, 'poolOrder 21').toBe(21);
    expect(new Set(contract.contracts.map((c) => c.idEnum)).size, 'contract idEnum distinct').toBe(21);
    for (const c of contract.contracts) {
      expect(c.accentPattern.length, `${c.id} accent 非空`).toBeGreaterThan(0);
      if (c.drum) {
        expect([8, 25, 40], `${c.id} kit program`).toContain(c.drum.kitProgram);
      }
    }
    const takeFive = contract.contracts.find((c) => c.id === 'jazz_take_five_5_4')!;
    expect(takeFive.meter, 'take-five 5/4').toEqual({ num: 5, den: 4 });
    expect(takeFive.tempoBpm !== null, 'take-five has tempo').toBe(true);
    expect(takeFive.phaseLanes.length, 'take-five 6 phase lanes').toBe(6);
    // ⑥ rhythm_profile：9 条。
    expect(rhythmProfile.profiles.length, '9 rhythm profile').toBe(9);

    const out = {
      meta: {
        layer: 'groove KB (owner 前置切片)',
        schemaVersion: SCHEMA_VERSION,
        generator: EXPORTER_REL,
        exporterSha,
        engineBaseCommit: ENGINE_BASE_COMMIT,
        specAnchor: SPEC_ANCHOR,
        note: 'planGrooveScore(P2-4c) 依赖的 4 owner 只读 KB 切片，从生产 exported API 物化；owner 名义唯一（drum-family=P2-10A / fill=P2-10A-b / role-rhythm=P2J-b / texture=P2-8a）后续复用不重建。canonical id=首现序；浮点经 JSON number round-trip 保 binary64（转换器 dbits 冻结位型）。',
      },
      drumPatternFamily: {
        ownerTask: 'P2-10A',
        note: 'distinct timekeeper/lift/pickup/breakdown family（首现序）；halftime/minimal=structuralSnareBeats 子串测试忠实派生。',
        families: drumPatternFamilies,
      },
      textureCase: {
        ownerTask: 'P2-8a',
        note: 'distinct preferred/allowed/forbidden textureCases（首现序）；groove 侧 [off,count] 引本池。',
        cases: textureCases,
      },
      fillVocabulary,
      roleRhythm,
      contract,
      rhythmProfile,
    };
    assertJsonSafe(out, 'root');
    writeFileSync(OUT, JSON.stringify(out, null, 1));
    expect(readFileSync(OUT, 'utf-8').length).toBeGreaterThan(0);
  });
});
