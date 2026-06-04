// ============================================================
// newEngine · render · CompingRenderer(comp 织体)
// ------------------------------------------------------------
// 架构定稿 Part 8.2 / 3.6 / 铁律5,16:comp 按 per-style comping 节奏型落 hit(有律动/切分),
// 用真 voicing(jazz rootless / spread,顶音 voice-leading)取代 48+pc 簇。
// 让位:active 段在主 hook 锚点拍把该和弦 comp 瘦身成 3+7 shell;floating 段交给 pad。
// ============================================================

import { beats, midi, mod12, type Timebase } from '../foundation';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { compPattern } from '../knowledge/grooves';
import { guideToneShell, voiceComp } from '../knowledge/voicings';
import { pickColorTones } from '../knowledge/chordIntervalRoles';
import type { ChordSpan, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

export interface AccompContext {
  style?: string;
  anchorBeats?: Set<number>;      // 主 hook 锚点拍位(active 段在此瘦身让位)
  activeSectionIds?: Set<string>; // active 织体段
  voicingSaferSpans?: Set<string>; // 撞音阶梯 rung1:这些 span 强制瘦身 3+7 shell
  colorCount?: number;            // ★ 给 comp 加几个可用张力(9/13)出彩色 voicing(0=纯骨干)
}

function spanAtBeat(plan: HarmonicPlan, beat: number): ChordSpan | undefined {
  return plan.chordTimeline.find((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats);
}

export function renderAccompaniment(
  plan: HarmonicPlan,
  timebase: Timebase,
  ctx: AccompContext = {},
): TrackIR[] {
  const compNotes: NoteIR[] = [];
  const beatsPerBar = beatsPerBarOf(timebase.meter);
  const pattern = compPattern(ctx.style ?? 'default');
  const style = ctx.style ?? 'default';
  const inActive = (sid: string) => !ctx.activeSectionIds || ctx.activeSectionIds.has(sid);

  let totalBeats = 0;
  for (const span of plan.chordTimeline) {
    totalBeats = Math.max(totalBeats, span.startBeat + span.durationBeats);
  }

  // 预算 per-span voicing(全声部 voice-leading 链)+ 让位 shell voicing
  const voicedBySpan: Record<string, number[]> = {};
  const shellBySpan: Record<string, number[]> = {};
  let prevTop: number | undefined;
  let prevVoicing: number[] | undefined; // 上一组完整 voicing → 全声部贴最近(声部进行)
  for (const span of plan.chordTimeline) {
    if (!inActive(span.sectionId)) continue;
    // ★ 彩色 voicing:骨干音 + 按预算从 colorToneMap 挑【可用张力】(参考 chordIntervalRoles 判角色/排序)
    const colorPcs = pickColorTones(span.quality, span.rootPc, plan.colorToneMap[span.id] ?? [], ctx.colorCount ?? 0);
    const full = voiceComp([...plan.stableToneMap[span.id], ...colorPcs], style, prevTop, prevVoicing);
    voicedBySpan[span.id] = full;
    const shellPcs = guideToneShell(span.quality).map((iv) => mod12(span.rootPc + iv));
    shellBySpan[span.id] = voiceComp(shellPcs, style, prevTop, prevVoicing);
    if (full.length) { prevTop = full[full.length - 1]; prevVoicing = full; }
  }

  const bars = Math.ceil(totalBeats / beatsPerBar);
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * beatsPerBar;
    for (const hit of pattern) {
      const beat = barStart + hit.beat;
      if (beat >= totalBeats) continue;
      const span = spanAtBeat(plan, beat);
      if (!span || !inActive(span.sectionId)) continue;

      const yieldHere = !!ctx.anchorBeats?.has(span.startBeat) && !!ctx.activeSectionIds?.has(span.sectionId);
      const thin = yieldHere || !!ctx.voicingSaferSpans?.has(span.id); // 让位 或 撞音阶梯瘦身
      const voiced = thin ? shellBySpan[span.id] : voicedBySpan[span.id];

      const startTick = timebase.beatToTick(beats(beat));
      const durationTicks = timebase.beatToTick(beats(hit.dur));
      for (const m of voiced) {
        compNotes.push({ pitch: midi(m), startTick, durationTicks, velocity: hit.vel });
      }
    }
  }

  return [{ role: 'comp', notes: compNotes }];
}
