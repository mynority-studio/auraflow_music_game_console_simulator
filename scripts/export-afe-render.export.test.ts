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
//
// ★ P2-9 步10c 增补（G0 表 B4 + 隐藏件 B10）——ST18 `applyMotifBindingReplay`：
//   ⑨ 站位 gate（`resolvedArchetype?.motifPolicyId === 'motif.repeat-group.v1'`, :987）只命中
//      **8/40 例**（jazz）。但 ST18 本体不判该 gate（判在 coordinator, 归步11）⇒ 本捕点对
//      **全部 40 例做模块级驱动**：入轨 = 站17 出（gated 例取 vi.mock 实捕、非 gated 例取站19 入——
//      两者在链上是同一组轨, 有逐音断言背书），出轨 = 直调 pin 死生产函数
//      `applyMotifBindingReplay`；gated 例另断言「模块级驱动 == 生产调用逐位相同」。
//   ⑩ `motifBindings` 投影层（B10）：逐 binding 断言 `motifId === 'm-'+ (repeatGroup ?? sectionId)
//      + '-' + (skeletonRole==='hook' ? 'h' : phraseSlot)`（phrasePlanner.ts:88-92），并落盘
//      (motifKey, motifSlot) 二元组 + permille 化的 requestedRestatementStrength ⇒ C 侧判等键
//      的**值空间接缝**（仓规坑 4）有逐例机器证据；binding↔phrase 1:1 同序亦逐例断言。
//   ⑪ **判别力补例 9 个**（`chordPrefixFingerprint` 是 TS 模块私有函数 ⇒ 串内容在 sim 外
//      **不可观测**，可观测的只有它诱导的等价类）：对最后一条计划的目标窗做构造扰动，
//      期望值仍出自 pin 死 sim 的生产函数 `planMotifBindingReplays`——
//      break_{root,type,bass_role,bass_pedal,start,dur} + order_swap ⇒ 指纹**失配**（计划数减少）；
//      clamp_lo / clamp_hi ⇒ 把窗首/末 span 跨出窗界，钳位正确则指纹**不变**（计划数保持）
//      ⇒ 打 `Math.max(start,startBeat)` / `Math.min(end,endBeat)` 的**接受侧**判别力
//      （自然语料里 span 与句窗恒 bar 对齐 ⇒ 两条钳位臂零命中, 是域的局限）。
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
import { renderSongFull, leadAvoidExposureResolver } from '../src/core/generation/newEngine/render/renderCoordinator';
import { beats, ticks } from '../src/core/generation/newEngine/foundation';
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
    // ---- P2-9 步10c ----
    motif: [] as Array<{ inTracks: any[]; outTracks: any[]; sameRefs: boolean[]; plans: any[] }>,
    // ---- P2-9 步10d：B7 lead_sanitizer 叶 I/O · B6 ST31 调用序 · B8 ST33A 入/出 ----
    san: [] as Array<{ inNotes: any[]; outNotes: any[]; gap: number; minDur: number }>,
    lega: [] as Array<{ inNotes: any[]; outNotes: any[]; opts: any }>,
    legaOpts: [] as Array<{ style: string; ppq: number; ret: any }>,
    // 站13（mgLeadRenderer 内部那次 connectFastLeadNoteIR）与 ST31 的分界：
    //   renderMgMelody 返回时打点，之后的 lega/san 调用才属站31 及以后。
    mark: { lega: -1, san: -1 },
    gest: [] as Array<{ role: string; outNotes: any[] }>,   // ST33A 入 lead / comp 的最终 notes
    follow: [] as Array<{ tracks: any[] }>,                 // applyFinalDrumFollow 入 = ST33A+sanitize 之后
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
      // ★ P2-9 步10d：站13 内部（mgLeadRenderer.ts:356）也调 connectFastLeadNoteIR ⇒
      //   在此打点，之后的 lega/san 调用才归 ST31/ST33A 站位（分界靠机器打点，不靠计数推理）。
      CAP.mark.lega = CAP.lega.length;
      CAP.mark.san = CAP.san.length;
      return ret;
    },
  };
});
// ---- P2-9 步10d：B7 lead_sanitizer（叶 I/O）。ST31 三次 + ST33A 之后一次，共 4 次调用。 ----
vi.mock('../src/core/generation/newEngine/render/leadSanitizer', async (orig) => {
  const m = (await orig()) as any;
  CAP.raw.leadSanitizer = m;
  return {
    ...m,
    sanitizeLeadNoteIR: (notes: any, opts?: any) => {
      const inSnap = (notes as any[]).map((n: any) => ({ ...n }));
      const ret = m.sanitizeLeadNoteIR(notes, opts) as any[];
      CAP.san.push({
        inNotes: inSnap,
        outNotes: ret.map((n: any) => ({ ...n })),
        gap: (opts?.gapTicks ?? 1) as number,
        minDur: (opts?.minDurTicks ?? 1) as number,
      });
      return ret;
    },
  };
});
// ---- P2-9 步10d：B6 ST31 的 legato 半（站13 亦调，靠 CAP.mark 分界）。 ----
vi.mock('../src/core/generation/newEngine/render/leadArticulation', async (orig) => {
  const m = (await orig()) as any;
  CAP.raw.leadArticulation = m;
  return {
    ...m,
    fastLeadLegatoOptionsForStyle: (style: any, ppq: any) => {
      const ret = m.fastLeadLegatoOptionsForStyle(style, ppq);
      CAP.legaOpts.push({ style: String(style), ppq: ppq as number, ret: { ...ret } });
      return ret;
    },
    connectFastLeadNoteIR: (notes: any, options: any) => {
      const inSnap = (notes as any[]).map((n: any) => ({ ...n }));
      const ret = m.connectFastLeadNoteIR(notes, options) as any[];
      CAP.lega.push({
        inNotes: inSnap,
        outNotes: ret.map((n: any) => ({ ...n })),
        opts: { ...options },
      });
      return ret;
    },
  };
});
// ---- P2-9 步10d：B8 ST33A 的**入** lead notes（= gesture 塑形后的 mixAttachedTracks 那一份）。 ----
vi.mock('../src/core/generation/newEngine/instrumental/gestureExpression', async (orig) => {
  const m = (await orig()) as any;
  return {
    ...m,
    applyGestureExpressionToTrack: (...a: any[]) => {
      const ret = m.applyGestureExpressionToTrack(...a);
      CAP.gest.push({
        role: (a[0] as any).role as string,
        outNotes: ((ret as any).notes as any[]).map((n: any) => ({ ...n })),
      });
      return ret;
    },
  };
});
// ---- P2-9 步10d：ST33A 的 compNotes 观测口（applyFinalDrumFollow 入 = contractResolvedTracks；
//      ST33A 只改 lead ⇒ 其 comp 轨 notes 即 coordinator :1414 的 finalCompNotes）。 ----
vi.mock('../src/core/generation/newEngine/render/drumRenderer', async (orig) => {
  const m = (await orig()) as any;
  return {
    ...m,
    applyFinalDrumFollow: (...a: any[]) => {
      CAP.follow.push({ tracks: CAP.cloneTracks(a[0] as any[]) });
      return m.applyFinalDrumFollow(...a);
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
// P2-9 步10b：ST19 applyRepeatGroupReplay；步10c：同模块的 ST18 applyMotifBindingReplay。
vi.mock('../src/core/generation/newEngine/render/repeatGroupReplay', async (orig) => {
  const m = (await orig()) as any;
  CAP.raw.repeatGroupReplay = m;   // 未包装真源（步10c 模块级驱动 + 判别力补例直调）
  return {
    ...m,
    // P2-9 步10c：ST18（站位 gate 在 coordinator :987，只有 motifPolicyId 命中时才进这里）
    applyMotifBindingReplay: (...a: any[]) => {
      const inRefs = [...(a[0] as any[])];
      const inSnap = CAP.cloneTracks(inRefs);
      const plans = m.planMotifBindingReplays(a[1], a[2], a[3]);
      const ret = m.applyMotifBindingReplay(...a) as any[];
      CAP.motif.push({
        inTracks: inSnap,
        outTracks: CAP.cloneTracks(ret),
        sameRefs: ret.map((t, i) => t === inRefs[i]),
        plans,
      });
      return ret;
    },
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
  CAP.gapfill.splice(0); CAP.replay.splice(0); CAP.motif.splice(0);
  CAP.san.splice(0); CAP.lega.splice(0); CAP.legaOpts.splice(0);
  CAP.gest.splice(0); CAP.follow.splice(0); CAP.mark.lega = -1; CAP.mark.san = -1;
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

  // ---- P2-9 步10c ⑨⑩⑪ ST18 applyMotifBindingReplay + motifBindings 投影层 ----
  const arrAny = bundle.arrangement as any;
  const rgm = CAP.raw.repeatGroupReplay;
  const motifPolicyId = (arrAny.resolvedArchetype?.motifPolicyId ?? null) as string | null;
  const st18Applied = CAP.motif.length;
  expect(st18Applied, 'ST18 调用次数 ⟺ motifPolicyId 命中（coordinator :987）')
    .toBe(motifPolicyId === 'motif.repeat-group.v1' ? 1 : 0);

  // ⑩ motifBindings 投影层（B10）：1:1 同序 + motifId 的 (key, slot) 构成律逐条断言
  const phrasesTs = arrAny.phrases as any[];
  const bindingsTs = arrAny.motifBindings as any[];
  expect(bindingsTs.length, 'binding 与 phrase 1:1（phrasePlanner 同一次迭代）').toBe(phrasesTs.length);
  const sectionById = new Map<string, any>((bundle.arrangement.sections as any[]).map((s) => [s.id, s]));
  const motifIdByPair = new Map<string, string>();
  const pairByMotifId = new Map<string, string>();
  const st18Phrases = phrasesTs.map((p, i) => {
    const b = bindingsTs[i];
    expect(b.phraseId, `binding[${i}] 与 phrase 同序`).toBe(p.id);
    const s = sectionById.get(p.sectionId);
    expect(s, `phrase ${p.id} 的 sectionId 须在 sections 内`).toBeTruthy();
    const motifKey = (s.repeatGroup ?? s.id) as string;
    const motifSlot = p.skeletonRole === 'hook' ? 'h' : String(p.phraseSlot);
    // ★ 投影层构成律（phrasePlanner.ts:88-92）——C 侧判等键归约成 (key_off, slot) 的前提
    expect(b.motifId, `binding[${i}] motifId 构成律`).toBe(`m-${motifKey}-${motifSlot}`);
    expect((b.repeatGroup ?? null), `binding[${i}].repeatGroup ≡ section.repeatGroup`)
      .toBe((s.repeatGroup ?? null));
    const perm = Math.round((b.requestedRestatementStrength as number) * 1000);
    expect(perm / 1000, `binding[${i}] 强度 permille 化须精确可逆`)
      .toBe(b.requestedRestatementStrength as number);
    const pair = `${motifKey} ${motifSlot}`;
    // 双射：同 motifId ⇒ 同 (key,slot)；同 (key,slot) ⇒ 同 motifId
    if (motifIdByPair.has(pair))
      expect(motifIdByPair.get(pair), 'motifId ↔ (key,slot) 双射(→)').toBe(b.motifId);
    if (pairByMotifId.has(b.motifId))
      expect(pairByMotifId.get(b.motifId), 'motifId ↔ (key,slot) 双射(←)').toBe(pair);
    motifIdByPair.set(pair, b.motifId);
    pairByMotifId.set(b.motifId, pair);
    return {
      sec: secIdx(p.sectionId as string),
      slot: p.phraseSlot as number,
      bars: p.bars as number,
      skeletonRole: p.skeletonRole as string,
      motifSlot,
      motifKey,
      motifId: b.motifId as string,
      repeatGroup: (b.repeatGroup ?? null) as string | null,
      strengthPermille: perm,
    };
  });

  // ⑨ 模块级驱动（站位 gate 归步11）：入轨 = 站17 出（= gated 例的 ST18 实捕入 / 非 gated 例的站19 入）
  const st18InTracks = st18Applied === 1 ? CAP.motif[0].inTracks : rp.inTracks;
  const st18LeadIn = st18InTracks.find((t: any) => t.role === 'lead');
  expect(st18LeadIn, 'ST18 入须含 lead 轨').toBeTruthy();
  expect(JSON.stringify(projNotes(st18LeadIn.notes)), 'ST18 入 lead ≡ ST17 出 lead（链完整性）')
    .toBe(JSON.stringify(gapFill.leadOut));
  const st18Plans = rgm.planMotifBindingReplays(
    bundle.arrangement, plan.chordTimeline, bundle.timebase) as any[];
  const st18Ret = rgm.applyMotifBindingReplay(
    st18InTracks, bundle.arrangement, plan.chordTimeline, bundle.timebase) as any[];
  const st18Out = st18Ret.map((t: any) => ({ role: t.role, notes: t.notes }));
  const st18LeadOut = st18Out.find((t) => t.role === 'lead');
  expect(st18LeadOut, 'ST18 出须含 lead 轨').toBeTruthy();
  expect(st18Ret.every((t: any, i: number) => t.role === 'lead' || t === st18InTracks[i]),
    'ST18 只改 lead：其余轨在返回数组里须同引用').toBe(true);
  if (st18Applied === 1) {
    // 模块级驱动与生产调用逐位相同（证明捕获路与直调路同源）
    expect(JSON.stringify(st18Plans), 'ST18 模块级计划 == 生产调用计划')
      .toBe(JSON.stringify(CAP.motif[0].plans));
    const prodLeadOut = CAP.motif[0].outTracks.find((t: any) => t.role === 'lead');
    expect(JSON.stringify(projNotes(st18LeadOut!.notes)), 'ST18 模块级出 == 生产调用出')
      .toBe(JSON.stringify(projNotes(prodLeadOut.notes)));
    // 链完整性：ST18 出 lead ≡ ST19 入 lead
    const rpLeadIdx = rp.inTracks.findIndex((t: any) => t.role === 'lead');
    expect(JSON.stringify(projNotes(rp.inTracks[rpLeadIdx].notes)),
      'ST18 出 lead ≡ ST19 入 lead（链完整性）').toBe(JSON.stringify(projNotes(prodLeadOut.notes)));
  }
  const projMotifPlans = (ps: any[]) => ps.map((p) => ({
    motifId: p.motifId as string,
    sourcePhrase: phrasesTs.findIndex((x) => x.id === p.sourcePhraseId),
    targetPhrase: phrasesTs.findIndex((x) => x.id === p.targetPhraseId),
    sourceStartTick: p.sourceStartTick as number,
    targetStartTick: p.targetStartTick as number,
    prefixTicks: p.prefixTicks as number,
  }));
  for (const p of projMotifPlans(st18Plans))
    expect(p.sourcePhrase >= 0 && p.targetPhrase >= 0, 'ST18 计划的句 id 须可解析成句号').toBe(true);

  // ⑪ 判别力补例（构造 chordTimeline，期望值仍出自 pin 死 sim 的 planMotifBindingReplays）
  const ppqNum = bundle.timebase.ppq as number;
  const effType = (c: any) => (c.chordType ?? c.quality) as string;
  const ovr = (tl: any[], i: number) => ({
    i,
    sb: bits64(tl[i].startBeat as number),
    db: bits64(tl[i].durationBeats as number),
    root: tl[i].rootPc as number,
    chordType: effType(tl[i]),
    bassRole: (tl[i].bassRole ?? null) as string | null,
    bassPedalPc: (tl[i].bassPedalPc ?? null) as number | null,
  });
  const st18Variants: CaseRec[] = [];
  if (st18Plans.length > 0) {
    const base = (plan.chordTimeline as any[]).map((c) => ({ ...c }));
    const last = st18Plans[st18Plans.length - 1];
    const tgtLo = (last.targetStartTick as number) / ppqNum;
    const tgtHi = tgtLo + (last.prefixTicks as number) / ppqNum;
    const inWin: number[] = [];
    base.forEach((c, i) => {
      const sb = c.startBeat as number;
      if (sb >= tgtLo && sb < tgtHi) inWin.push(i);
    });
    const baseJson = JSON.stringify(projMotifPlans(st18Plans));
    const addVariant = (name: string, mutate: (tl: any[]) => number[] | null, swap: number[] | null) => {
      const tl = base.map((c) => ({ ...c }));
      const touched = mutate(tl);
      if (touched === null) return;                       // 该例缺少该形态的观测位（记账见 coverage）
      // ★ overrides 记在**换序之前**——C 侧的复现序是「先覆写再换序」，
      //   若在换序后取值会把换序效果编进 overrides 而被 C 端二次施加（首轮实测踩到）。
      const overrides = touched.map((i) => ovr(tl, i));
      if (swap) { const t0 = tl[swap[0]]; tl[swap[0]] = tl[swap[1]]; tl[swap[1]] = t0; }
      const ps = rgm.planMotifBindingReplays(bundle.arrangement, tl, bundle.timebase) as any[];
      st18Variants.push({
        name,
        overrides,
        swap: swap ? [swap[0], swap[1]] : null,
        plans: projMotifPlans(ps),
      });
    };
    if (inWin.length >= 2) {
      addVariant('break_root', (tl) => {
        for (const i of inWin) tl[i].rootPc = ((tl[i].rootPc as number) + 1) % 12;
        return inWin;
      }, null);
      addVariant('break_type', (tl) => {
        for (const i of inWin) tl[i].chordType = `${effType(tl[i])}X`;
        return inWin;
      }, null);
      addVariant('break_bass_role', (tl) => {
        for (const i of inWin) tl[i].bassRole = tl[i].bassRole === '7th' ? 'root' : '7th';
        return inWin;
      }, null);
      addVariant('break_bass_pedal', (tl) => {
        for (const i of inWin) tl[i].bassPedalPc = (((tl[i].bassPedalPc ?? 0) as number) + 1) % 12;
        return inWin;
      }, null);
      addVariant('break_start', (tl) => {
        tl[inWin[0]].startBeat = (tl[inWin[0]].startBeat as number) + 0.5;
        return [inWin[0]];
      }, null);
      addVariant('break_dur', (tl) => {
        tl[inWin[1]].durationBeats = (tl[inWin[1]].durationBeats as number) - 0.5;
        return [inWin[1]];
      }, null);
      addVariant('order_swap', () => [], [inWin[0], inWin[1]]);   // 只换序、零字段覆写
      // clamp_lo：窗首 span（起点恰在窗起）左移 0.5 拍并等量加长 ⇒ end 不变；
      //           `lo = max(start, startBeat)` 正确则条目不变（接受侧判别力）。
      const loIdx = inWin.find((i) => (base[i].startBeat as number) === tgtLo);
      addVariant('clamp_lo', (tl) => {
        if (loIdx === undefined) return null;
        tl[loIdx].startBeat = (tl[loIdx].startBeat as number) - 0.5;
        tl[loIdx].durationBeats = (tl[loIdx].durationBeats as number) + 0.5;
        return [loIdx];
      }, null);
      // clamp_hi：窗末 span（终点恰在窗末）加长 0.5 拍 ⇒ `hi = min(end, endBeat)` 正确则条目不变。
      const hiIdx = inWin.find(
        (i) => (base[i].startBeat as number) + (base[i].durationBeats as number) === tgtHi);
      addVariant('clamp_hi', (tl) => {
        if (hiIdx === undefined) return null;
        tl[hiIdx].durationBeats = (tl[hiIdx].durationBeats as number) + 0.5;
        return [hiIdx];
      }, null);
    }
    for (const v of st18Variants) {
      const isClamp = (v.name as string).startsWith('clamp_');
      if (isClamp) {
        expect(JSON.stringify(v.plans), `ST18 补例 ${v.name}: 钳位正确 ⇒ 计划面不变`).toBe(baseJson);
      } else {
        expect((v.plans as any[]).length, `ST18 补例 ${v.name}: 指纹须失配 ⇒ 计划数减少`)
          .toBeLessThan(st18Plans.length);
      }
    }
  }

  const st18 = {
    motifPolicyId,
    applied: st18Applied,
    retainTailBars: 1,
    phrases: st18Phrases,
    roles: st18InTracks.map((t: any) => t.role as string),
    leadOut: projNotes(st18LeadOut!.notes as readonly NoteIR[]),
    plans: projMotifPlans(st18Plans),
    variants: st18Variants,
  };

  // ============ P2-9 步10d ⑫⑬⑭：B6 ST31 · B7 lead_sanitizer · B8 ST33A ============
  // ⑫ **调用序锁**（G0 §2 B6 冻结验收面：3 次 sanitize + 2 次 legato）。
  //    站13（mgLeadRenderer.ts:356）内部也调 connectFastLeadNoteIR ⇒ 用 CAP.mark 机器分界。
  expect(CAP.mark.san, 'CAP.mark 须在站13 打点（renderMgMelody 返回时）').toBeGreaterThanOrEqual(0);
  expect(CAP.mark.san, '站13 及其之前不调 sanitizeLeadNoteIR').toBe(0);
  expect(CAP.mark.lega, '站13 恰调 1 次 connectFastLeadNoteIR（mgLeadRenderer.ts:356）').toBe(1);
  const sanCalls = CAP.san.slice(CAP.mark.san);
  const legaCalls = CAP.lega.slice(CAP.mark.lega);
  expect(sanCalls.length, 'ST31 三次 + ST33A 之后一次 = 4（lead 轨恰 1 条）').toBe(4);
  expect(legaCalls.length, 'ST31 两次 legato').toBe(2);
  for (const c of sanCalls) {
    expect(c.gap, 'SANITIZE_OPTS.gapTicks 恒 1（ts:1238）').toBe(1);
    expect(c.minDur, 'SANITIZE_OPTS.minDurTicks 恒 1（ts:1238）').toBe(1);
  }
  // legato 选项：两次都用 `fastLeadLegatoOptionsForStyle(band.style, ppq)`（ts:1241-1243 算一次共用）
  const la = CAP.raw.leadArticulation;
  const expectOpts = la.fastLeadLegatoOptionsForStyle(bundle.band.style, bundle.timebase.ppq as number);
  const balladLike = String(bundle.band.style).toUpperCase() === 'ACG'
    || String(bundle.band.style).toUpperCase() === 'MODAL';
  for (const c of legaCalls)
    expect(JSON.stringify(c.opts), 'ST31 两次 legato 的 opts ≡ f(band.style, ppq)')
      .toBe(JSON.stringify(expectOpts));
  // 链完整性：五步首尾相接（中间的 ACG 专属段 normalizeAcgDynamics 在非 ACG 是恒等透传 ts:1268）
  const stepChain = [
    { kind: 'sanitize', c: sanCalls[0] }, { kind: 'legato', c: legaCalls[0] },
    { kind: 'sanitize', c: sanCalls[1] }, { kind: 'legato', c: legaCalls[1] },
    { kind: 'sanitize', c: sanCalls[2] },
  ];
  for (let k = 1; k < stepChain.length; k++)
    expect(JSON.stringify(stepChain[k].c.inNotes), `ST31 第 ${k + 1} 步入 ≡ 第 ${k} 步出`)
      .toBe(JSON.stringify(stepChain[k - 1].c.outNotes));
  const st31 = {
    balladLike,
    legatoOpts: {
      enabled: !!expectOpts.enabled,
      maxConnectIoiTicks: expectOpts.maxConnectIoiTicks as number,
      samePitchGapTicks: expectOpts.samePitchGapTicks as number,
      minDurationTicks: expectOpts.minDurationTicks as number,
      hasMaxExtension: expectOpts.maxExtensionTicks != null,
      maxExtensionTicks: (expectOpts.maxExtensionTicks ?? 0) as number,
    },
    leadIn: projNotes(sanCalls[0].inNotes as readonly NoteIR[]),
    steps: stepChain.map((s) => ({ kind: s.kind, out: projNotes(s.c.outNotes as readonly NoteIR[]) })),
  };

  // ⑬ B8 ST33A：入 = gesture 塑形后的 lead（= mixAttachedTracks 那一份，ts:1421 的实参）
  const leadGest = CAP.gest.filter((g) => g.role === 'lead');
  expect(leadGest.length, 'lead 恒过 gesture 塑形（非 ACG、lead 不在 timedRoleNames）').toBe(1);
  const st33aLeadIn = leadGest[0].outNotes;
  expect(CAP.follow.length, 'applyFinalDrumFollow 恰 1 次').toBe(1);
  const followTracks = CAP.follow[0].tracks as any[];
  const compFollow = followTracks.find((t) => t.role === 'comp');
  // ST33A 只改 lead ⇒ contractResolvedTracks 的 comp notes 即 ts:1414 的 finalCompNotes
  const st33aComp = (compFollow?.notes ?? []) as any[];
  const leadProgramFor = (sectionId: string): number | undefined =>
    inst.programByRoleSection.lead?.[sectionId]
    ?? inst.roleProgram.lead
    ?? (bundle.band as any).roleProgram?.lead;
  const auditKeyCtx = {
    keyRootPc: bundle.band.key as number,
    globalMode: (bundle.band as any).mode as string,
    isModalContext: (bundle.band as any).tonalityKind === 'modal',
    scaleName: (bundle.band as any).modalModeName as string | undefined,
    tonalCharacter: ((bundle.band as any).tonalityKind === 'modal' ? 'modal' : 'tonal') as string,
  };
  // 模块级驱动（`leadAvoidExposureResolver` 是 renderCoordinator 的 export，同模块内调用
  // 无法 vi.mock 拦截 ⇒ 直调 pin 死生产函数；随后与生产调用的实际产出逐位对撞）。
  const st33aOut = leadAvoidExposureResolver(
    st33aLeadIn as any, plan, bundle.timebase,
    leadProgramFor, st33aComp as any, auditKeyCtx as any,
  ) as readonly NoteIR[];
  expect(JSON.stringify(projNotes(st33aOut)), 'ST33A 模块级驱动 == 生产调用（第4 次 sanitize 的入参）')
    .toBe(JSON.stringify(projNotes(sanCalls[3].inNotes as readonly NoteIR[])));
  // eval 支的**前置**命中数（不调评估器，只数前置：span 命中 ∧ !hardAvoid ∧ dur ≥ 2 拍）
  const oneBeatTicks = bundle.timebase.beatToTick(beats(1)) as number;
  const structuralTicks = Math.round((bundle.timebase.ppq as number) * 0.75);
  const bpbSt33 = bundle.arrangement.meter.numerator * (4 / bundle.arrangement.meter.denominator);
  const metricTol = (bundle.timebase.ppq as number) * 0.08;
  const spanRanges = plan.chordTimeline.map((s: ChordSpan) => {
    const st = bundle.timebase.beatToTick(s.startBeat) as number;
    return { s, lo: st, hi: st + (bundle.timebase.beatToTick(s.durationBeats) as number) };
  });
  let st33aSpanHit = 0, st33aStructural = 0, st33aHardAvoid = 0, st33aEvalPre = 0;
  for (const n of st33aLeadIn) {
    const start = n.startTick as number;
    const e = spanRanges.find((r) => start >= r.lo && start < r.hi);
    if (!e) continue;
    st33aSpanHit++;
    const beat = bundle.timebase.tickToBeat(ticks(start)) as number;
    const phase = ((beat % bpbSt33) + bpbSt33) % bpbSt33;
    const strong = Math.min(Math.abs(phase), Math.abs(phase - bpbSt33), Math.abs(phase - bpbSt33 / 2))
      * (bundle.timebase.ppq as number) <= metricTol;
    const structural = strong || Math.abs(start - e.lo) <= metricTol
      || (n.durationTicks as number) >= structuralTicks;
    if (structural) st33aStructural++;
    const notePc = (((n.pitch as number) % 12) + 12) % 12;
    const hard = structural && ((plan.avoidNoteMap as any)[e.s.id] ?? []).includes(notePc);
    if (hard) st33aHardAvoid++;
    if (!hard && (n.durationTicks as number) >= oneBeatTicks * 2) st33aEvalPre++;
  }
  const st33aChanged = projNotes(st33aOut).filter((o, i) => {
    const a = projNotes(st33aLeadIn as readonly NoteIR[])[i];
    return !a || a.p !== o.p || a.s !== o.s || a.d !== o.d;
  }).length;
  const st33a = {
    keyCtx: {
      keyRootPc: auditKeyCtx.keyRootPc,
      globalMode: auditKeyCtx.globalMode,
      isModalContext: auditKeyCtx.isModalContext,
      scaleName: (auditKeyCtx.scaleName ?? null) as string | null,
      tonalCharacter: auditKeyCtx.tonalCharacter,
    },
    programBySec: sections.map((s) => (leadProgramFor(s.id) ?? null) as number | null),
    modToKey: sections.map((s) => (((plan as any).modulationMap?.[s.id]?.toKey) ?? null) as number | null),
    leadIn: projNotes(st33aLeadIn as readonly NoteIR[]),
    comp: projNotes(st33aComp as readonly NoteIR[]),
    leadOut: projNotes(st33aOut),
    sanitizedOut: projNotes(sanCalls[3].outNotes as readonly NoteIR[]),
    spanHit: st33aSpanHit,
    structural: st33aStructural,
    hardAvoid: st33aHardAvoid,
    evalPre: st33aEvalPre,
    changed: st33aChanged,
    splitDelta: st33aOut.length - st33aLeadIn.length,
  };

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
    st18,
    st31,
    st33a,
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

    // ---- P2-9 步10c 覆盖面记账（ST18 + motifBindings 投影层；「零命中」一律报实测数） ----
    {
      let gatedCases = 0, planCases = 0, plans = 0, changedLead = 0, bindings = 0;
      let hookPhrases = 0, rgPhrases = 0, weakBindings = 0, hookNoRg = 0, hookWeak = 0;
      let maxSlot = 0, phraseBarsSet = new Set<number>(), strengthSet = new Set<number>();
      let variantsTotal = 0, breakDrops = 0, clampKeeps = 0;
      const variantByName: Record<string, number> = {};
      for (const c of cases) {
        const s = c.st18 as any;
        if (s.applied) gatedCases++;
        if (s.plans.length > 0) planCases++;
        plans += s.plans.length;
        if (JSON.stringify(s.leadOut) !== JSON.stringify((c.gapFill as any).leadOut)) changedLead++;
        bindings += s.phrases.length;
        for (const p of s.phrases) {
          if (p.skeletonRole === 'hook') hookPhrases++;
          if (p.repeatGroup !== null) rgPhrases++;
          if (p.strengthPermille < 500) weakBindings++;
          if (p.skeletonRole === 'hook' && p.repeatGroup === null) hookNoRg++;
          if (p.skeletonRole === 'hook' && p.repeatGroup !== null && p.strengthPermille < 500) hookWeak++;
          maxSlot = Math.max(maxSlot, p.slot as number);
          phraseBarsSet.add(p.bars as number);
          strengthSet.add(p.strengthPermille as number);
        }
        for (const v of s.variants as any[]) {
          variantsTotal++;
          variantByName[v.name] = (variantByName[v.name] ?? 0) + 1;
          if (String(v.name).startsWith('clamp_')) clampKeeps++;
          else breakDrops++;
        }
      }
      coverage.st18Cases = cases.length;
      coverage.st18GatedCases = gatedCases;             // coordinator :987 命中的例数
      coverage.st18PlanCases = planCases;               // 模块级驱动有计划的例数
      coverage.st18Plans = plans;                       // 计划总数
      coverage.st18ChangedLeadCases = changedLead;      // ST18 真改 lead 的例数
      coverage.st18Bindings = bindings;                 // = phrase 总数（1:1）
      coverage.st18HookPhrases = hookPhrases;
      coverage.st18RepeatGroupPhrases = rgPhrases;
      coverage.st18WeakBindings = weakBindings;         // strength < 500 的 binding 数（**门前**）
      coverage.st18HookWithoutRepeatGroup = hookNoRg;   // ★ `!repeatGroup` 门的**决定性**命中数
      coverage.st18HookWeakStrength = hookWeak;         // ★ `< 0.5` 门的**决定性**命中数
      coverage.st18MaxPhraseSlot = maxSlot;             // 与 motifSlot 的 'h'(0xFF) 撞值面
      coverage.st18PhraseBars = [...phraseBarsSet].sort((a, b) => a - b).join(',');
      coverage.st18StrengthPermille = [...strengthSet].sort((a, b) => a - b).join(',');
      coverage.st18Variants = variantsTotal;
      coverage.st18VariantBreak = breakDrops;
      coverage.st18VariantClamp = clampKeeps;
      coverage.st18VariantByName = Object.entries(variantByName)
        .sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, n]) => `${k}:${n}`).join(',');
      expect(plans, 'ST18 至少一条重放计划（否则 golden 退化为恒等）').toBeGreaterThan(0);
      expect(changedLead, 'ST18 至少一例真改 lead（否则 golden 无判别力）').toBeGreaterThan(0);
      expect(breakDrops, 'ST18 指纹失配补例至少一条').toBeGreaterThan(0);
      expect(clampKeeps, 'ST18 钳位补例至少一条').toBeGreaterThan(0);
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

    // ---- P2-9 步10d 覆盖面记账（B6 ST31 / B7 lead_sanitizer / B8 ST33A；「零命中」一律报实测数） ----
    {
      let sanCalls = 0, sanNonIdentity = 0, sanCoalesced = 0, sanTrimmed = 0, sanMaxNotes = 0;
      let legaCalls = 0, legaNonIdentity = 0, balladCases = 0;
      let st33aCases = 0, st33aChangedCases = 0, st33aChangedNotes = 0, st33aSplitNotes = 0;
      let st33aSpanHit = 0, st33aStructural = 0, st33aHardAvoid = 0, st33aEvalPre = 0;
      let st33aCompNotes = 0, st33aProgramUndef = 0, st33aModToKey = 0;
      let arSwapCases = 0, arSwapNotes = 0;
      const legatoIoiSet = new Set<number>();
      for (const c of cases) {
        const s31 = c.st31 as any, s33 = c.st33a as any;
        if (s31.balladLike) balladCases++;
        legatoIoiSet.add(s31.legatoOpts.maxConnectIoiTicks as number);
        let prev = s31.leadIn as any[];
        for (const st of s31.steps as any[]) {
          const out2 = st.out as any[];
          if (st.kind === 'sanitize') {
            sanCalls++;
            if (JSON.stringify(prev) !== JSON.stringify(out2)) sanNonIdentity++;
            if (out2.length < prev.length) sanCoalesced++;
            // 「有音被裁短」= ④ 支命中（同 pitch overlap 裁剪）
            const byKey = new Map<string, number>();
            for (const n of prev) byKey.set(`${n.s}|${n.p}`, Math.max(byKey.get(`${n.s}|${n.p}`) ?? 0, n.d));
            if (out2.some((n) => (byKey.get(`${n.s}|${n.p}`) ?? -1) > n.d)) sanTrimmed++;
            sanMaxNotes = Math.max(sanMaxNotes, prev.length);
          } else {
            legaCalls++;
            if (JSON.stringify(prev) !== JSON.stringify(out2)) legaNonIdentity++;
          }
          prev = out2;
        }
        // ★ 「sanitize→legato」与「legato→sanitize」不可交换的**自然语料**判别力（.h §3 ④）
        const raw = CAP.raw.leadArticulation, rawSan = CAP.raw.leadSanitizer;
        const OPT = { gapTicks: 1, minDurTicks: 1 };
        const toIr = (ns: any[]) => ns.map((n) => ({ pitch: n.p, startTick: n.s, durationTicks: n.d, velocity: n.v }));
        const lo = { enabled: true, maxConnectIoiTicks: s31.legatoOpts.maxConnectIoiTicks,
                     samePitchGapTicks: s31.legatoOpts.samePitchGapTicks,
                     minDurationTicks: s31.legatoOpts.minDurationTicks };
        // 前两步换序：正确序 = legato(sanitize(x))（= steps[1].out）；换序 = sanitize(legato(x))
        const ab = projNotes(rawSan.sanitizeLeadNoteIR(
          raw.connectFastLeadNoteIR(toIr(s31.leadIn as any[]) as any, lo as any), OPT));
        const ba = s31.steps[1].out as any[];
        const diff = JSON.stringify(ab) !== JSON.stringify(ba) ? 1 : 0;
        if (diff) {
          arSwapCases++;
          const m = Math.max(ab.length, ba.length);
          for (let k = 0; k < m; k++)
            if (JSON.stringify(ab[k] ?? null) !== JSON.stringify(ba[k] ?? null)) arSwapNotes++;
        }
        st33aCases++;
        st33aSpanHit += s33.spanHit as number;
        st33aStructural += s33.structural as number;
        st33aHardAvoid += s33.hardAvoid as number;
        st33aEvalPre += s33.evalPre as number;
        st33aCompNotes += (s33.comp as any[]).length;
        st33aSplitNotes += s33.splitDelta as number;
        st33aChangedNotes += s33.changed as number;
        if ((s33.changed as number) > 0 || (s33.splitDelta as number) !== 0) st33aChangedCases++;
        st33aProgramUndef += (s33.programBySec as any[]).filter((x) => x === null).length;
        st33aModToKey += (s33.modToKey as any[]).filter((x) => x !== null).length;
      }
      coverage.st31Cases = cases.length;
      coverage.st31BalladLikeCases = balladCases;          // = style ∈ {ACG, MODAL} 的例数
      coverage.st31LegatoIoiValues = [...legatoIoiSet].sort((a, b) => a - b).join(',');
      coverage.st31SanitizeCalls = sanCalls;               // 3 次/例（ST33A 后那次不在 st31.steps 内）
      coverage.st31SanitizeNonIdentity = sanNonIdentity;
      coverage.st31SanitizeCoalesced = sanCoalesced;       // ② coalesce 支实际命中的步数
      coverage.st31SanitizeTrimmed = sanTrimmed;           // ④ overlap 裁剪支实际命中的步数
      coverage.st31SanitizeMaxNotes = sanMaxNotes;
      coverage.st31LegatoCalls = legaCalls;
      coverage.st31LegatoNonIdentity = legaNonIdentity;
      coverage.st31OrderSwapCases = arSwapCases;           // ★ 调用序判别力（非「碰巧同值」）
      coverage.st31OrderSwapNotes = arSwapNotes;
      coverage.st33aCases = st33aCases;
      coverage.st33aChangedCases = st33aChangedCases;
      coverage.st33aChangedNotes = st33aChangedNotes;
      coverage.st33aSplitNotes = st33aSplitNotes;
      coverage.st33aSpanHitNotes = st33aSpanHit;
      coverage.st33aStructuralNotes = st33aStructural;
      coverage.st33aHardAvoidNotes = st33aHardAvoid;
      coverage.st33aEvalPreconditionNotes = st33aEvalPre;  // eval 支（评估器）前置命中上界
      coverage.st33aCompNotes = st33aCompNotes;
      coverage.st33aProgramUndefSections = st33aProgramUndef;
      coverage.st33aModulationSections = st33aModToKey;
      expect(sanCalls, 'ST31 sanitize 步数 = 3×例数').toBe(cases.length * 3);
      expect(legaCalls, 'ST31 legato 步数 = 2×例数').toBe(cases.length * 2);
      expect(balladCases, 'balladLike 臂须有自然语料命中（modal 8 例）').toBeGreaterThan(0);
      expect(legatoIoiSet.size, 'balladLike 两档 maxConnectIoi 须都出现（否则该谓词零判别力）')
        .toBeGreaterThan(1);
    }

    // ---- P2-9 步10d：B7 lead_sanitizer 的**规则级**判别力补例（G0 §2 B7 冻结的四条规则）。
    //      期望值全部出自 pin 死 sim 的生产函数 `sanitizeLeadNoteIR`，只换**输入**（构造域）。
    const rawSan = CAP.raw.leadSanitizer;
    const mkN = (p: number, s: number, d: number, v: number) => ({ pitch: p, startTick: s, durationTicks: d, velocity: v });
    const sanitizerProbes: Array<{ name: string; gap: number; minDur: number; input: any[] }> = [
      { name: 'empty', gap: 1, minDur: 1, input: [] },
      { name: 'single', gap: 1, minDur: 1, input: [mkN(60, 0, 100, 80)] },
      // ② coalesce：同 start+同 pitch 取**大 dur** 与**大 vel**（两项各自独立取大）
      { name: 'coalesce_dur_vel_split', gap: 1, minDur: 1,
        input: [mkN(60, 0, 200, 40), mkN(60, 0, 50, 99)] },
      { name: 'coalesce_three', gap: 1, minDur: 1,
        input: [mkN(60, 0, 10, 10), mkN(60, 0, 30, 5), mkN(60, 0, 20, 70)] },
      // ① 稳定排序：同 startTick 不同 pitch —— 等键保插入序（尾部值才暴露错位，仓规坑 4）
      { name: 'stable_equal_start', gap: 1, minDur: 1,
        input: [mkN(72, 100, 40, 10), mkN(60, 100, 40, 20), mkN(65, 100, 40, 30)] },
      { name: 'unsorted_input', gap: 1, minDur: 1,
        input: [mkN(64, 900, 50, 60), mkN(60, 100, 50, 61), mkN(62, 500, 50, 62)] },
      // ④ overlap：同 pitch 前音裁到 nextStart-iStart-gap
      { name: 'overlap_same_pitch', gap: 1, minDur: 1,
        input: [mkN(60, 0, 500, 80), mkN(60, 200, 100, 80)] },
      // ④ 下钳：nextStart-iStart-gap < minDur ⇒ 取 minDur
      { name: 'overlap_clamp_min_dur', gap: 1, minDur: 30,
        input: [mkN(60, 0, 500, 80), mkN(60, 5, 100, 80)] },
      // ④ 不同 pitch 的 overlap 不裁（legato 连奏保留）
      { name: 'overlap_diff_pitch', gap: 1, minDur: 1,
        input: [mkN(60, 0, 500, 80), mkN(62, 200, 100, 80)] },
      // ④ 首匹配即 break：先遇不同 pitch 再遇同 pitch，仍按**同 pitch 的那个**裁
      { name: 'overlap_first_match_break', gap: 1, minDur: 1,
        input: [mkN(60, 0, 500, 80), mkN(62, 100, 50, 80), mkN(60, 300, 50, 80), mkN(60, 400, 50, 80)] },
      // ④ `js >= iEnd` 提前 break：同 pitch 但不重叠 ⇒ 不动
      { name: 'no_overlap_same_pitch', gap: 1, minDur: 1,
        input: [mkN(60, 0, 100, 80), mkN(60, 100, 100, 80)] },
      // 非缺省 gap/minDur（生产恒 (1,1)，此处打形参载荷）
      { name: 'nondefault_gap', gap: 17, minDur: 3,
        input: [mkN(60, 0, 500, 80), mkN(60, 200, 100, 80)] },
      // 混合：coalesce 之后才出现的 overlap（③ 再排序的语义面）
      { name: 'coalesce_then_overlap', gap: 1, minDur: 1,
        input: [mkN(60, 0, 100, 80), mkN(60, 0, 400, 20), mkN(60, 250, 100, 80)] },
    ];
    const leadSanitizerProbes = sanitizerProbes.map((p) => ({
      name: p.name, gap: p.gap, minDur: p.minDur,
      input: projNotes(p.input as any),
      output: projNotes(rawSan.sanitizeLeadNoteIR(p.input as any,
        { gapTicks: p.gap, minDurTicks: p.minDur })),
    }));
    // fail-closed：至少一条补例真触发 coalesce（缩条数）、至少一条真触发裁剪（改 dur）
    expect(leadSanitizerProbes.some((p) => p.output.length < p.input.length),
      'B7 补例须有 coalesce 命中').toBe(true);
    expect(leadSanitizerProbes.some((p) => p.input.some((a, i) =>
      p.output[i] && p.output[i].s === a.s && p.output[i].p === a.p && p.output[i].d !== a.d)),
      'B7 补例须有 overlap 裁剪命中').toBe(true);
    coverage.leadSanitizerProbes = leadSanitizerProbes.length;

    const out = {
      schemaVersion: SCHEMA_VERSION,
      provenance: {
        source: 'auraflow_music_game_console_simulator attempt-1 renderSongFull 捕获（vi.mock 五件包装）',
        generator: 'scripts/export-afe-render.export.test.ts',
      },
      grooveBassPatterns: kb,
      coverage,
      supplements,
      leadSanitizerProbes,
      caseCount: cases.length,
      cases,
    };
    assertJsonSafe(out, '$');
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  }, 900_000);
});
