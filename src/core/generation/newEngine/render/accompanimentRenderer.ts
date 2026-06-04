// ============================================================
// newEngine · render · AccompanimentRenderer
// ------------------------------------------------------------
// 架构定稿 Part 8.2 / 3.6 / 铁律5,16:伴奏先生成,但 melody-aware。
// bass = 每和弦根音(walking 见 task 1.2);comp = 按 per-style comping 节奏型落 hit(有律动/切分)。
// 让位按织体分流:active 段在主 hook 锚点拍把该和弦 comp 瘦身成 3+7 shell;floating 段不让位。
// ============================================================

import { beats, midi, mod12, type Beats, type Timebase } from '../foundation';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { compPattern } from '../knowledge/grooves';
import { guideToneShell } from '../knowledge/voicings';
import type { ChordSpan, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

const BASS_BASE = 36; // C2:bass 根音区
const COMP_BASE = 48; // C3:comp 块和弦区

export interface AccompContext {
  style?: string;
  anchorBeats?: Set<number>;      // 主 hook 锚点拍位(active 段在此瘦身让位)
  activeSectionIds?: Set<string>; // active 织体段
}

function spanAtBeat(plan: HarmonicPlan, beat: number): ChordSpan | undefined {
  return plan.chordTimeline.find((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats);
}

export function renderAccompaniment(
  plan: HarmonicPlan,
  timebase: Timebase,
  ctx: AccompContext = {},
): TrackIR[] {
  const bassNotes: NoteIR[] = [];
  const compNotes: NoteIR[] = [];
  const beatsPerBar = beatsPerBarOf(timebase.meter);
  const pattern = compPattern(ctx.style ?? 'default');

  let totalBeats = 0;
  for (const span of plan.chordTimeline) {
    totalBeats = Math.max(totalBeats, span.startBeat + span.durationBeats);
    bassNotes.push({
      pitch: midi(BASS_BASE + span.rootPc),
      startTick: timebase.beatToTick(span.startBeat as Beats),
      durationTicks: timebase.beatToTick(span.durationBeats as Beats),
      velocity: 90,
    });
  }

  const bars = Math.ceil(totalBeats / beatsPerBar);
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * beatsPerBar;
    for (const hit of pattern) {
      const beat = barStart + hit.beat;
      if (beat >= totalBeats) continue;
      const span = spanAtBeat(plan, beat);
      if (!span) continue;

      const yieldHere =
        !!ctx.activeSectionIds?.has(span.sectionId) && !!ctx.anchorBeats?.has(span.startBeat);
      const tonePcs = yieldHere
        ? guideToneShell(span.quality).map((iv) => mod12(span.rootPc + iv)) // 瘦身成 3+7 shell
        : plan.stableToneMap[span.id];

      const startTick = timebase.beatToTick(beats(beat));
      const durationTicks = timebase.beatToTick(beats(hit.dur));
      for (const tonePc of tonePcs) {
        compNotes.push({ pitch: midi(COMP_BASE + tonePc), startTick, durationTicks, velocity: hit.vel });
      }
    }
  }

  return [
    { role: 'bass', notes: bassNotes },
    { role: 'comp', notes: compNotes },
  ];
}
