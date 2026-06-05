// ============================================================
// newEngine · render · MgChordPart(MG strict 移植 Loop 2)
// ------------------------------------------------------------
// Provenance: ../melodygenerative/src/lib/improvisor/ChordPart.ts 忠实港(逐值)。
// 唯一改动:MG 的 `import { ChordDef } from '../musicEngine'` 换成本文件内联的
//   MgChordDef(buildChordPart 实读子集)—— 由 mgChordDefAdapter 从我们 HarmonicPlan 产出。
// render 层:把和弦序列变成 Impro-Visor 风格的累计时长时间线,供 RoadMap 解析消费。
// ============================================================
//
// Foundational layer of the new pipeline. Replaces "bar index" thinking
// with a cumulative-duration timeline. The chord active at any beat is
// retrieved by binary search over startBeat.

/** MG ChordDef 的窄等价物(buildChordPart 实读字段)。完整 MG ChordDef 另含
 *  roman/bass/notes/notesMidi/tensionState/virtualExtensions/... —— buildChordPart 不读,
 *  故只保这些,由 mgChordDefAdapter 从 newEngine ChordSpan 投影。 */
export interface MgChordDef {
  /** Root note name (e.g., 'C', 'F#', 'Bb') */
  root: string;
  /** MIDI root for scale calculations (parser 只取 %12) */
  rootMidi: number;
  /** Chord type suffix (e.g., 'maj7', 'm7', '7alt', 'sus4', '9sus4') */
  type: string;
  /** Exact MIDI note of the bass (parser 只取 %12;slash chord 时 ≠ rootMidi) */
  bassMidi: number;
  /** Duration in beats (1 beat = 1 quarter note) */
  duration: number;
  /** TSD function override(可选;parser 不读,下游 shaper 读) */
  effectiveFunc?: 'T' | 'S' | 'D';
  /** Local key center pc when chord is in a tonicization */
  localTonalCenterPc?: number;
  /** Explicit chord-scale override from the harmony layer. */
  forcedScale?: string;
}

export interface ChordBlock {
  /** Sequential index in the part */
  index: number;
  /** Root note name (e.g., "C", "F#", "Bb") */
  root: string;
  /** Root pitch class (0-11) */
  rootPc: number;
  /** Actual sounding bass pitch class (0-11). For root-position chords
   *  equals rootPc; for slash chords (G7/D, F/G, pedal-on-tonic etc.)
   *  this is the LISTENER'S bass anchor — different from the chord
   *  symbol's root. EXCEEDS IV — IV's makeBassNote uses chord root and
   *  has a `// FIX!` TODO acknowledging the gap (LickGen.java:3063). */
  bassPc: number;
  /** Chord type suffix (e.g., "maj7", "m7", "7alt", "sus4", "9sus4") */
  type: string;
  /** Duration in beats (1 beat = 1 quarter note). NOT bar-locked. */
  durationBeats: number;
  /** Cumulative start in absolute beats */
  startBeat: number;
  /** Cumulative end in absolute beats = startBeat + durationBeats */
  endBeat: number;
  /** Tonal function hint when derivable from roman / borrowed-source */
  functionHint?: 'T' | 'S' | 'D';
  /** Local key center pc when chord is in a tonicization (V/X / subV/X) */
  localKeyPc?: number;
  /** Explicit chord-scale override from the harmony layer. */
  forcedScale?: string;
}

export interface ChordPart {
  blocks: ChordBlock[];
  totalBeats: number;
  /** Meter as [numerator, denominator]. Default 4/4. Used by RoadMap +
   *  StyleRenderer; ChordBlock durations themselves are bar-free. */
  meter: [number, number];
}

/** Build a ChordPart from MG-equivalent ChordDef[]. Pure conversion —
 *  no random consumption, no behavior change. */
export function buildChordPart(
  chords: MgChordDef[],
  meter: [number, number] = [4, 4],
): ChordPart {
  const blocks: ChordBlock[] = [];
  let cursor = 0;
  for (let i = 0; i < chords.length; i++) {
    const c = chords[i];
    const dur = c.duration;
    blocks.push({
      index: i,
      root: c.root,
      rootPc: ((c.rootMidi % 12) + 12) % 12,
      bassPc: ((c.bassMidi % 12) + 12) % 12,
      type: c.type,
      durationBeats: dur,
      startBeat: cursor,
      endBeat: cursor + dur,
      functionHint: c.effectiveFunc,
      localKeyPc: c.localTonalCenterPc,
      forcedScale: c.forcedScale,
    });
    cursor += dur;
  }
  return {
    blocks,
    totalBeats: cursor,
    meter,
  };
}

/** Get the chord block active at an absolute beat. O(log n) via binary
 *  search. Returns null when beat is past the song end OR before t=0. */
export function getCurrentChordAtBeat(part: ChordPart, beat: number): ChordBlock | null {
  if (beat < 0) return null;
  if (beat >= part.totalBeats) return null;

  // Binary search for block whose [startBeat, endBeat) contains beat.
  let lo = 0;
  let hi = part.blocks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = part.blocks[mid];
    if (beat < b.startBeat) hi = mid - 1;
    else if (beat >= b.endBeat) lo = mid + 1;
    else return b;
  }
  return null;
}

/** Return the chord that will be active AFTER the chord at `beat` ends.
 *  Used by LickGen's APPROACH calculation. Null if `beat` is in the last
 *  chord. */
export function getNextChordAtBeat(part: ChordPart, beat: number): ChordBlock | null {
  const cur = getCurrentChordAtBeat(part, beat);
  if (!cur) return null;
  if (cur.index + 1 >= part.blocks.length) return null;
  return part.blocks[cur.index + 1];
}

/** Convenience — index of the block at this beat (or -1). */
export function indexAtBeat(part: ChordPart, beat: number): number {
  const b = getCurrentChordAtBeat(part, beat);
  return b ? b.index : -1;
}

/** Total length in seconds at a given tempo. Useful for playback loopEnd. */
export function totalSeconds(part: ChordPart, tempoBpm: number): number {
  if (tempoBpm <= 0) return 0;
  return part.totalBeats * (60 / tempoBpm);
}
