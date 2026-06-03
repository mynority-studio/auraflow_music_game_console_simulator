// ============================================================
// newEngine · render · AccompanimentRenderer
// ------------------------------------------------------------
// 架构定稿 Part 8.2 / 3.6 / 铁律5,16:伴奏先生成,但 melody-aware。
// bass = 每和弦根音;comp = 每和弦稳定音块(pc-correct,低/中音区)。
// 让位按织体分流:active 织体段在【主 hook 锚点拍】把 comp 瘦身成 3+7 guide-tone shell
// (暴露 hook head);floating(pad/柱式)段不让位。
// ============================================================

import { midi, mod12, type Beats, type Timebase } from '../foundation';
import { guideToneShell } from '../knowledge/voicings';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

const BASS_BASE = 36; // C2:bass 根音区 36..47
const COMP_BASE = 48; // C3:comp 块和弦区 48..59

export interface YieldContext {
  anchorBeats: Set<number>;      // 主 hook 锚点拍位(active 段在此瘦身让位)
  activeSectionIds: Set<string>; // active 织体段(comp 让位)
}

export function renderAccompaniment(
  plan: HarmonicPlan,
  timebase: Timebase,
  yieldCtx?: YieldContext,
): TrackIR[] {
  const bassNotes: NoteIR[] = [];
  const compNotes: NoteIR[] = [];

  for (const span of plan.chordTimeline) {
    const startTick = timebase.beatToTick(span.startBeat as Beats);
    const durationTicks = timebase.beatToTick(span.durationBeats as Beats);

    bassNotes.push({ pitch: midi(BASS_BASE + span.rootPc), startTick, durationTicks, velocity: 90 });

    const yieldHere =
      !!yieldCtx &&
      yieldCtx.activeSectionIds.has(span.sectionId) &&
      yieldCtx.anchorBeats.has(span.startBeat);

    const tonePcs = yieldHere
      ? guideToneShell(span.quality).map((iv) => mod12(span.rootPc + iv)) // 瘦身成 3+7 shell
      : plan.stableToneMap[span.id];

    for (const tonePc of tonePcs) {
      compNotes.push({ pitch: midi(COMP_BASE + tonePc), startTick, durationTicks, velocity: 70 });
    }
  }

  return [
    { role: 'bass', notes: bassNotes },
    { role: 'comp', notes: compNotes },
  ];
}
