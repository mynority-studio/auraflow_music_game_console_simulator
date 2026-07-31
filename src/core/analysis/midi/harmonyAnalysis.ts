import { analyzeChordWindows } from './chordCandidates';
import { decodeIndependentChords } from './chordDecoder';
import { refineIndependentChordTimeline } from './chordRefinement';
import { detectHarmonicSegments } from './harmonicSegmentation';
import { buildHarmonicWindows } from './harmonicWindows';
import type {
  MidiHarmonyAnalysis,
  MidiInventory,
  MidiMeasureMap,
  MidiNoteSpan,
  MidiVoiceSeparation,
  RichSmfDocument,
} from './types';

export function analyzeMidiHarmony(
  document: RichSmfDocument,
  notes: ReadonlyArray<MidiNoteSpan>,
  inventory: MidiInventory,
  measures: MidiMeasureMap,
  voices: MidiVoiceSeparation,
): MidiHarmonyAnalysis {
  if (!document.analysisSupport.supported) {
    return {
      boundaries: [],
      windows: [],
      chordTimeline: [],
      functions: [],
      patterns: [],
      analysisKey: null,
      warnings: [`${'reason' in document.analysisSupport ? document.analysisSupport.reason : 'unsupported'}: 不执行和声推断`],
    };
  }
  const segmentation = detectHarmonicSegments(document, notes, inventory, measures, voices);
  const harmonicWindows = buildHarmonicWindows(
    document,
    notes,
    inventory,
    measures,
    voices,
    segmentation.segments,
  );
  const windows = analyzeChordWindows(harmonicWindows);
  const decodedTimeline = decodeIndependentChords(windows);
  const refinement = refineIndependentChordTimeline(
    windows,
    decodedTimeline,
    segmentation.boundaries,
  );
  const warnings: string[] = [];
  warnings.push('和弦候选按切片独立识别；未使用调性、和弦进行或终止式修正候选，仅回收同根包含型分批落键；和声走向分析已停用');
  if (refinement.mergedBoundaryCount > 0) {
    warnings.push(
      `已合并 ${refinement.mergedBoundaryCount} 个同根、音集包含关系明确的分批落键边界`,
    );
  }
  if (windows.some((window) => window.unknownConfidence >= 0.5)) {
    warnings.push('部分和声窗口证据不足，已保留 N.C./低置信度而未强制命名');
  }
  return {
    boundaries: refinement.boundaries,
    windows,
    chordTimeline: refinement.chordTimeline,
    functions: [],
    patterns: [],
    analysisKey: null,
    warnings,
  };
}
