// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-knowledge — afe P1-3 语料声明式源导出（分支 tool/afe-trace-v5.0）
// ------------------------------------------------------------
// 把 v5.0 TS knowledge 真源 dump 为 afe 数据流水线的声明式源（IV 血统五 payload
// 的上游三件 + FRDM catalog 源）→ ../../core/data/src/iv/*.json
//   slope_corpus.json    ← knowledge/melodySlopeCorpus.ts  IMPROVISOR_SLOPES（6070, 逐字段 verbatim）
//   chord_vocab.json     ← knowledge/improvisorChordVocab.ts IMPROVISOR_VOCAB（114 defs）
//   texture_oracle.json  ← render/__mgTextureOracle__/comp_cmaj7.json（parse 校验后 canonical 重排字）
//   brick_catalog.json   ← knowledge/melodyBrickCatalog.ts IMPROVISOR_BRICKS + TYPES（FRDM digest golden 源）
// 纪律（沿 export-afe-trace 防线）：knowledgeSchemaVersion=1; dropUndefined(数组内
// undefined 仍拒绝) + assertJsonSafe; 双跑逐字节自检; 写后重读校验; 引擎源零触碰。
// ⚠️ 许可：以上数据均为 Impro-Visor(GPL-2.0-or-later) 衍生 → 产物属 afe IV 数据包
// 源形式（core/data/src/iv/, GPL 标注; 见 auraflow_engine NOTICE 与增补 A）。
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-knowledge.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { IMPROVISOR_SLOPES } from '../src/core/generation/newEngine/knowledge/melodySlopeCorpus';
import { IMPROVISOR_VOCAB } from '../src/core/generation/newEngine/knowledge/improvisorChordVocab';
import { IMPROVISOR_BRICKS, IMPROVISOR_BRICK_TYPES } from '../src/core/generation/newEngine/knowledge/melodyBrickCatalog';

const KNOWLEDGE_SCHEMA_VERSION = 1;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', '..', 'core', 'data', 'src', 'iv');
const TEX_SRC = join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'render', '__mgTextureOracle__', 'comp_cmaj7.json');

const EXPECT = { slopeRules: 6070, vocabDefs: 114, textureCases: 63 } as const;

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
    if (!Number.isFinite(v as number)) throw new Error(`非 JSON 数值 at ${path}: ${String(v)}`);
    return;
  }
  if (t === 'function' || t === 'undefined' || t === 'symbol' || t === 'bigint')
    throw new Error(`非 JSON 值(${t}) at ${path}`);
  if (v instanceof Map || v instanceof Set) throw new Error(`Map/Set at ${path}`);
  if (Array.isArray(v)) { v.forEach((x, i) => assertJsonSafe(x, `${path}[${i}]`)); return; }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) assertJsonSafe(x, `${path}.${k}`);
}

/** 序列化两次断言逐字节一致 + 写盘 + 重读回校验（导出器三重自检） */
function emit(name: string, doc: unknown): void {
  const clean = dropUndefined(doc);
  assertJsonSafe(clean, name);
  const a = JSON.stringify(clean, null, 1);
  const b = JSON.stringify(dropUndefined(doc), null, 1);
  expect(a).toBe(b);
  const p = join(OUT_DIR, name);
  writeFileSync(p, a + '\n', 'utf8');
  const back = readFileSync(p, 'utf8');
  expect(back).toBe(a + '\n');
  expect(() => JSON.parse(back)).not.toThrow();
}

describe('export afe knowledge (v5.0 → 声明式源, IV 数据包上游)', () => {
  it('dumps slope corpus / chord vocab / texture oracle / brick catalog', () => {
    mkdirSync(OUT_DIR, { recursive: true });

    expect(IMPROVISOR_SLOPES.length).toBe(EXPECT.slopeRules);
    emit('slope_corpus.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'slope_corpus',
      source: 'knowledge/melodySlopeCorpus.ts#IMPROVISOR_SLOPES@Newengine_Demo-v5.0',
      license: 'GPL-2.0-or-later (Impro-Visor derived)',
      ruleCount: IMPROVISOR_SLOPES.length,
      rules: IMPROVISOR_SLOPES,
    });

    expect(IMPROVISOR_VOCAB.length).toBe(EXPECT.vocabDefs);
    emit('chord_vocab.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'chord_vocab',
      source: 'knowledge/improvisorChordVocab.ts#IMPROVISOR_VOCAB@Newengine_Demo-v5.0',
      license: 'GPL-2.0-or-later (Impro-Visor derived)',
      defCount: IMPROVISOR_VOCAB.length,
      defs: IMPROVISOR_VOCAB,
    });

    const tex = JSON.parse(readFileSync(TEX_SRC, 'utf8')) as {
      chord: string; notesMidi: number[];
      dur4: Record<string, unknown>; dur8: Record<string, unknown>;
    };
    expect(Object.keys(tex.dur4).length).toBe(EXPECT.textureCases);
    expect(Object.keys(tex.dur8).length).toBe(EXPECT.textureCases);
    const texCases = Object.keys(tex.dur4);
    emit('texture_oracle.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'texture_oracle',
      source: 'render/__mgTextureOracle__/comp_cmaj7.json@Newengine_Demo-v5.0',
      license: 'GPL-2.0-or-later (Impro-Visor derived)',
      caseCount: texCases.length,
      oracle: tex,
    });

    expect(IMPROVISOR_BRICKS.length).toBeGreaterThan(0);
    emit('brick_catalog.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'brick_catalog',
      source: 'knowledge/melodyBrickCatalog.ts#IMPROVISOR_BRICKS@Newengine_Demo-v5.0',
      license: 'GPL-2.0-or-later (Impro-Visor derived)',
      brickTypes: IMPROVISOR_BRICK_TYPES,
      brickCount: IMPROVISOR_BRICKS.length,
      bricks: IMPROVISOR_BRICKS,
    });
  });
});
