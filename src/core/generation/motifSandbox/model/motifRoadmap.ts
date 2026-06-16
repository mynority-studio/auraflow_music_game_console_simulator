// ============================================================
// motifSandbox · model · 实现 + 旋律 RoadMap(directive §10/D)
// ------------------------------------------------------------
// realizeToSandboxChords:选中模板 slots → SandboxChord[](保半小节 beats);每和弦带:
//   ① 调内三和弦(degree/tonePcs)—— 旋律 adapt 用,保调内;
//   ② 真实和声(realRoman/realType/realRootPc/realTonePcs/borrowed/func)—— 伴奏 + RoadMap + UI 用。
// buildMotifRoadmap:slots → ChordPart → parseRoadMap 出【真 BrickMatch】+ userBrick 锚点槽。
// ============================================================

import type { ProgressionSlot } from '../../newEngine/knowledge/progressions';
import { chordTypeIntervals, normalizeChordType } from '../../newEngine/knowledge/chords';
import { buildChordPart, type MgChordDef } from '../../newEngine/render/mgChordPart';
import { parseRoadMap } from '../../newEngine/render/mgRoadMapParser';
import { makeChord, type SandboxChord } from './chords';
import type { ScaleMode } from './types';
import type { SelectedMotifProgression, MotifMelodicRoadmap, MotifMelodicSlot, UserMelodicBrick } from './melodicBrickTypes';

const BAR = 4;
const m12 = (n: number): number => ((n % 12) + 12) % 12;
const deg17 = (d: number): number => ((d - 1) % 7 + 7) % 7 + 1;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function slotAtBeat(chords: readonly SandboxChord[], beat: number): SandboxChord {
  return chords.find((c) => beat >= c.startBeat - 1e-6 && beat < c.startBeat + c.durationBeats - 1e-6) ?? chords[chords.length - 1];
}

/** 选中模板 slots → SandboxChord[]:逐 slot(保半小节 beats),带【调内三和弦 + 真实和声】。 */
export function realizeToSandboxChords(slots: readonly ProgressionSlot[], keyPc: number, mode: ScaleMode): SandboxChord[] {
  const out: SandboxChord[] = [];
  let beat = 0;
  for (const s of slots) {
    const beats = s.beats ?? BAR;
    const diatonic = makeChord(deg17(s.scaleDegree), keyPc, mode, beat, beats); // 旋律用(保调内)
    const realRootPc = m12(keyPc + s.rootOffset);
    const ivs = chordTypeIntervals(normalizeChordType(s.type) ?? 'maj');
    out.push({
      ...diatonic,
      realRoman: s.roman, realType: s.type, realRootPc,
      realTonePcs: [...new Set(ivs.map((iv) => m12(realRootPc + iv)))],
      borrowedSource: s.borrowedSource, effectiveFunc: s.effectiveFunc,
    });
    beat += beats;
  }
  return out;
}

/** 旋律 roadmap:真 harmonicBricks(slots→ChordPart→parseRoadMap)+ userBrick 锚 0/16/32/48 + 应答槽。 */
export function buildMotifRoadmap(selected: SelectedMotifProgression, brick: UserMelodicBrick, quoteBeats: number, keyPc: number, mode: ScaleMode, totalBars = 16): MotifMelodicRoadmap {
  const chords = realizeToSandboxChords(selected.slots, keyPc, mode);
  const harmonicRomans: string[] = [];
  for (let bar = 0; bar < totalBars; bar++) {
    const c = slotAtBeat(chords, bar * BAR);
    harmonicRomans.push(c.realRoman ?? ROMAN[deg17(c.degree) - 1]);
  }

  // 真 RoadMap:realized chords → MgChordDef[] → ChordPart → parseRoadMap(失败不静默吞 → roadmapError)。
  let harmonicBricks: MotifMelodicRoadmap['harmonicBricks'];
  let roadmapError: string | undefined;
  try {
    const defs: MgChordDef[] = chords.map((c) => {
      const rootPc = c.realRootPc ?? c.rootPc;
      return { roman: c.realRoman ?? c.roman, root: PC_NAMES[rootPc], rootMidi: rootPc + 48, type: normalizeChordType(c.realType ?? 'maj') ?? 'maj', bassMidi: rootPc + 48, duration: c.durationBeats, effectiveFunc: c.effectiveFunc };
    });
    harmonicBricks = parseRoadMap({ part: buildChordPart(defs), songKeyPc: keyPc }).bricks;
  } catch (err) { roadmapError = err instanceof Error ? err.message : String(err); }

  const cycleBeats = 4 * BAR;
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
  return { totalBars, harmonicRomans, harmonicBricks, roadmapError, melodicSlots };
}
