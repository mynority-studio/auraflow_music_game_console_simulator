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
import { chordToneIntervals, type ChordQuality } from '../knowledge/chords';
import { buildWidePianoVoicing, isPianoProgram, type VoiceRole, type WidePianoVoicing } from '../knowledge/widePianoVoicings';
import type { ChordSpan, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

export interface AccompContext {
  style?: string;
  anchorBeats?: Set<number>;      // 主 hook 锚点拍位(active 段在此瘦身让位)
  activeSectionIds?: Set<string>; // active 织体段
  voicingSaferSpans?: Set<string>; // 撞音阶梯 rung1:这些 span 强制瘦身 3+7 shell
  compProgram?: number;            // ★ comp 实际乐器 GM program:钢琴家族 → 宽排列,否则通用 voiceComp
}

// 把窄 ChordQuality 的【真实和弦音】映射到 wide-voicing 角色(只 root/3/5/7,不加色彩)。
// 不走 getChordRolePcs(它对窄三和弦会幻觉七音)。dim7 的 bb7(9)归为 seventh。
function qualityRolePcs(rootPc: number, quality: ChordQuality): Partial<Record<VoiceRole, number>> {
  const out: Partial<Record<VoiceRole, number>> = {};
  for (const iv of chordToneIntervals(quality)) {
    const p = mod12(rootPc + iv);
    if (iv === 0) out.root = p;
    else if (iv === 3 || iv === 4) out.third = p;
    else if (iv === 6 || iv === 7 || iv === 8) out.fifth = p;
    else if (iv === 9 || iv === 10 || iv === 11) out.seventh = p;
  }
  return out;
}

// bass 区(36-47)的 root midi —— 仅供 wide voicing 的 sanitize/drop2 安全判据用。
function nominalBassMidi(rootPc: number): number {
  for (let m = 36; m <= 47; m++) if (mod12(m) === rootPc) return m;
  return 36 + rootPc;
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

  // 伴奏乐器是钢琴(GM 0/1/2)→ 调钢琴宽排列;否则 → 通用 voiceComp(见 feedback)。
  const usePiano = isPianoProgram(ctx.compProgram);
  const includeRootInComp = !/jazz/i.test(style); // jazz:rootless(bass 兜 root),其它含 root

  // 预算 per-span voicing(全声部 voice-leading 链)+ 让位 shell voicing
  const voicedBySpan: Record<string, number[]> = {};
  const shellBySpan: Record<string, number[]> = {};
  let prevTop: number | undefined;
  let prevVoicing: number[] | undefined; // 上一组完整 voicing → 全声部贴最近(声部进行)
  let prevWide: WidePianoVoicing | undefined; // 钢琴宽排列的前一组锚点(共同音保留)
  for (const span of plan.chordTimeline) {
    if (!inActive(span.sectionId)) continue;
    // comp = 内层骨干/导音(中声部);上层色彩音 9/13 是旋律的领地,有旋律时让渡给旋律,comp 不加色
    //   (折成 2 音会与 root/3 产生声学摩擦 —— 见 feedback;色彩走旋律/宽和弦,不走 comp)
    if (usePiano) {
      // ★ 只宽铺开和弦真实音(root/3/5/7),colorLevel 0 不加 9/13(色彩仍归旋律,守铁律)
      const rolePcs = qualityRolePcs(span.rootPc, span.quality);
      const bassMidi = nominalBassMidi(span.rootPc);
      const wideOpts = { includeRootInComp, colorLevel: 0 as const, style };
      const wide = buildWidePianoVoicing({ rootPc: span.rootPc, chordType: span.quality, bassMidi, options: { ...wideOpts, spreadMode: 'wide' }, prev: prevWide, rolePcs });
      voicedBySpan[span.id] = wide.attackMidi;
      // 让位/瘦身 = close 紧排(从 inner 起,不放外声部),仍是真实和弦音
      const shellWide = buildWidePianoVoicing({ rootPc: span.rootPc, chordType: span.quality, bassMidi, options: { ...wideOpts, spreadMode: 'close' }, prev: prevWide, rolePcs });
      shellBySpan[span.id] = shellWide.attackMidi;
      prevWide = wide;
    } else {
      const full = voiceComp([...plan.stableToneMap[span.id]], style, prevTop, prevVoicing);
      voicedBySpan[span.id] = full;
      const shellPcs = guideToneShell(span.quality).map((iv) => mod12(span.rootPc + iv));
      shellBySpan[span.id] = voiceComp(shellPcs, style, prevTop, prevVoicing);
      if (full.length) { prevTop = full[full.length - 1]; prevVoicing = full; }
    }
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
