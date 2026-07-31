// ============================================================
// newEngine · instrumental · Foundation Voice Leading
// ------------------------------------------------------------
// Small exact one-to-one assignment for Comp/Pad voicing comparison.  Voice
// counts are tiny (normally 1-5), so exhaustive ordered subset search is both
// deterministic and clearer than allowing several new voices to claim the
// same previous voice.
// ============================================================

export interface VoiceLeadingPair {
  previous: number;
  current: number;
  distance: number;
}

export interface VoiceLeadingAssignment {
  pairs: readonly VoiceLeadingPair[];
  unmatchedPrevious: readonly number[];
  unmatchedCurrent: readonly number[];
  totalDistance: number;
  maximumDistance: number;
}

function combinations(values: readonly number[], count: number): number[][] {
  if (count === 0) return [[]];
  if (count > values.length) return [];
  const out: number[][] = [];
  const visit = (start: number, chosen: number[]): void => {
    if (chosen.length === count) {
      out.push(chosen);
      return;
    }
    for (let index = start; index <= values.length - (count - chosen.length); index++) {
      visit(index + 1, [...chosen, values[index]]);
    }
  };
  visit(0, []);
  return out;
}

export function minimumVoiceLeadingAssignment(
  previousVoicing: readonly number[],
  currentVoicing: readonly number[],
  unmatchedPenalty = 5,
): VoiceLeadingAssignment {
  const previous = [...previousVoicing].sort((a, b) => a - b);
  const current = [...currentVoicing].sort((a, b) => a - b);
  if (previous.length === 0 || current.length === 0) {
    const unmatchedPrevious = previous.length ? previous : [];
    const unmatchedCurrent = current.length ? current : [];
    return {
      pairs: [],
      unmatchedPrevious,
      unmatchedCurrent,
      totalDistance: (unmatchedPrevious.length + unmatchedCurrent.length) * unmatchedPenalty,
      maximumDistance: 0,
    };
  }

  let best: VoiceLeadingAssignment | undefined;
  if (previous.length <= current.length) {
    for (const subset of combinations(current, previous.length)) {
      const pairs = previous.map((pitch, index) => ({
        previous: pitch,
        current: subset[index],
        distance: Math.abs(pitch - subset[index]),
      }));
      const used = new Set(subset);
      const unmatchedCurrent = current.filter((pitch) => !used.has(pitch));
      const totalDistance = pairs.reduce((sum, pair) => sum + pair.distance, 0)
        + unmatchedCurrent.length * unmatchedPenalty;
      const candidate: VoiceLeadingAssignment = {
        pairs,
        unmatchedPrevious: [],
        unmatchedCurrent,
        totalDistance,
        maximumDistance: Math.max(0, ...pairs.map((pair) => pair.distance)),
      };
      if (!best || candidate.totalDistance < best.totalDistance) best = candidate;
    }
  } else {
    for (const subset of combinations(previous, current.length)) {
      const pairs = current.map((pitch, index) => ({
        previous: subset[index],
        current: pitch,
        distance: Math.abs(subset[index] - pitch),
      }));
      const used = new Set(subset);
      const unmatchedPrevious = previous.filter((pitch) => !used.has(pitch));
      const totalDistance = pairs.reduce((sum, pair) => sum + pair.distance, 0)
        + unmatchedPrevious.length * unmatchedPenalty;
      const candidate: VoiceLeadingAssignment = {
        pairs,
        unmatchedPrevious,
        unmatchedCurrent: [],
        totalDistance,
        maximumDistance: Math.max(0, ...pairs.map((pair) => pair.distance)),
      };
      if (!best || candidate.totalDistance < best.totalDistance) best = candidate;
    }
  }
  return best!;
}

export function minimumVoiceLeadingDistance(
  previousVoicing: readonly number[],
  currentVoicing: readonly number[],
  unmatchedPenalty = 5,
): number {
  return minimumVoiceLeadingAssignment(previousVoicing, currentVoicing, unmatchedPenalty).totalDistance;
}

