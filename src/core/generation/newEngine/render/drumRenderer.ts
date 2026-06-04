// ============================================================
// newEngine · render · DrumRenderer(Slice 1.5 基础律动)
// ------------------------------------------------------------
// 基础 GM 鼓组律动:kick 拍1/3、snare 拍2/4、closed-hat 八分。给曲子节奏生命。
// drum 是打击通道(audio 映射到 ch9),不入和声判据:Auditor / OccupationMap 跳过它。
// ============================================================

import { beats, midi, type Timebase } from '../foundation';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

const KICK = 36;
const SNARE = 38;
const HAT = 42;

export function renderDrums(plan: HarmonicPlan, timebase: Timebase, beatsPerBar: number): TrackIR {
  const notes: NoteIR[] = [];

  let totalBeats = 0;
  for (const span of plan.chordTimeline) {
    totalBeats = Math.max(totalBeats, span.startBeat + span.durationBeats);
  }
  const bars = Math.max(1, Math.round(totalBeats / beatsPerBar));

  const hit = (pitch: number, beat: number, vel: number, dur = 0.25) => {
    notes.push({
      pitch: midi(pitch),
      startTick: timebase.beatToTick(beats(beat)),
      durationTicks: timebase.beatToTick(beats(dur)),
      velocity: vel,
    });
  };

  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * beatsPerBar;
    hit(KICK, b0 + 0, 112);
    if (beatsPerBar > 2) hit(KICK, b0 + 2, 100);
    hit(SNARE, b0 + 1, 96);
    if (beatsPerBar > 3) hit(SNARE, b0 + 3, 96);
    for (let h = 0; h < Math.floor(beatsPerBar * 2); h++) {
      hit(HAT, b0 + h * 0.5, h % 2 === 0 ? 72 : 54);
    }
  }

  return { role: 'drum', notes };
}
