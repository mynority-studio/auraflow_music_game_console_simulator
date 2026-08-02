// ============================================================
// export-afe-jazz54-kb —— P2J 步 b：8 件生产 KB 数据面一次性导出
// ------------------------------------------------------------
// 设计门 v2 §3.2 分界（8 件生产 KB；Evidence 生产零引用不导）。
// 导出 = 各件的 export const 数据表（deepFreeze 树原样 JSON 化）；
// accessor 函数不导（执行器逻辑归 c/d/e 步 C 实现）。
// 落点 = 外仓 core/data/src/jazz54/jazz54_kb.json（新语料原生落本仓制度）。
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as harmonicForm from '../src/core/generation/newEngine/knowledge/jazzFiveFourHarmonicFormGrammar';
import * as leadRhythm from '../src/core/generation/newEngine/knowledge/jazzFiveFourLeadRhythmKnowledge';
import * as ensembleVar from '../src/core/generation/newEngine/knowledge/jazzFiveFourEnsembleVariationKnowledge';
import * as texture from '../src/core/generation/newEngine/knowledge/jazzFiveFourTextureKnowledge';
import * as drumPhrase from '../src/core/generation/newEngine/knowledge/jazzFiveFourDrumPhraseKnowledge';
import * as drumKb from '../src/core/generation/newEngine/knowledge/jazzFiveFourDrumKnowledge';
import * as leadGrammar from '../src/core/generation/newEngine/knowledge/jazzFiveFourLeadGrammar';
import * as roleKb from '../src/core/generation/newEngine/knowledge/jazzFiveFourRoleKnowledge';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'core', 'data', 'src', 'jazz54', 'jazz54_kb.json');

/** 只收数据值（const 表/标量/串）；函数一律剔除。 */
function dataOnly(mod: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(mod)) {
    if (typeof v === 'function') continue;
    out[k] = v;
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

describe('export afe jazz54 kb (P2J step b)', () => {
  it('exports 8 production KB data faces', () => {
    const doc = {
      schemaVersion: 'afe_jazz54_kb_v1',
      provenance: {
        generator: 'scripts/export-afe-jazz54-kb.export.test.ts',
        note: 'P2J 步 b 一次性转录（设计门 v2 §3.2 八件分界; Evidence 生产零引用不导）',
      },
      harmonicForm: dataOnly(harmonicForm as never),
      leadRhythm: dataOnly(leadRhythm as never),
      ensembleVariation: dataOnly(ensembleVar as never),
      texture: dataOnly(texture as never),
      drumPhrase: dataOnly(drumPhrase as never),
      drum: dataOnly(drumKb as never),
      leadGrammar: dataOnly(leadGrammar as never),
      role: dataOnly(roleKb as never),
    };
    assertJsonSafe(doc, '$');
    mkdirSync(dirname(OUT), { recursive: true });
    const text = JSON.stringify(doc, null, 1) + '\n';
    writeFileSync(OUT, text);
    const back = JSON.parse(readFileSync(OUT, 'utf8'));
    expect(back.schemaVersion).toBe('afe_jazz54_kb_v1');
    expect(Object.keys(back.harmonicForm).length).toBeGreaterThan(0);
    expect(Object.keys(back.role).length).toBeGreaterThan(0);
  });
});
