// ============================================================
// newEngine · knowledge · MgLocalScaleResolver(MG strict 移植 Loop 6 · re-sync 2)
// Provenance: ../melodygenerative/src/lib/localScaleResolver.ts 逐字节复制(cp + 改 import)。
// ⚠️ MG 活跃开发:re-sync 到含 borrowedImpliesPhrygianScale(bII roman 才切 Phrygian,防 VII 回归误解析)。
// ============================================================

import type { StyleName } from './mgMusicTheory';
import {
  CHORD_TYPES,
  MELODY_RANGE,
  SCALE_TYPES,
  modeToKeyFamily,
  noteToMidi,
  normalizeChordType,
} from './mgMusicTheory';

export interface LocalScaleChordLike {
  rootMidi: number;
  type: string;
  roman: string;
  effectiveFunc?: 'T' | 'S' | 'D';
  forcedScale?: string;
  localTonalCenterPc?: number;
  borrowedFrom?: string | null;
  borrowedSource?: string;
}

export interface LocalScaleContext {
  style: StyleName;
  key: string;
  mode: string;
}

export interface ResolvedLocalScale {
  name: string;
  rootPc: number;
  pcs: Set<number>;
  source:
    | 'forced'
    | 'altered-dominant'
    | 'tonicization'
    | 'modal-interchange'
    | 'minor-dominant'
    | 'contract-fit'
    | 'chord-root'
    | 'global';
  strict: boolean;
}

export interface MelodyAdmissionContext {
  contractPcs: Set<number>;
  localScale: ResolvedLocalScale;
  intersectionPcs: Set<number>;
}

export function pcOf(value: number): number {
  return ((value % 12) + 12) % 12;
}

export function keyToPc(key: string): number {
  return pcOf(noteToMidi(`${key}0`));
}

export function scalePcs(rootPc: number, scaleName: string): Set<number> {
  const scale = SCALE_TYPES[scaleName] ?? null;
  if (!scale) return new Set<number>();
  return new Set(scale.map(iv => pcOf(rootPc + iv)));
}

export function melodyContractPcsForStyle(
  style: StyleName,
  chord: Pick<LocalScaleChordLike, 'type'> & Partial<Pick<LocalScaleChordLike, 'borrowedSource' | 'borrowedFrom' | 'roman'>>,
  rootPc: number,
): Set<number> {
  const canonicalType = normalizeChordType(chord.type) ?? chord.type;
  return declaredChordPcs(canonicalType, rootPc);
}

export function resolveMelodyAdmissionContext(
  ctx: LocalScaleContext,
  chord: LocalScaleChordLike,
): MelodyAdmissionContext {
  const rootPc = pcOf(chord.rootMidi);
  const contractPcs = melodyContractPcsForStyle(ctx.style, chord, rootPc);
  const localScale = resolveLocalScale(ctx, chord);
  const intersectionPcs = new Set([...contractPcs].filter(pc => localScale.pcs.has(pc)));
  return { contractPcs, localScale, intersectionPcs };
}

export function buildRunScale(localScale: ResolvedLocalScale): number[] {
  const out: number[] = [];
  for (let midi = MELODY_RANGE.LOW - 12; midi <= MELODY_RANGE.HIGH + 12; midi++) {
    if (localScale.pcs.has(pcOf(midi))) out.push(midi);
  }
  return out;
}

export function harmonicFunctionFromRomanLike(romanOriginal: string): 'T' | 'S' | 'D' {
  const base = romanOriginal
    .split('/')[0]
    .replace(/maj7|maj9|maj13|m7|m9|m11|sus4|7sus4|9sus4|7b13|7#9|7alt|dim|aug|\+|o|ø|[0-9]/g, '');
  if (['V', 'v', 'vii', 'VII'].includes(base) || romanOriginal.includes('/')) return 'D';
  if (['IV', 'iv', 'ii', 'II', 'bVI', 'bVII'].includes(base)) return 'S';
  return 'T';
}

function minorLike(type: string): boolean {
  const t = normalizeChordType(type) ?? type;
  return t === 'min'
    || t === 'm'
    || (t.startsWith('m') && !t.startsWith('maj'))
    || t.includes('dim');
}

function majorLike(type: string): boolean {
  const t = normalizeChordType(type) ?? type;
  return t === 'maj'
    || t === 'add9'
    || t === '6'
    || t === '6/9'
    || t.startsWith('maj');
}

function domLike(type: string): boolean {
  const t = normalizeChordType(type) ?? type;
  return !minorLike(t)
    && !majorLike(t)
    && (t === '7'
      || t.includes('7')
      || t.includes('9')
      || t.includes('11')
      || t.includes('13')
      || t.includes('sus'));
}

function targetLabelFromRoman(roman: string): string | null {
  const parts = roman.split('/');
  return parts.length > 1 ? (parts[1]?.trim() || null) : null;
}

function targetIsMinor(label: string | null): boolean {
  if (!label) return false;
  const clean = label.replace(/^[b#]/, '');
  return clean === clean.toLowerCase() || ['ii', 'iii', 'iv', 'vi'].includes(clean);
}

function romanHead(roman: string): string {
  return roman.split('/')[0]?.replace(/^[b#]/, '') ?? roman;
}

function keyModePcs(ctx: LocalScaleContext): Set<number> {
  const mode = SCALE_TYPES[ctx.mode] ? ctx.mode : 'Ionian';
  return scalePcs(keyToPc(ctx.key), mode);
}

function chordContractFitsKeyMode(ctx: LocalScaleContext, chord: LocalScaleChordLike): boolean {
  const keyPcs = keyModePcs(ctx);
  const rootPc = pcOf(chord.rootMidi);
  if (!keyPcs.has(rootPc)) return false;
  const canonicalType = normalizeChordType(chord.type) ?? chord.type;
  const contract = declaredChordPcs(canonicalType, rootPc);
  for (const pc of contract) {
    if (!keyPcs.has(pc)) return false;
  }
  return true;
}

function borrowedImpliesPhrygianScale(chord: LocalScaleChordLike, borrowedFrom: string): boolean {
  const roman = chord.roman ?? '';
  return /^bII\b/.test(roman)
    && /Phrygian|bII/i.test(borrowedFrom);
}

function declaredChordPcs(type: string, rootPc: number): Set<number> {
  const literal = CHORD_TYPES[type] ?? CHORD_TYPES.maj;
  return new Set(literal.map(iv => pcOf(rootPc + iv)));
}

function pcsContainAll(parent: Set<number>, child: Set<number>): boolean {
  for (const pc of child) {
    if (!parent.has(pc)) return false;
  }
  return true;
}

function contractScaleCandidateNames(style: StyleName): string[] {
  const common = [
    'Ionian',
    'Dorian',
    'Phrygian',
    'Lydian',
    'Mixolydian',
    'Aeolian',
    'Harmonic Minor',
    'Melodic Minor',
    'Mixolydian b6',
    'Lydian Dominant',
    'Phrygian Dominant',
    'Harmonic Major',
  ];
  if (style !== 'JAZZ') return common;
  return [
    ...common,
    'Altered',
    'Half-Whole Diminished',
    'Whole-Half Diminished',
    'Whole Tone',
    'Bebop Dominant',
    'Bebop Major',
    'Bebop Dorian',
    'Bebop Melodic Minor',
  ];
}

function closestContractPreservingScale(
  ctx: LocalScaleContext,
  chord: LocalScaleChordLike,
): ResolvedLocalScale | null {
  const keyRootPc = keyToPc(ctx.key);
  const chordRootPc = pcOf(chord.rootMidi);
  const type = normalizeChordType(chord.type) ?? chord.type;
  const globalPcs = keyModePcs(ctx);
  const contractPcs = declaredChordPcs(type, chordRootPc);
  const idiomaticName = chordRootScaleName(ctx, { ...chord, type });
  const candidateNames = contractScaleCandidateNames(ctx.style)
    .filter(name => SCALE_TYPES[name]);
  const candidateRoots = ctx.style === 'JAZZ'
    ? Array.from({ length: 12 }, (_, i) => i)
    : [...new Set([chordRootPc, keyRootPc])];

  let best: { name: string; rootPc: number; score: number } | null = null;
  for (const name of candidateNames) {
    for (const rootPc of candidateRoots) {
      const pcs = scalePcs(rootPc, name);
      if (!pcsContainAll(pcs, contractPcs)) continue;

      let sharedWithGlobal = 0;
      let outsideGlobal = 0;
      for (const pc of pcs) {
        if (globalPcs.has(pc)) sharedWithGlobal++;
        else outsideGlobal++;
      }

      const chordRootBonus = rootPc === chordRootPc ? 2 : 0;
      const idiomBonus = rootPc === chordRootPc && name === idiomaticName ? 3 : 0;
      const keyRootBonus = rootPc === keyRootPc ? 1 : 0;
      const cardinalityPenalty = Math.abs(pcs.size - globalPcs.size);
      const score = sharedWithGlobal * 10
        - outsideGlobal * 7
        - cardinalityPenalty
        + chordRootBonus
        + idiomBonus
        + keyRootBonus;

      if (!best || score > best.score) {
        best = { name, rootPc, score };
      }
    }
  }

  return best ? resolved(best.name, best.rootPc, 'contract-fit') : null;
}

function chordRootScaleName(ctx: LocalScaleContext, chord: LocalScaleChordLike): string {
  const type = normalizeChordType(chord.type) ?? chord.type;
  const func = chord.effectiveFunc ?? harmonicFunctionFromRomanLike(chord.roman);
  const head = romanHead(chord.roman).toLowerCase();
  if (/alt|#9|b9/.test(type)) return 'Altered';
  if (/#11/.test(type)) return 'Lydian Dominant';
  if (/b13/.test(type)) return 'Mixolydian b6';
  if (domLike(type)) return 'Mixolydian';
  if (minorLike(type)) return (func === 'T' || head === 'i' || head === 'vi') ? 'Aeolian' : 'Dorian';
  if (majorLike(type) && /#11/.test(type)) return 'Lydian';
  if (majorLike(type) || type.includes('maj')) return ctx.style === 'JAZZ' ? 'Lydian' : 'Ionian';
  return 'Ionian';
}

function resolved(name: string, rootPc: number, source: ResolvedLocalScale['source']): ResolvedLocalScale {
  return {
    name,
    rootPc,
    pcs: scalePcs(rootPc, name),
    source,
    strict: source !== 'global',
  };
}

export function resolveLocalScale(ctx: LocalScaleContext, chord: LocalScaleChordLike): ResolvedLocalScale {
  const keyRootPc = keyToPc(ctx.key);
  const chordRootPc = pcOf(chord.rootMidi);
  const type = normalizeChordType(chord.type) ?? chord.type;

  if (chord.forcedScale && SCALE_TYPES[chord.forcedScale]) {
    return resolved(chord.forcedScale, chordRootPc, 'forced');
  }

  if (domLike(type) && /alt|#9|b9|#11|b13/.test(type)) {
    return resolved(chordRootScaleName(ctx, { ...chord, type }), chordRootPc, 'altered-dominant');
  }

  const localTarget = chord.localTonalCenterPc;
  if (localTarget !== undefined && localTarget !== keyRootPc) {
    if (chord.roman.startsWith('subV')) {
      return resolved('Lydian Dominant', chordRootPc, 'tonicization');
    }
    const label = targetLabelFromRoman(chord.roman);
    const targetMinor = targetIsMinor(label);
    const sourceHead = romanHead(chord.roman);
    if ((sourceHead === 'V' || sourceHead === 'VII') && domLike(type) && targetMinor) {
      return resolved('Harmonic Minor', pcOf(localTarget), 'tonicization');
    }
    const name = label ? (targetMinor ? 'Aeolian' : 'Ionian') : (minorLike(type) ? 'Aeolian' : 'Ionian');
    return resolved(name, pcOf(localTarget), 'tonicization');
  }

  const borrowedFrom = chord.borrowedFrom ?? '';
  if (chord.borrowedSource === 'modal_interchange' || chord.borrowedSource === 'backdoor_dominant') {
    if (/Dorian/i.test(borrowedFrom)) return resolved('Dorian', keyRootPc, 'modal-interchange');
    if (borrowedImpliesPhrygianScale(chord, borrowedFrom)) return resolved('Phrygian', keyRootPc, 'modal-interchange');
    if (/Mixolydian/i.test(borrowedFrom)) return resolved('Mixolydian', keyRootPc, 'modal-interchange');
    if (/bVII/i.test(borrowedFrom) && majorLike(type)) return resolved('Mixolydian', keyRootPc, 'modal-interchange');
    if (/parallel minor|Aeolian|iv|bVI|bVII|backdoor/i.test(borrowedFrom)
      || chord.roman.startsWith('b')
      || chord.roman === chord.roman.toLowerCase()) {
      return resolved('Aeolian', keyRootPc, 'modal-interchange');
    }
  }

  const modeFamily = modeToKeyFamily(ctx.mode);
  const func = chord.effectiveFunc ?? harmonicFunctionFromRomanLike(chord.roman);
  const head = romanHead(chord.roman);
  const isHomeDominant = head === 'V' || head.startsWith('subV') || chord.borrowedSource === 'secondary_dominant';
  if (modeFamily === 'minor' && func === 'D' && domLike(type) && isHomeDominant) {
    return resolved('Harmonic Minor', keyRootPc, 'minor-dominant');
  }

  if (borrowedFrom) {
    if (/Dorian/i.test(borrowedFrom)) return resolved('Dorian', keyRootPc, 'modal-interchange');
    if (borrowedImpliesPhrygianScale(chord, borrowedFrom)) return resolved('Phrygian', keyRootPc, 'modal-interchange');
    if (/bVII/i.test(borrowedFrom) && majorLike(type)) return resolved('Mixolydian', keyRootPc, 'modal-interchange');
    if (/parallel minor|Aeolian|i |iv|bVI|bVII/i.test(borrowedFrom)) return resolved('Aeolian', keyRootPc, 'modal-interchange');
  }

  if (!chordContractFitsKeyMode(ctx, { ...chord, type })) {
    const contractFit = closestContractPreservingScale(ctx, { ...chord, type });
    if (contractFit) return contractFit;
    const name = chordRootScaleName(ctx, { ...chord, type });
    return resolved(name, chordRootPc, 'chord-root');
  }

  const name = SCALE_TYPES[ctx.mode] ? ctx.mode : 'Ionian';
  return resolved(name, keyRootPc, 'global');
}
