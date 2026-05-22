// ============================================================
// chord-detection.ts — Chord recognition from midi notes
// ============================================================
// Phase 6.1 拆分自 mg-engine/musicTheory.ts(L897-1014)。
// detectChord:reverse from sounding midi notes to chord(root + type)。
// ============================================================

import { CHORD_TYPES } from './chord-types';

export interface ChordDetection {
  /** Canonical CHORD_TYPES key (`'maj7'` / `'m7b5'` / etc.). */
  name: string;
  /** Pitch class 0..11 of the detected chord root. */
  tonicPc: number;
  /** True when caller-supplied bassPc differs from the detected tonic. */
  isInversion: boolean;
  /** 1.0 root-position, 0.5 inversion. Caller sorts by this. */
  weight: number;
}

function pcsToChroma(pcs: Set<number>): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += pcs.has(i) ? '1' : '0';
  return s;
}

function rotateChroma(chroma: string, by: number): string {
  const n = ((by % 12) + 12) % 12;
  return chroma.slice(n) + chroma.slice(0, n);
}

// Bitmask convention: chroma is parsed left-to-right as MSB-first int.
// chroma[7] (pc 7 = P5) → bit 4 (value 16).
// chroma[3] | chroma[4] (pc 3, pc 4 = thirds) → bits 8 | 7 (value 384).
// chroma[6] | chroma[8] (pc 6, pc 8 = b5, #5) → bits 5 | 3 (value 40).
// chroma[10] | chroma[11] (pc 10, pc 11 = sevenths) → bits 1 | 0 (value 3).
const _BIT_THIRDS = 384;
const _BIT_P5 = 16;
const _BIT_NON_P5 = 40;
const _BIT_SEVENTHS = 3;

function chromaHas(chroma: string, bitmask: number): boolean {
  return (parseInt(chroma, 2) & bitmask) !== 0;
}

function chromaWithP5(chroma: string): string {
  if (chromaHas(chroma, _BIT_NON_P5)) return chroma;
  const n = parseInt(chroma, 2) | _BIT_P5;
  return n.toString(2).padStart(12, '0');
}

function chordTypeIsCompleteTriad7(name: string): boolean {
  const ivs = CHORD_TYPES[name];
  if (!ivs) return false;
  const chroma = pcsToChroma(new Set(ivs.map(iv => ((iv % 12) + 12) % 12)));
  return chromaHas(chroma, _BIT_THIRDS)
      && chromaHas(chroma, _BIT_P5)
      && chromaHas(chroma, _BIT_SEVENTHS);
}

// Reverse lookup: chroma_string → [canonical chord type names].
// Module-load constant. Multiple types can share a chroma (`'7'` and
// `'dom7'` both = [0,4,7,10]); both are returned.
let _CHORD_CHROMA_INDEX: Record<string, string[]> | null = null;
function getChordChromaIndex(): Record<string, string[]> {
  if (_CHORD_CHROMA_INDEX) return _CHORD_CHROMA_INDEX;
  const idx: Record<string, string[]> = {};
  for (const [name, ivs] of Object.entries(CHORD_TYPES)) {
    const pcs = new Set(ivs.map(iv => ((iv % 12) + 12) % 12));
    const chroma = pcsToChroma(pcs);
    (idx[chroma] = idx[chroma] || []).push(name);
  }
  _CHORD_CHROMA_INDEX = idx;
  return idx;
}

export function detectChord(
  pcs: Set<number> | number[],
  options: { bassPc?: number; assumePerfectFifth?: boolean } = {},
): ChordDetection[] {
  const inputArr = Array.isArray(pcs) ? pcs : Array.from(pcs);
  const inputPcs = new Set(inputArr.map(p => ((p % 12) + 12) % 12));
  if (inputPcs.size === 0) return [];

  const baseChroma = pcsToChroma(inputPcs);
  const assumeP5 = options.assumePerfectFifth ?? true;
  const bassPc = options.bassPc !== undefined
    ? ((options.bassPc % 12) + 12) % 12
    : undefined;

  const index = getChordChromaIndex();
  const results: ChordDetection[] = [];
  const seen = new Set<string>();  // dedupe (name|tonicPc)

  for (let tonicPc = 0; tonicPc < 12; tonicPc++) {
    if (!inputPcs.has(tonicPc)) continue;
    const rotated = rotateChroma(baseChroma, tonicPc);

    const exactMatches = index[rotated] ?? [];
    for (const name of exactMatches) {
      const key = `${name}|${tonicPc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const isInversion = bassPc !== undefined && bassPc !== tonicPc;
      results.push({ name, tonicPc, isInversion, weight: isInversion ? 0.5 : 1.0 });
    }

    if (assumeP5) {
      const withP5 = chromaWithP5(rotated);
      if (withP5 !== rotated) {
        const extraMatches = (index[withP5] ?? []).filter(chordTypeIsCompleteTriad7);
        for (const name of extraMatches) {
          const key = `${name}|${tonicPc}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const isInversion = bassPc !== undefined && bassPc !== tonicPc;
          // Slight weight penalty since 5 was implied not heard
          results.push({ name, tonicPc, isInversion, weight: isInversion ? 0.45 : 0.9 });
        }
      }
    }
  }

  results.sort((a, b) => b.weight - a.weight);
  return results;
}

