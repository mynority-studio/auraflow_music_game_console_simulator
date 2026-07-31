import {
  getChordPitchClasses,
  isKnownChordType,
  type ChordTypeId,
} from '../../generation/newEngine/knowledge/chords';
import type {
  DecodedChordSpan,
  KeyCandidate,
  MidiAnalyzedNote,
  MidiDerivedVoiceKind,
  MidiHarmonyAnalysis,
  MidiInventory,
  MidiMeasure,
  MidiMeasureMap,
  MidiMeasureNoteLayer,
  MidiMeasureVoiceSummary,
  MidiMelodicFunction,
  MidiMetricLevel,
  MidiNoteLayerAnalysis,
  MidiNoteSpan,
  MidiStructuralRole,
  MidiVoiceSeparation,
  RichSmfDocument,
} from './types';

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const modulo = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;

interface MetricPosition {
  beatPosition: number;
  level: MidiMetricLevel;
  strength: number;
}

interface NoteNeighbors {
  previous: MidiNoteSpan | null;
  next: MidiNoteSpan | null;
  linear: boolean;
}

interface FunctionResult {
  value: MidiMelodicFunction;
  confidence: number;
  evidence: string[];
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

function metricPosition(
  tick: number,
  measure: MidiMeasure,
  ppq: number,
): MetricPosition {
  const unitTicks = ppq * 4 / measure.meter.denominator;
  const measureUnits = (measure.endTick - measure.startTick) / unitTicks;
  const pickupOffset = measure.isPickup
    ? Math.max(0, measure.meter.numerator - measureUnits)
    : 0;
  const localUnits = (tick - measure.startTick) / unitTicks;
  const absoluteUnits = pickupOffset + localUnits;
  const nearestUnit = Math.round(absoluteUnits);
  const unitDistance = Math.abs(absoluteUnits - nearestUnit);
  const beatPosition = absoluteUnits + 1;
  if (!measure.isPickup && localUnits < 0.08) {
    return { beatPosition, level: 'downbeat', strength: 1 };
  }
  if (unitDistance <= 0.08) {
    const groupStarts = new Set<number>();
    let cursor = 0;
    for (const group of groupingForMeasure(measure)) {
      groupStarts.add(cursor);
      cursor += group;
    }
    if (groupStarts.has(modulo(nearestUnit, measure.meter.numerator))) {
      return { beatPosition, level: 'strongBeat', strength: 0.82 };
    }
    return { beatPosition, level: 'beat', strength: 0.62 };
  }
  if (Math.abs(absoluteUnits * 2 - Math.round(absoluteUnits * 2)) <= 0.1) {
    return { beatPosition, level: 'subdivision', strength: 0.34 };
  }
  return { beatPosition, level: 'offbeat', strength: 0.18 };
}

function chordPitchClasses(span: DecodedChordSpan | null): Set<number> | null {
  if (span?.rootPc === null || span?.rootPc === undefined || !span.type) return null;
  if (!isKnownChordType(span.type)) return new Set([span.rootPc]);
  return new Set(getChordPitchClasses(span.rootPc as never, span.type as ChordTypeId));
}

function keyPitchClasses(key: KeyCandidate | null): Set<number> | null {
  if (!key) return null;
  const scale = key.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  return new Set(scale.map((interval) => (key.tonicPc + interval) % 12));
}

function noteNeighbors(
  notes: ReadonlyArray<MidiNoteSpan>,
  inventory: MidiInventory,
  voices: MidiVoiceSeparation,
): Map<string, NoteNeighbors> {
  const groups = new Map<string, MidiNoteSpan[]>();
  const laneById = new Map(inventory.lanes.map((lane) => [lane.id, lane]));
  for (const note of notes) {
    const laneId = `t${note.trackIndex}:ch${note.channel}`;
    const kind = voices.notePartById[note.id] ?? 'unassigned';
    const groupKey = `${laneId}:${kind}`;
    const group = groups.get(groupKey) ?? [];
    group.push(note);
    groups.set(groupKey, group);
  }
  const result = new Map<string, NoteNeighbors>();
  for (const [groupKey, group] of groups) {
    group.sort((left, right) =>
      (left.startTick - right.startTick) || (left.pitch - right.pitch) || left.id.localeCompare(right.id));
    const laneId = groupKey.slice(0, groupKey.lastIndexOf(':'));
    const kind = groupKey.slice(groupKey.lastIndexOf(':') + 1) as MidiDerivedVoiceKind;
    const lane = laneById.get(laneId);
    const linear = kind === 'melody'
      || kind === 'bass'
      || (kind !== 'drums' && (lane?.maxSimultaneousNotes ?? 2) <= 1);
    for (let index = 0; index < group.length; index++) {
      result.set(group[index].id, {
        previous: index > 0 ? group[index - 1] : null,
        next: index + 1 < group.length ? group[index + 1] : null,
        linear,
      });
    }
  }
  return result;
}

function melodicFunction(
  note: MidiNoteSpan,
  isOnset: boolean,
  voiceKind: MidiDerivedVoiceKind,
  neighbors: NoteNeighbors,
  currentChordPcs: ReadonlySet<number> | null,
  nextChordPcs: ReadonlySet<number> | null,
  scalePcs: ReadonlySet<number> | null,
  metric: MetricPosition,
  harmonicProgress: number,
): FunctionResult {
  if (voiceKind === 'drums') {
    return { value: 'percussion', confidence: 1, evidence: ['鼓声部不参与音高功能分类'] };
  }
  const pitchClass = note.pitch % 12;
  const isChordTone = currentChordPcs?.has(pitchClass) ?? null;
  const previous = neighbors.previous;
  const next = neighbors.next;
  const previousInterval = previous ? note.pitch - previous.pitch : null;
  const nextInterval = next ? next.pitch - note.pitch : null;
  const previousStep = previousInterval !== null
    && Math.abs(previousInterval) >= 1 && Math.abs(previousInterval) <= 2;
  const nextStep = nextInterval !== null
    && Math.abs(nextInterval) >= 1 && Math.abs(nextInterval) <= 2;
  const nextResolvesToChord = next
    ? currentChordPcs?.has(next.pitch % 12) ?? false
    : false;

  if (!isOnset) {
    if (isChordTone === true) {
      return {
        value: 'sustainedChordTone',
        confidence: 0.94,
        evidence: ['音符由前一位置延续进入当前小节，且属于当前和弦'],
      };
    }
    if (isChordTone === false && nextStep && nextResolvesToChord) {
      return {
        value: 'suspension',
        confidence: 0.84,
        evidence: ['延留音跨入当前和声，并以级进解决到和弦音'],
      };
    }
  }

  if (isChordTone === true) {
    return { value: 'chordTone', confidence: 0.96, evidence: ['音级属于当前和弦切片'] };
  }
  if (neighbors.linear && previous && next) {
    if (previousStep && nextStep
        && Math.sign(previousInterval as number) === Math.sign(nextInterval as number)) {
      return {
        value: 'passingTone',
        confidence: metric.strength >= 0.8 ? 0.68 : 0.88,
        evidence: ['前后音同方向级进，形成经过运动'],
      };
    }
    if (previousStep && nextStep && Math.abs(previous.pitch - next.pitch) <= 1) {
      return {
        value: 'neighborTone',
        confidence: 0.88,
        evidence: ['由骨干音级进离开后回到相同音高'],
      };
    }
    if (metric.strength >= 0.8 && Math.abs(previousInterval as number) >= 3
        && nextStep && nextResolvesToChord) {
      return {
        value: 'appoggiatura',
        confidence: 0.8,
        evidence: ['重拍上的非和弦音由跳进进入，并以级进解决'],
      };
    }
    if (previousStep && Math.abs(nextInterval as number) >= 3) {
      return {
        value: 'escapeTone',
        confidence: 0.76,
        evidence: ['级进进入后跳进离开，符合逸音轮廓'],
      };
    }
  }
  if (isChordTone === false && harmonicProgress >= 0.7 && nextChordPcs?.has(pitchClass)) {
    return {
      value: 'anticipation',
      confidence: 0.82,
      evidence: ['当前切片末尾提前出现下一和弦音'],
    };
  }
  if (isChordTone === false && scalePcs?.has(pitchClass)) {
    return {
      value: 'scaleNonChordTone',
      confidence: 0.74,
      evidence: ['属于当前调性音阶，但不属于当前和弦切片'],
    };
  }
  if (isChordTone === false) {
    return {
      value: 'nonChordTone',
      confidence: currentChordPcs ? 0.78 : 0.4,
      evidence: ['音级不属于当前和弦切片，邻接关系不足以进一步命名'],
    };
  }
  return {
    value: 'unknown',
    confidence: 0.25,
    evidence: ['当前小节没有可用和弦，无法判定和弦内外音'],
  };
}

function structuralRole(
  chordTone: boolean | null,
  melodic: MidiMelodicFunction,
  metric: MetricPosition,
  performedAccent: number,
  durationBeats: number,
  voiceKind: MidiDerivedVoiceKind,
  isOnset: boolean,
): { role: MidiStructuralRole; score: number; evidence: string[] } {
  let score = chordTone === true ? 0.35 : chordTone === null ? 0.15 : 0;
  score += metric.strength * 0.3;
  score += clamp01(durationBeats / 2) * 0.18;
  score += performedAccent * 0.12;
  if (voiceKind === 'bass') score += 0.12;
  else if (voiceKind === 'melody' || voiceKind === 'accompaniment') score += 0.08;
  if (isOnset && metric.level === 'downbeat') score += 0.04;

  if (['passingTone', 'neighborTone', 'anticipation', 'escapeTone'].includes(melodic)) score -= 0.34;
  else if (melodic === 'nonChordTone') score -= 0.18;
  else if (melodic === 'scaleNonChordTone') score -= 0.12;
  else if (melodic === 'appoggiatura' || melodic === 'suspension') score -= 0.08;
  if (voiceKind === 'drums') score = 0;
  score = clamp01(score);

  const role: MidiStructuralRole = score >= 0.62
    ? 'backbone'
    : score <= 0.4
      ? 'ornament'
      : 'ambiguous';
  return {
    role,
    score,
    evidence: [
      `拍位强度 ${metric.strength.toFixed(2)}`,
      `演奏重音 ${performedAccent.toFixed(2)}`,
      `当前拍单位时值 ${durationBeats.toFixed(2)}`,
      chordTone === null ? '和弦内外音未知' : chordTone ? '和弦音加权' : '非和弦音不加权',
    ],
  };
}

function voiceSummaries(notes: ReadonlyArray<MidiAnalyzedNote>): MidiMeasureVoiceSummary[] {
  const kinds: MidiDerivedVoiceKind[] = ['melody', 'accompaniment', 'bass', 'drums', 'unassigned'];
  return kinds.flatMap((kind) => {
    const matching = notes.filter((note) => note.voiceKind === kind && note.isOnset);
    if (matching.length === 0) return [];
    return [{
      kind,
      noteCount: matching.length,
      minPitch: Math.min(...matching.map((note) => note.pitch)),
      maxPitch: Math.max(...matching.map((note) => note.pitch)),
    }];
  });
}

export function analyzeMidiNoteLayers(
  document: RichSmfDocument,
  notes: ReadonlyArray<MidiNoteSpan>,
  inventory: MidiInventory,
  measures: MidiMeasureMap,
  voices: MidiVoiceSeparation,
  harmony: MidiHarmonyAnalysis,
): MidiNoteLayerAnalysis {
  if (!document.analysisSupport.supported || document.timeDivision.kind !== 'ppq') {
    return { measures: [], warnings: ['非 SMF 0/1 PPQ 文件，无法执行逐小节音符分析'] };
  }
  const ppq = document.timeDivision.ppq;
  const neighborsByNoteId = noteNeighbors(notes, inventory, voices);
  const harmonicWindowById = new Map(
    harmony.windows.map((analysis) => [analysis.window.id, analysis.window]),
  );
  const chordsByMeasureId = new Map<string, DecodedChordSpan[]>();
  for (const chord of harmony.chordTimeline) {
    const window = harmonicWindowById.get(chord.sourceWindowIds[0]);
    if (window) {
      const current = chordsByMeasureId.get(window.measureId) ?? [];
      current.push(chord);
      chordsByMeasureId.set(window.measureId, current);
    }
  }
  const scalePcs = keyPitchClasses(harmony.analysisKey);
  const layers: MidiMeasureNoteLayer[] = measures.measures.map((measure) => {
    const measureChords = chordsByMeasureId.get(measure.id) ?? [];
    const overlapping = notes.filter((note) =>
      note.startTick < measure.endTick && note.soundingEndTick > measure.startTick);
    const onsetCounts = new Map<number, number>();
    for (const note of overlapping) {
      if (note.startTick >= measure.startTick && note.startTick < measure.endTick) {
        onsetCounts.set(note.startTick, (onsetCounts.get(note.startTick) ?? 0) + 1);
      }
    }
    const rawAccent = (note: MidiNoteSpan): number => note.startTick >= measure.startTick
      ? note.velocity / 127 * (1 + 0.12 * Math.max(0, (onsetCounts.get(note.startTick) ?? 1) - 1))
      : 0;
    const maximumAccent = Math.max(0, ...overlapping.map(rawAccent));
    const analyzed: MidiAnalyzedNote[] = overlapping.map((note) => {
      const clippedStartTick = Math.max(measure.startTick, note.startTick);
      const clippedEndTick = Math.min(measure.endTick, note.soundingEndTick);
      const isOnset = note.startTick >= measure.startTick && note.startTick < measure.endTick;
      const metric = metricPosition(isOnset ? note.startTick : measure.startTick, measure, ppq);
      const performedAccent = maximumAccent > 0 ? rawAccent(note) / maximumAccent : 0;
      const beatTicks = ppq * 4 / measure.meter.denominator;
      const durationBeats = (clippedEndTick - clippedStartTick) / Math.max(1, beatTicks);
      const voiceKind = voices.notePartById[note.id] ?? 'unassigned';
      const chordTick = isOnset ? note.startTick : clippedStartTick;
      const chordIndex = harmony.chordTimeline.findIndex((span) =>
        chordTick >= span.startTick && chordTick < span.endTick);
      const chord = chordIndex >= 0 ? harmony.chordTimeline[chordIndex] : null;
      const nextChord = chordIndex >= 0 ? harmony.chordTimeline[chordIndex + 1] ?? null : null;
      const currentChordPcs = chordPitchClasses(chord);
      const nextChordPcs = chordPitchClasses(nextChord);
      const chordTone = currentChordPcs ? currentChordPcs.has(note.pitch % 12) : null;
      const scaleTone = scalePcs ? scalePcs.has(note.pitch % 12) : null;
      const harmonicProgress = chord
        ? (note.startTick - chord.startTick) / Math.max(1, chord.endTick - chord.startTick)
        : (note.startTick - measure.startTick)
          / Math.max(1, measure.endTick - measure.startTick);
      const melodic = melodicFunction(
        note,
        isOnset,
        voiceKind,
        neighborsByNoteId.get(note.id) ?? { previous: null, next: null, linear: false },
        currentChordPcs,
        nextChordPcs,
        scalePcs,
        metric,
        harmonicProgress,
      );
      const structural = structuralRole(
        chordTone,
        melodic.value,
        metric,
        performedAccent,
        durationBeats,
        voiceKind,
        isOnset,
      );
      return {
        id: `${note.id}@${measure.id}`,
        noteId: note.id,
        measureId: measure.id,
        measureLabel: measure.label,
        laneId: `t${note.trackIndex}:ch${note.channel}`,
        trackIndex: note.trackIndex,
        channel: note.channel,
        pitch: note.pitch,
        velocity: note.velocity,
        originalStartTick: note.startTick,
        originalEndTick: note.soundingEndTick,
        keyDownEndTick: note.keyDownEndTick,
        soundingEndTick: note.soundingEndTick,
        pedalExtended: note.pedalExtended,
        clippedStartTick,
        clippedEndTick,
        isOnset,
        isCarriedIn: !isOnset,
        beatPosition: metric.beatPosition,
        metricLevel: metric.level,
        metricStrength: metric.strength,
        performedAccent,
        durationBeats,
        voiceKind,
        chordTone,
        scaleTone,
        melodicFunction: melodic.value,
        functionConfidence: melodic.confidence,
        structuralRole: structural.role,
        structuralScore: structural.score,
        evidence: [...melodic.evidence, ...structural.evidence],
      };
    }).sort((left, right) =>
      (left.clippedStartTick - right.clippedStartTick)
      || (left.trackIndex - right.trackIndex)
      || (left.channel - right.channel)
      || (left.pitch - right.pitch));
    return {
      measure,
      chordLabel: measureChords.map((chord) => chord.label).join(' → ') || 'N.C.',
      notes: analyzed,
      voices: voiceSummaries(analyzed),
    };
  });
  const warnings: string[] = [];
  if (layers.length === 0) warnings.push('没有可用小节，未生成音符分层');
  if (harmony.chordTimeline.length === 0) {
    warnings.push('没有可用和弦；骨干分数仅依据拍位、时值、力度和声部，和弦内外音保持未知');
  }
  return { measures: layers, warnings };
}
