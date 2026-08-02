// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-trace — afe 迁移工装（P0b-1, 分支 tool/afe-trace-v5.0; 复核 F1/F6 修订）
// ------------------------------------------------------------
// 对 G4 固定语料集(../core/tests/fixtures/corpus_set_v5.json)逐例导出分层 trace:
//   plans(L1) + ir(L2, timebase 显式投影) + midi(L3, ★正式调度序)
// traceSchemaVersion=1; 序列化前递归拒绝非 JSON 值; 写后重读校验。
// midi 调度序 = MidiScheduler.ts midiEventOrder（模块私有, 此处逐值复刻并锚定
// 源 MidiScheduler.ts:33-47 @Newengine_Demo-v5.0; 引擎源零触碰纪律禁止改 src/ 导出）。
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-trace.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSongBundle, generateSongFromBundle } from '../src/core/generation/newEngine/generation/GenerationController';
import { musicalIRToMidiEvents, roomWetFor } from '../src/core/audio/musicalIrToMidi';
import { decidePadComp, type PadCompDecision } from '../src/core/generation/newEngine/render/padCompPolicy';
import { activeAcgPianoSectionIds } from '../src/core/generation/newEngine/arranger/acgPianoScorePlan';
import { deriveMusicIntentPlan } from '../src/core/generation/newEngine/arranger/deriveMusicIntentPlan';
import type { MidiEvent } from '../src/core/audio/MidiScheduler';

const TRACE_SCHEMA_VERSION = 1;
const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '..', '..', 'core', 'tests', 'fixtures', 'corpus_set_v5.json');
const OUT_DIR = join(HERE, '..', '..', 'core', 'tests', 'fixtures', 'trace_v5');

interface CorpusCase { id: string; seed: number; styleHint: string; mood: string; targetDuration: number; jazzArchetypeId?: string }

/** 复刻 MidiScheduler.midiEventOrder（源锚定 MidiScheduler.ts:33-47 @v5.0） */
function midiEventOrder(ev: MidiEvent): number {
  if (ev.type === 'noteOff') return 0;
  if (ev.type === 'cc' && ev.data1 === 64 && ev.data2 <= 63) return 1;
  if (ev.type === 'cc' && ev.data1 === 121) return 2;
  if (ev.type === 'cc' && ev.data1 === 0) return 3;
  if (ev.type === 'programChange') return 4;
  if (ev.type === 'cc' && ev.data1 === 64 && ev.data2 >= 64) return 6;
  if (ev.type === 'cc' && ev.data1 === 11) return 5;
  if (ev.type === 'cc' || ev.type === 'pitchBend') return 5;
  return 7;
}
function toScheduledOrder(events: MidiEvent[]): MidiEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.ticks - b.e.ticks || midiEventOrder(a.e) - midiEventOrder(b.e) || a.i - b.i)
    .map(({ e }) => ({ ticks: e.ticks, type: e.type, channel: e.channel, data1: e.data1, data2: e.data2 ?? 0 }));
}

function projectTimebase(tb: { ppq: number; meter: unknown; tempoMap: unknown }): unknown {
  return { ppq: tb.ppq, meter: tb.meter, tempoMap: tb.tempoMap };
}

/** F6: undefined 属性 ≡ 字段缺省——显式递归剔除（非静默丢弃; 数组内 undefined 仍拒绝） */
function dropUndefined(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(dropUndefined);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (x !== undefined) out[k] = dropUndefined(x);
  }
  return out;
}

/** F6: 递归拒绝非 JSON 值（function/undefined/symbol/bigint/Map/Set/NaN/Inf） */
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

describe('export afe trace (v5.0 corpus set)', () => {
  it('exports layered traces for all corpus cases', () => {
    const corpus = JSON.parse(readFileSync(CORPUS, 'utf8')) as { cases: CorpusCase[] };
    mkdirSync(OUT_DIR, { recursive: true });
    for (const c of corpus.cases) {
      const req = { seed: c.seed, styleHint: c.styleHint, mood: c.mood, targetDuration: c.targetDuration, jazzArchetypeId: c.jazzArchetypeId as never };
      const bundle = buildSongBundle(req);
      const result = generateSongFromBundle(bundle);
      expect(result.status, `${c.id}: 生成失败`).not.toBe('failed');
      const ir = result.ir!;
      expect(ir, `${c.id}: 无 IR`).toBeTruthy();
      const midi = toScheduledOrder(musicalIRToMidiEvents(ir, roomWetFor(c.styleHint), c.styleHint));
        // P2-13 步1 扩导（E18 oracle 两面; 既有键投影不变由重导 diff 机器校验）：
        // padCompDecisionBySection —— decidePadComp 真源函数 + coordinator:848-863 同式 ctx
        //（activeSectionIds 派生照抄 :736-738; hasResolvedRoleLayout ⇒ comp 活跃段集）。
        const inst = bundle.instrumentation;
        const inLineup = (role: string) => bundle.band.instrumentPool.includes(role as never);   /* :835 真源形态 */
        const roleInArr = (sid: string, role: string) =>
          ((inst.activeRolesBySection[sid] as readonly string[] | undefined)?.includes(role) ?? true);
        const hasResolvedRoleLayout = bundle.arrangement.resolvedArchetype !== undefined;
        const compActive = new Set(bundle.arrangement.sections
          .filter((s2) => (inst.activeRolesBySection[s2.id] ?? []).includes('comp'))
          .map((s2) => s2.id));
        const activeSectionIds = hasResolvedRoleLayout
          ? compActive
          : activeAcgPianoSectionIds(inst);   /* 真源函数直取（:738 同名调用） */
        const reservedReg = inst.melodyReservationPlan.reservedRegister;
        const padCompDecisionBySection: Record<string, PadCompDecision> = {};
        for (const s2 of bundle.arrangement.sections) {
          padCompDecisionBySection[s2.id] = decidePadComp({
            style: bundle.band.style,
            sectionId: s2.id,
            sectionRole: s2.role,
            padDensity: bundle.band.styleProfile.padDensity,
            padActive: inLineup('pad') && roleInArr(s2.id, 'pad'),
            compActive: inLineup('comp') && activeSectionIds.has(s2.id) && roleInArr(s2.id, 'comp'),
            bassActive: inLineup('bass') && roleInArr(s2.id, 'bass'),
            leadReservedLow: reservedReg.lowMidi as number,
            leadReservedHigh: reservedReg.highMidi,
          });
        }
        const musicIntentPlan = deriveMusicIntentPlan(bundle.band.style, bundle.arrangement);
        const trace_plans_extra = { padCompDecisionBySection, musicIntent: musicIntentPlan };
        void trace_plans_extra;
      const trace = {
        traceSchemaVersion: TRACE_SCHEMA_VERSION,
        meta: {
          case: c,
          spec: 'Newengine_Demo-v5.0',
          layers: ['plans', 'ir', 'midi'],
          midiOrder: 'scheduled(MidiScheduler.midiEventOrder)',
          status: result.status,
          attempts: (result as { attempts?: number }).attempts ?? null,
        },
        plans: {
          band: bundle.band,
          arrangement: bundle.arrangement,
          harmonic: bundle.harmonic,
          instrumentation: { ...inst, padCompDecisionBySection },
          musicIntent: musicIntentPlan,
          acgPianoScorePlan: bundle.acgPianoScorePlan ?? null,
          jazzFiveFourScorePlan: bundle.jazzFiveFourScorePlan ?? null,
          timebase: projectTimebase(bundle.timebase),
        },
        ir: { ...(ir as object), timebase: projectTimebase((ir as { timebase: { ppq: number; meter: unknown; tempoMap: unknown } }).timebase) },
        midi,
      };
      const clean = dropUndefined(trace); // undefined 属性显式剔除(≡缺省), 余者严检
      assertJsonSafe(clean, '$'); // 序列化完整性: 有丢失风险的值直接拒绝
      const out = join(OUT_DIR, `${c.id}.json`);
      const text = JSON.stringify(clean, null, 1);
      writeFileSync(out, text);
      const back = JSON.parse(readFileSync(out, 'utf8')); // 写后重读校验
      expect(back.traceSchemaVersion).toBe(TRACE_SCHEMA_VERSION);
      expect(back.midi.length).toBe(midi.length);
      // 调度序自检: tick 非降 + 同 tick 优先级非降
      for (let i = 1; i < back.midi.length; i++) {
        const a = back.midi[i - 1], b = back.midi[i];
        expect(b.ticks >= a.ticks, `${c.id}: midi[${i}] tick 逆序`).toBe(true);
        if (b.ticks === a.ticks)
          expect(midiEventOrder(b) >= midiEventOrder(a), `${c.id}: midi[${i}] 同 tick 优先级逆序`).toBe(true);
      }
    }
    expect(corpus.cases.length).toBeGreaterThan(0);
  });
});
