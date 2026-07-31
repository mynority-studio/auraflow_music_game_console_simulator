import {
  getChordType,
  listChordTypes,
  type ChordTypeId,
} from '../../generation/newEngine/knowledge/chords';
import type {
  ChordCandidate,
  ChordWindowAnalysis,
  HarmonicWindow,
} from './types';

const PC_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const modulo = (value: number): number => ((value % 12) + 12) % 12;

function chordLabel(rootPc: number, type: string, bassPc: number | null): string {
  const suffix = type === 'maj' ? '' : type === 'min' ? 'm' : type;
  const slash = bassPc !== null && bassPc !== rootPc ? `/${PC_NAMES[bassPc]}` : '';
  return `${PC_NAMES[rootPc]}${suffix}${slash}`;
}

function essentialWeight(intervalPc: number, chordType: ChordTypeId): number {
  if (intervalPc === 0) return 0.72;
  if (intervalPc === 3 || intervalPc === 4 || intervalPc === 5) return 1.08;
  if (intervalPc === 6 || intervalPc === 8) {
    return chordType === 'dim' || chordType === 'aug' || chordType.includes('b5') || chordType.includes('#5')
      ? 0.8
      : 0.45;
  }
  if (intervalPc === 7) return 0.34;
  if (intervalPc === 9 || intervalPc === 10 || intervalPc === 11) return 0.86;
  return 0.36;
}

function missingPenalty(intervalPc: number, chordType: ChordTypeId): number {
  if (intervalPc === 0) return 0.09;
  if (intervalPc === 3 || intervalPc === 4 || intervalPc === 5) return 0.2;
  if (intervalPc === 7) return 0.025;
  if (intervalPc === 6 || intervalPc === 8) {
    return chordType === 'dim' || chordType === 'aug' || chordType.includes('b5') || chordType.includes('#5')
      ? 0.13
      : 0.05;
  }
  if (intervalPc === 9 || intervalPc === 10 || intervalPc === 11) return 0.11;
  return 0.045;
}

function scoreCandidate(
  window: HarmonicWindow,
  rootPc: number,
  chordType: ChordTypeId,
): Omit<ChordCandidate, 'confidence'> {
  const uniqueIntervals = Array.from(new Set(getChordType(chordType).intervals.map(modulo)));
  const chordPcs = new Set(uniqueIntervals.map((interval) => modulo(rootPc + interval)));
  // Chord quality comes from the accompaniment layer when it exists. Mixing
  // the doubled bass/downbeat root into this distribution can make a rolled
  // Em7 look like E5 simply because E was struck before G/B/D.
  const qualityWeights = window.evidenceTotals.accompaniment > 1e-9
    ? window.accompanimentPitchClassWeights
    : window.pitchClassWeights;
  const maximumObserved = Math.max(0, ...qualityWeights);
  const observedPcs = qualityWeights
    .map((weight, pc) => ({ weight, pc }))
    .filter(({ weight }) => maximumObserved > 0 && weight >= Math.max(0.025, maximumObserved * 0.16));
  const coverage = observedPcs.reduce(
    (sum, observed) => sum + (chordPcs.has(observed.pc) ? observed.weight : 0),
    0,
  );
  const observedTotal = observedPcs.reduce((sum, observed) => sum + observed.weight, 0);
  const normalizedCoverage = observedTotal > 0 ? coverage / observedTotal : 0;

  let completenessNumerator = 0;
  let completenessDenominator = 0;
  let missing = 0;
  const missingPitchClasses: number[] = [];
  for (const interval of uniqueIntervals) {
    const pc = modulo(rootPc + interval);
    const importance = essentialWeight(interval, chordType);
    const presence = maximumObserved > 0
      ? Math.min(1, qualityWeights[pc] / Math.max(0.001, maximumObserved * 0.72))
      : 0;
    completenessNumerator += importance * presence;
    completenessDenominator += importance;
    if (presence < 0.14) {
      missing += missingPenalty(interval, chordType);
      missingPitchClasses.push(pc);
    }
  }
  const completeness = completenessDenominator > 0
    ? completenessNumerator / completenessDenominator
    : 0;
  const extraPitchClasses = observedPcs
    .filter(({ pc }) => !chordPcs.has(pc))
    .map(({ pc }) => pc);
  const extraWeight = observedPcs
    .filter(({ pc }) => !chordPcs.has(pc))
    .reduce((sum, observed) => sum + observed.weight, 0);
  const normalizedExtra = observedTotal > 0 ? extraWeight / observedTotal : 0;
  const fitFor = (weights: ReadonlyArray<number>): number => {
    const total = weights.reduce((sum, value) => sum + value, 0);
    if (total <= 1e-9) return 0.5;
    return weights.reduce(
      (sum, weight, pc) => sum + (chordPcs.has(pc) ? weight : 0),
      0,
    ) / total;
  };
  const accompanimentFit = fitFor(window.accompanimentPitchClassWeights);
  const strongBeatFit = fitFor(window.strongBeatPitchClassWeights);

  const rootHeard = window.pitchClassWeights[rootPc] >= Math.max(0.025, maximumObserved * 0.16);
  let bassScore = 0;
  if (window.bassPc !== null) {
    if (window.bassPc === rootPc) bassScore = 0.22 * window.bassConfidence;
    else if (chordPcs.has(window.bassPc)) bassScore = 0.07 * window.bassConfidence;
    else bassScore = -0.22 * window.bassConfidence;
  }
  const complexityPenalty = Math.max(0, uniqueIntervals.length - 3) * 0.012;
  const score = 0.38 * normalizedCoverage
    + 0.3 * completeness
    + 0.12 * accompanimentFit
    + 0.1 * strongBeatFit
    + (rootHeard ? 0.055 : 0)
    + bassScore
    - 0.26 * normalizedExtra
    - missing
    - complexityPenalty;
  return {
    rootPc,
    type: chordType,
    bassPc: window.bassPc,
    label: chordLabel(rootPc, chordType, window.bassPc),
    score,
    rootHeard,
    missingPitchClasses,
    extraPitchClasses,
  };
}

export function analyzeChordWindow(
  window: HarmonicWindow,
  limit = 14,
): ChordWindowAnalysis {
  const observedTotal = window.pitchClassWeights.reduce((sum, value) => sum + value, 0);
  if (observedTotal <= 1e-9) {
    return { window, candidates: [], unknownConfidence: 1 };
  }
  const scored: Array<Omit<ChordCandidate, 'confidence'>> = [];
  for (let rootPc = 0; rootPc < 12; rootPc++) {
    for (const chordType of listChordTypes()) {
      scored.push(scoreCandidate(window, rootPc, chordType));
    }
  }
  scored.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.rootPc - b.rootPc);
  const shortlist = scored.slice(0, Math.max(limit, 1));
  const maximum = shortlist[0]?.score ?? 0;
  const weights = shortlist.map((candidate) => Math.exp((candidate.score - maximum) / 0.085));
  const unknownWeight = Math.exp((0.42 - maximum) / 0.085);
  const sum = weights.reduce((total, value) => total + value, unknownWeight);
  const candidates = shortlist.map((candidate, index) => ({
    ...candidate,
    confidence: sum > 0 ? weights[index] / sum : 0,
  }));
  return {
    window,
    candidates,
    unknownConfidence: sum > 0 ? unknownWeight / sum : 1,
  };
}

export function analyzeChordWindows(
  windows: ReadonlyArray<HarmonicWindow>,
  limit = 14,
): ChordWindowAnalysis[] {
  return windows.map((window) => analyzeChordWindow(window, limit));
}
