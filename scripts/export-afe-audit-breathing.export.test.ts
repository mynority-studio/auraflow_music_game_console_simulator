// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-audit-breathing — P2-2b 步3：isBreathingTexture 逐 texture-case 求值
// ------------------------------------------------------------
// afe 设计门 D-M4：audit Rule5 breathing 放宽判据以 51 canonical texture-case
// 逐名在 sim 内跑真 isBreathingTexture（textureProfiles.ts 项目自有）→ bit 表。
// 名单真源 = afe 仓 core/data/src/groove/afe_groove_kb.json texture 段（canonical
// registry, P2-4c 步1/P2-7 步b 冻结序）——不在本 exporter 重复 canonical 化。
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-audit-breathing.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isBreathingTexture } from '../src/core/generation/newEngine/knowledge/textureProfiles';

const HERE = dirname(fileURLToPath(import.meta.url));
const KB = join(HERE, '..', '..', 'core', 'data', 'src', 'groove', 'afe_groove_kb.json');
const OUT = join(HERE, '..', '..', 'core', 'tests', 'golden', 'afe_audit_breathing.json');
const SPEC_ANCHOR = 'Newengine_Demo-v5.0 (fb33e9eaa74cee6a1c882b3d710391e969e0462e)';

describe('export afe audit breathing bits', () => {
  it('evaluates isBreathingTexture over canonical texture-case registry', () => {
    const kb = JSON.parse(readFileSync(KB, 'utf-8'));
    const names: string[] = kb.textureCase.cases.map((c: { id: number; name: string }, i: number) => {
      expect(c.id, 'registry id 连续').toBe(i);
      return c.name;
    });
    expect(names.length).toBeGreaterThan(0);
    const rows = names.map((name, id) => ({ id, name, breathing: isBreathingTexture(name) ? 1 : 0 }));
    // fail-closed 抓手：已知语义定点（Ambient_Pad_Breath 稀疏呼吸=1；Pop_Anthem_Drive 密集=0）
    const by = Object.fromEntries(rows.map((r) => [r.name, r.breathing]));
    expect(by['Ambient_Pad_Breath'], 'Ambient_Pad_Breath 应 breathing').toBe(1);
    writeFileSync(OUT, JSON.stringify({
      schemaVersion: 'afe_audit_breathing_v1',
      provenance: {
        specAnchor: SPEC_ANCHOR,
        generator: 'scripts/export-afe-audit-breathing.export.test.ts',
        source: 'knowledge/textureProfiles.ts isBreathingTexture（项目自有）× canonical registry 名单（afe_groove_kb.json texture 段）',
        rebuild: 'pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-audit-breathing.export.test.ts',
      },
      count: rows.length,
      breathingCount: rows.filter((r) => r.breathing).length,
      cases: rows,
    }, null, 1) + '\n');
    console.error(`breathing bits: ${rows.filter((r) => r.breathing).length}/${rows.length}`);
  });
});
