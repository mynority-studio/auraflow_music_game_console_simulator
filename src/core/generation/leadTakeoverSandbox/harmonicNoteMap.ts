// ============================================================
// leadTakeoverSandbox · harmonic note map
// ------------------------------------------------------------
// Builds the 15 safe lead pads from current Q+N harmony. The core idea:
// use MG/Q+N orthogonal pitch sets (chord contract ∩ resolved local scale)
// and lay the resulting safe tones from low to high in reading order.
// ============================================================

import { normalizeChordType } from '../newEngine/knowledge/chords';
import type { StyleName } from '../newEngine/knowledge/mgMusicTheory';
import { buildPitchSets } from '../newEngine/render/mgPitchClassSets';
import type { ChordBlock } from '../newEngine/render/mgChordPart';
import {
  resolveLocalScale,
  type LocalScaleChordLike,
  type LocalScaleContext,
} from '../newEngine/knowledge/mgLocalScaleResolver';
import {
  TAKEOVER_PAD_COUNT,
  takeoverPadCoord,
  midiName,
} from './padLayout';
import type {
  TakeoverChordSource,
  TakeoverMusicSnapshot,
  TakeoverPadCell,
  TakeoverPadMap,
} from './types';

const DEFAULT_LOW_MIDI = 55;
const DEFAULT_STYLE: StyleName = 'POP';
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const VALID_STYLES = new Set<StyleName>(['POP', 'JAZZ', 'BLUES', 'RNB', 'LOFI', 'ACG']);

export function beatsPerBarOf(timeSignature: [number, number]): number {
  const [num, den] = timeSignature;
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return 4;
  return num * (4 / den);
}

export function findChordAtBeat(
  chords: readonly TakeoverChordSource[],
  beat: number,
): { current: TakeoverChordSource | null; next: TakeoverChordSource | null } {
  if (!Number.isFinite(beat) || chords.length === 0) return { current: null, next: null };
  const ordered = [...chords].sort((a, b) => a.startBeat - b.startBeat);
  for (let i = 0; i < ordered.length; i++) {
    const c = ordered[i];
    const endBeat = c.startBeat + c.durationBeats;
    if (beat >= c.startBeat - 1e-6 && beat < endBeat - 1e-6) {
      return { current: c, next: ordered[i + 1] ?? null };
    }
  }
  const previous = ordered.filter((c) => c.startBeat <= beat).pop() ?? null;
  if (!previous) return { current: null, next: ordered[0] ?? null };
  const nextIdx = ordered.indexOf(previous) + 1;
  return { current: previous, next: ordered[nextIdx] ?? null };
}

function styleToMgStyle(styleHint: string): StyleName {
  const s = styleHint.toUpperCase() as StyleName;
  return VALID_STYLES.has(s) ? s : DEFAULT_STYLE;
}

function tonalityToMgMode(tonality: string): string {
  const t = tonality.toLowerCase();
  if (t === 'minor' || t === 'aeolian') return 'Aeolian';
  if (t === 'major' || t === 'ionian') return 'Ionian';
  if (t === 'dorian') return 'Dorian';
  if (t === 'mixolydian') return 'Mixolydian';
  if (t === 'lydian') return 'Lydian';
  if (t === 'phrygian') return 'Phrygian';
  if (t === 'locrian') return 'Locrian';
  return 'Ionian';
}

function chordTypeOf(chord: TakeoverChordSource): string {
  return normalizeChordType(chord.chordType ?? chord.quality) ?? chord.chordType ?? chord.quality;
}

function toChordBlock(chord: TakeoverChordSource, index: number): ChordBlock {
  const rootPc = ((Math.round(chord.rootPc) % 12) + 12) % 12;
  return {
    index,
    root: PC_NAMES[rootPc] ?? 'C',
    rootPc,
    bassPc: rootPc,
    type: chordTypeOf(chord),
    durationBeats: chord.durationBeats,
    startBeat: chord.startBeat,
    endBeat: chord.startBeat + chord.durationBeats,
    functionHint: chord.functionHint,
    localKeyPc: chord.localTonalCenterPc,
    forcedScale: chord.forcedScale,
    roman: chord.roman ?? '',
    borrowedFrom: chord.borrowedFrom ?? undefined,
    borrowedSource: chord.borrowedSource,
  };
}

function toLocalScaleChordLike(chord: ChordBlock): LocalScaleChordLike {
  return {
    rootMidi: chord.rootPc,
    type: chord.type,
    roman: chord.roman ?? '',
    effectiveFunc: chord.functionHint,
    forcedScale: chord.forcedScale,
    localTonalCenterPc: chord.localKeyPc,
    borrowedFrom: chord.borrowedFrom,
    borrowedSource: chord.borrowedSource,
  };
}

function noteClassRole(
  pc: number,
  chordPcs: ReadonlySet<number>,
  scalePcs: ReadonlySet<number>,
  approachPcs: ReadonlySet<number>,
): TakeoverPadCell['classRole'] {
  if (chordPcs.has(pc)) return 'chord';
  if (scalePcs.has(pc)) return 'scale';
  if (approachPcs.has(pc)) return 'approach';
  return 'fallback';
}

function buildAscendingCells(
  pcs: readonly number[],
  roles: {
    chordPcs: ReadonlySet<number>;
    scalePcs: ReadonlySet<number>;
    approachPcs: ReadonlySet<number>;
  },
  lowMidi = DEFAULT_LOW_MIDI,
): TakeoverPadCell[] {
  const allowed = new Set(pcs.map((pc) => ((pc % 12) + 12) % 12));
  const cells: TakeoverPadCell[] = [];
  for (let midi = lowMidi; midi <= 108 && cells.length < TAKEOVER_PAD_COUNT; midi++) {
    const pc = ((midi % 12) + 12) % 12;
    if (!allowed.has(pc)) continue;
    const index = cells.length;
    const { col, row } = takeoverPadCoord(index);
    cells.push({
      index,
      col,
      row,
      midi,
      name: midiName(midi),
      pc,
      classRole: noteClassRole(pc, roles.chordPcs, roles.scalePcs, roles.approachPcs),
    });
  }
  return cells;
}

function fallbackCells(chord: TakeoverChordSource | null): TakeoverPadCell[] {
  const rootPc = chord ? ((Math.round(chord.rootPc) % 12) + 12) % 12 : 0;
  const majorPent = [0, 2, 4, 7, 9].map((iv) => (rootPc + iv) % 12);
  const all = new Set(majorPent);
  return buildAscendingCells(majorPent, {
    chordPcs: all,
    scalePcs: all,
    approachPcs: new Set(),
  }).map((c) => ({ ...c, classRole: 'fallback' as const }));
}

export function buildTakeoverPadMap(
  snapshot: TakeoverMusicSnapshot,
  beat: number,
): TakeoverPadMap {
  const { current, next } = findChordAtBeat(snapshot.chords, beat);
  if (!current) {
    return {
      cells: fallbackCells(null),
      chord: null,
      nextChord: next,
      localScaleName: 'fallback pentatonic',
      source: 'fallback',
    };
  }

  const currentIndex = snapshot.chords.indexOf(current);
  const chordBlock = toChordBlock(current, Math.max(0, currentIndex));
  const nextBlock = next ? toChordBlock(next, Math.max(0, snapshot.chords.indexOf(next))) : null;
  const localScaleContext: LocalScaleContext = {
    style: styleToMgStyle(snapshot.styleHint),
    key: snapshot.key,
    mode: tonalityToMgMode(snapshot.tonality),
  };

  try {
    const sets = buildPitchSets({ chord: chordBlock, nextChord: nextBlock, localScaleContext });
    const localScale = resolveLocalScale(localScaleContext, toLocalScaleChordLike(chordBlock));
    const chordPcs = new Set(sets.chordTones);
    const scalePcs = new Set(sets.scaleTones);
    const approachPcs = new Set(sets.approachTargets);
    const safePcs = [...new Set([...sets.chordTones, ...sets.scaleTones])].sort((a, b) => a - b);
    if (safePcs.length === 0) throw new Error('empty takeover pitch pool');
    const cells = buildAscendingCells(safePcs, { chordPcs, scalePcs, approachPcs });
    return {
      cells,
      chord: current,
      nextChord: next,
      localScaleName: `${PC_NAMES[localScale.rootPc] ?? 'C'} ${localScale.name}`,
      source: 'orthogonal',
    };
  } catch {
    return {
      cells: fallbackCells(current),
      chord: current,
      nextChord: next,
      localScaleName: 'fallback pentatonic',
      source: 'fallback',
    };
  }
}
