import { metricWeightAtTick } from './meterAnalysis';
import { selectPrimaryDeclaredEvent } from './declaredMapSelection';
import type {
  AnalysisEvidence,
  DeclaredMidiBaseline,
  KeyCandidate,
  LocalKeySegment,
  MidiInventory,
  MidiKeyAnalysis,
  MidiMeasureMap,
  MidiMeterAnalysis,
  MidiNoteSpan,
  MidiVoiceSeparation,
  RichSmfDocument,
  TonalMode,
} from './types';

// Krumhansl-Kessler pitch-class stability profiles, C tonic orientation.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const PC_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MAJOR_SIGNATURE_NAMES = ['C♭ major', 'G♭ major', 'D♭ major', 'A♭ major', 'E♭ major', 'B♭ major', 'F major', 'C major', 'G major', 'D major', 'A major', 'E major', 'B major', 'F♯ major', 'C♯ major'];
const MINOR_SIGNATURE_NAMES = ['A♭ minor', 'E♭ minor', 'B♭ minor', 'F minor', 'C minor', 'G minor', 'D minor', 'A minor', 'E minor', 'B minor', 'F♯ minor', 'C♯ minor', 'G♯ minor', 'D♯ minor', 'A♯ minor'];

function pearson(left: ReadonlyArray<number>, right: ReadonlyArray<number>): number {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i] - leftMean;
    const b = right[i] - rightMean;
    numerator += a * b;
    leftEnergy += a * a;
    rightEnergy += b * b;
  }
  const denominator = Math.sqrt(leftEnergy * rightEnergy);
  return denominator > 1e-9 ? numerator / denominator : 0;
}

function roleWeight(role: MidiInventory['lanes'][number]['role']): number {
  if (role === 'drum') return 0;
  if (role === 'bass') return 1.2;
  if (role === 'comp') return 1.15;
  if (role === 'pad') return 0.85;
  if (role === 'lead') return 0.68;
  if (role === 'mixed') return 0.9;
  return 0.75;
}

function voiceWeight(note: MidiNoteSpan, voices?: MidiVoiceSeparation): number | null {
  const kind = voices?.notePartById[note.id];
  if (!kind) return null;
  if (kind === 'drums') return 0;
  if (kind === 'bass') return 1.2;
  if (kind === 'accompaniment') return 1.12;
  if (kind === 'melody') return 0.7;
  return 0.72;
}

function histogramForRange(
  notes: ReadonlyArray<MidiNoteSpan>,
  inventory: MidiInventory,
  meter: MidiMeterAnalysis,
  ppq: number,
  startTick: number,
  endTick: number,
  voices?: MidiVoiceSeparation,
): number[] {
  const histogram = new Array<number>(12).fill(0);
  const roleByLane = new Map(inventory.lanes.map((lane) => [lane.id, lane.role]));
  for (const note of notes) {
    const overlapStart = Math.max(startTick, note.startTick);
    const overlapEnd = Math.min(endTick, note.keyDownEndTick);
    if (overlapEnd <= overlapStart) continue;
    const role = roleByLane.get(`t${note.trackIndex}:ch${note.channel}`) ?? 'unknown';
    const laneWeight = voiceWeight(note, voices) ?? roleWeight(role);
    if (laneWeight === 0) continue;
    const durationQuarter = Math.max(0.0625, Math.min(4, (overlapEnd - overlapStart) / ppq));
    const velocityWeight = 0.6 + 0.4 * note.velocity / 127;
    const metricalWeight = 0.7 + 0.3 * metricWeightAtTick(note.startTick, ppq, meter);
    histogram[note.pitch % 12] += durationQuarter * velocityWeight * metricalWeight * laneWeight;
  }
  return histogram;
}

function rawKeyCandidates(
  histogram: ReadonlyArray<number>,
  finalPitchClasses: ReadonlySet<number>,
): Array<Omit<KeyCandidate, 'confidence'>> {
  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  const result: Array<Omit<KeyCandidate, 'confidence'>> = [];
  for (let tonicPc = 0; tonicPc < 12; tonicPc++) {
    for (const mode of ['major', 'minor'] as const) {
      const profile = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE;
      const rotatedProfile = new Array<number>(12);
      for (let pc = 0; pc < 12; pc++) rotatedProfile[pc] = profile[(pc - tonicPc + 12) % 12];
      let score = pearson(histogram, rotatedProfile);
      if (finalPitchClasses.has(tonicPc)) score += 0.12;
      if (finalPitchClasses.has((tonicPc + 7) % 12)) score += 0.015;
      result.push({
        tonicPc,
        mode,
        label: `${PC_NAMES[tonicPc]} ${mode}`,
        score,
      });
    }
  }
  return result;
}

function withConfidence(
  candidates: Array<Omit<KeyCandidate, 'confidence'>>,
): KeyCandidate[] {
  if (candidates.length === 0) return [];
  const maximum = Math.max(...candidates.map((candidate) => candidate.score));
  const weights = candidates.map((candidate) => Math.exp((candidate.score - maximum) / 0.1));
  const sum = weights.reduce((total, value) => total + value, 0);
  return candidates
    .map((candidate, index) => ({ ...candidate, confidence: sum > 0 ? weights[index] / sum : 0 }))
    .sort((a, b) => b.score - a.score);
}

function finalPitchClassesForRange(
  notes: ReadonlyArray<MidiNoteSpan>,
  inventory: MidiInventory,
  startTick: number,
  endTick: number,
  voices?: MidiVoiceSeparation,
): Set<number> {
  const roleByLane = new Map(inventory.lanes.map((lane) => [lane.id, lane.role]));
  const eligible = notes.filter((note) => {
    if (note.startTick < startTick || note.startTick >= endTick) return false;
    return voices?.notePartById[note.id] !== 'drums'
      && roleByLane.get(`t${note.trackIndex}:ch${note.channel}`) !== 'drum';
  });
  const finalTick = Math.max(startTick, ...eligible.map((note) => note.startTick));
  const finalNotes = eligible.filter((note) => note.startTick === finalTick);
  const bassNotes = finalNotes.filter((note) =>
    voices?.notePartById[note.id] === 'bass'
    || (!voices && roleByLane.get(`t${note.trackIndex}:ch${note.channel}`) === 'bass'));
  if (bassNotes.length > 0) return new Set(bassNotes.map((note) => note.pitch % 12));
  const lowestPitch = Math.min(128, ...finalNotes.map((note) => note.pitch));
  return new Set(finalNotes.filter((note) => note.pitch === lowestPitch).map((note) => note.pitch % 12));
}

function candidatesForRange(
  notes: ReadonlyArray<MidiNoteSpan>,
  inventory: MidiInventory,
  meter: MidiMeterAnalysis,
  ppq: number,
  startTick: number,
  endTick: number,
  voices?: MidiVoiceSeparation,
): { histogram: number[]; candidates: KeyCandidate[] } {
  const histogram = histogramForRange(notes, inventory, meter, ppq, startTick, endTick, voices);
  const finals = finalPitchClassesForRange(notes, inventory, startTick, endTick, voices);
  return { histogram, candidates: withConfidence(rawKeyCandidates(histogram, finals)) };
}

function localSegments(
  document: RichSmfDocument,
  notes: ReadonlyArray<MidiNoteSpan>,
  inventory: MidiInventory,
  meter: MidiMeterAnalysis,
  ppq: number,
  voices?: MidiVoiceSeparation,
  measures?: MidiMeasureMap,
): LocalKeySegment[] {
  if (document.durationTicks <= 0) return [];
  if (measures && measures.measures.length > 0) {
    const segments: LocalKeySegment[] = [];
    const measuresPerSegment = 4;
    for (let index = 0; index < measures.measures.length; index += measuresPerSegment) {
      const group = measures.measures.slice(index, index + measuresPerSegment);
      const first = group[0];
      const last = group[group.length - 1];
      const candidates = candidatesForRange(
        notes,
        inventory,
        meter,
        ppq,
        first.startTick,
        last.endTick,
        voices,
      ).candidates;
      segments.push({
        startTick: first.startTick,
        endTick: last.endTick,
        startMeasureLabel: first.label,
        endMeasureLabel: last.label,
        candidates: candidates.slice(0, 12),
        selected: candidates[0] ?? null,
        confidence: candidates[0]?.confidence ?? 0,
        evidence: ['按连续最多 4 小节的结构音级分布建立局部候选'],
      });
    }
    return segments;
  }
  const selectedMeter = meter.selected ?? { numerator: 4, denominator: 4 };
  const barTicks = selectedMeter.numerator * ppq * 4 / selectedMeter.denominator;
  const windowTicks = Math.max(ppq * 4, barTicks * 4);
  const stepTicks = Math.max(ppq * 2, barTicks * 2);
  if (document.durationTicks <= windowTicks) return [];
  const segments: LocalKeySegment[] = [];
  for (let startTick = 0; startTick < document.durationTicks; startTick += stepTicks) {
    const endTick = Math.min(document.durationTicks, startTick + windowTicks);
    const candidates = candidatesForRange(
      notes,
      inventory,
      meter,
      ppq,
      startTick,
      endTick,
      voices,
    ).candidates;
    if (candidates.length > 0) segments.push({ startTick, endTick, candidates: candidates.slice(0, 4) });
    if (endTick === document.durationTicks) break;
  }
  return segments;
}

function declaredKeyName(sharpsFlats: number, mode: TonalMode): string {
  const index = sharpsFlats + 7;
  return mode === 'major' ? MAJOR_SIGNATURE_NAMES[index] : MINOR_SIGNATURE_NAMES[index];
}

export function analyzeMidiKey(
  document: RichSmfDocument,
  notes: ReadonlyArray<MidiNoteSpan>,
  inventory: MidiInventory,
  meter: MidiMeterAnalysis,
  voices?: MidiVoiceSeparation,
  baseline?: DeclaredMidiBaseline,
  measures?: MidiMeasureMap,
): MidiKeyAnalysis {
  const warnings: string[] = [];
  const ppq = document.timeDivision.kind === 'ppq' ? document.timeDivision.ppq : null;
  if (!document.analysisSupport.supported || ppq === null) {
    const unsupportedReason = 'reason' in document.analysisSupport
      ? document.analysisSupport.reason
      : '非 PPQ 时基';
    return {
      declared: null,
      inferred: null,
      candidates: [],
      localSegments: [],
      pitchClassHistogram: new Array<number>(12).fill(0),
      warnings: [`${unsupportedReason}: 不推断调性`],
    };
  }

  const declaredKeyMap = baseline?.keySignatureMap ?? document.keySignatureMap;
  const validDeclaredKeys = declaredKeyMap.filter((event) =>
    event.valid && event.mode !== 'unknown');
  const declaredEvent = selectPrimaryDeclaredEvent(
    validDeclaredKeys,
    notes,
    document.durationTicks,
    (event) => `${event.sharpsFlats}/${event.mode}`,
  );
  const declaredName = declaredEvent
    ? declaredKeyName(declaredEvent.sharpsFlats, declaredEvent.mode as TonalMode)
    : null;
  const declared: AnalysisEvidence<string> | null = declaredEvent && declaredName
    ? {
      value: declaredName,
      source: 'declared',
      confidence: 1,
      alternatives: [],
      evidence: [`FF 59 @ tick ${declaredEvent.tick}, track ${declaredEvent.trackIndex + 1}`],
      warnings: [],
    }
    : null;
  if (validDeclaredKeys.length > 1) {
    warnings.push(`文件包含 ${validDeclaredKeys.length} 个有效调号事件；总览显示覆盖演奏内容最多的主调号，时间轴保留完整 Key Map`);
  }

  const global = candidatesForRange(
    notes,
    inventory,
    meter,
    ppq,
    0,
    Math.max(1, document.durationTicks),
    voices,
  );
  const candidates = global.candidates;
  const top = candidates[0];
  const inferred: AnalysisEvidence<string> | null = top
    ? {
      value: top.label,
      source: 'inferred',
      confidence: top.confidence,
      alternatives: candidates.slice(1, 5).map((candidate) => ({
        value: candidate.label,
        confidence: candidate.confidence,
      })),
      evidence: ['按音符时值、力度、重拍与 Lane 角色加权的音级稳定度相关'],
      warnings: top.confidence < 0.55 ? ['调性候选接近，可能是相对大小调、调式或短素材'] : [],
    }
    : null;
  if (declared && inferred && declared.value !== inferred.value && inferred.confidence >= 0.55) {
    warnings.push(`声明调号 ${declared.value} 与演奏内容首选 ${inferred.value} 不一致`);
  }
  if (top && top.score < 0.35) warnings.push('音级分布与大/小调模板相关性偏低，可能为调式、无调性或素材过短');

  return {
    declared,
    inferred,
    candidates,
    localSegments: localSegments(document, notes, inventory, meter, ppq, voices, measures),
    pitchClassHistogram: global.histogram,
    warnings,
  };
}
