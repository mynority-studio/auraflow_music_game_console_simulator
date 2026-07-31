import type {
  AnalysisEvidence,
  DeclaredMidiBaseline,
  MeterAccentPoint,
  MeterCandidate,
  MeterValue,
  MidiInventory,
  MidiMeterAnalysis,
  MidiNoteSpan,
  RichSmfDocument,
  SmfTimeSignatureEvent,
} from './types';
import { selectPrimaryDeclaredEvent } from './declaredMapSelection';

interface MeterHypothesis extends MeterValue {
  grouping: number[];
  prior: number;
}

const HYPOTHESES: ReadonlyArray<MeterHypothesis> = [
  { numerator: 4, denominator: 4, grouping: [2, 2], prior: 1 },
  { numerator: 3, denominator: 4, grouping: [3], prior: 0.78 },
  { numerator: 2, denominator: 4, grouping: [2], prior: 0.58 },
  { numerator: 6, denominator: 8, grouping: [3, 3], prior: 0.75 },
  { numerator: 9, denominator: 8, grouping: [3, 3, 3], prior: 0.42 },
  { numerator: 12, denominator: 8, grouping: [3, 3, 3, 3], prior: 0.4 },
  { numerator: 5, denominator: 4, grouping: [3, 2], prior: 0.28 },
  { numerator: 5, denominator: 4, grouping: [2, 3], prior: 0.26 },
  { numerator: 5, denominator: 8, grouping: [3, 2], prior: 0.2 },
  { numerator: 5, denominator: 8, grouping: [2, 3], prior: 0.2 },
  { numerator: 7, denominator: 8, grouping: [3, 2, 2], prior: 0.15 },
  { numerator: 7, denominator: 8, grouping: [2, 3, 2], prior: 0.15 },
  { numerator: 7, denominator: 8, grouping: [2, 2, 3], prior: 0.15 },
];

const modulo = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;

function correlation(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 2) return 0;
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
  if (role === 'drum') return 1.25;
  if (role === 'bass') return 1.15;
  if (role === 'comp') return 1.05;
  if (role === 'lead') return 0.72;
  if (role === 'pad') return 0.65;
  return 0.8;
}

function performedAccentPoints(
  notes: ReadonlyArray<MidiNoteSpan>,
  inventory: MidiInventory,
): MeterAccentPoint[] {
  const roleByLane = new Map(inventory.lanes.map((lane) => [lane.id, lane.role]));
  const byTick = new Map<number, number>();
  const countByTick = new Map<number, number>();
  for (const note of notes) {
    const role = roleByLane.get(`t${note.trackIndex}:ch${note.channel}`) ?? 'unknown';
    const velocity = Math.max(0.1, note.velocity / 127);
    byTick.set(note.startTick, (byTick.get(note.startTick) ?? 0) + velocity * roleWeight(role));
    countByTick.set(note.startTick, (countByTick.get(note.startTick) ?? 0) + 1);
  }
  const raw = Array.from(byTick, ([tick, weight]) => ({
    tick,
    performedAccent: weight * (1 + 0.12 * Math.max(0, (countByTick.get(tick) ?? 1) - 1)),
  })).sort((a, b) => a.tick - b.tick);
  const maximum = Math.max(0, ...raw.map((point) => point.performedAccent));
  return raw.map((point) => ({
    tick: point.tick,
    performedAccent: maximum > 0 ? point.performedAccent / maximum : 0,
  }));
}

function metricPatternWeight(
  tick: number,
  phaseTick: number,
  ppq: number,
  hypothesis: MeterHypothesis,
): number {
  const unitTicks = ppq * 4 / hypothesis.denominator;
  const barTicks = hypothesis.numerator * unitTicks;
  const local = modulo(tick - phaseTick, barTicks);
  const unitPosition = local / unitTicks;
  const nearestUnit = Math.round(unitPosition);
  if (Math.abs(unitPosition - nearestUnit) > 0.18) return 0.12;
  const position = modulo(nearestUnit, hypothesis.numerator);
  let cursor = 0;
  for (let groupIndex = 0; groupIndex < hypothesis.grouping.length; groupIndex++) {
    if (position === cursor) return groupIndex === 0 ? 1 : 0.72;
    cursor += hypothesis.grouping[groupIndex];
  }
  return 0.34;
}

function scoreHypothesis(
  hypothesis: MeterHypothesis,
  accents: ReadonlyArray<MeterAccentPoint>,
  ppq: number,
  durationTicks: number,
): Omit<MeterCandidate, 'confidence'> {
  const unitTicks = ppq * 4 / hypothesis.denominator;
  const barTicks = hypothesis.numerator * unitTicks;
  const sampleStep = Math.max(1, Math.round(Math.min(ppq / 2, unitTicks)));
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestPhase = 0;
  const accentBySample = new Map<number, number>();
  for (const point of accents) {
    const sample = Math.round(point.tick / sampleStep) * sampleStep;
    accentBySample.set(sample, Math.max(accentBySample.get(sample) ?? 0, point.performedAccent));
  }

  for (let phaseTick = 0; phaseTick < barTicks; phaseTick += sampleStep) {
    const observed: number[] = [];
    const expected: number[] = [];
    for (let tick = 0; tick <= durationTicks; tick += sampleStep) {
      observed.push(accentBySample.get(tick) ?? 0);
      expected.push(metricPatternWeight(tick, phaseTick, ppq, hypothesis));
    }
    const corr = correlation(observed, expected);
    const downbeatObserved = observed.filter((_, index) => {
      const tick = index * sampleStep;
      return modulo(tick - phaseTick, barTicks) < sampleStep / 2;
    });
    const downbeatMean = downbeatObserved.length > 0
      ? downbeatObserved.reduce((sum, value) => sum + value, 0) / downbeatObserved.length
      : 0;
    const score = 0.72 * corr + 0.2 * downbeatMean + 0.08 * hypothesis.prior;
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phaseTick;
    }
  }
  return {
    numerator: hypothesis.numerator,
    denominator: hypothesis.denominator,
    beatGrouping: hypothesis.grouping,
    barPhaseTick: bestPhase,
    score: bestScore,
  };
}

function softmaxCandidates(
  candidates: Array<Omit<MeterCandidate, 'confidence'>>,
): MeterCandidate[] {
  if (candidates.length === 0) return [];
  const maximum = Math.max(...candidates.map((candidate) => candidate.score));
  const weights = candidates.map((candidate) => Math.exp((candidate.score - maximum) / 0.12));
  const sum = weights.reduce((total, value) => total + value, 0);
  return candidates
    .map((candidate, index) => ({ ...candidate, confidence: sum > 0 ? weights[index] / sum : 0 }))
    .sort((a, b) => b.score - a.score);
}

function groupingFromDeclaration(event: SmfTimeSignatureEvent): number[] | null {
  if (!event.valid) return null;
  if (event.denominator === 8 && event.numerator >= 6 && event.numerator % 3 === 0
      && event.midiClocksPerMetronomeClick === 36) {
    return new Array(event.numerator / 3).fill(3);
  }
  if (event.denominator <= 4 && event.numerator === 4) return [2, 2];
  if (event.denominator <= 4 && (event.numerator === 2 || event.numerator === 3)) {
    return [event.numerator];
  }
  return null;
}

export function analyzeMidiMeter(
  document: RichSmfDocument,
  notes: ReadonlyArray<MidiNoteSpan>,
  inventory: MidiInventory,
  baseline?: DeclaredMidiBaseline,
): MidiMeterAnalysis {
  const warnings: string[] = [];
  const accents = performedAccentPoints(notes, inventory);
  const ppq = document.timeDivision.kind === 'ppq' ? document.timeDivision.ppq : null;
  if (!document.analysisSupport.supported || ppq === null) {
    const unsupportedReason = 'reason' in document.analysisSupport
      ? document.analysisSupport.reason
      : '非 PPQ 时基';
    return {
      declared: null,
      inferred: null,
      selected: null,
      selectedSource: 'unknown',
      barPhaseTick: null,
      beatGrouping: null,
      candidates: [],
      performedAccents: accents,
      warnings: [`${unsupportedReason}: 不推断拍号`],
    };
  }

  const candidates = accents.length >= 2
    ? softmaxCandidates(HYPOTHESES.map((hypothesis) =>
      scoreHypothesis(hypothesis, accents, ppq, document.durationTicks)))
    : [];
  const top = candidates[0];
  const inferred: AnalysisEvidence<MeterValue> | null = top
    ? {
      value: { numerator: top.numerator, denominator: top.denominator },
      source: 'inferred',
      confidence: top.confidence,
      alternatives: candidates.slice(1, 4).map((candidate) => ({
        value: { numerator: candidate.numerator, denominator: candidate.denominator },
        confidence: candidate.confidence,
      })),
      evidence: ['音符力度、同时起音、轨道角色与周期性重音相关'],
      warnings: top.confidence < 0.55 ? ['拍号候选接近，不应视为确定结果'] : [],
    }
    : null;

  const declaredMeterMap = baseline?.timeSignatureMap ?? document.timeSignatureMap;
  const validDeclaredMeters = declaredMeterMap.filter((event) => event.valid);
  const declaredEvent = selectPrimaryDeclaredEvent(
    validDeclaredMeters,
    notes,
    document.durationTicks,
    (event) => `${event.numerator}/${event.denominator}`,
  );
  const declared: AnalysisEvidence<MeterValue> | null = declaredEvent
    ? {
      value: { numerator: declaredEvent.numerator, denominator: declaredEvent.denominator },
      source: 'declared',
      confidence: 1,
      alternatives: [],
      evidence: [
        `FF 58 @ tick ${declaredEvent.tick}, track ${declaredEvent.trackIndex + 1}`,
        `metronome=${declaredEvent.midiClocksPerMetronomeClick} MIDI clocks`,
      ],
      warnings: [],
    }
    : null;
  if (validDeclaredMeters.length > 1) {
    warnings.push(`文件包含 ${validDeclaredMeters.length} 个有效拍号事件；总览显示覆盖演奏内容最多的主拍号，时间轴保留完整 Meter Map`);
  }

  let barPhaseTick = top?.barPhaseTick ?? 0;
  let beatGrouping = top?.beatGrouping ?? null;
  if (declaredEvent) {
    const matching = candidates.find((candidate) =>
      candidate.numerator === declaredEvent.numerator && candidate.denominator === declaredEvent.denominator);
    const declaredBarTicks = declaredEvent.numerator * ppq * 4 / declaredEvent.denominator;
    barPhaseTick = modulo(declaredEvent.tick, declaredBarTicks);
    beatGrouping = groupingFromDeclaration(declaredEvent) ?? matching?.beatGrouping ?? null;
    if (declaredEvent.denominator === 8 && declaredEvent.numerator % 3 === 0
        && declaredEvent.numerator >= 6 && declaredEvent.midiClocksPerMetronomeClick !== 36) {
      warnings.push(
        `${declaredEvent.numerator}/${declaredEvent.denominator} 的 metronome click=${declaredEvent.midiClocksPerMetronomeClick}，未明确支持附点四分拍组`,
      );
    }
    if (inferred && (
      inferred.value.numerator !== declaredEvent.numerator
      || inferred.value.denominator !== declaredEvent.denominator
    ) && inferred.confidence >= 0.55) {
      warnings.push(
        `声明拍号 ${declaredEvent.numerator}/${declaredEvent.denominator} 与演奏重音首选 ${inferred.value.numerator}/${inferred.value.denominator} 不一致`,
      );
    }
  }
  if (!declaredEvent && barPhaseTick > 0) {
    const hasPickupMaterial = notes.some((note) =>
      note.startTick < barPhaseTick && note.keyDownEndTick > 0);
    if (!hasPickupMaterial) {
      warnings.push(
        `重音候选给出 bar phase=${barPhaseTick} ticks，但该区间没有演奏音符；按前导静默处理，小节原点回到 tick 0`,
      );
      barPhaseTick = 0;
    }
  }

  return {
    declared,
    inferred,
    selected: declared?.value ?? inferred?.value ?? null,
    selectedSource: declared ? 'declared' : inferred ? 'inferred' : 'unknown',
    barPhaseTick,
    beatGrouping,
    candidates: candidates.slice(0, 8),
    performedAccents: accents,
    warnings,
  };
}

export function metricWeightAtTick(
  tick: number,
  ppq: number,
  meter: MidiMeterAnalysis,
): number {
  if (!meter.selected || meter.barPhaseTick === null) return 0.5;
  const grouping = meter.beatGrouping ?? [meter.selected.numerator];
  return metricPatternWeight(tick, meter.barPhaseTick, ppq, {
    ...meter.selected,
    grouping: [...grouping],
    prior: 0,
  });
}
