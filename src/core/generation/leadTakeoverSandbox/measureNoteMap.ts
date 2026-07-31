import {
  TAKEOVER_ASCENDING_PAD_INDICES,
  TAKEOVER_PAD_COUNT,
  midiName,
  takeoverPadCoord,
} from './padLayout';
import type {
  TakeoverMeasureNote,
  TakeoverMeasureSource,
  TakeoverMusicSnapshot,
  TakeoverPadCell,
} from './types';

export const TAKEOVER_SELECTION_LOW_MIDI = 60;
export const TAKEOVER_SELECTION_HIGH_MIDI = 84;
export const TAKEOVER_STRUCTURAL_CORE_CAP = 5;
export const TAKEOVER_CHROMATIC_PASSING_CAP = Math.floor(TAKEOVER_PAD_COUNT * 0.3);

export function findMeasureAtBeat(
  measures: readonly TakeoverMeasureSource[],
  beat: number,
): TakeoverMeasureSource | null {
  if (!Number.isFinite(beat)) return null;
  return measures.find((measure) =>
    beat >= measure.startBeat - 1e-6
    && beat < measure.startBeat + measure.durationBeats - 1e-6) ?? null;
}

export function foldMidiIntoTakeoverRange(sourceMidi: number): number {
  let midi = Math.max(0, Math.min(127, Math.round(sourceMidi)));
  while (midi < TAKEOVER_SELECTION_LOW_MIDI) midi += 12;
  while (midi > TAKEOVER_SELECTION_HIGH_MIDI) midi -= 12;
  return Math.max(
    TAKEOVER_SELECTION_LOW_MIDI,
    Math.min(TAKEOVER_SELECTION_HIGH_MIDI, midi),
  );
}

function cellRole(selection: FoldedSelection): TakeoverPadCell['classRole'] {
  if (selection.isCore) return 'structural';
  if (selection.sourceKinds.has('melody')) return 'selected';
  if (selection.note.structuralRole === 'ornament') return 'ornament';
  return 'selected';
}

function cellLabel(selection: FoldedSelection): string {
  const { note } = selection;
  const hasMelody = selection.sourceKinds.has('melody');
  if (selection.isCore) return hasMelody ? '旋律核心' : '核心';
  if (selection.isChromaticPassing) return hasMelody ? '旋律半音' : '半音';
  if (hasMelody) return '旋律';
  if (selection.sourceKinds.has('bass')) return 'Bass';
  if (note.metricLevel === 'downbeat') return '主拍';
  if (note.metricLevel === 'strongBeat') return '重拍';
  if (note.melodicFunction === 'passingTone') return '经过';
  if (note.melodicFunction === 'neighborTone') return '邻音';
  return note.structuralRole === 'ornament' ? '装饰' : '选音';
}

interface FoldedSelection {
  midi: number;
  note: TakeoverMeasureNote;
  sourceKinds: Set<NonNullable<TakeoverMeasureNote['voiceKind']>>;
  hasBackbone: boolean;
  isCore: boolean;
  isChromaticPassing: boolean;
}

function sourceKind(note: TakeoverMeasureNote): NonNullable<TakeoverMeasureNote['voiceKind']> {
  return note.voiceKind ?? 'accompaniment';
}

function sourceImportance(selection: FoldedSelection): number {
  if (selection.sourceKinds.has('melody')) return 3;
  if (selection.sourceKinds.has('bass')) return 2;
  return 1;
}

function pitchClassDistance(left: number, right: number): number {
  const distance = Math.abs(left - right) % 12;
  return Math.min(distance, 12 - distance);
}

function chromaticPassingPitchClasses(measure: TakeoverMeasureSource): Set<number> {
  const structuralPcs = new Set(
    measure.notes
      .filter((note) => note.structuralRole === 'backbone')
      .map((note) => ((note.sourceMidi % 12) + 12) % 12),
  );
  return new Set(
    measure.notes
      .filter((note) =>
        note.structuralRole !== 'backbone'
        && note.melodicFunction === 'passingTone'
        && [...structuralPcs].some((pc) =>
          pitchClassDistance(note.sourceMidi, pc) === 1))
      .map((note) => ((note.sourceMidi % 12) + 12) % 12),
  );
}

function isChromaticPassing(
  selection: FoldedSelection,
  chromaticPcs: ReadonlySet<number>,
): boolean {
  return selection.note.melodicFunction === 'passingTone'
    && chromaticPcs.has(((selection.midi % 12) + 12) % 12);
}

export function selectMeasureNotesForPads(
  measure: TakeoverMeasureSource,
): FoldedSelection[] {
  const byMidi = new Map<number, FoldedSelection>();
  for (const note of measure.notes) {
    const midi = foldMidiIntoTakeoverRange(note.sourceMidi);
    const existing = byMidi.get(midi);
    if (!existing) {
      byMidi.set(midi, {
        midi,
        note,
        sourceKinds: new Set([sourceKind(note)]),
        hasBackbone: note.structuralRole === 'backbone',
        isCore: false,
        isChromaticPassing: false,
      });
      continue;
    }
    existing.sourceKinds.add(sourceKind(note));
    existing.hasBackbone ||= note.structuralRole === 'backbone';
    if (note.priority > existing.note.priority) {
      existing.note = note;
    }
  }
  const ranked = Array.from(byMidi.values())
    .sort((left, right) =>
      (right.note.priority - left.note.priority)
      || (left.midi - right.midi));
  const chromaticPcs = chromaticPassingPitchClasses(measure);
  const structural = ranked
    .filter((selection) => selection.hasBackbone)
    .slice(0, TAKEOVER_STRUCTURAL_CORE_CAP)
    .map((selection) => ({ ...selection, isCore: true }));
  const chromaticPassing = ranked
    .filter((selection) =>
      selection.note.structuralRole !== 'backbone'
      && isChromaticPassing(selection, chromaticPcs))
    .slice(0, TAKEOVER_CHROMATIC_PASSING_CAP)
    .map((selection) => ({ ...selection, isChromaticPassing: true }));
  const selectedMidi = new Set([
    ...structural.map((selection) => selection.midi),
    ...chromaticPassing.map((selection) => selection.midi),
  ]);
  const ordinary = ranked
    .filter((selection) =>
      !selectedMidi.has(selection.midi)
      && !selection.hasBackbone
      && !isChromaticPassing(selection, chromaticPcs));
  const overflowBackbone = ranked
    .filter((selection) =>
      !selectedMidi.has(selection.midi)
      && selection.hasBackbone);
  const other = [...ordinary, ...overflowBackbone]
    .sort((left, right) =>
      (sourceImportance(right) - sourceImportance(left))
      || (right.note.priority - left.note.priority)
      || (left.midi - right.midi))
    .slice(0, TAKEOVER_PAD_COUNT - structural.length - chromaticPassing.length);
  const capacitySelection = [...structural, ...chromaticPassing, ...other];
  return capacitySelection.sort((left, right) => left.midi - right.midi);
}

export function buildMeasureNoteCells(
  snapshot: TakeoverMusicSnapshot,
  beat: number,
): { cells: TakeoverPadCell[]; measure: TakeoverMeasureSource } | null {
  const measure = findMeasureAtBeat(snapshot.measures ?? [], beat);
  if (!measure) return null;
  const selected = selectMeasureNotesForPads(measure);
  if (selected.length === 0) return null;
  const ordered = [...selected];
  const usedMidi = new Set(ordered.map((selection) => selection.midi));
  let chromaticCount = ordered.filter((selection) =>
    selection.isChromaticPassing).length;

  // First consume every distinct octave placement available inside C4-C6.
  // This preserves the source pitch classes without flooding the keyboard
  // with one repeated MIDI note when a measure contains fewer than 15 tones.
  const octaveVariants: FoldedSelection[] = [];
  for (const distance of [12, 24]) {
    for (const selection of selected) {
      for (const midi of [selection.midi - distance, selection.midi + distance]) {
        if (midi < TAKEOVER_SELECTION_LOW_MIDI || midi > TAKEOVER_SELECTION_HIGH_MIDI) continue;
        if (usedMidi.has(midi) || octaveVariants.some((candidate) => candidate.midi === midi)) continue;
        octaveVariants.push({
          ...selection,
          midi,
          sourceKinds: new Set(selection.sourceKinds),
          isCore: false,
        });
      }
    }
  }
  octaveVariants.sort((left, right) =>
    (sourceImportance(right) - sourceImportance(left))
    || (right.note.priority - left.note.priority)
    || (left.midi - right.midi));
  for (const variant of octaveVariants) {
    if (ordered.length >= TAKEOVER_PAD_COUNT) break;
    if (variant.isChromaticPassing && chromaticCount >= TAKEOVER_CHROMATIC_PASSING_CAP) continue;
    ordered.push(variant);
    usedMidi.add(variant.midi);
    if (variant.isChromaticPassing) chromaticCount += 1;
  }

  // A fixed 3x5 controller still needs 15 cells. If the two-octave window
  // mathematically contains fewer than 15 distinct eligible notes, repeat
  // the whole pool round-robin instead of cloning one note many times.
  const balancedFill = [...selected].sort((left, right) =>
    (sourceImportance(right) - sourceImportance(left))
    || (right.note.priority - left.note.priority)
    || (left.midi - right.midi));
  let fillIndex = 0;
  while (ordered.length < TAKEOVER_PAD_COUNT) {
    const fill = balancedFill[fillIndex % balancedFill.length];
    ordered.push(
      {
        ...fill,
        sourceKinds: new Set(fill.sourceKinds),
        isCore: false,
      },
    );
    fillIndex += 1;
  }
  ordered.sort((left, right) =>
    (left.midi - right.midi)
    || (right.note.priority - left.note.priority));
  const coreIndices = new Set(
    ordered
      .map((selection, index) => ({ selection, index }))
      .filter(({ selection }) => selection.hasBackbone)
      .sort((left, right) =>
        (Math.abs(left.index - 7) - Math.abs(right.index - 7))
        || (right.selection.note.priority - left.selection.note.priority))
      .slice(0, TAKEOVER_STRUCTURAL_CORE_CAP)
      .map(({ index }) => index),
  );
  const finalized = ordered.map((selection, index) => ({
    ...selection,
    isCore: coreIndices.has(index),
  }));

  const cells = new Array<TakeoverPadCell>(TAKEOVER_PAD_COUNT);
  finalized.forEach((selection, orderIndex) => {
    const index = TAKEOVER_ASCENDING_PAD_INDICES[orderIndex] ?? orderIndex;
    const { col, row } = takeoverPadCoord(index);
    cells[index] = {
      index,
      col,
      row,
      midi: selection.midi,
      name: midiName(selection.midi),
      pc: selection.midi % 12,
      degreeLabel: cellLabel(selection),
      classRole: cellRole(selection),
    };
  });
  return { cells, measure };
}
