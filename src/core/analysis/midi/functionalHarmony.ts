import type {
  AppliedTarget,
  DecodedChordSpan,
  FunctionalChordAnalysis,
  KeyCandidate,
  ProgressionPattern,
} from './types';

const ROMAN_UPPER = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const modulo = (value: number): number => ((value % 12) + 12) % 12;

function signedChromaticDistance(from: number, to: number): number {
  const forward = modulo(to - from);
  return forward <= 6 ? forward : forward - 12;
}

function degreeForRoot(
  rootPc: number,
  key: KeyCandidate,
): { degree: number; accidental: number } {
  const scale = key.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  const offset = modulo(rootPc - key.tonicPc);
  let bestDegree = 1;
  let bestAccidental = 99;
  for (let index = 0; index < scale.length; index++) {
    const accidental = signedChromaticDistance(scale[index], offset);
    if (Math.abs(accidental) < Math.abs(bestAccidental)) {
      bestDegree = index + 1;
      bestAccidental = accidental;
    }
  }
  return { degree: bestDegree, accidental: bestAccidental };
}

function isMinorish(type: string): boolean {
  return type === 'min' || /^m(?!aj)/.test(type) || type.startsWith('dim');
}

function isDominantFamily(type: string): boolean {
  return /^(7|9|11|13)/.test(type) && !type.includes('maj');
}

function accidentalText(accidental: number): string {
  if (accidental < 0) return '♭'.repeat(Math.min(2, Math.abs(accidental)));
  if (accidental > 0) return '♯'.repeat(Math.min(2, accidental));
  return '';
}

function qualitySuffix(type: string): string {
  if (type === 'maj' || type === 'min') return '';
  if (type === 'dim') return '°';
  if (type === 'dim7') return '°7';
  if (type === 'm7b5') return 'ø7';
  if (type === 'maj7') return 'maj7';
  if (type === 'm7') return '7';
  return type;
}

function romanForDegree(degree: number, accidental: number, type: string): string {
  const base = ROMAN_UPPER[degree - 1] ?? '?';
  const cased = isMinorish(type) ? base.toLowerCase() : base;
  return `${accidentalText(accidental)}${cased}${qualitySuffix(type)}`;
}

function functionFor(
  degree: number,
  type: string,
  appliedTarget: AppliedTarget | undefined,
): FunctionalChordAnalysis['function'] {
  if (appliedTarget || degree === 5 || degree === 7 || isDominantFamily(type)) return 'D';
  if (degree === 2 || degree === 4) return 'S';
  return 'T';
}

export function analyzeChordFunctions(
  timeline: ReadonlyArray<DecodedChordSpan>,
  key: KeyCandidate | null,
): FunctionalChordAnalysis[] {
  if (!key) {
    return timeline.map((span) => ({
      chordSpanId: span.id,
      degree: null,
      accidental: 0,
      roman: span.rootPc === null ? 'N.C.' : '?',
      function: 'unknown',
      inversionBassPc: span.bassPc !== span.rootPc ? span.bassPc : null,
    }));
  }

  return timeline.map((span, index) => {
    if (span.rootPc === null || span.type === null) {
      return {
        chordSpanId: span.id,
        degree: null,
        accidental: 0,
        roman: 'N.C.',
        function: 'unknown' as const,
        inversionBassPc: null,
      };
    }
    const globalDegree = degreeForRoot(span.rootPc, key);
    const next = timeline[index + 1];
    let appliedTarget: AppliedTarget | undefined;
    let degree = globalDegree.degree;
    let accidental = globalDegree.accidental;
    let roman = romanForDegree(degree, accidental, span.type);
    if (isDominantFamily(span.type) && next?.rootPc !== null && next?.rootPc !== undefined
        && modulo(next.rootPc - span.rootPc) === 5) {
      const target = degreeForRoot(next.rootPc, key);
      if (target.degree !== 1 || target.accidental !== 0) {
        appliedTarget = target;
        degree = 5;
        accidental = 0;
        const targetRoman = `${accidentalText(target.accidental)}${ROMAN_UPPER[target.degree - 1].toLowerCase()}`;
        roman = `V${qualitySuffix(span.type)}/${targetRoman}`;
      }
    }
    return {
      chordSpanId: span.id,
      degree,
      accidental,
      roman,
      function: functionFor(degree, span.type, appliedTarget),
      inversionBassPc: span.bassPc !== span.rootPc ? span.bassPc : null,
      ...(appliedTarget ? { appliedTarget } : {}),
    };
  });
}

export function detectProgressionPatterns(
  functions: ReadonlyArray<FunctionalChordAnalysis>,
): ProgressionPattern[] {
  const patterns: ProgressionPattern[] = [];
  // The chord timeline stays measure-aligned for auditing. Pattern matching,
  // however, should operate on harmonic changes so ii–ii–V–I still reads as
  // ii–V–I, matching the former merged-span behavior.
  const structural = functions
    .map((analysis, originalIndex) => ({ analysis, originalIndex }))
    .filter((entry, index, entries) => index === 0
      || entry.analysis.roman !== entries[index - 1].analysis.roman
      || entry.analysis.inversionBassPc !== entries[index - 1].analysis.inversionBassPc);
  const degreeAt = (index: number): number | null => structural[index]?.analysis.degree ?? null;

  for (let index = 0; index < structural.length; index++) {
    const originalIndex = structural[index].originalIndex;
    if (degreeAt(index) === 1 && degreeAt(index + 1) === 6
        && degreeAt(index + 2) === 2 && degreeAt(index + 3) === 5) {
      patterns.push({
        startChordIndex: originalIndex,
        endChordIndex: structural[index + 3].originalIndex,
        kind: 'turnaround',
        label: 'I–vi–ii–V turnaround',
        confidence: 0.95,
      });
    }
    if (degreeAt(index) === 2 && degreeAt(index + 1) === 5 && degreeAt(index + 2) === 1) {
      patterns.push({
        startChordIndex: originalIndex,
        endChordIndex: structural[index + 2].originalIndex,
        kind: 'ii-V-I',
        label: 'ii–V–I',
        confidence: 0.97,
      });
    }
    if (degreeAt(index) === 4 && degreeAt(index + 1) === 5 && degreeAt(index + 2) === 1) {
      patterns.push({
        startChordIndex: originalIndex,
        endChordIndex: structural[index + 2].originalIndex,
        kind: 'IV-V-I',
        label: 'IV–V–I',
        confidence: 0.94,
      });
    }
    if (degreeAt(index) === 5 && degreeAt(index + 1) === 6) {
      patterns.push({
        startChordIndex: originalIndex,
        endChordIndex: structural[index + 1].originalIndex,
        kind: 'deceptive',
        label: 'V–vi deceptive motion',
        confidence: 0.9,
      });
    } else if (degreeAt(index) === 5 && degreeAt(index + 1) === 1) {
      patterns.push({
        startChordIndex: originalIndex,
        endChordIndex: structural[index + 1].originalIndex,
        kind: 'V-I',
        label: 'V–I cadence',
        confidence: 0.92,
      });
    }
  }
  return patterns;
}
