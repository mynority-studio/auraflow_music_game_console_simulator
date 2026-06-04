// ============================================================
// newEngine · render · PadRenderer
// ------------------------------------------------------------
// 架构定稿 Part 8.2 / 铁律16:floating 织体段(pad/sustained-block)出长音铺底。
// 每和弦稳定音持续整段(soft),不让位(旋律自由浮于其上)。pad→audio ch4。
// 只在 floating 段(active 段交给 comp)→ 织体分流不重叠。
// ============================================================

import { type Timebase } from '../foundation';
import { pcToMidiInRange } from '../knowledge/pitchPlacement';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

const PAD_LOW = 55;
const PAD_HIGH = 79;

export function renderPad(
  plan: HarmonicPlan,
  timebase: Timebase,
  floatingSectionIds: Set<string>,
): TrackIR {
  const notes: NoteIR[] = [];
  for (const span of plan.chordTimeline) {
    if (!floatingSectionIds.has(span.sectionId)) continue;
    const startTick = timebase.beatToTick(span.startBeat);
    const durationTicks = timebase.beatToTick(span.durationBeats);
    for (const tonePc of plan.stableToneMap[span.id]) {
      notes.push({
        pitch: pcToMidiInRange(tonePc, PAD_LOW, PAD_HIGH),
        startTick,
        durationTicks,
        velocity: 42,
      });
    }
  }
  return { role: 'pad', notes };
}
