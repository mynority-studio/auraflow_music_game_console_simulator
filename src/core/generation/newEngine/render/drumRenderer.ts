// ============================================================
// newEngine · render · DrumRenderer
// ------------------------------------------------------------
// per-style groove(pop backbeat / lofi 半拍 / jazz swing ride)+ 力度人性化(确定性抖动,
// 逐小节不同)+ 段落转折 fill。drum 是打击通道(audio→ch9),不入和声判据。
// 无 rng:抖动用 (bar,hit) 确定性派生 → 保确定性。
// ============================================================

import { beats, midi, type Timebase } from '../foundation';
import { DRUM, drumPattern } from '../knowledge/grooves';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

export interface DrumOptions {
  style?: string;
  fillBars?: Set<number>; // 该小节末尾加 fill(段落转折)
}

function clampVel(v: number): number {
  return Math.max(1, Math.min(127, Math.round(v)));
}

export function renderDrums(
  plan: HarmonicPlan,
  timebase: Timebase,
  beatsPerBar: number,
  opts: DrumOptions = {},
): TrackIR {
  const pattern = drumPattern(opts.style ?? 'default');
  const fillBars = opts.fillBars ?? new Set<number>();
  const notes: NoteIR[] = [];

  let totalBeats = 0;
  for (const span of plan.chordTimeline) {
    totalBeats = Math.max(totalBeats, span.startBeat + span.durationBeats);
  }
  const bars = Math.max(1, Math.round(totalBeats / beatsPerBar));

  const push = (drum: number, beat: number, vel: number, dur = 0.25) => {
    notes.push({
      pitch: midi(drum),
      startTick: timebase.beatToTick(beats(beat)),
      durationTicks: timebase.beatToTick(beats(dur)),
      velocity: clampVel(vel),
    });
  };

  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * beatsPerBar;
    pattern.forEach((hit, idx) => {
      // 确定性人性化:逐小节/逐 hit 的 ±3 力度抖动(无 rng)
      const jitter = (((bar * 31 + idx * 17) % 7) - 3);
      push(hit.drum, b0 + hit.beat, hit.vel + jitter);
    });
    if (fillBars.has(bar)) {
      // 段落转折 fill:末拍 16 分 snare roll
      push(DRUM.SNARE, b0 + beatsPerBar - 1 + 0.5, 92);
      push(DRUM.SNARE, b0 + beatsPerBar - 1 + 0.75, 104);
      push(DRUM.OHAT, b0 + beatsPerBar - 0.5, 80);
    }
  }

  return { role: 'drum', notes };
}
