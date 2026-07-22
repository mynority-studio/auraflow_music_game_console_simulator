// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-trace — afe 迁移工装（P0b-1, 分支 tool/afe-trace-v5.0）
// ------------------------------------------------------------
// 对 G4 固定语料集(../core/tests/fixtures/corpus_set_v5.json)逐例导出
// 分层 trace: plans(L1: band/arrangement/harmonic/instrumentation[/acg/jazz54])
//           + ir(L2: MusicalIR) + midi(L3: musicalIRToMidiEvents)
// 输出: ../core/tests/fixtures/trace_v5/<id>.json（供 C 侧对照面板/G4 判定）
// 纪律: 只读引擎（工装分支不改 src/ 任何文件——引擎源必须与 v5.0 tag 逐字节同）
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-trace.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSongBundle, generateSongFromBundle } from '../src/core/generation/newEngine/generation/GenerationController';
import { musicalIRToMidiEvents, roomWetFor } from '../src/core/audio/musicalIrToMidi';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '..', '..', 'core', 'tests', 'fixtures', 'corpus_set_v5.json');
const OUT_DIR = join(HERE, '..', '..', 'core', 'tests', 'fixtures', 'trace_v5');

interface CorpusCase {
  id: string;
  seed: number;
  styleHint: string;
  mood: string;
  targetDuration: number;
}

/** timebase 含方法、seedRng 为闭包 → 序列化前投影为纯数据 */
function projectTimebase(tb: { ppq: number; meter: unknown; tempoMap: unknown }): unknown {
  return { ppq: tb.ppq, meter: tb.meter, tempoMap: tb.tempoMap };
}

describe('export afe trace (v5.0 corpus set)', () => {
  it('exports layered traces for all corpus cases', () => {
    const corpus = JSON.parse(readFileSync(CORPUS, 'utf8')) as { cases: CorpusCase[] };
    mkdirSync(OUT_DIR, { recursive: true });
    for (const c of corpus.cases) {
      const req = { seed: c.seed, styleHint: c.styleHint, mood: c.mood, targetDuration: c.targetDuration };
      const bundle = buildSongBundle(req);
      const result = generateSongFromBundle(bundle);
      expect(result.status, `${c.id}: 生成失败`).not.toBe('failed');
      const ir = result.ir;
      expect(ir, `${c.id}: 无 IR`).toBeTruthy();
      const midi = musicalIRToMidiEvents(ir!, roomWetFor(c.styleHint), c.styleHint);
      const trace = {
        meta: {
          case: c,
          spec: 'Newengine_Demo-v5.0',
          layers: ['plans', 'ir', 'midi'],
          status: result.status,
          attempts: (result as { attempts?: number }).attempts ?? null,
        },
        plans: {
          band: bundle.band,
          arrangement: bundle.arrangement,
          harmonic: bundle.harmonic,
          instrumentation: bundle.instrumentation,
          acgPianoScorePlan: bundle.acgPianoScorePlan ?? null,
          jazzFiveFourScorePlan: bundle.jazzFiveFourScorePlan ?? null,
          timebase: projectTimebase(bundle.timebase),
        },
        ir,
        midi,
      };
      writeFileSync(join(OUT_DIR, `${c.id}.json`), JSON.stringify(trace, null, 1));
    }
    // 工装纪律自检: 引擎源不得被本分支触碰（与规格 tag 逐字节同, 由 git 校验脚本另行执行）
    expect(corpus.cases.length).toBeGreaterThan(0);
  });
});
