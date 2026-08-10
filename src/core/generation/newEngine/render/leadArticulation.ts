// ============================================================
// newEngine · render · lead 连音 legato(旋律线连贯性)
// ------------------------------------------------------------
// CODEX directive: docs/jazz_bebop_fast_note_legato_render_directive.md(2026-06-18)。
// 纯 render-articulation 工具:在【timing 已定】之后,把快速 lead 线条的相邻音【连起来】
// (durationTicks 延到下一起音),消除 articulation 缩短后重开的"机关枪/断奏"断点。
// ★ 只改 durationTicks(+ 同音高安全 gap);不动 pitch / startTick / 数量 / 顺序 / 和声 / motif 身份。
// ★ 纯函数:无 DOM / scheduler / audio / RNG / motifSandbox import。Q+N(renderMgMelody)与 Q+R(leadOnlyIr)共用。
// ============================================================

import { ticks } from '../foundation';
import type { NoteIR } from '../ir/MusicalIR';

export interface FastLeadLegatoOptions {
  enabled: boolean;
  maxConnectIoiTicks: number;   // IOI ≤ 此值才算同一乐句并连音(超过=乐句断点,不连)
  samePitchGapTicks: number;    // 同音高重复音留的安全间隙(防 noteOff 撞掉下一个 noteOn)
  minDurationTicks: number;     // 连音后最小时长兜底
  maxExtensionTicks?: number;   // 可选:单音最多延长多少 tick(限制过度延长)
  hardBoundaryTicks?: readonly number[]; // arranger section starts that notes may not cross
}

/** ★ 集中决策:按风格给 legato 选项(Q+N 与 Q+R 都调它)。
 *  lead 默认应该是连贯旋律线,不是逐音断奏;超过 1 拍左右的空隙才视作乐句呼吸。 */
export function fastLeadLegatoOptionsForStyle(style: string, ppq: number): FastLeadLegatoOptions {
  const s = String(style).toUpperCase();
  const balladLike = s === 'ACG' || s === 'MODAL';
  return {
    enabled: true,
    maxConnectIoiTicks: Math.round(ppq * (balladLike ? 1.25 : 1.10)), // 连到四分音符级别;更大空隙保留呼吸
    samePitchGapTicks: 1,
    minDurationTicks: Math.max(1, Math.round(ppq * 0.03)),
  };
}

/** 核心:算每个音的【新 durationTicks】(数值);不改 pitch/start/数量/顺序。返回与输入同长的新时长数组。
 *  按 startTick 排序找"下一起音"(只用于计算,不改返回顺序)。同位(IOI≤0)/乐句断点(IOI>max)→ 不连。 */
function computeLegatoDurations(
  notes: readonly { pitch: number; startTick: number; durationTicks: number }[],
  options: FastLeadLegatoOptions,
): number[] {
  const dur = notes.map((n) => n.durationTicks);
  if (!options.enabled || notes.length < 2) return dur;
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].startTick - notes[b].startTick);
  for (let k = 0; k < order.length - 1; k++) {
    const i = order[k], j = order[k + 1];
    const ioi = notes[j].startTick - notes[i].startTick;
    if (ioi <= 0) continue; // 同位
    const samePitch = notes[i].pitch === notes[j].pitch;
    // 安全上限:绝不越过下一起音(同音高再留 gap 防 noteOff 撞掉 noteOn);此上限【始终】优先于 minDuration 软下限。
    let cap = samePitch ? ioi - options.samePitchGapTicks : ioi;
    const hardBoundary = options.hardBoundaryTicks?.find(boundary =>
      boundary > notes[i].startTick && boundary < notes[i].startTick + cap);
    if (hardBoundary !== undefined) cap = hardBoundary - notes[i].startTick;
    if (samePitch) {
      // ★ 同音重复 = re-attack 断奏(beginner healing §9.1,用户拍板):render legato【不连接/不延长】,
      //   保 staccato 手势;仅当原本就重叠 → 安全裁剪(只缩短,防 noteOff 撞掉重复音)。
      if (notes[i].startTick + dur[i] > notes[i].startTick + cap) dur[i] = Math.max(1, cap);
    } else if (ioi <= options.maxConnectIoiTicks) {
      // 不同音快速线条 → 连音(延到下一起音)。minDuration 为软下限,被 cap(=ioi)覆盖时以安全为准。
      let target = Math.max(options.minDurationTicks, cap);
      if (options.maxExtensionTicks != null) target = Math.min(target, notes[i].durationTicks + options.maxExtensionTicks);
      dur[i] = Math.max(1, Math.min(target, cap));
    }
  }
  for (let i = 0; i < notes.length; i++) {
    const hardBoundary = options.hardBoundaryTicks?.find(boundary =>
      boundary > notes[i].startTick && boundary < notes[i].startTick + dur[i]);
    if (hardBoundary !== undefined) dur[i] = Math.max(1, hardBoundary - notes[i].startTick);
  }
  return dur;
}

/** 泛型版:作用于任意 {pitch,startTick,durationTicks} 数值结构(方便 Q+R 调用)。 */
export function connectFastLeadNotes<T extends { pitch: number; startTick: number; durationTicks: number }>(
  notes: readonly T[],
  options: FastLeadLegatoOptions,
): T[] {
  const dur = computeLegatoDurations(notes, options);
  return notes.map((n, i) => ({ ...n, durationTicks: dur[i] }) as T);
}

/** NoteIR 包装(branded Ticks):Q+N(renderMgMelody)/ Q+R(leadOnlyIr)实际调用入口。 */
export function connectFastLeadNoteIR(notes: readonly NoteIR[], options: FastLeadLegatoOptions): NoteIR[] {
  const dur = computeLegatoDurations(notes as readonly { pitch: number; startTick: number; durationTicks: number }[], options);
  return notes.map((n, i) => ({ ...n, durationTicks: ticks(dur[i]) }));
}

// ── 诊断 / 回归度量(directive §6 / §7.4 / §7.5)──────────────────────────────
export interface LeadLegatoMetrics {
  fastPairs: number;              // 相邻不同音高 lead 音 IOI ≤ maxConnectIoi 的对数
  touchOrTinyGapRate: number;     // 同一乐句不同音高对中"触碰或极小间隙"占比
  medianFastArticulation: number; // 同一乐句不同音高对 dur/IOI 中位数
  samePitchCollisionCount: number;// 同音高且 noteOff 压过下一个 noteOn 的对数(应=0)
  microNoteCount: number;         // 时长 < ppq*0.12 的音数
  microIoiCount: number;          // IOI < ppq*0.12 的对数
}

function median(xs: number[]): number {
  if (xs.length === 0) return 1;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** lead 快速线条度量(纯函数;回归测试 / 诊断用)。notes 不要求已排序。 */
export function leadLegatoMetrics(notes: readonly { pitch: number; startTick: number; durationTicks: number }[], ppq: number): LeadLegatoMetrics {
  const maxIoi = ppq * 1.10, micro = ppq * 0.12, tinyGap = Math.max(1, ppq * 0.04);
  const ns = [...notes].sort((a, b) => a.startTick - b.startTick);
  let fastPairs = 0, touch = 0, samePitchCollision = 0, microNote = 0, microIoi = 0;
  const arts: number[] = [];
  for (let i = 0; i < ns.length; i++) {
    if (ns[i].durationTicks < micro) microNote++;
    if (i + 1 >= ns.length) continue;
    const ioi = ns[i + 1].startTick - ns[i].startTick;
    if (ioi <= 0) continue;
    const end = ns[i].startTick + ns[i].durationTicks;
    if (ns[i].pitch === ns[i + 1].pitch && end > ns[i + 1].startTick) samePitchCollision++; // 任意相邻同音高重叠(全检)
    if (ioi < micro) microIoi++;
    if (ns[i].pitch === ns[i + 1].pitch) continue; // 重复同音是 re-attack,不计入连音率
    if (ioi > maxIoi) continue;
    fastPairs++;
    if (ns[i + 1].startTick - end <= tinyGap) touch++;      // 触碰(gap≈0)或极小间隙(含重叠负值)
    arts.push(ns[i].durationTicks / ioi);
  }
  return {
    fastPairs,
    touchOrTinyGapRate: fastPairs ? touch / fastPairs : 1,
    medianFastArticulation: median(arts),
    samePitchCollisionCount: samePitchCollision,
    microNoteCount: microNote,
    microIoiCount: microIoi,
  };
}
