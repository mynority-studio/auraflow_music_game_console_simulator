import {
  chordTypeIntervals,
  isKnownChordType,
} from '../../generation/newEngine/knowledge/chords';
import type {
  ChordWindowAnalysis,
  DecodedChordSpan,
  HarmonicBoundary,
} from './types';

interface RefinedChordTimeline {
  chordTimeline: DecodedChordSpan[];
  boundaries: HarmonicBoundary[];
  mergedBoundaryCount: number;
}

const modulo = (value: number): number => ((value % 12) + 12) % 12;

function pitchClassSet(type: string | null): Set<number> | null {
  if (!type || !isKnownChordType(type)) return null;
  return new Set(chordTypeIntervals(type).map(modulo));
}

function isSubset(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  return Array.from(left).every((pitchClass) => right.has(pitchClass));
}

function compatibleSameRootVoicing(
  left: DecodedChordSpan,
  right: DecodedChordSpan,
): boolean {
  if (left.rootPc === null || right.rootPc === null || left.rootPc !== right.rootPc) return false;
  if (left.type === right.type) return true;
  const leftPcs = pitchClassSet(left.type);
  const rightPcs = pitchClassSet(right.type);
  if (!leftPcs || !rightPcs) return false;
  return isSubset(leftPcs, rightPcs) || isSubset(rightPcs, leftPcs);
}

function richerChord(
  left: DecodedChordSpan,
  right: DecodedChordSpan,
): DecodedChordSpan {
  const leftSize = pitchClassSet(left.type)?.size ?? 0;
  const rightSize = pitchClassSet(right.type)?.size ?? 0;
  if (rightSize > leftSize) return right;
  if (leftSize > rightSize) return left;
  return right.confidence > left.confidence ? right : left;
}

/**
 * A block chord is often serialized as several attacks: root/fifth first,
 * third/seventh/tensions a little later. Candidate recognition must happen
 * before this can be distinguished from a real harmony change. Collapse only
 * contiguous, same-measure candidates whose pitch-class definitions are
 * identical or strict extensions of one another. Incompatible same-root
 * quality changes (for example C major -> C minor) remain separate.
 */
export function refineIndependentChordTimeline(
  windows: ReadonlyArray<ChordWindowAnalysis>,
  chordTimeline: ReadonlyArray<DecodedChordSpan>,
  boundaries: ReadonlyArray<HarmonicBoundary>,
): RefinedChordTimeline {
  const windowById = new Map(windows.map((analysis) => [
    analysis.window.id,
    analysis.window,
  ]));
  const refined: DecodedChordSpan[] = [];
  const removedBoundaryTicks = new Set<number>();

  for (const chord of chordTimeline) {
    const previous = refined[refined.length - 1];
    const previousWindow = previous
      ? windowById.get(previous.sourceWindowIds[0])
      : null;
    const currentWindow = windowById.get(chord.sourceWindowIds[0]);
    const sameMeasure = previousWindow
      && currentWindow
      && previousWindow.measureId === currentWindow.measureId;
    const contiguous = previous?.endTick === chord.startTick;
    if (!previous || !sameMeasure || !contiguous
        || !compatibleSameRootVoicing(previous, chord)) {
      refined.push({ ...chord, sourceWindowIds: [...chord.sourceWindowIds] });
      continue;
    }

    const preferred = richerChord(previous, chord);
    removedBoundaryTicks.add(chord.startTick);
    refined[refined.length - 1] = {
      ...preferred,
      id: previous.id,
      startTick: previous.startTick,
      endTick: chord.endTick,
      sourceWindowIds: Array.from(new Set([
        ...previous.sourceWindowIds,
        ...chord.sourceWindowIds,
      ])),
    };
  }

  return {
    chordTimeline: refined,
    boundaries: boundaries.filter((boundary) => !removedBoundaryTicks.has(boundary.tick)),
    mergedBoundaryCount: removedBoundaryTicks.size,
  };
}
