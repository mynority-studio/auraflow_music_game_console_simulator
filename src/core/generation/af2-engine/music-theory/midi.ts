// ============================================================
// midi.ts — Note ↔ MIDI conversion + pitch range constants
// ============================================================
//
// Phase 6.1 拆分自 mg-engine/musicTheory.ts(原 L33-117)。
//
// noteToMidi parses note strings as letter + accidental + octave so
// every enharmonic spelling round-trips correctly:
//
//   C#4 / Db4    → 61    F##3 / G3    → 55
//   B#3 → 60  (B-letter octave 3 + 1 = same pitch as C4)
//   Cb4 → 59  (C-letter octave 4 - 1 = same pitch as B3)
//   Bbb3 → 57 (B-letter octave 3 - 2 = same pitch as A3)
//
// The octave digit is anchored to the natural letter, not the spelled
// pitch class — B#3 is "B in octave 3 raised one semitone", which
// crosses the C boundary into C4 pitch.
//
// Source-of-truth roundtrip rule: every chord-voicing MIDI value must
// satisfy noteToMidi(midiToNoteInChord(m, ...)) === m.
// ============================================================

const _LETTER_NATURAL_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

export function noteToMidi(note: string): number {
  if (!note) return 60;
  const m = note.match(/^([A-G])(##|#|bb|b)?(-?\d+)?$/);
  if (!m) return 60;
  const letter = m[1];
  const acc = m[2] ?? '';
  const octave = m[3] !== undefined ? parseInt(m[3], 10) : 4;
  const natural = _LETTER_NATURAL_PC[letter];
  if (natural === undefined) return 60;
  let adj = 0;
  if (acc === '#') adj = 1;
  else if (acc === '##') adj = 2;
  else if (acc === 'b') adj = -1;
  else if (acc === 'bb') adj = -2;
  return (octave + 1) * 12 + natural + adj;
}

export function midiToNote(midi: number): string {
  const names = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const pitchClass = names[(midi % 12 + 12) % 12];
  return `${pitchClass}${octave}`;
}

// ============================================================
// Pitch ranges by role(原 L99-117)
//
// Anchored to typical piano / vocal-led genre practice:
//
//   Bass    A1 (33) — G3 (55)   — piano LH / bass guitar core zone.
//                                 Below A1 sounds sub-musical and
//                                 conflicts with melody/comping registers.
//   Chord   C3 (48) — A5 (81)   — comping voicing window. Sits above
//                                 the bass anchor and below melody lead.
//                                 Octave-drop fallbacks must not push
//                                 chord events below this floor.
//   Melody  C4 (60) — D6 (86)   — vocal-lead / instrumental lead range.
//                                 C4 = middle C; D6 = trained soprano
//                                 upper limit (was F6 prior — too shrill).
//
// MELODY_RANGE bottom = C4. Below is the bass/comping register; letting
// melody drop into the G3-B3 overlap zone puts the listener's "main voice"
// in the same octave as bass, blurring divisi role split.
// ============================================================

export const MELODY_RANGE = {
  LOW: 60,   // C4 (middle C)
  HIGH: 86,  // D6 — soprano upper limit
};

export const BASS_RANGE = {
  LOW: 33,
  HIGH: 55,
};

export const CHORD_RANGE = {
  LOW: 48,
  HIGH: 81,
};
