import type {
  DecodedChordSpan,
  KeyCandidate,
  LocalKeySegment,
  MidiHarmonyAnalysis,
  MidiKeyAnalysis,
} from './types';

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const modulo = (value: number): number => ((value % 12) + 12) % 12;

type ChordFamily = 'major' | 'minor' | 'dominant' | 'diminished' | 'other';

function chordFamily(type: string | null): ChordFamily {
  if (!type) return 'other';
  if (type.startsWith('dim') || type.includes('b5')) return 'diminished';
  if (/^(7|9|11|13)/.test(type) && !type.includes('maj')) return 'dominant';
  if (type === 'min' || /^m(?!aj)/.test(type)) return 'minor';
  if (type === 'maj' || type.startsWith('maj') || type === '6' || type === '6/9') return 'major';
  return 'other';
}

function expectedFamilyScore(
  candidate: KeyCandidate,
  scaleDegree: number,
  family: ChordFamily,
): number {
  if (family === 'other') return 0;
  const majorExpected: ChordFamily[] = [
    'major', 'minor', 'minor', 'major', 'dominant', 'minor', 'diminished',
  ];
  const minorExpected: ChordFamily[] = [
    'minor', 'diminished', 'major', 'minor', 'dominant', 'major', 'major',
  ];
  const expected = candidate.mode === 'major' ? majorExpected[scaleDegree] : minorExpected[scaleDegree];
  if (family === expected) return 0.1;
  if (scaleDegree === 4 && candidate.mode === 'minor' && family === 'minor') return 0.09;
  if (scaleDegree === 4 && candidate.mode === 'minor' && family === 'major') return 0.025;
  if (scaleDegree === 6 && family === 'diminished') return 0.035;
  if (scaleDegree === 4 && family === 'major') return 0.05;
  return scaleDegree === 0 ? -0.13 : -0.045;
}

function harmonicEvidenceScore(
  candidate: KeyCandidate,
  spans: ReadonlyArray<DecodedChordSpan>,
): { score: number; evidence: string[] } {
  const usable = spans.filter((span) => span.rootPc !== null && span.type !== null);
  if (usable.length === 0) return { score: 0, evidence: ['没有可用和弦，未加入和声调性证据'] };
  const scale = candidate.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  let weightedFit = 0;
  let totalWeight = 0;
  for (const span of usable) {
    const offset = modulo((span.rootPc as number) - candidate.tonicPc);
    const degreeIndex = scale.indexOf(offset);
    const weight = 0.55 + 0.45 * span.confidence;
    let fit = degreeIndex >= 0 ? 0.055 : -0.085;
    if (degreeIndex >= 0) fit += expectedFamilyScore(candidate, degreeIndex, chordFamily(span.type));
    if (offset === 0) fit += 0.025;
    weightedFit += fit * weight;
    totalWeight += weight;
  }
  let score = totalWeight > 0 ? weightedFit / totalWeight : 0;
  const first = usable[0];
  const final = usable[usable.length - 1];
  if (first.rootPc === candidate.tonicPc) score += 0.035;
  if (final.rootPc === candidate.tonicPc) {
    score += 0.22;
    if (chordFamily(final.type) === (candidate.mode === 'major' ? 'major' : 'minor')) score += 0.08;
    if (final.bassPc === candidate.tonicPc) score += 0.07;
  }
  return {
    score,
    evidence: [
      `和弦根音/性质适配 ${usable.length} 个和弦切片`,
      final.rootPc === candidate.tonicPc ? '末和弦落在候选主音' : '末和弦未落在候选主音',
      '未使用和弦进行或终止式先验',
    ],
  };
}

function withConfidence(
  candidates: Array<Omit<KeyCandidate, 'confidence'>>,
): KeyCandidate[] {
  if (candidates.length === 0) return [];
  const maximum = Math.max(...candidates.map((candidate) => candidate.score));
  const weights = candidates.map((candidate) => Math.exp((candidate.score - maximum) / 0.1));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return candidates
    .map((candidate, index) => ({
      ...candidate,
      confidence: total > 0 ? weights[index] / total : 0,
    }))
    .sort((left, right) => right.score - left.score);
}

function refineCandidates(
  candidates: ReadonlyArray<KeyCandidate>,
  spans: ReadonlyArray<DecodedChordSpan>,
  declaredLabel?: string,
): { candidates: KeyCandidate[]; evidenceByLabel: Map<string, string[]> } {
  const evidenceByLabel = new Map<string, string[]>();
  const rescored = candidates.map((candidate) => {
    const harmonic = harmonicEvidenceScore(candidate, spans);
    const declarationPrior = declaredLabel === candidate.label ? 0.045 : 0;
    evidenceByLabel.set(candidate.label, harmonic.evidence);
    return {
      tonicPc: candidate.tonicPc,
      mode: candidate.mode,
      label: candidate.label,
      score: candidate.score + harmonic.score + declarationPrior,
    };
  });
  return { candidates: withConfidence(rescored), evidenceByLabel };
}

function refineLocalSegments(
  segments: ReadonlyArray<LocalKeySegment>,
  timeline: ReadonlyArray<DecodedChordSpan>,
): LocalKeySegment[] {
  return segments.map((segment) => {
    const spans = timeline.filter((span) =>
      span.startTick < segment.endTick && span.endTick > segment.startTick);
    const refined = refineCandidates(segment.candidates, spans);
    const top = refined.candidates[0] ?? null;
    const selected = top && top.confidence >= 0.35 ? top : null;
    return {
      ...segment,
      candidates: refined.candidates,
      selected,
      confidence: top?.confidence ?? 0,
      evidence: selected
        ? [
          ...(segment.evidence ?? []),
          ...(refined.evidenceByLabel.get(selected.label) ?? []),
          '局部调性以该段 bass、伴奏和弦及段尾落点共同确定',
        ]
        : [...(segment.evidence ?? []), '局部候选置信度低于 35%，保持未确定'],
    };
  });
}

export function refineMidiKeyWithHarmony(
  pitchKeyAnalysis: MidiKeyAnalysis,
  harmony: MidiHarmonyAnalysis,
): MidiKeyAnalysis {
  const refined = refineCandidates(
    pitchKeyAnalysis.candidates,
    harmony.chordTimeline,
    pitchKeyAnalysis.declared?.value,
  );
  const top = refined.candidates[0] ?? null;
  const warnings = pitchKeyAnalysis.warnings.filter((warning) =>
    !warning.startsWith('声明调号 '));
  if (pitchKeyAnalysis.declared && top
      && pitchKeyAnalysis.declared.value !== top.label && top.confidence >= 0.55) {
    warnings.push(`声明调号 ${pitchKeyAnalysis.declared.value} 与音级/和声综合首选 ${top.label} 不一致`);
  }
  if (top && top.confidence < 0.5) {
    warnings.push('综合音级、bass 与已确定和弦后，大小调候选仍接近');
  }
  return {
    ...pitchKeyAnalysis,
    candidates: refined.candidates,
    inferred: top
      ? {
        value: top.label,
        source: 'inferred',
        confidence: top.confidence,
        alternatives: refined.candidates.slice(1, 5).map((candidate) => ({
          value: candidate.label,
          confidence: candidate.confidence,
        })),
        evidence: [
          '结构音级分布与大/小调稳定度',
          ...(refined.evidenceByLabel.get(top.label) ?? []),
          '声明调号仅作为弱先验，不覆盖实际和声',
        ],
        warnings: top.confidence < 0.5 ? ['相对大小调或短素材仍有歧义'] : [],
      }
      : null,
    localSegments: refineLocalSegments(
      pitchKeyAnalysis.localSegments,
      harmony.chordTimeline,
    ),
    warnings,
  };
}
