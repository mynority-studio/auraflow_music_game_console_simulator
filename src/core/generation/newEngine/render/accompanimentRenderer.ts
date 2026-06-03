// ============================================================
// newEngine · render · AccompanimentRenderer(Slice 0 最小实现)
// ------------------------------------------------------------
// 架构定稿 Part 8.2 / 3.6:伴奏先生成。Slice 0 不含让位/voicing 阶梯(无 Motif 锚点),
// 只产基础织体:bass = 每和弦根音;comp = 每和弦稳定音块。pc-correct 配置在低/中音区。
// 后续 slice 接 MelodyAnchorPlan 后再加让位分流 + voicing 支撑阶梯。
// ============================================================

import { midi, type Beats, type Timebase } from '../foundation';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

const BASS_BASE = 36; // C2:bass 根音区 36..47
const COMP_BASE = 48; // C3:comp 块和弦区 48..59

export function renderAccompaniment(plan: HarmonicPlan, timebase: Timebase): TrackIR[] {
  const bassNotes: NoteIR[] = [];
  const compNotes: NoteIR[] = [];

  for (const span of plan.chordTimeline) {
    const startTick = timebase.beatToTick(span.startBeat as Beats);
    const durationTicks = timebase.beatToTick(span.durationBeats as Beats);

    // bass:根音
    bassNotes.push({
      pitch: midi(BASS_BASE + span.rootPc),
      startTick,
      durationTicks,
      velocity: 90,
    });

    // comp:稳定音(和弦音)块
    for (const tonePc of plan.stableToneMap[span.id]) {
      compNotes.push({
        pitch: midi(COMP_BASE + tonePc),
        startTick,
        durationTicks,
        velocity: 70,
      });
    }
  }

  return [
    { role: 'bass', notes: bassNotes },
    { role: 'comp', notes: compNotes },
  ];
}
