// ============================================================
// leadTakeoverSandbox · harmonic note map
// ------------------------------------------------------------
// Builds the 15 safe lead pads from current Q+N harmony. The core idea:
// keep chord tones as stable anchors, supplement with KB acceptable local-scale
// tensions, remove avoid tones, then lay safe tones low-to-high from C3-C5.
// ============================================================

import { mod12 } from '../newEngine/foundation';
import { normalizeChordType } from '../newEngine/knowledge/chords';
import type { ChordQuality } from '../newEngine/knowledge/chords';
import type { StyleName } from '../newEngine/knowledge/mgMusicTheory';
import { tensionTableForChordType } from '../newEngine/knowledge/tensionModel';
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

const TAKEOVER_PRIMARY_LOW_MIDI = 48;  // C3
const TAKEOVER_PRIMARY_HIGH_MIDI = 72; // C5
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

function narrowQualityOf(chord: TakeoverChordSource): ChordQuality {
  const q = chord.quality;
  if (q === 'maj' || q === 'min' || q === 'maj7' || q === 'm7' || q === '7' || q === 'm7b5' || q === 'dim7') return q;
  const t = chordTypeOf(chord);
  if (t === 'm7b5' || t === 'm9b5') return 'm7b5';
  if (t === 'dim' || t === 'dim7') return 'dim7';
  if (t.startsWith('m') && !t.startsWith('maj')) return 'm7';
  if (t.startsWith('maj')) return 'maj7';
  if (t.includes('7') || t.includes('9') || t.includes('11') || t.includes('13') || t.includes('sus')) return '7';
  if (t === 'min') return 'min';
  return 'maj';
}

function toChordBlock(chord: TakeoverChordSource, index: number): ChordBlock {
  const rootPc = mod12(Math.round(chord.rootPc));
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

function degreeLabel(pc: number, rootPc: number, role: TakeoverPadCell['classRole']): string {
  const delta = ((pc - rootPc) % 12 + 12) % 12;
  if (role === 'scale' || role === 'approach') {
    const tensionLabels: Record<number, string> = {
      1: 'b9',
      2: '9',
      3: '#9',
      5: '11',
      6: '#11',
      8: 'b13',
      9: '13',
      11: '7',
    };
    return tensionLabels[delta] ?? `+${delta}`;
  }
  const chordLabels: Record<number, string> = {
    0: '1',
    3: 'b3',
    4: '3',
    5: 'sus4',
    6: 'b5',
    7: '5',
    8: '#5',
    9: '6',
    10: 'b7',
    11: '7',
  };
  return chordLabels[delta] ?? `+${delta}`;
}

function compoundIntervalFloor(delta: number, role: TakeoverPadCell['classRole']): number {
  if (role !== 'scale' && role !== 'approach') return delta;
  const compoundTensions: Record<number, number> = {
    1: 13,  // b9
    2: 14,  // 9
    3: 15,  // #9
    5: 17,  // 11
    6: 18,  // #11
    8: 20,  // b13
    9: 21,  // 13
    11: 11, // 7
  };
  return compoundTensions[delta] ?? delta;
}

function firstMidiAtOrAbove(pc: number, lowMidi: number): number {
  for (let midi = lowMidi; midi < lowMidi + 12; midi++) {
    if (((midi % 12) + 12) % 12 === pc) return midi;
  }
  return lowMidi;
}

function buildAscendingCells(
  pcs: readonly number[],
  roles: {
    chordPcs: ReadonlySet<number>;
    scalePcs: ReadonlySet<number>;
    approachPcs: ReadonlySet<number>;
    rootPc: number;
  },
  lowMidi = TAKEOVER_PRIMARY_LOW_MIDI,
  primaryHighMidi = TAKEOVER_PRIMARY_HIGH_MIDI,
): TakeoverPadCell[] {
  const allowed = new Set(pcs.map((pc) => ((pc % 12) + 12) % 12));
  const cells: TakeoverPadCell[] = [];
  const rootAnchorMidi = firstMidiAtOrAbove(roles.rootPc, lowMidi);
  const pushCell = (midi: number) => {
    const pc = ((midi % 12) + 12) % 12;
    if (!allowed.has(pc)) return;
    const index = cells.length;
    const { col, row } = takeoverPadCoord(index);
    const classRole = noteClassRole(pc, roles.chordPcs, roles.scalePcs, roles.approachPcs);
    const delta = ((pc - roles.rootPc) % 12 + 12) % 12;
    if (midi < rootAnchorMidi + compoundIntervalFloor(delta, classRole)) return;
    cells.push({
      index,
      col,
      row,
      midi,
      name: midiName(midi),
      pc,
      degreeLabel: degreeLabel(pc, roles.rootPc, classRole),
      classRole,
    });
  };

  for (let midi = lowMidi; midi <= primaryHighMidi && cells.length < TAKEOVER_PAD_COUNT; midi++) {
    pushCell(midi);
  }
  for (let midi = primaryHighMidi + 1; midi <= 108 && cells.length < TAKEOVER_PAD_COUNT; midi++) {
    pushCell(midi);
  }
  return cells;
}

function safeSupplementPcs(chord: TakeoverChordSource, scaleTones: readonly number[]): number[] {
  const rootPc = mod12(Math.round(chord.rootPc));
  const table = tensionTableForChordType(
    rootPc,
    chordTypeOf(chord),
    narrowQualityOf(chord),
  );
  const acceptable = new Set<number>(table.acceptable);
  const avoid = new Set<number>(table.avoid);
  return scaleTones
    .filter((pc) => acceptable.has(pc) && !avoid.has(pc))
    .sort((a, b) => {
      const aIdx = table.acceptable.findIndex((pc) => pc === a);
      const bIdx = table.acceptable.findIndex((pc) => pc === b);
      return (aIdx < 0 ? 99 : aIdx) - (bIdx < 0 ? 99 : bIdx);
    });
}

function fallbackCells(chord: TakeoverChordSource | null): TakeoverPadCell[] {
  const rootPc = chord ? ((Math.round(chord.rootPc) % 12) + 12) % 12 : 0;
  const majorPent = [0, 2, 4, 7, 9].map((iv) => (rootPc + iv) % 12);
  const all = new Set(majorPent);
  return buildAscendingCells(majorPent, {
    chordPcs: all,
    scalePcs: all,
    approachPcs: new Set(),
    rootPc,
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
    const safeScaleTones = safeSupplementPcs(current, sets.scaleTones);
    const scalePcs = new Set(safeScaleTones);
    const approachPcs = new Set(sets.approachTargets);
    const safePcs = [...new Set([...sets.chordTones, ...safeScaleTones])].sort((a, b) => a - b);
    if (safePcs.length === 0) throw new Error('empty takeover pitch pool');
    const cells = buildAscendingCells(safePcs, {
      chordPcs,
      scalePcs,
      approachPcs,
      rootPc: chordBlock.rootPc,
    });
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
