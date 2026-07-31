import type {
  MidiAccompanimentTexture,
  MidiDerivedVoiceKind,
  MidiDerivedVoicePart,
  MidiInventory,
  MidiLaneTextureAnalysis,
  MidiMeasureMap,
  MidiNoteSpan,
  MidiTextureScores,
  MidiVoiceSeparation,
  RichSmfDocument,
} from './types';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function mean(values: ReadonlyArray<number>): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function pitchStats(notes: ReadonlyArray<MidiNoteSpan>): Pick<
  MidiDerivedVoicePart,
  'noteCount' | 'minPitch' | 'maxPitch' | 'meanPitch'
> {
  const pitches = notes.map((note) => note.pitch);
  return {
    noteCount: notes.length,
    minPitch: pitches.length > 0 ? Math.min(...pitches) : null,
    maxPitch: pitches.length > 0 ? Math.max(...pitches) : null,
    meanPitch: pitches.length > 0 ? mean(pitches) : null,
  };
}

function onsetRegularity(notes: ReadonlyArray<MidiNoteSpan>): number {
  const onsets = Array.from(new Set(notes.map((note) => note.startTick))).sort((a, b) => a - b);
  if (onsets.length < 3) return 0;
  const intervals = onsets.slice(1).map((tick, index) => tick - onsets[index]);
  const average = mean(intervals);
  if (average <= 0) return 0;
  const variance = mean(intervals.map((value) => (value - average) ** 2));
  return clamp01(1 - Math.sqrt(variance) / average);
}

function repeatedMeasurePatternRatio(
  notes: ReadonlyArray<MidiNoteSpan>,
  measures: MidiMeasureMap,
): number {
  const signatures: string[] = [];
  for (const measure of measures.measures) {
    const inside = notes
      .filter((note) => note.startTick >= measure.startTick && note.startTick < measure.endTick)
      .sort((a, b) => (a.startTick - b.startTick) || (a.pitch - b.pitch));
    if (inside.length < 3) continue;
    const length = Math.max(1, measure.endTick - measure.startTick);
    const lowest = Math.min(...inside.map((note) => note.pitch));
    signatures.push(inside.map((note) => {
      const phase16 = Math.round((note.startTick - measure.startTick) / length * 16);
      return `${phase16}:${note.pitch - lowest}`;
    }).join('|'));
  }
  if (signatures.length < 2) return 0;
  const counts = new Map<string, number>();
  for (const signature of signatures) counts.set(signature, (counts.get(signature) ?? 0) + 1);
  return Math.max(...counts.values()) / signatures.length;
}

function textureForNotes(
  laneId: string,
  notes: ReadonlyArray<MidiNoteSpan>,
  measures: MidiMeasureMap,
  ppq: number,
): MidiLaneTextureAnalysis {
  if (notes.length === 0) {
    return {
      laneId,
      texture: 'none',
      confidence: 1,
      scores: { block: 0, arpeggio: 0, sustained: 0 },
      onsetClusterRatio: 0,
      onsetRegularity: 0,
      repeatedMeasurePatternRatio: 0,
      evidence: ['该声部没有音符'],
    };
  }
  const onsetCounts = new Map<number, number>();
  for (const note of notes) onsetCounts.set(note.startTick, (onsetCounts.get(note.startTick) ?? 0) + 1);
  const clusteredNotes = notes.filter((note) => (onsetCounts.get(note.startTick) ?? 0) >= 2).length;
  const clusterRatio = clusteredNotes / notes.length;
  const maximumCluster = Math.max(...onsetCounts.values());
  const regularity = onsetRegularity(notes);
  const repetition = repeatedMeasurePatternRatio(notes, measures);
  const meanDurationQuarter = mean(
    notes.map((note) => Math.max(0, note.keyDownEndTick - note.startTick) / ppq),
  );
  const onsetsPerMeasure = onsetCounts.size / Math.max(1, measures.measures.length);
  const density = clamp01((onsetsPerMeasure - 2) / 6);
  const scores: MidiTextureScores = {
    block: clamp01(clusterRatio * 0.78 + (maximumCluster >= 3 ? 0.22 : maximumCluster === 2 ? 0.1 : 0)),
    arpeggio: clamp01(
      regularity * 0.38
      + (1 - clusterRatio) * 0.27
      + repetition * 0.2
      + density * 0.15,
    ),
    sustained: clamp01(clamp01(meanDurationQuarter / 3) * 0.82 + (maximumCluster >= 3 ? 0.18 : 0)),
  };

  let texture: MidiAccompanimentTexture = 'unknown';
  let confidence = Math.max(scores.block, scores.arpeggio, scores.sustained);
  const sorted = (Object.entries(scores) as Array<[keyof MidiTextureScores, number]>)
    .sort((left, right) => right[1] - left[1]);
  if (scores.block >= 0.62 && scores.arpeggio >= 0.58 && Math.abs(scores.block - scores.arpeggio) < 0.12) {
    texture = 'mixed';
    confidence = Math.max(scores.block, scores.arpeggio);
  } else if (sorted[0][1] >= 0.58) {
    texture = sorted[0][0];
  }
  const evidence = [
    `同时起音音符 ${(clusterRatio * 100).toFixed(0)}%`,
    `起音规律度 ${(regularity * 100).toFixed(0)}%`,
    `跨小节重复 ${(repetition * 100).toFixed(0)}%`,
    `平均时值 ${meanDurationQuarter.toFixed(2)} 拍`,
  ];
  return {
    laneId,
    texture,
    confidence: clamp01(confidence),
    scores,
    onsetClusterRatio: clusterRatio,
    onsetRegularity: regularity,
    repeatedMeasurePatternRatio: repetition,
    evidence,
  };
}

function bestRegisterSplit(notes: ReadonlyArray<MidiNoteSpan>): number | null {
  if (notes.length < 6) return null;
  const pitches = [...notes.map((note) => note.pitch)].sort((a, b) => a - b);
  if (pitches[pitches.length - 1] - pitches[0] < 14) return null;
  let best: { threshold: number; score: number } | null = null;
  for (let index = 0; index + 1 < pitches.length; index++) {
    const gap = pitches[index + 1] - pitches[index];
    if (gap < 7) continue;
    const lowCount = index + 1;
    const highCount = pitches.length - lowCount;
    const balance = Math.min(lowCount, highCount) / pitches.length;
    if (balance < 0.15) continue;
    const score = gap + balance * 4;
    if (!best || score > best.score) {
      best = { threshold: (pitches[index] + pitches[index + 1]) / 2, score };
    }
  }
  return best?.threshold ?? null;
}

function medianPitch(notes: ReadonlyArray<MidiNoteSpan>): number | null {
  if (notes.length === 0) return null;
  const pitches = notes.map((note) => note.pitch).sort((left, right) => left - right);
  const middle = Math.floor(pitches.length / 2);
  return pitches.length % 2 === 0
    ? (pitches[middle - 1] + pitches[middle]) / 2
    : pitches[middle];
}

function extractRegisterBass(
  notes: ReadonlyArray<MidiNoteSpan>,
): { bass: MidiNoteSpan[]; remainder: MidiNoteSpan[]; evidence: string[] } | null {
  if (notes.length < 12) return null;
  const pitches = notes.map((note) => note.pitch);
  const range = Math.max(...pitches) - Math.min(...pitches);
  if (range < 18) return null;
  const median = medianPitch(notes);
  if (median === null) return null;
  const upperLimit = Math.min(55, median);
  const lowestByOnset = new Map<number, MidiNoteSpan>();
  for (const note of notes) {
    const current = lowestByOnset.get(note.startTick);
    if (!current || note.pitch < current.pitch) lowestByOnset.set(note.startTick, note);
  }
  const bass = Array.from(lowestByOnset.values())
    .filter((note) => note.pitch <= upperLimit);
  const bassIds = new Set(bass.map((note) => note.id));
  const remainder = notes.filter((note) => !bassIds.has(note.id));
  const ratio = bass.length / notes.length;
  if (bass.length < 4 || remainder.length < 4 || ratio < 0.08 || ratio > 0.65) return null;
  const bassMean = mean(bass.map((note) => note.pitch));
  const remainderMean = mean(remainder.map((note) => note.pitch));
  if (remainderMean - bassMean < 7) return null;
  return {
    bass,
    remainder,
    evidence: [
      `无独立 Bass Lane，从宽音域钢琴织体提取每次起音的最低声部`,
      `低音上限 MIDI ${upperLimit.toFixed(1)}，均值比其余声部低 ${(remainderMean - bassMean).toFixed(1)} 半音`,
    ],
  };
}

function makePart(
  laneId: string,
  suffix: string,
  kind: MidiDerivedVoiceKind,
  notes: ReadonlyArray<MidiNoteSpan>,
  confidence: number,
  evidence: ReadonlyArray<string>,
): MidiDerivedVoicePart {
  return {
    id: `${laneId}:${suffix}`,
    sourceLaneId: laneId,
    kind,
    noteIds: notes.map((note) => note.id),
    ...pitchStats(notes),
    confidence,
    evidence,
  };
}

export function separateMidiVoices(
  document: RichSmfDocument,
  notes: ReadonlyArray<MidiNoteSpan>,
  inventory: MidiInventory,
  measures: MidiMeasureMap,
): MidiVoiceSeparation {
  const ppq = document.timeDivision.kind === 'ppq' ? document.timeDivision.ppq : 1;
  const parts: MidiDerivedVoicePart[] = [];
  const laneTextures: MidiLaneTextureAnalysis[] = [];
  const notePartById: Record<string, MidiDerivedVoiceKind> = {};
  const warnings: string[] = [];
  const hasExplicitBassLane = inventory.lanes.some((lane) =>
    lane.role === 'bass' && lane.noteCount > 0);
  const notesByLane = new Map<string, MidiNoteSpan[]>();
  for (const note of notes) {
    const id = `t${note.trackIndex}:ch${note.channel}`;
    const laneNotes = notesByLane.get(id) ?? [];
    laneNotes.push(note);
    notesByLane.set(id, laneNotes);
  }
  const derivedBassLaneId = hasExplicitBassLane
    ? null
    : inventory.lanes
      .filter((lane) =>
        lane.noteCount > 0
        && lane.maxSimultaneousNotes >= 2
        && lane.role !== 'bass'
        && lane.role !== 'lead'
        && lane.role !== 'drum')
      .map((lane) => ({
        laneId: lane.id,
        split: extractRegisterBass(notesByLane.get(lane.id) ?? []),
      }))
      .filter((candidate): candidate is {
        laneId: string;
        split: NonNullable<ReturnType<typeof extractRegisterBass>>;
      } => candidate.split !== null)
      .sort((left, right) =>
        mean(left.split.bass.map((note) => note.pitch))
        - mean(right.split.bass.map((note) => note.pitch)))[0]?.laneId ?? null;

  for (const lane of inventory.lanes) {
    const laneNotes = notesByLane.get(lane.id) ?? [];
    if (laneNotes.length === 0) {
      laneTextures.push(textureForNotes(lane.id, [], measures, ppq));
      continue;
    }
    if (lane.role === 'drum') {
      const part = makePart(lane.id, 'drums', 'drums', laneNotes, 0.98, ['MIDI Channel 10 / drum Lane']);
      parts.push(part);
      laneTextures.push({
        ...textureForNotes(lane.id, [], measures, ppq),
        texture: 'none',
        evidence: ['鼓声部不参与和声伴奏织体分类'],
      });
      for (const note of laneNotes) notePartById[note.id] = 'drums';
      continue;
    }

    const threshold = lane.role === 'bass' ? null : bestRegisterSplit(laneNotes);
    let melodyNotes: MidiNoteSpan[] = [];
    let accompanimentNotes = [...laneNotes];
    if (threshold !== null) {
      const upper = laneNotes.filter((note) => note.pitch > threshold);
      const lower = laneNotes.filter((note) => note.pitch <= threshold);
      const highestByOnset = new Map<number, MidiNoteSpan>();
      for (const note of upper) {
        const current = highestByOnset.get(note.startTick);
        if (!current || note.pitch > current.pitch) highestByOnset.set(note.startTick, note);
      }
      melodyNotes = Array.from(highestByOnset.values());
      const melodyIds = new Set(melodyNotes.map((note) => note.id));
      accompanimentNotes = [...lower, ...upper.filter((note) => !melodyIds.has(note.id))];
      const lowerTexture = textureForNotes(lane.id, accompanimentNotes, measures, ppq);
      const lowerOnsets = new Set(lower.map((note) => note.startTick));
      const independentUpperRatio = melodyNotes.length > 0
        ? melodyNotes.filter((note) => !lowerOnsets.has(note.startTick)).length / melodyNotes.length
        : 0;
      const credibleAccompaniment = lower.length >= 3 && (
        lowerTexture.scores.block >= 0.45
        || lowerTexture.scores.arpeggio >= 0.5
        || lowerTexture.scores.sustained >= 0.5
      );
      const credibleMelodyIndependence = lane.role === 'lead' || independentUpperRatio >= 0.25;
      if (melodyNotes.length < 2 || !credibleAccompaniment || !credibleMelodyIndependence) {
        melodyNotes = [];
        accompanimentNotes = [...laneNotes];
      }
    }

    if (melodyNotes.length > 0) {
      const splitPitch = Math.min(...melodyNotes.map((note) => note.pitch));
      parts.push(makePart(
        lane.id,
        'melody',
        'melody',
        melodyNotes,
        0.82,
        [`音域断层后提取上方最高声部，旋律最低音 ${splitPitch}`],
      ));
      for (const note of melodyNotes) notePartById[note.id] = 'melody';
    }

    const registerBass = lane.id === derivedBassLaneId
      ? extractRegisterBass(accompanimentNotes)
      : null;
    if (registerBass) {
      accompanimentNotes = registerBass.remainder;
      parts.push(makePart(
        lane.id,
        'bass-register',
        'bass',
        registerBass.bass,
        0.76,
        registerBass.evidence,
      ));
      for (const note of registerBass.bass) notePartById[note.id] = 'bass';
    }

    let remainingKind: MidiDerivedVoiceKind;
    if (lane.role === 'bass') remainingKind = 'bass';
    else {
      const rawTexture = textureForNotes(lane.id, accompanimentNotes, measures, ppq);
      const accompanimentLike = rawTexture.texture === 'block'
        || rawTexture.texture === 'arpeggio'
        || rawTexture.texture === 'sustained'
        || rawTexture.texture === 'mixed';
      remainingKind = lane.role === 'lead' && !accompanimentLike && melodyNotes.length === 0
        ? 'melody'
        : accompanimentLike || lane.role === 'comp' || lane.role === 'pad' || melodyNotes.length > 0
          ? 'accompaniment'
          : 'unassigned';
    }
    const remaining = makePart(
      lane.id,
      remainingKind,
      remainingKind,
      accompanimentNotes,
      melodyNotes.length > 0 || registerBass ? 0.82 : lane.roleConfidence,
      melodyNotes.length > 0 || registerBass
        ? ['与已分离的旋律或低音声部不同，保留中间伴奏织体']
        : [`整条 Lane 依据角色与织体归为 ${remainingKind}`],
    );
    parts.push(remaining);
    for (const note of accompanimentNotes) notePartById[note.id] = remainingKind;
    laneTextures.push(textureForNotes(lane.id, accompanimentNotes, measures, ppq));
  }

  if (parts.every((part) => part.kind !== 'melody')) {
    warnings.push('未找到可与伴奏可靠分离的旋律声部；不按最高音强制伪造旋律');
  }
  if (parts.every((part) => part.kind !== 'accompaniment')) {
    warnings.push('未找到具有柱式、分解或持续特征的伴奏声部');
  }
  if (parts.every((part) => part.kind !== 'bass')) {
    warnings.push('未找到独立 Bass Lane，也没有足够证据从宽音域钢琴织体提取低音声部');
  }
  return { parts, laneTextures, notePartById, warnings };
}
