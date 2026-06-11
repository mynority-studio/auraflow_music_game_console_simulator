// ============================================================
// newEngine · render · repeatGroup 重放(2026-06-11)
// ------------------------------------------------------------
// 用户诉求:重复段落(verse1≡verse2, chorus1≡chorus2)旋律/伴奏/bass 全轨【保持一致】,
//   只在【链接处】可变(verse→verse turnaround / verse→chorus voice-leading)。
// 机制:同 repeatGroup 取【首段=源】,后续段复用源的【和声一致前缀(body)】—— time-shift 复制每条轨;
//   每段保留【自己的发散尾巴(link bar)】(linkOut/dominantLift 改尾 → 通常落最后 1 小节,自适应任意长度)。
// 成立前提:和声本就 repeatGroup 一致(progressionSelector/harmonyEngine)→ 源旋律落目标(相同)和弦上天然合法。
// ★ 放在 render 的 humanize 之前 → body 同音符,humanize/swing 各段跑出自然微差(lead 不 humanize → 逐字节一致)。
// 纯函数、确定性、深不可变(返回新 tracks)。打破 strict MG lead parity:首次出现==raw MG,重复出现==首次重放。
// ============================================================

import { beats, ticks, type Timebase } from '../foundation';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import type { ChordSpan } from '../harmony/HarmonicPlan';
import type { TrackIR, NoteIR } from '../ir/MusicalIR';

/** 和弦身份(发散判定):根 + 宽类型(无则窄品质)+ bass intent。 */
function chordKey(c: ChordSpan): string {
  return `${c.rootPc}|${c.chordType ?? c.quality}|${c.bassRole ?? ''}|${c.bassPedalPc ?? ''}`;
}

export interface ReplaySpan {
  group: string;
  sourceId: string;
  targetId: string;
  sourceStartTick: number;
  targetStartTick: number;
  prefixTicks: number; // 和声一致前缀长度(body);其后 = 各自发散尾巴(保留)
}

/** 求 repeatGroup 重放计划(纯计算;trace/测试复用)。 */
export function planRepeatGroupReplays(
  arrangement: ArrangementPlan,
  chordTimeline: readonly ChordSpan[],
  timebase: Timebase,
): ReplaySpan[] {
  const bpb = beatsPerBarOf(arrangement.meter);
  // 段落起始拍(累加 bars,与 render 段边界同源)
  const startBeatById: Record<string, number> = {};
  let cur = 0;
  for (const s of arrangement.sections) { startBeatById[s.id] = cur; cur += s.bars * bpb; }
  // 每段 chord spans(按 startBeat 升序)
  const spansBySec: Record<string, ChordSpan[]> = {};
  for (const c of chordTimeline) (spansBySec[c.sectionId] ??= []).push(c);
  for (const k in spansBySec) spansBySec[k].sort((a, b) => (a.startBeat as number) - (b.startBeat as number));
  // 按 repeatGroup 分组(保持段序)
  const groups: Record<string, ArrangementPlan['sections'][number][]> = {};
  for (const s of arrangement.sections) { if (!s.repeatGroup) continue; (groups[s.repeatGroup] ??= []).push(s); }

  const out: ReplaySpan[] = [];
  for (const g of Object.keys(groups)) {
    const secs = groups[g];
    if (secs.length < 2) continue;
    const src = secs[0];
    const srcSpans = spansBySec[src.id] ?? [];
    const srcStartBeat = startBeatById[src.id];
    for (let i = 1; i < secs.length; i++) {
      const tgt = secs[i];
      if (tgt.bars !== src.bars) continue; // 仅同 bars 段重放(formPlanner 保证同 group 同 bars)
      const tgtSpans = spansBySec[tgt.id] ?? [];
      const tgtStartBeat = startBeatById[tgt.id];
      // 发散点:逐 span 比【相对起拍 + 和弦身份】;首个不同 → divergeRel
      let divergeRel = tgt.bars * bpb; // 默认全段一致 → 整段重放
      const n = Math.max(srcSpans.length, tgtSpans.length);
      for (let k = 0; k < n; k++) {
        const sc = srcSpans[k], tc = tgtSpans[k];
        if (!sc || !tc) { // span 数不同 → 在缺失处发散
          divergeRel = sc ? (sc.startBeat as number) - srcStartBeat : (tc!.startBeat as number) - tgtStartBeat;
          break;
        }
        const sRel = (sc.startBeat as number) - srcStartBeat, tRel = (tc.startBeat as number) - tgtStartBeat;
        if (Math.abs(sRel - tRel) > 1e-6 || chordKey(sc) !== chordKey(tc)) { divergeRel = Math.min(sRel, tRel); break; }
      }
      if (divergeRel <= 0) continue; // 首和弦即不同(repeatGroup 不应发生)→ 不重放
      const sourceStartTick = timebase.beatToTick(beats(srcStartBeat)) as number;
      const targetStartTick = timebase.beatToTick(beats(tgtStartBeat)) as number;
      const prefixTicks = (timebase.beatToTick(beats(srcStartBeat + divergeRel)) as number) - sourceStartTick;
      if (prefixTicks <= 0) continue;
      out.push({ group: g, sourceId: src.id, targetId: tgt.id, sourceStartTick, targetStartTick, prefixTicks });
    }
  }
  return out;
}

/**
 * 应用 repeatGroup 重放:每条轨,后续段【前缀(body)】= 首段对应音符 time-shift 复制;【尾巴(link)】保留。
 *   无重放计划 → 原样返回。确定性、深不可变。
 */
export function applyRepeatGroupReplay(
  tracks: readonly TrackIR[],
  arrangement: ArrangementPlan,
  chordTimeline: readonly ChordSpan[],
  timebase: Timebase,
): TrackIR[] {
  const plans = planRepeatGroupReplays(arrangement, chordTimeline, timebase);
  if (plans.length === 0) return tracks.map((t) => t);

  const inTargetPrefix = (tick: number): boolean =>
    plans.some((p) => tick >= p.targetStartTick && tick < p.targetStartTick + p.prefixTicks);

  return tracks.map((t) => {
    // 1) 删除落在任一目标前缀的音符(将被源拷贝替代)
    const kept = t.notes.filter((n) => !inTargetPrefix(n.startTick as number));
    // 2) 把【源前缀】音符 time-shift 复制到对应目标(读原始 t.notes;源段永不是目标 → 不双源)
    const added: NoteIR[] = [];
    for (const p of plans) {
      const shift = p.targetStartTick - p.sourceStartTick;
      for (const n of t.notes) {
        const st = n.startTick as number;
        if (st >= p.sourceStartTick && st < p.sourceStartTick + p.prefixTicks) {
          added.push({ ...n, startTick: ticks(st + shift) });
        }
      }
    }
    if (added.length === 0) return { ...t, notes: kept };
    const merged = [...kept, ...added].sort((a, b) => (a.startTick as number) - (b.startTick as number));
    return { ...t, notes: merged };
  });
}
