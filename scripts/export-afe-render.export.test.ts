// ============================================================
// export-afe-render —— P2-8a 步③ G5-③ v5 叶级 I/O golden 导出
// ------------------------------------------------------------
// 捕获法（设计 §4 G5-③ 冻结）：vi.mock 包装五件（buildTextureSchedule / renderPad /
//   renderBass / applyBassPatternSchedule / renderAccompaniment），跑生产 attempt-1
//   渲染（buildSongBundle → renderSongFull, retry=undefined 分支逐字节 =
//   GenerationController.generateSongFromBundle 首跑），记录【实际入参 + 返回值】。
//   ⇒ 输入闭包不靠 exporter 复刻 prologue（无复刻漂移面），逐 case 序列化
//   叶消费投影 + raw-stage 三轨 + texture_schedule 中间面。
// 语料（设计 §4 冻结）：L1 8 seed × 非 ACG 5 style + 定向补例
//   （pattern-schedule 命中 / pedal-anchor 两分支 / foundationOwner=comp），
//   例数与覆盖桶【机器断言】在文末（不手写计数）。ACG 不入（acg_score=P2-11）。
// 值序列化：全部 double 走 bits64（IEEE-754 LE 位型），enum 一律 TS 原始字符串
//   ——C 枚举映射权在 core/data/codegen/gen_render_golden.py（独立解析路径）。
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSongBundle } from '../src/core/generation/newEngine/generation/GenerationController';
import { renderSongFull } from '../src/core/generation/newEngine/render/renderCoordinator';
import { deriveMusicIntentPlan } from '../src/core/generation/newEngine/arranger/deriveMusicIntentPlan';
import type { GenerationRequest } from '../src/core/generation/newEngine/band/bandEngine';
import type { HarmonicPlan, ChordSpan } from '../src/core/generation/newEngine/harmony/HarmonicPlan';
import type { TrackIR, NoteIR } from '../src/core/generation/newEngine/ir/MusicalIR';
import {
  GROOVE_BASS_PATTERN_IDS,
  grooveBassPattern,
} from '../src/core/generation/newEngine/knowledge/grooveBassPatterns';

// ---- 捕获槽（vi.hoisted：mock 工厂闭包在 import 提升前可见） ----
const CAP = vi.hoisted(() => ({
  sched: [] as Array<{ args: any; ret: any }>,
  pad: [] as Array<{ args: any[]; ret: any }>,
  bass: [] as Array<{ args: any[]; ret: any }>,
  apply: [] as Array<{ args: any[]; ret: any }>,
  accomp: [] as Array<{ args: any[]; ret: any }>,
}));

vi.mock('../src/core/generation/newEngine/render/textureSchedule', async (orig) => {
  const m = (await orig()) as any;
  return {
    ...m,
    buildTextureSchedule: (args: any) => {
      const ret = m.buildTextureSchedule(args);
      CAP.sched.push({ args, ret });
      return ret;
    },
  };
});
vi.mock('../src/core/generation/newEngine/render/padRenderer', async (orig) => {
  const m = (await orig()) as any;
  return {
    ...m,
    renderPad: (...a: any[]) => {
      const ret = m.renderPad(...a);
      CAP.pad.push({ args: a, ret });
      return ret;
    },
  };
});
vi.mock('../src/core/generation/newEngine/render/bassRenderer', async (orig) => {
  const m = (await orig()) as any;
  return {
    ...m,
    renderBass: (...a: any[]) => {
      const ret = m.renderBass(...a);
      CAP.bass.push({ args: a, ret });
      return ret;
    },
  };
});
vi.mock('../src/core/generation/newEngine/render/bassPatternSchedule', async (orig) => {
  const m = (await orig()) as any;
  return {
    ...m,
    applyBassPatternSchedule: (...a: any[]) => {
      const ret = m.applyBassPatternSchedule(...a);
      CAP.apply.push({ args: a, ret });
      return ret;
    },
  };
});
vi.mock('../src/core/generation/newEngine/render/accompanimentRenderer', async (orig) => {
  const m = (await orig()) as any;
  return {
    ...m,
    renderAccompaniment: (...a: any[]) => {
      const ret = m.renderAccompaniment(...a);
      CAP.accomp.push({ args: a, ret });
      return ret;
    },
  };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'core', 'tests', 'golden', 'afe_render_v5_io.json');
const SCHEMA_VERSION = 'afe_render_v5_io_v1';

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

// ---- L1 语料（P2-3 band 同池） + 非 ACG style ----
const SEEDS = [12345, 7, 42, 1001, 20260612, 31415926, 271828182, 999999937];
const STYLES = ['pop', 'jazz', 'lofi', 'rnb', 'modal'];

const projNotes = (notes: readonly NoteIR[]) =>
  notes.map((n) => ({
    p: n.pitch as number,
    s: n.startTick as number,
    d: n.durationTicks as number,
    v: n.velocity as number,
  }));

const projContract = (c: any) =>
  c
    ? {
        pref: (c.preferredTextureCases ?? []) as string[],
        allow: (c.allowedTextureCases ?? []) as string[],
        forbid: (c.forbiddenTextureCases ?? []) as string[],
        density: (c.density ?? null) as string | null,
        grid: (c.grid ?? null) as string | null,
        bassPattern: (c.bassPattern ?? null) as string | null,
      }
    : null;

interface CaseRec { [k: string]: unknown }

function runCase(seed: number, styleHint: string): CaseRec {
  for (const k of Object.keys(CAP) as Array<keyof typeof CAP>) CAP[k].splice(0);
  const req = { seed, styleHint, mood: 'build', targetDuration: 90 } satisfies GenerationRequest;
  const bundle = buildSongBundle(req);
  expect(bundle.band.style.toLowerCase(), `${seed}/${styleHint}: 语料排除 ACG`).not.toBe('acg');
  expect(bundle.acgPianoScorePlan, 'ACG score 非 ACG 恒 undefined').toBeUndefined();
  expect(bundle.jazzFiveFourScorePlan, '5/4 score 自然域零命中（P2J-c）').toBeUndefined();
  expect(bundle.timebase.ppq as number, 'ppq 合同').toBe(480);
  const intentPlan = deriveMusicIntentPlan(bundle.band.style, bundle.arrangement);
  renderSongFull(
    bundle.band, bundle.arrangement, bundle.harmonic, bundle.instrumentation,
    bundle.timebase, bundle.seedRng, undefined, undefined, intentPlan, undefined,
    bundle.acgPianoScorePlan, bundle.jazzFiveFourScorePlan,
  );

  // ---- 捕获形态合同（attempt-1 单渲染） ----
  expect(CAP.sched.length, 'buildTextureSchedule 恰 1 次').toBe(1);
  expect(CAP.pad.length, 'renderPad ≤1').toBeLessThanOrEqual(1);
  // renderBass 在 lineup.bass 时恰 1 次；applyBassPatternSchedule 非 ACG 跟随 bass
  expect(CAP.bass.length, 'renderBass ≤1').toBeLessThanOrEqual(1);
  expect(CAP.apply.length, 'apply 跟随 bass（非 ACG）').toBe(CAP.bass.length);
  expect(CAP.accomp.length, 'renderAccompaniment ≤1').toBeLessThanOrEqual(1);

  const plan: HarmonicPlan = bundle.harmonic;
  const sections = bundle.arrangement.sections as ReadonlyArray<{ id: string; role?: string; bars: number }>;
  const secIdxById = new Map<string, number>(sections.map((s, i) => [s.id, i]));
  const spanIdxById = new Map<string, number>(plan.chordTimeline.map((s, i) => [s.id, i]));
  const secIdx = (sid: string): number => {
    const i = secIdxById.get(sid);
    if (i === undefined) throw new Error(`未知 sectionId ${sid}`);
    return i;
  };

  // ---- schedule 捕获投影 ----
  const sc = CAP.sched[0];
  const sa = sc.args;
  expect(sa.plan, 'schedule 消费同一 plan').toBe(plan);
  const sectionRoleById = sa.sectionRoleById as Record<string, string>;
  const activeSectionIds = [...(sa.activeSectionIds as Set<string>)].map(secIdx).sort((a, b) => a - b);
  const richBySec = sections.map((s) => (sa.richTextureBySection?.[s.id] ?? null) as string | null);
  const richSwitchBySec = sections.map((s) => {
    const sw = sa.richTextureSwitchBySection?.[s.id];
    return sw ? { atFraction: bits64(sw.atFraction), toTexture: sw.toTexture as string } : null;
  });
  const contractBySec = sections.map((s) => projContract(sa.grooveContractBySection?.[s.id]));
  const schedule = plan.chordTimeline.map((s) => (sc.ret[s.id] ?? null) as string | null);
  expect(sa.acgBarFamilyBySpan, '非 ACG 无 family intent').toBeUndefined();

  // ---- chords（叶消费投影；enum 留 TS 字符串, gen 映射） ----
  const chords = plan.chordTimeline.map((s: ChordSpan, i: number) => ({
    sec: secIdx(s.sectionId),
    sb: bits64(s.startBeat as number),
    db: bits64(s.durationBeats as number),
    root: s.rootPc as number,
    quality: s.quality as string,
    chordType: (s.chordType ?? null) as string | null,
    func: (plan.chordFunctionTimeline[i] ?? null) as string | null,
    effectiveFunc: (s.effectiveFunc ?? null) as string | null,
    bassRole: (s.bassRole ?? null) as string | null,
    bassPedalPc: (s.bassPedalPc ?? null) as number | null,
    bassPc: (s.bassPc ?? null) as number | null,
    localTonalCenterPc: (s.localTonalCenterPc ?? null) as number | null,
    stable: (plan.stableToneMap[s.id] ?? []) as number[],
    color: (plan.colorToneMap[s.id] ?? []) as number[],
    avoid: (plan.avoidNoteMap[s.id] ?? []) as number[],
    scale: (plan.chordScaleMap[s.id] ?? []) as number[],
  }));

  // ---- pad ----
  let pad: CaseRec | null = null;
  let decisions: CaseRec[] | null = null;
  if (CAP.pad.length === 1) {
    const [pplan, , opts] = CAP.pad[0].args as [HarmonicPlan, unknown, any];
    expect(pplan, 'pad 消费同一 plan').toBe(plan);
    decisions = sections.map((s) => {
      const d = opts.decisionBySection[s.id];
      return d
        ? {
            padMode: d.padMode as string,
            interactionMode: d.interactionMode as string,
            padMaxVoices: d.padMaxVoices as number,
            compDurationScale: bits64((d.compDurationScale ?? 1) as number),
            padOmitRoot: !!d.padOmitRoot,
            padOmitFifth: !!d.padOmitFifth,
            avoidExactPitchOverlap: !!d.avoidExactPitchOverlap,
          }
        : null;
    });
    pad = {
      padDensity: bits64(opts.padDensity as number),
      leadReservedLow: (opts.leadReservedLow ?? null) as number | null,
      padRegister: opts.padRegister
        ? { lo: opts.padRegister.lowMidi as number, hi: opts.padRegister.highMidi as number }
        : null,
      pedalAnchor: !!opts.pedalAnchor,
      tonicPc: (opts.tonicPc ?? null) as number | null,
      notes: projNotes((CAP.pad[0].ret as TrackIR).notes),
    };
  }

  // ---- bass（raw + schedule 后） ----
  let bass: CaseRec | null = null;
  if (CAP.bass.length === 1) {
    const a = CAP.bass[0].args as any[];
    expect(a[0], 'bass 消费同一 plan').toBe(plan);
    expect(a[3], 'bass 消费同一 schedule').toBe(CAP.sched[0].ret);
    expect(a[4], '非 ACG 无 pianoScorePlan').toBeUndefined();
    const patternIdBySec = sections.map(
      (s) => ((a[5] as Record<string, string> | undefined)?.[s.id] ?? null) as string | null,
    );
    const reg = a[6] as { lowMidi: number; highMidi: number } | undefined;
    const ap = CAP.apply[0].args as any[];
    expect(ap[0], 'apply 吃 rawBass').toBe(CAP.bass[0].ret);
    expect(ap[4], 'apply beatsPerBar 与 meter 一致').toBe(
      (bundle.arrangement.meter.numerator * 4) / bundle.arrangement.meter.denominator,
    );
    expect(ap[5], 'apply ppq').toBe(480);
    bass = {
      patternIdBySec,
      registerRange: reg ? { lo: reg.lowMidi as number, hi: reg.highMidi as number } : null,
      raw: projNotes((CAP.bass[0].ret as TrackIR).notes),
      intentFamilies: (ap[3].sections as any[]).map(
        (x) => (x.bassPatternSchedule?.slots?.[0]?.family ?? null) as string | null,
      ),
      patternOwnedSecIdx: [...(ap[6] as Set<number>)].sort((x, y) => x - y),
      scheduled: projNotes((CAP.apply[0].ret as TrackIR).notes),
    };
  }

  // ---- accomp ----
  let accomp: CaseRec | null = null;
  if (CAP.accomp.length === 1) {
    const [aplan, , ctx] = CAP.accomp[0].args as [HarmonicPlan, unknown, any];
    expect(aplan, 'accomp 消费同一 plan').toBe(plan);
    expect(ctx.textureSchedule, 'accomp 消费同一 schedule').toBe(CAP.sched[0].ret);
    expect(ctx.pianoScorePlan, '非 ACG 无 pianoScorePlan').toBeUndefined();
    expect(ctx.voicingSaferSpans, 'attempt-1 无 saferSpans').toBeUndefined();
    const grooveComp = sections.map((s) => {
      const bySec = Object.values(
        (ctx.grooveScorePlan?.bySection ?? {}) as Record<string, any>,
      ).find((x) => x.sectionId === s.id);
      const rhythm = bySec?.roleRhythmByRole?.comp;
      return rhythm
        ? {
            bars: (bySec.bars as Array<{ absoluteBar: number }>).map((b) => b.absoluteBar),
            cells: (rhythm.cells as any[]).map((cell) => ({
              phaseBeats: bits64(cell.phaseBeats as number),
              durationBeats: bits64(cell.durationBeats as number),
              velocity: bits64(cell.velocity as number),
              voiceAction: (cell.voiceAction ?? null) as string | null,
            })),
          }
        : null;
    });
    const padOcc = plan.chordTimeline.map(
      (s) => ((ctx.padOccupiedPitchesBySpan?.[s.id] ?? []) as number[]),
    );
    accomp = {
      anchorBeats: [...((ctx.anchorBeats ?? new Set()) as Set<number>)]
        .sort((x, y) => x - y)
        .map(bits64),
      activeSectionIds: [...((ctx.activeSectionIds ?? new Set()) as Set<string>)]
        .map(secIdx)
        .sort((x, y) => x - y),
      foundationRoleBySec: sections.map(
        (s) => ((ctx.foundationRoleBySection?.[s.id] ?? null) as string | null),
      ),
      compProgram: (ctx.compProgram ?? null) as number | null,
      compRegister: ctx.compRegister
        ? { lo: ctx.compRegister.lowMidi as number, hi: ctx.compRegister.highMidi as number }
        : null,
      melodyFloorMidi: (ctx.melodyFloorMidi ?? null) as number | null,
      needsDownbeat: sections.map((s) => !!ctx.needsDownbeatCompAnchorBySection?.[s.id]),
      grooveComp,
      padOccupiedBySpan: padOcc,
      notes: projNotes(((CAP.accomp[0].ret as TrackIR[])[0] ?? { notes: [] }).notes),
      nTracks: (CAP.accomp[0].ret as TrackIR[]).length,
    };
    expect(accomp.nTracks, 'accomp 恒单 comp 轨').toBe(1);
  }

  // padCompDecision 双源一致（pad opts 与 accomp ctx 同一 map）
  if (CAP.pad.length === 1 && CAP.accomp.length === 1) {
    expect((CAP.accomp[0].args as any[])[2].padCompDecisionBySection, 'decision 双源同一对象').toBe(
      (CAP.pad[0].args as any[])[2].decisionBySection,
    );
  }

  return {
    seed,
    styleHint,
    style: bundle.band.style as string,
    meter: [bundle.arrangement.meter.numerator, bundle.arrangement.meter.denominator],
    tempoBpm: bundle.arrangement.tempoBpm as number,
    key: bundle.band.key as number,
    lineup: (['bass', 'comp', 'pad', 'drum', 'lead'] as const).map((r) =>
      bundle.band.instrumentPool.includes(r) ? 1 : 0,
    ),
    sections: sections.map((s) => ({
      role: (sectionRoleById[s.id] ?? null) as string | null,
      bars: s.bars as number,
    })),
    chords,
    schedule,
    activeSectionIds,
    richBySec,
    richSwitchBySec,
    contractSong: projContract(sa.grooveContract),
    contractBySec,
    decisions,
    pad,
    bass,
    accomp,
  };
}

describe('export-afe-render（P2-8a 步③ G5-③）', () => {
  it('L1 8seed × 非 ACG 5style + 定向补例 → v5 叶级 I/O golden', () => {
    const cases: CaseRec[] = [];
    for (const styleHint of STYLES) for (const seed of SEEDS) cases.push(runCase(seed, styleHint));

    // ---- 覆盖桶（机器断言, 不手写计数）；不足 → 定向补例扫描（确定序） ----
    const has = {
      patternSched: (c: CaseRec) =>
        !!c.bass && (c.bass as any).patternIdBySec.some((x: string | null) => x !== null),
      pedalTrue: (c: CaseRec) => !!c.pad && (c.pad as any).pedalAnchor === true,
      pedalFalse: (c: CaseRec) => !!c.pad && (c.pad as any).pedalAnchor === false,
      foundComp: (c: CaseRec) =>
        !!c.accomp && (c.accomp as any).foundationRoleBySec.some((x: string | null) => x === 'comp'),
    };
    const buckets: Array<[string, (c: CaseRec) => boolean]> = [
      ['patternSched', has.patternSched],
      ['pedalTrue', has.pedalTrue],
      ['pedalFalse', has.pedalFalse],
    ];
    const supplements: Array<{ seed: number; styleHint: string; bucket: string }> = [];
    for (const [name, pred] of buckets) {
      if (cases.some(pred)) continue;
      let filled = false;
      outer: for (let seed = 1; seed <= 400; seed++) {
        for (const styleHint of STYLES) {
          if (SEEDS.includes(seed)) continue;
          const c = runCase(seed, styleHint);
          if (pred(c)) {
            cases.push(c);
            supplements.push({ seed, styleHint, bucket: name });
            filled = true;
            break outer;
          }
        }
      }
      expect(filled, `覆盖桶 ${name} 补例扫描（seed 1..400 × 5 style）失败`).toBe(true);
    }
    const coverage = Object.fromEntries(
      buckets.map(([name, pred]) => [name, cases.filter(pred).length]),
    ) as Record<string, number>;
    for (const [name, n] of Object.entries(coverage))
      expect(n, `覆盖桶 ${name} 至少 1 例`).toBeGreaterThanOrEqual(1);

    // ---- foundationOwner='comp' 域记账（设计 §2 补例意图 → 实测为**域的局限**）：
    //   该 owner 仅存在于 JAZZ_5_4 archetype 的 sectionPolicy（jazzArchetypePlanner.ts:89），
    //   自然域（无显式 jazzArchetypeId）零可达（P2-5a 320 组机器证据同源）；显式 5/4 = P2J-c 域。
    //   机器证据：自然域 seed 1..400 × 5 style 全扫零命中（fail-closed：若某日命中 → 此断言红,
    //   须将命中例转入语料并撤销本记账）。accomp 的 foundationRoleBySection 参数照 §2 冻结实装,
    //   本语料内其 'comp' 分支覆盖 0（激活权在 P2J-c）。 ----
    let foundCompScanHits = 0;
    let foundCompScanned = 0;
    for (let seed = 1; seed <= 400; seed++) {
      for (const styleHint of STYLES) {
        if (SEEDS.includes(seed)) continue;
        foundCompScanned++;
        if (has.foundComp(runCase(seed, styleHint))) foundCompScanHits++;
      }
    }
    expect(cases.some(has.foundComp), '基线语料 foundComp 应为零（域局限记账前提）').toBe(false);
    expect(foundCompScanHits, `自然域扫描 ${foundCompScanned} 组 foundationOwner=comp 命中数`).toBe(0);
    coverage.foundCompNaturalDomainScanned = foundCompScanned;
    coverage.foundCompNaturalDomainHits = foundCompScanHits;

    // ---- grooveBassPatterns KB 快照（已解析值; C KB codegen 数据源） ----
    const kb = GROOVE_BASS_PATTERN_IDS.map((id) => {
      const p = grooveBassPattern(id)!;
      return {
        id: p.id,
        beatsPerBar: p.beatsPerBar,
        family: p.family as string,
        registerPolicy: (p.registerPolicy ?? null) as string | null,
        hits: p.hits.map((h) => ({
          beat: bits64(h.beat),
          durationBeats: bits64(h.durationBeats),
          velocity: bits64(h.velocity),
          voice: h.voice as string,
        })),
      };
    });

    const out = {
      schemaVersion: SCHEMA_VERSION,
      provenance: {
        source: 'auraflow_music_game_console_simulator attempt-1 renderSongFull 捕获（vi.mock 五件包装）',
        generator: 'scripts/export-afe-render.export.test.ts',
      },
      grooveBassPatterns: kb,
      coverage,
      supplements,
      caseCount: cases.length,
      cases,
    };
    assertJsonSafe(out, '$');
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  }, 900_000);
});
