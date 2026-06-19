// ============================================================
// motifSandbox · model · MusicalIR(试听用)
// ------------------------------------------------------------
// MotifNote[](lead)+ 可选伴奏(comp/bass)→ MusicalIR。复用 newEngine 的中立类型/Timebase,
//   但不进生产链。试听音色【暖】(用户决策:不要 GM80;pop=GM4 电钢优先)。
// ============================================================

import { createTimebase, midi, beats, type Timebase, type Ticks } from '../../newEngine/foundation';
import { freezeMusicalIR, type MusicalIR, type NoteIR, type TrackMix } from '../../newEngine/ir/MusicalIR';
import { connectFastLeadNoteIR, fastLeadLegatoOptionsForStyle } from '../../newEngine/render/leadArticulation';
import { isInProtectedFastRun } from '../../newEngine/render/leadGridTiming';
import type { MotifNote, SandboxStyle } from './types';
import type { Accompaniment } from './accompaniment';

// 用户决策:暖音色,方便判断旋律关系。pop=GM4(电钢 Rhodes),lofi=GM4,rnb=GM4,jazz=GM0(钢琴)。
export const LEAD_PROGRAM_BY_STYLE: Record<SandboxStyle, number> = {
  pop: 4, lofi: 4, rnb: 4, jazz: 0,
};
/** pop 可选钢琴。 */
export const POP_PIANO_PROGRAM = 0;
/** ★ MIDI 录入默认音色 = 大钢琴(GM0 Acoustic Grand)+ 随 CC64 延音踏板。键盘手现场弹更自然。 */
export const MIDI_INPUT_PROGRAM = 0;

interface PlayNote { midi: number; onsetBeat: number; durationBeat: number; velocity: number; }

const clampVel = (v: number): number => Math.max(1, Math.min(127, Math.round(v * 127)));

// ★ 摆动(swing):jazz 把每拍的【第一个八分】拉长占 swingFirst(0.5=直、0.667=三连摆动)。
//   在【播放/吸附层】施加 —— 生成层保持直拍网格(干净排比/对齐),播放时给 jazz 摇摆律动。
//   下拍(整数拍)不动 → 走音 bass 仍踩稳;八分/十六分反拍按拍内连续映射推后 → lead/comp 摇摆。
const JAZZ_SWING_FIRST = 0.62;
const SWING_BY_STYLE: Record<SandboxStyle, number> = { pop: 0.5, lofi: 0.5, rnb: 0.5, jazz: JAZZ_SWING_FIRST };
function swungBeat(beat: number, swingFirst: number): number {
  if (swingFirst <= 0.5 + 1e-6) return beat;
  const whole = Math.floor(beat);
  const f = beat - whole; // 拍内位置 [0,1)
  const sf = f < 0.5 ? f * (swingFirst / 0.5) : swingFirst + (f - 0.5) * ((1 - swingFirst) / 0.5);
  return whole + sf;
}

/** 暖 lead 混音(电钢带一点 chorus + 中等空间)。 */
function leadMix(program: number): TrackMix {
  const ep = program === 4 || program === 5;
  return { volume: 96, pan: 64, reverb: 40, chorus: ep ? 48 : 12 };
}

/** PlayNote[] → NoteIR[](onset 排序 + 裁到曲尾;仅同音高重叠时截短,避免 noteOff 撞掉重复音)。
 *  swingFirst>0.5 → 播放层施加摆动(下拍稳、反拍推后);单调映射不改音序/不撞重叠裁剪逻辑。 */
function toNoteIR(notes: readonly PlayNote[], timebase: Timebase, totalBeats: number, defaultVel: number, swingFirst = 0.5, protectFastRuns = false): NoteIR[] {
  const src = [...notes].sort((a, b) => a.onsetBeat - b.onsetBeat).filter((n) => n.durationBeat > 0 && n.onsetBeat < totalBeats);
  // ★ 网格所有者(CODEX 2026-06-19):protectFastRuns 时,16 分/快速 run 内的音不施加 swungBeat(保持笔直,
  //   防 .5→.62 与 .75 挤成 micro-IOI)。只对 lead 开;comp/bass 仍走整段 swungBeat。
  const timed = protectFastRuns ? src.map((n) => ({ time: n.onsetBeat, duration: n.durationBeat })) : null;
  return src.map((n, i) => {
    const p = Math.round(n.midi);
    let durBeat = Math.min(n.durationBeat, totalBeats - n.onsetBeat);
    for (let j = i + 1; j < src.length; j++) {
      if (src[j].onsetBeat >= n.onsetBeat + durBeat) break;
      if (Math.round(src[j].midi) === p) { durBeat = Math.max(0.03, src[j].onsetBeat - n.onsetBeat - 0.01); break; }
    }
    const sf = timed && swingFirst > 0.5 && isInProtectedFastRun(timed, i, 4) ? 0.5 : swingFirst; // 快速 run → 不摆
    const onB = swungBeat(n.onsetBeat, sf);                                 // 摆动后起点(直拍/保护 run 时=原值)
    const swungDur = Math.max(0.03, swungBeat(n.onsetBeat + durBeat, sf) - onB); // 时值跟摆动时间线
    return {
      pitch: midi(p),
      startTick: timebase.beatToTick(beats(onB)),
      durationTicks: timebase.beatToTick(beats(swungDur)),
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

/** ★ lead 轨建谱:toNoteIR(含 swing)后做【快速连音 legato】(CODEX directive 2026-06-18,jazz/blues 启用)。
 *  只动 lead durationTicks(swing 不变、pitch/start/数量不变);comp/bass 不调(伴奏发音职责不同)。 */
function buildLeadNotes(lead: readonly PlayNote[], timebase: Timebase, totalBeats: number, defaultVel: number, style: SandboxStyle, swing: number): NoteIR[] {
  const notes = toNoteIR(lead, timebase, totalBeats, defaultVel, swing, true); // ★ lead 开网格保护(快速 run 不摆动)
  return connectFastLeadNoteIR(notes, fastLeadLegatoOptionsForStyle(style, timebase.ppq));
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
  const swing = SWING_BY_STYLE[style];
  return freezeMusicalIR({
    tracks: [{ role: 'lead', notes: buildLeadNotes(lead, timebase, totalBeats, 0.78, style, swing), program: prog, mix: leadMix(prog) }], // lead 不踩踏板 = 旋律发音清晰、稳稳对拍;jazz 快速连音 legato
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
  const swing = SWING_BY_STYLE[style]; // jazz 摆动:三轨同一摆动时间线 → 律动一致(下拍稳、反拍 lilt)
  return freezeMusicalIR({
    tracks: [
      { role: 'lead', notes: buildLeadNotes(lead, timebase, totalBeats, 0.78, style, swing), program: leadProg, mix: leadMix(leadProg) }, // lead 不踩 → 旋律清晰对拍;jazz 快速连音 legato(comp/bass 不调)
      { role: 'comp', notes: toNoteIR(accomp.comp, timebase, totalBeats, 0.46, swing), program: accomp.compProgram, mix: compMix, pedalEvents: barPedal(timebase, totalBeats) }, // 只 comp 踩 → 和声铺底 ring
      { role: 'bass', notes: toNoteIR(accomp.bass, timebase, totalBeats, 0.6, swing), program: accomp.bassProgram, mix: bassMix }, // bass 不踩 → 保清晰发音
    ],
    timebase,
    durationTicks: timebase.beatToTick(beats(totalBeats)),
  });
}
