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
  ROLE_RHYTHM_PATTERN_IDS,
  roleRhythmPattern,
} from '../src/core/generation/newEngine/knowledge/roleRhythmPatterns';
import {
  GROOVE_BASS_PATTERN_IDS,
  JAZZ_WALKING_BASS_PATTERN_ID,
  grooveBassPattern,
} from '../src/core/generation/newEngine/knowledge/grooveBassPatterns';
import { materializePopRockFill } from '../src/core/generation/newEngine/knowledge/drumFillVocabulary';

const SCHEMA_VERSION = 'groove_kb_v4';  // v4: +P2-10A 步2 drum kit capability（3 kit 音高位图 + 投影）
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
function assertOnlyAllowedUsage(sf: ts.SourceFile, name: string, kind: UsageKind): void {
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
      } else {
        bad(`出现在 ${ts.SyntaxKind[p.kind]} 位置（RHS 传递 / 实参 / return / 解构 / Object.assign 等均不允许）`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
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
  assertOnlyAllowedUsage(sf, constName, 'object');
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
  const OBJ_OK = "const DRUM_PERFORMANCE_FAMILIES: Record<string, number> = {\n  'a': 1,\n  'b': 2,\n};\n";

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
    ['obj for-of 左值', () => astObjectKeys(tsParse(OBJ_OK + "for (DRUM_PERFORMANCE_FAMILIES['c'] of [1]) {}\n"), 'DRUM_PERFORMANCE_FAMILIES'), /只允许「const 声明的 initializer」/],
    ['obj 属性读取（非下标）亦拒', () => astObjectKeys(tsParse(OBJ_OK + "export const v2 = DRUM_PERFORMANCE_FAMILIES.a;\n"), 'DRUM_PERFORMANCE_FAMILIES'), /出现在|只允许/],
    ['obj 运行时 delete', () => astObjectKeys(tsParse(OBJ_OK + "delete DRUM_PERFORMANCE_FAMILIES['a'];\n"), 'DRUM_PERFORMANCE_FAMILIES'), /只允许「const 声明的 initializer」/],
    ['Set 合法只读 .has 应放行（白名单正向）', () => { astNewSetLiterals(tsParse(SET_OK + "export const ok = DRUM_PATTERN_FAMILIES.has('a');\n"), 'DRUM_PATTERN_FAMILIES'); throw new Error('__SENTINEL_OK__'); }, '__SENTINEL_OK__'],
    ['realizer 生产形态应放行（正向契约）', () => { astObjectKeys(tsParse(OBJ_OK + "export function f(k: string){ const variants = DRUM_PERFORMANCE_FAMILIES[k]; return variants; }\n"), 'DRUM_PERFORMANCE_FAMILIES'); throw new Error('__SENTINEL_OK__'); }, '__SENTINEL_OK__'],
  ];
  for (const [what, run, msg] of NEG) {
    it(`拒绝：${what}`, () => { expect(run, what).toThrow(msg as string | RegExp); });
  }
});
