import type {
  HarmonicWindow,
  HarmonicSegment,
  MidiDerivedVoiceKind,
  MidiInventory,
  MidiMeasure,
  MidiMeasureMap,
  MidiNoteSpan,
  MidiVoiceSeparation,
  RichSmfDocument,
} from './types';

const normalize = (weights: ReadonlyArray<number>): number[] => {
  const total = weights.reduce((sum, value) => sum + value, 0);
  return total > 0 ? weights.map((value) => value / total) : [...weights];
};

const registerBassIdsBySeparation = new WeakMap<MidiVoiceSeparation, ReadonlySet<string>>();

function registerDerivedBassIds(voices: MidiVoiceSeparation): ReadonlySet<string> {
  const cached = registerBassIdsBySeparation.get(voices);
  if (cached) return cached;
  const ids = new Set(
    voices.parts
      .filter((part) => part.id.endsWith(':bass-register'))
      .flatMap((part) => part.noteIds),
  );
  registerBassIdsBySeparation.set(voices, ids);
  return ids;
}

function noteKind(
  voices: MidiVoiceSeparation,
  inventory: MidiInventory,
  note: MidiNoteSpan,
): MidiDerivedVoiceKind {
  const separated = voices.notePartById[note.id];
  // Register-derived piano bass remains conservative harmonic evidence. The
  // existing accompaniment-lowest-note path will still use it, but with lower
  // confidence than a true Bass Lane.
  if (separated === 'bass' && registerDerivedBassIds(voices).has(note.id)) {
    return 'accompaniment';
  }
  if (separated) return separated;
  const lane = inventory.lanes.find((candidate) =>
    candidate.trackIndex === note.trackIndex && candidate.channel === note.channel);
  if (lane?.role === 'drum') return 'drums';
  if (lane?.role === 'bass') return 'bass';
  if (lane?.role === 'lead') return 'melody';
  if (lane?.role === 'comp' || lane?.role === 'pad') return 'accompaniment';
  return 'unassigned';
}

function groupingForMeasure(measure: MidiMeasure): number[] {
  const { numerator, denominator } = measure.meter;
  if (denominator === 8 && numerator >= 6 && numerator % 3 === 0) {
    return new Array(numerator / 3).fill(3);
  }
  if (numerator === 4) return [2, 2];
  if (numerator === 5) return [3, 2];
  if (numerator === 7) return [3, 2, 2];
  return [numerator];
}

/**
 * Harmonic accent intentionally has a much wider dynamic range than the UI's
 * metric-strength score. A weak passing onset must not rival a downbeat chord.
 */
function harmonicMetricWeight(
  noteTick: number,
  measure: MidiMeasure,
  ppq: number,
): number {
  if (noteTick < measure.startTick) return 2.2;
  const unitTicks = ppq * 4 / measure.meter.denominator;
  const localUnits = (noteTick - measure.startTick) / unitTicks;
  if (!measure.isPickup && localUnits < 0.08) return 4;
  const nearestUnit = Math.round(localUnits);
  if (Math.abs(localUnits - nearestUnit) <= 0.08) {
    const groupStarts = new Set<number>();
    let cursor = 0;
    for (const group of groupingForMeasure(measure)) {
      groupStarts.add(cursor);
      cursor += group;
    }
    if (groupStarts.has(nearestUnit)) return 2.35;
    return 1.15;
  }
  if (Math.abs(localUnits * 2 - Math.round(localUnits * 2)) <= 0.1) return 0.48;
  return 0.24;
}

function durationEvidence(overlap: number, measureDuration: number): number {
  const ratio = Math.max(0, Math.min(1, overlap / Math.max(1, measureDuration)));
  return 0.25 + 0.75 * Math.sqrt(ratio);
}

function bassForMeasure(
  notes: ReadonlyArray<MidiNoteSpan>,
  voices: MidiVoiceSeparation,
  inventory: MidiInventory,
  measure: MidiMeasure,
  segment: HarmonicSegment,
  ppq: number,
): { pc: number | null; confidence: number; evidence: string[] } {
  const overlapping = notes.filter((note) =>
    note.startTick < segment.endTick
    && note.keyDownEndTick > segment.startTick
    && noteKind(voices, inventory, note) !== 'drums');
  const explicitBass = overlapping.filter((note) => noteKind(voices, inventory, note) === 'bass');
  const accompaniment = overlapping.filter((note) =>
    noteKind(voices, inventory, note) === 'accompaniment');
  const source = explicitBass.length > 0
    ? explicitBass
    : accompaniment.length > 0
      ? accompaniment
      : overlapping;
  if (source.length === 0) return { pc: null, confidence: 0, evidence: ['当前小节没有可用低音证据'] };

  const minimumPitch = Math.min(...source.map((note) => note.pitch));
  const lowRegister = source.filter((note) => note.pitch <= minimumPitch + 12);
  const weights = new Array<number>(12).fill(0);
  for (const note of lowRegister) {
    const overlap = Math.max(
      0,
      Math.min(segment.endTick, note.keyDownEndTick) - Math.max(segment.startTick, note.startTick),
    );
    const metric = note.startTick < segment.startTick
      ? 1.05
      : harmonicMetricWeight(note.startTick, measure, ppq);
    const registerWeight = 1 + Math.max(0, 60 - note.pitch) / 24;
    const duration = durationEvidence(overlap, segment.endTick - segment.startTick);
    const velocity = 0.55 + 0.45 * note.velocity / 127;
    weights[note.pitch % 12] += metric * registerWeight * duration * velocity;
  }
  const ranked = weights
    .map((weight, pc) => ({ pc, weight }))
    .sort((left, right) => right.weight - left.weight);
  const first = ranked[0];
  const second = ranked[1];
  if (!first || first.weight <= 0) {
    return { pc: null, confidence: 0, evidence: ['当前小节低音权重为零'] };
  }
  const dominance = first.weight / Math.max(first.weight + (second?.weight ?? 0), 1e-9);
  const confidence = explicitBass.length > 0
    ? Math.min(1, 0.58 + dominance * 0.42)
    : Math.min(0.62, 0.28 + dominance * 0.34);
  return {
    pc: first.pc,
    confidence,
    evidence: [
      explicitBass.length > 0 ? '使用分离出的 bass 声部' : '没有独立 bass，使用伴奏最低音域',
      `主拍加权低音 pc${first.pc}，相对次选优势 ${Math.round(dominance * 100)}%`,
    ],
  };
}

export function buildHarmonicWindows(
  document: RichSmfDocument,
  notes: ReadonlyArray<MidiNoteSpan>,
  inventory: MidiInventory,
  measures: MidiMeasureMap,
  voices: MidiVoiceSeparation,
  segments: ReadonlyArray<HarmonicSegment>,
): HarmonicWindow[] {
  if (!document.analysisSupport.supported || document.timeDivision.kind !== 'ppq') return [];
  const ppq = document.timeDivision.ppq;
  const measureById = new Map(measures.measures.map((measure) => [measure.id, measure]));
  return segments.flatMap((segment) => {
    const measure = measureById.get(segment.measureId);
    if (!measure) return [];
    const accompaniment = new Array<number>(12).fill(0);
    const bassWeights = new Array<number>(12).fill(0);
    const melody = new Array<number>(12).fill(0);
    const other = new Array<number>(12).fill(0);
    const strongBeat = new Array<number>(12).fill(0);
    const contributingNoteIds: string[] = [];

    for (const note of notes) {
      const overlapStart = Math.max(segment.startTick, note.startTick);
      const overlapEnd = Math.min(segment.endTick, note.keyDownEndTick);
      if (overlapEnd <= overlapStart) continue;
      const kind = noteKind(voices, inventory, note);
      if (kind === 'drums') continue;
      const metric = note.startTick < segment.startTick
        ? 0.68
        : harmonicMetricWeight(note.startTick, measure, ppq);
      const duration = durationEvidence(
        overlapEnd - overlapStart,
        segment.endTick - segment.startTick,
      );
      const velocity = 0.55 + 0.45 * note.velocity / 127;
      const evidence = metric * duration * velocity;
      const pc = note.pitch % 12;
      if (kind === 'accompaniment') accompaniment[pc] += evidence;
      else if (kind === 'bass') bassWeights[pc] += evidence;
      else if (kind === 'melody') melody[pc] += evidence;
      else other[pc] += evidence;
      if (metric >= 2.2 && kind !== 'melody') strongBeat[pc] += evidence;
      contributingNoteIds.push(note.id);
    }

    const combined = accompaniment.map((value, pc) =>
      value
      + bassWeights[pc] * 0.55
      + strongBeat[pc] * 0.32
      + other[pc] * 0.42
      + melody[pc] * 0.12);
    const totals = {
      accompaniment: accompaniment.reduce((sum, value) => sum + value, 0),
      bass: bassWeights.reduce((sum, value) => sum + value, 0),
      strongBeat: strongBeat.reduce((sum, value) => sum + value, 0),
      melody: melody.reduce((sum, value) => sum + value, 0),
      other: other.reduce((sum, value) => sum + value, 0),
    };
    const bass = bassForMeasure(notes, voices, inventory, measure, segment, ppq);
    return [{
      id: `hw-${segment.id}`,
      measureId: segment.measureId,
      measureLabel: segment.measureLabel,
      measureIndex: segment.measureIndex,
      segmentIndex: segment.segmentIndex,
      segmentCount: segment.segmentCount,
      segmentLabel: segment.segmentLabel,
      startTick: segment.startTick,
      endTick: segment.endTick,
      pitchClassWeights: normalize(combined),
      accompanimentPitchClassWeights: normalize(accompaniment),
      bassPitchClassWeights: normalize(bassWeights),
      strongBeatPitchClassWeights: normalize(strongBeat),
      melodyPitchClassWeights: normalize(melody),
      bassPc: bass.pc,
      bassConfidence: bass.confidence,
      evidenceTotals: totals,
      evidence: [
        `伴奏证据 ${totals.accompaniment.toFixed(2)}`,
        `bass 证据 ${totals.bass.toFixed(2)}`,
        `主/次重拍证据 ${totals.strongBeat.toFixed(2)}`,
        `旋律降权证据 ${totals.melody.toFixed(2)}`,
        ...bass.evidence,
      ],
      contributingNoteIds,
    }];
  });
}
