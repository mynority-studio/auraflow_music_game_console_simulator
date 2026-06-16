// ============================================================
// motifSandbox · model · 实现 + 旋律 RoadMap(directive §10/D)
// ------------------------------------------------------------
// realizeToSandboxChords:选中模板的 slots → 每小节一个【调内三和弦】(保 16-chord 形状,
//   与现有 weaver/伴奏一致;半小节和声节奏 Phase 1 先折成整小节)。
// buildMotifRoadmap:每和弦循环头预留 userBrick 锚点 + 应答/续写/终止占位(调试)。
// ============================================================

import type { ProgressionSlot } from '../../newEngine/knowledge/progressions';
import { makeChord, type SandboxChord } from './chords';
import type { ScaleMode } from './types';
import type { SelectedMotifProgression, MotifMelodicRoadmap, MotifMelodicSlot, UserMelodicBrick } from './melodicBrickTypes';

const BAR = 4;
const deg17 = (d: number): number => ((d - 1) % 7 + 7) % 7 + 1;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

function slotAtBeat(slots: readonly ProgressionSlot[], beat: number): ProgressionSlot {
  let acc = 0;
  for (const s of slots) { const b = s.beats ?? BAR; if (beat >= acc - 1e-6 && beat < acc + b - 1e-6) return s; acc += b; }
  return slots[slots.length - 1];
}

/** 选中模板 slots → 每小节一个调内三和弦(取该小节下拍的 slot 级数)。totalBars 个和弦。 */
export function realizeToSandboxChords(slots: readonly ProgressionSlot[], keyPc: number, mode: ScaleMode, totalBars = 16): SandboxChord[] {
  const out: SandboxChord[] = [];
  for (let bar = 0; bar < totalBars; bar++) {
    out.push(makeChord(deg17(slotAtBeat(slots, bar * BAR).scaleDegree), keyPc, mode, bar * BAR, BAR));
  }
  return out;
}

/** 旋律 roadmap:userBrick 锚 0/16/32/48 + 之后应答/续写/终止占位(Phase 1 sandbox-local)。 */
export function buildMotifRoadmap(selected: SelectedMotifProgression, brick: UserMelodicBrick, quoteBeats: number, totalBars = 16): MotifMelodicRoadmap {
  const harmonicRomans: string[] = [];
  for (let bar = 0; bar < totalBars; bar++) harmonicRomans.push(ROMAN[deg17(slotAtBeat(selected.slots, bar * BAR).scaleDegree) - 1]);

  const cycleBeats = 4 * BAR; // 4 小节循环
  const numCycles = Math.max(1, Math.round((totalBars * BAR) / cycleBeats));
  const melodicSlots: MotifMelodicSlot[] = [];
  for (let c = 0; c < numCycles; c++) {
    const start = c * cycleBeats;
    melodicSlots.push({ id: `userBrick-${c}`, startBeat: start, durationBeats: quoteBeats, role: 'userBrick', source: 'user', anchorMotifId: brick.sourceMotifId });
    const ansLen = cycleBeats - quoteBeats;
    if (ansLen > 0) {
      const role: MotifMelodicSlot['role'] = c === numCycles - 1 ? 'cadence' : c % 2 === 1 ? 'cadence' : 'continuation';
      melodicSlots.push({ id: `answer-${c}`, startBeat: start + quoteBeats, durationBeats: ansLen, role, source: 'generated', requiredFunction: role === 'cadence' ? 'cadence' : 'answer' });
    }
  }
  return { totalBars, harmonicRomans, melodicSlots };
}
