// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-audit — v5.0 产品观察审计基准 exporter（P2-2a 阶段B；方案 A 独立）
// ------------------------------------------------------------
// 对 G4 固定语料集(../core/tests/fixtures/corpus_set_v5.json)逐例导出双审计器
// (和声 readOnlyHarmonyAuditor + 音乐性 musicalityAuditor) 的**有序 findings 观察**：
//   {id, seed, styleHint, mood, targetDuration, status, attempts, findings[]}
// findings = result.report.findings（AuditFinding 原序冻结；location 嵌套=normalized）。
// 方案 A：独立 exporter，**不改 trace v1**（export-afe-trace）、不升 traceSchemaVersion。
// 引擎源零触碰纪律：只在 scripts/；findings 由生产路径 generateSongFromBundle 计算，不改 src/。
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-audit.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSongBundle, generateSongFromBundle } from '../src/core/generation/newEngine/generation/GenerationController';
import { ACTIVE_DREAM_ORCHESTRATION_PALETTE } from '../src/core/generation/newEngine/instrumental/acousticDebugPalette';
import type { AuditFinding } from '../src/core/generation/newEngine/ir/AuditReport';

const SCHEMA_VERSION = 'audit_observation_v1';
const SPEC_ANCHOR = 'Newengine_Demo-v5.0 (fb33e9eaa74cee6a1c882b3d710391e969e0462e)';
// ★ 执行条件冻结（Codex B-1 复核 major）：10-findings 基准依赖 orchestration palette=full-modern-gm
//   （由 vitest.export.config.ts 注入 __AURA_TEST_DEFAULT_DREAM_PALETTE__）。应用缺省 acoustic-debug
//   仅得 8 findings（pop-11 comp chromatic-exposure 5→3）。故 fail-closed 断言此执行条件，
//   否则错 palette/错 config 会静默产出另一份基准而通过弱自检。
const REQUIRED_PALETTE = 'full-modern-gm';
const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '..', '..', 'core', 'tests', 'fixtures', 'corpus_set_v5.json');
const OUT_DIR = join(HERE, '..', '..', 'core', 'tests', 'golden', 'audit');
const OUT = join(OUT_DIR, 'v5_audit_observations.json');

interface CorpusCase { id: string; seed: number; styleHint: string; mood: string; targetDuration: number }

/** location 嵌套 = normalized（对齐 ir/AuditReport.ts::AuditFinding，与 v4.4 raw 展平区分） */
function projectFinding(f: AuditFinding) {
  return {
    severity: f.severity,
    location: { trackRole: f.location.trackRole, startTick: f.location.startTick },
    ruleId: f.ruleId,
    reason: f.reason,
    suggestedReturnPoint: f.suggestedReturnPoint,
  };
}

describe('export afe audit observations (v5.0 corpus set)', () => {
  it('exports ordered audit findings for all corpus cases', () => {
    const corpus = JSON.parse(readFileSync(CORPUS, 'utf8')) as { cases: CorpusCase[]; spec_anchor: string };
    mkdirSync(OUT_DIR, { recursive: true });

    // ★ fail-closed 执行条件冻结（先于任何生成，错条件立即红）
    expect(ACTIVE_DREAM_ORCHESTRATION_PALETTE, `orchestration palette 须 ${REQUIRED_PALETTE}（经 vitest.export.config.ts 注入）；当前=${ACTIVE_DREAM_ORCHESTRATION_PALETTE} 会产另一份基准`).toBe(REQUIRED_PALETTE);
    expect(corpus.spec_anchor, 'corpus spec_anchor 须等 SPEC_ANCHOR（防换语料/换规格 commit 静默漂移）').toBe(SPEC_ANCHOR);

    const cases = corpus.cases.map((c) => {
      const bundle = buildSongBundle({ seed: c.seed, styleHint: c.styleHint, mood: c.mood, targetDuration: c.targetDuration });
      const result = generateSongFromBundle(bundle);
      return {
        id: c.id, seed: c.seed, styleHint: c.styleHint, mood: c.mood, targetDuration: c.targetDuration,
        status: result.status,
        attempts: (result as { attempts?: number }).attempts ?? null,
        findings: result.report.findings.map(projectFinding), // 原序冻结
      };
    });

    // 聚合统计（自证 + 供 validator/impl 记录；由数据计算，非硬编码）
    const byRule: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byReturnPoint: Record<string, number> = {};
    let totalFindings = 0;
    for (const c of cases) {
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      totalFindings += c.findings.length;
      for (const f of c.findings) {
        byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
        bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
        byReturnPoint[f.suggestedReturnPoint] = (byReturnPoint[f.suggestedReturnPoint] ?? 0) + 1;
      }
    }

    const doc = {
      schemaVersion: SCHEMA_VERSION,
      sourceFormat: 'normalized', // v5 用真 AuditFinding（location 嵌套）；与 v4.4 raw 展平区分
      scope: 'P2-2a v5 产品观察基准（G4 语料 / orchestration palette=full-modern-gm 规格产品路径；非应用缺省 acoustic-debug）；12 例天然覆盖子集，非 13 规则全覆盖——conformance fixtures 另补',
      auditors: ['readOnlyHarmonyAuditor.auditHarmony', 'musicalityAuditor.auditMusicality'],
      provenance: {
        specAnchor: SPEC_ANCHOR,
        exporter: 'scripts/export-afe-audit.export.test.ts',
        executionConfig: 'vitest.export.config.ts',                 // 执行条件真源（注入 palette define）
        orchestrationPalette: ACTIVE_DREAM_ORCHESTRATION_PALETTE,   // = full-modern-gm（exporter fail-closed 断言）
        generatedVia: 'buildSongBundle → generateSongFromBundle（生产控制环路径；findings=result.report.findings 原序）',
        corpus: 'core/tests/fixtures/corpus_set_v5.json（G4 固定语料 12 例）',
        note: '方案 A 独立 exporter，不改 trace v1；工装 pin/零触碰见 core/docs/g6_spec_anchor.md（pin SHA 不入本文件以保 freshness 确定性）；B-2 执行面 pin 须同绑 audit exporter + vitest.export.config.ts',
        license: 'GPL 血统（generateSong→renderSongFull 消费 GPLv2+ 语料；v5.0 sim=GPL-3.0-only）；不入生产构建',
      },
      summary: {
        cases: cases.length,
        findings: totalFindings,
        byStatus, bySeverity, byRule, byReturnPoint,
      },
      cases,
    };

    const text = JSON.stringify(doc, null, 1) + '\n';
    writeFileSync(OUT, text);

    // 写后重读校验 + 结构自检
    const back = JSON.parse(readFileSync(OUT, 'utf8'));
    expect(back.cases.length).toBe(corpus.cases.length);
    expect(back.schemaVersion).toBe(SCHEMA_VERSION);
    for (const c of back.cases) {
      expect(c.status, `${c.id}: 生成失败不入观察基准`).not.toBe('failed');
      for (const f of c.findings) {
        expect(typeof f.location.startTick, `${c.id}: startTick 非精确整数`).toBe('number');
        expect(Number.isInteger(f.location.startTick)).toBe(true);
      }
    }
    expect(corpus.cases.length).toBeGreaterThan(0);
  });
});
