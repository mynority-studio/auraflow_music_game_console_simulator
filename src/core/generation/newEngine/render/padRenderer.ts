// ============================================================
// newEngine · render · PadRenderer(独立常驻铺底轨)
// ------------------------------------------------------------
// pad = 独立乐器轨,【全段落】持续铺底(不再与 comp 二选一)。
//   每和弦稳定音持续整段(soft)。active 段(comp 在场)→ 压软,垫在 comp 之下;
//   floating 段(无 comp)→ 更显,由 pad 主导。存在感按 styleProfile.padDensity。
//   旋律自由浮于其上;register [55,79] 与 melody reserve 重叠部分交 resolver 让位。pad→audio ch4。
// ============================================================

import { type Timebase } from '../foundation';
import { pcToMidiInRange } from '../knowledge/pitchPlacement';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

const PAD_LOW = 55;
const PAD_HIGH = 79;

export interface PadOptions {
  padDensity: number;          // styleProfile.padDensity → 整体存在感(0..1)
  activeSectionIds: Set<string>; // comp 在场的段 → pad 压软垫底
}

export function renderPad(plan: HarmonicPlan, timebase: Timebase, opts: PadOptions): TrackIR {
  const notes: NoteIR[] = [];
  const { padDensity, activeSectionIds } = opts;
  for (const span of plan.chordTimeline) {
    // 独立铺底:全段落都出 pad。active 段(comp 之下)压软,floating 段更显。
    const isActive = activeSectionIds.has(span.sectionId);
    const vel = Math.max(1, Math.min(127, Math.round((34 + padDensity * 16) * (isActive ? 0.78 : 1))));
    const startTick = timebase.beatToTick(span.startBeat);
    const durationTicks = timebase.beatToTick(span.durationBeats);
    for (const tonePc of plan.stableToneMap[span.id]) {
      notes.push({ pitch: pcToMidiInRange(tonePc, PAD_LOW, PAD_HIGH), startTick, durationTicks, velocity: vel });
    }
  }
  return { role: 'pad', notes };
}
