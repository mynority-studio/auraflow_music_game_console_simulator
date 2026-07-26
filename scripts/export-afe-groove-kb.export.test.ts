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
  drumKitCapability,
  drumKitPitchOrigin,
  projectDrumPitchForKit,
  type DrumKitProgram,
} from '../src/core/generation/newEngine/knowledge/drumKitCapabilities';
import {
  DRUM_FEEL_PROFILES,
  drumFeelProfile,
  drumFeelProfileIdForContract,
} from '../src/core/generation/newEngine/knowledge/drumPerformanceKnowledge';
import { timingSafetyForContract } from '../src/core/generation/newEngine/arranger/performanceContractPlanner';
import { rhythmSwingSourceForContract } from '../src/core/generation/newEngine/knowledge/grooveContracts';
import { planDrumPerformance } from '../src/core/generation/newEngine/arranger/drumPerformancePlanner';
import {
  ROLE_RHYTHM_PATTERN_IDS,
  roleRhythmPattern,
} from '../src/core/generation/newEngine/knowledge/roleRhythmPatterns';
import {
  GROOVE_BASS_PATTERN_IDS,
  JAZZ_WALKING_BASS_PATTERN_ID,
  grooveBassPattern,
} from '../src/core/generation/newEngine/knowledge/grooveBassPatterns';
import { materializePopRockFill } from '../src/core/generation/newEngine/knowledge/drumFillVocabulary';

const SCHEMA_VERSION = 'groove_kb_v5';  // v4: +P2-10A 步2 drum kit capability（3 kit 音高位图 + 投影）
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
/** 三方 family 真源的**精确相等门**（P2-10A 设计门首轮 #7；实现门首轮 #1 重写为**真 AST**）。
 *
 * ★ 初版用 `indexOf + slice + matchAll` 做文本匹配，却自称"AST 字面提取"——**那是假锁**：
 *   把 planner Set 里的 `'rnb-neo-soul'` 改成注释 `/* 'rnb-neo-soul' removed *\/`，
 *   源码依然合法、正则仍数出 27，而真实类型域已变成 26，生产 validDrumFamily 已不接受该 family。
 *   本版改用 TypeScript AST，并对每种节点形态 fail-closed（拒 spread / 非字符串字面 / 重复 /
 *   computed / method / 多次声明），杜绝"注释替身"与任意字符串补数。
 */
export function tsParse(text: string, name = 'x.ts'): ts.SourceFile {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.ES2020, true);
  if (sf.parseDiagnostics && sf.parseDiagnostics.length > 0) {
    throw new Error(`${name}: ${sf.parseDiagnostics.length} 条 parse diagnostic（fail-closed）`);
  }
  return sf;
}

/** 目标 const 的**用法白名单**（实现门三轮 #1）。
 *
 * ★ 上一版是**黑名单**：只对认得出的 mutation 形态抛，其余**静默放行**——于是
 *   `const alias = DRUM_PATTERN_FAMILIES as Set<string>; alias.delete('x')` 整条穿过
 *   （剥 as 后父节点是 VariableDeclaration 但不是它的 name，没有任何分支命中，也没有兜底 throw）。
 *   这与我在生产调用点门修过的"没找到即通过"是同一个病。
 *   本版改为**白名单**：目标标识符的每一处出现都必须落在**明确允许**的形态里，否则一律 fail-closed。
 *   `Object.assign(X, …)` / `X['k'] ||= v` / RHS 传递 / 实参 / return / 解构 / inc-dec 因此全部被拒。
 */
type UsageKind = 'set' | 'object';
function assertOnlyAllowedUsage(sf: ts.SourceFile, name: string, kind: UsageKind,
                                expectNonDeclRefs?: number): void {
  let nonDeclRefs = 0;
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === name) {
      // 剥掉 as / 括号 / ! 后，取"实际被使用"的那个节点
      let cur: ts.Node = n;
      while (cur.parent && (ts.isAsExpression(cur.parent) || ts.isParenthesizedExpression(cur.parent)
             || ts.isNonNullExpression(cur.parent) || ts.isTypeAssertionExpression(cur.parent))) {
        cur = cur.parent;
      }
      const p = cur.parent;
      const bad = (why: string): never => {
        throw new Error(`${name}: 不允许的用法——${why}（白名单外一律 fail-closed）`);
      };
      if (!p) bad('孤立标识符');
      // ① 声明处本身
      else if (ts.isVariableDeclaration(p) && p.name === n) { /* ok */ }
      // ② 只读用法（按 kind 分别放行）
      else if (kind === 'set' && ts.isPropertyAccessExpression(p) && p.expression === cur) {
        const asCallee = p.parent && ts.isCallExpression(p.parent) && p.parent.expression === p;
        if (p.name.text !== 'has' || !asCallee) bad(`Set 只允许 .has(...) 只读调用，实得 .${p.name.text}`);
      } else if (kind === 'object' && ts.isElementAccessExpression(p) && p.expression === cur) {
        // ★★ **正向契约**（五轮 #1）：不再维护"拒绝清单"——那是无穷尽的
        //   （已被 __defineGetter__、__proto__ 链式、for-in 左值逐个打穿）。
        //   改为只接受**生产中实际存在的唯一读取形态**：
        //       const variants = DRUM_PERFORMANCE_FAMILIES[expr];   // grooves.ts:383
        //   即：终端 ElementAccess（不是 PropertyAccess）→ 直接作为 **const 声明的 initializer**。
        //   其余一切上下文（for-in 左值、方法调用、链式、赋值、实参、return…）由兜底拒绝。
        let node: ts.Node = p;
        while (node.parent && (ts.isAsExpression(node.parent) || ts.isParenthesizedExpression(node.parent)
               || ts.isNonNullExpression(node.parent))) node = node.parent;
        const w = node.parent;
        const isConstInit = w && ts.isVariableDeclaration(w) && w.initializer === node
          && w.parent && ts.isVariableDeclarationList(w.parent)
          && (w.parent.flags & ts.NodeFlags.Const) !== 0;
        if (!isConstInit) {
          bad(`对象成员访问只允许「const 声明的 initializer」这一种生产形态，`
            + `实得父节点 ${w ? ts.SyntaxKind[w.kind] : '<none>'}`);
        }
        // ★ 还要锁**索引表达式的形态**（六轮 #1）：仅 const-initializer 不够——
        //   `const x = X['__proto__']` 同样命中，而 patternFamily 是可选 string，
        //   静态排除不了 '__proto__'。生产唯一形态是 `X[expr ?? '']`（grooves.ts:383），
        //   故索引必须是 `??` 二元表达式，字面量/裸标识符一律拒。
        // ★ 索引 matcher 必须匹配**完整生产 AST**（七轮 #1）：只锁 `?? ` 不够——
        //   `X[k ?? '']` 里 k 任意，运行时若为 '__proto__' 取回的是原型对象，
        //   随后 `variants.c = 3` 即污染原型、等效改变 realizer 键集（Codex 已机器复现）。
        //   生产唯一形态（grooves.ts:382-383）：
        //     export function drumPerformanceVariants(performance: DrumPerformanceLike) {
        //       const variants = DRUM_PERFORMANCE_FAMILIES[performance.patternFamily ?? ''];
        const idx = p.argumentExpression;
        if (!idx || !ts.isBinaryExpression(idx)
            || idx.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken) {
          bad(`索引表达式须为生产形态 \`performance.patternFamily ?? ''\`，实得 `
            + `${idx ? ts.SyntaxKind[idx.kind] : '<none>'}`);
        }
        const lhs = idx.left, rhs = idx.right;
        if (!ts.isPropertyAccessExpression(lhs) || !ts.isIdentifier(lhs.expression)
            || lhs.expression.text !== 'performance' || lhs.name.text !== 'patternFamily') {
          bad(`索引左侧须精确为 \`performance.patternFamily\`，实得 ${lhs.getText()}`);
        }
        if (!ts.isStringLiteral(rhs) || rhs.text !== '') {
          bad(`索引右侧须精确为空字符串字面量，实得 ${rhs.getText()}`);
        }
        // 声明名与所在函数亦锁死（唯一生产引用的完整上下文）
        const decl = w as ts.VariableDeclaration;
        if (!ts.isIdentifier(decl.name) || decl.name.text !== 'variants') {
          bad(`声明名须为 \`variants\`，实得 ${decl.name.getText()}`);
        }
        let fn: ts.Node | undefined = decl;
        while (fn && !ts.isFunctionDeclaration(fn)) fn = fn.parent;
        if (!fn || !(fn as ts.FunctionDeclaration).name
            || (fn as ts.FunctionDeclaration).name!.text !== 'drumPerformanceVariants') {
          bad('唯一生产引用须位于函数 `drumPerformanceVariants` 内');
        }
        nonDeclRefs++;
      } else {
        bad(`出现在 ${ts.SyntaxKind[p.kind]} 位置（RHS 传递 / 实参 / return / 解构 / Object.assign 等均不允许）`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  // 引用计数锁：生产中该符号的**非声明引用恰 N 处**——多一处就是新增了未经审的用法
  if (expectNonDeclRefs !== undefined && nonDeclRefs !== expectNonDeclRefs) {
    throw new Error(`${name}: 非声明引用 ${nonDeclRefs} 处 != 冻结 ${expectNonDeclRefs}（fail-closed）`);
  }
}

/** 声明链**精确**锁为 VariableDeclaration → VariableDeclarationList → VariableStatement → SourceFile。
 *  上一版只查"祖父是 SourceFile"，会错误接受 `for (const X = new Set([...]); false;) {}`（三轮 #1）。 */
function assertTopLevelDecl(node: ts.Node, name: string): void {
  const list = node.parent;
  if (!list || !ts.isVariableDeclarationList(list)) throw new Error(`${name}: 非 VariableDeclarationList（fail-closed）`);
  if ((list.flags & ts.NodeFlags.Const) === 0) throw new Error(`${name}: 声明非 const（fail-closed）`);
  const stmt = list.parent;
  if (!stmt || !ts.isVariableStatement(stmt)) {
    throw new Error(`${name}: 声明不在 VariableStatement 中（如 for-init，fail-closed）`);
  }
  if (!stmt.parent || !ts.isSourceFile(stmt.parent)) {
    throw new Error(`${name}: 声明不在 SourceFile 顶层（fail-closed）`);
  }
}

function tsSource(rel: string[]): ts.SourceFile {
  const fp = join(HERE, '..', 'src', 'core', 'generation', 'newEngine', ...rel);
  const text = readFileSync(fp, 'utf-8');
  const sf = ts.createSourceFile(rel[rel.length - 1], text, ts.ScriptTarget.ES2020, true);
  if (sf.parseDiagnostics && sf.parseDiagnostics.length > 0) {
    throw new Error(`${rel.join('/')}: ${sf.parseDiagnostics.length} 条 parse diagnostic（fail-closed）`);
  }
  return sf;
}

/** `export type X = 'a' | 'b' | …` 的字符串字面 union → 有序数组（拒非字符串成员）。 */
export function astUnionLiterals(sf: ts.SourceFile, typeName: string): string[] {
  let out: string[] | undefined;
  const visit = (n: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(n) && n.name.text === typeName) {
      if (out) throw new Error(`${typeName}: 多次声明（fail-closed）`);
      if (!n.parent || !ts.isSourceFile(n.parent)) throw new Error(`${typeName}: 非顶层声明（fail-closed）`);
      const mods = ts.canHaveModifiers(n) ? (ts.getModifiers(n) || []) : [];
      if (!mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        throw new Error(`${typeName}: 未 export（fail-closed）`);
      }
      const t = n.type;
      if (!ts.isUnionTypeNode(t)) throw new Error(`${typeName}: 非 union 类型（fail-closed）`);
      out = t.types.map((m) => {
        if (!ts.isLiteralTypeNode(m) || !ts.isStringLiteral(m.literal)) {
          throw new Error(`${typeName}: 含非字符串字面成员（fail-closed）`);
        }
        return m.literal.text;
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!out || out.length === 0) throw new Error(`${typeName}: 未找到或为空（fail-closed）`);
  if (new Set(out).size !== out.length) throw new Error(`${typeName}: 成员重复（fail-closed）`);
  return out;
}

/** `const X = new Set([...])` 的字符串字面数组 → 有序数组（拒 spread / 非字面 / 重复）。 */
export function astNewSetLiterals(sf: ts.SourceFile, constName: string): string[] {
  let out: string[] | undefined;
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === constName) {
      if (out) throw new Error(`${constName}: 多次声明（fail-closed）`);
      assertTopLevelDecl(n, constName);
      const init = n.initializer;
      if (!init || !ts.isNewExpression(init) || !ts.isIdentifier(init.expression)
          || init.expression.text !== 'Set') {
        throw new Error(`${constName}: initializer 非 new Set(...)（fail-closed）`);
      }
      if (!init.arguments || init.arguments.length !== 1) {
        throw new Error(`${constName}: new Set 实参须恰 1 个（fail-closed）`);
      }
      const arg = init.arguments[0];
      if (!arg || !ts.isArrayLiteralExpression(arg)) {
        throw new Error(`${constName}: new Set 实参非数组字面（fail-closed）`);
      }
      out = arg.elements.map((e) => {
        if (!ts.isStringLiteral(e)) throw new Error(`${constName}: 含非字符串字面元素（fail-closed）`);
        return e.text;
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!out || out.length === 0) throw new Error(`${constName}: 未找到或为空（fail-closed）`);
  if (new Set(out).size !== out.length) throw new Error(`${constName}: 元素重复（fail-closed）`);
  assertOnlyAllowedUsage(sf, constName, 'set');
  return out;
}

/** `const X: Record<...> = { 'k': …, }` 的**顶层属性键** → 有序数组（拒 spread / computed / 重复）。 */
export function astObjectKeys(sf: ts.SourceFile, constName: string): string[] {
  let out: string[] | undefined;
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === constName) {
      if (out) throw new Error(`${constName}: 多次声明（fail-closed）`);
      assertTopLevelDecl(n, constName);
      const init = n.initializer;
      if (!init || !ts.isObjectLiteralExpression(init)) {
        throw new Error(`${constName}: initializer 非 ObjectLiteral（fail-closed）`);
      }
      out = init.properties.map((pr) => {
        if (!ts.isPropertyAssignment(pr)) {
          throw new Error(`${constName}: 含非 PropertyAssignment 成员（spread/method/shorthand，fail-closed）`);
        }
        const nm = pr.name;
        if (ts.isStringLiteral(nm)) return nm.text;
        if (ts.isIdentifier(nm)) return nm.text;
        throw new Error(`${constName}: 含 computed/非字面键（fail-closed）`);
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!out || out.length === 0) throw new Error(`${constName}: 未找到或为空（fail-closed）`);
  if (new Set(out).size !== out.length) throw new Error(`${constName}: 键重复（fail-closed）`);
  assertOnlyAllowedUsage(sf, constName, 'object', 1);
  return out;
}

export function extractFamilyTripleSources(): { union: string[]; planner: string[]; realizer: string[] } {
  return {
    union: astUnionLiterals(tsSource(['arranger', 'ArrangementPlan.ts']), 'DrumPatternFamily'),
    planner: astNewSetLiterals(tsSource(['arranger', 'drumPerformancePlanner.ts']), 'DRUM_PATTERN_FAMILIES'),
    realizer: astObjectKeys(tsSource(['knowledge', 'grooves.ts']), 'DRUM_PERFORMANCE_FAMILIES'),
  };
}

function buildDrumPatternFamilies(): DrumFamilyEntry[] {
  // ---- 前 17 项：合同引用序（**已落地编号，append-only 不得变**）----
  const seen = new Set<string>();
  const out: DrumFamilyEntry[] = [];
  const push = (fam: string) => {
    if (seen.has(fam)) return;
    seen.add(fam);
    out.push({ id: out.length, name: fam, halftime: fam.includes('halftime'), minimal: fam.includes('minimal') });
  };
  for (const c of GROOVE_CONTRACT_POOL) {
    const d = c.drum;
    if (!d) continue;
    for (const fam of [d.timekeeperFamily, d.liftFamily, d.pickupFamily, d.breakdownFamily]) {
      if (fam == null) continue;
      push(fam);
    }
  }
  const contractRefCount = out.length;

  // ---- 扩容到**完整 ABI/realizer 类型域**（P2-10A 步2）----
  // 理由是类型域完整性，**不是**当前可达性（首轮 #2 已证伪"10 项全 fallback 可达"）。
  const tri = extractFamilyTripleSources();
  const u = new Set(tri.union), p = new Set(tri.planner), r = new Set(tri.realizer);
  const eq = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
  if (!eq(u, p) || !eq(u, r)) {
    throw new Error(`family 三方真源不精确相等（fail-closed）：union=${u.size} planner=${p.size} realizer=${r.size}；`
      + `union-planner=${[...u].filter((x) => !p.has(x))}；union-realizer=${[...u].filter((x) => !r.has(x))}`);
  }
  // 追加项按 planner 声明序（稳定、可复现），追加在合同引用序之后
  for (const fam of tri.planner) push(fam);
  if (out.length !== u.size) throw new Error(`扩容后 ${out.length} != 类型域 ${u.size}（fail-closed）`);
  // 合同引用的每一项都必须在类型域内（否则合同数据引了域外 family）
  for (let k = 0; k < contractRefCount; k++) {
    if (!u.has(out[k].name)) throw new Error(`合同引用的 family ${out[k].name} 不在类型域内（fail-closed）`);
  }
  return out;
}

// ---- ④b drum kit capability registry（owner=P2-10A，步2）----
// 真源 = knowledge/drumKitCapabilities.ts 的 DRUM_KIT_CAPABILITIES（3 kit）+ projectDrumPitchForKit。
// **直调生产 API**（drumKitCapability / drumKitPitchOrigin / projectDrumPitchForKit），不做字面提取。
// 音高集合落 128-bit 位图：pitch p ↦ word=p>>5、bit=p&31，**LSB-first**（设计门二轮冻结）。
interface KitCapEntry {
  program: number; name: string;
  nativeBits: string[];      // 4 × u32，十六进制（LSB-first）
  inheritedBits: string[];
}
function pitchBitmap(pitches: Iterable<number>): string[] {
  const w = [0, 0, 0, 0];
  for (const p of pitches) {
    if (!Number.isInteger(p) || p < 0 || p >= 128) throw new Error(`pitch ${p} 越 [0,128)（fail-closed）`);
    w[p >> 5] = (w[p >> 5] | (1 << (p & 31))) >>> 0;
  }
  return w.map((x) => (x >>> 0).toString(16).padStart(8, '0'));
}
function buildKitCapabilities(): { kits: KitCapEntry[]; coreGmBits: string[]; pitchProjections: Array<{ program: number; from: number; to: number }> } {
  const PROGRAMS: DrumKitProgram[] = [8, 25, 40];
  const kits: KitCapEntry[] = [];
  let coreUnion: Set<number> | undefined;
  for (const prog of PROGRAMS) {
    const cap = drumKitCapability(prog);
    const native = new Set(cap.nativePitches);
    const inherited = new Set(cap.inheritedCorePitches);
    // ★ 派生关系断言（设计门二轮 #11：两表都物化便于 O(1) 查询，但须证明它们仍自洽）：
    //   inherited = CORE_GM \ native ⇒ native ∩ inherited = ∅ 且 native ∪ inherited 对三 kit **恒等**
    //   ★ 但**这一条单独不够**（实现门首轮 #2）：它只证明『存在某个基集 U 使
    //   inherited_i = U \\ native_i』，证明不了 U 就是真源的 CORE_GM_PITCHES——
    //   三 kit 一致漂移时该判据仍成立。真正把 U 钉到真源的是下面的 FROZEN_CORE_GM 逐值锚。
    for (const p of native) {
      if (inherited.has(p)) throw new Error(`kit ${prog}: pitch ${p} 同时在 native 与 inherited（fail-closed）`);
    }
    const union = new Set([...native, ...inherited]);
    if (coreUnion === undefined) coreUnion = union;
    else {
      const same = union.size === coreUnion.size && [...union].every((p) => coreUnion!.has(p));
      if (!same) throw new Error(`kit ${prog}: native∪inherited 与其它 kit 不等 ⇒ 派生关系被破坏（fail-closed）`);
    }
    if (cap.sampleVelocityLayers !== 1) throw new Error(`kit ${prog}: sampleVelocityLayers != 1（fail-closed）`);
    kits.push({ program: prog, name: cap.name, nativeBits: pitchBitmap(native), inheritedBits: pitchBitmap(inherited) });
  }
  if (!coreUnion || coreUnion.size === 0) throw new Error('CORE_GM 推导为空（fail-closed）');
  // ★★ **独立锚**（自查补：原判据不严密）——
  // "互斥 + 三 kit 并集恒等" 只证明『存在某个基集 U 使 inherited_i = U \\ native_i』，
  // **不能证明 U 就是真源的 CORE_GM_PITCHES**：若真源整体改了 CORE_GM（如加一个音高），
  // 三 kit 的 native/inherited 会**一致地**变，该判据仍然成立、缺口不可见。
  // 故把 canonical CORE_GM 逐值冻在这里作独立锚：任何变动都是规格变更，须显式改这一行并复审。
  const FROZEN_CORE_GM = [
    35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
    51, 52, 53, 54, 55, 56, 57, 58, 59, 62, 63, 69, 70, 82,
  ];
  const got = [...coreUnion].sort((a, b) => a - b);
  if (got.length !== FROZEN_CORE_GM.length || got.some((p, i) => p !== FROZEN_CORE_GM[i])) {
    throw new Error(`CORE_GM 漂移（fail-closed）：冻结 ${FROZEN_CORE_GM.length} 项 ${FROZEN_CORE_GM}；`
      + `实得 ${got.length} 项 ${got}`);
  }
  // ★ pitch 投影：**穷举** 3 program × 128 pitch，记录所有 project(p,pitch) != pitch 的项
  const pitchProjections: Array<{ program: number; from: number; to: number }> = [];
  for (const prog of PROGRAMS) {
    for (let pitch = 0; pitch < 128; pitch++) {
      const to = projectDrumPitchForKit(prog, pitch);
      if (to !== pitch) pitchProjections.push({ program: prog, from: pitch, to });
    }
  }
  // origin 三值与位图必须一致（穷举复核，防位图与 accessor 漂移）
  for (const prog of PROGRAMS) {
    const cap = drumKitCapability(prog);
    for (let pitch = 0; pitch < 128; pitch++) {
      const o = drumKitPitchOrigin(prog, pitch);
      const want = cap.nativePitches.has(pitch) ? 'native'
        : cap.inheritedCorePitches.has(pitch) ? 'inherited-gm' : 'unsupported';
      if (o !== want) throw new Error(`kit ${prog} pitch ${pitch}: origin ${o} != ${want}（fail-closed）`);
    }
  }
  return { kits, coreGmBits: pitchBitmap(coreUnion), pitchProjections };
}

// ---- ⑤ P2-10A 步3：feel profile / profile_by_contract / density / timing safety ----
// 真源：knowledge/drumPerformanceKnowledge.ts（DRUM_FEEL_PROFILES、drumFeelProfileIdForContract）、
//       arranger/drumPerformancePlanner.ts（私有 densityCeilingForFamily）、
//       arranger/performanceContractPlanner.ts（timingSafetyForContract）。
// 能直调生产 API 的一律直调；只有 densityCeilingForFamily 是私有，见下方"经 planner 观测 + AST 证明"。

/** 9 个 knowledge source 的**声明序**（evidence bitmask 的位序，设计门 §4.1 冻结）。 */
function extractKnowledgeSourceOrder(): string[] {
  const sf = tsSource(['knowledge', 'drumPerformanceKnowledge.ts']);
  const ids = astUnionLiterals(sf, 'DrumKnowledgeSourceId');
  if (ids.length !== 9) throw new Error(`DrumKnowledgeSourceId 须 9 项，实得 ${ids.length}（fail-closed）`);
  return ids;
}

/** GroovePhraseBarRole 的声明序（ghostRoles/openHatRoles bitmask 位序）。
 *  设计门二轮 #2：它与 core 的 afe_groove_bar_role_t 五值**精确同构**，故复用不另造。 */
function extractPhraseBarRoleOrder(): string[] {
  const sf = tsSource(['knowledge', 'grooveContracts.ts']);
  const roles = astUnionLiterals(sf, 'GroovePhraseBarRole');
  const WANT = ['base', 'answer', 'lift', 'turnaround', 'breakdown'];
  if (roles.length !== WANT.length || roles.some((r, i) => r !== WANT[i])) {
    throw new Error(`GroovePhraseBarRole 须与 afe_groove_bar_role_t 同构 ${WANT}，实得 ${roles}（fail-closed）`);
  }
  return roles;
}

function bitmaskOf(values: readonly string[], order: readonly string[], what: string): number {
  let m = 0;
  for (const v of values) {
    const i = order.indexOf(v);
    if (i < 0) throw new Error(`${what}: 未知值 ${v}（fail-closed）`);
    m |= 1 << i;
  }
  return m;
}

const HALF_MS = (x: number, what: string): number => {
  const v = x * 2;
  if (!Number.isInteger(v)) throw new Error(`${what}=${x} 非半毫秒整数（fail-closed）`);
  if (v < -128 || v > 127) throw new Error(`${what}=${x} 越 i8 域（fail-closed）`);
  return v;
};
const INT_MS = (x: number, what: string): number => {
  if (!Number.isInteger(x)) throw new Error(`${what}=${x} 非整毫秒（fail-closed）`);
  if (x < -128 || x > 127) throw new Error(`${what}=${x} 越 i8 域（fail-closed）`);
  return x;
};

/** physical 的两个二值枚举 → u8（实现门 F7）。
 *
 * 提为**具名函数**而非内联 IIFE，目的有二：
 *  ① 未知值可被消息级负向直接打靶（内联 IIFE 只能靠伪造整份 profile 才够得着）；
 *  ② 两个字段的合法值域**不同**（timekeeper: right|alternating，ghost: left|alternating），
 *    共用一张表会把 'left' 静默当成 timekeeper 的合法值——故按 kind 分支穷举，
 *    不用对象查表（对象查表还会被 '__proto__' / 'constructor' 之类继承属性钻空）。
 * 未知值一律抛错：TS 类型将来加第三值时必须转红，不得静默别名为 alternating。 */
function HAND_ID(kind: 'timekeeper' | 'ghost', v: string, id: string): number {
  if (kind === 'timekeeper') {
    if (v === 'right') return 0;
    if (v === 'alternating') return 1;
  } else {
    if (v === 'left') return 0;
    if (v === 'alternating') return 1;
  }
  throw new Error(`${id}.${kind}Hand 未知值 ${v}（fail-closed）`);
}

function buildFeelProfiles() {
  const srcOrder = extractKnowledgeSourceOrder();
  const roleOrder = extractPhraseBarRoleOrder();
  const ids = Object.keys(DRUM_FEEL_PROFILES);
  if (ids.length !== 8) throw new Error(`feel profile 须 8 行，实得 ${ids.length}（fail-closed）`);
  const BANDS = ['kickAnchor', 'kickResponse', 'snareAccent', 'snareGhost',
                 'timekeeperAccent', 'timekeeperTap', 'tomFill', 'crash'] as const;
  const CADENCE_BITS: Record<number, number> = { 4: 0, 8: 1, 16: 2 };
  const rows = ids.map((id, idx) => {
    const p = drumFeelProfile(id as never);
    if (p.id !== id) throw new Error(`profile[${idx}] id 与键不符（fail-closed）`);
    // velocity band 不变量（设计门 §4.1）
    const bands = BANDS.map((b) => {
      const v = p.velocity[b];
      if (!v) throw new Error(`${id}.velocity.${b} 缺失（fail-closed）`);
      if (!Number.isInteger(v.min) || !Number.isInteger(v.max)) throw new Error(`${id}.${b} 非整数`);
      if (v.min > v.max) throw new Error(`${id}.${b}: min>max（fail-closed）`);
      if (v.min < 0 || v.max > 127) throw new Error(`${id}.${b}: 越 MIDI 域（fail-closed）`);
      return [v.min, v.max];
    });
    if (!(p.velocity.snareAccent.min > p.velocity.snareGhost.max)) {
      throw new Error(`${id}: snareAccent.min 须 > snareGhost.max（语义不变量，fail-closed）`);
    }
    // ★ 我最初照抄 snare 的形式假设 timekeeper 也严格分离——**假设错了**，被本 fail-closed 检查
    //   当场抓住：真源里 jazz-swing-ride(62,82)/(42,64) 与 jazz-brush-ballad(44,62)/(28,46) 两带**重叠 2**，
    //   其余六条恰好首尾相接（accent.min == tap.max）。实际成立且有意义的不变量是"accent 带整体高于 tap 带"：
    if (!(p.velocity.timekeeperAccent.min > p.velocity.timekeeperTap.min
          && p.velocity.timekeeperAccent.max > p.velocity.timekeeperTap.max)) {
      throw new Error(`${id}: timekeeperAccent 带须整体高于 timekeeperTap 带`
        + `（min 与 max 各自更大；允许重叠，语义不变量，fail-closed）`);
    }
    if (p.physical.maxHandsAtOnce !== 2) throw new Error(`${id}: maxHandsAtOnce != 2（fail-closed）`);
    let cadence = 0;
    for (const b of p.phrase.fillCadenceBars) {
      if (!(b in CADENCE_BITS)) throw new Error(`${id}: fillCadenceBars 含 ${b}（fail-closed）`);
      cadence |= 1 << CADENCE_BITS[b];
    }
    return {
      id: idx, name: id, style: p.style,
      evidence: bitmaskOf(p.evidence, srcOrder, `${id}.evidence`),
      velocityBands: bands,
      timing: {
        kickAnchorMs: INT_MS(p.timing.kickAnchorMs, `${id}.kickAnchorMs`),
        kickOffbeatMs: INT_MS(p.timing.kickOffbeatMs, `${id}.kickOffbeatMs`),
        snareAccentMs: INT_MS(p.timing.snareAccentMs, `${id}.snareAccentMs`),
        snareGhostMs: INT_MS(p.timing.snareGhostMs, `${id}.snareGhostMs`),
        timekeeperOnbeatMs: INT_MS(p.timing.timekeeperOnbeatMs, `${id}.tkOnbeatMs`),
        timekeeperOffbeatMs: INT_MS(p.timing.timekeeperOffbeatMs, `${id}.tkOffbeatMs`),
        maxAbsoluteMs: INT_MS(p.timing.maxAbsoluteMs, `${id}.maxAbsoluteMs`),
        phraseDriftHalfMs: p.timing.phraseDriftMs.map((x, k) => HALF_MS(x, `${id}.phraseDrift[${k}]`)),
      },
      phrase: {
        velocityContourBits: p.phrase.velocityContour.map((x) => dbitsHex(x)),
        ghostRolesMask: bitmaskOf(p.phrase.ghostRoles, roleOrder, `${id}.ghostRoles`),
        openHatRolesMask: bitmaskOf(p.phrase.openHatRoles, roleOrder, `${id}.openHatRoles`),
        allowInternalTurnaround: p.phrase.allowInternalTurnaround,
        fillCadenceMask: cadence,
      },
      physical: {
        timekeeperHand: HAND_ID('timekeeper', p.physical.timekeeperHand, id),
        ghostHand: HAND_ID('ghost', p.physical.ghostHand, id),
        chokeOpenHatWithClosed: p.physical.chokeOpenHatWithClosed,
      },
    };
  });
  return { sourceOrder: srcOrder, roleOrder, profiles: rows };
}

/** profile_by_contract[21] 的 **effective 表** + **7 叶** fallback 判别矩阵（设计门 §4.3）。
 *  C 侧存"最终生效值"；fallback 逻辑只用于 codegen 期复算断言与判别矩阵。 */
function buildProfileByContract(profileIdx: Map<string, number>) {
  // ★★ 索引必须是**冻结的 contract enum 序**，不是 TS POOL 序（实现门 F1 Blocker）：
  //   C API 的 contract_id 是 enum；我初版用 POOL 序落表，21 项里大部分对错了 profile，
  //   而 digest 从同一份错数组重算 ⇒ 整体自洽而**假绿**。
  //   （教训：digest 自洽只证明"两侧读的是同一份数据"，**证明不了那份数据的语义索引是对的**。）
  const slots: Array<{ contract: number; contractId: string; profile: number } | undefined> =
    new Array(21).fill(undefined);
  for (const c of GROOVE_CONTRACT_POOL) {
    const e = _lk(CONTRACT_ID_IDX, c.id, 'contract id');
    if (!Number.isInteger(e) || e < 0 || e >= 21) throw new Error(`合同 ${c.id} enum ${e} 越域（fail-closed）`);
    if (slots[e] !== undefined) throw new Error(`contract enum ${e} 被两个合同占用（非单射，fail-closed）`);
    const pid = drumFeelProfileIdForContract(c);
    const idx = profileIdx.get(pid);
    if (idx === undefined) throw new Error(`合同 ${c.id} 映射到未知 profile ${pid}（fail-closed）`);
    slots[e] = { contract: e, contractId: c.id, profile: idx };
  }
  const missing = slots.map((v, i) => (v === undefined ? i : -1)).filter((i) => i >= 0);
  if (missing.length > 0) throw new Error(`contract enum 未全覆盖，缺 ${missing}（fail-closed）`);
  const effective = slots as Array<{ contract: number; contractId: string; profile: number }>;

  // ★ 7 叶 fallback（4 个顶层 clause 展开）：JAZZ 2 / LOFI 1 / RNB 2 / default 2。
  //   设计门三轮 #3 更正：4 个 synthetic fixture 锁不住 sparse/dilla/active 的正反分支。
  const LEAVES: Array<{ leaf: string; style: string; grid: string; density: string; expect: string }> = [
    { leaf: 'JAZZ-sparse',        style: 'JAZZ', grid: 'swing',    density: 'sparse', expect: 'jazz-brush-ballad' },
    { leaf: 'JAZZ-nonsparse',     style: 'JAZZ', grid: 'swing',    density: 'medium', expect: 'jazz-swing-ride' },
    { leaf: 'LOFI',               style: 'LOFI', grid: 'straight', density: 'medium', expect: 'lofi-dusty-pocket' },
    { leaf: 'RNB-dilla',          style: 'RNB',  grid: 'dilla',    density: 'medium', expect: 'rnb-dilla-voices' },
    { leaf: 'RNB-nondilla',       style: 'RNB',  grid: 'straight', density: 'medium', expect: 'rnb-laidback-pocket' },
    { leaf: 'default-active',     style: 'POP',  grid: 'straight', density: 'active', expect: 'pop-driving-rock' },
    { leaf: 'default-nonactive',  style: 'POP',  grid: 'straight', density: 'medium', expect: 'pop-tight-backbeat' },
  ];
  const matrix = LEAVES.map((L) => {
    // id 用不含任何显式映射键的 synthetic 值，确保走 fallback 而非 PROFILE_BY_CONTRACT_ID
    const got = drumFeelProfileIdForContract({
      id: `__synthetic_${L.leaf}__`, style: L.style, grid: L.grid, density: L.density,
    } as never);
    if (got !== L.expect) throw new Error(`fallback 叶 ${L.leaf}: 实得 ${got} != 期望 ${L.expect}（fail-closed）`);
    const idx = profileIdx.get(got);
    if (idx === undefined) throw new Error(`叶 ${L.leaf} 映射未知 profile（fail-closed）`);
    return { leaf: L.leaf, style: L.style, grid: L.grid, density: L.density, profile: idx };
  });
  if (new Set(matrix.map((m) => m.profile)).size < 6) {
    throw new Error('7 叶判别矩阵产出的 profile 少于 6 种，判别力不足（fail-closed）');
  }
  return { effective, fallbackLeaves: matrix };
}

/** **AST 证明**：`densityCeilingForFamily` 的 role 依赖只有 `role==='lift'` 与 `role==='breakdown'`。
 *  ⇒ 任何既非 lift 也非 breakdown 的 role（含 silent）结果**恒等于 timekeeper**。
 *  该函数私有、planner 又永不产 silent，故 silent 行**由此定理导出**，而不是猜或另写一份实现。 */
export function proveDensityRoleDependencyOn(sf: ts.SourceFile): void {
  let fn: ts.FunctionDeclaration | undefined;
  const find = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'densityCeilingForFamily') {
      if (fn) throw new Error('densityCeilingForFamily 多次声明（fail-closed）');
      fn = n;
    }
    ts.forEachChild(n, find);
  };
  find(sf);
  if (!fn || !fn.body) throw new Error('densityCeilingForFamily 未找到（fail-closed）');
  const roleParam = fn.parameters[0];
  if (!roleParam || !ts.isIdentifier(roleParam.name) || roleParam.name.text !== 'role') {
    throw new Error('densityCeilingForFamily 首参非 role（fail-closed）');
  }
  const ALLOWED = new Set(['lift', 'breakdown']);
  let refs = 0;
  const walk = (n: ts.Node): void => {
    // ★ 首参还能经 `arguments[0]` 或动态执行读到（实现门 F3 的反例）——
    //   只扫名为 role 的标识符会漏。这两类一律 fail-closed。
    if (ts.isIdentifier(n) && n.text === 'arguments') {
      throw new Error('densityCeilingForFamily 体内出现 `arguments`（可绕过 role 名字扫描，fail-closed）');
    }
    if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && ts.isIdentifier(n.expression)
        && ['eval', 'Function'].includes(n.expression.text)) {
      throw new Error('densityCeilingForFamily 体内出现动态执行（fail-closed）');
    }
    if (ts.isIdentifier(n) && n.text === 'role') {
      refs++;
      const p = n.parent;
      if (!p || !ts.isBinaryExpression(p) || p.left !== n
          || p.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
          || !ts.isStringLiteral(p.right) || !ALLOWED.has(p.right.text)) {
        throw new Error(`densityCeilingForFamily: role 出现在非 \`role === 'lift'|'breakdown'\` 的位置`
          + `（${p ? ts.SyntaxKind[p.kind] : '<none>'}）⇒ "silent 恒等于 timekeeper" 的定理不再成立（fail-closed）`);
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(fn.body);
  if (refs === 0) throw new Error('densityCeilingForFamily 体内零 role 引用（fail-closed）');
}

function proveDensityRoleDependency(): void {
  proveDensityRoleDependencyOn(tsSource(['arranger', 'drumPerformancePlanner.ts']));
}

/** density 27 family × 5 role 的 permille 表。
 *  27×4 **经生产 planner 观测**（synthetic 合同驱动，不复写算法）；
 *  第 5 行 silent 由上面的 AST 定理导出（== timekeeper 行）。 */
function buildDensityTable(families: readonly string[],
                           observe: (family: string, role: string) => number) {
  proveDensityRoleDependency();
  const ROLES = ['timekeeper', 'lift', 'pickup', 'breakdown'] as const;
  const rows: Array<{ family: number; role: number; permille: number }> = [];
  const ROLE_ID: Record<string, number> = { silent: 0, timekeeper: 1, lift: 2, breakdown: 3, pickup: 4 };
  families.forEach((fam, fi) => {
    const byRole: Record<string, number> = {};
    for (const r of ROLES) {
      const v = observe(fam, r);
      if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error(`density ${fam}/${r}=${v} 越 [0,1]`);
      byRole[r] = v;
      rows.push({ family: fi, role: ROLE_ID[r], permille: permille(v) });
    }
    // silent 行由定理导出（== timekeeper），并显式记账其来源
    rows.push({ family: fi, role: ROLE_ID.silent, permille: permille(byRole.timekeeper) });
  });
  if (rows.length !== families.length * 5) throw new Error(`density 表须 ${families.length * 5} 行`);
  // ★ canonical 序 = (family, role) 升序 —— JSON 自身即 canonical，两侧 digest 才可能同序
  rows.sort((a, b) => (a.family - b.family) || (a.role - b.role));
  return rows;
}

/** density 观测器：用 synthetic 合同 + section 驱动**生产 planDrumPerformance**，
 *  从输出的 densityCeiling 读值——**不复写 densityCeilingForFamily 的算法**（复写即自证）。
 *  role 由 functionTag 决定（roleForSection）；family 由对应 role 的合同 family 字段决定。 */
function makeDensityObserver() {
  const TAG_FOR_ROLE: Record<string, string> = {
    timekeeper: 'story', lift: 'hook', pickup: 'build', breakdown: 'setup',
  };
  const FIELD_FOR_ROLE: Record<string, string> = {
    timekeeper: 'timekeeperFamily', lift: 'liftFamily',
    pickup: 'pickupFamily', breakdown: 'breakdownFamily',
  };
  return (family: string, role: string): number => {
    const drum: Record<string, unknown> = {
      kitProgram: 8, timekeeperFamily: family, liftFamily: family,
      pickupFamily: family, breakdownFamily: family,
    };
    drum[FIELD_FOR_ROLE[role]] = family;
    const contract = {
      id: `__density_probe_${family}_${role}__`, style: 'POP', grid: 'straight',
      density: 'medium', drum,
    } as never;
    const section = { id: 's0', functionTag: TAG_FOR_ROLE[role], bars: 4 } as never;
    const out = planDrumPerformance([section], 'pop', { s0: contract } as never,
                                    { s0: 0.5 } as never, { s0: 'downbeat' } as never);
    const got = out.s0;
    if (!got) throw new Error(`density 观测失败 ${family}/${role}（fail-closed）`);
    if (got.role !== role) throw new Error(`density 观测 role 不符：期望 ${role} 实得 ${got.role}（fail-closed）`);
    if (got.patternFamily !== family) {
      throw new Error(`density 观测 family 不符：期望 ${family} 实得 ${got.patternFamily}（fail-closed）`);
    }
    return got.densityCeiling;
  };
}

/** timing safety 的 **45 格完整输入域**（3 effective swing source × 5 grid × 3 density）。
 *  设计门三轮 #2：7 分支代表抓不住 authored+dilla 这类优先级冲突。 */
function buildTimingSafetyGrid() {
  const SWING = ['straight-eighths', 'straight-sixteenths', 'authored'] as const;
  const GRID = ['straight', 'swing', 'shuffle', 'dilla', 'rubato'] as const;
  const DENSITY = ['sparse', 'medium', 'active'] as const;
  const SWING_ID: Record<string, number> = { 'straight-eighths': 0, 'straight-sixteenths': 1, authored: 2 };
  const GRID_ID: Record<string, number> = { straight: 0, swing: 1, shuffle: 2, dilla: 3, rubato: 4 };
  const DENSITY_ID: Record<string, number> = { sparse: 0, medium: 1, active: 2 };
  const cells: Array<{ swing: number; grid: number; density: number; maxMoveTicks: number; humanizeAmount: number }> = [];
  for (const sw of SWING) for (const g of GRID) for (const d of DENSITY) {
    const r = timingSafetyForContract({ grid: g, density: d, rhythmSwingSource: sw } as never);
    if (!Number.isInteger(r.maxMoveTicks) || r.maxMoveTicks < 0 || r.maxMoveTicks > 65535) {
      throw new Error(`timing ${sw}/${g}/${d}: maxMoveTicks=${r.maxMoveTicks} 非法`);
    }
    if (![0, 1, 2, 3].includes(r.humanizeAmount)) throw new Error(`timing humanizeAmount 越域`);
    cells.push({ swing: SWING_ID[sw], grid: GRID_ID[g], density: DENSITY_ID[d],
                 maxMoveTicks: r.maxMoveTicks, humanizeAmount: r.humanizeAmount });
  }
  if (cells.length !== 45) throw new Error(`timing safety 须 45 格，实得 ${cells.length}（fail-closed）`);
  // ★ 派生链看守（实现门 F2）：45 格都显式传 rhythmSwingSource，只走首个分支，
  //   `rhythmSwingSourceForContract` 的**缺省派生**（dilla→straight-sixteenths / shuffle→authored /
  //   其余→straight-eighths）完全没被看守。这里对三条派生各造一个 fixture 并断言。
  // 顺序 = GRID 枚举序（**canonical**，非随手写序）：digest 按数组序哈希，
  // 若这里与 gridOrder 不同序，重排会静默改 digest 而 validator 看不出（步3 density 同类教训）。
  const DERIV_BY_GRID: Record<string, string> = {
    straight: 'straight-eighths', swing: 'straight-eighths', shuffle: 'authored',
    dilla: 'straight-sixteenths', rubato: 'straight-eighths',
  };
  const DERIV: Array<[string, string]> = GRID.map((g) => {
    const want = DERIV_BY_GRID[g];
    if (want === undefined) throw new Error(`grid=${g} 缺派生期望（fail-closed）`);
    return [g, want] as [string, string];
  });
  const derivation = DERIV.map(([g, want]) => {
    const got = rhythmSwingSourceForContract({ grid: g } as never);
    if (got !== want) throw new Error(`swing 派生 grid=${g}: 实得 ${got} != ${want}（fail-closed）`);
    // 显式字段须**压过**派生（authored + dilla 的优先级来源）
    const forced = rhythmSwingSourceForContract({ grid: g, rhythmSwingSource: 'authored' } as never);
    if (forced !== 'authored') throw new Error(`显式 rhythmSwingSource 未压过 grid=${g} 的派生（fail-closed）`);
    return { grid: g, derived: want };
  });
  // 判别力：45 格须至少出现 2 种 maxMoveTicks 与 2 种 humanizeAmount，否则整表无判别力
  if (new Set(cells.map((c) => c.maxMoveTicks)).size < 2
      || new Set(cells.map((c) => c.humanizeAmount)).size < 2) {
    throw new Error('timing safety 45 格判别力不足（fail-closed）');
  }
  return { cells, derivation };
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

// ---- ②b 拆步5 前置：fill rhythm cell 的 steps/accents（materialization 浮点链的数据源）----
// RHYTHM_CELLS 是 drumFillVocabulary.ts 的**私有 const**（步1 明确留给步5），故用 AST 源码字面提取
// （零触碰 src/，不为导出而改生产源）+ **运行时 API 交叉校验**：用 materializePopRockFill 反查
// 每个 cell 的 velocity，必须与"AST accents 代入 TS 公式"逐位一致（延续步1 rational+float 双校验制度）。
// accents 是 binary64 且直接参与 velocity 乘法链 ⇒ 存 IEEE754 位型（十六进制），不存十进制文本。
const FILL_SRC = join(
  HERE, '..', 'src', 'core', 'generation', 'newEngine', 'knowledge', 'drumFillVocabulary.ts');

function extractFillCells(): FillCell[] {
  return parseFillCells(readFileSync(FILL_SRC, 'utf-8'));
}

function dbitsHex(x: number): string {
  const buf = Buffer.alloc(8);
  buf.writeDoubleLE(x, 0);
  return buf.readBigUInt64LE(0).toString(16).padStart(16, '0');
}

interface FillCell { id: string; rhythmClass: string; steps: number[]; accents: number[]; }

/** AST：RHYTHM_CELLS 数组字面 → 每 cell 的 id/rhythmClass/steps/accents（fail-closed）。
 *
 * ★ 参数化成"源码文本进、结果出"的纯函数（Codex 步5 二轮 R2-2）：否则这些 fail-closed 分支
 * 只能靠生产源恰好合法来"证明"，把 throw 退回 continue 也照样全绿 —— 属**假锁**。
 * 下方 describe 里的负向用例直接注入非法 TypeScript，逐个分支真跑。 */
export function parseFillCells(text: string): FillCell[] {
  const sf = ts.createSourceFile('drumFillVocabulary.ts', text, ts.ScriptTarget.ES2020, true);
  let cellsArr: ts.ArrayLiteralExpression | undefined;
  let allSteps: number[] | undefined;
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      let init: ts.Expression = n.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
      // 顶层声明须**唯一**：同名二次声明（含条件分支/重导出覆盖）会让"提取到哪一份"变得不确定
      if (n.name.text === 'RHYTHM_CELLS') {
        if (!ts.isArrayLiteralExpression(init)) throw new Error('RHYTHM_CELLS 非 ArrayLiteral（fail-closed）');
        if (cellsArr) throw new Error('RHYTHM_CELLS 出现多次声明（fail-closed）');
        cellsArr = init;
      }
      if (n.name.text === 'ALL_STEPS') {
        if (!ts.isArrayLiteralExpression(init)) throw new Error('ALL_STEPS 非 ArrayLiteral（fail-closed）');
        if (allSteps) throw new Error('ALL_STEPS 出现多次声明（fail-closed）');
        allSteps = init.elements.map((e) => {
          if (!ts.isNumericLiteral(e)) throw new Error('ALL_STEPS 非数字字面（fail-closed）');
          return Number(e.text);
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!cellsArr) throw new Error('未找到 RHYTHM_CELLS ArrayLiteral（fail-closed）');
  if (!allSteps) throw new Error('未找到 ALL_STEPS ArrayLiteral（fail-closed）');
  const numArray = (e: ts.Expression, what: string): number[] => {
    if (ts.isIdentifier(e)) {
      if (e.text !== 'ALL_STEPS') throw new Error(`${what}: 未知标识符 ${e.text}（fail-closed）`);
      return allSteps!.slice();
    }
    if (!ts.isArrayLiteralExpression(e)) throw new Error(`${what}: 非数组字面（fail-closed）`);
    return e.elements.map((x) => {
      if (ts.isNumericLiteral(x)) return Number(x.text);
      throw new Error(`${what}: 元素非数字字面（fail-closed）`);
    });
  };
  return cellsArr.elements.map((el, i) => {
    if (!ts.isObjectLiteralExpression(el)) throw new Error(`RHYTHM_CELLS[${i}] 非 ObjectLiteral`);
    // ★属性解析必须 fail-closed（Codex 步5 F4）：spread / computed key / method / shorthand /
    // getter 会改变对象的实际 payload，而"静默 continue"会让这些改动**不被察觉**地漏出提取。
    const WANT = ['id', 'rhythmClass', 'steps', 'accents'] as const;
    const rec: Record<string, ts.Expression> = {};
    for (const p of el.properties) {
      if (!ts.isPropertyAssignment(p))
        throw new Error(`RHYTHM_CELLS[${i}] 含非 PropertyAssignment 成员（spread/method/shorthand，fail-closed）`);
      if (!ts.isIdentifier(p.name))
        throw new Error(`RHYTHM_CELLS[${i}] 含非标识符键（computed/字符串键，fail-closed）`);
      const k = p.name.text;
      if (!(WANT as readonly string[]).includes(k))
        throw new Error(`RHYTHM_CELLS[${i}] 含未知键 ${k}（fail-closed）`);
      if (k in rec) throw new Error(`RHYTHM_CELLS[${i}] 键 ${k} 重复（fail-closed）`);
      rec[k] = p.initializer;
    }
    if (el.properties.length !== WANT.length)
      throw new Error(`RHYTHM_CELLS[${i}] 属性数 ${el.properties.length} != ${WANT.length}（fail-closed）`);
    for (const k of WANT) {
      if (!(k in rec)) throw new Error(`RHYTHM_CELLS[${i}] 缺字段 ${k}（fail-closed）`);
    }
    const idNode = rec.id, rcNode = rec.rhythmClass;
    if (!ts.isStringLiteral(idNode) || !ts.isStringLiteral(rcNode))
      throw new Error(`RHYTHM_CELLS[${i}] id/rhythmClass 非字符串字面（fail-closed）`);
    return {
      id: idNode.text, rhythmClass: rcNode.text,
      steps: numArray(rec.steps, `cell[${i}].steps`),
      accents: numArray(rec.accents, `cell[${i}].accents`),
    };
  });
}

/** 运行时交叉校验：AST accents 代入 TS velocity 公式，须与生产 materialize 的 hits 逐位相同。 */
function crossCheckFillCells(cells: readonly FillCell[]): void {
  const clampVelocity = (v: number): number => Math.max(38, Math.min(118, Math.round(v)));
  const voiceFor = (orch: string, index: number, total: number): string => {
    if (orch === 'snare') return 'snare';
    const progress = total <= 1 ? 1 : index / (total - 1);
    if (orch === 'snare-tom-cascade') {
      if (progress < 0.4) return 'snare';
      if (progress < 0.64) return 'tom-high';
      if (progress < 0.84) return 'tom-mid';
      return 'tom-low';
    }
    if (orch === 'descending-toms') {
      if (progress < 0.3) return 'tom-high';
      if (progress < 0.64) return 'tom-mid';
      return 'tom-low';
    }
    if (index === total - 1) return 'tom-low';
    if (index % 3 === 1) return 'kick';
    if (progress < 0.34) return 'snare';
    if (progress < 0.67) return 'tom-high';
    return 'tom-mid';
  };
  const contour = (fn: string, p: number): number => {
    if (fn === 'climax') return 0.86 + p * 0.24;
    if (fn === 'lift' || fn === 'setup' || fn === 'opening') return 0.92 + p * 0.16;
    if (fn === 'release') return 1 - p * 0.08;
    return 0.92 + p * 0.06;
  };
  const byClass = new Map<string, FillCell[]>();
  for (const c of cells) {
    if (!byClass.has(c.rhythmClass)) byClass.set(c.rhythmClass, []);
    byClass.get(c.rhythmClass)!.push(c);
  }
  let checked = 0;
  for (const [cls, group] of byClass) {
    group.forEach((cell, variant) => {
      for (const orch of FILL_ORCHESTRATIONS) {
        for (const fn of FILL_FUNCTIONS) {
          for (const [durationBeats, intensity] of [[2, 3], [1, 2], [0.5, 1]] as const) {
            const got = materializePopRockFill({
              rhythmClass: cls as never, orchestration: orch as never, function: fn as never,
              variant, durationBeats, intensity: intensity as 1 | 2 | 3,
            });
            expect(got.recipeId, 'cell 选择须与 AST 声明序一致')
              .toBe(`${POP_ROCK_FILL_VOCABULARY_ID}:${cell.id}:${orch}`);
            const slotCount = Math.max(2, Math.min(8, Math.round(durationBeats * 4)));
            const firstSlot = 8 - slotCount;
            const selected = cell.steps.filter((st) => st >= firstSlot);
            expect(got.hits.length, 'hit 数').toBe(selected.length);
            selected.forEach((step, index) => {
              const p = selected.length <= 1 ? 1 : index / (selected.length - 1);
              const vel = clampVelocity(
                (intensity === 3 ? 90 : intensity === 2 ? 78 : 66)
                * (cell.accents[step] ?? 1) * contour(fn, p));
              expect(got.hits[index].velocity, `${cell.id}/${orch}/${fn} hit${index} velocity`).toBe(vel);
              expect(got.hits[index].voice, `${cell.id}/${orch}/${fn} hit${index} voice`)
                .toBe(voiceFor(orch, index, selected.length));
              expect(got.hits[index].offsetBeatsFromEnd, 'offset').toBe((step - 8) * 0.25);
              checked++;
            });
          }
        }
      }
    });
  }
  expect(checked, 'velocity 交叉校验次数（AST accents 代入公式 == 生产 materialize）')
    .toBeGreaterThan(1000);
}

// ---- ②c 拆步5 前置：bass ref 拍号（planner.ts:532-537 的拍号一致性 fail-closed 所需）----
// 7 值 ref 空间：0..5 = GROOVE_BASS_PATTERN_IDS（grooveBassPattern 可查），6 = jazz-walking
// pass-through（PATTERNS 里没有该键 ⇒ TS 不做拍号检查 ⇒ 拍号记 null）。
function buildBassPatternMeter() {
  const refs = [...GROOVE_BASS_PATTERN_IDS, JAZZ_WALKING_BASS_PATTERN_ID];
  return {
    ownerTask: 'P2J-b / grooveBassPatterns',
    note: 'resolved bass ref(7 值) → beatsPerBar；ref 6 = jazz-walking pass-through 无注册 pattern ⇒ null'
      + '（TS grooveBassPattern 返回 undefined，故不做拍号一致性断言）。',
    refs: refs.map((id, i) => {
      const p = grooveBassPattern(id);
      return { ref: i, id, beatsPerBar: p ? p.beatsPerBar : null };
    }),
  };
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
  const cells = extractFillCells();
  crossCheckFillCells(cells);
  return {
    ownerTask: 'P2-10A-b',
    vocabularyId: POP_ROCK_FILL_VOCABULARY_ID,
    // 拆步5 前置：cell steps + accents（IEEE754 位型；materialization 浮点链的唯一数据源）
    cells: cells.map((c, i) => ({
      id: i, cellId: c.id, rhythmClass: c.rhythmClass, steps: c.steps.slice(),
      accents: c.accents.map((a) => dbitsHex(a)),
    })),
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
    const bassPatternMeter = buildBassPatternMeter();
    const kitCapability = buildKitCapabilities();
    const feelKb = buildFeelProfiles();
    const profileIdx = new Map(feelKb.profiles.map((p) => [p.name, p.id]));
    const profileByContract = buildProfileByContract(profileIdx);
    const densityTable = buildDensityTable(drumPatternFamilies.map((f) => f.name), makeDensityObserver());
    const timingSafetyBuilt = buildTimingSafetyGrid();
    const timingSafety = timingSafetyBuilt.cells;
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
    // ★ P2-10A 步2：扩到完整类型域 27，且**前 17 项编号逐字节不变**（append-only；
    //   它们已被 afe_groove_contract_data.h 的 designated-init 引用，重编号会静默改已合入数据）
    expect(drumPatternFamilies.length, 'family 扩至完整类型域 27').toBe(27);
    // ★ 冻结**完整 17 项**（实现门首轮 #4：原先只锚 4 个名字，而 `id==k` 因 id 是
    //   `out.length` 现场生成而**恒真**，后 13 项调序或改名照样通过 ⇒ exporter 层是弱锁）
    const FROZEN_FIRST_17: Array<[string, boolean, boolean]> = [
      ['pop-backbeat', false, false], ['ballad-halftime', true, false],
      ['citypop-syncopated-boogie', false, false], ['citypop-disco-boogie', false, false],
      ['jpop-driving-8ths', false, false], ['tr808-lofi-boombap', false, false],
      ['tr808-lofi-minimal', false, true], ['tr808-lofi-dusty-break', false, false],
      ['tr808-rnb-pocket', false, false], ['tr808-dilla-pocket', false, false],
      ['rnb-gospel-triplet', false, false], ['tr808-trap-soul-halftime', true, false],
      ['jazz-swing-ride', false, false], ['jazz-bebop-comping', false, false],
      ['jazz-brush-ballad', false, false], ['smooth-jazz-backbeat', false, false],
      ['jazz-bossa', false, false],
    ];
    FROZEN_FIRST_17.forEach(([nm, ht, mn], k) => {
      const f = drumPatternFamilies[k];
      expect(f.id, `family[${k}].id`).toBe(k);
      expect(f.name, `family[${k}].name（append-only：改名/调序即红）`).toBe(nm);
      expect(f.halftime, `family[${k}].halftime`).toBe(ht);
      expect(f.minimal, `family[${k}].minimal`).toBe(mn);
    });
    // 三方真源相等在 buildDrumPatternFamilies 内已 fail-closed；此处复述断言以留痕
    {
      const tri = extractFamilyTripleSources();
      expect(new Set(tri.union).size, 'union 27').toBe(27);
      expect(new Set(tri.planner).size, 'planner 27').toBe(27);
      expect(new Set(tri.realizer).size, 'realizer 27').toBe(27);
    }
    // ①b kit capability：3 kit、位图非空、投影恰一条（Brush 40 的 37→39）
    expect(kitCapability.kits.length, '3 kit').toBe(3);
    expect(kitCapability.kits.map((k) => k.program), 'kit program 序').toEqual([8, 25, 40]);
    for (const k of kitCapability.kits) {
      expect(k.nativeBits.length, `${k.program} native 4 word`).toBe(4);
      expect(k.inheritedBits.length, `${k.program} inherited 4 word`).toBe(4);
      expect(k.nativeBits.some((w) => w !== '00000000'), `${k.program} native 非空`).toBe(true);
    }
    // ★ 投影穷举结果：真源只有 Brush(40) 的 side stick 37 → Brush Slap 39 这一条
    expect(kitCapability.pitchProjections, 'pitch 投影全集').toEqual([{ program: 40, from: 37, to: 39 }]);
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
    // ⑦ 拆步5 前置：fill cell 15 条、每条 accents 恰 8 个位型、steps 值域 [0,8)、按 class 分组数正确
    expect(fillVocabulary.cells.length, '15 rhythm cell').toBe(15);
    for (const c of fillVocabulary.cells) {
      expect(c.accents.length, `${c.cellId} accents 8 个`).toBe(8);
      for (const a of c.accents) expect(/^[0-9a-f]{16}$/.test(a), 'accent 位型 16 hex').toBe(true);
      expect(c.steps.length, `${c.cellId} steps 非空`).toBeGreaterThan(0);
      expect(c.steps.every((st) => Number.isInteger(st) && st >= 0 && st < 8), 'step 值域').toBe(true);
      expect([...c.steps].sort((x, y) => x - y).join(), 'steps 须升序去重').toBe([...new Set(c.steps)].join());
      expect(FILL_RHYTHM_CLASSES).toContain(c.rhythmClass);
    }
    // 每 class 5 条（15 = 3×5）；recipe 60 = 15 cell × 4 orch 的一致性
    for (const cls of FILL_RHYTHM_CLASSES)
      expect(fillVocabulary.cells.filter((c) => c.rhythmClass === cls).length, `${cls} 5 cell`).toBe(5);
    expect(fillVocabulary.recipes.length, '60 = 15×4').toBe(fillVocabulary.cells.length * 4);
    // ⑧ 拆步5 前置：bass ref 7 值，0..5 有拍号、6 = pass-through 无拍号
    expect(bassPatternMeter.refs.length, '7 bass ref').toBe(7);
    expect(bassPatternMeter.refs.slice(0, 6).every((r) => r.beatsPerBar !== null), 'ref 0..5 有拍号').toBe(true);
    expect(bassPatternMeter.refs[6].beatsPerBar, 'ref 6 jazz-walking pass-through 无拍号').toBe(null);
    expect(bassPatternMeter.refs[5].beatsPerBar, 'take-five ostinato 5 拍').toBe(5);

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
      drumKitCapability: {
        ownerTask: 'P2-10A',
        note: 'DREAM GMBK 三 kit（8=Room / 25=TR808 / 40=Brush）的音高能力：native/inherited 各一张 '
          + '128-bit 位图（pitch p ↦ word=p>>5, bit=p&31, LSB-first）。两表都物化便于 O(1) 查询，'
          + '派生关系 inherited = CORE_GM \\ native 由 exporter fail-closed 断言（三 kit 的 '
          + 'native∪inherited 恒等（只锁"共享同一基集"）；② canonical CORE_GM 30 音高**逐值冻结锚**'
          + '（锁"该基集即真源 CORE_GM"）。★①单独不够：三 kit 一致漂移时①仍成立。'
          + 'sampleVelocityLayers 恒 1 不物化。pitchProjections = 穷举 3×128 得到的全部改写项。',
        coreGmBits: kitCapability.coreGmBits,
        kits: kitCapability.kits,
        pitchProjections: kitCapability.pitchProjections,
      },
      drumFeelProfile: {
        ownerTask: 'P2-10A',
        note: '8 feel profile 全字段（velocity 8 band / timing 整毫秒 + phraseDrift 半毫秒定点 / '
          + 'velocityContour IEEE754 位型 / ghostRoles·openHatRoles bitmask 复用 afe_groove_bar_role_t / '
          + 'fillCadenceBars bit0→4 bit1→8 bit2→16 / evidence 9 位 bitmask 按 union 声明序）；'
          + 'maxHandsAtOnce 恒 2 断言后不物化。',
        knowledgeSourceOrder: feelKb.sourceOrder,
        phraseBarRoleOrder: feelKb.roleOrder,
        profiles: feelKb.profiles,
        effectiveByContract: profileByContract.effective,
        fallbackLeaves: profileByContract.fallbackLeaves,
      },
      drumDensityCeiling: {
        ownerTask: 'P2-10A',
        note: '27 family × 5 role 的 permille 表。27×4 **经生产 planDrumPerformance 观测**取得'
          + '（不复写 densityCeilingForFamily 算法）；silent 行由 AST 定理导出——'
          + '已机器证明该私有函数对 role 的依赖只有 role===\'lift\' 与 role===\'breakdown\' 两处比较，'
          + '故任何既非 lift 也非 breakdown 的 role（含 silent）结果恒等于 timekeeper。',
        roleOrder: ['silent', 'timekeeper', 'lift', 'breakdown', 'pickup'],
        rows: densityTable,
      },
      drumTimingSafety: {
        ownerTask: 'P2-10A',
        note: '45 格完整输入域（3 effective swing source × 5 grid × 3 density）。'
          + '7 分支代表抓不住 authored+dilla 这类优先级冲突，故按完整定义域冻结。',
        swingOrder: ['straight-eighths', 'straight-sixteenths', 'authored'],
        gridOrder: ['straight', 'swing', 'shuffle', 'dilla', 'rubato'],
        densityOrder: ['sparse', 'medium', 'active'],
        cells: timingSafety,
        swingDerivation: timingSafetyBuilt.derivation,
      },
      bassPatternMeter,
      contract,
      rhythmProfile,
    };
    assertJsonSafe(out, 'root');
    writeFileSync(OUT, JSON.stringify(out, null, 1));
    expect(readFileSync(OUT, 'utf-8').length).toBeGreaterThan(0);
  });
});

/* ============================================================
 * AST 提取器的**负向门**（Codex 步5 二轮 R2-2）
 * ------------------------------------------------------------
 * 首轮把静默 `continue` 改成 `throw` 之后，若只跑合法生产源，这些分支永远走不到——
 * 把 throw 退回 continue 也全绿，等于没锁。这里给 parseFillCells 注入非法 TypeScript，
 * 逐个 fail-closed 分支真跑一次；每条负向都先用**合法基线**证明它确实只差那一处。
 * ============================================================ */
describe('parseFillCells fail-closed 负向（AST 提取器本身）', () => {
  const LEGAL = [
    "const ALL_STEPS = [0, 1, 2, 3, 4, 5, 6, 7];",
    "const RHYTHM_CELLS = [",
    "  { id: 'a', rhythmClass: 'straight', steps: [0, 4], accents: [1, 1, 1, 1, 1, 1, 1, 1] },",
    "];",
  ].join('\n');

  it('合法基线可解析（负向用例的对照）', () => {
    const cells = parseFillCells(LEGAL);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ id: 'a', rhythmClass: 'straight' });
    expect(cells[0].steps).toEqual([0, 4]);
    expect(cells[0].accents).toHaveLength(8);
  });

  /* ★每条负向都断言**具体错误消息**，而不是"抛了就算"：否则会被下游检查代打——
   * 实证：把 PropertyAssignment/Identifier 的 throw 退回 continue，spread/computed/shorthand/
   * method 四例仍会被"属性数不符/缺字段"拦下而"通过"，等于没锁住目标分支（Codex 步5 二轮 R2-2
   * 的反例正是这条路径）。加消息断言后同一反例精确让 5 条负向转红。 */
  const NEG: Array<[string, string, string | RegExp]> = [
    ['spread 成员', LEGAL.replace("{ id: 'a',", "{ ...BASE, id: 'a',"), '含非 PropertyAssignment 成员'],
    ['method 成员', LEGAL.replace("{ id: 'a',", "{ steps2() { return []; }, id: 'a',"),
     '含非 PropertyAssignment 成员'],
    ['shorthand 成员', LEGAL.replace("id: 'a',", 'id,'), '含非 PropertyAssignment 成员'],
    ['computed key', LEGAL.replace("rhythmClass: 'straight',", "['rhythm' + 'Class']: 'straight',"),
     '含非标识符键'],
    ['字符串字面键', LEGAL.replace("rhythmClass: 'straight',", "'rhythmClass': 'straight',"),
     '含非标识符键'],
    ['未知键', LEGAL.replace("{ id: 'a',", "{ extra: 1, id: 'a',"), '含未知键 extra'],
    ['重复键', LEGAL.replace("{ id: 'a',", "{ id: 'a', id: 'b',"), '键 id 重复'],
    ['缺字段', LEGAL.replace("accents: [1, 1, 1, 1, 1, 1, 1, 1] ", ''), /属性数 3 != 4|缺字段 accents/],
    ['RHYTHM_CELLS 多次声明', LEGAL + '\nconst RHYTHM_CELLS = [];', 'RHYTHM_CELLS 出现多次声明'],
    ['ALL_STEPS 多次声明', LEGAL + '\nconst ALL_STEPS = [9];', 'ALL_STEPS 出现多次声明'],
    ['RHYTHM_CELLS 非 ArrayLiteral',
     LEGAL.replace('const RHYTHM_CELLS = [', 'const RHYTHM_CELLS = buildCells([').replace('];', ']);'),
     'RHYTHM_CELLS 非 ArrayLiteral'],
    ['cell 非 ObjectLiteral', LEGAL.replace("  { id: 'a',", "  makeCell(),\n  { id: 'a',"),
     '非 ObjectLiteral'],
    ['steps 元素非数字字面', LEGAL.replace('steps: [0, 4]', 'steps: [0, FOUR]'), '元素非数字字面'],
    ['steps 引用未知标识符', LEGAL.replace('steps: [0, 4]', 'steps: OTHER_STEPS'), '未知标识符 OTHER_STEPS'],
    ['accents 非数组字面', LEGAL.replace('accents: [1, 1, 1, 1, 1, 1, 1, 1]', 'accents: makeAccents()'),
     '非数组字面'],
    ['id 非字符串字面', LEGAL.replace("id: 'a',", 'id: someId,'), 'id/rhythmClass 非字符串字面'],
    ['ALL_STEPS 元素非数字字面', LEGAL.replace('const ALL_STEPS = [0,', 'const ALL_STEPS = [ZERO,'),
     'ALL_STEPS 非数字字面'],
    ['缺 RHYTHM_CELLS', LEGAL.split('\n')[0], '未找到 RHYTHM_CELLS'],
    ['缺 ALL_STEPS', LEGAL.split('\n').slice(1).join('\n'), '未找到 ALL_STEPS'],
  ];

  for (const [what, src, msg] of NEG) {
    it(`拒绝：${what}`, () => {
      expect(() => parseFillCells(src), what).toThrow(msg as string | RegExp);
    });
  }

  it('ALL_STEPS 标识符引用可解析（正向：确认拒绝的是"未知"标识符而非一切标识符）', () => {
    const cells = parseFillCells(LEGAL.replace('steps: [0, 4]', 'steps: ALL_STEPS'));
    expect(cells[0].steps).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

/* ============================================================
 * family 三方 AST 提取器的**落库对抗套件**（实现门二轮 #1）
 * ------------------------------------------------------------
 * 上一轮我只是**手跑一次**注释替身反例就还原了源码，仓里没有留下任何对抗测试——
 * 等于"验证过"但没有"持续看守"。本套件把每条 fail-closed 分支落成注入负向，
 * 并**逐例断言精确错误消息**（只断言 toThrow 会被下游检查代打，本仓已栽多次）。
 * ============================================================ */
describe('family 三方 AST 提取器 fail-closed 负向（落库对抗套件）', () => {
  const UNION_OK = "export type DrumPatternFamily =\n  | 'a'\n  | 'b';\n";
  const SET_OK = "const DRUM_PATTERN_FAMILIES: ReadonlySet<string> = new Set([\n  'a', 'b',\n]);\n";
  // 基线须**长得像生产**：含声明 + 唯一的生产形态引用（const initializer + `?? ` 索引）
  const OBJ_OK = "const DRUM_PERFORMANCE_FAMILIES: Record<string, number> = {\n  'a': 1,\n  'b': 2,\n};\n"
    + "export function drumPerformanceVariants(performance: { patternFamily?: string }) {\n"
    + "  const variants = DRUM_PERFORMANCE_FAMILIES[performance.patternFamily ?? ''];\n"
    + "  return variants;\n}\n";

  /* ★ 注释替身（首轮的核心反例）：**parser 不该抛** —— 它的职责是报出**真实**集合。
   * 正则会把注释里的字面也数进去（假绿），AST 只看到真实成员。抓住漂移的是**下游的三方
   * 相等门**。这条测试锁的正是这个分工：parser 如实报少、相等门据此转红。
   * （我第一版把它写成"parser 应抛"，是把两层职责混了——测试设计错了，不是实现错了。） */
  it('注释替身：AST 如实报出被注释掉的成员不计入（正则会假绿）', () => {
    const decoyed = SET_OK.replace("'a', 'b',", "'a', /* 'b' */");
    expect(astNewSetLiterals(tsParse(decoyed), 'DRUM_PATTERN_FAMILIES'), 'AST 只见 a').toEqual(['a']);
    // 同一文本用首轮的正则口径会数出 2 —— 这就是当时的假锁
    const regexHits = [...decoyed.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    expect(regexHits, '旧正则把注释里的也数进去').toEqual(['a', 'b']);
  });

  it('三方相等门在注释替身下转红（真正抓住漂移的一层）', () => {
    const u = astUnionLiterals(tsParse(UNION_OK), 'DrumPatternFamily');
    const p2 = astNewSetLiterals(tsParse(SET_OK.replace("'a', 'b',", "'a', /* 'b' */")), 'DRUM_PATTERN_FAMILIES');
    expect(u.length, 'union 2').toBe(2);
    expect(p2.length, 'planner 被注释掉一项 ⇒ 1').toBe(1);
    expect(u.length === p2.length, '相等门必然判不等').toBe(false);
  });

  it('三种合法基线可解析（负向的对照）', () => {
    expect(astUnionLiterals(tsParse(UNION_OK), 'DrumPatternFamily')).toEqual(['a', 'b']);
    expect(astNewSetLiterals(tsParse(SET_OK), 'DRUM_PATTERN_FAMILIES')).toEqual(['a', 'b']);
    expect(astObjectKeys(tsParse(OBJ_OK), 'DRUM_PERFORMANCE_FAMILIES')).toEqual(['a', 'b']);
  });

  const NEG: Array<[string, () => unknown, string | RegExp]> = [
    ['union 含非字符串字面', () => astUnionLiterals(tsParse("export type DrumPatternFamily = 'a' | string;\n"), 'DrumPatternFamily'), '含非字符串字面成员'],
    ['union 未 export', () => astUnionLiterals(tsParse(UNION_OK.replace('export ', '')), 'DrumPatternFamily'), '未 export'],
    ['union 多次声明', () => astUnionLiterals(tsParse(UNION_OK + UNION_OK), 'DrumPatternFamily'), '多次声明'],
    ['union 成员重复', () => astUnionLiterals(tsParse("export type DrumPatternFamily = 'a' | 'a';\n"), 'DrumPatternFamily'), '成员重复'],
    ['union 缺失', () => astUnionLiterals(tsParse('export const x = 1;\n'), 'DrumPatternFamily'), '未找到或为空'],
    ['Set 含 spread', () => astNewSetLiterals(tsParse("const DRUM_PATTERN_FAMILIES = new Set([...other, 'a']);\n"), 'DRUM_PATTERN_FAMILIES'), '含非字符串字面元素'],
    ['Set initializer 非 new Set', () => astNewSetLiterals(tsParse("const DRUM_PATTERN_FAMILIES = buildSet(['a']);\n"), 'DRUM_PATTERN_FAMILIES'), 'initializer 非 new Set'],
    ['Set 实参非数组字面', () => astNewSetLiterals(tsParse("const DRUM_PATTERN_FAMILIES = new Set(other);\n"), 'DRUM_PATTERN_FAMILIES'), '实参非数组字面'],
    ['Set 实参个数不为 1', () => astNewSetLiterals(tsParse("const DRUM_PATTERN_FAMILIES = new Set(['a'], 2 as never);\n"), 'DRUM_PATTERN_FAMILIES'), '实参须恰 1 个'],
    ['Set 元素重复', () => astNewSetLiterals(tsParse("const DRUM_PATTERN_FAMILIES = new Set(['a','a']);\n"), 'DRUM_PATTERN_FAMILIES'), '元素重复'],
    ['Set 非 const', () => astNewSetLiterals(tsParse(SET_OK.replace('const ', 'let ')), 'DRUM_PATTERN_FAMILIES'), '声明非 const'],
    ['Set 非顶层', () => astNewSetLiterals(tsParse('function f(){ ' + SET_OK + ' }\n'), 'DRUM_PATTERN_FAMILIES'), '不在 SourceFile 顶层'],
    // ★ 二轮反例：运行时 mutation —— 只读初始化器的提取器完全看不见
    ['Set 运行时 delete', () => astNewSetLiterals(tsParse(SET_OK + "(DRUM_PATTERN_FAMILIES as Set<string>).delete('b');\n"), 'DRUM_PATTERN_FAMILIES'), '只允许 .has'],
    ['Set 运行时 add', () => astNewSetLiterals(tsParse(SET_OK + "(DRUM_PATTERN_FAMILIES as Set<string>).add('z');\n"), 'DRUM_PATTERN_FAMILIES'), '只允许 .has'],
    ['Set 运行时 clear', () => astNewSetLiterals(tsParse(SET_OK + "(DRUM_PATTERN_FAMILIES as Set<string>).clear();\n"), 'DRUM_PATTERN_FAMILIES'), '只允许 .has'],
    // ★ 三轮 #1 的三条独立靶（黑名单版全部放行，白名单版精确拒绝）
    ['Set 经 alias 逃逸后 delete', () => astNewSetLiterals(tsParse(SET_OK + "const alias = DRUM_PATTERN_FAMILIES as Set<string>;\nalias.delete('b');\n"), 'DRUM_PATTERN_FAMILIES'), /VariableDeclaration 位置|RHS 传递/],
    ['Object.assign 改 realizer', () => astObjectKeys(tsParse(OBJ_OK + "Object.assign(DRUM_PERFORMANCE_FAMILIES, { c: 3 });\n"), 'DRUM_PERFORMANCE_FAMILIES'), /CallExpression 位置|实参/],
    ['for-init 假顶层声明', () => astNewSetLiterals(tsParse("for (const DRUM_PATTERN_FAMILIES = new Set(['a','b']); false;) {}\n"), 'DRUM_PATTERN_FAMILIES'), '不在 VariableStatement 中'],
    ['realizer 复合赋值 ||=', () => astObjectKeys(tsParse(OBJ_OK + "DRUM_PERFORMANCE_FAMILIES['a'] ||= 9;\n"), 'DRUM_PERFORMANCE_FAMILIES'), /只允许「const 声明的 initializer」/],
    ['Set 作实参传出', () => astNewSetLiterals(tsParse(SET_OK + "sink(DRUM_PATTERN_FAMILIES);\n"), 'DRUM_PATTERN_FAMILIES'), /CallExpression 位置/],
    ['Set 被 return 传出', () => astNewSetLiterals(tsParse(SET_OK + "export function g(){ return DRUM_PATTERN_FAMILIES; }\n"), 'DRUM_PATTERN_FAMILIES'), /ReturnStatement 位置/],
    ['realizer 属性写入', () => astObjectKeys(tsParse(OBJ_OK + "DRUM_PERFORMANCE_FAMILIES.c = 3;\n"), 'DRUM_PERFORMANCE_FAMILIES'), /出现在|只允许/],
    // ★ 四轮 #1：成员访问不得再作为 Call/New callee 或链式基底
    ['realizer __defineGetter__ 新增 own key',
     () => astObjectKeys(tsParse(OBJ_OK + "(DRUM_PERFORMANCE_FAMILIES as any)['__defineGetter__']('c', () => 3);\n"), 'DRUM_PERFORMANCE_FAMILIES'),
     /只允许「const 声明的 initializer」/],
    ['realizer __proto__ 链式写入',
     () => astObjectKeys(tsParse(OBJ_OK + "(DRUM_PERFORMANCE_FAMILIES as any)['__proto__']['extra'] = 1;\n"), 'DRUM_PERFORMANCE_FAMILIES'),
     /只允许「const 声明的 initializer」/],
    ['obj 含 spread', () => astObjectKeys(tsParse("const DRUM_PERFORMANCE_FAMILIES = { ...base, 'a': 1 };\n"), 'DRUM_PERFORMANCE_FAMILIES'), '含非 PropertyAssignment 成员'],
    ['obj 含 computed 键', () => astObjectKeys(tsParse("const DRUM_PERFORMANCE_FAMILIES = { ['a'+'b']: 1 };\n"), 'DRUM_PERFORMANCE_FAMILIES'), 'computed/非字面键'],
    ['obj 含 method', () => astObjectKeys(tsParse("const DRUM_PERFORMANCE_FAMILIES = { m(){ return 1; } };\n"), 'DRUM_PERFORMANCE_FAMILIES'), '含非 PropertyAssignment 成员'],
    ['obj 键重复', () => astObjectKeys(tsParse("const DRUM_PERFORMANCE_FAMILIES = { 'a': 1, 'a': 2 };\n"), 'DRUM_PERFORMANCE_FAMILIES'), '键重复'],
    ['obj initializer 非 ObjectLiteral', () => astObjectKeys(tsParse("const DRUM_PERFORMANCE_FAMILIES = build();\n"), 'DRUM_PERFORMANCE_FAMILIES'), 'initializer 非 ObjectLiteral'],
    ['obj 运行时下标写入', () => astObjectKeys(tsParse(OBJ_OK + "DRUM_PERFORMANCE_FAMILIES['c'] = 3;\n"), 'DRUM_PERFORMANCE_FAMILIES'), /只允许「const 声明的 initializer」/],
    // ★ 五轮反例：for-in 左值同样新增 own key
    ['obj for-in 左值新增 key', () => astObjectKeys(tsParse(OBJ_OK + "for (DRUM_PERFORMANCE_FAMILIES['c'] in { z: 1 }) {}\n"), 'DRUM_PERFORMANCE_FAMILIES'), /只允许「const 声明的 initializer」/],
    ['obj 字面量索引 __proto__（const-initializer 也不放行）',
     () => astObjectKeys(tsParse(OBJ_OK + "export function f(){ const x = DRUM_PERFORMANCE_FAMILIES['__proto__']; return x; }\n"), 'DRUM_PERFORMANCE_FAMILIES'),
     /索引表达式须为生产形态/],
    ['obj 索引左侧非 performance.patternFamily（k ?? ""）',
     () => astObjectKeys(tsParse(OBJ_OK.replace("performance.patternFamily ?? ''", "k ?? ''").replace('performance: { patternFamily?: string }', 'k: string')), 'DRUM_PERFORMANCE_FAMILIES'),
     /索引左侧须精确为/],
    ['obj 索引右侧非空串 fallback',
     () => astObjectKeys(tsParse(OBJ_OK.replace("?? ''", "?? 'fallback'")), 'DRUM_PERFORMANCE_FAMILIES'),
     /索引右侧须精确为空字符串/],
    ['obj 声明名非 variants',
     () => astObjectKeys(tsParse(OBJ_OK.replace('const variants =', 'const other =').replace('return variants', 'return other')), 'DRUM_PERFORMANCE_FAMILIES'),
     /声明名须为/],
    ['obj 所在函数非 drumPerformanceVariants',
     () => astObjectKeys(tsParse(OBJ_OK.replace('export function drumPerformanceVariants(', 'export function somethingElse(')), 'DRUM_PERFORMANCE_FAMILIES'),
     /须位于函数/],
    ['obj 裸标识符索引亦拒',
     () => astObjectKeys(tsParse(OBJ_OK + "export function f(k: string){ const x = DRUM_PERFORMANCE_FAMILIES[k]; return x; }\n"), 'DRUM_PERFORMANCE_FAMILIES'),
     /索引表达式须为生产形态/],
    ['obj for-of 左值', () => astObjectKeys(tsParse(OBJ_OK + "for (DRUM_PERFORMANCE_FAMILIES['c'] of [1]) {}\n"), 'DRUM_PERFORMANCE_FAMILIES'), /只允许「const 声明的 initializer」/],
    ['obj 属性读取（非下标）亦拒', () => astObjectKeys(tsParse(OBJ_OK + "export const v2 = DRUM_PERFORMANCE_FAMILIES.a;\n"), 'DRUM_PERFORMANCE_FAMILIES'), /出现在|只允许/],
    ['obj 运行时 delete', () => astObjectKeys(tsParse(OBJ_OK + "delete DRUM_PERFORMANCE_FAMILIES['a'];\n"), 'DRUM_PERFORMANCE_FAMILIES'), /只允许「const 声明的 initializer」/],
    ['Set 合法只读 .has 应放行（白名单正向）', () => { astNewSetLiterals(tsParse(SET_OK + "export const ok = DRUM_PATTERN_FAMILIES.has('a');\n"), 'DRUM_PATTERN_FAMILIES'); throw new Error('__SENTINEL_OK__'); }, '__SENTINEL_OK__'],
    ['realizer 生产形态应放行（正向契约，基线即含唯一生产引用）', () => { astObjectKeys(tsParse(OBJ_OK), 'DRUM_PERFORMANCE_FAMILIES'); throw new Error('__SENTINEL_OK__'); }, '__SENTINEL_OK__'],
    // ★ 计数锁的**独立靶**（八轮 #2 给的正确构造）：第二处引用放在**同一函数的嵌套块**内、
    //   **同样命名 variants** —— 于是函数名锁、声明名锁、索引形态锁**全部通过**，
    //   只有计数锁能抓。我前两版分别用 drumPerformanceVariants2 / variants2 构造，
    //   都先被函数名锁 / 声明名锁代打，靶子是假的。
    ['realizer 同函数嵌套块内多一处完全合法引用（计数锁独立靶）',
     () => astObjectKeys(tsParse(OBJ_OK.replace('  return variants;\n',
       "  {\n    const variants = DRUM_PERFORMANCE_FAMILIES[performance.patternFamily ?? ''];\n"
       + "    void variants;\n  }\n  return variants;\n")), 'DRUM_PERFORMANCE_FAMILIES'),
     /非声明引用 2 处 != 冻结 1/],
  ];
  for (const [what, run, msg] of NEG) {
    it(`拒绝：${what}`, () => { expect(run, what).toThrow(msg as string | RegExp); });
  }
});

/* ============================================================
 * silent AST 定理的**落库对抗套件**（实现门 F3）
 * ------------------------------------------------------------
 * 该定理是步3 里唯一一处"用证明代替观测"的地方：若它有漏洞，135 行里有 27 行是错的
 * 且**没有任何观测能发现**（planner 永不产 silent）。故每条旁路都要有落库负向 + 精确消息。
 * ============================================================ */
describe('density silent 定理 fail-closed 负向（落库对抗套件）', () => {
  const OK = "function densityCeilingForFamily(role: string, family: string): number {\n"
    + "  const base = role === 'lift' ? 0.68 : role === 'breakdown' ? 0.26 : 0.48;\n"
    + "  if (family === 'x') return role === 'lift' ? 0.9 : role === 'breakdown' ? 0.4 : 0.8;\n"
    + "  return base;\n}\n";

  it('合法基线可证（负向的对照）', () => {
    expect(() => proveDensityRoleDependencyOn(tsParse(OK))).not.toThrow();
  });

  const NEG: Array<[string, string, string | RegExp]> = [
    // ★ Codex 给的反例：arguments[0] 读到首参，绕过"只扫名为 role 的标识符"
    ['arguments[0] 旁路',
     OK.replace('  return base;', "  if (arguments[0] === 'silent') return 0.99;\n  return base;"),
     /出现 `arguments`/],
    ['eval 动态执行旁路',
     OK.replace('  return base;', "  if (eval(\"role === 'silent'\")) return 0.99;\n  return base;"),
     /动态执行/],
    ['new Function 旁路',
     OK.replace('  return base;', "  if (new Function('r', \"return r==='silent'\")(role)) return 0.99;\n  return base;"),
     /动态执行|非 `role ===/],
    ['role 与 silent 直接比较',
     OK.replace('  return base;', "  if (role === 'silent') return 0.99;\n  return base;"),
     /非 `role ===/],
    ['role 用 switch 分派',
     OK.replace('  return base;', "  switch (role) { case 'silent': return 0.99; }\n  return base;"),
     /非 `role ===/],
    ['role 被赋给别名',
     OK.replace('  return base;', "  const r2 = role;\n  if (r2 === 'silent') return 0.99;\n  return base;"),
     /非 `role ===/],
    ['role 用 !== 比较',
     OK.replace("role === 'lift' ? 0.68", "role !== 'lift' ? 0.68"),
     /非 `role ===/],
    ['role 与非白名单字面比较',
     OK.replace("role === 'breakdown' ? 0.26", "role === 'pickup' ? 0.26"),
     /非 `role ===/],
    ['函数多次声明',
     OK + OK, /多次声明/],
    ['函数缺失',
     "export const nothing = 1;\n", /未找到/],
  ];
  for (const [what, src, msg] of NEG) {
    it(`拒绝：${what}`, () => {
      expect(() => proveDensityRoleDependencyOn(tsParse(src)), what).toThrow(msg as string | RegExp);
    });
  }
});

/* ============================================================================
 * physical 二值枚举 fail-closed 负向（实现门 F7 落库对抗套件）
 *
 * F7 的缺陷是 `x === 'right' ? 0 : 1` 把**任何**未知值静默映成 1（alternating）。
 * 修法是 HAND_ID 按 kind 分支穷举 + 未知值抛错。下面两组靶：
 *   ① 消息级负向——每个字段逐个未知字面量，断言**具体错误消息**（否则会被别的检查代打）；
 *   ② 生产确实走 HAND_ID 的 AST 证明——否则改对了 HAND_ID 而 builder 仍内联，靶全绿也没用。
 * ========================================================================== */
describe('physical 二值枚举 fail-closed 负向（落库对抗套件）', () => {
  const OK: Array<['timekeeper' | 'ghost', string, number]> = [
    ['timekeeper', 'right', 0], ['timekeeper', 'alternating', 1],
    ['ghost', 'left', 0], ['ghost', 'alternating', 1],
  ];
  it.each(OK)('%s/%s → %i（合法值精确映射）', (kind, v, want) => {
    expect(HAND_ID(kind, v, 'p')).toBe(want);
  });

  /* ★ 判别力核心：两字段值域**不同**。若哪天合并成一张共用表，
   *   'left' 会成为 timekeeper 的合法值、'right' 会成为 ghost 的合法值——这两条专抓它。 */
  const BAD: Array<['timekeeper' | 'ghost', string]> = [
    ['timekeeper', 'left'],          // ghost 的合法值，对 timekeeper 非法
    ['ghost', 'right'],              // timekeeper 的合法值，对 ghost 非法
    ['timekeeper', 'both'],          // 假想的第三值（F7 原文的场景）
    ['ghost', 'both'],
    ['timekeeper', 'Right'],         // 大小写
    ['ghost', 'LEFT'],
    ['timekeeper', ''],              // 空串
    ['ghost', ''],
    ['timekeeper', '__proto__'],     // 对象查表实现会被继承属性钻空
    ['ghost', 'constructor'],
    ['timekeeper', 'toString'],
    ['ghost', 'hasOwnProperty'],
  ];
  it.each(BAD)('%s/%s → 抛错且消息含字段名与实得值', (kind, v) => {
    expect(() => HAND_ID(kind, v, 'prof-x')).toThrow(
      new RegExp(`prof-x\\.${kind}Hand 未知值 ${v === '' ? '' : v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}（fail-closed）`),
    );
  });

  it('未知值不得静默落在 {0,1} 内（原缺陷的直接反例）', () => {
    let leaked = 0;
    for (const [kind, v] of BAD) {
      try { HAND_ID(kind, v, 'p'); leaked++; } catch { /* 期望 */ }
    }
    expect(leaked).toBe(0);
  });

  /* ② 生产 builder 确实**消费 HAND_ID 的返回值**。
   *    二轮 Finding 1 打穿了上一版：上一版只数「函数体内 HAND_ID 调用 == 2」+「体内无手写
   *    枚举字面量」，于是
   *        timekeeperHand: (HAND_ID(...), BAD_HAND(...)),
   *    这种「逗号表达式 + 函数体外的弱 helper」照样满足谓词——HAND_ID 被调用了但返回值
   *    被丢弃，真正落进 JSON 的是 BAD_HAND 的旧「未知值→1」结果。
   *    故改为**锁 property initializer 本身**：它必须**就是**那次 HAND_ID 调用，
   *    且三个实参逐个核对（kind 字面量 / 源字段路径 / id）。 */
  const HAND_FIELDS: Array<['timekeeper' | 'ghost', string]> = [
    ['timekeeper', 'timekeeperHand'], ['ghost', 'ghostHand'],
  ];
  /* 三轮 Finding 1：二轮那版又被打穿两处——
   *   ① callee 只比**文本** `HAND_ID`：函数内 `const HAND_ID = (...) => BAD_HAND(...)`
   *      局部重绑后形状不变，谓词照过；
   *   ② 两个字段在**整个函数体**里搜集，没证明它们属于最终返回行的 `physical`：
   *      把两次正确调用塞进无关 `_proof` 对象、真正的 `physical: {...BAD_PHYSICAL(...)}`，
   *      谓词同样照过。
   * 两例我都亲跑复现（均 ACCEPT）。故本版补两个新维度：
   *   · **符号身份**——用 TypeChecker 把 callee 解析到文件级那个 `HAND_ID` 函数声明本身；
   *   · **输出数据流**——结构定位到唯一的 `physical` 对象字面量，禁止 spread，
   *     要求两个字段是**它的**直接属性。 */
  /* 四轮 Finding 1：三轮那版把「符号身份」与「physical 是对象字面量且禁 spread」都锁住了，
   * 但**只证明函数体里存在唯一一个合格的 `physical:`**，没证明它就是最终返回的那份。
   * Codex 的反例（我复现为 ACCEPT）：在最终 return 前加
   *     rows.forEach((r: any) => { r.physical.timekeeperHand = 0; r.physical.ghostHand = 0; });
   * 更隐蔽的等价形态是把弱映射搬到函数外 `BAD_REWRITE(rows, ids)` —— 当前 8 行合法输出
   * 完全不变，JSON/golden 零漂移，只有将来新增枚举值时静默绕过 fail-closed。
   *
   * 故本版改为**完整正向数据流契约**（锁「唯一合法形态」，不是枚举坏形态）。
   *
   * ★ 下面是**唯一权威清单**。八轮 Codex Minor 3 指出上一版清单又出现「实现有、清单没写」
   *   （连续三轮同一病根，且 G6 措辞也犯过同病）。本版清单是**从实现的 56 个 throw 点
   *   反向枚举**得出的，不凭记忆书写；改动契约时**必须同步这份清单**。
   *
   *   ── A. 被验证函数与消费链（证明「验的就是进产物的那份」）
   *   ① 顶层**带 body** 的 `buildFeelProfiles` 声明恰 1 处；
   *   ② 消费点 `const feelKb`（唯一声明、必须 `const`）的 initializer 是该函数**符号**的
   *      零参直接调用；该函数符号除声明名与此调用外**无其他引用**；
   *   ③ 结构定位**唯一**一个 initializer 含 `drumFeelProfile` 属性的产物对象声明，
   *      其中 `drumFeelProfile` 是唯一的对象字面量属性（记作 dfpObj）；
   *   ④ `dfpObj` 的 `knowledgeSourceOrder`/`phraseBarRoleOrder`/`profiles` 三字段
   *      各恰 1 处、且 initializer 就是 `feelKb.sourceOrder`/`.roleOrder`/`.profiles`
   *      （按**符号**核对，不按全文件同名属性计数——否则 decoy 对象可代打）；
   *   ⑤ 支链：`profileIdx`（唯一）= `new Map(feelKb.profiles.map(...))`；
   *      `profileByContract`（唯一）= `buildProfileByContract(profileIdx)`（实参按符号）；
   *      `dfpObj.effectiveByContract`/`fallbackLeaves` 直接取自 `profileByContract.effective`/`.fallbackLeaves`；
   *   ⑥ `feelKb` 符号的**全部引用**只允许 ④⑤ 白名单里的那几处字段读取——
   *      字段写入 / 字段别名 / 整体逃逸 / 第二条投影链一律拒。
   *
   *   ── B. 函数体内的构造链
   *   ⑦ `const ids = Object.keys(DRUM_FEEL_PROFILES)`：`ids` 必须 `const`；
   *      `Object` 不得在**本文件任何位置**被重新声明；`DRUM_FEEL_PROFILES` 按
   *      **精确 (模块路径, 被导入 export 名)** 二元组锁到顶层 import；
   *   ⑧ `rows` 顶层声明恰 1 处且必须 `const`；initializer 是单参 `.map(<块体箭头>)`，
   *      接收者按**符号** == 该 `ids`；callback 首形参名为 `id`；
   *   ⑨ callback **自身**的 `return`（不含嵌套函数的）恰 1 条且为末尾语句；
   *      其返回的 row 对象禁 spread，`physical` 属性恰 1 处、initializer 是对象字面量且禁 spread；
   *   ⑩ `p` 在 callback 内唯一 `const`，initializer 为 `drumFeelProfile(id as never)`，
   *      且 `drumFeelProfile` 按**精确二元组**锁到顶层 import；
   *      `p` 的引用面：除声明名外只能作属性访问的对象；
   *   ⑪ `p.physical` 四个叶 `maxHandsAtOnce`/`timekeeperHand`/`ghostHand`/`chokeOpenHatWithClosed`
   *      **各恰 1 次**，且各自的**终端只读上下文**受限：
   *        · 通用：拒写入 / 复合赋值 / update / delete / 作 callee / 别名逃逸 / 动态索引 / 未知叶；
   *        · `maxHandsAtOnce`：必须是 `if (p.physical.maxHandsAtOnce !== 2) throw …` 的完整形态
   *          （叶为 `!==` 左值、右值字面量 `2`、比较即 `if` 条件、无 else、then 分支抛错）；
   *        · `chokeOpenHatWithClosed`：必须**就是** ⑨ 定位到的 physical 对象内那个唯一同名
   *          属性节点（节点身份，不是名字相等）的 initializer；
   *        · 两手型叶：必须是对应 `HAND_ID` 调用的第 2 实参；
   *   ⑫ `physical.timekeeperHand`/`ghostHand` 各恰 1 处属性赋值，initializer **就是**
   *      `HAND_ID(...)` 调用本身；callee 按**符号**锁到文件级 `HAND_ID` 声明；
   *      三实参逐个核对（kind 字面量 / `p.physical.<prop>` 且根标识符按符号 == `p` /
   *      callback 首形参 `id` 按符号）；
   *   ⑬ 函数体内不得出现手写手型字面量 `'right'|'left'|'alternating'`；
   *   ⑭ `rows` 的全部引用只允许「声明名 + 最终 `return { … profiles: rows }`」，
   *      且函数最终 return 是对象字面量、其 `profiles` 直接引用该 `rows` **符号**。 */
  /** 把标识符锁到**顶层 import specifier**。`noResolve` 下 getAliasedSymbol 不可用，
   *  故直接核对符号的声明是 ImportSpecifier 且其模块说明符符合预期——
   *  这足以证明「不是局部重绑」，正是六轮 Finding 1 的三个反例（drumFeelProfile /
   *  DRUM_FEEL_PROFILES / Object 局部重绑）能绕过文本锁的原因。 */
  const KNOWLEDGE_MODULE = '../src/core/generation/newEngine/knowledge/drumPerformanceKnowledge';
  /** 把标识符锁到**精确的 (模块路径, 被导入 export 名)** 二元组。
   *
   *  七轮 Finding 1：上一版只查「声明是任意 ImportSpecifier + moduleSpecifier 文本
   *  `includes(hint)`」，判据层实测两处 ACCEPT：
   *    · 路径换成 `…/drumPerformanceKnowledgeEvil`（hint 是它的子串）
   *    · `weakProfile as drumFeelProfile`（本地名对上、真正导入的 export 是别的）
   *  两者都能在 scripts 内做成可编译、当前输出相同的完整绕过。
   *  `noResolve` 下无法比对 aliased symbol，但语法级的精确二元组已足够。 */
  const assertImportedFrom = (ck: ts.TypeChecker, id: ts.Identifier,
                              exactModule: string, exportName: string): void => {
    const sym = ck.getSymbolAtLocation(id);
    const decl = sym?.declarations?.[0];
    if (!decl || !ts.isImportSpecifier(decl)) {
      throw new Error(`${id.text} 不是顶层 import 的符号（可能被局部重绑），fail-closed`);
    }
    const imported = (decl.propertyName ?? decl.name).text;
    if (imported !== exportName) {
      throw new Error(`${id.text} 实际导入的 export 是 ${imported}，应为 ${exportName}`
        + '（别名遮蔽），fail-closed');
    }
    const impDecl = decl.parent.parent.parent;
    const spec = ts.isImportDeclaration(impDecl)
      && ts.isStringLiteral(impDecl.moduleSpecifier) ? impDecl.moduleSpecifier.text : '';
    if (spec !== exactModule) {
      throw new Error(`${id.text} 来自 ${spec}，应**精确等于** ${exactModule}`
        + '（路径子串 shim），fail-closed');
    }
  };
  /** 该标识符不得在**本文件任何位置**被重新声明（用于 `Object` 这类全局）。
   *  七轮 Finding 1：上一版只查函数体范围，文件级 `const Object = BAD` 实测 ACCEPT。 */
  const assertNotRebound = (ck: ts.TypeChecker, id: ts.Identifier, sf: ts.SourceFile): void => {
    const d = ck.getSymbolAtLocation(id)?.valueDeclaration;
    if (d && d.getSourceFile() === sf) {
      throw new Error(`${id.text} 在本文件内被重新声明（第 ${
        sf.getLineAndCharacterOfPosition(d.getStart(sf)).line + 1} 行），fail-closed`);
    }
  };
  const PHYSICAL_LEAVES = ['maxHandsAtOnce', 'timekeeperHand', 'ghostHand', 'chokeOpenHatWithClosed'];

  const assertHandDelegation = (prog: ts.Program, sf: ts.SourceFile): void => {
    const ck = prog.getTypeChecker();
    let fn: ts.FunctionDeclaration | undefined;
    let fnCount = 0;
    let topHandId: ts.FunctionDeclaration | undefined;
    sf.forEachChild((n) => {
      if (!ts.isFunctionDeclaration(n)) return;
      if (n.name?.text === 'buildFeelProfiles' && n.body) { fn = n; fnCount++; }
      if (n.name?.text === 'HAND_ID') topHandId = n;
    });
    if (!fn) throw new Error('未找到 buildFeelProfiles 声明（fail-closed）');
    if (fnCount !== 1) {
      throw new Error(`顶层带 body 的 buildFeelProfiles 声明 ${fnCount} 处，应恰 1 处——`
        + '多份声明时无法判定哪份是生产用的，fail-closed');
    }
    if (!topHandId) throw new Error('未找到文件级 HAND_ID 函数声明（fail-closed）');
    const wantSym = ck.getSymbolAtLocation(topHandId.name!);
    if (!wantSym) throw new Error('HAND_ID 声明无符号（fail-closed）');
    const body = fn.body;
    if (!body) throw new Error('buildFeelProfiles 无函数体（fail-closed）');

    // 手写手型字面量：整个函数体内一律不许
    const literals: string[] = [];
    const scanLit = (n: ts.Node): void => {
      if (ts.isStringLiteral(n) && ['right', 'left', 'alternating'].includes(n.text)) literals.push(n.text);
      n.forEachChild(scanLit);
    };
    body.forEachChild(scanLit);
    if (literals.length) throw new Error(`buildFeelProfiles 体内出现手写手型字面量 ${JSON.stringify(literals)}（fail-closed）`);

    // ① const rows = ids.map(<arrow>)
    // 五轮 Finding 1：上一版实现比注释承诺的契约**更宽**（未查 const / 未查 receiver /
    // 只看最后一条语句 / p 只查作用域）。四个单点反例实测全 ACCEPT，其中「early return」
    // 与「SANITIZE(p)」是真 fail-closed 绕过——HAND_ID 照调，但拿到的已不是真源原值。
    let rowsDecl: ts.VariableDeclaration | undefined;
    let rowsDeclCount = 0;
    let idsDecl: ts.VariableDeclaration | undefined;
    for (const st of body.statements) {
      if (!ts.isVariableStatement(st)) continue;
      const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        if (d.name.text === 'rows') {
          rowsDeclCount++;
          if (!isConst) throw new Error('rows 不是 const 声明——可被重新赋值，fail-closed');
          rowsDecl = d;
        }
        if (d.name.text === 'ids') {
          if (!isConst) throw new Error('ids 不是 const 声明（fail-closed）');
          idsDecl = d;
        }
      }
    }
    if (!rowsDecl) throw new Error('未找到 const rows 声明（fail-closed）');
    if (rowsDeclCount !== 1) throw new Error(`rows 顶层声明 ${rowsDeclCount} 处，应恰 1 处（fail-closed）`);
    if (!idsDecl) throw new Error('未找到 const ids 声明（fail-closed）');
    {
      const init = idsDecl.initializer;
      if (!init || !ts.isCallExpression(init) || !ts.isPropertyAccessExpression(init.expression)
          || !ts.isIdentifier(init.expression.expression)
          || init.expression.expression.text !== 'Object'
          || init.expression.name.text !== 'keys'
          || init.arguments.length !== 1 || !ts.isIdentifier(init.arguments[0])
          || init.arguments[0].text !== 'DRUM_FEEL_PROFILES') {
        throw new Error(`ids 的 initializer 应为 Object.keys(DRUM_FEEL_PROFILES)，`
          + `实得 ${init?.getText(sf)}（fail-closed）`);
      }
      // ★ 文本相同 ≠ 符号相同（六轮 Finding 1）
      assertNotRebound(ck, init.expression.expression, sf);
      assertImportedFrom(ck, init.arguments[0] as ts.Identifier,
                         KNOWLEDGE_MODULE, 'DRUM_FEEL_PROFILES');
    }
    const idsSym = ck.getSymbolAtLocation(idsDecl.name as ts.Identifier);
    const mapCall = rowsDecl.initializer;
    if (!mapCall || !ts.isCallExpression(mapCall) || !ts.isPropertyAccessExpression(mapCall.expression)
        || mapCall.expression.name.text !== 'map' || mapCall.arguments.length !== 1) {
      throw new Error('rows 的 initializer 不是单参数 .map(...) 调用（fail-closed）');
    }
    const recv = mapCall.expression.expression;
    if (!ts.isIdentifier(recv) || ck.getSymbolAtLocation(recv) !== idsSym) {
      throw new Error(`.map 的接收者不是那个 ids 符号（实得 ${recv.getText(sf)}）——`
        + '构造来源可被换掉，fail-closed');
    }
    const cb = mapCall.arguments[0];
    if (!ts.isArrowFunction(cb) || !cb.body || !ts.isBlock(cb.body)) {
      throw new Error('rows 的 map callback 不是块体箭头函数（fail-closed）');
    }
    const idParam = cb.parameters[0];
    if (!idParam || !ts.isIdentifier(idParam.name) || idParam.name.text !== 'id') {
      throw new Error('map callback 首个形参不是 id（fail-closed）');
    }
    const idSym = ck.getSymbolAtLocation(idParam.name);

    // ② 合格 physical 必须在 callback 的**最终 return 对象**里
    // 只看「最近 function-like 祖先是本 callback」的 return —— 嵌套箭头（如 BANDS.map）
    // 里的 return 不算；本 callback 自己的 return 必须**恰一条**且是末尾那条。
    const ownReturns: ts.ReturnStatement[] = [];
    const collectRet = (n: ts.Node): void => {
      if (ts.isFunctionLike(n) && n !== cb) return;      // 不下钻进嵌套函数
      if (ts.isReturnStatement(n)) ownReturns.push(n);
      n.forEachChild(collectRet);
    };
    cb.body.forEachChild(collectRet);
    const last = cb.body.statements[cb.body.statements.length - 1];
    if (ownReturns.length !== 1) {
      throw new Error(`map callback 自身有 ${ownReturns.length} 条 return，应恰 1 条——`
        + 'early return 可在未来新增值出现时绕过合格 row，fail-closed');
    }
    if (ownReturns[0] !== last) {
      throw new Error('map callback 唯一的 return 不是最后一条语句（fail-closed）');
    }
    if (!last || !ts.isReturnStatement(last) || !last.expression
        || !ts.isObjectLiteralExpression(last.expression)) {
      throw new Error('map callback 的最后一条语句不是 return 对象字面量（fail-closed）');
    }
    // p 须唯一 const，且 initializer 锁到真源取值本身
    let pDecl: ts.VariableDeclaration | undefined;
    let pCount = 0;
    for (const st of cb.body.statements) {
      if (!ts.isVariableStatement(st)) continue;
      const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.name.text !== 'p') continue;
        pCount++;
        if (!isConst) throw new Error('p 不是 const 声明（fail-closed）');
        pDecl = d;
      }
    }
    if (pCount !== 1 || !pDecl) throw new Error(`callback 内 p 声明 ${pCount} 处，应恰 1 处（fail-closed）`);
    if (!pDecl.initializer || pDecl.initializer.getText(sf) !== 'drumFeelProfile(id as never)') {
      throw new Error(`p 的 initializer 应为 drumFeelProfile(id as never)，`
        + `实得 ${pDecl.initializer?.getText(sf)}（fail-closed）`);
    }
    assertImportedFrom(ck, (pDecl.initializer as ts.CallExpression).expression as ts.Identifier,
                       KNOWLEDGE_MODULE, 'drumFeelProfile');
    const pSym = ck.getSymbolAtLocation(pDecl.name as ts.Identifier);

    const rowObj = last.expression;
    if (rowObj.properties.some((pr) => ts.isSpreadAssignment(pr))) {
      throw new Error('row 对象含 spread——字段可被外部 helper 顶替，fail-closed');
    }
    const physHits = rowObj.properties.filter(
      (pr): pr is ts.PropertyAssignment =>
        ts.isPropertyAssignment(pr) && ts.isIdentifier(pr.name) && pr.name.text === 'physical');
    if (physHits.length !== 1) {
      throw new Error(`row 对象的 physical 属性 ${physHits.length} 处，应恰 1 处（fail-closed）`);
    }
    const obj = physHits[0].initializer;
    if (!ts.isObjectLiteralExpression(obj)) {
      throw new Error(`physical 的 initializer 不是对象字面量（实得 ${ts.SyntaxKind[obj.kind]}）——`
        + '无法证明字段来源，fail-closed');
    }
    if (obj.properties.some((pr) => ts.isSpreadAssignment(pr))) {
      throw new Error('physical 对象含 spread——字段可被外部 helper 顶替，fail-closed');
    }

    for (const [kind, prop] of HAND_FIELDS) {
      const hits = obj.properties.filter(
        (pr): pr is ts.PropertyAssignment =>
          ts.isPropertyAssignment(pr) && ts.isIdentifier(pr.name) && pr.name.text === prop);
      if (hits.length !== 1) throw new Error(`physical.${prop} 属性赋值 ${hits.length} 处，应恰 1 处（fail-closed）`);
      const init = hits[0].initializer;
      if (!ts.isCallExpression(init) || !ts.isIdentifier(init.expression)) {
        throw new Error(`${prop} 的 initializer 不是 HAND_ID 调用本身（实得 ${ts.SyntaxKind[init.kind]}）——`
          + '返回值未被消费，fail-closed');
      }
      let gotSym = ck.getSymbolAtLocation(init.expression);
      if (gotSym && gotSym.flags & ts.SymbolFlags.Alias) gotSym = ck.getAliasedSymbol(gotSym);
      if (init.expression.text !== 'HAND_ID' || gotSym !== wantSym) {
        throw new Error(`${prop} 的 callee 不是文件级 HAND_ID 声明本身`
          + `（实得标识符 ${init.expression.text}，符号身份不符）——可能被局部重绑，fail-closed`);
      }
      const a = init.arguments;
      if (a.length !== 3) throw new Error(`${prop} 的 HAND_ID 实参数=${a.length}，应为 3（fail-closed）`);
      if (!ts.isStringLiteral(a[0]) || a[0].text !== kind) {
        throw new Error(`${prop} 的 kind 实参应为 '${kind}'（fail-closed）`);
      }
      const want = `p.physical.${prop}`;
      if (!ts.isPropertyAccessExpression(a[1]) || a[1].getText(sf) !== want) {
        throw new Error(`${prop} 的源字段实参应为 ${want}，实得 ${a[1].getText(sf)}（fail-closed）`);
      }
      // ③ p 的根标识符须声明在 callback 内；id 须是 callback 首形参本身（按符号）
      let root: ts.Node = a[1];
      while (ts.isPropertyAccessExpression(root)) root = root.expression;
      if (!ts.isIdentifier(root) || ck.getSymbolAtLocation(root) !== pSym) {
        throw new Error(`${prop} 的源字段根标识符不是那个 p 符号（fail-closed）`);
      }
      if (!ts.isIdentifier(a[2]) || a[2].text !== 'id' || ck.getSymbolAtLocation(a[2]) !== idSym) {
        throw new Error(`${prop} 的 id 实参应为 callback 首形参 id 本身（fail-closed）`);
      }
    }

    // ⑥ p 的**引用面**：除声明名外，每处引用只能作为属性访问的对象。
    //    这挡住 `SANITIZE(p)`（p 整体逃逸给外部 helper 预处理）——五轮 Finding 1 的
    //    第四个反例：HAND_ID 照调，但拿到的已不是真源原值，未来未知手型会先被归一化。
    //    生产侧只用 p.velocity / p.timing / p.phrase / p.physical.* 等属性读，天然满足。
    {
      const stray: string[] = [];
      const scanP = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && n.text === 'p' && n !== pDecl.name
            && ck.getSymbolAtLocation(n) === pSym) {
          const par = n.parent;
          if (!par || !ts.isPropertyAccessExpression(par) || par.expression !== n) {
            stray.push(par ? ts.SyntaxKind[par.kind] : '?');
          }
        }
        n.forEachChild(scanP);
      };
      cb.body.forEachChild(scanP);
      if (stray.length) {
        throw new Error(`p 在 callback 内被额外引用 ${JSON.stringify(stray)}——`
          + '整体逃逸给外部 helper 后可先被归一化，HAND_ID 拿到的已非真源原值，fail-closed');
      }
      // ★ 六轮 Finding 1：`p` 只作属性访问对象**不够**——`p.physical` 子对象仍可整体逃逸
      //   （`SANITIZE(p.physical)`、`const q = p.physical; SANITIZE(q)` 均实测 ACCEPT）。
      //   改为**终端叶契约**：`p.physical` 只允许直达四个已知叶，本身不得作实参 /
      //   initializer / 返回值 / 更深动态索引的基底。
      {
        const bad: string[] = [];
        const leafHits = new Map<string, number>();
        const scanPhys = (n: ts.Node): void => {
          if (ts.isPropertyAccessExpression(n) && n.name.text === 'physical'
              && ts.isIdentifier(n.expression) && ck.getSymbolAtLocation(n.expression) === pSym) {
            const par = n.parent;
            if (!par || !ts.isPropertyAccessExpression(par) || par.expression !== n
                || !PHYSICAL_LEAVES.includes(par.name.text)) {
              bad.push(par ? `${ts.SyntaxKind[par.kind]}:${par.getText(sf).slice(0, 40)}` : '?');
            } else {
              // ★★ 七轮 Finding 3：只锁叶名**不够**——`p.physical.maxHandsAtOnce = 2;` 实测
              //    ACCEPT。现有 8 行本来全是 2，输出与 golden 都不变；将来真源变 3 时会先被
              //    归一化成 2，让本该 fail-closed 的恒 2 断言失效。故每个叶都要锁**使用上下文**。
              const leaf = par.name.text;
              leafHits.set(leaf, (leafHits.get(leaf) ?? 0) + 1);
              const gp = par.parent;
              const isWrite = gp
                && ((ts.isBinaryExpression(gp) && gp.left === par
                     && gp.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
                     && gp.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
                    || ts.isPrefixUnaryExpression(gp) || ts.isPostfixUnaryExpression(gp)
                    || ts.isDeleteExpression(gp));
              if (isWrite) {
                bad.push(`write:${gp!.getText(sf).slice(0, 40)}`);
              } else if (gp && ts.isCallExpression(gp) && gp.expression === par) {
                bad.push(`callee:${gp.getText(sf).slice(0, 40)}`);
              } else if (gp && (ts.isVariableDeclaration(gp) || ts.isSpreadElement(gp))) {
                bad.push(`alias:${gp.getText(sf).slice(0, 40)}`);   // 别名逃逸
              } else if (leaf === 'maxHandsAtOnce') {
                // 八轮 Finding 2：只查操作符是 `!==` **不够**——`const ignored =
                // p.physical.maxHandsAtOnce !== 2;` 实测 ACCEPT，比较结果没被消费，
                // 恒 2 断言等于没有。锁**完整形态**：叶为 `!==` 左值、右值字面量 2、
                // 该比较就是 `if` 的条件、then 分支抛错。
                const okCmp = gp && ts.isBinaryExpression(gp) && gp.left === par
                  && gp.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
                  && ts.isNumericLiteral(gp.right) && gp.right.text === '2';
                const ifSt = okCmp ? gp!.parent : undefined;
                const okIf = ifSt && ts.isIfStatement(ifSt) && ifSt.expression === gp
                  && !ifSt.elseStatement;
                let throws = false;
                if (okIf) {
                  const findThrow = (x: ts.Node): void => {
                    if (ts.isThrowStatement(x)) throws = true;
                    x.forEachChild(findThrow);
                  };
                  findThrow((ifSt as ts.IfStatement).thenStatement);
                }
                if (!okCmp || !okIf || !throws) {
                  bad.push('maxHandsAtOnce 非「if (… !== 2) throw」恒值校验形态:'
                    + `${gp ? gp.getText(sf).slice(0, 48) : '?'}`);
                }
              } else if (leaf === 'chokeOpenHatWithClosed') {
                // 八轮 Finding 2：只验「父节点是同名 PropertyAssignment」**不够**——
                // 另放一个 decoy 对象承载同名属性即可 ACCEPT。要求它**就是**此前结构定位到的
                // physical 对象字面量（`obj`）里那个唯一同名属性节点（节点身份，不是名字相等）。
                const inObj = obj.properties.filter(
                  (pr): pr is ts.PropertyAssignment =>
                    ts.isPropertyAssignment(pr) && ts.isIdentifier(pr.name)
                    && pr.name.text === 'chokeOpenHatWithClosed');
                if (!gp || inObj.length !== 1 || inObj[0] !== gp || gp.initializer !== par) {
                  bad.push('chokeOpenHatWithClosed 不是 physical 对象内那个唯一同名属性:'
                    + `${gp ? gp.getText(sf).slice(0, 48) : '?'}`);
                }
              } else {
                // 两个手型叶：只允许作对应 HAND_ID 调用的第 2 实参
                if (!gp || !ts.isCallExpression(gp) || gp.arguments[1] !== par
                    || !ts.isIdentifier(gp.expression) || gp.expression.text !== 'HAND_ID') {
                  bad.push(`${leaf} 非 HAND_ID 第二实参:${gp ? gp.getText(sf).slice(0, 40) : '?'}`);
                }
              }
            }
          }
          n.forEachChild(scanPhys);
        };
        cb.body.forEachChild(scanPhys);
        if (bad.length) {
          throw new Error(`p.physical 叶的终端只读上下文违例 ${JSON.stringify(bad)}——`
            + '写入/逃逸/换上下文后可先被归一化，fail-closed');
        }
        for (const leaf of PHYSICAL_LEAVES) {
          const hits = leafHits.get(leaf) ?? 0;
          if (hits !== 1) {
            throw new Error(`p.physical.${leaf} 出现 ${hits} 次，应恰 1 次（fail-closed）`);
          }
        }
      }
      // 四个叶各恰 1 次已由上面的 leafHits 统一断言（原先另有一处只覆盖两个手型叶，已合并）
    }

    // ⑤ 函数最终 return { …, profiles: rows }
    const fnLast = body.statements[body.statements.length - 1];
    if (!fnLast || !ts.isReturnStatement(fnLast) || !fnLast.expression
        || !ts.isObjectLiteralExpression(fnLast.expression)) {
      throw new Error('buildFeelProfiles 的最后一条语句不是 return 对象字面量（fail-closed）');
    }
    const profProps = fnLast.expression.properties.filter(
      (pr): pr is ts.PropertyAssignment =>
        ts.isPropertyAssignment(pr) && ts.isIdentifier(pr.name) && pr.name.text === 'profiles');
    if (profProps.length !== 1 || !ts.isIdentifier(profProps[0].initializer)
        || profProps[0].initializer.text !== 'rows') {
      throw new Error('最终 return 的 profiles 不是直接引用 rows（fail-closed）');
    }
    const rowsSym = ck.getSymbolAtLocation(rowsDecl.name as ts.Identifier);
    if (ck.getSymbolAtLocation(profProps[0].initializer) !== rowsSym) {
      throw new Error('最终 return 的 profiles 引用的不是那个 rows 符号（fail-closed）');
    }

    // ★★ 六轮 Finding 2：以上全在证明 `buildFeelProfiles` 的**函数体**，却没证明 exporter
    //    真的消费它。把消费点改成 `const feelKb = BAD_BUILD();` 并保留合格的
    //    buildFeelProfiles 作 decoy，上一版实测 ACCEPT —— 被验证的函数根本没进产物。
    //    故补：消费点 `feelKb` 的 initializer 必须是该函数**符号**的零参直接调用，
    //    且该函数符号的全部值引用只允许「声明名 + 这一处调用」（禁别名/逃逸/额外调用）。
    {
      const fnSym = ck.getSymbolAtLocation(fn.name!);
      // ★★ 七轮 Finding 2：上一版只「按文本找最后一个名为 feelKb 的声明」并核 initializer，
      //    没查唯一性/const/是否被重赋值/最终 JSON 是否真来自它。判据层实测三例 ACCEPT：
      //    `let feelKb` / 初始化后 `feelKb = BAD_KB` / 最终 profiles 改走 `BAD_KB.profiles`。
      //    于是仍可让合格 builder 当 decoy、另一路投影进产物，且当前 8 行同值 ⇒ golden 不报警。
      let feelKbDecl: ts.VariableDeclaration | undefined;
      let feelKbCount = 0;
      const findFeelKb = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'feelKb') {
          feelKbCount++;
          const list = n.parent;
          if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) {
            throw new Error('feelKb 不是 const 声明——可被重新赋值，fail-closed');
          }
          feelKbDecl = n;
        }
        n.forEachChild(findFeelKb);
      };
      sf.forEachChild(findFeelKb);
      if (!feelKbDecl) throw new Error('未找到消费点 const feelKb = …（fail-closed）');
      if (feelKbCount !== 1) {
        throw new Error(`feelKb 声明 ${feelKbCount} 处，应恰 1 处（fail-closed）`);
      }
      const feelKbInit: ts.Expression | undefined = feelKbDecl.initializer;
      if (!feelKbInit) throw new Error('feelKb 无 initializer（fail-closed）');
      if (!ts.isCallExpression(feelKbInit) || !ts.isIdentifier(feelKbInit.expression)
          || feelKbInit.arguments.length !== 0
          || ck.getSymbolAtLocation(feelKbInit.expression) !== fnSym) {
        throw new Error(`feelKb 的 initializer 不是被验证的 buildFeelProfiles 零参直接调用`
          + `（实得 ${feelKbInit.getText(sf)}）——被验证的函数未进产物，fail-closed`);
      }
      const refs: string[] = [];
      const scanFn = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && n.text === 'buildFeelProfiles'
            && n !== fn!.name && n !== (feelKbInit as ts.CallExpression).expression
            && ck.getSymbolAtLocation(n) === fnSym) {
          refs.push(n.parent ? ts.SyntaxKind[n.parent.kind] : '?');
        }
        n.forEachChild(scanFn);
      };
      sf.forEachChild(scanFn);
      if (refs.length) {
        throw new Error(`buildFeelProfiles 存在额外引用 ${JSON.stringify(refs)}——`
          + '可被别名/额外调用绕开唯一消费点，fail-closed');
      }

      // feelKb 符号的**全部引用**只允许 `feelKb.<字段>` 读取，且该读取的**终端上下文**受限。
      // 八轮 Finding 1：上一版只查「直接父节点是 PropertyAccess」+「全 SourceFile 按属性名
      // 计数三字段」，四例实测 ACCEPT：`feelKb.profiles = BAD` / `const alias = feelKb.profiles`
      // / `profileIdx` 改从 `BAD_KB.profiles` 建表 / 三字段改走 BAD_KB 而另放 decoy 对象承载
      // 三次 `feelKb.<field>`（「各恰一处」被 decoy 代打）。故本版**结构定位**唯一的
      // `out.drumFeelProfile` 对象，三字段必须是**该对象**的直接属性，并锁 profileIdx 支链。
      const kbSym = ck.getSymbolAtLocation(feelKbDecl.name as ts.Identifier);

      // 结构定位：唯一一个 initializer 含 `drumFeelProfile` 属性的对象字面量声明
      const docDecls: ts.VariableDeclaration[] = [];
      const findDoc = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && n.initializer
            && ts.isObjectLiteralExpression(n.initializer)
            && n.initializer.properties.some((pr) => ts.isPropertyAssignment(pr)
              && ts.isIdentifier(pr.name) && pr.name.text === 'drumFeelProfile')) {
          docDecls.push(n);
        }
        n.forEachChild(findDoc);
      };
      sf.forEachChild(findDoc);
      if (docDecls.length !== 1) {
        throw new Error(`含 drumFeelProfile 段的产物对象声明 ${docDecls.length} 处，应恰 1 处`
          + '——无法判定哪个进 JSON，fail-closed');
      }
      const dfpProps = (docDecls[0].initializer as ts.ObjectLiteralExpression).properties
        .filter((pr): pr is ts.PropertyAssignment => ts.isPropertyAssignment(pr)
          && ts.isIdentifier(pr.name) && pr.name.text === 'drumFeelProfile');
      if (dfpProps.length !== 1 || !ts.isObjectLiteralExpression(dfpProps[0].initializer)) {
        throw new Error('产物对象里的 drumFeelProfile 不是唯一的对象字面量属性（fail-closed）');
      }
      const dfpObj = dfpProps[0].initializer;
      const dfpProp = (key: string): ts.PropertyAssignment | undefined => {
        const hits = dfpObj.properties.filter((pr): pr is ts.PropertyAssignment =>
          ts.isPropertyAssignment(pr) && ts.isIdentifier(pr.name) && pr.name.text === key);
        return hits.length === 1 ? hits[0] : undefined;
      };

      // profileIdx 支链：`const profileIdx = new Map(feelKb.profiles.map(...))`
      let idxDecl: ts.VariableDeclaration | undefined;
      let idxCount = 0;
      const findIdx = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'profileIdx') {
          idxCount++; idxDecl = n;
        }
        n.forEachChild(findIdx);
      };
      sf.forEachChild(findIdx);
      if (idxCount !== 1 || !idxDecl) throw new Error(`profileIdx 声明 ${idxCount} 处，应恰 1 处（fail-closed）`);
      let idxMapRecv: ts.PropertyAccessExpression | undefined;
      {
        const init = idxDecl.initializer;
        const arg = init && ts.isNewExpression(init) && ts.isIdentifier(init.expression)
          && init.expression.text === 'Map' ? init.arguments?.[0] : undefined;
        const mapCall2 = arg && ts.isCallExpression(arg) && ts.isPropertyAccessExpression(arg.expression)
          && arg.expression.name.text === 'map' ? arg : undefined;
        const recv2 = mapCall2 ? (mapCall2.expression as ts.PropertyAccessExpression).expression : undefined;
        if (!recv2 || !ts.isPropertyAccessExpression(recv2) || recv2.name.text !== 'profiles'
            || !ts.isIdentifier(recv2.expression) || ck.getSymbolAtLocation(recv2.expression) !== kbSym) {
          throw new Error(`profileIdx 不是 new Map(feelKb.profiles.map(...))（实得 `
            + `${idxDecl.initializer?.getText(sf).slice(0, 60)}）——支链可被换成第二 KB，fail-closed`);
        }
        idxMapRecv = recv2;
      }

      // profileByContract 支链：`buildProfileByContract(profileIdx)`，且 effective/fallback 直取
      {
        const idxSym = ck.getSymbolAtLocation(idxDecl.name as ts.Identifier);
        let pbcDecl: ts.VariableDeclaration | undefined;
        let pbcCount = 0;
        const findPbc = (n: ts.Node): void => {
          if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)
              && n.name.text === 'profileByContract') { pbcCount++; pbcDecl = n; }
          n.forEachChild(findPbc);
        };
        sf.forEachChild(findPbc);
        if (pbcCount !== 1 || !pbcDecl) throw new Error(`profileByContract 声明 ${pbcCount} 处，应恰 1 处（fail-closed）`);
        const pi = pbcDecl.initializer;
        if (!pi || !ts.isCallExpression(pi) || !ts.isIdentifier(pi.expression)
            || pi.expression.text !== 'buildProfileByContract' || pi.arguments.length !== 1
            || !ts.isIdentifier(pi.arguments[0])
            || ck.getSymbolAtLocation(pi.arguments[0]) !== idxSym) {
          throw new Error('profileByContract 不是 buildProfileByContract(profileIdx)（fail-closed）');
        }
        const pbcSym = ck.getSymbolAtLocation(pbcDecl.name as ts.Identifier);
        for (const [jsonKey, field] of [['effectiveByContract', 'effective'],
                                       ['fallbackLeaves', 'fallbackLeaves']] as const) {
          const pr = dfpProp(jsonKey);
          const ini = pr?.initializer;
          if (!ini || !ts.isPropertyAccessExpression(ini) || ini.name.text !== field
              || !ts.isIdentifier(ini.expression)
              || ck.getSymbolAtLocation(ini.expression) !== pbcSym) {
            throw new Error(`drumFeelProfile.${jsonKey} 不是直接取自 profileByContract.${field}（fail-closed）`);
          }
        }
      }

      // 最终三字段：必须是 **dfpObj 内**那个唯一同名属性，且 initializer 就是 feelKb.<字段>
      const WANT_JSON: Array<[string, string]> = [
        ['knowledgeSourceOrder', 'sourceOrder'],
        ['phraseBarRoleOrder', 'roleOrder'],
        ['profiles', 'profiles'],
      ];
      const allowedKbReads = new Set<ts.Node>([idxMapRecv!]);
      for (const [jsonKey, kbField] of WANT_JSON) {
        const pr = dfpProp(jsonKey);
        const ini = pr?.initializer;
        if (!pr || !ini || !ts.isPropertyAccessExpression(ini) || ini.name.text !== kbField
            || !ts.isIdentifier(ini.expression) || ck.getSymbolAtLocation(ini.expression) !== kbSym) {
          throw new Error(`drumFeelProfile.${jsonKey} 不是该产物对象内直接取自 feelKb.${kbField}`
            + '（可能被 decoy 对象代打或改走第二 KB），fail-closed');
        }
        allowedKbReads.add(ini);
      }

      // feelKb 的全部引用：必须是白名单里的那几处字段读取，别的（含写入/别名）一律拒
      const kbBad: string[] = [];
      const scanKb = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && n.text === 'feelKb' && n !== feelKbDecl!.name
            && ck.getSymbolAtLocation(n) === kbSym) {
          const par = n.parent;
          if (!par || !ts.isPropertyAccessExpression(par) || par.expression !== n
              || !allowedKbReads.has(par)) {
            kbBad.push(par ? `${ts.SyntaxKind[par.kind]}:${par.getText(sf).slice(0, 48)}` : '?');
          }
        }
        n.forEachChild(scanKb);
      };
      sf.forEachChild(scanKb);
      if (kbBad.length) {
        throw new Error(`feelKb 存在白名单外的引用 ${JSON.stringify(kbBad)}——`
          + '字段写入/别名/整体逃逸/第二条投影链，fail-closed');
      }
    }

    // ④ rows 的全部引用只允许两处：声明名 + profiles: rows
    const allowed = new Set<ts.Node>([rowsDecl.name, profProps[0].initializer]);
    const strayed: string[] = [];
    const scanRows = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n.text === 'rows' && !allowed.has(n)
          && ck.getSymbolAtLocation(n) === rowsSym) {
        strayed.push(n.parent ? ts.SyntaxKind[n.parent.kind] : '?');
      }
      n.forEachChild(scanRows);
    };
    body.forEachChild(scanRows);
    if (strayed.length) {
      throw new Error(`rows 存在额外引用 ${JSON.stringify(strayed)}——构造结果可能在返回前被改写`
        + '或逃逸到外部 helper，fail-closed');
    }
  };

  /* 单文件内存 Program——符号身份判据需要 TypeChecker。noLib/noResolve：本谓词只关心
   * 文件内的声明解析（HAND_ID 是否被局部重绑），不需要 lib 与模块解析。 */
  const mkProgram = (src: string): [ts.Program, ts.SourceFile] => {
    const name = 'e.ts';
    const sf0 = ts.createSourceFile(name, src, ts.ScriptTarget.ES2022, true);
    const host: ts.CompilerHost = {
      getSourceFile: (f) => (f === name ? sf0 : undefined),
      getDefaultLibFileName: () => 'lib.d.ts',
      writeFile: () => { /* 不产出 */ },
      getCurrentDirectory: () => '',
      getDirectories: () => [],
      getCanonicalFileName: (f) => f,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      fileExists: (f) => f === name,
      readFile: (f) => (f === name ? src : undefined),
    };
    const prog = ts.createProgram([name],
      { noResolve: true, noLib: true, target: ts.ScriptTarget.ES2022 }, host);
    const sf = prog.getSourceFile(name);
    if (!sf) throw new Error('内存 Program 未产出 SourceFile（fail-closed）');
    return [prog, sf];
  };
  const check = (src: string): void => assertHandDelegation(...mkProgram(src));
  /* 合成源必须是**完整合法形态**，只注入单点缺陷；否则负向会被上游结构检查代打
   * ——这一课本任务已栽过三次。故用**统一构造器** mkSrc()，收紧契约时只改一处。 */
  const IMPORT_STUB =
    `import { DRUM_FEEL_PROFILES, drumFeelProfile } from '${KNOWLEDGE_MODULE}';\n`;
  const HAND_STUB = "function HAND_ID(k: any, v: any, i: any): number { return 0; }\n";
  const OKTK = "HAND_ID('timekeeper', p.physical.timekeeperHand, id)";
  const OKGH = "HAND_ID('ghost', p.physical.ghostHand, id)";
  type Parts = {
    pre?: string;        // buildFeelProfiles 之外
    head?: string;       // 函数体首（rows 之前）
    idsInit?: string;    // ids 的 initializer
    rowsKw?: string;     // const | let
    recv?: string;       // .map 的接收者
    cbHead?: string;     // callback 首（p 之前/之后追加的语句）
    pInit?: string;      // p 的 initializer
    physical?: string;   // physical 的 initializer 全文
    tk?: string; gh?: string;
    rowExtra?: string;   // row 对象内追加属性
    tail?: string;       // rows 之后、return 之前
    ret?: string;        // 最终 return 全文
    consume?: string;    // 消费点 feelKb 的 initializer
    kbKw?: string;       // const | let
    kbTail?: string;     // feelKb 之后追加的语句
    jsonSrc?: string; jsonRole?: string; jsonProfiles?: string;   // 最终 JSON 三字段
    importFrom?: string; importAlias?: string;                    // import 形态
    maxHands?: string;   // maxHandsAtOnce 的使用语句
    idxInit?: string; pbcInit?: string;                 // 支链
    docKw?: string; docExtra?: string;                  // 产物对象
    jsonEff?: string; jsonFb?: string;                  // effective / fallback 字段
    choke?: string;      // chokeOpenHatWithClosed 的 initializer
  };
  const mkSrc = (o: Parts = {}): string =>
    (o.importFrom || o.importAlias
      ? `import { DRUM_FEEL_PROFILES, ${o.importAlias ?? 'drumFeelProfile'} } from `
        + `'${o.importFrom ?? KNOWLEDGE_MODULE}';\n`
      : IMPORT_STUB) + HAND_STUB + (o.pre ?? '') + '\n'
    + 'function buildFeelProfiles() {\n'
    + `  ${o.head ?? ''}\n`
    + `  const ids = ${o.idsInit ?? 'Object.keys(DRUM_FEEL_PROFILES)'};\n`
    + `  ${o.rowsKw ?? 'const'} rows = ${o.recv ?? 'ids'}.map((id: any, idx: any) => {\n`
    + `    const p = ${o.pInit ?? 'drumFeelProfile(id as never)'};\n`
    // 生产形态：maxHandsAtOnce 恒值校验（不物化）
    + `    ${o.maxHands ?? "if (p.physical.maxHandsAtOnce !== 2) throw new Error('x');"}\n`
    + `    ${o.cbHead ?? ''}\n`
    + '    return { '
    + `physical: ${o.physical ?? `{\n      timekeeperHand: ${o.tk ?? OKTK},\n      ghostHand: ${o.gh ?? OKGH},\n`
      + `      chokeOpenHatWithClosed: ${o.choke ?? 'p.physical.chokeOpenHatWithClosed'},\n    }`}`
    + `${o.rowExtra ?? ''} };\n`
    + '  });\n'
    + `  ${o.tail ?? ''}\n`
    + `  ${o.ret ?? 'return { profiles: rows };'}\n}\n`
    + `${o.kbKw ?? 'const'} feelKb = ${o.consume ?? 'buildFeelProfiles()'};\n`
    + `const profileIdx = ${o.idxInit ?? 'new Map(feelKb.profiles.map((q: any) => [q.name, q.id]))'};\n`
    + `const profileByContract = ${o.pbcInit ?? 'buildProfileByContract(profileIdx)'};\n`
    + `${o.kbTail ?? ''}\n`
    + `${o.docKw ?? 'const'} out = { ${o.docExtra ?? ''}drumFeelProfile: {\n`
    + `  knowledgeSourceOrder: ${o.jsonSrc ?? 'feelKb.sourceOrder'},\n`
    + `  phraseBarRoleOrder: ${o.jsonRole ?? 'feelKb.roleOrder'},\n`
    + `  profiles: ${o.jsonProfiles ?? 'feelKb.profiles'},\n`
    + `  effectiveByContract: ${o.jsonEff ?? 'profileByContract.effective'},\n`
    + `  fallbackLeaves: ${o.jsonFb ?? 'profileByContract.fallbackLeaves'},\n} };\n`;

  it('生产 buildFeelProfiles 通过委托证明（完整正向数据流契约）', () => {
    const src = readFileSync(new URL(import.meta.url).pathname, 'utf8');
    expect(() => check(src)).not.toThrow();
  });
  it('合成的合法形态也通过（防谓词过严导致人去放宽它）', () => {
    expect(() => check(mkSrc())).not.toThrow();
  });

  const BYPASS: Array<[string, Parts, RegExp]> = [
    ['逗号表达式丢弃返回值（二轮 F2 原型）',
      { tk: `(${OKTK}, BAD_HAND(p.physical.timekeeperHand))` }, /initializer 不是 HAND_ID 调用本身/],
    ['三元包住调用', { tk: `cond ? ${OKTK} : 1` }, /initializer 不是 HAND_ID 调用本身/],
    ['kind 实参写反', { tk: "HAND_ID('ghost', p.physical.timekeeperHand, id)" }, /kind 实参应为 'timekeeper'/],
    ['源字段接错（两字段互换）', { tk: "HAND_ID('timekeeper', p.physical.ghostHand, id)" },
      /源字段实参应为 p\.physical\.timekeeperHand/],
    ['源字段被中间变量代理', { tk: "HAND_ID('timekeeper', v, id)" },
      /源字段实参应为 p\.physical\.timekeeperHand/],
    ['id 实参被字面量顶替', { tk: "HAND_ID('timekeeper', p.physical.timekeeperHand, 'x')" },
      /id 实参应为 callback 首形参 id 本身/],
    ['少传一个实参', { tk: "HAND_ID('timekeeper', p.physical.timekeeperHand)" }, /实参数=2/],
    ['直接内联三元（F7 原缺陷形态）', { tk: "p.physical.timekeeperHand === 'right' ? 0 : 1" },
      /手写手型字面量/],
    // 三轮 Finding 1 的两个维度
    ['函数内局部同名重绑 HAND_ID（符号身份）',
      { head: 'const HAND_ID = (k: any, v: any, i: any): number => BAD(k, v, i);' },
      /callee 不是文件级 HAND_ID 声明本身/],
    ['physical 用 spread', { physical: '{ ...BAD_PHYSICAL(p, id) }' }, /physical 对象含 spread/],
    ['physical 的 initializer 不是对象字面量', { physical: 'BAD_PHYSICAL(p, id)' },
      /physical 的 initializer 不是对象字面量/],
    ['row 对象含 spread', { rowExtra: ', ...BAD_ROW(p, id)' }, /row 对象含 spread/],
    // 四轮 Finding 1：构造→返回的数据流
    ['返回前 rows.forEach 就地改写（四轮原型）',
      { tail: 'rows.forEach((r: any) => { r.physical.timekeeperHand = 0; r.physical.ghostHand = 0; });' },
      /rows 存在额外引用/],
    ['rows 逃逸给外部弱 helper', { tail: 'BAD_REWRITE(rows, ids);' }, /rows 存在额外引用/],
    ['profiles 二次 map', { ret: 'return { profiles: rows.map((r: any) => BAD(r)) };' },
      /rows 存在额外引用|profiles 不是直接引用 rows/],
    // ★★ 五轮 Finding 1：实现曾比注释承诺的契约更宽，四个单点反例实测全 ACCEPT
    ['rows 用 let（可被重新赋值）', { rowsKw: 'let' }, /rows 不是 const 声明/],
    ['.map 接收者不是 ids', { recv: 'OTHER_SRC' }, /接收者不是那个 ids 符号/],
    ['ids 来源被换掉', { idsInit: 'OTHER_KEYS()' }, /ids 的 initializer 应为 Object\.keys/],
    ['callback 内 early return（未来新增值时绕过合格 row）',
      { cbHead: 'if (SKIP(id)) return { physical: BAD_PHYSICAL(p, id) };' },
      /自身有 2 条 return，应恰 1 条/],
    ['p 被 sanitizer 预处理（HAND_ID 拿到的已非真源原值）',
      { cbHead: 'SANITIZE(p);' }, /p 在 callback 内被额外引用/],
    // ★★ 七轮 Finding 1/2/3
    ['import 路径子串 shim（…KnowledgeEvil）', { importFrom: KNOWLEDGE_MODULE + 'Evil' },
      /应\*\*精确等于\*\*|精确等于/],
    ['import 别名遮蔽（weakProfile as drumFeelProfile）',
      { importAlias: 'weakProfile as drumFeelProfile' }, /实际导入的 export 是 weakProfile/],
    ['文件级 Object 重绑', { pre: 'const Object = BAD_OBJECT;' },
      /Object 在本文件内被重新声明/],
    ['feelKb 用 let', { kbKw: 'let' }, /feelKb 不是 const 声明/],
    ['feelKb 被重赋值', { kbKw: 'let', kbTail: 'feelKb = BAD_KB;' }, /feelKb 不是 const 声明/],
    ['feelKb 整体逃逸', { kbTail: 'SEND(feelKb);' }, /feelKb 存在白名单外的引用/],
    ['最终 profiles 改走第二 KB', { jsonProfiles: 'BAD_KB.profiles' },
      /profiles 不是该产物对象内直接取自 feelKb\.profiles/],
    ['最终 knowledgeSourceOrder 改走第二 KB', { jsonSrc: 'BAD_KB.sourceOrder' },
      /knowledgeSourceOrder 不是该产物对象内直接取自/],
    ['p.physical.maxHandsAtOnce 写入', { cbHead: 'p.physical.maxHandsAtOnce = 2;' },
      /终端只读上下文违例/],
    ['p.physical.chokeOpenHatWithClosed 换上下文（不落 row 属性）',
      { choke: 'NORMALIZE(p.physical.chokeOpenHatWithClosed)' },
      /chokeOpenHatWithClosed 不是 physical 对象内那个唯一同名属性/],
    ['p.physical.maxHandsAtOnce 换上下文（不做恒值校验）',
      { maxHands: 'const mh = p.physical.maxHandsAtOnce;' },
      /alias:|maxHandsAtOnce 非恒值校验上下文/],
    // ★★ 八轮 Finding 1/2
    ['feelKb 字段被写入', { kbTail: 'feelKb.profiles = BAD_PROFILES;' },
      /feelKb 存在白名单外的引用/],
    ['feelKb 字段被取别名', { kbTail: 'const alias = feelKb.profiles;' },
      /feelKb 存在白名单外的引用/],
    ['profileIdx 改从第二 KB 建表',
      { idxInit: 'new Map(BAD_KB.profiles.map((q: any) => [q.name, q.id]))' },
      /profileIdx 不是 new Map\(feelKb\.profiles\.map/],
    ['profileByContract 不吃 profileIdx', { pbcInit: 'buildProfileByContract(BAD_IDX)' },
      /profileByContract 不是 buildProfileByContract\(profileIdx\)/],
    ['effectiveByContract 改走别处', { jsonEff: 'BAD_PBC.effective' },
      /effectiveByContract 不是直接取自 profileByContract\.effective/],
    ['三字段改走第二 KB + decoy 对象承载 feelKb 读取（各恰一处被代打）',
      { jsonSrc: 'BAD_KB.sourceOrder', jsonRole: 'BAD_KB.roleOrder', jsonProfiles: 'BAD_KB.profiles',
        kbTail: 'const decoy = { knowledgeSourceOrder: feelKb.sourceOrder, '
          + 'phraseBarRoleOrder: feelKb.roleOrder, profiles: feelKb.profiles };' },
      /knowledgeSourceOrder 不是该产物对象内直接取自|feelKb 存在白名单外的引用/],
    ['产物对象出现两处（无法判定哪个进 JSON）',
      { kbTail: 'const other = { drumFeelProfile: {} };' },
      /含 drumFeelProfile 段的产物对象声明 2 处/],
    ['maxHandsAtOnce 比较结果未被消费（恒值断言形同虚设）',
      { maxHands: 'const ignored = p.physical.maxHandsAtOnce !== 2;' },
      /alias:|非「if \(… !== 2\) throw」恒值校验形态/],
    ['maxHandsAtOnce 的 if 分支不抛错',
      { maxHands: 'if (p.physical.maxHandsAtOnce !== 2) NOOP();' },
      /非「if \(… !== 2\) throw」恒值校验形态/],
    ['maxHandsAtOnce 右值不是字面量 2',
      { maxHands: "if (p.physical.maxHandsAtOnce !== LIMIT) throw new Error('x');" },
      /非「if \(… !== 2\) throw」恒值校验形态/],
    // ★★ 六轮 Finding 2：消费点绑定
    ['消费点被重定向到 BAD_BUILD()（decoy 仍在）', { consume: 'BAD_BUILD()' },
      /不是被验证的 buildFeelProfiles 零参直接调用/],
    ['消费点传参（不是零参直接调用）', { consume: 'buildFeelProfiles(EXTRA)' },
      /不是被验证的 buildFeelProfiles 零参直接调用/],
    ['函数符号被额外引用（别名逃逸）', { pre: 'const alias = buildFeelProfiles;' },
      /buildFeelProfiles 存在额外引用/],
    ['p 的来源被换掉', { pInit: 'SANITIZED_PROFILE(id)' },
      /p 的 initializer 应为 drumFeelProfile\(id as never\)/],
    // ★★ 六轮 Finding 1：p 只作属性访问对象不够，p.physical 子对象仍可整体逃逸
    ['SANITIZE(p.physical) 子对象逃逸', { cbHead: 'SANITIZE(p.physical);' },
      /p\.physical 叶的终端只读上下文违例|p\.physical 未直达已知叶/],
    ['const q = p.physical 别名逃逸', { cbHead: 'const q = p.physical; SANITIZE(q);' },
      /p\.physical 叶的终端只读上下文违例|p\.physical 未直达已知叶/],
    ['p.physical 动态索引', { cbHead: "const w = p.physical['timekeeperHand'];" },
      /p\.physical 叶的终端只读上下文违例|p\.physical 未直达已知叶/],
    ['p.physical 访问未知叶', { cbHead: 'const w = p.physical.somethingElse;' },
      /p\.physical 叶的终端只读上下文违例|p\.physical 未直达已知叶/],
    // 真源按符号锁（文本相同 ≠ 符号相同）
    ['drumFeelProfile 被局部重绑',
      { head: 'const drumFeelProfile = (x: any): any => BAD_PROFILE(x);' },
      /drumFeelProfile 不是顶层 import 的符号/],
    ['DRUM_FEEL_PROFILES 被局部重绑', { head: 'const DRUM_FEEL_PROFILES = BAD_TABLE;' },
      /DRUM_FEEL_PROFILES 不是顶层 import 的符号/],
    ['Object 被局部重绑', { head: 'const Object = BAD_OBJECT;' },
      /Object 在本文件内被重新声明/],
  ];
  it.each(BYPASS)('委托证明拒绝：%s', (_name, parts, msg) => {
    expect(() => check(mkSrc(parts))).toThrow(msg);
  });

  it('委托证明拒绝：physical 内字段缺失 / 重复', () => {
    expect(() => check(mkSrc({ physical: `{ ghostHand: ${OKGH} }` })))
      .toThrow(/physical\.timekeeperHand 属性赋值 0 处/);
    expect(() => check(mkSrc({ physical: `{ timekeeperHand: ${OKTK}, timekeeperHand: ${OKTK}, ghostHand: ${OKGH} }` })))
      .toThrow(/physical\.timekeeperHand 属性赋值 2 处/);
  });
  it('委托证明拒绝：rows 不是 ids.map(...) 直接构造', () => {
    expect(() => check(IMPORT_STUB + HAND_STUB
      + 'function buildFeelProfiles() {\n  const ids = Object.keys(DRUM_FEEL_PROFILES);\n'
      + '  const rows = BUILD_ROWS(ids);\n  return { profiles: rows };\n}\n'
      + 'const feelKb = buildFeelProfiles();\n'))
      .toThrow(/rows 的 initializer 不是单参数 \.map\(\.\.\.\) 调用/);
  });
  it('委托证明拒绝：合格 physical 只是 decoy、最终 return 用别的', () => {
    expect(() => check(mkSrc({
      cbHead: `const decoy = { physical: { timekeeperHand: ${OKTK}, ghostHand: ${OKGH} } };`,
      physical: 'BAD_PHYSICAL(p, id)' }))).toThrow(/physical 的 initializer 不是对象字面量/);
  });
});
