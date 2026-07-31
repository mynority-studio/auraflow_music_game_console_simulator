import type {
  ChordWindowAnalysis,
  DecodedChordSpan,
} from './types';

/**
 * Evidence-first chord selection. Every slice is decided independently:
 * no key-fit bonus, no cadence reward and no adjacent-chord transition prior.
 */
export function decodeIndependentChords(
  windows: ReadonlyArray<ChordWindowAnalysis>,
): DecodedChordSpan[] {
  return windows.map((windowAnalysis, index) => {
    const candidate = windowAnalysis.candidates[0] ?? null;
    const unknownWins = !candidate
      || (windowAnalysis.unknownConfidence >= candidate.confidence
        && windowAnalysis.unknownConfidence >= 0.45);
    return {
      id: `hc${index}`,
      startTick: windowAnalysis.window.startTick,
      endTick: windowAnalysis.window.endTick,
      rootPc: unknownWins ? null : candidate.rootPc,
      type: unknownWins ? null : candidate.type,
      bassPc: unknownWins ? windowAnalysis.window.bassPc : candidate.bassPc,
      label: unknownWins ? 'N.C.' : candidate.label,
      confidence: unknownWins
        ? windowAnalysis.unknownConfidence
        : Math.max(0, Math.min(1, candidate.confidence)),
      sourceWindowIds: [windowAnalysis.window.id],
    };
  });
}
