// Texture metadata — per-texture annotation that drives metadata-aware
// selection in PerformanceStyleContract. The applyTexture switch itself
// stays unchanged; only the SELECTION layer above it now reads metadata
// instead of choosing randomly.
//
// Five fields per texture:
//   rhythmFeel        — straight_8 / straight_16 / swing_8 / triplet_12_8 / dilla
//   compFamily        — shell_comp / sparse_stab / wide_pad / arp / stride / boogie
//   supportsDenseLick — true when the texture can host a busy 8+ attacks/bar
//                       lick without crowding (sparse comping / pad / answer pattern)
//   supportsTripletLick — true for shuffle / 12/8 / triplet textures where
//                       triplet-figure lick notes feel natural
//   defaultCompingMode  — preferred CompingMode when no lick density signal
//                       is available (full / shell / answer / bass_plus_shell)

import type { CompingMode } from './rhythmContract';

export type RhythmFeel =
  | 'straight_8'
  | 'straight_16'
  | 'swing_8'
  | 'triplet_12_8'
  | 'dilla';

export type CompFamily =
  | 'shell_comp'   // Bill-Evans-style block voicings on strong beats (jazz comping)
  | 'sparse_stab'  // 1-3 stabs per bar (blues stabs, Charleston, anthem pulse)
  | 'wide_pad'     // sustained pad / wash (ambient, reverse swell)
  | 'arp'          // arpeggio / broken-chord / alberti (8th/16th flow)
  | 'stride'       // bass + chord alternation (stride piano, pulse patterns)
  | 'boogie';      // walking / shuffle bass line (blues, boogie, walking bass)

export interface TextureMeta {
  rhythmFeel: RhythmFeel;
  compFamily: CompFamily;
  supportsDenseLick: boolean;
  supportsTripletLick: boolean;
  defaultCompingMode: CompingMode;
}

// Defaults if a name slips through unannotated — keeps `selectTexture`
// callable on unknown names instead of throwing. Treats unknowns as
// dense full_voicing (worst case for clash, but at least picks SOMETHING).
const FALLBACK: TextureMeta = {
  rhythmFeel: 'straight_8',
  compFamily: 'shell_comp',
  supportsDenseLick: false,
  supportsTripletLick: false,
  defaultCompingMode: 'full_voicing',
};

// Per-texture metadata. Classifications derived from each texture's
// rhythmic / harmonic shape inside the engine's applyTexture switch.
export const TEXTURE_META: Record<string, TextureMeta> = {
  // ── Bass-only patterns ──
  Single_Root:         { rhythmFeel: 'straight_8',   compFamily: 'stride',  supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'bass_plus_shell' },
  Root_Octave:         { rhythmFeel: 'straight_8',   compFamily: 'stride',  supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'bass_plus_shell' },
  Root_5_8:            { rhythmFeel: 'straight_8',   compFamily: 'stride',  supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'bass_plus_shell' },
  Root_7_5_8:          { rhythmFeel: 'swing_8',      compFamily: 'boogie',  supportsDenseLick: false, supportsTripletLick: true,  defaultCompingMode: 'shell_only' },
  Root_5_7_5:          { rhythmFeel: 'swing_8',      compFamily: 'boogie',  supportsDenseLick: false, supportsTripletLick: true,  defaultCompingMode: 'shell_only' },
  Root_Fifth_Bass:     { rhythmFeel: 'straight_8',   compFamily: 'stride',  supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'bass_plus_shell' },
  Root_Octave_Pulse:   { rhythmFeel: 'straight_8',   compFamily: 'stride',  supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'bass_plus_shell' },
  Slap_Bass_Line:      { rhythmFeel: 'straight_16',  compFamily: 'boogie',  supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'shell_only' },
  Jazz_Walking_Bass:   { rhythmFeel: 'swing_8',      compFamily: 'boogie',  supportsDenseLick: true,  supportsTripletLick: true,  defaultCompingMode: 'shell_only' },
  Blues_Shuffle_Bass:  { rhythmFeel: 'swing_8',      compFamily: 'boogie',  supportsDenseLick: false, supportsTripletLick: true,  defaultCompingMode: 'shell_only' },

  // ── Stab / sparse-comp patterns ──
  Stabs:                { rhythmFeel: 'straight_8',  compFamily: 'sparse_stab', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'answer_only' },
  Syncopated_Stabs:     { rhythmFeel: 'straight_8',  compFamily: 'sparse_stab', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'answer_only' },
  Blues_Stabs:          { rhythmFeel: 'swing_8',     compFamily: 'sparse_stab', supportsDenseLick: true,  supportsTripletLick: true,  defaultCompingMode: 'answer_only' },
  Block_Chord_Staccato: { rhythmFeel: 'straight_8',  compFamily: 'sparse_stab', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'shell_only' },
  Jazz_Charleston_Comp: { rhythmFeel: 'swing_8',     compFamily: 'sparse_stab', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'shell_only' },
  RnB_16th_Funk_Stabs:  { rhythmFeel: 'straight_16', compFamily: 'sparse_stab', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'answer_only' },
  Pop_Anthem_Pulse:     { rhythmFeel: 'straight_8',  compFamily: 'sparse_stab', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'shell_only' },
  Pop_Ostinato_Rock:    { rhythmFeel: 'straight_8',  compFamily: 'sparse_stab', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'answer_only' },
  HalfTime_Emotional_Pulse: { rhythmFeel: 'straight_8',  compFamily: 'sparse_stab', supportsDenseLick: true, supportsTripletLick: false, defaultCompingMode: 'shell_only' },
  Piano_HalfTime_Soft_Pulse: { rhythmFeel: 'straight_8', compFamily: 'sparse_stab', supportsDenseLick: true, supportsTripletLick: false, defaultCompingMode: 'shell_only' },

  // ── Shell-comp patterns (Bill Evans-style, drop-2, block) ──
  Block_Chord:          { rhythmFeel: 'straight_8',  compFamily: 'shell_comp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Jazz_Comping:         { rhythmFeel: 'swing_8',     compFamily: 'shell_comp', supportsDenseLick: true,  supportsTripletLick: true,  defaultCompingMode: 'shell_only' },
  Jazz_Drop_2_Comp:     { rhythmFeel: 'swing_8',     compFamily: 'shell_comp', supportsDenseLick: true,  supportsTripletLick: true,  defaultCompingMode: 'shell_only' },
  Jazz_Red_Garland_Block: { rhythmFeel: 'swing_8',   compFamily: 'shell_comp', supportsDenseLick: false, supportsTripletLick: true,  defaultCompingMode: 'full_voicing' },
  Bossa_Clave_Comping:  { rhythmFeel: 'straight_8',  compFamily: 'shell_comp', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'shell_only' },
  Call_And_Response:    { rhythmFeel: 'straight_8',  compFamily: 'shell_comp', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'answer_only' },
  Piano_Question_Answer: { rhythmFeel: 'straight_8', compFamily: 'shell_comp', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'answer_only' },

  // ── Arpeggio patterns ──
  Broken_Chord:         { rhythmFeel: 'straight_8',  compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Arpeggio_Flow:        { rhythmFeel: 'straight_8',  compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Arp_Seq:              { rhythmFeel: 'straight_16', compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Ostinato_16s:         { rhythmFeel: 'straight_16', compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Pop_Piano_Arp_16ths:  { rhythmFeel: 'straight_16', compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Pop_Broken_8ths_Sync: { rhythmFeel: 'straight_8',  compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Pop_Half_Arp_Sweep:   { rhythmFeel: 'straight_16', compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Pop_Wave_16ths:       { rhythmFeel: 'straight_16', compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Pop_Alberti_Lyrical:  { rhythmFeel: 'straight_8',  compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Pop_Ballad_158_Sweep: { rhythmFeel: 'straight_8',  compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Bossa_Piano_Arp:      { rhythmFeel: 'straight_8',  compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  RnB_Classic_Soul_Arp: { rhythmFeel: 'straight_16', compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Soft_Guitar_Pluck_8ths: { rhythmFeel: 'straight_8', compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Lyrical_10th_Broken:  { rhythmFeel: 'straight_8',  compFamily: 'arp', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'shell_only' },
  Piano_Emo_Broken_10th: { rhythmFeel: 'straight_8', compFamily: 'arp', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'shell_only' },

  // ── Dilla / RnB neo-soul / lo-fi ──
  RnB_Neo_Soul_Roll:    { rhythmFeel: 'dilla',       compFamily: 'shell_comp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  RnB_Laid_Back_Groove: { rhythmFeel: 'dilla',       compFamily: 'shell_comp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Piano_Lofi_Dusty_Chops: { rhythmFeel: 'dilla',     compFamily: 'shell_comp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Piano_Lofi_Late_Chord_Answer: { rhythmFeel: 'dilla', compFamily: 'sparse_stab', supportsDenseLick: true, supportsTripletLick: false, defaultCompingMode: 'answer_only' },
  Piano_Lofi_OneShot_Space: { rhythmFeel: 'dilla',   compFamily: 'sparse_stab', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'shell_only' },
  Piano_Lofi_Tape_Wobble_Arp: { rhythmFeel: 'dilla', compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },

  // ── Triplet / 12/8 / triplet-feel ──
  RnB_Gospel_Triplets:   { rhythmFeel: 'triplet_12_8', compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: true, defaultCompingMode: 'full_voicing' },
  Jazz_Waltz_Hemiola:    { rhythmFeel: 'triplet_12_8', compFamily: 'shell_comp', supportsDenseLick: true,  supportsTripletLick: true, defaultCompingMode: 'shell_only' },
  Blues_Slow_12_8_Arp:   { rhythmFeel: 'triplet_12_8', compFamily: 'arp', supportsDenseLick: false, supportsTripletLick: true, defaultCompingMode: 'full_voicing' },

  // ── Blues-family ──
  Blues_Boogie_Woogie:   { rhythmFeel: 'swing_8',     compFamily: 'boogie', supportsDenseLick: false, supportsTripletLick: true, defaultCompingMode: 'shell_only' },
  Blues_Chicago_Shuffle: { rhythmFeel: 'swing_8',     compFamily: 'boogie', supportsDenseLick: true,  supportsTripletLick: true, defaultCompingMode: 'shell_only' },
  Blues_Tremolo_Comp:    { rhythmFeel: 'swing_8',     compFamily: 'shell_comp', supportsDenseLick: true,  supportsTripletLick: true, defaultCompingMode: 'shell_only' },
  Blues_Slow_Chops:      { rhythmFeel: 'swing_8',     compFamily: 'sparse_stab', supportsDenseLick: true,  supportsTripletLick: true, defaultCompingMode: 'shell_only' },

  // ── Ambient / pad / wash ──
  Ambient_Pad_Breath:    { rhythmFeel: 'straight_8',  compFamily: 'wide_pad', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Ambient_Reverse_Swell: { rhythmFeel: 'straight_8',  compFamily: 'wide_pad', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Piano_Ambient_Sustain_Wash: { rhythmFeel: 'straight_8', compFamily: 'wide_pad', supportsDenseLick: true, supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Low_Pedal_Color_Wash:  { rhythmFeel: 'straight_8',  compFamily: 'wide_pad', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'full_voicing' },
  Lyrical_Felt_Piano_Sparse: { rhythmFeel: 'straight_8', compFamily: 'wide_pad', supportsDenseLick: true, supportsTripletLick: false, defaultCompingMode: 'shell_only' },
  Piano_CommonTone_Soft_Roll: { rhythmFeel: 'straight_8', compFamily: 'shell_comp', supportsDenseLick: true, supportsTripletLick: false, defaultCompingMode: 'shell_only' },
  Piano_Wide_Color_Motion: { rhythmFeel: 'straight_8', compFamily: 'wide_pad', supportsDenseLick: true,  supportsTripletLick: false, defaultCompingMode: 'shell_only' },

  // ── Funk / guitar ──
  Funk_Guitar_Scratch:   { rhythmFeel: 'straight_16', compFamily: 'sparse_stab', supportsDenseLick: false, supportsTripletLick: false, defaultCompingMode: 'shell_only' },
};

export function getTextureMeta(name: string): TextureMeta {
  return TEXTURE_META[name] ?? FALLBACK;
}

// Selection: from a pool of texture names, pick by criteria. When
// lickProfile signals dense or triplet content, filter the pool to
// textures that support it. If filtering leaves the pool empty, fall
// back to the original pool. Caller supplies a random.next() for the
// final pick (keeps determinism in the engine's hands).
export interface SelectionContext {
  lickDense?: boolean;        // ≥ 8 attacks per bar OR occupancy ≥ 60%
  lickTriplet?: boolean;      // any lick note lands on triplet position
  preferredFeel?: RhythmFeel; // song-level feel from rhythmContract
  random: () => number;
}

export function selectTextureFromPool(pool: string[], ctx: SelectionContext): string {
  if (pool.length === 0) return 'Block_Chord';  // last-ditch fallback
  if (pool.length === 1) return pool[0];

  let candidates = pool.slice();

  // Filter 1: rhythmFeel match. If preferredFeel is set and any candidate
  // matches, restrict to those.
  if (ctx.preferredFeel) {
    const feelMatch = candidates.filter(n => getTextureMeta(n).rhythmFeel === ctx.preferredFeel);
    if (feelMatch.length > 0) candidates = feelMatch;
  }

  // Filter 2: dense lick → require supportsDenseLick. Otherwise lick
  // crowds with dense arpeggio textures and produces vertical mush.
  if (ctx.lickDense) {
    const denseSafe = candidates.filter(n => getTextureMeta(n).supportsDenseLick);
    if (denseSafe.length > 0) candidates = denseSafe;
  }

  // Filter 3: triplet lick → require supportsTripletLick. Avoids
  // putting an 8th-note straight-rock pattern under a triplet melody.
  if (ctx.lickTriplet) {
    const tripletSafe = candidates.filter(n => getTextureMeta(n).supportsTripletLick);
    if (tripletSafe.length > 0) candidates = tripletSafe;
  }

  const idx = Math.floor(ctx.random() * candidates.length);
  return candidates[Math.min(idx, candidates.length - 1)];
}
