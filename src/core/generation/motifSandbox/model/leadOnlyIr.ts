// ============================================================
// motifSandbox · model · lead-only MusicalIR(试听用)
// ------------------------------------------------------------
// MotifNote[] → MusicalIR(单 lead 轨)。复用 newEngine 的中立类型/Timebase,
//   但不进生产链。试听音色【暖】(用户决策:不要 GM80;pop=GM4 电钢优先)。
// ============================================================

import { createTimebase, midi, beats } from '../../newEngine/foundation';
import { freezeMusicalIR, type MusicalIR, type NoteIR, type TrackMix } from '../../newEngine/ir/MusicalIR';
import type { MotifNote, SandboxStyle } from './types';

// 用户决策:暖音色,方便判断旋律关系。pop=GM4(电钢 Rhodes),lofi=GM4,rnb=GM4,jazz=GM0(钢琴)。
export const LEAD_PROGRAM_BY_STYLE: Record<SandboxStyle, number> = {
  pop: 4, lofi: 4, rnb: 4, jazz: 0,
};
/** pop 可选钢琴。 */
export const POP_PIANO_PROGRAM = 0;

const TOTAL_BEATS = 64;
const clampVel = (v: number): number => Math.max(1, Math.min(127, Math.round(v * 127)));

/** 暖 lead 混音(电钢带一点 chorus + 中等空间)。 */
function leadMix(program: number): TrackMix {
  const ep = program === 4 || program === 5;
  return { volume: 96, pan: 64, reverb: 40, chorus: ep ? 48 : 12 };
}

export function buildLeadOnlyIr(lead: readonly MotifNote[], bpm: number, style: SandboxStyle, program?: number): MusicalIR {
  const timebase = createTimebase({
    meter: { numerator: 4, denominator: 4 },
    tempoMap: [{ atBeat: beats(0), bpm }],
  });
  const prog = program ?? LEAD_PROGRAM_BY_STYLE[style];
  const notes: NoteIR[] = [...lead]
    .sort((a, b) => a.onsetBeat - b.onsetBeat)
    .filter((n) => n.durationBeat > 0 && n.onsetBeat < TOTAL_BEATS)
    .map((n) => ({
      pitch: midi(Math.round(n.midi)),
      startTick: timebase.beatToTick(beats(n.onsetBeat)),
      durationTicks: timebase.beatToTick(beats(Math.min(n.durationBeat, TOTAL_BEATS - n.onsetBeat))),
      velocity: clampVel(n.velocity || 0.78),
    }));
  return freezeMusicalIR({
    tracks: [{ role: 'lead', notes, program: prog, mix: leadMix(prog) }],
    timebase,
    durationTicks: timebase.beatToTick(beats(TOTAL_BEATS)),
  });
}
