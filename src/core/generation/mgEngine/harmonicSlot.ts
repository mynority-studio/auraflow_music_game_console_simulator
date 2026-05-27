// HarmonicSlot — read-only fact source bundling per-chord facts.
//
// One HarmonicSlot per ChordDef in the realized progression. Bundles:
//   - chord                : the ChordDef itself (full reference for callers
//                            that still need raw fields)
//   - startBeat / duration : absolute beat position + length
//   - symbolContract       : MelodyChordContract built from chord symbol
//                            (theoretical contract: chordTones / stableColors
//                            / conditionalColors / avoidTones)
//   - soundingPcs / soundingMidis : actual rendered voicing (bass + upper)
//   - globalFunc           : function in the song-level frame —
//                            T / S / D / D_CHAIN (D with D neighbor) /
//                            MODAL (style=BLUES or non-functional context)
//   - localTonalCenterPc   : forwarded from chord; pc of the borrowed
//                            local key for V/X / subV/X
//   - slotKind             : semantic classification consumed by lick
//                            picker / texture selector / tension ownership
//
// Downstream callers (lick projection, audit, contracts, future POP/RNB/
// BLUES/JAZZ phrase generators) read this instead of parsing chord fields
// independently — single source of truth for derived facts.
//
// Adapter only. Does NOT change generation, voicing, bass, or any audible
// behavior. ChordDef remains the authoritative storage; HarmonicSlot is a
// derived view rebuilt per arrangement.

import type { ChordDef } from './musicEngine';
import { buildMelodyChordContract, MelodyChordContract } from './melodyChordContract';

export type GlobalFunc = 'T' | 'S' | 'D' | 'D_CHAIN' | 'MODAL';

export type SlotKind =
  | 'tonic'              // I / i / vi / Im / im — conventional tonic
  | 'predominant'        // ii / IV / iv — S-function
  | 'dominant'           // V — D-function
  | 'secondary_dominant' // V/X / subV/X — roman contains '/'
  | 'modal_vamp'         // III / VI / VII / bIII / bVI / bVII — modal tonic
  | 'blues_area';        // any chord in a BLUES song — modal, non-TSD

export interface HarmonicSlot {
  readonly chord: ChordDef;
  readonly startBeat: number;
  readonly duration: number;
  readonly symbolContract: MelodyChordContract;
  readonly soundingPcs: ReadonlySet<number>;
  readonly soundingMidis: ReadonlyArray<number>;
  readonly globalFunc: GlobalFunc;
  readonly localTonalCenterPc?: number;
  readonly slotKind: SlotKind;
}

export interface BuildContext {
  style: 'POP' | 'RNB' | 'JAZZ' | 'BLUES' | 'LOFI';
  mode?: string;
}

// SlotKind classification — pure function of chord + style. BLUES is
// modal-only per user direction (don't apply TSD to blues), so every
// blues chord is 'blues_area' regardless of roman.
function classifySlotKind(chord: ChordDef, style: BuildContext['style']): SlotKind {
  if (style === 'BLUES') return 'blues_area';
  if (chord.roman.includes('/')) return 'secondary_dominant';
  const f = chord.effectiveFunc ?? 'T';
  if (f === 'D') return 'dominant';
  if (f === 'S') return 'predominant';
  // T-function: distinguish standard tonic from modal vamp tonic.
  // I / i / Im / im / vi = conventional tonic (relative minor vi included).
  const r = chord.roman;
  if (/^[Ii]m?$|^vi$/.test(r)) return 'tonic';
  // Major-quality flat-degree tonics (bIII / bVI / bVII) or major III/VI/VII
  // in modal contexts (Aeolian VI, Phrygian bII, Mixolydian bVII etc.).
  if (/^b?(II|III|IV|V|VI|VII)$/.test(r)) return 'modal_vamp';
  return 'tonic';
}

// globalFunc upgrades the raw effectiveFunc with two contextual states:
//   - MODAL when style is BLUES (per user direction)
//   - D_CHAIN when current D-chord has at least one D-function neighbor
//     (catches ii/V → V/V → V cascades that listener perceives as one
//     continuous push, not three independent dominant cells)
function classifyGlobalFunc(
  chords: ChordDef[],
  idx: number,
  style: BuildContext['style'],
): GlobalFunc {
  if (style === 'BLUES') return 'MODAL';
  const f = chords[idx].effectiveFunc ?? 'T';
  if (f !== 'D') return f;
  const prevIsD = chords[idx - 1]?.effectiveFunc === 'D';
  const nextIsD = chords[idx + 1]?.effectiveFunc === 'D';
  return (prevIsD || nextIsD) ? 'D_CHAIN' : 'D';
}

export function buildHarmonicSlots(
  chords: ChordDef[],
  ctx: BuildContext,
): HarmonicSlot[] {
  const slots: HarmonicSlot[] = [];
  let cursor = 0;
  for (let i = 0; i < chords.length; i++) {
    const c = chords[i];
    const symbolContract = buildMelodyChordContract(c, ctx);
    // Sounding pitches = bass MIDI + upper voicing MIDIs. Bass IS part
    // of what the listener hears, so it must be in soundingPcs even
    // when the rootless voicing omits the root.
    const soundingMidis: number[] = [c.bassMidi, ...c.notesMidi];
    const soundingPcs = new Set<number>(
      soundingMidis.map(m => ((m % 12) + 12) % 12),
    );
    slots.push({
      chord: c,
      startBeat: cursor,
      duration: c.duration,
      symbolContract,
      soundingPcs,
      soundingMidis,
      globalFunc: classifyGlobalFunc(chords, i, ctx.style),
      localTonalCenterPc: c.localTonalCenterPc,
      slotKind: classifySlotKind(c, ctx.style),
    });
    cursor += c.duration;
  }
  return slots;
}

// Convenience: find the slot active at a given absolute beat. Returns the
// slot whose [startBeat, startBeat + duration) covers t. Returns null if
// t is past the song end.
export function findSlotAtBeat(slots: HarmonicSlot[], t: number): HarmonicSlot | null {
  for (const s of slots) {
    if (t >= s.startBeat && t < s.startBeat + s.duration) return s;
  }
  return null;
}
