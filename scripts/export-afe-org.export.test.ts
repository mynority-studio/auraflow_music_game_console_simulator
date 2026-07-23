// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-org — afe P2-0b 四风格五轨组织 27 表声明式源导出（分支 tool/afe-trace-v5.0）
// ------------------------------------------------------------
// v5.0 TS 规格 → ../../core/data/src/p2org/org_*.json（私有非 IV 血统）:
//   org_instrumental.json  DARC/TXBF/OTPG/LDOP —— instrumentalPlanner.ts 内部常量 AST 机器提取
//   （后续组: opening / dynamics / band / instruments / seed 逐批加入）。
// 纪律同 export-afe-arrange（AST 直读源字面量; 引擎源零触碰; dropUndefined/写后重读/count 断言）。
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-org.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const KNOWLEDGE_SCHEMA_VERSION = 1;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', '..', 'core', 'data', 'src', 'p2org');

function dropUndefined(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(dropUndefined);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) out[k] = dropUndefined(x);
  return out;
}
function assertJsonSafe(v: unknown, path: string): void {
  if (v === null) return;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return;
  if (t === 'number') { if (!Number.isFinite(v as number)) throw new Error(`非 JSON 数值 at ${path}`); return; }
  if (t === 'function' || t === 'undefined' || t === 'symbol' || t === 'bigint') throw new Error(`非 JSON 值(${t}) at ${path}`);
  if (v instanceof Map || v instanceof Set) throw new Error(`Map/Set at ${path}`);
  if (Array.isArray(v)) { v.forEach((x, i) => assertJsonSafe(x, `${path}[${i}]`)); return; }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) assertJsonSafe(x, `${path}.${k}`);
}
function emit(name: string, doc: unknown): void {
  const clean = dropUndefined(doc);
  assertJsonSafe(clean, name);
  const a = JSON.stringify(clean, null, 1);
  expect(JSON.stringify(dropUndefined(doc), null, 1)).toBe(a); // dropUndefined 幂等
  const p = join(OUT_DIR, name);
  writeFileSync(p, a + '\n', 'utf8');
  expect(readFileSync(p, 'utf8')).toBe(a + '\n');             // 写后重读逐字节
}

// ---- AST 机器提取（instrumentalPlanner.ts 内部常量未 export; 引擎源零触碰下 AST 直读）----
const INSTR = join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'instrumental', 'instrumentalPlanner.ts');
const INSTR_SRC = readFileSync(INSTR, 'utf8');
const INSTR_SF = ts.createSourceFile('instrumentalPlanner.ts', INSTR_SRC, ts.ScriptTarget.Latest, true);

function strLit(n: ts.Node): string | undefined { return ts.isStringLiteral(n) ? n.text : undefined; }
function numLit(n: ts.Node): number | undefined { return ts.isNumericLiteral(n) ? Number(n.text) : undefined; }
function propName(p: ts.ObjectLiteralElementLike): string {
  if (!ts.isPropertyAssignment(p)) throw new Error('AST: 非 property assignment');
  if (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name) || ts.isNumericLiteral(p.name)) return p.name.text;
  throw new Error('AST: prop 名非 string/ident/numeric');
}
function findVarInit(sf: ts.SourceFile, name: string): ts.Expression {
  let found: ts.Expression | undefined;
  const walk = (node: ts.Node): void => {
    if (ts.isVariableStatement(node))
      for (const d of node.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) found = d.initializer;
    if (!found) ts.forEachChild(node, walk);
  };
  sf.forEachChild(walk);
  if (!found) throw new Error(`AST: var ${name} 未找到`);
  return found;
}
function strArray(n: ts.Node, ctx: string): string[] {
  if (!ts.isArrayLiteralExpression(n)) throw new Error(`AST: ${ctx} 非数组`);
  return n.elements.map((e) => { const s = strLit(e); if (s === undefined) throw new Error(`AST: ${ctx} 元素非 string`); return s; });
}
function setStrArgs(n: ts.Node, ctx: string): string[] {
  if (!ts.isNewExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== 'Set'
      || !n.arguments || n.arguments.length !== 1) throw new Error(`AST: ${ctx} 非 new Set([...])`);
  return strArray(n.arguments[0], ctx);
}

// DENSITY_ARC: Record<style, Partial<Record<functionTag, role[]>>> → cell 列表（roles 原始, mask 由 codegen 算+对账 §4.1）
function extractDensityArc(): { style: string; functionTag: string; roles: string[] }[] {
  const init = findVarInit(INSTR_SF, 'DENSITY_ARC');
  if (!ts.isObjectLiteralExpression(init)) throw new Error('AST: DENSITY_ARC 非对象');
  const out: { style: string; functionTag: string; roles: string[] }[] = [];
  for (const styleProp of init.properties) {
    const style = propName(styleProp);
    const tagsObj = (styleProp as ts.PropertyAssignment).initializer;
    if (!ts.isObjectLiteralExpression(tagsObj)) throw new Error(`AST: DENSITY_ARC[${style}] 非对象`);
    for (const tagProp of tagsObj.properties) {
      const functionTag = propName(tagProp);
      out.push({ style, functionTag, roles: strArray((tagProp as ts.PropertyAssignment).initializer, `DENSITY_ARC[${style}][${functionTag}]`) });
    }
  }
  return out;
}
// tag→string 对象字面量（TEXTURE_BY_FUNCTION / OPENING_TEXTURE_TO_GENERIC）
function extractStrMap(name: string): { key: string; value: string }[] {
  const init = findVarInit(INSTR_SF, name);
  if (!ts.isObjectLiteralExpression(init)) throw new Error(`AST: ${name} 非对象`);
  return init.properties.map((p) => {
    const key = propName(p);
    const value = strLit((p as ts.PropertyAssignment).initializer);
    if (value === undefined) throw new Error(`AST: ${name}[${key}] 值非 string`);
    return { key, value };
  });
}

// ---- opening 组真源（openingGesturePlanner.ts）----
const OPEN = join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'arranger', 'openingGesturePlanner.ts');
const OPEN_SF = ts.createSourceFile('openingGesturePlanner.ts', readFileSync(OPEN, 'utf8'), ts.ScriptTarget.Latest, true);

// STYLE_CANDIDATES → OPNC（候选头）+ OPRD（roleDelay 按 ROLE_ORDER 规范化, 保留声明的 role, §4.3）
function extractOpeningCandidates(): Record<string, unknown>[] {
  const roleOrder = strArray(findVarInit(OPEN_SF, 'ROLE_ORDER'), 'ROLE_ORDER'); // ['comp','pad','bass','drum','lead']
  const init = findVarInit(OPEN_SF, 'STYLE_CANDIDATES');
  if (!ts.isObjectLiteralExpression(init)) throw new Error('AST: STYLE_CANDIDATES 非对象');
  const out: Record<string, unknown>[] = [];
  for (const styleProp of init.properties) {
    const style = propName(styleProp);
    const arr = (styleProp as ts.PropertyAssignment).initializer;
    if (!ts.isArrayLiteralExpression(arr)) throw new Error(`AST: STYLE_CANDIDATES[${style}] 非数组`);
    for (const candNode of arr.elements) {
      if (!ts.isObjectLiteralExpression(candNode)) throw new Error(`AST: ${style} 候选非对象`);
      const c: Record<string, unknown> = {};
      const rdb: Record<string, number> = {};
      for (const p of candNode.properties) {
        const k = propName(p);
        if (!['mode', 'drumEntry', 'textureEntry', 'roleDelayBars', 'pickupBars', 'intensity', 'weight'].includes(k))
          throw new Error(`AST: OPNC 候选未知字段 '${k}'（防静默丢弃, Codex f4）`);
        const initz = (p as ts.PropertyAssignment).initializer;
        if (k === 'roleDelayBars') {
          if (!ts.isObjectLiteralExpression(initz)) throw new Error('AST: roleDelayBars 非对象');
          for (const rp of initz.properties) {
            const n = numLit((rp as ts.PropertyAssignment).initializer);
            if (n === undefined) throw new Error('AST: roleDelay 非数字');
            rdb[propName(rp)] = n;
          }
        } else {
          const s = strLit(initz); const n = numLit(initz);
          if (s === undefined && n === undefined) throw new Error(`AST: 候选字段 ${k} 非 string/number`);
          c[k] = s !== undefined ? s : n;
        }
      }
      // 按 ROLE_ORDER 规范化 roleDelay（保留 rdb 声明的 role, 不保留 JS 声明序; §4.3 三轮 #3）
      const roleDelays = roleOrder.filter((r) => r in rdb).map((r) => ({ role: r, delayBars: rdb[r] }));
      out.push({
        style, mode: c.mode, drumEntry: c.drumEntry, textureEntry: c.textureEntry,
        pickupBars: c.pickupBars, intensity: c.intensity, weight: c.weight, roleDelays,
      });
    }
  }
  return out;
}
// key→string[] 对象（TEXTURE_ROLE_SUPPORT / STYLE_TEXTURE_FALLBACKS）
function extractStrListMap(sf: ts.SourceFile, name: string): { key: string; values: string[] }[] {
  const init = findVarInit(sf, name);
  if (!ts.isObjectLiteralExpression(init)) throw new Error(`AST: ${name} 非对象`);
  return init.properties.map((p) => ({ key: propName(p), values: strArray((p as ts.PropertyAssignment).initializer, `${name}[${propName(p)}]`) }));
}

// ---- edge / dynamics 组真源 ----
const EDGE = join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'arranger', 'edgePlanner.ts');
const EDGE_SF = ts.createSourceFile('edgePlanner.ts', readFileSync(EDGE, 'utf8'), ts.ScriptTarget.Latest, true);
const DYN = join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'arranger', 'dynamicsPlanner.ts');
const DYN_SF = ts.createSourceFile('dynamicsPlanner.ts', readFileSync(DYN, 'utf8'), ts.ScriptTarget.Latest, true);

// key→string 对象（任意 sf）
function extractStrMapG(sf: ts.SourceFile, name: string): { key: string; value: string }[] {
  const init = findVarInit(sf, name);
  if (!ts.isObjectLiteralExpression(init)) throw new Error(`AST: ${name} 非对象`);
  return init.properties.map((p) => {
    const value = strLit((p as ts.PropertyAssignment).initializer);
    if (value === undefined) throw new Error(`AST: ${name}[${propName(p)}] 值非 string`);
    return { key: propName(p), value };
  });
}
// key→number(0..1 float) 对象 → permille（round·1000）
function extractPermilleMap(sf: ts.SourceFile, name: string): { key: string; permille: number }[] {
  const init = findVarInit(sf, name);
  if (!ts.isObjectLiteralExpression(init)) throw new Error(`AST: ${name} 非对象`);
  return init.properties.map((p) => {
    const v = numLit((p as ts.PropertyAssignment).initializer);
    if (v === undefined) throw new Error(`AST: ${name}[${propName(p)}] 值非 number`);
    return { key: propName(p), permille: Math.round(v * 1000) };
  });
}

// ---- band 组真源（bandEngine.ts / knowledge/instruments.ts / render/padCompPolicy.ts）----
const BAND = join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'band', 'bandEngine.ts');
const BAND_SF = ts.createSourceFile('bandEngine.ts', readFileSync(BAND, 'utf8'), ts.ScriptTarget.Latest, true);
const KI = join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'knowledge', 'instruments.ts');
const KI_SF = ts.createSourceFile('instruments.ts', readFileSync(KI, 'utf8'), ts.ScriptTarget.Latest, true);
const PADC = join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'render', 'padCompPolicy.ts');
const PADC_SF = ts.createSourceFile('padCompPolicy.ts', readFileSync(PADC, 'utf8'), ts.ScriptTarget.Latest, true);

// obj 混合 str/num 字段 → 记录（num 视为 0..1 float, 由调用方决定是否 permille 化）
function extractObj(node: ts.Node, ctx: string): Record<string, string | number> {
  if (!ts.isObjectLiteralExpression(node)) throw new Error(`AST: ${ctx} 非对象`);
  const o: Record<string, string | number> = {};
  for (const p of node.properties) {
    const s = strLit((p as ts.PropertyAssignment).initializer);
    const n = numLit((p as ts.PropertyAssignment).initializer);
    if (s === undefined && n === undefined) throw new Error(`AST: ${ctx}.${propName(p)} 非 string/number`);
    o[propName(p)] = s !== undefined ? s : (n as number);
  }
  return o;
}
function pm(v: number): number { return Math.round(v * 1000); }

// STYLE_PROFILES → STYP（7; densities→permille + tensionCarrier）
function extractStyleProfiles(): Record<string, unknown>[] {
  const init = findVarInit(BAND_SF, 'STYLE_PROFILES');
  if (!ts.isObjectLiteralExpression(init)) throw new Error('AST: STYLE_PROFILES 非对象');
  return init.properties.map((sp) => {
    const style = propName(sp);
    const o = extractObj((sp as ts.PropertyAssignment).initializer, `STYLE_PROFILES[${style}]`);
    return {
      style, tensionCarrier: o.tensionCarrier,
      accompDensity: pm(o.accompDensity as number), padDensity: pm(o.padDensity as number),
      melodyFreedom: pm(o.melodyFreedom as number), colorBudget: pm(o.colorBudget as number),
      beatStrictness: pm(o.beatStrictness as number),
    };
  });
}
// LINEUP_RULES → LNUP（always role list, codegen 算 mask）+ LNOP（optional {role,prob}）
function extractLineup(): Record<string, unknown>[] {
  const init = findVarInit(KI_SF, 'LINEUP_RULES');
  if (!ts.isObjectLiteralExpression(init)) throw new Error('AST: LINEUP_RULES 非对象');
  return init.properties.map((sp) => {
    const style = propName(sp);
    const o = (sp as ts.PropertyAssignment).initializer;
    if (!ts.isObjectLiteralExpression(o)) throw new Error(`AST: LINEUP_RULES[${style}] 非对象`);
    let always: string[] = []; const optional: { role: string; probPermille: number }[] = [];
    for (const p of o.properties) {
      const k = propName(p); const initz = (p as ts.PropertyAssignment).initializer;
      if (k === 'always') always = strArray(initz, `LINEUP_RULES[${style}].always`);
      else if (k === 'optional') {
        if (!ts.isArrayLiteralExpression(initz)) throw new Error('AST: optional 非数组');
        for (const el of initz.elements) {
          const eo = extractObj(el, `LINEUP_RULES[${style}].optional`);
          optional.push({ role: eo.role as string, probPermille: pm(eo.prob as number) });
        }
      } else throw new Error(`AST: LINEUP_RULES[${style}] 未知字段 ${k}`);
    }
    return { style, always, optional };
  });
}

// ---- intent / seed 组真源 ----
const SI = join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'knowledge', 'styleIntentProfiles.ts');
const SI_SF = ts.createSourceFile('styleIntentProfiles.ts', readFileSync(SI, 'utf8'), ts.ScriptTarget.Latest, true);
const FEV = join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'knowledge', 'finalEventProfile.ts');
const FEV_SF = ts.createSourceFile('finalEventProfile.ts', readFileSync(FEV, 'utf8'), ts.ScriptTarget.Latest, true);

function numArray(n: ts.Node, ctx: string): number[] {
  if (!ts.isArrayLiteralExpression(n)) throw new Error(`AST: ${ctx} 非数组`);
  return n.elements.map((e) => { const v = numLit(e); if (v === undefined) throw new Error(`AST: ${ctx} 元素非数字`); return v; });
}
function numLitVar(sf: ts.SourceFile, name: string): number {
  const v = numLit(findVarInit(sf, name)); if (v === undefined) throw new Error(`AST: ${name} 非数字`); return v;
}

// SINT — styleIntentProfiles PROFILES（6 具名 + DEFAULT 兜底; 删 bassFamily 死字段, §4.10 B10）
function extractStyleIntent(): Record<string, unknown>[] {
  const init = findVarInit(SI_SF, 'PROFILES');
  if (!ts.isObjectLiteralExpression(init)) throw new Error('AST: styleIntent PROFILES 非对象');
  const rows: Record<string, unknown>[] = init.properties.map((sp) => {
    const style = propName(sp);
    const o = (sp as ts.PropertyAssignment).initializer;
    if (!ts.isObjectLiteralExpression(o)) throw new Error(`AST: SINT[${style}] 非对象`);
    let dtf = '', btnb: number[] = [], ltc: number[] = [], lmg = 0;
    for (const p of o.properties) {
      const k = propName(p); const iz = (p as ts.PropertyAssignment).initializer;
      if (k === 'defaultTextureFamily') dtf = strLit(iz) ?? '';
      else if (k === 'bassTargetNotesPerBar') btnb = numArray(iz, 'bassTargetNotesPerBar');
      else if (k === 'leadTargetCoverage') ltc = numArray(iz, 'leadTargetCoverage');
      else if (k === 'leadMaxGapBeats') lmg = numLit(iz) ?? 0;
      else if (k !== 'bassFamily') throw new Error(`AST: SINT 未知字段 '${k}'（bassFamily 死字段除外, Codex f4）`);
      // bassFamily: 删（deriveMusicIntentPlan 用 bassFamilyFromFloorBeats, 不读 prof.bassFamily）
    }
    return { style, defaultTextureFamily: dtf, bassTargetLo: btnb[0], bassTargetHi: btnb[1],
             leadCoverageLo: pm(ltc[0]), leadCoverageHi: pm(ltc[1]), leadMaxGapBeats: lmg };
  });
  // DEFAULT 兜底行（styleIntentProfile ?? {rootAnchor,[1,2],block,[0.5,0.7],4}; 删 bassFamily; §4.10 裁定登记）
  rows.push({ style: 'default', defaultTextureFamily: 'block', bassTargetLo: 1, bassTargetHi: 2,
              leadCoverageLo: 500, leadCoverageHi: 700, leadMaxGapBeats: 4 });
  return rows;
}
// FEVT — finalEventProfile PROFILES.bassFloorBeats（4 具名 + DEFAULT[]）
function extractFinalEvent(): Record<string, unknown>[] {
  const init = findVarInit(FEV_SF, 'PROFILES');
  if (!ts.isObjectLiteralExpression(init)) throw new Error('AST: finalEvent PROFILES 非对象');
  const rows: Record<string, unknown>[] = init.properties.map((sp) => {
    const style = propName(sp);
    const o = (sp as ts.PropertyAssignment).initializer;
    if (!ts.isObjectLiteralExpression(o)) throw new Error(`AST: FEVT[${style}] 非对象`);
    const bfb = numArray((o.properties.find((p) => propName(p) === 'bassFloorBeats') as ts.PropertyAssignment).initializer, 'bassFloorBeats');
    return { style, bassFloorBeats: bfb };
  });
  rows.push({ style: 'default', bassFloorBeats: [] }); // finalEventProfile ?? {bassFloorBeats:[]}
  return rows;
}

// ---- instruments 组真源（knowledge/instruments.ts; INSTRUMENTS/WEIGHTS/FALLBACK/FAMILY_FALLBACK）----
// style→role→gm[] 嵌套（INSTRUMENTS）
function extractNested(sf: ts.SourceFile, name: string): Record<string, Record<string, number[]>> {
  const init = findVarInit(sf, name);
  if (!ts.isObjectLiteralExpression(init)) throw new Error(`AST: ${name} 非对象`);
  const out: Record<string, Record<string, number[]>> = {};
  for (const sp of init.properties) {
    const style = propName(sp);
    const inner = (sp as ts.PropertyAssignment).initializer;
    if (!ts.isObjectLiteralExpression(inner)) throw new Error(`AST: ${name}[${style}] 非对象`);
    const roles: Record<string, number[]> = {};
    for (const rp of inner.properties) roles[propName(rp)] = numArray((rp as ts.PropertyAssignment).initializer, `${name}[${style}][${propName(rp)}]`);
    out[style] = roles;
  }
  return out;
}
// style→role→{gm:weight}（INSTRUMENT_WEIGHTS）
function extractWeights(sf: ts.SourceFile, name: string): Record<string, Record<string, Record<number, number>>> {
  const init = findVarInit(sf, name);
  if (!ts.isObjectLiteralExpression(init)) throw new Error(`AST: ${name} 非对象`);
  const out: Record<string, Record<string, Record<number, number>>> = {};
  for (const sp of init.properties) {
    const style = propName(sp);
    const inner = (sp as ts.PropertyAssignment).initializer as ts.ObjectLiteralExpression;
    const roles: Record<string, Record<number, number>> = {};
    for (const rp of inner.properties) {
      const wm: Record<number, number> = {};
      const wobj = (rp as ts.PropertyAssignment).initializer as ts.ObjectLiteralExpression;
      for (const gp of wobj.properties) { const w = numLit((gp as ts.PropertyAssignment).initializer); if (w === undefined) throw new Error('AST: weight 非数字'); wm[Number(propName(gp))] = w; }
      roles[propName(rp)] = wm;
    }
    out[style] = roles;
  }
  return out;
}
// key→num（FALLBACK_PROGRAM）/ key→num[]（FAMILY_FALLBACK_PROGRAMS）
function extractNumMapRaw(sf: ts.SourceFile, name: string): { key: string; value: number }[] {
  const init = findVarInit(sf, name);
  if (!ts.isObjectLiteralExpression(init)) throw new Error(`AST: ${name} 非对象`);
  return init.properties.map((p) => { const v = numLit((p as ts.PropertyAssignment).initializer); if (v === undefined) throw new Error(`AST: ${name}[${propName(p)}] 非数字`); return { key: propName(p), value: v }; });
}
function extractNumListMap(sf: ts.SourceFile, name: string): { key: string; values: number[] }[] {
  const init = findVarInit(sf, name);
  if (!ts.isObjectLiteralExpression(init)) throw new Error(`AST: ${name} 非对象`);
  return init.properties.map((p) => ({ key: propName(p), values: numArray((p as ts.PropertyAssignment).initializer, `${name}[${propName(p)}]`) }));
}

// 冻结硬编码转录的真源函数 SHA（改函数体即失配 → 强制复审转录; Codex P2-0b f4）
function fnSha(sf: ts.SourceFile, name: string): string {
  let f: ts.FunctionDeclaration | undefined;
  sf.forEachChild((n) => { if (ts.isFunctionDeclaration(n) && n.name?.text === name) f = n; });
  if (!f) throw new Error(`fnSha: fn ${name} 未找到`);
  return createHash('sha256').update(f.getText(sf), 'utf8').digest('hex');
}

describe('export afe org (v5.0 四风格五轨组织 → 声明式源, 私有)', () => {
  it('freezes f4 硬编码转录真源函数 SHA（VBNK/PADC/ENDR/SINT-DEFAULT/FEVT-DEFAULT）', () => {
    const frozen: [ts.SourceFile, string, string][] = [
      [KI_SF, 'dream5504OrchestrationBank', '950178d17c2f233b585ced117b561d21d40f1fe6ea87fc98951785ebcc425bc9'], // VBNK 2 rule 逻辑
      [PADC_SF, 'decidePadComp', 'f88f7346d96dbcb60b870c16636ac2cd51f340cb93a370f697eaf76cad1d1cf0'],           // PADC style 分支
      [EDGE_SF, 'isLyricalMood', '256d979ac6a7b7150c797eed727b4d96788a3ae424d1395e1d220c9b983b1e04'],           // ENDR pop mood-alt
      [SI_SF, 'styleIntentProfile', 'b9028b87d03d0a24d373a44ce01e73ce6934892eee752acd13dcd1243ce7abf0'],         // SINT DEFAULT ?? fallback
      [FEV_SF, 'finalEventProfile', '3ddf09b22aca8f76b0b52d11fbcebbe2238be90eedb6f4a378310cb8e88dc9f7'],         // FEVT DEFAULT ?? fallback
    ];
    for (const [sf, name, sha] of frozen) expect(fnSha(sf, name)).toBe(sha);
  });

  it('dumps org_instrumental (DARC/TXBF/OTPG/LDOP)', () => {
    mkdirSync(OUT_DIR, { recursive: true });

    // ---- DARC（28 cell）----
    const darc = extractDensityArc();
    expect(darc.length).toBe(28); // pop6+rnb6+lofi4+jazz7+acg5

    // ---- TXBF（11）----
    const txbf = extractStrMap('TEXTURE_BY_FUNCTION').map((e) => ({ functionTag: e.key, textureKind: e.value }));
    expect(txbf.length).toBe(11);

    // ---- OTPG（8, OPENING_TEXTURE_TO_GENERIC; none 不在真源对象）----
    const otpg = extractStrMap('OPENING_TEXTURE_TO_GENERIC').map((e) => ({ openingTextureEntry: e.key, textureKind: e.value }));
    expect(otpg.length).toBe(8);

    // ---- LDOP（单例: lead_drop permille + optional/never tag 集）----
    const leadDropProb = numLit(findVarInit(INSTR_SF, 'LEAD_DROP_PROB'));
    if (leadDropProb === undefined) throw new Error('AST: LEAD_DROP_PROB 非数字');
    const optionalTags = strArray(findVarInit(INSTR_SF, 'LEAD_OPTIONAL_TAGS'), 'LEAD_OPTIONAL_TAGS');
    const neverTags = setStrArgs(findVarInit(INSTR_SF, 'LEAD_NEVER_DROP_TAGS'), 'LEAD_NEVER_DROP_TAGS');
    expect(optionalTags).toEqual(['setup', 'breakdown', 'outro', 'tag']);
    expect(neverTags.slice().sort()).toEqual(['outro', 'tag']);
    const ldop = { leadDropPermille: Math.round(leadDropProb * 1000), optionalTags, neverTags };
    expect(ldop.leadDropPermille).toBe(450);

    emit('org_instrumental.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'p2org_b_instrumental',
      source: 'instrumental/instrumentalPlanner.ts@Newengine_Demo-v5.0（DENSITY_ARC/TEXTURE_BY_FUNCTION/OPENING_TEXTURE_TO_GENERIC/LEAD_* AST 提取）',
      densityArc: darc,
      textureByFunction: txbf,
      openingTextureToGeneric: otpg,
      leadDrop: ldop,
    });
  });

  it('dumps org_opening (OPNC/OPRD/TXRS/TXFB)', () => {
    mkdirSync(OUT_DIR, { recursive: true });

    // ---- OPNC 22 候选 + OPRD 104 role-delay（规范化）----
    const candidates = extractOpeningCandidates();
    expect(candidates.length).toBe(22); // pop/rnb/lofi/jazz/acg 各 4 + default 2
    const oprdTotal = candidates.reduce((n, c) => n + (c.roleDelays as unknown[]).length, 0);
    expect(oprdTotal).toBe(104);

    // ---- TXRS 9（TEXTURE_ROLE_SUPPORT; none:[] 亦入表）----
    const txrs = extractStrListMap(OPEN_SF, 'TEXTURE_ROLE_SUPPORT').map((e) => ({ openingTextureEntry: e.key, roles: e.values }));
    expect(txrs.length).toBe(9);
    expect(txrs.reduce((n, r) => n + r.roles.length, 0)).toBe(17); // 池 golden

    // ---- TXFB 6（STYLE_TEXTURE_FALLBACKS）----
    const txfb = extractStrListMap(OPEN_SF, 'STYLE_TEXTURE_FALLBACKS').map((e) => ({ style: e.key, fallbacks: e.values }));
    expect(txfb.length).toBe(6);
    expect(txfb.reduce((n, r) => n + r.fallbacks.length, 0)).toBe(26); // 池 golden

    emit('org_opening.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'p2org_b_opening',
      source: 'arranger/openingGesturePlanner.ts@Newengine_Demo-v5.0（STYLE_CANDIDATES/TEXTURE_ROLE_SUPPORT/STYLE_TEXTURE_FALLBACKS AST 提取; roleDelay 按 ROLE_ORDER 规范化）',
      candidates,
      textureRoleSupport: txrs,
      styleTextureFallbacks: txfb,
    });
  });

  it('dumps org_dynamics (ENDR/ROEN/FNEN/RAMP)', () => {
    mkdirSync(OUT_DIR, { recursive: true });

    // ---- ENDR 5（ENDING_BY_STYLE + pop mood-conditional=fade; isLyricalMood 分类=P2-5 算法, 数据只登记备选）----
    const endr = extractStrMapG(EDGE_SF, 'ENDING_BY_STYLE').map((e) => ({
      style: e.key, endingStyle: e.value,
      hasMoodAlt: e.key === 'pop' ? 1 : 0,
      moodAltEnding: e.key === 'pop' ? 'fade' : null, // §4.4 pop+lyrical→fade（设计裁定登记）
    }));
    expect(endr.length).toBe(5);
    expect(endr.find((r) => r.style === 'jazz')!.endingStyle).toBe('tag');

    // ---- ROEN 5 / FNEN 11（permille）----
    const roen = extractPermilleMap(DYN_SF, 'ROLE_ENERGY').map((e) => ({ role: e.key, energyPermille: e.permille }));
    expect(roen.length).toBe(5);
    expect(roen.find((r) => r.role === 'chorus')!.energyPermille).toBe(900);
    const fnen = extractPermilleMap(DYN_SF, 'ENERGY_BY_FUNCTION').map((e) => ({ functionTag: e.key, energyPermille: e.permille }));
    expect(fnen.length).toBe(11);
    expect(fnen.find((r) => r.functionTag === 'hook')!.energyPermille).toBe(800);

    // ---- RAMP 3（per_occurrence + cap; hook/head/loop）----
    const perOcc = extractPermilleMap(DYN_SF, 'RAMP_PER_OCCURRENCE');
    const cap = new Map(extractPermilleMap(DYN_SF, 'RAMP_CAP').map((e) => [e.key, e.permille]));
    const ramp = perOcc.map((e) => {
      const c = cap.get(e.key);
      if (c === undefined) throw new Error(`RAMP_CAP 缺 ${e.key}`);
      return { functionTag: e.key, perOccurrencePermille: e.permille, capPermille: c };
    });
    expect(ramp.length).toBe(3);
    expect(ramp.find((r) => r.functionTag === 'hook')).toEqual({ functionTag: 'hook', perOccurrencePermille: 60, capPermille: 920 });

    emit('org_dynamics.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'p2org_b_dynamics',
      source: 'arranger/{edgePlanner,dynamicsPlanner}.ts@Newengine_Demo-v5.0（ENDING_BY_STYLE/ROLE_ENERGY/ENERGY_BY_FUNCTION/RAMP_* AST 提取; 能量→permille）',
      endingRules: endr,
      roleEnergy: roen,
      functionEnergy: fnen,
      ramp,
    });
  });

  it('dumps org_band (PADC/STYP/LNUP/LNOP)', () => {
    mkdirSync(OUT_DIR, { recursive: true });

    // ---- STYP 7（STYLE_PROFILES）----
    const styp = extractStyleProfiles();
    expect(styp.length).toBe(7);
    expect(styp.find((s) => s.style === 'jazz')).toMatchObject({ tensionCarrier: 'both', accompDensity: 700, padDensity: 100 });

    // ---- LNUP 7 + LNOP 11（LINEUP_RULES）----
    const lineup = extractLineup();
    expect(lineup.length).toBe(7);
    const lnopTotal = lineup.reduce((n, r) => n + (r.optional as unknown[]).length, 0);
    expect(lnopTotal).toBe(11); // pop2+lofi2+rnb2+modal3+default2
    expect(lineup.find((r) => r.style === 'jazz')!.always).toEqual(['lead', 'bass', 'comp', 'drum']);

    // ---- PADC 6（转录 decidePadComp style 分支; 休眠别名不入; AST 交叉验证 canonical 归属）----
    const rhythmic = strArray(findVarInit(PADC_SF, 'RHYTHMIC_STYLES'), 'RHYTHMIC_STYLES');
    const neosoul = strArray(findVarInit(PADC_SF, 'NEOSOUL_STYLES'), 'NEOSOUL_STYLES');
    expect(rhythmic).toContain('pop');   // :115 RHYTHMIC∩canonical=pop
    expect(neosoul).toContain('rnb');    // :119 NEOSOUL∩canonical=rnb
    const padc = [
      { style: 'jazz', padPolicyClass: 'silent-combo' },  // :104 jazz/blues→silent
      { style: 'blues', padPolicyClass: 'silent-combo' },
      { style: 'lofi', padPolicyClass: 'lofi-tape' },     // :108 cluster-mist/drone
      { style: 'pop', padPolicyClass: 'rhythmic' },       // :115 gated-pad
      { style: 'rnb', padPolicyClass: 'neosoul' },        // :119 inner-line
      { style: 'default', padPolicyClass: 'generic' },    // MODAL/ACG/其它兜底
    ];

    emit('org_band.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'p2org_b_band',
      source: 'band/bandEngine.ts + knowledge/instruments.ts + render/padCompPolicy.ts@Newengine_Demo-v5.0（STYLE_PROFILES/LINEUP_RULES AST 提取; PADC 转录 decidePadComp 分支+AST 交叉）',
      styleProfiles: styp,
      lineupRules: lineup,
      padPolicy: padc,
    });
  });

  it('dumps org_intent (SINT/FEVT/SEDP/MMOD/SCAL)', () => {
    mkdirSync(OUT_DIR, { recursive: true });

    // ---- SINT 7 / FEVT 5 ----
    const sint = extractStyleIntent();
    expect(sint.length).toBe(7);
    expect(sint.find((s) => s.style === 'jazz')).toMatchObject({ defaultTextureFamily: 'block', bassTargetLo: 3, bassTargetHi: 4, leadCoverageLo: 450, leadCoverageHi: 700 });
    const fevt = extractFinalEvent();
    expect(fevt.length).toBe(5);
    expect(fevt.find((s) => s.style === 'jazz')!.bassFloorBeats).toEqual([0, 1, 2, 3]);

    // ---- SEDP 6（VERSE_VARIATION_PROB 大写 key + STYLE_MINOR_PROBABILITY + 兜底）----
    const vvpObj = extractObj(findVarInit(INSTR_SF, 'VERSE_VARIATION_PROB'), 'VERSE_VARIATION_PROB');
    const smpObj = extractObj(findVarInit(BAND_SF, 'STYLE_MINOR_PROBABILITY'), 'STYLE_MINOR_PROBABILITY');
    const minorDefault = numLitVar(BAND_SF, 'MINOR_PROBABILITY');
    const sedp = ['pop', 'jazz', 'lofi', 'rnb', 'acg', 'default'].map((style) => ({
      style,
      verseVariationProb: pm((vvpObj[style.toUpperCase()] as number) ?? 0.35),
      minorProb: pm((smpObj[style] as number) ?? minorDefault),
    }));
    expect(sedp.find((s) => s.style === 'lofi')).toEqual({ style: 'lofi', verseVariationProb: 600, minorProb: 300 });
    expect(sedp.find((s) => s.style === 'acg')).toEqual({ style: 'acg', verseVariationProb: 350, minorProb: 640 });

    // ---- MMOD 5（MODAL_MODE_POOL 有序）----
    const mmod = strArray(findVarInit(BAND_SF, 'MODAL_MODE_POOL'), 'MODAL_MODE_POOL');
    expect(mmod).toEqual(['dorian', 'mixolydian', 'aeolian', 'lydian', 'phrygian']);

    // ---- SCAL 单例（多源标量 AST 提取; 全 permille + role_mask via list）----
    const scal = {
      timbreSwitchProb: pm(numLitVar(INSTR_SF, 'TIMBRE_SWITCH_PROB')),                 // 120
      timbreSwitchRoles: strArray(findVarInit(INSTR_SF, 'TIMBRE_SWITCH_ROLES'), 'TIMBRE_SWITCH_ROLES'), // [comp,lead]→codegen mask 0x0A
      minorProbability: pm(minorDefault),                                             // 300
      entryLift: pm(numLitVar(EDGE_SF, 'ENTRY_LIFT_THRESHOLD')),                       // 100
      padOff: pm(numLitVar(PADC_SF, 'PAD_OFF_DENSITY')),                              // 120
      padDrone: pm(numLitVar(PADC_SF, 'PAD_ONLY_DRONE_DENSITY')),                     // 300
      padGated: pm(numLitVar(PADC_SF, 'GATED_PAD_DENSITY')),                          // 650
      maxWeight: numLitVar(OPEN_SF, 'MAX_WEIGHT'),                                    // 3
    };
    expect(scal).toMatchObject({ timbreSwitchProb: 120, minorProbability: 300, entryLift: 100, padOff: 120, padDrone: 300, padGated: 650, maxWeight: 3 });
    expect(scal.timbreSwitchRoles).toEqual(['comp', 'lead']);

    emit('org_intent.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'p2org_b_intent',
      source: 'knowledge/{styleIntentProfiles,finalEventProfile}.ts + {instrumentalPlanner,bandEngine,edgePlanner,padCompPolicy,openingGesturePlanner} 标量@Newengine_Demo-v5.0（AST 提取; 删 SINT.bassFamily 死字段）',
      styleIntent: sint,
      finalEvent: fevt,
      seedPolicy: sedp,
      modalModePool: mmod,
      scalars: scal,
    });
  });

  it('dumps org_instruments (INST/VBNK/FBRP/FFBK; FFRC/TSFM 归 codegen GMBK 交叉)', () => {
    mkdirSync(OUT_DIR, { recursive: true });

    // ---- INST 67（style×role grouped, 候选 = INSTRUMENTS ∪ weight）----
    const instr = extractNested(KI_SF, 'INSTRUMENTS');
    const weights = extractWeights(KI_SF, 'INSTRUMENT_WEIGHTS');
    const instGroups: Record<string, unknown>[] = [];
    let candTotal = 0;
    for (const [style, roles] of Object.entries(instr)) {
      for (const [role, gms] of Object.entries(roles)) {
        const candidates = gms.map((gm) => ({
          kind: role === 'drum' ? 'drum' : 'melodic',
          gmProgram: gm,
          weight: weights[style]?.[role]?.[gm] ?? 1,
        }));
        candTotal += candidates.length;
        instGroups.push({ style, role, candidates });
      }
    }
    expect(candTotal).toBe(67); // 候选总数 golden
    // 每个 weight key 恰命中一个候选（设计 §4.9 构建期断言; 防悬空权重）
    for (const [style, roles] of Object.entries(weights))
      for (const [role, wm] of Object.entries(roles))
        for (const gm of Object.keys(wm))
          expect(instr[style]?.[role]?.includes(Number(gm))).toBe(true);

    // ---- VBNK 2（dream5504OrchestrationBank 逻辑转录; codegen canonical 命中 golden 0x8906e0fa9a782771）----
    expect(readFileSync(KI, 'utf8')).toContain('dream5504OrchestrationBank'); // 转录锚: 函数真源存在
    const vbnk = [
      { role: 'comp', gmProgram: 5, bank: 16, styleMask: ['pop', 'rnb', 'lofi', 'modal'] }, // PC5→Bank16
      { role: 'lead', gmProgram: 66, bank: 8, styleMask: ['jazz', 'blues'] },               // PC66→Bank8
    ];

    // ---- FBRP 5（FALLBACK_PROGRAM per role）----
    const fbrp = extractNumMapRaw(KI_SF, 'FALLBACK_PROGRAM').map((e) => ({ role: e.key, gmProgram: e.value }));
    expect(fbrp.length).toBe(5);
    expect(fbrp.find((r) => r.role === 'bass')!.gmProgram).toBe(32);

    // ---- FFBK 6 family / 9 gm（FAMILY_FALLBACK_PROGRAMS）----
    const ffbk = extractNumListMap(KI_SF, 'FAMILY_FALLBACK_PROGRAMS').map((e) => ({ family: e.key, programs: e.values }));
    expect(ffbk.length).toBe(6);
    expect(ffbk.reduce((n, f) => n + f.programs.length, 0)).toBe(9);

    emit('org_instruments.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'p2org_b_instruments',
      source: 'knowledge/instruments.ts@Newengine_Demo-v5.0（INSTRUMENTS/INSTRUMENT_WEIGHTS/FALLBACK_PROGRAM/FAMILY_FALLBACK_PROGRAMS AST; VBNK 转录 dream5504OrchestrationBank; FFRC/TSFM 由 codegen GMBK 交叉派生）',
      instruments: instGroups,
      voiceBankRules: vbnk,
      fallbackProgram: fbrp,
      familyFallback: ffbk,
    });
  });
});
