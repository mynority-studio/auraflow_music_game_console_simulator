import type {
  HarmonicBoundary,
  HarmonicSegment,
  MidiDerivedVoiceKind,
  MidiInventory,
  MidiMeasure,
  MidiMeasureMap,
  MidiNoteSpan,
  MidiVoiceSeparation,
  RichSmfDocument,
} from './types';

interface OnsetGroup {
  tick: number;
  notes: MidiNoteSpan[];
  accompaniment: MidiNoteSpan[];
  bass: MidiNoteSpan[];
}

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
  // A lower voice derived from a piano lane is useful in the note-layer UI,
  // but it is not equivalent to an independently authored Bass Lane. Keep it
  // in accompaniment evidence here so it cannot create a boundary by itself.
  if (separated === 'bass' && registerDerivedBassIds(voices).has(note.id)) {
    return 'accompaniment';
  }
  if (separated) return separated;
  const lane = inventory.lanes.find((candidate) =>
    candidate.trackIndex === note.trackIndex && candidate.channel === note.channel);
  if (lane?.role === 'bass') return 'bass';
  if (lane?.role === 'comp' || lane?.role === 'pad') return 'accompaniment';
  if (lane?.role === 'lead') return 'melody';
  if (lane?.role === 'drum') return 'drums';
  return 'unassigned';
}

function groupOnsets(
  notes: ReadonlyArray<MidiNoteSpan>,
  toleranceTicks: number,
  voices: MidiVoiceSeparation,
  inventory: MidiInventory,
): OnsetGroup[] {
  const sorted = [...notes].sort((left, right) =>
    (left.startTick - right.startTick) || (left.pitch - right.pitch));
  const groups: MidiNoteSpan[][] = [];
  for (const note of sorted) {
    const current = groups[groups.length - 1];
    if (!current || note.startTick - current[0].startTick > toleranceTicks) {
      groups.push([note]);
    } else {
      current.push(note);
    }
  }
  return groups.map((group) => {
    const accompaniment = group.filter((note) => {
      const kind = noteKind(voices, inventory, note);
      return kind === 'accompaniment' || kind === 'unassigned';
    });
    const bass = group.filter((note) => noteKind(voices, inventory, note) === 'bass');
    return {
      tick: Math.min(...group.map((note) => note.startTick)),
      notes: group,
      accompaniment,
      bass,
    };
  });
}

function pitchClassSet(notes: ReadonlyArray<MidiNoteSpan>): Set<number> {
  return new Set(notes.map((note) => note.pitch % 12));
}

function setDistance(left: ReadonlySet<number>, right: ReadonlySet<number>): number {
  if (left.size === 0 && right.size === 0) return 0;
  const intersection = Array.from(left).filter((pitchClass) => right.has(pitchClass)).length;
  const union = new Set([...left, ...right]).size;
  return union > 0 ? 1 - intersection / union : 0;
}

function previousAccompanimentSignature(
  tick: number,
  measure: MidiMeasure,
  notes: ReadonlyArray<MidiNoteSpan>,
  voices: MidiVoiceSeparation,
  inventory: MidiInventory,
  ppq: number,
): Set<number> {
  const accompaniment = notes.filter((note) => {
    const kind = noteKind(voices, inventory, note);
    if (kind !== 'accompaniment' && kind !== 'unassigned') return false;
    const soundingAtBoundary = note.startTick < tick && note.keyDownEndTick >= tick;
    const recentAttack = note.startTick >= Math.max(measure.startTick, tick - ppq * 2)
      && note.startTick < tick;
    return soundingAtBoundary || recentAttack;
  });
  return pitchClassSet(accompaniment);
}

function previousBassPc(
  tick: number,
  notes: ReadonlyArray<MidiNoteSpan>,
  voices: MidiVoiceSeparation,
  inventory: MidiInventory,
): number | null {
  const prior = notes
    .filter((note) => note.startTick < tick && noteKind(voices, inventory, note) === 'bass')
    .sort((left, right) => (right.startTick - left.startTick) || (left.pitch - right.pitch));
  return prior[0] ? prior[0].pitch % 12 : null;
}

function strongMetricPosition(tick: number, measure: MidiMeasure, ppq: number): boolean {
  const unitTicks = ppq * 4 / measure.meter.denominator;
  const localUnit = (tick - measure.startTick) / unitTicks;
  const nearest = Math.round(localUnit);
  if (Math.abs(localUnit - nearest) > 0.08) return false;
  if (nearest === 0) return true;
  if (measure.meter.denominator === 8 && measure.meter.numerator >= 6
      && measure.meter.numerator % 3 === 0) {
    return nearest % 3 === 0;
  }
  if (measure.meter.numerator === 4) return nearest === 2;
  if (measure.meter.numerator === 5) return nearest === 3;
  if (measure.meter.numerator === 7) return nearest === 3 || nearest === 5;
  return false;
}

function beatMetricPosition(tick: number, measure: MidiMeasure, ppq: number): boolean {
  const unitTicks = ppq * 4 / measure.meter.denominator;
  const localUnit = (tick - measure.startTick) / unitTicks;
  return Math.abs(localUnit - Math.round(localUnit)) <= 0.08;
}

function boundariesForMeasure(
  measure: MidiMeasure,
  notes: ReadonlyArray<MidiNoteSpan>,
  voices: MidiVoiceSeparation,
  inventory: MidiInventory,
  ppq: number,
): HarmonicBoundary[] {
  const tolerance = Math.max(1, Math.round(ppq / 16));
  const minimumSegmentTicks = Math.max(1, Math.round(ppq / 2));
  const measureOnsets = notes.filter((note) =>
    note.startTick > measure.startTick
    && note.startTick < measure.endTick
    && !['drums', 'melody'].includes(noteKind(voices, inventory, note)));
  const groups = groupOnsets(measureOnsets, tolerance, voices, inventory);
  const hasAccompaniment = notes.some((note) =>
    note.startTick < measure.endTick
    && note.keyDownEndTick > measure.startTick
    && noteKind(voices, inventory, note) === 'accompaniment');
  const result: HarmonicBoundary[] = [];
  let previousBoundary = measure.startTick;

  for (const group of groups) {
    if (group.tick - previousBoundary < minimumSegmentTicks) continue;
    if (measure.endTick - group.tick < minimumSegmentTicks) continue;
    const priorComp = previousAccompanimentSignature(
      group.tick,
      measure,
      notes,
      voices,
      inventory,
      ppq,
    );
    const nextComp = pitchClassSet(group.accompaniment);
    const compDistance = setDistance(priorComp, nextComp);
    const priorBass = previousBassPc(group.tick, notes, voices, inventory);
    const nextBass = group.bass.length > 0
      ? Math.min(...group.bass.map((note) => note.pitch)) % 12
      : null;
    const bassChanged = priorBass !== null && nextBass !== null && priorBass !== nextBass;
    const blockAttack = group.accompaniment.length >= 2;
    const coordinatedAttack = group.accompaniment.length >= 1 && group.bass.length >= 1;
    const bassOnlyStrong = !hasAccompaniment
      && group.bass.length >= 1
      && strongMetricPosition(group.tick, measure, ppq);
    const metricStrong = strongMetricPosition(group.tick, measure, ppq);
    const metricBeat = beatMetricPosition(group.tick, measure, ppq);
    const blockChange = blockAttack
      && compDistance >= 0.34
      && (
        bassChanged
        || metricStrong
        || (group.bass.length === 0 && metricBeat)
      );
    const accepted = blockChange
      || (coordinatedAttack && bassChanged)
      || bassOnlyStrong;
    if (!accepted) continue;

    const sources: HarmonicBoundary['sources'][number][] = [];
    if (group.accompaniment.length > 0) sources.push('accompanimentAttack');
    if (group.bass.length > 0) sources.push('bassAttack');
    if (compDistance >= 0.34) sources.push('pitchSetChange');
    const confidence = Math.min(
      0.98,
      0.48
        + (blockAttack ? 0.18 : 0)
        + (bassChanged ? 0.16 : 0)
        + Math.min(0.16, compDistance * 0.2),
    );
    result.push({
      id: `hb-${measure.id}-${result.length}`,
      measureId: measure.id,
      measureLabel: measure.label,
      tick: group.tick,
      confidence,
      sources,
      evidence: [
        `伴奏同时起音 ${group.accompaniment.length} 个`,
        `bass 同时起音 ${group.bass.length} 个`,
        `前后伴奏音集距离 ${compDistance.toFixed(2)}`,
        bassChanged ? `bass ${priorBass}→${nextBass}` : 'bass 未提供明确根音变化',
      ],
    });
    previousBoundary = group.tick;
  }
  return result;
}

export function detectHarmonicSegments(
  document: RichSmfDocument,
  notes: ReadonlyArray<MidiNoteSpan>,
  inventory: MidiInventory,
  measures: MidiMeasureMap,
  voices: MidiVoiceSeparation,
): { boundaries: HarmonicBoundary[]; segments: HarmonicSegment[] } {
  if (!document.analysisSupport.supported || document.timeDivision.kind !== 'ppq') {
    return { boundaries: [], segments: [] };
  }
  const ppq = document.timeDivision.ppq;
  const boundaries: HarmonicBoundary[] = [];
  const segments: HarmonicSegment[] = [];
  for (const measure of measures.measures) {
    const internal = boundariesForMeasure(measure, notes, voices, inventory, ppq);
    boundaries.push(...internal);
    const ticks = [measure.startTick, ...internal.map((boundary) => boundary.tick), measure.endTick];
    const segmentCount = ticks.length - 1;
    for (let index = 0; index < segmentCount; index++) {
      segments.push({
        id: `hs-${measure.id}-${index}`,
        measureId: measure.id,
        measureLabel: measure.label,
        measureIndex: measure.index,
        segmentIndex: index,
        segmentCount,
        segmentLabel: segmentCount === 1 ? measure.label : `${measure.label}.${index + 1}`,
        startTick: ticks[index],
        endTick: ticks[index + 1],
      });
    }
  }
  return { boundaries, segments };
}
