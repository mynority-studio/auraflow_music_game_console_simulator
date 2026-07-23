// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-arrange — afe P2-0a archetype/form 声明式源导出（分支 tool/afe-trace-v5.0）
// ------------------------------------------------------------
// v5.0 TS 规格 → ../../core/data/src/p2org/*.json（私有非 IV 血统）:
//   archetype.json  ARCH(3)/ASPL(section policy)/SHRG(shared role group)/PATR(pattern ref)
//                   —— import JAZZ_ARCHETYPE_REGISTRY + policy/pattern id 常量（机器导出）
//   form.json       FSEC/FTPL/FSPL/FCND/FDBR/FACT
//                   —— 4 通用模板 + 装配 policy 为 formPlanner.ts 内部常量（未 export;
//                      引擎源零触碰硬约束下不可 import）→ 按源行号逐字转录（citation）;
//                      33-bar 5/4 quartet 段序经 public planForm() 机器求值（非转录）。
//   p2org_a_oracle.json  3 archetype 的 TS-resolve 向量（foundationOwner/policy-id 序列/
//                      form 段序）——供 codegen 交叉校验 + C 测试独立 oracle（防同源自证）。
// enums/lock/foreign_keys 为 append-only 手写登记（同 gmbk_enums 制度, 非本导出器产出）。
// 纪律同 export-afe-gmbk（dropUndefined/写后重读/count 断言；引擎源零触碰）。
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-arrange.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

import {
  JAZZ_ARCHETYPE_REGISTRY,
  JAZZ_5_4_REFERENCE_QUARTET_FORM_BLUEPRINT_ID,
  planJazzArrangementArchetype,
} from '../src/core/generation/newEngine/arranger/jazzArchetypePlanner';
import { planForm } from '../src/core/generation/newEngine/arranger/formPlanner';
import { resolveArrangementArchetype } from '../src/core/generation/newEngine/arranger/arrangementArchetypeContract';
import { createRandomContext } from '../src/core/generation/newEngine/foundation/randomContext';
import type { Section } from '../src/core/generation/newEngine/arranger/ArrangementPlan';
import type { ArchetypeSectionPolicy } from '../src/core/generation/newEngine/arranger/arrangementArchetypeContract';

const KNOWLEDGE_SCHEMA_VERSION = 1;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', '..', 'core', 'data', 'src', 'p2org');

function dropUndefined(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(dropUndefined);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (x !== undefined) out[k] = dropUndefined(x);
  }
  return out;
}

function assertJsonSafe(v: unknown, path: string): void {
  if (v === null) return;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return;
  if (t === 'number') {
    if (!Number.isFinite(v as number)) throw new Error(`非 JSON 数值 at ${path}`);
    return;
  }
  if (t === 'function' || t === 'undefined' || t === 'symbol' || t === 'bigint')
    throw new Error(`非 JSON 值(${t}) at ${path}`);
  if (v instanceof Map || v instanceof Set) throw new Error(`Map/Set at ${path}`);
  if (Array.isArray(v)) { v.forEach((x, i) => assertJsonSafe(x, `${path}[${i}]`)); return; }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) assertJsonSafe(x, `${path}.${k}`);
}

function emit(name: string, doc: unknown): void {
  const clean = dropUndefined(doc);
  assertJsonSafe(clean, name);
  const a = JSON.stringify(clean, null, 1);
  // 自检 1: dropUndefined 幂等（确定性序列化）
  expect(JSON.stringify(dropUndefined(doc), null, 1)).toBe(a);
  const p = join(OUT_DIR, name);
  writeFileSync(p, a + '\n', 'utf8');
  // 自检 2: 写后重读逐字节
  expect(readFileSync(p, 'utf8')).toBe(a + '\n');
}

// ---- section 规范化: 全 8 字段, 缺省 optional → null（禁 undefined 漂移）----
function normSection(s: Section): Record<string, unknown> {
  return {
    id: s.id,
    role: s.role,
    harmonyRole: s.harmonyRole ?? null,
    functionTag: s.functionTag ?? null,
    linkOut: s.linkOut ?? null,
    bars: s.bars,
    repeatGroup: s.repeatGroup ?? null,
    hookPolicy: s.hookPolicy,
  };
}

// ---- ArchetypeSectionPolicy → 声明式记录 ----
function normSectionPolicy(
  formSlotKey: string | null,
  p: ArchetypeSectionPolicy,
): Record<string, unknown> {
  const rp = p.rolePatternByRole;
  return {
    formSlotKey,
    activeRoles: [...p.activeRoles],
    foregroundRole: p.foregroundRole,
    foundationOwner: p.foundationOwner,
    entryMode: p.entryMode ?? null,
    harmonyPolicyId: p.harmonyPolicyId,
    cadencePolicyId: p.cadencePolicyId,
    rolePatternByRole: {
      bass: rp.bass ?? null,
      comp: rp.comp ?? null,
      pad: rp.pad ?? null,
      lead: rp.lead ?? null,
      drum: rp.drum ?? null,
    },
  };
}

// ============================================================
// TS AST 机器提取（typescript compiler API）——formPlanner.ts 内部常量未 export,
// 引擎源零触碰下用 AST 直读源文件字面量节点; TS 改常量 → AST 自动跟随 → 重导门抓漂移。
// ============================================================
const FORM_PLANNER = join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'arranger', 'formPlanner.ts');
const FORM_SRC = readFileSync(FORM_PLANNER, 'utf8');
const FORM_SF = ts.createSourceFile('formPlanner.ts', FORM_SRC, ts.ScriptTarget.Latest, true);

function strLit(n: ts.Node): string | undefined { return ts.isStringLiteral(n) ? n.text : undefined; }
function numLit(n: ts.Node): number | undefined { return ts.isNumericLiteral(n) ? Number(n.text) : undefined; }

function findVarInit(name: string): ts.Expression {
  let found: ts.Expression | undefined;
  const walk = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) found = d.initializer;
    }
    if (!found) ts.forEachChild(node, walk);
  };
  FORM_SF.forEachChild(walk);
  if (!found) throw new Error(`AST: var ${name} 未找到`);
  return found;
}

function findFn(name: string): ts.FunctionDeclaration {
  let f: ts.FunctionDeclaration | undefined;
  FORM_SF.forEachChild((node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) f = node; });
  if (!f) throw new Error(`AST: fn ${name} 未找到`);
  return f;
}

// section 字段白名单 = normSection 认得的 8 字段; 必填 = 非 optional 四项（防未知字段静默丢弃）
const SEC_FIELD_ALLOWED = new Set([
  'id', 'role', 'harmonyRole', 'functionTag', 'linkOut', 'bars', 'repeatGroup', 'hookPolicy']);
const SEC_FIELD_REQUIRED = ['id', 'role', 'bars', 'hookPolicy'];

// TEMPLATES 对象字面量 → 模板段序（机器提取, 非转录）
function extractTemplates(): { blueprintId: string; sections: Section[] }[] {
  const init = findVarInit('TEMPLATES');
  if (!ts.isObjectLiteralExpression(init)) throw new Error('AST: TEMPLATES 非对象字面量');
  const out: { blueprintId: string; sections: Section[] }[] = [];
  for (const prop of init.properties) {
    if (!ts.isPropertyAssignment(prop)) throw new Error('AST: TEMPLATES prop 非 assignment');
    const key = ts.isStringLiteral(prop.name) ? prop.name.text
      : (ts.isIdentifier(prop.name) ? prop.name.text : undefined);
    if (key === undefined) throw new Error('AST: TEMPLATES key 非 string');
    if (!ts.isArrayLiteralExpression(prop.initializer)) throw new Error('AST: TEMPLATES value 非数组');
    const sections: Section[] = [];
    for (const el of prop.initializer.elements) {
      if (!ts.isObjectLiteralExpression(el)) throw new Error('AST: section 非对象');
      const sec: Record<string, unknown> = {};
      for (const p of el.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) throw new Error('AST: section prop 非 ident');
        // 白名单: 未知字段(即便 string/number 字面量)会被 normSection() 静默丢弃 → 抛（Codex 三轮 A1）
        if (!SEC_FIELD_ALLOWED.has(p.name.text))
          throw new Error(`AST: section 未知字段 '${p.name.text}'（白名单外; 防 normSection 静默丢弃漂移）`);
        const s = strLit(p.initializer); const nn = numLit(p.initializer);
        // fail-closed: 非 string/number 字面量(如 SOME_CONST/调用) 不得静默写 undefined → 抛
        if (s === undefined && nn === undefined)
          throw new Error(`AST: section field '${p.name.text}' initializer 非 string/number 字面量（拒绝静默 undefined 漂移）`);
        sec[p.name.text] = s !== undefined ? s : nn;
      }
      for (const req of SEC_FIELD_REQUIRED)
        if (!(req in sec)) throw new Error(`AST: section 缺必填字段 '${req}'`);
      sections.push(sec as unknown as Section);
    }
    out.push({ blueprintId: key, sections });
  }
  return out;
}

// 收集函数体内所有 pick([numeric...]) 数组（源序; 过滤非数字数组如 pick(FORM_POOL)）
function collectPickArrays(node: ts.Node): number[][] {
  const arrs: number[][] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
        && n.expression.name.text === 'pick' && n.arguments.length >= 1
        && ts.isArrayLiteralExpression(n.arguments[0])) {
      const nums = n.arguments[0].elements.map(numLit);
      if (nums.every((x) => x !== undefined)) arrs.push(nums as number[]);
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return arrs;
}

// 收集 targetBars <op> <num> 比较（集合, 序无关——转录 first-match 序与源序不同）
const CMP_OPS: Record<number, string> = {
  [ts.SyntaxKind.LessThanEqualsToken]: '<=',
  [ts.SyntaxKind.LessThanToken]: '<',
  [ts.SyntaxKind.GreaterThanEqualsToken]: '>=',
  [ts.SyntaxKind.GreaterThanToken]: '>',
};
function collectTargetBarsCmp(node: ts.Node): string[] {
  const out = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && CMP_OPS[n.operatorToken.kind]) {
      if (ts.isIdentifier(n.left) && n.left.text === 'targetBars' && numLit(n.right) !== undefined)
        out.add(`${CMP_OPS[n.operatorToken.kind]}:${numLit(n.right)}`);
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return [...out].sort();
}

// 动作映射（branch→action 语义）非纯字面量, AST 难可靠提取 → 冻结相关函数源 SHA
// 作为最低 guard（Codex 最低方案）; TS 改这些函数即失配, 强制复审。
function fnSha(name: string): string {
  return createHash('sha256').update(findFn(name).getText(FORM_SF), 'utf8').digest('hex');
}
function varSha(name: string): string {
  return createHash('sha256').update(findVarInit(name).getText(FORM_SF), 'utf8').digest('hex');
}
const FROZEN_FN_SHA: Record<string, string> = {
  // sha256(getText) @ 工装 pin d588b87; TS 改这些函数即失配 → 强制复审动作映射语义。
  assemblePopRnb: '6d91914c9a044041df29ed8bd5ea4692cb7b17bc84ec32841c23d8891ecd8b5e',
  assembleLofi: 'a619e9d182efdfd7902036acd372c93c77f75c324619e1c092a83a34f3fb7295',
  assembleJazzFourFour: '9ddad8944675857c580ef19b0afa55813884683f25a68289035f2d4f61568f44',
  // 预算/网格辅助（消费 TARGET_BARS/BOUNDS 的时长逻辑）——防仅改函数体绕过转录 guard。
  normalizeTargetBars: 'd7939c39fca43465ed100b7ba2d37742dff4fefd634ad9a0565016f3e0781d7e',
  fitOptionalIntro: 'a3320772bb2b80eb9cc1607ce97919fd471f5fbfc842e555dd0f6943ed7bc378',
};
// sizeContent 为 arrow-const（非 FunctionDeclaration）→ 冻结其 initializer SHA。
const FROZEN_VAR_SHA: Record<string, string> = {
  sizeContent: 'a7f4322e1133f4096556a2cf2100b245e82dbfcbec6fa0dde8a3b1f9cb35eedb',
};

// TARGET_BARS/TARGET_BAR_BOUNDS 为 formPlanner 顶层常量, 喂 procedural 预算 → 必须 AST 直读
// 并与转录交叉验证（否则改 TARGET_BARS=60→64 时 assemble getText 不变, 旧 guard 抓不到, Codex 反例）。
function extractTargetBars(): number {
  const n = numLit(findVarInit('TARGET_BARS'));
  if (n === undefined) throw new Error('AST: TARGET_BARS 非数字字面量');
  return n;
}
function extractTargetBarBounds(): Record<string, [number, number]> {
  const init = findVarInit('TARGET_BAR_BOUNDS');
  if (!ts.isObjectLiteralExpression(init)) throw new Error('AST: TARGET_BAR_BOUNDS 非对象字面量');
  const out: Record<string, [number, number]> = {};
  for (const prop of init.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) throw new Error('AST: BOUNDS prop 非 ident');
    if (!ts.isArrayLiteralExpression(prop.initializer) || prop.initializer.elements.length !== 2)
      throw new Error(`AST: BOUNDS[${prop.name.text}] 非二元组`);
    const lo = numLit(prop.initializer.elements[0]); const hi = numLit(prop.initializer.elements[1]);
    if (lo === undefined || hi === undefined) throw new Error(`AST: BOUNDS[${prop.name.text}] 非数字`);
    out[prop.name.text] = [lo, hi];
  }
  return out;
}

// FORM_POOL（有序 legacy pick 池）AST 直读——规格 §3.3(d) 要求进 digest/冻结（Codex 三轮 major1）。
function extractStrArray(name: string): string[] {
  const init = findVarInit(name);
  if (!ts.isArrayLiteralExpression(init)) throw new Error(`AST: ${name} 非数组字面量`);
  return init.elements.map((e) => {
    const s = strLit(e);
    if (s === undefined) throw new Error(`AST: ${name} 元素非 string 字面量`);
    return s;
  });
}
// PROCEDURAL_STYLES = new Set([...string]) AST 直读集合。
function extractSetStrArgs(name: string): string[] {
  const init = findVarInit(name);
  if (!ts.isNewExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== 'Set'
      || !init.arguments || init.arguments.length !== 1 || !ts.isArrayLiteralExpression(init.arguments[0]))
    throw new Error(`AST: ${name} 非 new Set([...])`);
  return init.arguments[0].elements.map((e) => {
    const s = strLit(e);
    if (s === undefined) throw new Error(`AST: ${name} Set 元素非 string 字面量`);
    return s;
  });
}

// FSPL/FCND/FDBR/FACT —— formPlanner.ts 逐值转录（源行注于各字段; 设计 §3.3 a/b/c）
// branchEval: 'first'=else-if 链首命中 / 'all'=独立 if 顺序全评（jazz）。
// action.alsoNoIntro=true ⟺ 该分支同置 hasIntro=false（折入 flags bit0）。
const STYLE_POLICIES_TRANSCRIBED: Record<string, unknown>[] = [
  { style: 'pop', procedural: 1, maxSections: 6, gridBars: 4, branchEval: 'first',
    introBarsLegacy: 2, introBarsDa: 4, targetBarsDefault: 60, targetBarLo: 12, targetBarHi: 120,
    introProb: 550, altProb: null, edgeBars: 4, contentMinDa: 4, contentMaxDa: 28, contentMinLeg: 8, contentMaxLeg: 16,
    countCandidates: [ // :121-122 rng.pick([1,2,2]) ×2
      { kind: 'verse', value: 1 }, { kind: 'verse', value: 2 }, { kind: 'verse', value: 2 },
      { kind: 'chorus', value: 1 }, { kind: 'chorus', value: 2 }, { kind: 'chorus', value: 2 } ],
    durBranches: [ // :124/:128/:131/:132
      { cmp: '<=', threshold: 16, actions: [{ kind: 'set_counts', arg0: 1, arg1: 1, alsoNoIntro: true }] },
      { cmp: '<', threshold: 24, actions: [{ kind: 'reduce_counts_to_le', arg0: 3, arg1: 0, alsoNoIntro: true }] },
      { cmp: '<=', threshold: 40, actions: [{ kind: 'reduce_counts_to_le', arg0: 3, arg1: 0, alsoNoIntro: false }] },
      { cmp: '>=', threshold: 64, actions: [{ kind: 'grow_chorus_to_ge', arg0: 4, arg1: 0, alsoNoIntro: false }] } ] },
  { style: 'rnb', procedural: 1, maxSections: 6, gridBars: 4, branchEval: 'first',
    introBarsLegacy: 4, introBarsDa: 4, targetBarsDefault: 60, targetBarLo: 12, targetBarHi: 120,
    introProb: 700, altProb: null, edgeBars: 4, contentMinDa: 4, contentMaxDa: 28, contentMinLeg: 8, contentMaxLeg: 16,
    countCandidates: [
      { kind: 'verse', value: 1 }, { kind: 'verse', value: 2 }, { kind: 'verse', value: 2 },
      { kind: 'chorus', value: 1 }, { kind: 'chorus', value: 2 }, { kind: 'chorus', value: 2 } ],
    durBranches: [
      { cmp: '<=', threshold: 16, actions: [{ kind: 'set_counts', arg0: 1, arg1: 1, alsoNoIntro: true }] },
      { cmp: '<', threshold: 24, actions: [{ kind: 'reduce_counts_to_le', arg0: 3, arg1: 0, alsoNoIntro: true }] },
      { cmp: '<=', threshold: 40, actions: [{ kind: 'reduce_counts_to_le', arg0: 3, arg1: 0, alsoNoIntro: false }] },
      { cmp: '>=', threshold: 64, actions: [{ kind: 'grow_chorus_to_ge', arg0: 4, arg1: 0, alsoNoIntro: false }] } ] },
  { style: 'lofi', procedural: 1, maxSections: 6, gridBars: 4, branchEval: 'first',
    introBarsLegacy: 4, introBarsDa: 4, targetBarsDefault: 60, targetBarLo: 8, targetBarHi: 68,
    introProb: 600, altProb: null, edgeBars: 4, contentMinDa: 4, contentMaxDa: 20, contentMinLeg: 8, contentMaxLeg: 16,
    countCandidates: [ // :182 rng.pick([2,2,3])
      { kind: 'loop', value: 2 }, { kind: 'loop', value: 2 }, { kind: 'loop', value: 3 } ],
    durBranches: [ // :183/:186/:189
      { cmp: '<=', threshold: 12, actions: [{ kind: 'set_counts', arg0: 1, arg1: 0, alsoNoIntro: true }] },
      { cmp: '<', threshold: 32, actions: [{ kind: 'set_counts', arg0: 2, arg1: 0, alsoNoIntro: true }] },
      { cmp: '>=', threshold: 48, actions: [{ kind: 'set_counts', arg0: 3, arg1: 0, alsoNoIntro: false }] } ] },
  { style: 'jazz', procedural: 1, maxSections: 6, gridBars: 4, branchEval: 'all',
    introBarsLegacy: 4, introBarsDa: 4, targetBarsDefault: 60, targetBarLo: 12, targetBarHi: 144,
    introProb: 600, altProb: 700, edgeBars: 4, contentMinDa: 4, contentMaxDa: 48, contentMinLeg: 8, contentMaxLeg: 16,
    countCandidates: [ // :221 head=3 / :218 soloBars 默认 16
      { kind: 'head', value: 3 }, { kind: 'solo_bars', value: 16 } ],
    durBranches: [ // :212/:213/:214/:220/:218（独立 if, 顺序全评）
      { cmp: '<', threshold: 28, actions: [{ kind: 'force_no_intro', arg0: 0, arg1: 0, alsoNoIntro: false }] },
      { cmp: '<', threshold: 48, actions: [{ kind: 'set_no_solo', arg0: 0, arg1: 0, alsoNoIntro: false }] },
      { cmp: '>=', threshold: 64, actions: [{ kind: 'set_solo', arg0: 0, arg1: 0, alsoNoIntro: false }] },
      { cmp: '<=', threshold: 16, actions: [{ kind: 'set_short_cue', arg0: 0, arg1: 0, alsoNoIntro: false }] },
      { cmp: '>=', threshold: 112, actions: [{ kind: 'set_solo_bars', arg0: 32, arg1: 0, alsoNoIntro: false }] } ] },
  { style: 'acg', procedural: 1, maxSections: null, gridBars: 4, branchEval: null,
    introBarsLegacy: null, introBarsDa: null, targetBarsDefault: 60, targetBarLo: 12, targetBarHi: 84,
    introProb: null, altProb: null, edgeBars: 4, contentMinDa: null, contentMaxDa: null, contentMinLeg: null, contentMaxLeg: null,
    countCandidates: [], durBranches: [] }, // acg form-shape → P2-11（§5）
  { style: 'default', procedural: 0, maxSections: null, gridBars: null, branchEval: null,
    introBarsLegacy: null, introBarsDa: null, targetBarsDefault: null, targetBarLo: 12, targetBarHi: 96,
    introProb: null, altProb: null, edgeBars: null, contentMinDa: null, contentMaxDa: null, contentMinLeg: 8, contentMaxLeg: 16,
    countCandidates: [ // :561 rng.pick([2,4]) ×2（legacy 模板池 intro/outro）
      { kind: 'intro_bars', value: 2 }, { kind: 'intro_bars', value: 4 },
      { kind: 'outro_bars', value: 2 }, { kind: 'outro_bars', value: 4 } ],
    durBranches: [] },
];

// PATR —— pattern ref 登记（id 为字符串字面量转录, 非 import; 生产 pattern kb 属 P2-4/P2-9,
//   届时 codegen FK 校验将 id 集合与真源对齐; namespace/patternType/ownerTask = 设计 §2.4）
const PATTERN_REFS = [
  { id: 'bass.jazz-walking.v1', role: 'bass', namespace: 'bass-kb', patternType: 'walking', ownerTask: 'P2-4' },
  { id: 'comp.jazz-swing.v1', role: 'comp', namespace: 'comp-kb', patternType: 'swing-comp', ownerTask: 'P2-9' },
  { id: 'lead.mg-jazz.v1', role: 'lead', namespace: 'lead-kb', patternType: 'mg-lead', ownerTask: 'P2-9' },
  { id: 'bass.jazz-five-four-ostinato.v1', role: 'bass', namespace: 'bass-kb', patternType: 'five-four-ostinato', ownerTask: 'P2J-b' },
  { id: 'comp.jazz-five-four-piano-interlock.v1', role: 'comp', namespace: 'comp-kb', patternType: 'five-four-interlock', ownerTask: 'P2J-b' },
  { id: 'lead.jazz-five-four-phrase.v1', role: 'lead', namespace: 'lead-kb', patternType: 'five-four-phrase', ownerTask: 'P2J-b' },
];

describe('export afe arrange (v5.0 archetype/form → 声明式源, 私有)', () => {
  it('dumps archetype / form / oracle', () => {
    mkdirSync(OUT_DIR, { recursive: true });

    // ---- archetype.json ----
    const archetypes = JAZZ_ARCHETYPE_REGISTRY.map((a) => {
      const slots = a.sectionPolicyByFormSlot ?? {};
      const slotKeys = Object.keys(slots);
      return {
        id: a.id,
        style: a.style,
        meterFamily: a.meterFamily,
        weight: a.weightWithinMeter,
        formBlueprintId: a.formBlueprintId,
        grooveContractId: a.grooveContract.id,
        ensembleId: a.instrumentationEnsembleId ?? null,
        voicePolicy: a.instrumentationVoicePolicy ?? null,
        tonalityMode: a.tonalityMode ?? null,
        openingPolicyId: a.openingPolicyId,
        boundaryPolicyId: a.boundaryPolicyId,
        motifPolicyId: a.motifPolicyId,
        defaultSectionPolicy: normSectionPolicy(null, a.defaultSectionPolicy),
        sectionPolicyByFormSlot: slotKeys.map((k) => normSectionPolicy(k, slots[k])),
        sharedRoleGroups: (a.sharedInstrumentRoleGroups ?? []).map((g) => [...g]),
      };
    });
    expect(archetypes.length).toBe(3);
    emit('archetype.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'p2org_archetype',
      source: 'arranger/{jazzArchetypePlanner,arrangementArchetypeContract}.ts@Newengine_Demo-v5.0',
      patternRefs: PATTERN_REFS,
      archetypes,
    });

    // ---- form.json（TEMPLATES 经 AST 机器提取; quartet 经 public planForm; policy 转录+AST 交叉验证）----
    const templatesFromAst = extractTemplates();
    // AST 提取的模板集须与 formPlanner FormTemplate 类型 4 项一致
    expect(templatesFromAst.map((t) => t.blueprintId)).toEqual(
      ['verse-chorus', 'verse-chorus-bridge', 'double-verse', 'compact']);
    // ★ FORM_POOL / PROCEDURAL_STYLES 机器 guard（规格 §3.3(d) 冻结; 改二者→重导 JSON 不变, 旧 guard 漏）:
    //   FORM_POOL 顺序须 == 四通用模板 blueprint 序; PROCEDURAL_STYLES 须 == 转录 procedural=1 的 style 集。
    expect(extractStrArray('FORM_POOL')).toEqual(templatesFromAst.map((t) => t.blueprintId));
    expect([...extractSetStrArgs('PROCEDURAL_STYLES')].sort()).toEqual(
      STYLE_POLICIES_TRANSCRIBED.filter((s) => s.procedural === 1).map((s) => s.style as string).sort());

    // ★ 机器 guard: 转录的 count/branch 数值 == TS AST 提取（TS 改则失配）
    const popPolicy = STYLE_POLICIES_TRANSCRIBED.find((s) => s.style === 'pop')!;
    const rnbPolicy = STYLE_POLICIES_TRANSCRIBED.find((s) => s.style === 'rnb')!;
    const lofiPolicy = STYLE_POLICIES_TRANSCRIBED.find((s) => s.style === 'lofi')!;
    const jazzPolicy = STYLE_POLICIES_TRANSCRIBED.find((s) => s.style === 'jazz')!;
    const defaultPolicy = STYLE_POLICIES_TRANSCRIBED.find((s) => s.style === 'default')!;
    const candVals = (pol: typeof popPolicy, kind: string): number[] =>
      (pol.countCandidates as { kind: string; value: number }[]).filter((c) => c.kind === kind).map((c) => c.value);
    const cmpSet = (pol: typeof popPolicy): string[] =>
      (pol.durBranches as { cmp: string; threshold: number }[])
        .map((b) => `${b.cmp}:${b.threshold}`).sort();
    // assemblePopRnb 服务 pop+rnb（同一 TS 函数）; 两者转录须一致
    expect(rnbPolicy.countCandidates).toEqual(popPolicy.countCandidates);
    expect(rnbPolicy.durBranches).toEqual(popPolicy.durBranches);
    const popFn = findFn('assemblePopRnb');
    expect(collectPickArrays(popFn)).toEqual([candVals(popPolicy, 'verse'), candVals(popPolicy, 'chorus')]);
    expect(collectTargetBarsCmp(popFn)).toEqual(cmpSet(popPolicy));
    const lofiFn = findFn('assembleLofi');
    expect(collectPickArrays(lofiFn)).toEqual([candVals(lofiPolicy, 'loop')]);
    expect(collectTargetBarsCmp(lofiFn)).toEqual(cmpSet(lofiPolicy));
    const jazzFn = findFn('assembleJazzFourFour');
    expect(collectPickArrays(jazzFn)).toEqual([]); // jazz head/solo 为 const/ternary, 非 pick
    expect(collectTargetBarsCmp(jazzFn)).toEqual(cmpSet(jazzPolicy));
    // planForm legacy default: rng.pick([2,4]) ×2 → intro_bars/outro_bars 候选
    let planFn: ts.FunctionDeclaration | undefined;
    FORM_SF.forEachChild(function w(n: ts.Node): void {
      if (ts.isFunctionDeclaration(n) && n.name?.text === 'planForm') planFn = n;
      if (!planFn) ts.forEachChild(n, w);
    });
    expect(planFn).toBeDefined();
    expect(collectPickArrays(planFn!)).toEqual(
      [candVals(defaultPolicy, 'intro_bars'), candVals(defaultPolicy, 'outro_bars')]);
    // 动作映射语义 backstop: 冻结相关函数源 SHA（Codex 最低方案）
    for (const [fn, sha] of Object.entries(FROZEN_FN_SHA))
      expect(fnSha(fn)).toBe(sha);
    for (const [v, sha] of Object.entries(FROZEN_VAR_SHA))
      expect(varSha(v)).toBe(sha);
    // ★ TARGET_BARS/BOUNDS 机器 guard: AST 直读值 == 转录 targetBarsDefault/Lo/Hi（改常量即失配）
    const targetBarsSrc = extractTargetBars();
    const boundsSrc = extractTargetBarBounds();
    for (const style of ['pop', 'rnb', 'lofi', 'jazz', 'acg']) {
      const pol = STYLE_POLICIES_TRANSCRIBED.find((s) => s.style === style)!;
      expect(pol.targetBarsDefault).toBe(targetBarsSrc);           // 60
      expect([pol.targetBarLo, pol.targetBarHi]).toEqual(boundsSrc[style]);
    }

    const quartetRng = createRandomContext(1).substream('arranger');
    const quartetSections = planForm({
      style: 'jazz', rng: quartetRng,
      jazzFormBlueprintId: JAZZ_5_4_REFERENCE_QUARTET_FORM_BLUEPRINT_ID,
    });
    expect(quartetSections.length).toBe(5);
    const templates = [
      ...templatesFromAst.map((t) => ({
        blueprintId: t.blueprintId,
        hasSemanticFields: false,
        sections: t.sections.map(normSection),
      })),
      {
        blueprintId: JAZZ_5_4_REFERENCE_QUARTET_FORM_BLUEPRINT_ID,
        hasSemanticFields: true,
        sections: quartetSections.map(normSection),
      },
    ];
    const totalSections = templates.reduce((n, t) => n + t.sections.length, 0);
    expect(totalSections).toBe(30); // FSEC golden（25 通用 + 5 quartet）
    emit('form.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'p2org_form',
      source: 'arranger/{formPlanner,ArrangementPlan}.ts@Newengine_Demo-v5.0（模板/policy 转录; quartet 机器求值）',
      templates,
      stylePolicies: STYLE_POLICIES_TRANSCRIBED,
    });

    // ---- p2org_a_oracle.json（真 resolve 路径独立向量; 防同源自证, 覆盖 override）----
    // planJazzArrangementArchetype(forcedId) → planForm → resolveArrangementArchetype(sectionIds):
    // 每段完整 8 字段 + 逐 section resolved foundation/entry/pattern/harmony/cadence（含 modern-piano
    // pickup/headA override, 非只 default）。C 侧做完整 normalized dump 对照。
    const RESOLVE_DEFAULT_ID = '__default__'; // 伪 id: 验证任意未登记段回落 default 策略
    const oracle = JAZZ_ARCHETYPE_REGISTRY.map((reg) => {
      const a = planJazzArrangementArchetype(undefined, reg.id); // 走 plan 路径取 archetype
      const fixedForm = a.formBlueprintId === JAZZ_5_4_REFERENCE_QUARTET_FORM_BLUEPRINT_ID;
      let formSections: Record<string, unknown>[] = [];
      let sectionIds: string[];
      let plannedSectionIds: string[];   // planForm 产出的真实段序（不含 pseudo-default）——供 oracle_check 精确约束
      const rng = createRandomContext(7).substream('arranger');
      if (fixedForm) {
        const secs = planForm({ style: 'jazz', rng, jazzFormBlueprintId: a.formBlueprintId });
        formSections = secs.map(normSection);       // 固定模板: formSections=段序（FTPL/FSEC 对账）
        plannedSectionIds = secs.map((s) => s.id);
        sectionIds = [...plannedSectionIds];         // fixed: 禁 pseudo-default
      } else {
        // 4/4 procedural: 无固定 FTPL 段（formSections 留空）, 但仍经 planForm 求真实段序并 resolve,
        // 末位补一条 pseudo-default → 证「全 archetype 均过 plan→planForm→resolve」+ 未登记段回落。
        const secs = planForm({ style: 'jazz', rng });
        plannedSectionIds = secs.map((s) => s.id);
        sectionIds = [...plannedSectionIds, RESOLVE_DEFAULT_ID];
      }
      const resolved = resolveArrangementArchetype(a, sectionIds);
      const resolvedSections = sectionIds.map((sid) => {
        const p = resolved.sectionPolicyById[sid];
        const rp = p.rolePatternByRole;
        return {
          sectionId: sid,
          foundationOwner: p.foundationOwner,
          entryMode: p.entryMode ?? null,
          rolePatternByRole: {
            bass: rp.bass ?? null, comp: rp.comp ?? null, pad: rp.pad ?? null,
            lead: rp.lead ?? null, drum: rp.drum ?? null,
          },
          harmonyPolicyId: p.harmonyPolicyId,
          cadencePolicyId: p.cadencePolicyId,
        };
      });
      return {
        id: a.id,
        style: a.style,
        meterFamily: a.meterFamily,
        weight: a.weightWithinMeter,
        formBlueprintId: a.formBlueprintId,
        grooveContractId: a.grooveContract.id,
        ensembleId: a.instrumentationEnsembleId ?? null,
        voicePolicy: a.instrumentationVoicePolicy ?? null,
        tonalityMode: a.tonalityMode ?? null,
        sharedRoleGroups: (a.sharedInstrumentRoleGroups ?? []).map((gr) => [...gr]),
        openingPolicyId: a.openingPolicyId,
        boundaryPolicyId: a.boundaryPolicyId,
        motifPolicyId: a.motifPolicyId,
        plannedSectionIds,
        formSections,
        resolvedSections,
      };
    });
    // 覆盖断言: modern-piano 必须含 pickup/headA override（resolved foundation 与 default 不同）
    const modern = oracle.find((o) => o.id === 'jazz_5_4_modern_piano')!;
    expect(modern.resolvedSections.length).toBe(5);
    expect(modern.resolvedSections[0].sectionId).toBe('pickup');
    expect(modern.resolvedSections[0].foundationOwner).toBe('bass'); // override（default 是 comp）
    emit('p2org_a_oracle.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'p2org_a_oracle',
      source: 'planJazzArrangementArchetype→planForm→resolveArrangementArchetype@Newengine_Demo-v5.0（真 resolve 独立向量）',
      resolveDefaultId: RESOLVE_DEFAULT_ID,
      archetypes: oracle,
    });
  });
});
