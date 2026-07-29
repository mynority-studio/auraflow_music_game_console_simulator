// ============================================================
// export-afe-harmony —— P2-6 步e：v5 HarmonicPlan golden（一次性转录，入仓即产权）
// ------------------------------------------------------------
// 直调生产链 buildBandSpec → buildArrangementPlan → buildHarmonicPlanFromArrangement
// （同 GenerationController.ts:204-219 序，单 ctx 贯穿——stage 子流隔离已由 v4.4 golden 实证）。
// 投影 = HarmonicPlanData 10 字段全量；double 一律附 IEEE754 bits64。
// motif 双路径（设计门二轮 F1）：默认路径 = 本文件直调 builder 逐位；
// override 旁路 = 经真实产品入口 generateSongFromMotif 断言 builder 被旁路（onlyBypassCheck 例）。
// jazz 5/4（resolved harmonyPolicyId=jazz-five-four-form-grammar）例只承载输入+期望拒绝
// （C 侧 fail-closed 归 P2J-c，设计 §5）。
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-harmony.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { buildBandSpec, withBandMode } from '../src/core/generation/newEngine/band/bandEngine';
import { buildArrangementPlan } from '../src/core/generation/newEngine/arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../src/core/generation/newEngine/harmony/harmonyEngine';
import { buildMotifSongBundle } from '../src/core/generation/newEngine/generation/generateSongFromMotif';
import { createRandomContext } from '../src/core/generation/newEngine/foundation/randomContext';
import type { HarmonicPlan } from '../src/core/generation/newEngine/harmony/HarmonicPlan';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'core', 'tests', 'golden', 'afe_harmony_v5_golden.json');
const SCHEMA_VERSION = 'harmony_v5_golden_v1';

function bits64(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`bits64 非有限值 ${x}`);
  const b = Buffer.alloc(8);
  b.writeDoubleLE(x, 0);
  return '0x' + b.readBigUInt64LE(0).toString(16);
}

function assertJsonSafe(v: unknown, path: string): void {
  if (v === undefined) throw new Error(`undefined at ${path}`);
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`非有限数 at ${path}`);
  if (Array.isArray(v)) { v.forEach((x, i) => assertJsonSafe(x, `${path}[${i}]`)); return; }
  if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) assertJsonSafe(x, `${path}.${k}`);
}

interface Fx {
  name: string; styleHint: string; seed: number; mood?: string; targetDuration?: number;
  allowModulation?: boolean; jazzArchetypeId?: string;
  /** jazz 5/4 policy 例：C 侧期望拒绝（P2J-c），只承载输入。 */
  expectFiveFourRejected?: boolean;
  why: string;
}

// 桶设计（覆盖计数在文末机器断言）：5 风格 × 大小调实际由 seed 决定——按 band.mode 统计；
// modal 旁路（modal style）；tonicization 上限风格差（JAZZ4/POP2/RNB3/BLUES0/LOFI0）；
// tail link 由 arrangement linkOut 驱动（arrangement golden 已锁其分布）；borrow 门限
// colorBudget>=0.3（POP0.4? 按 STYLE_PROFILES 实值, 统计 borrowed 命中）。
const FIXTURES: readonly Fx[] = [
  { name: 'pop_a', styleHint: 'pop', seed: 11, why: 'pop 基线（候选择优+借和弦域）' },
  { name: 'pop_b_dur', styleHint: 'pop', seed: 12, targetDuration: 95, why: 'pop + duration（段数/乐句变化传导 harmony）' },
  { name: 'rock_default', styleHint: 'rock', seed: 13, why: '未知 styleHint → default 风格路径' },
  { name: 'jazz_a', styleHint: 'jazz', seed: 21, why: 'jazz 4/4（tonicization 上限 4 + 浓色彩）' },
  { name: 'jazz_b', styleHint: 'jazz', seed: 27, why: 'jazz 第二 seed（archetype/曲式变体）' },
  { name: 'lofi_a', styleHint: 'lofi', seed: 31, why: 'lofi（tonicize 0 + LOFI_NO_TRANSFORM）' },
  { name: 'lofi_b', styleHint: 'lofi', seed: 35, why: 'lofi 第二 seed' },
  { name: 'rnb_a', styleHint: 'rnb', seed: 41, why: 'rnb（backdoor/borrow 域）' },
  { name: 'rnb_b_dur', styleHint: 'rnb', seed: 44, targetDuration: 150, why: 'rnb + duration' },
  { name: 'acg_a', styleHint: 'acg', seed: 51, why: 'acg（P2-11 步0 曲式 + acg 进行池）' },
  { name: 'acg_b', styleHint: 'acg', seed: 55, targetDuration: 70, why: 'acg + duration（medium/short 曲式域）' },
  { name: 'modal_a', styleHint: 'modal', seed: 61, why: 'modal 旁路（零 RNG 分支, chord-scale=primaryScale）' },
  { name: 'modal_b', styleHint: 'modal', seed: 66, why: 'modal 第二 seed' },
  { name: 'pop_c', styleHint: 'pop', seed: 17, why: 'pop 第三 seed（minor 命中备选）' },
  { name: 'jazz_c', styleHint: 'jazz', seed: 29, why: 'jazz 第三 seed（minor/曲式备选）' },
  { name: 'jazz54_modern_reject', styleHint: 'jazz', seed: 21, jazzArchetypeId: 'jazz_5_4_modern_piano',
    why: '5/4 modern piano（显式 id；weight=1 但自然域 320 组零命中——拒绝例, P2J-c）' },
  { name: 'jazz54_quartet_reject', styleHint: 'jazz', seed: 21, jazzArchetypeId: 'jazz_5_4_reference_quartet',
    why: '5/4 reference quartet（weight=0 仅显式可达——拒绝例, P2J-c）' },
  { name: 'pop_mod', styleHint: 'pop', seed: 73, allowModulation: true, why: 'allowModulation 开（modulation 域探针例）' },
  { name: 'pop_cand6', styleHint: 'pop', seed: 4, why: '候选 #6 胜出例（C 双变体 1000 组扫描定位——候选拓扑判别, 5/6 候选可分）' },
  { name: 'rnb_weight', styleHint: 'rnb', seed: 13, why: '权重判别例（0.75/0.25 vs 0.7/0.3 择优翻转——C 双变体扫描定位）' },
  { name: 'pop_weight', styleHint: 'pop', seed: 24, why: '权重判别例（pop 侧同上）' },
  { name: 'jazz_cand6', styleHint: 'jazz', seed: 12, why: '候选 #6 胜出例（jazz 侧同上）' },
  { name: 'jazz_mod', styleHint: 'jazz', seed: 88, allowModulation: true, why: 'allowModulation 开（jazz 侧）' },
];

// G4 语料 12 例（参数机器读取, 不手抄）
const G4 = JSON.parse(
  readFileSync(join(HERE, '..', '..', 'core', 'tests', 'fixtures', 'corpus_set_v5.json'), 'utf8'),
) as { cases: Array<{ id: string; seed: number; styleHint: string; mood: string; targetDuration: number }> };
const CORPUS: readonly Fx[] = G4.cases.map((c) => ({
  name: `g4_${c.id.replace(/[^a-zA-Z0-9]/g, '_')}`,
  styleHint: c.styleHint, seed: c.seed, mood: c.mood, targetDuration: c.targetDuration,
  why: `G4 固定语料 ${c.id}`,
}));

function run(f: Fx) {
  const band = buildBandSpec({ seed: f.seed, styleHint: f.styleHint,
    allowModulation: f.allowModulation } as never);
  const ctx = createRandomContext(f.seed);
  const arrangement = buildArrangementPlan(band, {
    rng: ctx, mood: f.mood, targetDuration: f.targetDuration,
    jazzArchetypeId: f.jazzArchetypeId as never,
  });
  // ★ 生产序 seam（GenerationController/buildMotifSongBundle 同式, P2-5d 已在 C 落）：
  //   request.mode 未显式给 + archetype 带 tonalityMode ⇒ withBandMode 后置一致化, 再进 harmony。
  //   初版漏此 seam, 被 5/4 minor-only throw 当场暴露（jazz 例 band.mode 可能因此变）。
  const authoredMode = arrangement.resolvedArchetype?.tonalityMode;
  const bandFinal = authoredMode ? withBandMode(band, authoredMode) : band;
  const isFiveFour = arrangement.sections.some((sec) =>
    arrangement.resolvedArchetype?.sectionPolicyById[sec.id]?.harmonyPolicyId
      === 'harmony.jazz-five-four-form-grammar.v1');   /* 判据=逐段 policy（compiler :40 同式, 设计 §5） */
  const plan = buildHarmonicPlanFromArrangement(bandFinal, arrangement, ctx);
  return { band: bandFinal, arrangement, isFiveFour, plan };
}

function projRoman(r: { degree: number; accidental: string; quality: string;
  secondaryTarget?: { degree: number; accidental: string; quality: string } }) {
  return {
    degree: r.degree, accidental: r.accidental, quality: r.quality,
    secondaryTarget: r.secondaryTarget
      ? { degree: r.secondaryTarget.degree, accidental: r.secondaryTarget.accidental, quality: r.secondaryTarget.quality }
      : null,
  };
}

function proj(plan: HarmonicPlan) {
  const spans = plan.chordTimeline.map((s) => ({
    id: s.id, sectionId: s.sectionId,
    startBeat: s.startBeat, startBeatBits: bits64(s.startBeat),
    durationBeats: s.durationBeats, durationBeatsBits: bits64(s.durationBeats),
    rootPc: s.rootPc, chordType: s.chordType, quality: s.quality,
    roman: projRoman(s.roman as never),
    func: plan.chordFunctionTimeline[plan.chordTimeline.indexOf(s)] ?? null,
    borrowedSource: s.borrowedSource ?? null,
    borrowedFrom: s.borrowedFrom ?? null, effectiveFunc: s.effectiveFunc ?? null,
    analysisKeyPc: s.analysisKeyPc ?? null, localRoman: s.localRoman ?? null,
    forcedScale: s.forcedScale ?? null,
    widePianoVoicing: s.widePianoVoicing ?? null,
    localTonalCenterPc: s.localTonalCenterPc ?? null,
    bassRole: s.bassRole ?? null, bassPedalPc: s.bassPedalPc ?? null, bassPc: s.bassPc ?? null,
    tonicizationPlacement: s.tonicizationPlacement ?? null,
    mustResolve: s.mustResolve ?? false,
    chordScale: plan.chordScaleMap[s.id] ?? null,
    tension: plan.tensionMap[s.id] ?? null,
    stableTones: plan.stableToneMap[s.id] ?? null,
    colorTones: plan.colorToneMap[s.id] ?? null,
    avoidNotes: plan.avoidNoteMap[s.id] ?? null,
    borrowedChord: plan.borrowedChordMap[s.id] ?? null,
  }));
  return {
    nChords: plan.chordTimeline.length,
    romanProgression: plan.romanProgression.map((r) => projRoman(r as never)),
    spans,
    modulationMap: plan.modulationMap,
  };
}

describe('export-afe-harmony', () => {
  it('writes harmony v5 golden', () => {
    const exporterSha = createHash('sha256')
      .update(readFileSync(join(HERE, 'export-afe-harmony.export.test.ts'))).digest('hex');
    const all = [...FIXTURES, ...CORPUS];
    const cases = all.map((f) => {
      const { band, arrangement, isFiveFour, plan } = run(f);
      const input = {
        styleHint: f.styleHint, seed: f.seed, mood: f.mood ?? null,
        allowModulation: f.allowModulation ?? null, jazzArchetypeId: f.jazzArchetypeId ?? null,
        targetDuration: f.targetDuration ?? null,
        targetDurationBits: f.targetDuration === undefined ? '0x0' : bits64(f.targetDuration),
        bandStyle: band.style, bandMode: band.mode, bandKey: band.key,
        fiveFourPolicyHit: false as boolean,  /* 由下方 isFiveFour 回填 */
      };
      input.fiveFourPolicyHit = isFiveFour;
      if (isFiveFour) {
        expect(plan.chordTimeline.length, `${f.name}: 5/4 例 TS 侧仍须正常产 plan`).toBeGreaterThan(0);
        return { name: f.name, why: f.why, input, expectFiveFourRejected: true, expected: null };
      }
      const expected = proj(plan);
      expect(expected.nChords, `${f.name}: 非空 plan`).toBeGreaterThan(0);
      return { name: f.name, why: f.why, input, expected };
    });

    // motif override 旁路：经真实产品入口 buildMotifSongBundle（generateSongFromMotif.ts:196-197,
    // 无 override.key 时 `override.harmony ?? build…` 引用直通）, 断言注入 plan 被原样采用。
    const sentinel: HarmonicPlan = run({ name: 's', styleHint: 'pop', seed: 999, why: '' }).plan;
    const motifOut = buildMotifSongBundle({ seed: 12345, styleHint: 'pop' } as never,
      { harmony: sentinel });
    expect(motifOut.bundle.harmonic, 'override 路径：产品入口必须采用注入的 harmony（builder 旁路）')
      .toBe(sentinel);

    // 覆盖面机器统计（先枚举后冻结, P2-11 步0 教训）
    const planCases = cases.filter((c) => c.expected !== null) as Array<typeof cases[number] & { expected: NonNullable<typeof cases[number]['expected']> }>;
    const cover = {
      styles: new Set(cases.map((c) => c.input.bandStyle)),
      modes: new Set(planCases.map((c) => c.input.bandMode)),
      fiveFour: cases.filter((c) => (c as { expectFiveFourRejected?: boolean }).expectFiveFourRejected).length,
      withSecondary: planCases.filter((c) => c.expected.romanProgression.some((r) => r.secondaryTarget)).length,
      withBorrow: planCases.filter((c) => c.expected.spans.some((s) => s.borrowedSource !== null || s.borrowedChord !== null)).length,
      withBassPc: planCases.filter((c) => c.expected.spans.some((s) => s.bassPc !== null)).length,
      withModulation: planCases.filter((c) => Object.keys(c.expected.modulationMap).length > 0).length,
      modal: planCases.filter((c) => c.input.bandStyle === 'modal').length,
      tonicized: planCases.filter((c) => c.expected.spans.some((s) => s.tonicizationPlacement !== null)).length,
    };
    expect(cover.styles.size, '≥6 band style').toBeGreaterThanOrEqual(6);
    expect(cover.modes.size, 'major+minor 双至').toBe(2);
    expect(cover.withSecondary, '≥1 例含 secondaryTarget').toBeGreaterThanOrEqual(1);
    expect(cover.withBorrow, '≥3 例含借和弦').toBeGreaterThanOrEqual(3);
    expect(cover.modal, '≥2 modal 旁路').toBeGreaterThanOrEqual(2);
    expect(cover.tonicized, '≥2 例含离调').toBeGreaterThanOrEqual(2);
    expect(cover.fiveFour, '5/4 拒绝例恰 2（双 archetype）').toBe(2);
    // bassPc：当前 pin **零生产槽**（grep progressions.ts 无 slot 产 bassOffset, 仅接口字段+realizer
    // 逻辑）⇒ 域不可达, 记账不伪造靶（withBassPc 预期 0; 一旦真源出现即计数变动提示补例）。

    const out = {
      meta: {
        layer: 'harmony v5 golden (buildHarmonicPlanFromArrangement raw)',
        schemaVersion: SCHEMA_VERSION,
        generator: 'scripts/export-afe-harmony.export.test.ts',
        exporterSha,
        note: 'P2-6 步e 一次性转录（入仓即本仓产权, 不建重导门）。输入=（seed,styleHint,mood,'
          + 'targetDuration）；C 侧用**自家 v5 链**（afe_band+afe_plan_arrangement, 均已逐位锁）重建'
          + '上游, 单 ctx 贯穿同生产序。5/4 policy 例只承载输入+期望拒绝（P2J-c）。double 附 bits64。'
          + 'motif override 旁路已在本 exporter 内经真实产品入口断言（不入 golden case 面）。',
        coverage: { cases: cases.length, ...cover, styles: [...cover.styles], modesN: cover.modes.size },
      },
      cases,
    };
    assertJsonSafe(out, '$');
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  });
});
