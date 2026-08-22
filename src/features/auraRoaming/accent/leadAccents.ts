// ============================================================
// auraRoaming · accent(lead 重音识别)
// ------------------------------------------------------------
// 只读消费最终 lead NoteIR(MG 链外,不改任何事件 → 天然满足
// productLeadNonMutation)。给每个音符打"重音显著度"分,cuePlanner
// 再按节奏型/密度从候选里挑提示音。
//
// 打分维度:乐句头(休止后首音)、小节正拍/次强拍、长时值、
// 局部力度峰、局部音高峰。分数只用于排序,不承诺绝对量纲。
// ============================================================

import type { AccentCandidate, AuraLeadNote } from '../types';

export interface AccentScoringContext {
  ppq: number;
  beatsPerBar: number;
}

const GRID_EPS = 0.07;

function isNear(value: number, target: number): boolean {
  return Math.abs(value - target) < GRID_EPS;
}

function isOnGrid(beat: number, grid: number): boolean {
  const nearest = Math.round(beat / grid) * grid;
  return Math.abs(beat - nearest) < GRID_EPS;
}

/** lead 音符 → 重音候选(按 tick 升序;分数越高越该被提示)。 */
export function scoreLeadAccents(
  notes: readonly AuraLeadNote[],
  ctx: AccentScoringContext,
): AccentCandidate[] {
  const { ppq, beatsPerBar } = ctx;
  const sorted = notes
    .map((note, noteIndex) => ({ note, noteIndex }))
    .sort((a, b) => a.note.startTick - b.note.startTick || a.note.pitch - b.note.pitch);

  const out: AccentCandidate[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const { note, noteIndex } = sorted[i];
    const beat = note.startTick / ppq;
    const durationBeats = note.durationTicks / ppq;
    const posInBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;

    let score = 0;

    // 乐句头:曲首或休止 ≥1 拍之后的首音
    if (i === 0) {
      score += 3;
    } else {
      const prev = sorted[i - 1].note;
      const gapBeats = (note.startTick - (prev.startTick + prev.durationTicks)) / ppq;
      if (gapBeats >= 1) score += 3;
      else if (gapBeats >= 0.5) score += 1.2;
    }

    // 节拍位置
    if (isNear(posInBar, 0) || isNear(posInBar, beatsPerBar)) score += 2.5;
    else if (beatsPerBar % 2 === 0 && isNear(posInBar, beatsPerBar / 2)) score += 1.5;
    else if (isOnGrid(beat, 1)) score += 0.8;
    else if (isOnGrid(beat, 0.5)) score += 0.3;

    // 时值(长音天然是"缓缓呼吸"的好目标)
    if (durationBeats >= 2) score += 3;
    else if (durationBeats >= 1) score += 2;
    else if (durationBeats >= 0.5) score += 0.75;

    // 局部力度峰
    const prevVel = i > 0 ? sorted[i - 1].note.velocity : -1;
    const nextVel = i < sorted.length - 1 ? sorted[i + 1].note.velocity : -1;
    if (note.velocity >= prevVel && note.velocity >= nextVel && (note.velocity > prevVel || note.velocity > nextVel)) {
      score += 1.2;
    }

    // 局部音高峰(旋律轮廓顶点)
    const prevPitch = i > 0 ? sorted[i - 1].note.pitch : Number.NEGATIVE_INFINITY;
    const nextPitch = i < sorted.length - 1 ? sorted[i + 1].note.pitch : Number.NEGATIVE_INFINITY;
    if (note.pitch > prevPitch && note.pitch > nextPitch) score += 0.8;

    out.push({ noteIndex, tick: note.startTick, beat, pitch: note.pitch, durationBeats, velocity: note.velocity, score });
  }
  return out;
}
