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

  return tracks.map((t) => {
    // 1) 删除落在任一目标前缀的音符(将被源拷贝替代)。若旧音从前缀前持续进入前缀，
    //    裁到前缀起点，避免它与重放 body 重叠。
    const kept: NoteIR[] = [];
    for (const n of t.notes) {
      const start = n.startTick as number;
      const originalEnd = start + (n.durationTicks as number);
      if (plans.some((p) => start >= p.targetStartTick && start < p.targetStartTick + p.prefixTicks)) continue;

      const firstEnteredPrefixStart = plans
        .map((p) => p.targetStartTick)
        .filter((targetStart) => start < targetStart && originalEnd > targetStart)
        .sort((a, b) => a - b)[0];
      if (firstEnteredPrefixStart === undefined) {
        kept.push(n);
      } else {
        kept.push({ ...n, durationTicks: ticks(firstEnteredPrefixStart - start) });
      }
    }

    // 2) 把【源前缀】音符 time-shift 复制到对应目标(读原始 t.notes;源段永不是目标 → 不双源)。
    //    起音虽在 body、但尾部跨进 link 的音，必须裁在 prefix end，不能把源和声拖进目标发散尾巴。
    const added: NoteIR[] = [];
    for (const p of plans) {
      const shift = p.targetStartTick - p.sourceStartTick;
      const sourceEnd = p.sourceStartTick + p.prefixTicks;
      for (const n of t.notes) {
        const st = n.startTick as number;
        if (st < p.sourceStartTick || st >= sourceEnd) continue;
        const duration = Math.min(n.durationTicks as number, sourceEnd - st);
        if (duration <= 0) continue;
        added.push({ ...n, startTick: ticks(st + shift), durationTicks: ticks(duration) });
      }
    }
    if (added.length === 0) return { ...t, notes: kept };
    const merged = [...kept, ...added].sort((a, b) => (a.startTick as number) - (b.startTick as number));
    return { ...t, notes: merged };
  });
}

// ACG PIANOSONG 不复制整段三轨：只让 lead 的同一主题句复现，并留下目标句最后一小节作为 A′ 的回答。
// 这样 motifBindings 从“编排记录”变成真实的渲染约束，bass/comp 仍可随段落成长。
export interface MotifBindingReplay {
  motifId: string;
  sourcePhraseId: string;
  targetPhraseId: string;
  sourceStartTick: number;
  targetStartTick: number;
  prefixTicks: number;
}

interface PhraseOccurrence {
  motifId: string;
  phraseId: string;
  repeatGroup: string;
  startBeat: number;
  bars: number;
  startTick: number;
}

function chordPrefixFingerprint(timeline: readonly ChordSpan[], startBeat: number, lengthBeats: number): string {
  const endBeat = startBeat + lengthBeats;
  return timeline
    .map((span) => {
      const start = span.startBeat as number;
      const end = start + (span.durationBeats as number);
      const lo = Math.max(start, startBeat);
      const hi = Math.min(end, endBeat);
      if (hi - lo <= 1e-6) return undefined;
      return [
        Math.round((lo - startBeat) * 1000),
        Math.round((hi - lo) * 1000),
        span.rootPc,
        span.chordType ?? span.quality,
        span.bassRole ?? '',
        span.bassPedalPc ?? '',
      ].join('|');
    })
    .filter((x): x is string => !!x)
    .join(';');
}

/** 找出可安全重放的主题句：同 motif、同 repeatGroup、且保留尾小节前的和声完全一致。 */
export function planMotifBindingReplays(
  arrangement: ArrangementPlan,
  chordTimeline: readonly ChordSpan[],
  timebase: Timebase,
  retainTailBars = 1,
): MotifBindingReplay[] {
  const beatsPerBar = beatsPerBarOf(arrangement.meter);
  const startBeatBySection: Record<string, number> = {};
  let cursor = 0;
  for (const section of arrangement.sections) {
    startBeatBySection[section.id] = cursor;
    cursor += section.bars * beatsPerBar;
  }
  const phraseById = new Map(arrangement.phrases.map((phrase) => [phrase.id, phrase]));
  const seenByMotif = new Map<string, PhraseOccurrence>();
  const out: MotifBindingReplay[] = [];

  for (const binding of arrangement.motifBindings) {
    const phrase = phraseById.get(binding.phraseId);
    if (!phrase || phrase.skeletonRole !== 'hook' || !binding.repeatGroup || binding.requestedRestatementStrength < 0.5) continue;
    const startBeat = (startBeatBySection[phrase.sectionId] ?? 0) + phrase.phraseSlot * phrase.bars * beatsPerBar;
    const occurrence: PhraseOccurrence = {
      motifId: binding.motifId,
      phraseId: phrase.id,
      repeatGroup: binding.repeatGroup,
      startBeat,
      bars: phrase.bars,
      startTick: timebase.beatToTick(beats(startBeat)) as number,
    };
    const source = seenByMotif.get(binding.motifId);
    if (!source) {
      seenByMotif.set(binding.motifId, occurrence);
      continue;
    }
    if (source.repeatGroup !== occurrence.repeatGroup || source.bars !== occurrence.bars) continue;
    const replayBars = Math.max(0, occurrence.bars - retainTailBars);
    const replayBeats = replayBars * beatsPerBar;
    const prefixTicks = timebase.beatToTick(beats(replayBeats)) as number;
    if (prefixTicks <= 0) continue;
    if (chordPrefixFingerprint(chordTimeline, source.startBeat, replayBeats) !== chordPrefixFingerprint(chordTimeline, occurrence.startBeat, replayBeats)) continue;
    out.push({
      motifId: binding.motifId,
      sourcePhraseId: source.phraseId,
      targetPhraseId: occurrence.phraseId,
      sourceStartTick: source.startTick,
      targetStartTick: occurrence.startTick,
      prefixTicks,
    });
  }
  return out;
}

/** ACG 专用主题复现：lead 的主题 body 重放，目标句尾小节保持生成结果，形成克制的 A/A′。 */
export function applyMotifBindingReplay(
  tracks: readonly TrackIR[],
  arrangement: ArrangementPlan,
  chordTimeline: readonly ChordSpan[],
  timebase: Timebase,
): TrackIR[] {
  const plans = planMotifBindingReplays(arrangement, chordTimeline, timebase);
  if (plans.length === 0) return tracks.map((track) => track);

  return tracks.map((track) => {
    if (track.role !== 'lead') return track;
    let notes = [...track.notes];
    for (const plan of plans) {
      const sourceEnd = plan.sourceStartTick + plan.prefixTicks;
      const targetEnd = plan.targetStartTick + plan.prefixTicks;
      const shift = plan.targetStartTick - plan.sourceStartTick;
      const retained: NoteIR[] = [];
      for (const note of notes) {
        const start = note.startTick as number;
        const end = start + (note.durationTicks as number);
        if (start >= plan.targetStartTick && start < targetEnd) continue;
        if (start < plan.targetStartTick && end > plan.targetStartTick) {
          retained.push({ ...note, durationTicks: ticks(plan.targetStartTick - start) });
        } else {
          retained.push(note);
        }
      }
      const copied = notes.flatMap((note): NoteIR[] => {
        const start = note.startTick as number;
        if (start < plan.sourceStartTick || start >= sourceEnd) return [];
        const duration = Math.min(note.durationTicks as number, sourceEnd - start);
        if (duration <= 0) return [];
        return [{ ...note, startTick: ticks(start + shift), durationTicks: ticks(duration) }];
      });
      notes = [...retained, ...copied].sort((a, b) => (a.startTick as number) - (b.startTick as number) || (a.pitch as number) - (b.pitch as number));
    }
    return { ...track, notes };
  });
}
