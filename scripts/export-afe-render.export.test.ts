// ============================================================
// export-afe-render —— P2-8a 步③ G5-③ v5 叶级 I/O golden 导出
//                      + P2-9 步10a ST14 / ST16 / denseMelodySpanRanges 捕点
// ------------------------------------------------------------
// 捕获法（设计 §4 G5-③ 冻结）：vi.mock 包装五件（buildTextureSchedule / renderPad /
//   renderBass / applyBassPatternSchedule / renderAccompaniment），跑生产 attempt-1
//   渲染（buildSongBundle → renderSongFull, retry=undefined 分支逐字节 =
//   GenerationController.generateSongFromBundle 首跑），记录【实际入参 + 返回值】。
//   ⇒ 输入闭包不靠 exporter 复刻 prologue（无复刻漂移面），逐 case 序列化
//   叶消费投影 + raw-stage 三轨 + texture_schedule 中间面。
//
// ★ P2-9 步10a 增补（G0 表 docs/specs/mg/G0_harvest_batch_B.md B1/B2/B2′）——
//   ST14 `fitLeadTrackToInstrumentSections` 与 ST16 `applyMgLofiDenseMelodyComping`
//   都是 renderCoordinator/mgPostMixShaper 的**模块内**函数，捕获法如下（不改 src/）：
//   ① ST14 入 = `renderMgMelody` 返回的 lead 轨（vi.mock mgLeadRenderer, 深拷贝）。
//   ② ST14 出 = 首个下游叶捕点看到的 tracks 里的 lead 轨——lofi 走
//      `applyMgLofiDenseMelodyComping`(:980, ST16 恒不碰 lead)、非 lofi 走
//      `fillLeadBarGaps`(:986)。两条路都在 ST17 改写 lead 之前。
//   ③ ST14 的 per-note `programAtTick` = vi.mock `fitMidiToProgramRange` 的调用日志；
//      日志在 renderMgMelody 返回处清零 ⇒ 窗口内首个消费者恒是 ST14。
//      窗口纯净性【机器断言】: 日志条数 == lead 音符数 且 role 恒 'lead'（见 runCase）。
//   ④ ★ 判别力补例（st14Probe）：本语料 40/40 例的 `programByRoleSection.lead`
//      **段间恒定**（机器实测），且 mgLeadRenderer 已用同一 program 折过一次 ⇒
//      ST14 在自然语料上是**逐音恒等**、段窗口查找**零观测面**。故对每例**再跑一次
//      生产渲染**，只把 `instrumentation.programByRoleSection.lead` 覆盖成段间互异的
//      程序号（ST14_PROBE_PROGRAMS 轮转），期望值仍出自 pin 死的 sim 生产路径。
//      leadIn 与基线逐位相同由断言背书（该字段只在 ST14/ST32/ST33A 被读，全在站13 之后）。
//   ⑤ denseMelodySpanRanges(:1507) 入 = gatedTracks（站20 gate 之后, 与 ST16 的输入
//      不同源）、出 = tick 区间表；两者均深拷贝。
//
// ★ P2-9 步10b 增补（G0 表 B3/B5）——ST17 / ST19 两件都是 export 函数, 直接 vi.mock 包装：
//   ⑥ ST17 `fillLeadBarGaps`(:986) 入/出只取 **lead 轨**（其余轨同引用由 `sameRefs`
//      机器断言背书）+ `planLeadGapFills` 记录面（chordClamped = v5 增量的观测量）；
//      「记录重放 == 出轨」在 runCase 里逐音断言（两条独立路互证）。
//   ⑦ ST19 `applyRepeatGroupReplay`(:995) 入/出取**全部轨**（含 drum —— sim 今天就渲染鼓,
//      故 drum 保护窗在本语料有真实执行面, 不需合成输入）+ `planRepeatGroupReplays` 计划面
//      + 逐计划的 `planDrumReplayProtection(...).target` 区间表。
//      同模块的 `applyMotifBindingReplay`(ST18) 归步10c, 此处只透传不捕获。
//   ⑧ 新增 case 字段：`sections[].id/.repeatGroup`（ST19 分组键）与 `boundaries`
//      （grooveScorePlan 投影, 串 id 在导出侧一次性归约成段号；单曲内 id 互异有断言）。
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
const CAP = vi.hoisted(() => {
  // ★ 捕获点立即深拷贝 ret（notes 级）：coordinator 后段（swing/humanize/排序）会【就地】
  //   改叶返回的同一数组——按引用捕获会在序列化时读到「站 31+ 之后」的序/值（首版实证：
  //   comp 的 needsDownbeat 锚被稳定排序前移；pad/bass 因单调 tick 序恒等而假绿）。
  const cloneTrack = (t: any) => ({ role: t.role, notes: t.notes.map((n: any) => ({ ...n })) });
  const cloneTracks = (ts: any[]) => ts.map(cloneTrack);
  return {
    sched: [] as Array<{ args: any; ret: any }>,
    pad: [] as Array<{ args: any[]; ret: any }>,
    bass: [] as Array<{ args: any[]; ret: any }>,
    apply: [] as Array<{ args: any[]; ret: any }>,
    accomp: [] as Array<{ args: any[]; ret: any }>,
    // ---- P2-9 步10a ----
    fit: [] as Array<{ value: number; role: string; program: number; ret: number }>,
    lead: [] as Array<{ snap: any }>,          // ST14 入（renderMgMelody 返回, 深拷贝）
    st14: [] as Array<{ from: string; tracks: any[]; fit: any[] }>, // ST14 出（首个下游捕点）
    postmix: [] as Array<{ inTracks: any[]; outTracks: any[]; identity: boolean; sameRefs: boolean }>,
    ranges: [] as Array<{ inTracks: any[]; out: Array<{ lo: number; hi: number }> }>,
    gap: [] as Array<1>,                       // fillLeadBarGaps 调用计数（ST14 出的另一路捕点）
    // ---- P2-9 步10b ----
    gapfill: [] as Array<{
      inLead: any; outLead: any; sameRefs: boolean; leadSameRef: boolean;
      beatsPerBar: number; fills: any[];
    }>,
    replay: [] as Array<{
      inTracks: any[]; outTracks: any[]; sameRefs: boolean[]; plans: any[]; protect: any[][];
    }>,
    raw: {} as Record<string, any>,   // 未包装的真源模块引用（判别力补例直调生产函数用）
    cloneTrack,
    cloneTracks,
  };
});

vi.mock('../src/core/generation/newEngine/render/textureSchedule', async (orig) => {
  const m = (await orig()) as any;
  return {
    ...m,
    buildTextureSchedule: (args: any) => {
      const ret = m.buildTextureSchedule(args);
      CAP.sched.push({ args, ret, snap: { ...ret } } as any);
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
      CAP.pad.push({ args: a, ret, snap: CAP.cloneTrack(ret) } as any);
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
      CAP.bass.push({ args: a, ret, snap: CAP.cloneTrack(ret) } as any);
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
      CAP.apply.push({ args: a, ret, snap: CAP.cloneTrack(ret) } as any);
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
      CAP.accomp.push({ args: a, ret, snap: (ret as any[]).map(CAP.cloneTrack) } as any);
      return ret;
    },
  };
});

// ---- P2-9 步10a：ST14 / ST16 / denseMelodySpanRanges 捕点 ----
vi.mock('../src/core/generation/newEngine/knowledge/instruments', async (orig) => {
  const m = (await orig()) as any;
  return {
    ...m,
    fitMidiToProgramRange: (value: number, role: string, program: number) => {
      const ret = m.fitMidiToProgramRange(value, role, program);
      CAP.fit.push({ value, role, program, ret });
      return ret;
    },
  };
});
vi.mock('../src/core/generation/newEngine/render/mgLeadRenderer', async (orig) => {
  const m = (await orig()) as any;
  return {
    ...m,
    renderMgMelody: (...a: any[]) => {
      const ret = m.renderMgMelody(...a);
      CAP.lead.push({ snap: CAP.cloneTrack(ret) });
      CAP.fit.splice(0); // ★ 站13 结束 ⇒ 窗口清零；ST14(:961) 是窗口内首个 fit 消费者
      return ret;
    },
  };
});
const snapSt14 = (from: string, tracks: any[]) => {
  if (CAP.st14.length === 0) CAP.st14.push({ from, tracks: CAP.cloneTracks(tracks), fit: CAP.fit.slice() });
};
vi.mock('../src/core/generation/newEngine/render/mgPostMixShaper', async (orig) => {
  const m = (await orig()) as any;
  return {
    ...m,
    applyMgLofiDenseMelodyComping: (...a: any[]) => {
      snapSt14('postmix', a[0] as any[]); // ST16 恒不碰 lead ⇒ 其入参 lead 即 ST14 出
      const inRefs = [...(a[0] as any[])];
      const ret = m.applyMgLofiDenseMelodyComping(...a) as any[];
      CAP.postmix.push({
        inTracks: CAP.cloneTracks(inRefs),
        outTracks: CAP.cloneTracks(ret),
        identity: (ret as unknown) === a[0],
        // 「只改 comp/bass」不是注释而是机器事实：其余轨在返回数组里必须是**同一引用**
        sameRefs: ret.every((t, i) => (t.role === 'comp' || t.role === 'bass') || t === inRefs[i]),
      });
      return ret;
    },
    denseMelodySpanRanges: (...a: any[]) => {
      const inSnap = CAP.cloneTracks(a[0] as any[]);
      const ret = m.denseMelodySpanRanges(...a) as Array<{ lo: number; hi: number }>;
      CAP.ranges.push({ inTracks: inSnap, out: ret.map((r) => ({ lo: r.lo, hi: r.hi })) });
      return ret;
    },
  };
});
vi.mock('../src/core/generation/newEngine/render/leadGapFill', async (orig) => {
  const m = (await orig()) as any;
  CAP.raw.leadGapFill = m;    // 未包装真源（ST17 判别力补例直调，见 runCase）
  return {
    ...m,
    // ① ST14 出的观测点（非 lofi 路）；② P2-9 步10b：ST17 本体 leaf I/O。
    fillLeadBarGaps: (...a: any[]) => {
      snapSt14('gapfill', a[0] as any[]);
      CAP.gap.push(1);
      const inRefs = [...(a[0] as any[])];
      const leadIn = inRefs.find((t) => t.role === 'lead');
      const inSnap = leadIn ? CAP.cloneTrack(leadIn) : null;
      // 记录面用**生产**的 planLeadGapFills（纯函数、深不可变）——它是 apply 内部同一次
      // 计算的第二次求值；下面用「记录重放 == 出轨」的机器断言把两路对上（见 runCase）。
      const fills = leadIn ? m.planLeadGapFills(leadIn.notes, a[1], a[2], a[3], a[4] ?? {}) : [];
      const ret = m.fillLeadBarGaps(...a) as any[];
      const leadOut = ret.find((t) => t.role === 'lead');
      CAP.gapfill.push({
        inLead: inSnap,
        outLead: leadOut ? CAP.cloneTrack(leadOut) : null,
        // 「只改 lead」不是注释而是机器事实：其余轨在返回数组里必须是**同一引用**
        sameRefs: ret.every((t, i) => t.role === 'lead' || t === inRefs[i]),
        leadSameRef: leadOut === leadIn,   // fills 为空 ⇒ TS 返回原轨引用（ts:76）
        beatsPerBar: a[3] as number,
        fills,
      });
      return ret;
    },
  };
});
// P2-9 步10b：ST19 applyRepeatGroupReplay（同模块的 applyMotifBindingReplay = ST18，归步10c，
//   此处只经 `...m` 透传，不捕获）。
vi.mock('../src/core/generation/newEngine/render/repeatGroupReplay', async (orig) => {
  const m = (await orig()) as any;
  return {
    ...m,
    applyRepeatGroupReplay: (...a: any[]) => {
      const inRefs = [...(a[0] as any[])];
      const inSnap = CAP.cloneTracks(inRefs);
      const plans = m.planRepeatGroupReplays(a[1], a[2], a[3]);
      const protect = plans.map((p: any) =>
        m.planDrumReplayProtection(a[1], a[3], p).target.map((r: any) => ({ lo: r.lo, hi: r.hi })));
      const ret = m.applyRepeatGroupReplay(...a) as any[];
      CAP.replay.push({
        inTracks: inSnap,
        outTracks: CAP.cloneTracks(ret),
        sameRefs: ret.map((t, i) => t === inRefs[i]),
        plans,
        protect,
      });
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

// ★ P2-9 步10a：ST14 判别力补例的 per-section lead program 轮转值。
//   选值覆盖 fitMidiToProgramRange 的**互异档**（instruments.ts:245-253）：
//   0=keyboard[48,96] · 66=wind[44,76] · 108=[60,81] 专档 · 24=guitar 安全域[40,69] ·
//   42=strings(hard [36,76]) · 12=mallet(≤84 ⇒ [45,84]) · 73=INSTRUMENT_INFO 未登记
//   ⇒ DEFAULT_INFO other[36,96] 兜底档 · 6=keyboard[48,89]。
//   ★ 选值全部落在 **v5.0 instruments.ts 与本仓 afe_render_kb_instruments.c 两表的交集**
//     内（两表差集 20 项 = P2-8a/步9 收割件的 v4.4 存量缺口，属 ST14 之外的独立问题，
//     不在本捕点的判据面上）。
const ST14_PROBE_PROGRAMS = [0, 66, 108, 24, 42, 12, 73, 6];

/** 一次 attempt-1 生产渲染（唯一驱动；runCase 与 ST14 补例共用, 防两份驱动漂移）。 */
function renderOnce(
  seed: number,
  styleHint: string,
  overrideInstrumentation?: (inst: any, sections: ReadonlyArray<{ id: string }>) => any,
) {
  CAP.sched.splice(0); CAP.pad.splice(0); CAP.bass.splice(0); CAP.apply.splice(0); CAP.accomp.splice(0);
  CAP.fit.splice(0); CAP.lead.splice(0); CAP.st14.splice(0);
  CAP.postmix.splice(0); CAP.ranges.splice(0); CAP.gap.splice(0);
  CAP.gapfill.splice(0); CAP.replay.splice(0);
  const req = { seed, styleHint, mood: 'build', targetDuration: 90 } satisfies GenerationRequest;
  const bundle = buildSongBundle(req);
  expect(bundle.band.style.toLowerCase(), `${seed}/${styleHint}: 语料排除 ACG`).not.toBe('acg');
  expect(bundle.acgPianoScorePlan, 'ACG score 非 ACG 恒 undefined').toBeUndefined();
  expect(bundle.jazzFiveFourScorePlan, '5/4 score 自然域零命中（P2J-c）').toBeUndefined();
  expect(bundle.timebase.ppq as number, 'ppq 合同').toBe(480);
  const intentPlan = deriveMusicIntentPlan(bundle.band.style, bundle.arrangement);
  // ★ 器配对象是**冻结**的（Object.freeze），补例走「浅拷贝换字段」而非就地写
  const instrumentation = overrideInstrumentation
    ? overrideInstrumentation(bundle.instrumentation as any, bundle.arrangement.sections as ReadonlyArray<{ id: string }>)
    : bundle.instrumentation;
  renderSongFull(
    bundle.band, bundle.arrangement, bundle.harmonic, instrumentation,
    bundle.timebase, bundle.seedRng, undefined, undefined, intentPlan, undefined,
    bundle.acgPianoScorePlan, bundle.jazzFiveFourScorePlan,
  );
  return bundle;
}

/** ST14 捕获投影（基线与补例共用）：入 lead 轨 / per-note program / per-note 出 pitch。 */
function projectSt14(tag: string) {
  expect(CAP.lead.length, `${tag}: renderMgMelody 恰 1 次`).toBe(1);
  expect(CAP.st14.length, `${tag}: ST14 出捕点恰 1 处`).toBe(1);
  expect(CAP.gap.length, `${tag}: fillLeadBarGaps 恒 1 次（preserveArrangerLeadRests 恒 false 的机器证据）`).toBe(1);
  const leadIn = CAP.lead[0].snap as { role: string; notes: any[] };
  const st14 = CAP.st14[0];
  const leadOut = st14.tracks.find((t) => t.role === 'lead');
  expect(leadOut, `${tag}: ST14 出捕点须含 lead 轨`).toBeTruthy();
  // 窗口纯净性：fit 调用条数 == lead 音符数、role 恒 'lead'（不是推理, 是断言）
  expect(st14.fit.length, `${tag}: ST14 窗口内 fit 调用数 == lead 音符数`).toBe(leadIn.notes.length);
  for (const f of st14.fit) expect(f.role, `${tag}: ST14 窗口内 fit role 恒 lead`).toBe('lead');
  // 两条独立捕获路互证：fit 返回值 == 出轨 pitch；且 start/dur/vel 逐音不变（ST14 只改 pitch）
  for (let i = 0; i < leadIn.notes.length; i++) {
    const a = leadIn.notes[i], b = leadOut!.notes[i], f = st14.fit[i];
    expect(f.value, `${tag}[${i}]: fit 入 pitch == 站13 出 pitch`).toBe(a.pitch as number);
    expect(b.pitch as number, `${tag}[${i}]: 出 pitch == fit 返回`).toBe(f.ret);
    expect(b.startTick as number, `${tag}[${i}]: startTick 不变`).toBe(a.startTick as number);
    expect(b.durationTicks as number, `${tag}[${i}]: durationTicks 不变`).toBe(a.durationTicks as number);
    expect(b.velocity as number, `${tag}[${i}]: velocity 不变`).toBe(a.velocity as number);
  }
  return {
    leadIn: projNotes(leadIn.notes as readonly NoteIR[]),
    program: st14.fit.map((f) => f.program as number),
    outPitch: st14.fit.map((f) => f.ret as number),
    from: st14.from as string,
  };
}

function runCase(seed: number, styleHint: string): CaseRec {
  const bundle = renderOnce(seed, styleHint);

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
  // ★ 值空间接缝（P2-9 步10b）：串 id ↔ 段号只有在单曲内 id 互异时才是双射；
  //   ST19 的 drum 保护窗把 `fromSectionId` 串比较归约成 `from_section_index` 整数比较，
  //   该归约的正确性以此断言为前提（不是注释，是机器事实）。
  expect(secIdxById.size, `${seed}/${styleHint}: 单曲内段 id 须两两互异`).toBe(sections.length);
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
  const schedule = plan.chordTimeline.map((s) => (((sc as any).snap)[s.id] ?? null) as string | null);
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
      notes: projNotes(((CAP.pad[0] as any).snap as TrackIR).notes),
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
      raw: projNotes(((CAP.bass[0] as any).snap as TrackIR).notes),
      intentFamilies: (ap[3].sections as any[]).map(
        (x) => (x.bassPatternSchedule?.slots?.[0]?.family ?? null) as string | null,
      ),
      patternOwnedSecIdx: [...(ap[6] as Set<number>)].sort((x, y) => x - y),
      scheduled: projNotes(((CAP.apply[0] as any).snap as TrackIR).notes),
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
      notes: projNotes((((CAP.accomp[0] as any).snap as TrackIR[])[0] ?? { notes: [] }).notes),
      nTracks: ((CAP.accomp[0] as any).snap as TrackIR[]).length,
    };
    expect(accomp.nTracks, 'accomp 恒单 comp 轨').toBe(1);
  }

  // padCompDecision 双源一致（pad opts 与 accomp ctx 同一 map）
  if (CAP.pad.length === 1 && CAP.accomp.length === 1) {
    expect((CAP.accomp[0].args as any[])[2].padCompDecisionBySection, 'decision 双源同一对象').toBe(
      (CAP.pad[0].args as any[])[2].decisionBySection,
    );
  }

  // ---- P2-9 步10a ① ST14 基线 ----
  const inst = bundle.instrumentation as any;
  const st14Base = projectSt14(`${seed}/${styleHint} ST14`);

  // ---- P2-9 步10a ② ST16（lofi 才被调用, coordinator :980） ----
  const isLofi = (bundle.band.style as string).toLowerCase() === 'lofi';
  expect(CAP.postmix.length, 'applyMgLofiDenseMelodyComping 仅 lofi 且恰 1 次').toBe(isLofi ? 1 : 0);
  expect(CAP.ranges.length, 'denseMelodySpanRanges 仅 lofi 且恰 1 次').toBe(isLofi ? 1 : 0);
  const trackOf = (ts: any[], role: string) => {
    const t = ts.find((x) => x.role === role);
    return t ? projNotes(t.notes as readonly NoteIR[]) : null;
  };
  let st16: CaseRec | null = null;
  if (CAP.postmix.length === 1) {
    const pm = CAP.postmix[0];
    expect(pm.sameRefs, 'ST16 只改 comp/bass：其余轨在返回数组里须同引用').toBe(true);
    expect(pm.outTracks.map((t) => t.role).join(','), 'ST16 轨序/轨集不变').toBe(
      pm.inTracks.map((t) => t.role).join(','),
    );
    st16 = {
      roles: pm.inTracks.map((t) => t.role as string),
      identity: pm.identity,
      inLead: trackOf(pm.inTracks, 'lead'),
      inComp: trackOf(pm.inTracks, 'comp'),
      inBass: trackOf(pm.inTracks, 'bass'),
      outComp: trackOf(pm.outTracks, 'comp'),
      outBass: trackOf(pm.outTracks, 'bass'),
    };
  }
  // ---- P2-9 步10a ③ denseMelodySpanRanges（入 = gatedTracks, 与 ST16 输入不同源） ----
  let denseRanges: CaseRec | null = null;
  if (CAP.ranges.length === 1) {
    const rg = CAP.ranges[0];
    denseRanges = {
      roles: rg.inTracks.map((t) => t.role as string),
      lead: trackOf(rg.inTracks, 'lead'),
      comp: trackOf(rg.inTracks, 'comp'),
      out: rg.out.map((r) => ({ lo: r.lo, hi: r.hi })),
    };
  }

  // ---- P2-9 步10b ④ ST17 fillLeadBarGaps（叶 I/O + 记录面） ----
  expect(CAP.gapfill.length, 'fillLeadBarGaps 恰 1 次（非 ACG 且 preserveArrangerLeadRests 恒 false）').toBe(1);
  const gf = CAP.gapfill[0];
  expect(gf.sameRefs, 'ST17 只改 lead：其余轨在返回数组里须同引用').toBe(true);
  expect(gf.inLead, 'ST17 入须含 lead 轨').toBeTruthy();
  expect(gf.outLead, 'ST17 出须含 lead 轨').toBeTruthy();
  expect(gf.beatsPerBar, 'ST17 beatsPerBar == beatsPerBarOf(meter)').toBe(
    (bundle.arrangement.meter.numerator * 4) / bundle.arrangement.meter.denominator,
  );
  {
    // 两条独立路互证：把 fills 记录重放到入轨，须逐位重现出轨（onset/pitch/vel 不动）
    const byStart = new Map<number, number>();
    for (const f of gf.fills as any[]) byStart.set(f.startTick as number, f.newEnd as number);
    expect(gf.outLead.notes.length, 'ST17 不增删音').toBe(gf.inLead.notes.length);
    for (let i = 0; i < gf.inLead.notes.length; i++) {
      const a0 = gf.inLead.notes[i], b0 = gf.outLead.notes[i];
      const ne = byStart.get(a0.startTick as number);
      const want = ne !== undefined ? ne - (a0.startTick as number) : (a0.durationTicks as number);
      expect(b0.durationTicks as number, `ST17[${i}]: 记录重放 != 出轨时值`).toBe(want);
      expect(b0.startTick as number, `ST17[${i}]: startTick 不变`).toBe(a0.startTick as number);
      expect(b0.pitch as number, `ST17[${i}]: pitch 不变`).toBe(a0.pitch as number);
      expect(b0.velocity as number, `ST17[${i}]: velocity 不变`).toBe(a0.velocity as number);
    }
    // 同 startTick 的 fill 记录须唯一（否则 TS 的 Map 覆写 与 固件的「首个匹配即 break」分叉）
    expect(byStart.size, 'ST17 fills 的 startTick 须两两互异').toBe((gf.fills as any[]).length);
  }
  const projFills = (fs: any[]) => fs.map((f) => ({
    startTick: f.startTick as number,
    oldEnd: f.oldEnd as number,
    newEnd: f.newEnd as number,
    barEnd: f.barEnd as number,
    chordClamped: !!f.chordClamped,
  }));
  // ★ ST17 判别力补例（v5 增量 `chordEnd` 钳位在自然语料**零命中**——机器实测
  //   `st17ChordClamped = 0`：本 pin 的 chord span 时值只有 1bar(1495)/0.5bar(86) 两值且
  //   bar 对齐，凡钳位点都被 `target <= end` 守卫滤掉 ⇒ 是**域的局限**不是构造局限）。
  //   处置同 10a 的 ST14 补例：期望值仍出自 **pin 死 sim 的生产函数**，只把 chordTimeline
  //   换成「每 span 时值减半」的构造域（半 bar 边界 ⇒ chordEnd < barEnd）。
  //   ★ 减半在 binary64 上**精确**（指数减 1），C 侧用 `db * 0.5` 复现即逐位同值——
  //     该精确性由下面的机器断言背书，不靠推理。
  const gfm = CAP.raw.leadGapFill;
  const probeTimeline = (plan.chordTimeline as any[]).map((c) => {
    const half = (c.durationBeats as number) / 2;
    expect(half * 2, 'chord 时值减半须在 binary64 上精确可逆').toBe(c.durationBeats as number);
    return { ...c, durationBeats: half };
  });
  const probeFills = gfm.planLeadGapFills(
    gf.inLead.notes, probeTimeline, bundle.timebase, gf.beatsPerBar, {});
  const probeTracks = gfm.fillLeadBarGaps(
    [{ role: 'lead', notes: gf.inLead.notes }], probeTimeline, bundle.timebase, gf.beatsPerBar, {});
  expect(probeTracks.length, 'ST17 补例出轨数').toBe(1);
  const gapFill = {
    beatsPerBar: bits64(gf.beatsPerBar),
    leadSameRef: gf.leadSameRef,
    leadIn: projNotes(gf.inLead.notes as readonly NoteIR[]),
    leadOut: projNotes(gf.outLead.notes as readonly NoteIR[]),
    fills: projFills(gf.fills as any[]),
    probeLeadOut: projNotes(probeTracks[0].notes as readonly NoteIR[]),
    probeFills: projFills(probeFills as any[]),
  };

  // ---- P2-9 步10b ⑤ ST19 applyRepeatGroupReplay（全轨叶 I/O + 计划面 + drum 保护窗） ----
  expect(CAP.replay.length, 'applyRepeatGroupReplay 恰 1 次（非 ACG）').toBe(1);
  const rp = CAP.replay[0];
  expect(rp.outTracks.map((t) => t.role).join(','), 'ST19 轨序/轨集不变').toBe(
    rp.inTracks.map((t) => t.role).join(','),
  );
  const replay = {
    roles: rp.inTracks.map((t) => t.role as string),
    sameRefs: rp.sameRefs,
    inTracks: rp.inTracks.map((t) => projNotes(t.notes as readonly NoteIR[])),
    outTracks: rp.outTracks.map((t) => projNotes(t.notes as readonly NoteIR[])),
    plans: (rp.plans as any[]).map((p) => ({
      group: p.group as string,
      sourceSec: secIdx(p.sourceId as string),
      targetSec: secIdx(p.targetId as string),
      sourceStartTick: p.sourceStartTick as number,
      targetStartTick: p.targetStartTick as number,
      prefixTicks: p.prefixTicks as number,
    })),
    protect: rp.protect as Array<Array<{ lo: number; hi: number }>>,
  };
  expect(replay.protect.length, 'ST19 保护窗数组与计划数一一对应').toBe(replay.plans.length);

  // ---- P2-9 步10a ④ ST14 判别力补例（第二次生产渲染, 覆盖 programByRoleSection.lead） ----
  const probePrograms = sections.map((_, i) => ST14_PROBE_PROGRAMS[i % ST14_PROBE_PROGRAMS.length]);
  renderOnce(seed, styleHint, (i2, secs) => ({
    ...i2,
    programByRoleSection: {
      ...i2.programByRoleSection,
      lead: Object.fromEntries(secs.map((s, k) => [s.id, probePrograms[k]])),
    },
  }));
  const st14Probe = projectSt14(`${seed}/${styleHint} ST14-probe`);
  // leadIn 与基线逐位相同 ⇒ ①「programByRoleSection 只被 ST14 及其后的站位读」②生成链决定性
  expect(JSON.stringify(st14Probe.leadIn), 'ST14 补例的 lead 输入须与基线逐位相同').toBe(
    JSON.stringify(st14Base.leadIn),
  );
  const st14 = {
    roleProgramLead: inst.roleProgram.lead as number,
    programBySec: sections.map((s) => (inst.programByRoleSection.lead?.[s.id] ?? null) as number | null),
    leadIn: st14Base.leadIn,
    program: st14Base.program,
    outPitch: st14Base.outPitch,
    capturedFrom: st14Base.from,
    probePrograms,
    probeProgram: st14Probe.program,
    probeOutPitch: st14Probe.outPitch,
  };

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
      // ★ P2-9 步10b：ST19 的分组键。id 一并落盘 —— C 侧 `from_section_index`/段序
      //   与 TS 串 id 的双射由 gen 的「单曲内 id 互异」校验背书（值空间接缝）。
      id: s.id as string,
      repeatGroup: ((s as any).repeatGroup ?? null) as string | null,
    })),
    // grooveScorePlan.boundaries（ST19 drum 保护窗的唯一输入；串 id → 段号在此处一次性归约）
    boundaries: ((bundle.arrangement as any).grooveScorePlan?.boundaries ?? []).map((b: any) => ({
      fromSec: b.fromSectionId === undefined ? null : secIdx(b.fromSectionId as string),
      toSec: secIdx(b.toSectionId as string),
      landingBar: b.landingBar as number,
      durationBeats: bits64(b.durationBeats as number),
      opening: !!b.opening,
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
    st14,
    st16,
    denseRanges,
    gapFill,
    replay,
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

    // ---- P2-9 步10a 覆盖面记账（全部机器计数；「不可达/无观测面」一律给实测数，不凭推理） ----
    {
      let idN = 0, progConstN = 0, baseChanged = 0, probeChanged = 0, probeDistinctN = 0;
      for (const c of cases) {
        const s = c.st14 as any;
        const base = s.outPitch.filter((p: number, i: number) => p !== s.leadIn[i].p).length;
        const prob = s.probeOutPitch.filter((p: number, i: number) => p !== s.leadIn[i].p).length;
        baseChanged += base; probeChanged += prob;
        if (base === 0) idN++;
        if (new Set(s.programBySec).size === 1) progConstN++;
        if (new Set(s.probeProgram).size > 1) probeDistinctN++;
      }
      coverage.st14Cases = cases.length;
      coverage.st14IdentityCases = idN;                 // 基线 ST14 逐音恒等的例数
      coverage.st14BaseChangedNotes = baseChanged;      // 基线折叠实际改音数
      coverage.st14ProgramConstCases = progConstN;      // programByRoleSection.lead 段间恒定的例数
      coverage.st14ProbeChangedNotes = probeChanged;    // 补例折叠实际改音数（判别力）
      coverage.st14ProbeMultiProgramCases = probeDistinctN; // 补例里 per-note program 真取到 >1 值的例数
      expect(progConstN, 'programBySec 段间恒定例数（记账；非零即说明段窗口在基线无观测面）').toBe(cases.length);
      expect(probeChanged, 'ST14 判别力补例必须真的改音（否则该补例等于没打靶）').toBeGreaterThan(0);
      expect(probeDistinctN, 'ST14 判别力补例必须让 per-note program 取到 >1 值').toBeGreaterThan(0);

      const lofi = cases.filter((c) => c.st16);
      coverage.st16Cases = lofi.length;
      coverage.st16NonIdentityCases = lofi.filter((c) => (c.st16 as any).identity === false).length;
      coverage.st16CompDeleted = lofi.reduce(
        (a, c) => a + (((c.st16 as any).inComp?.length ?? 0) - ((c.st16 as any).outComp?.length ?? 0)), 0);
      coverage.st16BassDeleted = lofi.reduce(
        (a, c) => a + (((c.st16 as any).inBass?.length ?? 0) - ((c.st16 as any).outBass?.length ?? 0)), 0);
      const rg = cases.filter((c) => c.denseRanges);
      coverage.denseRangesCases = rg.length;
      coverage.denseRangesNonEmptyCases = rg.filter((c) => (c.denseRanges as any).out.length > 0).length;
      coverage.denseRangesTotal = rg.reduce((a, c) => a + (c.denseRanges as any).out.length, 0);
      expect(coverage.st16NonIdentityCases, 'ST16 至少一例非恒等（否则 golden 无判别力）').toBeGreaterThan(0);
      expect(coverage.denseRangesTotal, 'denseMelodySpanRanges 至少产出一个区间').toBeGreaterThan(0);
    }

    // ---- P2-9 步10b 覆盖面记账（全部机器计数；「零命中」一律报实测数，不写成「不可达」） ----
    {
      // ① ST17
      let fills = 0, clamped = 0, idCases = 0, minGapObserved = Number.POSITIVE_INFINITY;
      for (const c of cases) {
        const g = c.gapFill as any;
        fills += g.fills.length;
        clamped += g.fills.filter((f: any) => f.chordClamped).length;
        if (g.fills.length === 0) idCases++;
        for (const f of g.fills) minGapObserved = Math.min(minGapObserved, f.newEnd - f.oldEnd);
      }
      coverage.st17Cases = cases.length;
      coverage.st17IdentityCases = idCases;          // 无可补空拍的例数（ST17 恒等）
      coverage.st17Fills = fills;                    // 补全记录总数
      coverage.st17ChordClamped = clamped;           // ★ v5 增量（和弦钳位）实际命中数
      coverage.st17BarClamped = fills - clamped;     // target == barEnd（v4.4 的唯一形态）
      expect(fills, 'ST17 至少一条补全记录（否则 golden 无判别力）').toBeGreaterThan(0);
      // ST17 判别力补例（构造 chordTimeline）：v5 增量的**唯一**观测面
      let pf = 0, pClamped = 0, pDropped = 0;
      for (const c of cases) {
        const g = c.gapFill as any;
        pf += g.probeFills.length;
        pClamped += g.probeFills.filter((f: any) => f.chordClamped).length;
        const base = new Set(g.fills.map((f: any) => f.startTick));
        pDropped += [...base].filter((s) => !g.probeFills.some((f: any) => f.startTick === s)).length;
      }
      coverage.st17ProbeFills = pf;
      coverage.st17ProbeChordClamped = pClamped;      // 钳位命中（v4.4 恒 target=barEnd ⇒ 会分叉）
      coverage.st17ProbeDroppedFills = pDropped;      // 被 `target<=end` 守卫滤掉的记录（v4.4 会补）
      expect(pClamped + pDropped,
        'ST17 判别力补例必须让 v5 增量真分叉（钳位或守卫至少一处命中）').toBeGreaterThan(0);

      // ② ST19：计划面 + 三条发散路径 + 两处 v5 裁剪 + drum 保护窗
      let plans = 0, planCases = 0, protRanges = 0, protPlans = 0, drumCases = 0;
      let trimEntering = 0, clampCopy = 0, deleted = 0, added = 0, changedTracks = 0;
      for (const c of cases) {
        const r = c.replay as any;
        plans += r.plans.length;
        if (r.plans.length > 0) planCases++;
        for (const p of r.protect) { protRanges += p.length; if (p.length > 0) protPlans++; }
        if (r.roles.includes('drum')) drumCases++;
        for (let k = 0; k < r.roles.length; k++) {
          const inN = r.inTracks[k].length, outN = r.outTracks[k].length;
          if (JSON.stringify(r.inTracks[k]) !== JSON.stringify(r.outTracks[k])) changedTracks++;
          if (outN > inN) added += outN - inN; else deleted += inN - outN;
          // 跨界裁剪 / 拷贝时值钳位的命中数用**入轨几何**独立复算（不看被测输出）
          for (const n of r.inTracks[k]) {
            const st = n.s as number, en = st + (n.d as number);
            const inPrefix = r.plans.find((p: any) => st >= p.targetStartTick && st < p.targetStartTick + p.prefixTicks);
            if (!inPrefix) {
              const first = r.plans.map((p: any) => p.targetStartTick)
                .filter((ts: number) => st < ts && en > ts).sort((x: number, y: number) => x - y)[0];
              if (first !== undefined) trimEntering++;
            }
            for (const p of r.plans) {
              const srcEnd = p.sourceStartTick + p.prefixTicks;
              if (st >= p.sourceStartTick && st < srcEnd && en > srcEnd) clampCopy++;
            }
          }
        }
      }
      coverage.st19Cases = cases.length;
      coverage.st19PlanCases = planCases;             // 有重放计划的例数
      coverage.st19Plans = plans;                     // 计划总数
      coverage.st19DrumCases = drumCases;             // 入轨含 drum 的例数（保护窗执行面）
      coverage.st19ProtectedPlans = protPlans;        // 保护窗非空的计划数
      coverage.st19ProtectRanges = protRanges;        // 保护窗区间总数
      coverage.st19TrimEnteringNotes = trimEntering;  // ★ v5 增量：跨界裁剪命中数
      coverage.st19ClampCopyNotes = clampCopy;        // ★ v5 增量：拷贝时值钳位命中数
      coverage.st19ChangedTracks = changedTracks;     // 出轨与入轨逐音不同的轨数
      coverage.st19DeletedNotes = deleted;
      coverage.st19AddedNotes = added;
      expect(plans, 'ST19 至少一条重放计划（否则 golden 无判别力）').toBeGreaterThan(0);
      expect(changedTracks, 'ST19 至少一条轨真被改（否则 golden 退化为恒等）').toBeGreaterThan(0);

      // ③ 值空间接缝的语料事实（G0 §5.4 / §5.6）
      const rgVals = new Set<string>();
      let rgSections = 0, numericLikeRg = 0, chordTypeNull = 0, chordSpans = 0, typeNeQuality = 0;
      let boundaries = 0, boundariesWithFrom = 0, boundariesOpening = 0, minLandingSlack = Number.POSITIVE_INFINITY;
      for (const c of cases) {
        for (const s of c.sections as any[]) {
          if (!s.repeatGroup) continue;
          rgSections++; rgVals.add(s.repeatGroup);
          if (String(Math.trunc(Number(s.repeatGroup))) === s.repeatGroup) numericLikeRg++;
        }
        for (const ch of c.chords as any[]) {
          chordSpans++;
          if (ch.chordType === null) chordTypeNull++;
          else if (ch.chordType !== ch.quality) typeNeQuality++;
        }
        const bpb = (c.meter as number[])[0] * 4 / (c.meter as number[])[1];
        for (const b of c.boundaries as any[]) {
          boundaries++;
          if (b.fromSec !== null) boundariesWithFrom++;
          if (b.opening) boundariesOpening++;
          const buf = Buffer.alloc(8);
          buf.writeBigUInt64LE(BigInt(b.durationBeats));
          minLandingSlack = Math.min(minLandingSlack, b.landingBar * bpb - buf.readDoubleLE(0));
        }
      }
      coverage.st19RepeatGroupSections = rgSections;
      coverage.st19RepeatGroupValues = [...rgVals].sort().join(',');
      coverage.st19RepeatGroupNumericLike = numericLikeRg;   // ★ Object.keys 整数键序坑：须 0
      coverage.chordSpans = chordSpans;
      coverage.chordTypeNullSpans = chordTypeNull;           // ★ `?? quality` 回落臂命中数
      coverage.chordTypeNeQualitySpans = typeNeQuality;      // 两字段实测有别的条数
      coverage.st19Boundaries = boundaries;
      coverage.st19BoundariesWithFrom = boundariesWithFrom;
      coverage.st19BoundariesOpening = boundariesOpening;
      coverage.st19MinLandingSlackBeats = minLandingSlack;   // beats(负数) 会 throw ⇒ 须 ≥0
      expect(numericLikeRg, 'repeatGroup 出现可被 JS 当整数键的串 ⇒ Object.keys 序 ≠ 插入序').toBe(0);
      expect(minLandingSlack, 'landingBeat - durationBeats 须非负（beats() 对负数抛）').toBeGreaterThanOrEqual(0);
    }

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
