import type { GrooveContract, GroovePhraseBarRole, GrooveStyleName } from './grooveContracts';

export type DrumFeelProfileId =
  | 'pop-tight-backbeat'
  | 'pop-live-lounge'
  | 'pop-ballad-soft'
  | 'pop-driving-rock'
  | 'rnb-laidback-pocket'
  | 'rnb-dilla-voices'
  | 'lofi-dusty-pocket'
  | 'jazz-swing-ride'
  | 'jazz-brush-ballad'
  | 'jazz-bossa-tight';

export type DrumKnowledgeSourceId =
  | 'google-gmd'
  | 'google-groovae'
  | 'friberg-swing'
  | 'ableton-grooves'
  | 'drumeo-rock'
  | 'drumeo-fills'
  | 'pgmusic-pop-ballad'
  | 'mystic-pop-ballad'
  | 'musicradar-midi-drums'
  | 'toontrack-ghost-notes'
  | 'native-instruments-drum-patterns'
  | 'rhythmnotes-drum-styles'
  | 'drumstheword-sixteenths'
  | 'roland-tr808'
  | 'sixty-must-know-fills';

export interface DrumKnowledgeSource {
  id: DrumKnowledgeSourceId;
  title: string;
  url: string;
  supports: readonly string[];
}

export const DRUM_KNOWLEDGE_SOURCES: readonly DrumKnowledgeSource[] = [
  {
    id: 'google-gmd',
    title: 'Groove MIDI Dataset',
    url: 'https://magenta.tensorflow.org/datasets/groove',
    supports: ['professional human MIDI', 'velocity distributions', 'microtiming', 'beats and fills'],
  },
  {
    id: 'google-groovae',
    title: 'GrooVAE: Generating and Controlling Expressive Drum Performances',
    url: 'https://magenta.tensorflow.org/groovae',
    supports: ['score and performance are separate projections', 'velocity and microtiming must be modeled jointly'],
  },
  {
    id: 'friberg-swing',
    title: 'Preferred swing ratio in jazz as a function of tempo',
    url: 'https://www.diva-portal.org/smash/get/diva2%3A1246291/DATASET01.pdf',
    supports: ['jazz ride swing ratio changes with tempo', 'fast swing approaches even eighths'],
  },
  {
    id: 'ableton-grooves',
    title: 'Ableton Live: Using Grooves',
    url: 'https://www.ableton.com/en/live-manual/12/using-grooves/',
    supports: ['timing and velocity are independent groove dimensions', 'voices may need independent groove treatment'],
  },
  {
    id: 'drumeo-rock',
    title: "A Drummer's Guide To Rock",
    url: 'https://www.drumeo.com/beat/a-drummers-guide-to-rock/',
    supports: ['lead-hand sound-source changes', 'ghost-note layers', 'fills signal transitions'],
  },
  {
    id: 'drumeo-fills',
    title: '7 Beginner Drum Fills',
    url: 'https://www.drumeo.com/beat/beginner-drum-fills/',
    supports: ['one-beat, half-bar and full-bar fill durations', 'crescendo builds', 'crash landing on the next downbeat'],
  },
  {
    id: 'pgmusic-pop-ballad',
    title: 'Country / Pop Ballad Drums',
    url: 'https://www.pgmusic.com/forums/ubbthreads.php?Number=705962&ubb=showflat',
    supports: ['soft brush 16ths', 'side-stick verse accents', 'simple pop ballad drum parts'],
  },
  {
    id: 'mystic-pop-ballad',
    title: 'Creating Catchy Pop Drum Patterns',
    url: 'https://mysticalankar.com/blogs/blog/rhythm-makers-crafting-irresistible-pop-drum-patterns',
    supports: ['slower emotional songs use softer dynamics', 'minimal kick and soft snare', 'fewer drum elements'],
  },
  {
    id: 'musicradar-midi-drums',
    title: 'How to program MIDI drums that sound like the real thing',
    url: 'https://www.musicradar.com/tutorials/music-production-tutorials/midi-drums-program-drum-week',
    supports: ['two-hand physical limit', 'subtle timing', 'accent/ghost contrast', 'fill stroke decay', 'multisample requirement'],
  },
  {
    id: 'toontrack-ghost-notes',
    title: 'How to program drums',
    url: 'https://www.toontrack.com/blog/how-to-program-drums/',
    supports: ['ghost notes live in low velocity bands', 'programmed drums need accent and ghost contrast'],
  },
  {
    id: 'native-instruments-drum-patterns',
    title: '7 drum patterns every producer should know',
    url: 'https://blog.native-instruments.com/drum-patterns/',
    supports: ['popular music uses a small vocabulary of reusable drum feels', 'house and funk patterns inform pop programming'],
  },
  {
    id: 'rhythmnotes-drum-styles',
    title: 'Drumming Styles - 28 Beats Every Drummer Should Know',
    url: 'https://rhythmnotes.net/drumming-styles/',
    supports: ['pop rock variations depend on subtle kick changes', 'disco uses four-on-floor with upbeat hats', 'bossa and bolero provide lighter lounge/pop ballad adaptations'],
  },
  {
    id: 'drumstheword-sixteenths',
    title: 'Sixteenth Note Hi-Hat: Syncopated Upbeat Sixteenths',
    url: 'https://www.drumstheword.com/free-drum-lesson-intermediate-lesson-7-sixteenth-note-hi-hat-single-double-handed-syncopated-upbeat/',
    supports: ['upbeat sixteenth notes between kick and snare create funkier syncopation', 'sixteenth hats need coordination with kick and snare patterns'],
  },
  {
    id: 'roland-tr808',
    title: 'TR-808 Technical Specifications',
    url: 'https://support.roland.com/hc/en-us/articles/201963539-TR-808-Technical-Specifications',
    supports: ['accent is a first-class performance dimension', 'A/B variation', 'automatic fill intervals'],
  },
  {
    id: 'sixty-must-know-fills',
    title: '60 Must-Know Drum Fills',
    url: 'https://www.youtube.com/watch?v=7wskFK6HP6w',
    supports: ['POP/Rock fill vocabulary reference', 'orchestration and sticking variation'],
  },
] as const;

export interface DrumVelocityBand {
  min: number;
  max: number;
}

export interface DrumVelocityGrammar {
  kickAnchor: DrumVelocityBand;
  kickResponse: DrumVelocityBand;
  snareAccent: DrumVelocityBand;
  snareGhost: DrumVelocityBand;
  timekeeperAccent: DrumVelocityBand;
  timekeeperTap: DrumVelocityBand;
  tomFill: DrumVelocityBand;
  crash: DrumVelocityBand;
}

export interface DrumVoiceTimingGrammar {
  kickAnchorMs: number;
  kickOffbeatMs: number;
  snareAccentMs: number;
  snareGhostMs: number;
  timekeeperOnbeatMs: number;
  timekeeperOffbeatMs: number;
  /** Correlated four-bar motion; never independent per-note noise. */
  phraseDriftMs: readonly [number, number, number, number];
  maxAbsoluteMs: number;
}

export interface DrumPhraseGrammar {
  velocityContour: readonly [number, number, number, number];
  ghostRoles: readonly GroovePhraseBarRole[];
  openHatRoles: readonly GroovePhraseBarRole[];
  allowInternalTurnaround: boolean;
  fillCadenceBars: readonly (4 | 8 | 16)[];
}

export interface DrumPhysicalGrammar {
  maxHandsAtOnce: 2;
  timekeeperHand: 'right' | 'alternating';
  ghostHand: 'left' | 'alternating';
  chokeOpenHatWithClosed: boolean;
}

export interface DrumFeelProfile {
  id: DrumFeelProfileId;
  style: GrooveStyleName;
  evidence: readonly DrumKnowledgeSourceId[];
  velocity: DrumVelocityGrammar;
  timing: DrumVoiceTimingGrammar;
  phrase: DrumPhraseGrammar;
  physical: DrumPhysicalGrammar;
}

const physical = (
  timekeeperHand: DrumPhysicalGrammar['timekeeperHand'] = 'right',
  ghostHand: DrumPhysicalGrammar['ghostHand'] = 'left',
): DrumPhysicalGrammar => ({
  maxHandsAtOnce: 2,
  timekeeperHand,
  ghostHand,
  chokeOpenHatWithClosed: true,
});

export const DRUM_FEEL_PROFILES: Readonly<Record<DrumFeelProfileId, DrumFeelProfile>> = {
  'pop-tight-backbeat': {
    id: 'pop-tight-backbeat', style: 'POP',
    evidence: ['google-gmd', 'google-groovae', 'ableton-grooves', 'drumeo-rock', 'musicradar-midi-drums'],
    velocity: {
      kickAnchor: { min: 96, max: 114 }, kickResponse: { min: 70, max: 94 },
      snareAccent: { min: 96, max: 114 }, snareGhost: { min: 30, max: 48 },
      timekeeperAccent: { min: 54, max: 70 }, timekeeperTap: { min: 36, max: 54 },
      tomFill: { min: 72, max: 116 }, crash: { min: 92, max: 114 },
    },
    timing: {
      kickAnchorMs: 0, kickOffbeatMs: -1, snareAccentMs: 2, snareGhostMs: -1,
      timekeeperOnbeatMs: 0, timekeeperOffbeatMs: 1, phraseDriftMs: [0, 0.5, -0.5, 0], maxAbsoluteMs: 7,
    },
    phrase: {
      velocityContour: [0.98, 1, 1.01, 1.03], ghostRoles: ['answer', 'turnaround'],
      openHatRoles: ['lift', 'turnaround'], allowInternalTurnaround: true, fillCadenceBars: [8, 16],
    },
    physical: physical(),
  },
  'pop-live-lounge': {
    id: 'pop-live-lounge', style: 'POP',
    evidence: [
      'google-gmd',
      'google-groovae',
      'musicradar-midi-drums',
      'toontrack-ghost-notes',
      'native-instruments-drum-patterns',
      'rhythmnotes-drum-styles',
      'drumstheword-sixteenths',
    ],
    velocity: {
      kickAnchor: { min: 88, max: 108 }, kickResponse: { min: 56, max: 84 },
      snareAccent: { min: 82, max: 104 }, snareGhost: { min: 22, max: 44 },
      timekeeperAccent: { min: 42, max: 62 }, timekeeperTap: { min: 24, max: 44 },
      tomFill: { min: 58, max: 92 }, crash: { min: 76, max: 98 },
    },
    timing: {
      kickAnchorMs: 0, kickOffbeatMs: -2, snareAccentMs: 5, snareGhostMs: 3,
      timekeeperOnbeatMs: 1, timekeeperOffbeatMs: 4, phraseDriftMs: [0, 1, 0, 1.5], maxAbsoluteMs: 13,
    },
    phrase: {
      velocityContour: [0.96, 0.99, 1.01, 1.03], ghostRoles: ['answer', 'lift', 'turnaround'],
      openHatRoles: ['lift', 'turnaround'], allowInternalTurnaround: true, fillCadenceBars: [8, 16],
    },
    physical: physical('alternating', 'left'),
  },
  'pop-ballad-soft': {
    id: 'pop-ballad-soft', style: 'POP',
    evidence: ['google-gmd', 'google-groovae', 'ableton-grooves', 'pgmusic-pop-ballad', 'mystic-pop-ballad'],
    velocity: {
      kickAnchor: { min: 62, max: 84 }, kickResponse: { min: 44, max: 66 },
      snareAccent: { min: 54, max: 72 }, snareGhost: { min: 18, max: 34 },
      timekeeperAccent: { min: 28, max: 46 }, timekeeperTap: { min: 18, max: 32 },
      tomFill: { min: 38, max: 62 }, crash: { min: 52, max: 74 },
    },
    timing: {
      kickAnchorMs: 1, kickOffbeatMs: 2, snareAccentMs: 6, snareGhostMs: 4,
      timekeeperOnbeatMs: 2, timekeeperOffbeatMs: 5, phraseDriftMs: [0, 1, 0.5, 1.5], maxAbsoluteMs: 14,
    },
    phrase: {
      velocityContour: [0.94, 0.97, 0.99, 1], ghostRoles: ['answer'],
      openHatRoles: [], allowInternalTurnaround: false, fillCadenceBars: [8, 16],
    },
    physical: physical('alternating', 'alternating'),
  },
  'pop-driving-rock': {
    id: 'pop-driving-rock', style: 'POP',
    evidence: ['google-gmd', 'drumeo-rock', 'drumeo-fills', 'musicradar-midi-drums', 'sixty-must-know-fills'],
    velocity: {
      kickAnchor: { min: 100, max: 118 }, kickResponse: { min: 78, max: 100 },
      snareAccent: { min: 102, max: 120 }, snareGhost: { min: 34, max: 52 },
      timekeeperAccent: { min: 58, max: 76 }, timekeeperTap: { min: 40, max: 58 },
      tomFill: { min: 80, max: 120 }, crash: { min: 100, max: 120 },
    },
    timing: {
      kickAnchorMs: -1, kickOffbeatMs: -3, snareAccentMs: 0, snareGhostMs: -2,
      timekeeperOnbeatMs: -1, timekeeperOffbeatMs: 0, phraseDriftMs: [0, -0.5, -1, -0.5], maxAbsoluteMs: 7,
    },
    phrase: {
      velocityContour: [0.98, 1, 1.03, 1.06], ghostRoles: ['answer', 'turnaround'],
      openHatRoles: ['answer', 'lift', 'turnaround'], allowInternalTurnaround: true, fillCadenceBars: [4, 8],
    },
    physical: physical('alternating', 'alternating'),
  },
  'rnb-laidback-pocket': {
    id: 'rnb-laidback-pocket', style: 'RNB',
    evidence: ['google-gmd', 'google-groovae', 'ableton-grooves', 'musicradar-midi-drums', 'roland-tr808'],
    velocity: {
      kickAnchor: { min: 88, max: 108 }, kickResponse: { min: 62, max: 88 },
      snareAccent: { min: 80, max: 102 }, snareGhost: { min: 24, max: 44 },
      timekeeperAccent: { min: 42, max: 58 }, timekeeperTap: { min: 24, max: 42 },
      tomFill: { min: 58, max: 96 }, crash: { min: 78, max: 102 },
    },
    timing: {
      kickAnchorMs: 0, kickOffbeatMs: -3, snareAccentMs: 8, snareGhostMs: 4,
      timekeeperOnbeatMs: 1, timekeeperOffbeatMs: 5, phraseDriftMs: [0, 1, 0, 2], maxAbsoluteMs: 16,
    },
    phrase: {
      velocityContour: [0.97, 0.99, 1, 1.02], ghostRoles: ['answer', 'lift', 'turnaround'],
      openHatRoles: ['lift', 'turnaround'], allowInternalTurnaround: true, fillCadenceBars: [8, 16],
    },
    physical: physical(),
  },
  'rnb-dilla-voices': {
    id: 'rnb-dilla-voices', style: 'RNB',
    evidence: ['google-gmd', 'google-groovae', 'ableton-grooves', 'roland-tr808'],
    velocity: {
      kickAnchor: { min: 86, max: 106 }, kickResponse: { min: 58, max: 86 },
      snareAccent: { min: 78, max: 100 }, snareGhost: { min: 22, max: 42 },
      timekeeperAccent: { min: 40, max: 56 }, timekeeperTap: { min: 22, max: 40 },
      tomFill: { min: 56, max: 92 }, crash: { min: 76, max: 98 },
    },
    timing: {
      kickAnchorMs: 0, kickOffbeatMs: -5, snareAccentMs: 12, snareGhostMs: 6,
      timekeeperOnbeatMs: 2, timekeeperOffbeatMs: 8, phraseDriftMs: [0, 2, -1, 1], maxAbsoluteMs: 20,
    },
    phrase: {
      velocityContour: [0.97, 1, 0.98, 1.02], ghostRoles: ['answer', 'lift', 'turnaround'],
      openHatRoles: ['turnaround'], allowInternalTurnaround: true, fillCadenceBars: [8, 16],
    },
    physical: physical(),
  },
  'lofi-dusty-pocket': {
    id: 'lofi-dusty-pocket', style: 'LOFI',
    evidence: ['google-gmd', 'google-groovae', 'ableton-grooves', 'musicradar-midi-drums', 'roland-tr808'],
    velocity: {
      kickAnchor: { min: 82, max: 102 }, kickResponse: { min: 54, max: 80 },
      snareAccent: { min: 70, max: 92 }, snareGhost: { min: 20, max: 38 },
      timekeeperAccent: { min: 34, max: 50 }, timekeeperTap: { min: 18, max: 34 },
      tomFill: { min: 48, max: 82 }, crash: { min: 68, max: 90 },
    },
    timing: {
      kickAnchorMs: -1, kickOffbeatMs: -4, snareAccentMs: 11, snareGhostMs: 5,
      timekeeperOnbeatMs: 3, timekeeperOffbeatMs: 8, phraseDriftMs: [0, 2, -1, 3], maxAbsoluteMs: 21,
    },
    phrase: {
      velocityContour: [0.96, 0.98, 0.97, 1], ghostRoles: ['answer', 'turnaround'],
      openHatRoles: ['turnaround'], allowInternalTurnaround: false, fillCadenceBars: [8, 16],
    },
    physical: physical(),
  },
  'jazz-swing-ride': {
    id: 'jazz-swing-ride', style: 'JAZZ',
    evidence: ['google-gmd', 'google-groovae', 'friberg-swing', 'ableton-grooves', 'musicradar-midi-drums'],
    velocity: {
      kickAnchor: { min: 44, max: 68 }, kickResponse: { min: 34, max: 54 },
      snareAccent: { min: 58, max: 82 }, snareGhost: { min: 28, max: 50 },
      timekeeperAccent: { min: 62, max: 82 }, timekeeperTap: { min: 42, max: 64 },
      tomFill: { min: 54, max: 90 }, crash: { min: 74, max: 100 },
    },
    timing: {
      kickAnchorMs: 0, kickOffbeatMs: 1, snareAccentMs: 3, snareGhostMs: 1,
      timekeeperOnbeatMs: 0, timekeeperOffbeatMs: 1, phraseDriftMs: [0, 0.5, -0.5, 0.5], maxAbsoluteMs: 9,
    },
    phrase: {
      velocityContour: [0.98, 0.97, 1, 1.03], ghostRoles: ['answer', 'lift', 'turnaround'],
      openHatRoles: [], allowInternalTurnaround: true, fillCadenceBars: [8, 16],
    },
    physical: physical(),
  },
  'jazz-brush-ballad': {
    id: 'jazz-brush-ballad', style: 'JAZZ',
    evidence: ['google-gmd', 'google-groovae', 'friberg-swing', 'musicradar-midi-drums'],
    velocity: {
      kickAnchor: { min: 34, max: 52 }, kickResponse: { min: 28, max: 44 },
      snareAccent: { min: 42, max: 62 }, snareGhost: { min: 18, max: 34 },
      timekeeperAccent: { min: 44, max: 62 }, timekeeperTap: { min: 28, max: 46 },
      tomFill: { min: 42, max: 70 }, crash: { min: 60, max: 82 },
    },
    timing: {
      kickAnchorMs: 1, kickOffbeatMs: 2, snareAccentMs: 4, snareGhostMs: 2,
      timekeeperOnbeatMs: 1, timekeeperOffbeatMs: 3, phraseDriftMs: [0, 1, 0, 1.5], maxAbsoluteMs: 11,
    },
    phrase: {
      velocityContour: [0.96, 0.98, 1, 1.01], ghostRoles: ['answer', 'turnaround'],
      openHatRoles: [], allowInternalTurnaround: false, fillCadenceBars: [8, 16],
    },
    physical: physical('alternating', 'alternating'),
  },
  'jazz-bossa-tight': {
    id: 'jazz-bossa-tight', style: 'JAZZ',
    evidence: ['google-gmd', 'google-groovae', 'ableton-grooves', 'musicradar-midi-drums'],
    velocity: {
      kickAnchor: { min: 50, max: 70 }, kickResponse: { min: 40, max: 60 },
      snareAccent: { min: 52, max: 72 }, snareGhost: { min: 28, max: 46 },
      timekeeperAccent: { min: 54, max: 70 }, timekeeperTap: { min: 38, max: 54 },
      tomFill: { min: 52, max: 78 }, crash: { min: 68, max: 90 },
    },
    timing: {
      kickAnchorMs: 0, kickOffbeatMs: -1, snareAccentMs: 1, snareGhostMs: 0,
      timekeeperOnbeatMs: 0, timekeeperOffbeatMs: 1, phraseDriftMs: [0, 0.5, 0, 0.5], maxAbsoluteMs: 7,
    },
    phrase: {
      velocityContour: [0.98, 1, 0.99, 1.02], ghostRoles: ['answer', 'turnaround'],
      openHatRoles: [], allowInternalTurnaround: true, fillCadenceBars: [8, 16],
    },
    physical: physical(),
  },
};

const PROFILE_BY_CONTRACT_ID: Readonly<Record<string, DrumFeelProfileId>> = {
  pop_radio_straight: 'pop-live-lounge',
  pop_citypop_boogie: 'pop-driving-rock',
  pop_jpop_push_8ths: 'pop-live-lounge',
  pop_ballad_halftime: 'pop-ballad-soft',
  rnb_neo_soul_laidback: 'rnb-laidback-pocket',
  rnb_dilla_pocket: 'rnb-dilla-voices',
  rnb_gospel_triplet: 'rnb-laidback-pocket',
  rnb_motown_backbeat: 'pop-tight-backbeat',
  rnb_trap_soul_halftime: 'rnb-laidback-pocket',
  lofi_lazy_dilla: 'lofi-dusty-pocket',
  lofi_soul_boombap: 'pop-tight-backbeat',
  lofi_tape_late_chords: 'lofi-dusty-pocket',
  lofi_halftime_dusty: 'rnb-laidback-pocket',
  lofi_ambient_study: 'pop-tight-backbeat',
  jazz_combo_swing: 'jazz-swing-ride',
  jazz_medium_swing: 'jazz-swing-ride',
  jazz_smooth_backbeat: 'rnb-laidback-pocket',
  jazz_ballad_loose: 'jazz-brush-ballad',
  jazz_bossa_straight_latin: 'jazz-bossa-tight',
  jazz_take_five_5_4: 'jazz-swing-ride',
  acg_hisaishi_rubato_arp: 'pop-tight-backbeat',
  acg_planing_wash: 'pop-tight-backbeat',
  acg_jpop_456_drive: 'pop-driving-rock',
};

export function drumFeelProfileIdForContract(contract: Pick<GrooveContract, 'id' | 'style' | 'grid' | 'density'>): DrumFeelProfileId {
  const explicit = PROFILE_BY_CONTRACT_ID[contract.id];
  if (explicit) return explicit;
  if (contract.style === 'JAZZ') return contract.density === 'sparse' ? 'jazz-brush-ballad' : 'jazz-swing-ride';
  if (contract.style === 'LOFI') return 'lofi-dusty-pocket';
  if (contract.style === 'RNB') return contract.grid === 'dilla' ? 'rnb-dilla-voices' : 'rnb-laidback-pocket';
  return contract.density === 'active' ? 'pop-driving-rock' : 'pop-tight-backbeat';
}

export function drumFeelProfile(id: DrumFeelProfileId): DrumFeelProfile {
  return DRUM_FEEL_PROFILES[id];
}

/**
 * Friberg/Sundstrom found a gradual tempo relation rather than a fixed 2:1
 * ratio. Keep the curve conservative and bounded for the production range.
 */
export function tempoAwareJazzSwingRatio(baseRatio: number, tempoBpm: number): number {
  if (!Number.isFinite(tempoBpm) || tempoBpm <= 0) return baseRatio;
  const measuredShape = 0.75 - Math.max(0, tempoBpm - 80) * 0.00115;
  const bounded = Math.max(0.54, Math.min(0.72, measuredShape));
  return Math.max(0.5, Math.min(0.75, baseRatio * 0.25 + bounded * 0.75));
}
