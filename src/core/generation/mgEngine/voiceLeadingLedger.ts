// ==========================================
// voiceLeadingLedger.ts — Real cross-voice voice-leading checker.
//
// Companion to harmonicCoherence.ts. The harmonic checker scores
// CHORD-LEVEL resolution ("does target chord contain the target pc"),
// but does not verify that an INDIVIDUAL voice actually moved from
// the tension tone to the target tone within a small interval. Two
// chords can pass the chord-level check while no real voice ever
// connects the dots — the listener hears "the chord changed" rather
// than "the dominant resolved."
//
// This module adds a parallel ledger keyed to actual voicing midi:
//
//   VoiceLeadingObligation =
//     "Voice X at midi M in chord I should land within `maxMotion`
//      semitones, ON one of these pcs, by chord `deadlineChordIndex`."
//
// Scoring finds the nearest voice in the target chord's voicing and
// checks both pc membership AND interval-distance simultaneously. A
// dominant 7 → tonic 3 that happens via "the 3rd just exists in the
// next chord but no voice was within 5 semis of it" scores low.
//
// Sources:
//   - Aldwell-Schachter Harmony & Voice Leading (3rd ed.) — single-
//     voice resolution rules for tendency tones.
//   - Schoenberg Structural Functions — borrowed tones must "settle"
//     on a chord tone via stepwise motion.
//   - Caplin Classical Form — V-I cadence requires audible 7→1 in
//     the leading voice, not just pc presence.
// ==========================================

import { ChordDef } from './musicEngine';

const pc = (m: number): number => ((m % 12) + 12) % 12;

export type VoiceLeadingRole =
  | 'dom3'             // dominant chord 3rd (leading tone of the dom's local key)
  | 'dom7'             // dominant chord b7
  | 'maj7'             // major 7th (tonic chord — wants to fall to 6 or rise to 1)
  | 'borrowedColor'    // pitch from a borrowed chord (modal interchange) — wants stepwise return
  | 'bassLeading';     // bass voice of a dom/secondary — wants 5th down or chromatic step

export interface VoiceLeadingObligation {
  id: string;
  sourceChordIndex: number;
  /** Actual midi pitch of the voice carrying the obligation. */
  sourceVoiceMidi: number;
  sourceRole: VoiceLeadingRole;
  /** Acceptable target pcs (absolute, 0..11) — the voice's pc after motion. */
  expectedTargetPcs: number[];
  /** Cap on |target midi - source midi|. Tendency tones typically <= 2 (step),
   *  bass leading <= 7 (5th down). */
  maxMotion: number;
  /** The chord index by which the resolution must have happened. Usually source+1. */
  deadlineChordIndex: number;
  /** Severity for scoring — hard obligations weigh more in the composite. */
  severity: 'hard' | 'medium' | 'soft';
}

export interface VoiceLeadingResolution {
  obligation: VoiceLeadingObligation;
  /** What actually happened. */
  actualTargetMidi: number | null;
  actualMotion: number | null;
  pcHit: boolean;
  motionOk: boolean;
  /** 0..1 per-obligation score. */
  score: number;
}

export interface VoiceLeadingReport {
  obligations: VoiceLeadingObligation[];
  resolutions: VoiceLeadingResolution[];
  /** 0..1 — weighted by severity. */
  overallScore: number;
  /** Diagnostic counts. */
  stats: {
    total: number;
    fullyResolved: number;     // pcHit && motionOk
    pcOnlyHit: number;         // pcHit && !motionOk (chord has the pc, but no voice actually moved to it)
    pcMissing: number;         // !pcHit
  };
}

// ─────────────────────────────────────────────────────────────────────
// Chord-quality detection (kept local to avoid coupling)
// ─────────────────────────────────────────────────────────────────────

function isDominantChord(type: string): boolean {
  // dom flavors: '7', '9', '11', '13', '7b9', '7#9', '7b13', '7alt', '7sus4', '9sus4', '13sus4', etc.
  // EXCLUDED: 'maj7', 'maj9', 'maj13', 'm7', 'm9', 'm11', 'm13', 'mMaj7', 'm7b5', 'dim7', 'add9', '6', '6/9'
  if (type.includes('maj')) return false;
  if (type.startsWith('m')) return false;
  if (type.includes('b5')) return false;
  if (type.startsWith('dim') || type.startsWith('aug')) return false;
  if (type === '6' || type === '6/9' || type === 'add9') return false;
  // 'sus' alone (no number) is not dominant
  if (type === 'sus' || type === 'sus2' || type === 'sus4') return false;
  // Otherwise treat any pure-number / number+alteration / sus+number type as dominant
  return /^(\d|sus\d|alt)/.test(type) || /\d/.test(type);
}

function isMajor7Chord(type: string): boolean {
  return /maj(7|9|11|13)/.test(type);
}

// ─────────────────────────────────────────────────────────────────────
// Build obligations
// ─────────────────────────────────────────────────────────────────────

/**
 * Find the actual midi voice in a chord's notesMidi+bassMidi whose pc
 * equals `targetPc`. Returns the highest matching voice (favors the
 * RH-side where tendency tones typically live) or null if none.
 */
function findVoiceWithPc(chord: ChordDef, targetPc: number): number | null {
  const candidates: number[] = [...chord.notesMidi];
  if (typeof chord.bassMidi === 'number') candidates.push(chord.bassMidi);
  const matches = candidates.filter(m => pc(m) === targetPc);
  if (matches.length === 0) return null;
  return Math.max(...matches);
}

/**
 * Build all VL obligations for a chord progression. Walks chord-by-
 * chord, emits obligations for dominant 3 / dominant 7 / borrowed
 * color voices. Each obligation references the actual midi of the
 * source voice — scoring later verifies a voice in the target chord
 * actually lands within `maxMotion` of that midi.
 */
export function buildVoiceLeadingLedger(chords: ChordDef[]): VoiceLeadingObligation[] {
  const out: VoiceLeadingObligation[] = [];
  let idCounter = 0;

  for (let i = 0; i < chords.length - 1; i++) {
    const src = chords[i];
    const tgt = chords[i + 1];
    const srcRootPc = pc(src.rootMidi);
    const tgtRootPc = pc(tgt.rootMidi);

    // ── Dominant chord ─────────────────────────────────
    if (isDominantChord(src.type)) {
      // dom3 (the chord's major-3rd — leading tone of the dom's local tonic)
      const dom3Pc = pc(srcRootPc + 4);
      const dom3Midi = findVoiceWithPc(src, dom3Pc);
      if (dom3Midi !== null) {
        // Leading tone resolves up half-step to its tonic.
        // Local tonic = (chord root + 5) pc for a normal V→I motion
        // ((dom3+1) pc). Accept the target chord's actual root pc as
        // expected — that's the audible test of resolution.
        const expectedPc = pc(dom3Midi + 1);
        out.push({
          id: `vl_${idCounter++}_dom3_${i}`,
          sourceChordIndex: i,
          sourceVoiceMidi: dom3Midi,
          sourceRole: 'dom3',
          expectedTargetPcs: [expectedPc, tgtRootPc],  // strict (+1) OR target root (deceptive ok)
          maxMotion: 2,
          deadlineChordIndex: i + 1,
          severity: 'hard',
        });
      }

      // dom7 (the chord's flat-7 — wants to fall half-step to target's 3rd)
      const dom7Pc = pc(srcRootPc + 10);
      const dom7Midi = findVoiceWithPc(src, dom7Pc);
      if (dom7Midi !== null) {
        // Most idiomatic: down half-step (= target's major or minor 3rd)
        const expectedPcDown = pc(dom7Midi - 1);
        // Tritone-sub idiom also lets it move up half-step
        const expectedPcUp = pc(dom7Midi + 1);
        out.push({
          id: `vl_${idCounter++}_dom7_${i}`,
          sourceChordIndex: i,
          sourceVoiceMidi: dom7Midi,
          sourceRole: 'dom7',
          expectedTargetPcs: [expectedPcDown, expectedPcUp],
          maxMotion: 2,
          deadlineChordIndex: i + 1,
          severity: 'hard',
        });
      }

      // bass leading (5th-down resolution = audible cadence base)
      const srcBass = src.bassMidi;
      if (typeof srcBass === 'number') {
        // Expected target bass pc = srcRoot - 5 (5th down) for V→I
        // OR tgtRoot for deceptive / weak-step resolutions
        out.push({
          id: `vl_${idCounter++}_bassLead_${i}`,
          sourceChordIndex: i,
          sourceVoiceMidi: srcBass,
          sourceRole: 'bassLeading',
          expectedTargetPcs: [pc(srcBass - 5), pc(srcBass - 7), tgtRootPc],
          maxMotion: 7,   // 5th = 7 semis (down). Permit register flexibility.
          deadlineChordIndex: i + 1,
          severity: 'medium',
        });
      }
    }

    // ── Major 7 chord ──────────────────────────────────
    // maj7 wants its 7th to drift to 6 (Imaj7 → vi-ish) or rise to 1
    // when chord changes; static hold is fine when staying on the
    // same chord. Soft severity because Lydian / Ionian color often
    // hangs the maj7 deliberately.
    if (isMajor7Chord(src.type) && srcRootPc !== tgtRootPc) {
      const maj7Pc = pc(srcRootPc + 11);
      const maj7Midi = findVoiceWithPc(src, maj7Pc);
      if (maj7Midi !== null) {
        out.push({
          id: `vl_${idCounter++}_maj7_${i}`,
          sourceChordIndex: i,
          sourceVoiceMidi: maj7Midi,
          sourceRole: 'maj7',
          expectedTargetPcs: [pc(maj7Midi - 1), pc(maj7Midi - 2), pc(maj7Midi + 1)],
          maxMotion: 2,
          deadlineChordIndex: i + 1,
          severity: 'soft',
        });
      }
    }

    // ── Borrowed color ─────────────────────────────────
    // chord.borrowedFrom describes the parallel mode source. The borrowed
    // pcs are the chord's non-diatonic notes. For each non-diatonic voice
    // in src, expect stepwise return to a tgt voice within 2 semis.
    if (src.borrowedFrom && src.borrowedFrom !== '') {
      // Coarse approximation: any non-tonic-triad pc in source is candidate
      // for a borrowed-color obligation. (More precise would consult the
      // home-key scale.) Picks up bII roots, b6 colors, etc.
      const chordTriadPcs = new Set([srcRootPc, pc(srcRootPc + 3), pc(srcRootPc + 4), pc(srcRootPc + 7)]);
      for (const m of src.notesMidi) {
        if (!chordTriadPcs.has(pc(m))) {
          out.push({
            id: `vl_${idCounter++}_borrow_${i}_${m}`,
            sourceChordIndex: i,
            sourceVoiceMidi: m,
            sourceRole: 'borrowedColor',
            expectedTargetPcs: [pc(m - 1), pc(m - 2), pc(m + 1), pc(m + 2)],
            maxMotion: 2,
            deadlineChordIndex: i + 1,
            severity: 'soft',
          });
        }
      }
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Score against actual voicings
// ─────────────────────────────────────────────────────────────────────

/**
 * For each obligation, find the closest voice in chord[deadline]'s
 * notesMidi+bassMidi to obligation.sourceVoiceMidi. Verify:
 *  (a) closest voice's pc is in expectedTargetPcs (the right note)
 *  (b) |closest - source| ≤ maxMotion (no audible voice leap)
 *
 * Per-obligation score:
 *   1.0 — both (a) and (b)        full resolution
 *   0.5 — (a) only                 right pc but no smooth voice (jumped)
 *   0.2 — (b) only                 smooth voice but landed elsewhere
 *   0.0 — neither                  obligation unresolved
 */
export function scoreVoiceLeading(
  obligations: VoiceLeadingObligation[],
  chords: ChordDef[],
): VoiceLeadingReport {
  const resolutions: VoiceLeadingResolution[] = [];
  const severityWeight: Record<VoiceLeadingObligation['severity'], number> = { hard: 1.0, medium: 0.6, soft: 0.3 };
  let weightTotal = 0;
  let weightedScore = 0;
  const stats = { total: 0, fullyResolved: 0, pcOnlyHit: 0, pcMissing: 0 };

  for (const o of obligations) {
    const tgt = chords[o.deadlineChordIndex];
    if (!tgt) continue;
    stats.total++;

    const tgtVoices = [...tgt.notesMidi];
    if (typeof tgt.bassMidi === 'number') tgtVoices.push(tgt.bassMidi);
    if (tgtVoices.length === 0) {
      resolutions.push({ obligation: o, actualTargetMidi: null, actualMotion: null, pcHit: false, motionOk: false, score: 0 });
      stats.pcMissing++;
      continue;
    }

    // Find nearest voice to source midi
    let nearest = tgtVoices[0];
    let nearestDist = Math.abs(tgtVoices[0] - o.sourceVoiceMidi);
    for (const v of tgtVoices) {
      const d = Math.abs(v - o.sourceVoiceMidi);
      if (d < nearestDist) { nearest = v; nearestDist = d; }
    }

    const pcHit = o.expectedTargetPcs.includes(pc(nearest));
    const motionOk = nearestDist <= o.maxMotion;

    let perScore = 0;
    if (pcHit && motionOk) { perScore = 1.0; stats.fullyResolved++; }
    else if (pcHit) { perScore = 0.5; stats.pcOnlyHit++; }
    else if (motionOk) { perScore = 0.2; stats.pcMissing++; }
    else { perScore = 0.0; stats.pcMissing++; }

    const w = severityWeight[o.severity];
    weightTotal += w;
    weightedScore += w * perScore;

    resolutions.push({
      obligation: o,
      actualTargetMidi: nearest,
      actualMotion: nearestDist,
      pcHit,
      motionOk,
      score: perScore,
    });
  }

  return {
    obligations,
    resolutions,
    overallScore: weightTotal > 0 ? weightedScore / weightTotal : 1,
    stats,
  };
}

/**
 * Convenience: build + score in one call.
 */
export function evaluateVoiceLeading(chords: ChordDef[]): VoiceLeadingReport {
  const obligations = buildVoiceLeadingLedger(chords);
  return scoreVoiceLeading(obligations, chords);
}
