import type { DecodedChordSpan, MidiInventory, MidiLaneRole } from './types';

export interface GroundTruthChordSpan {
  startTick: number;
  endTick: number;
  rootPc: number;
  type: string;
}

export interface HarmonyBenchmarkMetrics {
  evaluatedTicks: number;
  rootAccuracy: number;
  rootAndTypeAccuracy: number;
  boundaryPrecision: number;
  boundaryRecall: number;
  boundaryF1: number;
}

function overlapTicks(
  left: Pick<GroundTruthChordSpan, 'startTick' | 'endTick'>,
  right: Pick<DecodedChordSpan, 'startTick' | 'endTick'>,
): number {
  return Math.max(0, Math.min(left.endTick, right.endTick) - Math.max(left.startTick, right.startTick));
}

function boundaryF1(
  truth: ReadonlyArray<number>,
  predicted: ReadonlyArray<number>,
  toleranceTicks: number,
): { precision: number; recall: number; f1: number } {
  const used = new Set<number>();
  let matches = 0;
  for (const boundary of truth) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < predicted.length; index++) {
      if (used.has(index)) continue;
      const distance = Math.abs(predicted[index] - boundary);
      if (distance <= toleranceTicks && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) {
      used.add(bestIndex);
      matches++;
    }
  }
  const precision = predicted.length === 0 ? (truth.length === 0 ? 1 : 0) : matches / predicted.length;
  const recall = truth.length === 0 ? 1 : matches / truth.length;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  return { precision, recall, f1 };
}

export function evaluateHarmonyTimeline(
  truth: ReadonlyArray<GroundTruthChordSpan>,
  predicted: ReadonlyArray<DecodedChordSpan>,
  toleranceTicks: number,
): HarmonyBenchmarkMetrics {
  let evaluatedTicks = 0;
  let rootCorrectTicks = 0;
  let rootAndTypeCorrectTicks = 0;
  for (const expected of truth) {
    for (const actual of predicted) {
      const overlap = overlapTicks(expected, actual);
      if (overlap <= 0) continue;
      evaluatedTicks += overlap;
      if (actual.rootPc === expected.rootPc) {
        rootCorrectTicks += overlap;
        if (actual.type === expected.type) rootAndTypeCorrectTicks += overlap;
      }
    }
  }
  const truthBoundaries = truth.slice(1).map((span) => span.startTick);
  const evaluationStart = Math.min(...truth.map((span) => span.startTick));
  const evaluationEnd = Math.max(...truth.map((span) => span.endTick));
  const predictedBoundaries = predicted
    .map((span) => span.startTick)
    .filter((tick) => tick > evaluationStart && tick < evaluationEnd);
  const boundaries = boundaryF1(truthBoundaries, predictedBoundaries, toleranceTicks);
  return {
    evaluatedTicks,
    rootAccuracy: evaluatedTicks > 0 ? rootCorrectTicks / evaluatedTicks : 0,
    rootAndTypeAccuracy: evaluatedTicks > 0 ? rootAndTypeCorrectTicks / evaluatedTicks : 0,
    boundaryPrecision: boundaries.precision,
    boundaryRecall: boundaries.recall,
    boundaryF1: boundaries.f1,
  };
}

export interface RoleBenchmarkMetrics {
  evaluatedLanes: number;
  accuracy: number;
  macroF1: number;
}

export function evaluateLaneRoles(
  truth: Readonly<Record<string, MidiLaneRole>>,
  inventory: MidiInventory,
): RoleBenchmarkMetrics {
  const roles = ['bass', 'comp', 'pad', 'lead', 'drum', 'mixed', 'unknown'] as const;
  const predictions = new Map(inventory.lanes.map((lane) => [lane.id, lane.role]));
  const entries = Object.entries(truth);
  let correct = 0;
  for (const [lane, expected] of entries) if (predictions.get(lane) === expected) correct++;
  const f1Values: number[] = [];
  for (const role of roles) {
    const expectedCount = entries.filter(([, expected]) => expected === role).length;
    if (expectedCount === 0) continue;
    const predictedCount = entries.filter(([lane]) => predictions.get(lane) === role).length;
    const truePositive = entries.filter(([lane, expected]) =>
      expected === role && predictions.get(lane) === role).length;
    const precision = predictedCount > 0 ? truePositive / predictedCount : 0;
    const recall = truePositive / expectedCount;
    f1Values.push(precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0);
  }
  return {
    evaluatedLanes: entries.length,
    accuracy: entries.length > 0 ? correct / entries.length : 0,
    macroF1: f1Values.length > 0
      ? f1Values.reduce((sum, value) => sum + value, 0) / f1Values.length
      : 0,
  };
}
