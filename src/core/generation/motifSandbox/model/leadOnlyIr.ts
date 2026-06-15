// ============================================================
// motifSandbox · model · MusicalIR(试听用)
// ------------------------------------------------------------
// MotifNote[](lead)+ 可选伴奏(comp/bass)→ MusicalIR。复用 newEngine 的中立类型/Timebase,
//   但不进生产链。试听音色【暖】(用户决策:不要 GM80;pop=GM4 电钢优先)。
// ============================================================

import { createTimebase, midi, beats, type Timebase, type Ticks } from '../../newEngine/foundation';
import { freezeMusicalIR, type MusicalIR, type NoteIR, type TrackMix } from '../../newEngine/ir/MusicalIR';
import type { MotifNote, SandboxStyle } from './types';
import type { Accompaniment } from './accompaniment';

// 用户决策:暖音色,方便判断旋律关系。pop=GM4(电钢 Rhodes),lofi=GM4,rnb=GM4,jazz=GM0(钢琴)。
export const LEAD_PROGRAM_BY_STYLE: Record<SandboxStyle, number> = {
  pop: 4, lofi: 4, rnb: 4, jazz: 0,
};
/** pop 可选钢琴。 */
export const POP_PIANO_PROGRAM = 0;

interface PlayNote { midi: number; onsetBeat: number; durationBeat: number; velocity: number; }

const clampVel = (v: number): number => Math.max(1, Math.min(127, Math.round(v * 127)));

/** 暖 lead 混音(电钢带一点 chorus + 中等空间)。 */
function leadMix(program: number): TrackMix {
  const ep = program === 4 || program === 5;
  return { volume: 96, pan: 64, reverb: 40, chorus: ep ? 48 : 12 };
}

/** PlayNote[] → NoteIR[](onset 排序 + 裁到曲尾;仅同音高重叠时截短,避免 noteOff 撞掉重复音)。 */
function toNoteIR(notes: readonly PlayNote[], timebase: Timebase, totalBeats: number, defaultVel: number): NoteIR[] {
  const src = [...notes].sort((a, b) => a.onsetBeat - b.onsetBeat).filter((n) => n.durationBeat > 0 && n.onsetBeat < totalBeats);
  return src.map((n, i) => {
    const p = Math.round(n.midi);
    let durBeat = Math.min(n.durationBeat, totalBeats - n.onsetBeat);
    for (let j = i + 1; j < src.length; j++) {
      if (src[j].onsetBeat >= n.onsetBeat + durBeat) break;
      if (Math.round(src[j].midi) === p) { durBeat = Math.max(0.03, src[j].onsetBeat - n.onsetBeat - 0.01); break; }
    }
    return {
      pitch: midi(p),
      startTick: timebase.beatToTick(beats(n.onsetBeat)),
      durationTicks: timebase.beatToTick(beats(durBeat)),
      velocity: clampVel(n.velocity || defaultVel),
    };
  });
}

function spanOf(...groups: ReadonlyArray<readonly PlayNote[]>): number {
  let span = 4;
  for (const g of groups) for (const n of g) span = Math.max(span, n.onsetBeat + n.durationBeat);
  return Math.max(4, Math.ceil(span / 4) * 4); // 补到整 bar
}

function timebaseOf(bpm: number): Timebase {
  return createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: beats(0), bpm }] });
}

/** 每小节一脚【延音踏板】(微微):小节头踩下、下一小节前略抬 → 音尾 ring、换小节干净不糊。 */
function barPedal(timebase: Timebase, totalBeats: number): { atTick: Ticks; down: boolean }[] {
  const out: { atTick: Ticks; down: boolean }[] = [];
  const bars = Math.max(1, Math.round(totalBeats / 4));
  for (let b = 0; b < bars; b++) {
    out.push({ atTick: timebase.beatToTick(beats(b * 4)), down: true });
    out.push({ atTick: timebase.beatToTick(beats((b + 1) * 4 - 0.12)), down: false }); // 略早抬起 = 换小节干净
  }
  return out;
}

export function buildLeadOnlyIr(lead: readonly MotifNote[], bpm: number, style: SandboxStyle, program?: number): MusicalIR {
  const timebase = timebaseOf(bpm);
  const prog = program ?? LEAD_PROGRAM_BY_STYLE[style];
  const totalBeats = spanOf(lead);
  return freezeMusicalIR({
    tracks: [{ role: 'lead', notes: toNoteIR(lead, timebase, totalBeats, 0.78), program: prog, mix: leadMix(prog) }], // lead 不踩踏板 = 旋律发音清晰、稳稳对拍
    timebase,
    durationTicks: timebase.beatToTick(beats(totalBeats)),
  });
}

/** lead + 伴奏织体(comp/bass)多轨 IR。伴奏让位 lead(comp 中等音量、bass 干声居中)。 */
export function buildSandboxIr(lead: readonly MotifNote[], accomp: Accompaniment | null, bpm: number, style: SandboxStyle, program?: number): MusicalIR {
  if (!accomp) return buildLeadOnlyIr(lead, bpm, style, program);
  const timebase = timebaseOf(bpm);
  const leadProg = program ?? LEAD_PROGRAM_BY_STYLE[style];
  const totalBeats = spanOf(lead, accomp.comp, accomp.bass);
  const ep = accomp.compProgram === 4 || accomp.compProgram === 5;
  const compMix: TrackMix = { volume: 70, pan: 54, reverb: 52, chorus: ep ? 36 : 14 };
  const bassMix: TrackMix = { volume: 86, pan: 64, reverb: 12, chorus: 0 };
  return freezeMusicalIR({
    tracks: [
      { role: 'lead', notes: toNoteIR(lead, timebase, totalBeats, 0.78), program: leadProg, mix: leadMix(leadProg) }, // lead 不踩 → 旋律清晰对拍(踏板会糊成一片听着"飘")
      { role: 'comp', notes: toNoteIR(accomp.comp, timebase, totalBeats, 0.46), program: accomp.compProgram, mix: compMix, pedalEvents: barPedal(timebase, totalBeats) }, // 只 comp 踩 → 和声铺底 ring
      { role: 'bass', notes: toNoteIR(accomp.bass, timebase, totalBeats, 0.6), program: accomp.bassProgram, mix: bassMix }, // bass 不踩 → 保清晰发音
    ],
    timebase,
    durationTicks: timebase.beatToTick(beats(totalBeats)),
  });
}
