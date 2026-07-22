// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-gmbk — afe P1-6/7/8 GMBK 策略层声明式源导出（分支 tool/afe-trace-v5.0）
// ------------------------------------------------------------
// 硬件事实真源 = samvs standard TSV（afe codegen 直读, sha256 锚 G6）；本导出器只
// dump **引擎策略层**（v5.0 TS）→ ../../core/data/src/gmbk/*.json（非 IV, 私有）:
//   gmbk_catalog.json        GM128 catalog（main/variations/drums + role/note 策略字段;
//                            ⚠️ 含 TS 侧幽灵条目 m/b8/p25——codegen 按 DEV-001 剔除并断言唯一）
//   gmbk_voice_profiles.json DreamVoiceProfile 全量（六分类 + roleCapabilities + arrangementStatus）
//   gmbk_cc_profiles.json    逐 catalog 地址求值 dreamVoiceCcProfile（角色无关性断言;
//                            drum kits 按 role=drum; bank127 无 profile → 全阻）
// 纪律同 export-afe-knowledge（三重自检/引擎源零触碰）。
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-gmbk.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GM128_MAIN_PROGRAMS, GM128_VARIATION_PROGRAMS, GM128_DRUM_KITS, GM128_CATALOG_COUNTS,
} from '../src/core/sound/GMBK5X128Catalog';
import {
  DREAM5504_MODERN_MELODIC_VOICE_PROFILES, DREAM5504_DRUM_VOICE_PROFILES,
} from '../src/core/generation/newEngine/instrumental/dreamVoiceProfiles';
import { dreamVoiceCcProfile } from '../src/core/generation/newEngine/instrumental/dreamCcCapabilities';
import type { InstrumentRoleName } from '../src/core/generation/newEngine/band/BandSpec';

const KNOWLEDGE_SCHEMA_VERSION = 1;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', '..', 'core', 'data', 'src', 'gmbk');

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
  expect(JSON.stringify(dropUndefined(doc), null, 1)).toBe(a);
  const p = join(OUT_DIR, name);
  writeFileSync(p, a + '\n', 'utf8');
  expect(readFileSync(p, 'utf8')).toBe(a + '\n');
}

describe('export afe gmbk strategy (v5.0 策略层 → 声明式源, 私有)', () => {
  it('dumps catalog / voice profiles / cc profiles', () => {
    mkdirSync(OUT_DIR, { recursive: true });

    // TS 侧计数（含幽灵）: 128/269/10/407 —— afe codegen 按 DEV-001 剔除后 268/406
    expect(GM128_CATALOG_COUNTS.mainPrograms).toBe(128);
    expect(GM128_CATALOG_COUNTS.variations).toBe(269);
    expect(GM128_CATALOG_COUNTS.drumKits).toBe(10);
    emit('gmbk_catalog.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'gmbk_catalog',
      source: 'sound/GMBK5X128Catalog.ts@Newengine_Demo-v5.0',
      note: 'TS 层含 XDB 幽灵补录 m/b8/p25（DEV-001 已批剔除, afe codegen 对账时断言唯一多余项）',
      counts: GM128_CATALOG_COUNTS,
      main: GM128_MAIN_PROGRAMS,
      variations: GM128_VARIATION_PROGRAMS,
      drums: GM128_DRUM_KITS,
    });

    const profiles = [...DREAM5504_MODERN_MELODIC_VOICE_PROFILES, ...DREAM5504_DRUM_VOICE_PROFILES];
    expect(profiles.length).toBeGreaterThan(100);
    emit('gmbk_voice_profiles.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'gmbk_voice_profiles',
      source: 'instrumental/dreamVoiceProfiles.ts@Newengine_Demo-v5.0',
      profileCount: profiles.length,
      profiles,
    });

    // CC profiles: 逐 catalog 地址求值; 旋律地址断言角色无关（drum 特判分支之外）
    type CcDump = {
      addressKind: 'melodic' | 'drum'; bank: number; program: number;
      roles: InstrumentRoleName[];
      automatic: number[]; audition: number[]; blocked: number[];
      pedal: { kind: string; controller: number; verification: string; evidence: string };
    };
    const ccDumps: CcDump[] = [];
    const melodic = [...GM128_MAIN_PROGRAMS, ...GM128_VARIATION_PROGRAMS];
    for (const item of melodic) {
      const prof = profiles.find(p => (p.address.bank ?? 0) === item.bank && p.address.program === item.program);
      const roles: InstrumentRoleName[] = prof ? [...prof.roleCapabilities] : [];
      const evalRoles: InstrumentRoleName[] = roles.length ? roles : ['lead'];
      const first = dreamVoiceCcProfile({ bank: item.bank, program: item.program, role: evalRoles[0] });
      for (const r of evalRoles.slice(1)) {
        const other = dreamVoiceCcProfile({ bank: item.bank, program: item.program, role: r });
        expect(other.automaticControllers).toEqual(first.automaticControllers);
        expect(other.auditionControllers).toEqual(first.auditionControllers);
        expect(other.blockedControllers).toEqual(first.blockedControllers);
        expect(other.pedal).toEqual(first.pedal);
      }
      ccDumps.push({
        addressKind: 'melodic', bank: item.bank, program: item.program, roles,
        automatic: [...first.automaticControllers], audition: [...first.auditionControllers],
        blocked: [...first.blockedControllers],
        pedal: { kind: first.pedal.kind, controller: first.pedal.controller,
                 verification: first.pedal.verification, evidence: first.pedal.evidence },
      });
    }
    for (const kit of GM128_DRUM_KITS) {
      const p = dreamVoiceCcProfile({ program: kit.program, role: 'drum' });
      ccDumps.push({
        addressKind: 'drum', bank: 0, program: kit.program, roles: ['drum'],
        automatic: [...p.automaticControllers], audition: [...p.auditionControllers],
        blocked: [...p.blockedControllers],
        pedal: { kind: p.pedal.kind, controller: p.pedal.controller,
                 verification: p.pedal.verification, evidence: p.pedal.evidence },
      });
    }
    expect(ccDumps.length).toBe(GM128_CATALOG_COUNTS.totalAuditionItems);
    emit('gmbk_cc_profiles.json', {
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      kind: 'gmbk_cc_profiles',
      source: 'instrumental/dreamCcCapabilities.ts@Newengine_Demo-v5.0（逐地址纯函数求值）',
      entryCount: ccDumps.length,
      entries: ccDumps,
    });
  });
});
