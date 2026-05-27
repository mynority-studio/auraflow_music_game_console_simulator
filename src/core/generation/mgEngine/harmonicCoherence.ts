// ==========================================
// harmonicCoherence.ts — Universal harmony evaluator.
//
// Architecture (per user music-theory rule):
//   "有张力,就要知道它为什么存在、期待什么、是否兑现"
//
//   Universal "debt model" — every chord that creates tension generates
//   a ResolutionObligation declaring:
//     - what tension exists (tendency tones: 3rd, b7, b9, etc.)
//     - what target it expects (V/X expects X)
//     - which tones must move where (B → C, F → E for G7→C)
//     - how long the target must stabilize
//     - whether unresolved is OK (style-dependent)
//
//   Style-specific behavior lives in HarmonicCoherencePolicy. Same
//   scorer, different weights / strictness per style:
//     - JAZZ: every dominant must resolve (or be pivot/sub-V)
//     - POP:  borrowed iv / bVI / bVII need emotional purpose
//     - RNB:  delayed resolution OK, voicing/space matters
//     - BLUES: I7 / IV7 are color, NOT traditional dominants
//
// Phase 1 (this file): diagnostic only. Builds ledger, scores chord
// progression, reports issues. Does NOT mutate generation. Engine
// pipeline unchanged.
//
// Phase 2 (future): UI display.
// Phase 3 (future): selective repair on low-score progressions.
// ==========================================

import { ChordDef } from './musicEngine';

// ─────────────────────────────────────────────────────────────────
// Data types
// ─────────────────────────────────────────────────────────────────

export type ResolutionRole =
  | 'none'
  | 'diatonic_motion'
  | 'secondary_dominant'
  | 'secondary_ii_v'
  | 'tritone_substitution'
  | 'backdoor_dominant'
  | 'modal_color'
  | 'local_modal_color'
  | 'home_dominant'           // home key V chord
  | 'dominant_evasion_to_modal_cadence'  // V → bVII → i: leading tone evades, b7 of bVII (= Aeolian flat-7) carries the cadence
  | 'blues_color';            // I7 / IV7 in BLUES (NOT traditional dom)

export interface Tendency {
  /** Source pc (absolute 0..11) — the tone that creates tension */
  fromPc: number;
  /** Target pc the tendency wants to land on */
  toPc: number;
  /** Resolution direction preference (informational) */
  direction?: 'up' | 'down' | 'nearest';
  /** Weight 0..1 — how important this tendency is */
  weight: number;
  /** Human-readable name (e.g. "dominant 3rd → target root") */
  name: string;
}

export interface ResolutionObligation {
  id: string;
  sourceChordIndex: number;
  targetChordIndex: number | null;  // null if obligation unresolved
  role: ResolutionRole;
  /** Which tonal center the source chord is analyzed against */
  analysisKeyPc: number;
  /** The pc the source chord expects as its resolution target */
  targetPc: number | null;
  /** Individual tone resolution requirements */
  tendencies: Tendency[];
  targetStability: {
    minBeats: number;
    requireStrongBeat: boolean;
    weight: number;
  };
  allowPivot: boolean;
  severity: 'hard' | 'medium' | 'soft';
}

export interface HarmonicCoherencePolicy {
  style: 'POP' | 'JAZZ' | 'RNB' | 'BLUES' | 'LOFI';
  /** 0..1 — how strictly chords must have their guide tones (3 + 7 / b3 + b7 etc.) */
  guideToneStrictness: number;
  /** 0..1 — how strictly tendency tones must resolve in next chord */
  tendencyResolutionStrictness: number;
  /** Minimum beats a target chord must hold to count as "stabilized" */
  targetStabilityBeats: number;
  /** Allow tension to span > 1 chord before resolving */
  allowDelayedResolution: boolean;
  /** Allow color chords (m9 / 13sus / etc.) to hang unresolved */
  allowUnresolvedColor: boolean;
  /** 0..1 — weight of bass motion correctness in overall score */
  bassResolutionWeight: number;
  /** 0..1 — how much chromatic / local borrow freedom permitted */
  localColorFreedom: number;
  /** Minimum score to "pass" this style (below = repair candidate) */
  passThreshold: number;
}

export interface CoherenceReport {
  score: number;              // 0..1 final composite
  passed: boolean;
  policy: HarmonicCoherencePolicy;
  subscores: {
    identity: number;
    guideTone: number;
    tendency: number;
    targetStability: number;
    bass: number;
    localColor: number;
  };
  obligations: ResolutionObligation[];
  issues: CoherenceIssue[];
}

export interface CoherenceIssue {
  chordIndex: number;
  kind: string;
  severity: 'high' | 'mid' | 'low';
  message: string;
}

// ─────────────────────────────────────────────────────────────────
// Style policies
// ─────────────────────────────────────────────────────────────────

export const COHERENCE_POLICIES: Record<string, HarmonicCoherencePolicy> = {
  POP: {
    style: 'POP',
    guideToneStrictness: 0.45,
    tendencyResolutionStrictness: 0.65,
    targetStabilityBeats: 2,
    allowDelayedResolution: false,
    allowUnresolvedColor: true,
    bassResolutionWeight: 0.75,
    localColorFreedom: 0.25,
    passThreshold: 0.72,
  },
  JAZZ: {
    style: 'JAZZ',
    // Softened from user's 0.95 because rootless / sus / quartal jazz
    // voicings legitimately drop 3 or 7 — 0.85 catches obvious gaps
    // (Dmadd9 as ii) without over-flagging Bill Evans rootless idiom.
    guideToneStrictness: 0.85,
    tendencyResolutionStrictness: 0.95,
    targetStabilityBeats: 2,
    allowDelayedResolution: true,
    allowUnresolvedColor: false,
    bassResolutionWeight: 0.8,
    localColorFreedom: 0.55,
    passThreshold: 0.80,
  },
  RNB: {
    style: 'RNB',
    guideToneStrictness: 0.65,
    tendencyResolutionStrictness: 0.7,
    targetStabilityBeats: 1.5,
    allowDelayedResolution: true,
    allowUnresolvedColor: true,
    bassResolutionWeight: 0.55,
    localColorFreedom: 0.65,
    passThreshold: 0.70,
  },
  BLUES: {
    style: 'BLUES',
    guideToneStrictness: 0.4,
    tendencyResolutionStrictness: 0.35,
    targetStabilityBeats: 4,
    allowDelayedResolution: true,
    allowUnresolvedColor: true,
    bassResolutionWeight: 0.9,
    localColorFreedom: 0.2,
    passThreshold: 0.68,
  },
  LOFI: {
    // LOFI: weak cadences, loop-back, modal, soft extensions. Coherence
    // scoring is very lenient — color hanging on loops is the style signature.
    style: 'LOFI',
    guideToneStrictness: 0.30,
    tendencyResolutionStrictness: 0.25,
    targetStabilityBeats: 2,
    allowDelayedResolution: true,
    allowUnresolvedColor: true,
    bassResolutionWeight: 0.45,
    localColorFreedom: 0.55,
    passThreshold: 0.60,
  },
};

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

const pc = (n: number) => ((n % 12) + 12) % 12;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function romanHead(roman: string): string {
  if (!roman) return '';
  const stripped = roman.replace(/^[b#n]+/, '');
  return stripped.match(/^[IVivXx]+/)?.[0] ?? '';
}

/** Pcs in a chord's voicing including bass */
function chordPcs(chord: ChordDef): Set<number> {
  const pcs = new Set<number>();
  pcs.add(pc(chord.bassMidi));
  for (const m of chord.notesMidi ?? []) pcs.add(pc(m));
  return pcs;
}

/** Classify chord quality by type string */
function chordQuality(type: string): 'maj' | 'min' | 'dom' | 'dim' | 'sus' | 'other' {
  if (!type) return 'other';
  if (type === 'm7b5' || type === 'm9b5' || type === 'dim' || type === 'dim7') return 'dim';
  if (type.startsWith('sus') || type === '7sus4' || type === '9sus4' || type === '13sus4' || type === 'm7sus4') return 'sus';
  if (type === 'maj' || type === 'maj7' || type === 'maj9' || type === 'maj13'
      || type === 'maj7#11' || type === 'add9' || type === '6' || type === '6/9' || type === 'maj9#11') return 'maj';
  if (type.startsWith('m') && !type.startsWith('maj')) return 'min';
  if (type === '7' || type === '9' || type === '11' || type === '13'
      || type === '7b9' || type === '7#9' || type === '7b13' || type === '7#11'
      || type === '7alt' || type === '13b9' || type === '7#5' || type === 'aug') return 'dom';
  return 'other';
}

/** BLUES exception — I7 / IV7 are NOT traditional dominants */
function isBluesColorChord(chord: ChordDef, globalKeyPc: number, policyStyle: string): boolean {
  if (policyStyle !== 'BLUES') return false;
  const root = pc(chord.rootMidi);
  const rel = pc(root - globalKeyPc);
  const isI = rel === 0;
  const isIV = rel === 5;
  if (!isI && !isIV) return false;
  return chordQuality(chord.type) === 'dom';  // I7 or IV7
}

// ─────────────────────────────────────────────────────────────────
// Obligation builders
// ─────────────────────────────────────────────────────────────────

function makeDominantObligation(
  chord: ChordDef,
  index: number,
  targetPc: number,
  targetQuality: 'major' | 'minor',
  role: ResolutionRole,
  severity: 'hard' | 'medium',
  next: ChordDef | null,
  policy: HarmonicCoherencePolicy,
): ResolutionObligation {
  const rootPc = pc(chord.rootMidi);
  const third = pc(rootPc + 4);
  const flat7 = pc(rootPc + 10);
  const targetRoot = targetPc;
  const targetThird = targetQuality === 'minor' ? pc(targetPc + 3) : pc(targetPc + 4);
  const targetFifth = pc(targetPc + 7);

  const tendencies: Tendency[] = [
    { fromPc: third, toPc: targetRoot, direction: 'up', weight: 1.0, name: 'dom 3rd → target root' },
    { fromPc: flat7, toPc: targetThird, direction: 'down', weight: 1.0, name: 'dom b7 → target 3rd' },
  ];

  // b9 / #9 / b13 — altered tensions if present in chord type
  const t = chord.type;
  if (t.includes('b9')) {
    const flat9 = pc(rootPc + 1);
    tendencies.push({ fromPc: flat9, toPc: targetFifth, direction: 'down', weight: 0.7, name: 'b9 → target 5th' });
  }
  if (t.includes('#9')) {
    const sharp9 = pc(rootPc + 3);
    tendencies.push({ fromPc: sharp9, toPc: targetRoot, direction: 'up', weight: 0.5, name: '#9 → target root' });
  }
  if (t.includes('b13')) {
    const flat13 = pc(rootPc + 8);
    tendencies.push({ fromPc: flat13, toPc: targetFifth, direction: 'down', weight: 0.6, name: 'b13 → target 5th' });
  }

  const nextRootPc = next ? pc(next.rootMidi) : -1;
  return {
    id: `dom-${index}`,
    sourceChordIndex: index,
    targetChordIndex: nextRootPc === targetPc ? index + 1 : null,
    role,
    analysisKeyPc: chord.analysisKeyPc ?? targetPc,
    targetPc,
    tendencies,
    targetStability: {
      minBeats: policy.targetStabilityBeats,
      requireStrongBeat: true,
      weight: 1.0,
    },
    allowPivot: policy.allowDelayedResolution,
    severity,
  };
}

function makeSubVObligation(
  chord: ChordDef,
  index: number,
  targetPc: number,
  next: ChordDef | null,
  policy: HarmonicCoherencePolicy,
): ResolutionObligation {
  const rootPc = pc(chord.rootMidi);
  const third = pc(rootPc + 4);
  const flat7 = pc(rootPc + 10);

  // SubV's strongest motion is bass half-step down: root → target root
  const tendencies: Tendency[] = [
    { fromPc: rootPc, toPc: targetPc, direction: 'down', weight: 1.0, name: 'subV root → target root (half-step)' },
    { fromPc: third, toPc: pc(targetPc + 4), direction: 'down', weight: 1.0, name: 'subV 3rd → target 3rd (half-step)' },
    { fromPc: flat7, toPc: targetPc, direction: 'up', weight: 1.0, name: 'subV b7 → target root (half-step)' },
  ];

  const nextRootPc = next ? pc(next.rootMidi) : -1;
  return {
    id: `subv-${index}`,
    sourceChordIndex: index,
    targetChordIndex: nextRootPc === targetPc ? index + 1 : null,
    role: 'tritone_substitution',
    analysisKeyPc: chord.analysisKeyPc ?? targetPc,
    targetPc,
    tendencies,
    targetStability: { minBeats: policy.targetStabilityBeats, requireStrongBeat: true, weight: 1.0 },
    allowPivot: false,
    severity: 'hard',
  };
}

function makeBackdoorObligation(
  chord: ChordDef,
  index: number,
  globalKeyPc: number,
  next: ChordDef | null,
  policy: HarmonicCoherencePolicy,
): ResolutionObligation {
  // bVII7 backdoor → I. The b7 of bVII7 = b6 of key; it resolves DOWN
  // to 5 of key. The 3rd of bVII7 = b2 of key; resolves UP to 3 of key.
  // (Different motion from regular V→I.)
  const rootPc = pc(chord.rootMidi);
  const third = pc(rootPc + 4);
  const flat7 = pc(rootPc + 10);
  const targetThird = pc(globalKeyPc + 4);  // major 3rd of I

  const tendencies: Tendency[] = [
    { fromPc: rootPc, toPc: globalKeyPc, direction: 'up', weight: 0.8, name: 'bVII7 root → I root (whole step)' },
    { fromPc: third, toPc: targetThird, direction: 'up', weight: 1.0, name: 'bVII7 3rd → I 3rd' },
    { fromPc: flat7, toPc: pc(globalKeyPc + 4), direction: 'down', weight: 0.9, name: 'bVII7 b7 → I 3rd (smooth voice-lead)' },
  ];

  const nextRootPc = next ? pc(next.rootMidi) : -1;
  return {
    id: `backdoor-${index}`,
    sourceChordIndex: index,
    targetChordIndex: nextRootPc === globalKeyPc ? index + 1 : null,
    role: 'backdoor_dominant',
    analysisKeyPc: globalKeyPc,
    targetPc: globalKeyPc,
    tendencies,
    targetStability: { minBeats: policy.targetStabilityBeats, requireStrongBeat: true, weight: 1.0 },
    allowPivot: false,
    severity: 'hard',
  };
}

/**
 * V → bVII → i / I dominant-evasion cadence obligation.
 *
 * Music rule (per user, pop_tsqr4z analysis): when V is followed by bVII
 * (Aeolian / Mixolydian modal-interchange chord) and then by home tonic,
 * the listener perceives this as "dominant evasion to modal cadence":
 *   - V's leading tone is INTENTIONALLY NOT resolved to tonic
 *     (it side-steps to bVII's M3 which then resolves whole-step down)
 *   - bVII's root (b7 of key) → i's root carries the modal cadence
 *   - V's b7 sustains through bVII's P5 and lands on i's b3 / 1 by
 *     stepwise descent — smooth Aeolian voice-leading
 *
 * This obligation is SOFT (style choice, not strict resolution), uses
 * relaxed tendencies that match the modal cadence, and targets i/I two
 * chords away (bVII is the pivot, not the target).
 *
 * Without this special role, scoreTendencyResolution would treat V as
 * a standard home_dominant and penalize the missing leading tone → 1
 * resolution — but musically Rule G / E3 modal cadences are legitimate
 * and should NOT score down for an intentional evasion.
 */
function makeDominantEvasionObligation(
  vChord: ChordDef,
  vIndex: number,
  bviiChord: ChordDef,
  tonicChord: ChordDef,
  tonicIndex: number,
  globalKeyPc: number,
  policy: HarmonicCoherencePolicy,
): ResolutionObligation {
  const vRootPc = pc(vChord.rootMidi);
  const vThird = pc(vRootPc + 4);   // leading tone of key (B in C major / minor)
  const vFlat7 = pc(vRootPc + 10);  // F in C key
  const bviiRootPc = pc(bviiChord.rootMidi);  // = globalKeyPc + 10 (Bb in C)
  // Tonic 3rd — major if I, minor if i
  const tonicQuality = chordQuality(tonicChord.type);
  const tonicThird = tonicQuality === 'min' ? pc(globalKeyPc + 3) : pc(globalKeyPc + 4);

  // Relaxed tendencies — the modal cadence's actual voice-leading carriers:
  //   - V's b7 → tonic's b3 (smooth Aeolian descent, e.g. F → Eb in Cm)
  //   - bVII's root → tonic root (whole step up, the Aeolian-cadence signature)
  //   - V's root → tonic root (delayed, via bVII)
  //   NOT including leading-tone → 1 — that's the EVASION we're modeling.
  const tendencies: Tendency[] = [
    { fromPc: vFlat7,     toPc: tonicThird,  direction: 'down', weight: 0.7,
      name: 'V b7 → tonic b3/3 (modal voice-leading via bVII)' },
    { fromPc: bviiRootPc, toPc: globalKeyPc, direction: 'up',   weight: 0.9,
      name: 'bVII root → tonic root (Aeolian cadence signature)' },
    { fromPc: vRootPc,    toPc: globalKeyPc, direction: 'down', weight: 0.5,
      name: 'V root → tonic root (delayed via bVII)' },
    // Note: NO leading-tone tendency — that's the evasion. V's 3rd (B)
    // steps UP to bVII's 3rd (D) instead of resolving down/up to C.
    // Document it as a "diagnostic" tendency with weight 0 so it appears
    // in UI but doesn't penalize.
    { fromPc: vThird, toPc: pc(bviiRootPc + 4), direction: 'up', weight: 0.0,
      name: 'V leading-tone EVADED to bVII 3rd (modal stylistic choice)' },
  ];

  return {
    id: `evasion-${vIndex}`,
    sourceChordIndex: vIndex,
    targetChordIndex: tonicIndex,
    role: 'dominant_evasion_to_modal_cadence',
    analysisKeyPc: globalKeyPc,
    targetPc: globalKeyPc,
    tendencies,
    targetStability: {
      minBeats: policy.targetStabilityBeats,
      requireStrongBeat: true,
      weight: 0.7,  // softer than standard home_dominant
    },
    allowPivot: true,  // bVII IS the pivot
    severity: 'soft',
  };
}

/**
 * Detect V → bVII → i/I dominant-evasion cadence pattern starting at index i.
 * Returns the bVII and tonic chord references, or null if pattern doesn't match.
 *
 * Pattern requirements (strict):
 *   - chord[i] is home V (rel=7, dom-quality, effectiveFunc='D', non-borrowed)
 *   - chord[i+1] is GLOBAL bVII (rel=10, modal_interchange borrowedSource)
 *     — NOT bVII/X (local). Local would have analysisKeyPc != globalKeyPc
 *     or roman containing '/'.
 *   - chord[i+2] is home tonic (rel=0)
 */
function detectDominantEvasion(
  chords: ChordDef[],
  i: number,
  globalKeyPc: number,
): { bvii: ChordDef; tonic: ChordDef; tonicIndex: number } | null {
  const v = chords[i];
  const bvii = chords[i + 1];
  const tonic = chords[i + 2];
  if (!v || !bvii || !tonic) return null;
  // V check
  if (v.effectiveFunc !== 'D' || v.borrowedSource) return null;
  if (chordQuality(v.type) !== 'dom') return null;
  if (pc(pc(v.rootMidi) - globalKeyPc) !== 7) return null;
  // bVII check — GLOBAL bVII (analysisKeyPc undefined / equal to globalKeyPc,
  // and roman contains no slash). Rejects local bVII/X.
  if (bvii.borrowedSource !== 'modal_interchange') return null;
  if (bvii.roman.includes('/')) return null;
  if (bvii.analysisKeyPc !== undefined && bvii.analysisKeyPc !== globalKeyPc) return null;
  if (pc(pc(bvii.rootMidi) - globalKeyPc) !== 10) return null;
  // Tonic check — home I or i (rel=0)
  if (pc(pc(tonic.rootMidi) - globalKeyPc) !== 0) return null;
  return { bvii, tonic, tonicIndex: i + 2 };
}

// ─────────────────────────────────────────────────────────────────
// Ledger builder
// ─────────────────────────────────────────────────────────────────

export function buildResolutionLedger(
  chords: ChordDef[],
  policy: HarmonicCoherencePolicy,
  globalKeyPc: number,
): ResolutionObligation[] {
  const obligations: ResolutionObligation[] = [];

  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];
    const next = i + 1 < chords.length ? chords[i + 1] : null;

    // BLUES exception — I7/IV7 are color, no traditional dom obligation
    if (isBluesColorChord(chord, globalKeyPc, policy.style)) {
      continue;
    }

    // Sub-V tritone substitution
    if (chord.roman.startsWith('subV/')) {
      const targetPc = chord.localTonalCenterPc ?? globalKeyPc;
      obligations.push(makeSubVObligation(chord, i, targetPc, next, policy));
      continue;
    }

    // Secondary dominant V/X — has borrowedSource secondary_dominant or secondary_ii_v
    if ((chord.borrowedSource === 'secondary_dominant' || chord.borrowedSource === 'secondary_ii_v')
        && chord.roman.startsWith('V/')) {
      const targetPc = chord.localTonalCenterPc ?? globalKeyPc;
      // Infer target quality from roman target part
      const targetPart = chord.roman.split('/')[1] ?? '';
      const targetQuality: 'major' | 'minor' =
        /[A-Z]/.test(targetPart.replace(/^[b#]/, '')[0] ?? 'i') ? 'major' : 'minor';
      const role: ResolutionRole = chord.borrowedSource === 'secondary_ii_v'
        ? 'secondary_ii_v' : 'secondary_dominant';
      obligations.push(makeDominantObligation(chord, i, targetPc, targetQuality, role, 'hard', next, policy));
      continue;
    }

    // Backdoor cadence (bVII7)
    if (chord.borrowedSource === 'backdoor_dominant') {
      obligations.push(makeBackdoorObligation(chord, i, globalKeyPc, next, policy));
      continue;
    }

    // Home key V (dominant function, non-borrowed)
    if (chord.effectiveFunc === 'D' && !chord.borrowedSource && chordQuality(chord.type) === 'dom') {
      const rel = pc(pc(chord.rootMidi) - globalKeyPc);
      if (rel === 7) {  // V chord (5 semis above key)
        // Dominant-evasion check (point 7.3 — see makeDominantEvasionObligation).
        // V → GLOBAL bVII → i / I is a legitimate modal cadence, NOT a failed
        // V→I resolution. Detect the pattern and emit a soft evasion obligation
        // instead of the standard home_dominant — relaxed tendencies that
        // don't penalize the missing leading-tone → 1 resolution.
        const evasion = detectDominantEvasion(chords, i, globalKeyPc);
        if (evasion) {
          obligations.push(makeDominantEvasionObligation(
            chord, i, evasion.bvii, evasion.tonic, evasion.tonicIndex, globalKeyPc, policy,
          ));
        } else {
          obligations.push(makeDominantObligation(chord, i, globalKeyPc, 'major', 'home_dominant', 'medium', next, policy));
        }
      }
    }
  }

  return obligations;
}

// ─────────────────────────────────────────────────────────────────
// Scorers
// ─────────────────────────────────────────────────────────────────

/**
 * Score 0..1 — does each chord contain its quality-defining intervals?
 * Reuses logic from audit-chord-identity.ts.
 */
export function scoreChordIdentity(chords: ChordDef[]): number {
  if (chords.length === 0) return 1;
  let totalChecks = 0;
  let passedChecks = 0;
  for (const chord of chords) {
    const pcs = chordPcs(chord);
    const rootPc = pc(chord.rootMidi);
    const q = chordQuality(chord.type);
    const t = chord.type;
    const has = (iv: number) => pcs.has(pc(rootPc + iv));
    if (q === 'min' && (t === 'min' || t === 'm7' || t === 'm9' || t === 'm11')) {
      totalChecks++; if (has(3)) passedChecks++;  // b3
    }
    if (q === 'dim' && (t === 'm7b5' || t === 'm9b5')) {
      totalChecks += 3;
      if (has(3)) passedChecks++;
      if (has(6)) passedChecks++;
      if (has(10)) passedChecks++;
    }
    if (q === 'dom') {
      totalChecks += 2;
      if (has(4)) passedChecks++;   // 3
      if (has(10)) passedChecks++;  // b7
    }
    if (q === 'maj' && (t === 'maj7' || t === 'maj9' || t === 'maj13' || t === 'maj7#11' || t === 'maj9#11')) {
      totalChecks += 2;
      if (has(4)) passedChecks++;
      if (has(11)) passedChecks++;
    }
    if (q === 'sus' && (t === '7sus4' || t === '9sus4' || t === '13sus4')) {
      totalChecks += 2;
      if (has(5)) passedChecks++;
      if (has(10)) passedChecks++;
    }
  }
  return totalChecks > 0 ? passedChecks / totalChecks : 1;
}

/**
 * Score 0..1 — guide tone presence per chord.
 * Predominant / dominant / tonic require 3+7 (or appropriate analog).
 */
export function scoreGuideTones(chords: ChordDef[], policy: HarmonicCoherencePolicy): number {
  if (chords.length === 0) return 1;
  let total = 0;
  let sumScore = 0;
  for (const chord of chords) {
    const pcs = chordPcs(chord);
    const rootPc = pc(chord.rootMidi);
    const q = chordQuality(chord.type);
    const has = (iv: number) => pcs.has(pc(rootPc + iv));

    // Skip BLUES color chords from guide-tone scoring (different idiom)
    if (policy.style === 'BLUES') continue;

    let chordScore = -1;

    // Minor predominant (ii, vi, iii)
    if (q === 'min' && (chord.effectiveFunc === 'S' || chord.effectiveFunc === 'T')) {
      chordScore = (has(3) ? 0.5 : 0) + (has(10) ? 0.5 : 0);
    }
    // Dominant function (V, V/X, subV, bVII7 backdoor)
    else if (q === 'dom' && chord.effectiveFunc === 'D') {
      chordScore = (has(4) ? 0.5 : 0) + (has(10) ? 0.5 : 0);
    }
    // Major tonic — wants 3 + (maj7 or 6)
    else if (q === 'maj' && chord.effectiveFunc === 'T') {
      const has3 = has(4) ? 0.5 : 0;
      const has7or6 = (has(11) || has(9)) ? 0.5 : 0;
      chordScore = has3 + has7or6;
    }

    if (chordScore >= 0) {
      total++;
      sumScore += chordScore;
    }
  }
  if (total === 0) return 1;
  const avg = sumScore / total;
  // Apply strictness — penalize gap below 1
  const gap = 1 - avg;
  return clamp01(1 - gap * policy.guideToneStrictness);
}

/**
 * Score 0..1 — per obligation, do tendency tones resolve in next chord?
 */
export function scoreTendencyResolution(
  obligations: ResolutionObligation[],
  chords: ChordDef[],
  policy: HarmonicCoherencePolicy,
): number {
  if (obligations.length === 0) return 1;
  let weightTotal = 0;
  let weightHit = 0;
  for (const o of obligations) {
    const targetIdx = o.targetChordIndex;
    if (targetIdx === null) {
      // Target absent — soft styles tolerate, strict don't
      const allowance = policy.allowDelayedResolution ? 0.3 : 0;
      weightTotal += o.tendencies.reduce((s, t) => s + t.weight, 0);
      weightHit += allowance * o.tendencies.reduce((s, t) => s + t.weight, 0);
      continue;
    }
    const targetPcs = chordPcs(chords[targetIdx]);
    for (const tend of o.tendencies) {
      weightTotal += tend.weight;
      if (targetPcs.has(tend.toPc)) weightHit += tend.weight;
    }
  }
  if (weightTotal === 0) return 1;
  const raw = weightHit / weightTotal;
  // Apply strictness — gap punished harder for strict styles
  const gap = 1 - raw;
  return clamp01(1 - gap * policy.tendencyResolutionStrictness);
}

/**
 * Score 0..1 — target stability. Target chord must hold for minBeats
 * and not be immediately overwritten by another mustResolve chord.
 */
export function scoreTargetStability(
  obligations: ResolutionObligation[],
  chords: ChordDef[],
  policy: HarmonicCoherencePolicy,
): number {
  if (obligations.length === 0) return 1;
  let total = 0;
  let sumScore = 0;
  for (const o of obligations) {
    if (o.targetChordIndex === null) continue;
    total++;
    const target = chords[o.targetChordIndex];
    let s = 0;
    // Roots-match check
    if (o.targetPc !== null && pc(target.rootMidi) === o.targetPc) s += 0.4;
    // Target beats >= minBeats
    if (target.duration >= o.targetStability.minBeats) s += 0.3;
    // Next chord doesn't immediately demand resolution (which would
    // mean target was just a passing stop, not stabilized)
    const next2 = chords[o.targetChordIndex + 1];
    if (!next2 || !next2.mustResolve) s += 0.3;
    else if (target.duration < policy.targetStabilityBeats) s -= 0.2;  // PENALTY: target too short AND next demands resolution
    sumScore += clamp01(s);
  }
  return total > 0 ? sumScore / total : 1;
}

/**
 * Score 0..1 — bass motion supports the resolution.
 *   Sub-V: bass half-step down
 *   V: bass perfect 5th down or 4th up
 *   Backdoor bVII7: whole-step up
 */
export function scoreBassMotion(
  obligations: ResolutionObligation[],
  chords: ChordDef[],
): number {
  if (obligations.length === 0) return 1;
  let total = 0;
  let sumScore = 0;
  for (const o of obligations) {
    if (o.targetChordIndex === null) continue;
    total++;
    const src = chords[o.sourceChordIndex];
    const tgt = chords[o.targetChordIndex];
    const srcBass = pc(src.bassMidi);
    const tgtBass = pc(tgt.bassMidi);
    const motion = pc(tgtBass - srcBass);  // semitones up
    let s = 0.5;
    if (o.role === 'tritone_substitution') {
      // Expected half-step down: motion = 11 (11 semis up = 1 semi down)
      if (motion === 11) s = 1.0;
      else if (motion === 1) s = 0.4;  // chromatic up instead
      else s = 0.3;
    } else if (o.role === 'secondary_dominant' || o.role === 'secondary_ii_v' || o.role === 'home_dominant') {
      // Expected 5th down (motion = 5) or 4th up (motion = 5)
      // 5 semis is both 4th up and... actually 5th down = -7 semis = +5 semis. Same.
      if (motion === 5) s = 1.0;
      else if (motion === 11) s = 0.6;  // half-step substitute
      else s = 0.4;
    } else if (o.role === 'dominant_evasion_to_modal_cadence') {
      // V → bVII → i: src=V, tgt=i (bVII is pivot, not scored here).
      // Bass motion V → i is 5th down (same as home_dominant), bVII is
      // implicit in the chain. Use identical scoring to home_dominant.
      if (motion === 5) s = 1.0;
      else if (motion === 11) s = 0.6;
      else s = 0.4;
    } else if (o.role === 'backdoor_dominant') {
      // bVII7 → I bass: whole step up = +2 semis
      if (motion === 2) s = 1.0;
      else s = 0.4;
    }
    sumScore += s;
  }
  return total > 0 ? sumScore / total : 1;
}

/**
 * Score 0..1 — local borrowed chord roles.
 * Local Color planner emits chords with borrowedFrom like "bII of vi (local ...)".
 * Each should have a clear function:
 *   neighbor_return:    target → color → target          (best)
 *   local_predominant:  color → local V → target         (good)
 *   pivot_to_global:    target → color → subV/I → I      (acceptable, RNB/JAZZ)
 *   decorative_tail:    target → color (end)             (weak, esp. for bII)
 */
export function scoreLocalColorRoles(
  chords: ChordDef[],
  globalKeyPc: number,
  policy: HarmonicCoherencePolicy,
): number {
  const localColorIndices: number[] = [];
  for (let i = 0; i < chords.length; i++) {
    const bf = chords[i].borrowedFrom ?? '';
    if (/^(iv|bII|bVI|bVII|IV) of /.test(bf)) localColorIndices.push(i);
  }
  if (localColorIndices.length === 0) return 1;

  let sumScore = 0;
  for (const i of localColorIndices) {
    const c = chords[i];
    const next = chords[i + 1];
    const next2 = chords[i + 2];
    const localCenterPc = c.analysisKeyPc ?? globalKeyPc;
    const localRomanHead = c.localRoman ?? '';

    let role: 'neighbor_return' | 'local_predominant' | 'pivot_to_global' | 'decorative_tail' = 'decorative_tail';

    // neighbor_return: next chord returns to local target
    if (next && pc(next.rootMidi) === localCenterPc) {
      role = 'neighbor_return';
    }
    // local_predominant: next is local V then target
    else if (next && next.localRoman === 'V' && next2 && pc(next2.rootMidi) === localCenterPc) {
      role = 'local_predominant';
    }
    // pivot_to_global: next is subV/I or V leading back to global I
    else if (next && (next.roman.startsWith('subV/') || (next.roman === 'V' || next.roman === 'V7'))
             && next2 && pc(next2.rootMidi) === globalKeyPc) {
      role = 'pivot_to_global';
    }
    // else decorative_tail (default)

    let s = 0.5;
    if (role === 'neighbor_return') s = 1.0;
    else if (role === 'local_predominant') s = 0.95;
    else if (role === 'pivot_to_global') s = 0.8;
    else if (role === 'decorative_tail') {
      // bII as decorative tail is jarring; iv / bVII more tolerable
      s = localRomanHead === 'bII' ? 0.25 : 0.55;
    }
    sumScore += s;
  }
  // Apply localColorFreedom — generous styles penalize decorative_tail less
  const raw = sumScore / localColorIndices.length;
  return clamp01(raw + policy.localColorFreedom * 0.15);
}

// ─────────────────────────────────────────────────────────────────
// Issue collector
// ─────────────────────────────────────────────────────────────────

export function collectIssues(
  chords: ChordDef[],
  obligations: ResolutionObligation[],
  policy: HarmonicCoherencePolicy,
  globalKeyPc: number,
): CoherenceIssue[] {
  const issues: CoherenceIssue[] = [];

  // Per-chord issues
  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];
    const pcs = chordPcs(chord);
    const rootPc = pc(chord.rootMidi);
    const q = chordQuality(chord.type);
    const has = (iv: number) => pcs.has(pc(rootPc + iv));

    // Missing guide tones on jazz predominant / dominant / tonic
    if (policy.style === 'JAZZ' || policy.guideToneStrictness > 0.7) {
      if (q === 'min' && chord.effectiveFunc === 'S' && !has(10)) {
        issues.push({ chordIndex: i, kind: 'missing_guide_tones', severity: 'mid',
          message: `${chord.chordSymbol}: minor predominant missing b7 (jazz ii needs 3+b7)` });
      }
      if (q === 'dom' && chord.effectiveFunc === 'D' && (!has(4) || !has(10))) {
        issues.push({ chordIndex: i, kind: 'missing_guide_tones', severity: 'high',
          message: `${chord.chordSymbol}: dominant missing 3 or b7` });
      }
    }

    // subV bass weakness
    if (chord.roman.startsWith('subV/') && pc(chord.bassMidi) !== pc(chord.rootMidi)) {
      issues.push({ chordIndex: i, kind: 'weak_subV_bass', severity: 'mid',
        message: `${chord.chordSymbol}: subV with non-root bass weakens half-step bass resolution` });
    }

    // Local bII as decorative tail
    const bf = chord.borrowedFrom ?? '';
    if (/^bII of /.test(bf)) {
      const next = chords[i + 1];
      const next2 = chords[i + 2];
      const localCenterPc = chord.analysisKeyPc ?? globalKeyPc;
      const isNeighborReturn = next && pc(next.rootMidi) === localCenterPc;
      const isLocalPredominant = next && next.localRoman === 'V' && next2 && pc(next2.rootMidi) === localCenterPc;
      const isPivotToGlobal = next && (next.roman.startsWith('subV/') || next.roman === 'V')
                              && next2 && pc(next2.rootMidi) === globalKeyPc;
      if (!isNeighborReturn && !isLocalPredominant && !isPivotToGlobal) {
        issues.push({ chordIndex: i, kind: 'local_bII_decorative_tail', severity: 'mid',
          message: `${chord.chordSymbol} (local bII): no clear role — not neighbor / pivot / predominant` });
      }
    }
  }

  // Last chord unresolved
  if (chords.length > 0) {
    const last = chords[chords.length - 1];
    if (last.mustResolve) {
      issues.push({ chordIndex: chords.length - 1, kind: 'unresolved_final_dominant', severity: 'high',
        message: `Song ends on ${last.chordSymbol} (mustResolve=true) without target` });
    }
  }

  // Obligation-level: target stability
  for (const o of obligations) {
    if (o.targetChordIndex !== null) {
      const target = chords[o.targetChordIndex];
      const next2 = chords[o.targetChordIndex + 1];
      if (target.duration < policy.targetStabilityBeats && next2?.mustResolve) {
        issues.push({ chordIndex: o.targetChordIndex, kind: 'target_not_stable', severity: 'mid',
          message: `Target ${target.chordSymbol} only ${target.duration} beats before another resolution demand` });
      }
    }
  }

  // Unresolved hard obligations (target absent)
  for (const o of obligations) {
    if (o.severity === 'hard' && o.targetChordIndex === null && !policy.allowDelayedResolution) {
      issues.push({ chordIndex: o.sourceChordIndex, kind: 'unresolved_hard_obligation', severity: 'high',
        message: `${chords[o.sourceChordIndex].chordSymbol} (${o.role}) didn't resolve to expected target pc=${o.targetPc}` });
    }
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────
// Top-level evaluator
// ─────────────────────────────────────────────────────────────────

export function evaluateHarmony(
  chords: ChordDef[],
  styleName: string,
  globalKeyPc: number,
): CoherenceReport {
  const policy = COHERENCE_POLICIES[styleName] ?? COHERENCE_POLICIES.POP;
  const obligations = buildResolutionLedger(chords, policy, globalKeyPc);

  const subscores = {
    identity: scoreChordIdentity(chords),
    guideTone: scoreGuideTones(chords, policy),
    tendency: scoreTendencyResolution(obligations, chords, policy),
    targetStability: scoreTargetStability(obligations, chords, policy),
    bass: scoreBassMotion(obligations, chords),
    localColor: scoreLocalColorRoles(chords, globalKeyPc, policy),
  };

  // Weighted composite. Identity is gate (any chord with broken identity
  // cascades badly), so it weights highest. Guide-tone & tendency are
  // next. Local color is lightest.
  const score =
    0.20 * subscores.identity +
    0.20 * subscores.guideTone +
    0.20 * subscores.tendency +
    0.15 * subscores.targetStability +
    0.15 * subscores.bass +
    0.10 * subscores.localColor;

  const issues = collectIssues(chords, obligations, policy, globalKeyPc);

  return {
    score: clamp01(score),
    passed: score >= policy.passThreshold,
    policy,
    subscores,
    obligations,
    issues,
  };
}
