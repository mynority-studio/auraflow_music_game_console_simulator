// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-band — v5.0 L1 band 逐位对账靶 exporter（P2-3③；方案 A 独立）
// ------------------------------------------------------------
// 对 8 seed × 8 styleHint = 64 例，**直接调 buildBandSpec**（不经完整歌曲 pipeline），
// emit raw BandSpec 的 band 层投影 → core/tests/golden/afe_golden_l1_band.json。
// AFE core P2-3③（v5 增量）的独立 TS oracle，对锁 afe_build_band_spec 的 v5 输出。
// 引擎源零触碰纪律：只在 scripts/；band 由生产 buildBandSpec 计算，不改 src/。
// provenance：静态字段（无动态 tooling HEAD/dirty；无 parityPatch——v5 是直接导出非 parity patch）；
//   tooling pin 由 G6 机器锁负责，本 JSON 冻结 exporter 路径 + schemaVersion + exporterSha + specAnchor +
//   engineBaseCommit（转换器 gen_golden_l1_band.py 逐一精确锁；exporterSha 另由 gate TS→JSON 重导门验）。
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-band.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { buildBandSpec } from '../src/core/generation/newEngine/band/bandEngine';
import type { GenerationRequest } from '../src/core/generation/newEngine/band/bandEngine';
import type { BandSpec } from '../src/core/generation/newEngine/band/BandSpec';

const SCHEMA_VERSION = 'band_golden_v1';
const ENGINE_BASE_COMMIT = 'fb33e9eaa74cee6a1c882b3d710391e969e0462e'; // Newengine_Demo-v5.0
const HERE = dirname(fileURLToPath(import.meta.url));
const EXPORTER_REL = 'scripts/export-afe-band.export.test.ts';
const OUT_DIR = join(HERE, '..', '..', 'core', 'tests', 'golden');
const OUT = join(OUT_DIR, 'afe_golden_l1_band.json');

// ① 矩阵（与 v4.4 golden 同 seed/hint 序 → v4.4↔v5 逐例可比）。
const SEEDS = [12345, 7, 42, 1001, 20260612, 31415926, 271828182, 999999937];
const STYLE_HINTS = ['pop', 'jazz', 'lofi', 'rnb', 'acg', 'modal', 'default', '__unknown__'];
const ROLE_ORDER = ['bass', 'comp', 'pad', 'lead', 'drum'];
// band-local 索引（1:1 ne_style_t / church；C afe_band_style_t 同序）。
const STYLE_INDEX: Record<string, number> = { lofi: 0, jazz: 1, pop: 2, rnb: 3, modal: 4, default: 5, acg: 6 };
const CHURCH_INDEX: Record<string, number> = {
  ionian: 0, dorian: 1, phrygian: 2, lydian: 3, mixolydian: 4, aeolian: 5, locrian: 6, none: 7,
};
// ACG minor 阈值三段覆盖（v5 acg=0.64；判据 roll<prob?minor:major，Codex 设计门核验）：
//   12345(0.276<0.3)→minor 同；7/42/31415926(∈[0.3,0.64))→v4.4 major/v5 minor；其余(≥0.64)→major 同。
const ACG_EXPECT_MINOR = new Set([12345, 7, 42, 31415926]);

/** 递归拒绝非 JSON 值（function/undefined/NaN/Inf/Map/Set）——序列化前 fail-closed。 */
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

/** BandSpec → band 层投影（字段集 = Python 转换器 EXPECT_BAND_KEYS；无 hash/styleProfile/allowModulation/autoFilled/family）。 */
function projectBand(b: BandSpec) {
  return {
    style: b.style,
    tonalityKind: b.tonalityKind,
    key: b.key as number,
    mode: b.mode,
    modalModeName: b.modalModeName ?? null,
    primaryScale: b.primaryScale.map((p) => p as number),
    instrumentPool: b.instrumentPool.slice(),
    roleProgram: { ...b.roleProgram },
  };
}

describe('export afe band golden (v5.0, 8 seed × 8 styleHint)', () => {
  it('exports raw buildBandSpec band layer for the 64-case matrix', () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const exporterSha = createHashHex(readFileSync(join(HERE, 'export-afe-band.export.test.ts')));
    const cases: Array<{ seed: number; styleHint: string; band: ReturnType<typeof projectBand> }> = [];
    const acgMode: Record<number, string> = {};
    for (const seed of SEEDS) {
      for (const styleHint of STYLE_HINTS) {
        // GenerationRequest 的 mood/targetDuration 为必填（bandEngine.ts:25）；buildBandSpec 现不消费，
        // 但按合同冻结确定值（satisfies 强制完整类型契约，防 vitest 转译掩盖的 API 漂移）。
        const req = { seed, styleHint, mood: 'build', targetDuration: 90 } satisfies GenerationRequest;
        const spec = buildBandSpec(req);
        const band = projectBand(spec);
        // 域自检（fail-closed）
        expect(band.primaryScale.length, `${styleHint}/${seed}: scale≠7`).toBe(7);
        expect(['tonal', 'modal']).toContain(band.tonalityKind);
        expect(['major', 'minor']).toContain(band.mode);
        for (const r of band.instrumentPool) expect(ROLE_ORDER).toContain(r);
        if (styleHint === 'acg') acgMode[seed] = band.mode;
        cases.push({ seed, styleHint, band });
      }
    }
    // ★ ACG 阈值三段显式断言（非依赖数据偶然满足，Codex 设计门 #5）
    for (const seed of SEEDS) {
      const expMinor = ACG_EXPECT_MINOR.has(seed);
      expect(acgMode[seed], `acg/${seed}: minor 阈值三段不符（期望 ${expMinor ? 'minor' : 'major'}）`)
        .toBe(expMinor ? 'minor' : 'major');
    }

    const out = {
      meta: {
        layer: 'L1 band',
        schemaVersion: SCHEMA_VERSION,
        generator: EXPORTER_REL,
        exporterSha,
        engineBaseCommit: ENGINE_BASE_COMMIT,
        specAnchor: 'Newengine_Demo-v5.0',
        note: 'raw buildBandSpec 直接调（非 pipeline）；8 seed×8 styleHint=64 例；band-local style/church 索引；band 字段=style/tonalityKind/key/mode/modalModeName/primaryScale/instrumentPool/roleProgram（无 hash）。',
        styleHints: STYLE_HINTS,
        roleOrder: ROLE_ORDER,
        styleIndex: STYLE_INDEX,
        churchIndex: CHURCH_INDEX,
      },
      cases,
    };
    assertJsonSafe(out, 'root');
    writeFileSync(OUT, JSON.stringify(out, null, 1));
    // 写后重读校验（确定性 + JSON 合法）
    const reread = JSON.parse(readFileSync(OUT, 'utf8'));
    expect(reread.cases.length).toBe(64);
    expect(reread.meta.engineBaseCommit).toBe(ENGINE_BASE_COMMIT);
  });
});

/** 确定性 sha256 hex（node crypto；exporter 源自哈希用于 provenance 冻结）。 */
function createHashHex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
