// ============================================================
// newEngine · knowledge · Groove Contract(MG 增量升级 Phase 1,源 melodygenerative@24dfd6f)
// ------------------------------------------------------------
// Groove Contract = song/section-level 的编曲身份(grid/density/comp-melody 分开 swing/ms pocket/
//   accent/articulation/texture 偏好)。**数据 + 查询在 KB**;选择由 arranger(groovePlanner)调配,
//   render 只消费。比旧 `GrooveKind` 丰富。纯数据 / 纯函数 / 确定性。
// 注:① style 用 MG 的大写 union(POP/JAZZ/BLUES/RNB/LOFI/ACG);simulator 小写 style 在 groovePlanner
//   映射。② BLUES 无独立 pool → grooveContractsForStyle 回退 POP(Phase 1 零洗牌:非 ACG 走 legacy 派生)。
//   ③ ACG pool 引用的 ACG texture case 在 Phase 2 才进 KB;此处仅数据,Phase 1 不命中。
// ============================================================

import type { TextureProfile } from './textureProfiles';
import type { Meter } from '../foundation';
import {
  POP_ROCK_FILL_VOCABULARY_ID,
  type GrooveDrumFillVocabularyId,
} from './drumFillVocabulary';
import type { GrooveBassPatternId } from './grooveBassPatterns';

export type GrooveStyleName = 'POP' | 'JAZZ' | 'BLUES' | 'RNB' | 'LOFI' | 'ACG';
export type GrooveGrid = 'straight' | 'swing' | 'shuffle' | 'dilla' | 'rubato';
export type GrooveRhythmSwingSource = 'straight-eighths' | 'straight-sixteenths' | 'authored';
export type GrooveBarOriginPolicy = 'song-global';
export type GroovePhaseLaneId =
  | 'quarter'
  | 'triplet-late'
  | 'authored-61-96'
  | 'development-5-8'
  | 'straight-sixteenth'
  | 'lead-thirtieth-bar-cell';

/**
 * Exact reusable coordinate inside one quarter-note beat.  This is a clock
 * vocabulary, not a role mask: KB families and Arranger decide which lanes a
 * Bass/Comp/Lead/Drum pattern may actually use.
 */
export interface GroovePhaseLane {
  id: GroovePhaseLaneId;
  offset: { numerator: number; denominator: number };
  /** Authored coordinates are final nominal time and may not be swung again. */
  postSwing: false;
}
export type GrooveSwingCurve = 'fixed' | 'jazz-tempo';
export type GrooveDensity = 'sparse' | 'medium' | 'active';
export type GrooveArticulation = 'legato' | 'short' | 'bebop' | 'ballad';
export type GrooveDrumKitProgram = 8 | 25 | 40;
export type GrooveSubdivision = 'eighth' | 'sixteenth' | 'triplet';
export type GroovePhraseBarRole = 'base' | 'answer' | 'lift' | 'turnaround' | 'breakdown';
export type GrooveBoundaryBaseMask = 'keep' | 'mask-window' | 'replace-bar';
export type GrooveLandingGesture = 'none' | 'kick' | 'kick-crash' | 'ride' | 'kick-ride';
export type GrooveDrumFillFamily =
  | 'pop-tom-build'
  | 'pop-snare-pickup'
  | 'motown-tom-bridge'
  | 'rnb-pocket-turn'
  | 'rnb-gospel-triplet'
  | 'trap-snare-roll'
  | 'lofi-one-shot'
  | 'jazz-triplet-setup'
  | 'jazz-bossa-cross-stick';

export interface GrooveTransitionGrammar {
  lightBeats: number;
  strongBeats: number;
  openingPickupBeats: number;
  cadenceEveryBars: 4 | 8 | 16;
  allowSetupPickup: boolean;
  lightBaseMask: GrooveBoundaryBaseMask;
  strongBaseMask: GrooveBoundaryBaseMask;
}

/**
 * Normalized KB vocabulary referenced by GrooveContract. accentPattern remains
 * the contract's single beat-strength truth; this profile adds subdivision,
 * multi-bar phrasing and boundary grammar without creating a second groove.
 */
export interface GrooveRhythmProfile {
  subdivision: GrooveSubdivision;
  subdivisionAccent: readonly number[];
  phraseShape: readonly GroovePhraseBarRole[];
  phraseAccent: readonly number[];
  transition: GrooveTransitionGrammar;
}

export const GROOVE_RHYTHM_PROFILES = {
  'pop-straight': {
    subdivision: 'sixteenth', subdivisionAccent: [1, 0.68, 0.86, 0.64],
    phraseShape: ['base', 'answer', 'base', 'turnaround'], phraseAccent: [1, 0.96, 1.02, 1.05],
    transition: { lightBeats: 1, strongBeats: 2, openingPickupBeats: 2, cadenceEveryBars: 8, allowSetupPickup: true, lightBaseMask: 'mask-window', strongBaseMask: 'mask-window' },
  },
  'pop-ballad': {
    subdivision: 'eighth', subdivisionAccent: [1, 0.72],
    phraseShape: ['base', 'base', 'answer', 'turnaround'], phraseAccent: [0.96, 0.98, 1, 1.04],
    transition: { lightBeats: 1, strongBeats: 2, openingPickupBeats: 2, cadenceEveryBars: 8, allowSetupPickup: true, lightBaseMask: 'mask-window', strongBaseMask: 'mask-window' },
  },
  'rnb-sixteenth': {
    subdivision: 'sixteenth', subdivisionAccent: [1, 0.62, 0.82, 0.58],
    phraseShape: ['base', 'answer', 'base', 'turnaround'], phraseAccent: [0.98, 0.96, 1, 1.03],
    transition: { lightBeats: 1, strongBeats: 2, openingPickupBeats: 1, cadenceEveryBars: 8, allowSetupPickup: true, lightBaseMask: 'mask-window', strongBaseMask: 'mask-window' },
  },
  'rnb-triplet': {
    subdivision: 'triplet', subdivisionAccent: [1, 0.62, 0.84],
    phraseShape: ['base', 'answer', 'lift', 'turnaround'], phraseAccent: [0.98, 0.97, 1.02, 1.06],
    transition: { lightBeats: 1, strongBeats: 2, openingPickupBeats: 1, cadenceEveryBars: 4, allowSetupPickup: true, lightBaseMask: 'mask-window', strongBaseMask: 'mask-window' },
  },
  'lofi-pocket': {
    subdivision: 'sixteenth', subdivisionAccent: [0.98, 0.58, 0.8, 0.56],
    phraseShape: ['base', 'answer', 'base', 'turnaround'], phraseAccent: [0.96, 0.94, 0.98, 1],
    transition: { lightBeats: 0.5, strongBeats: 1, openingPickupBeats: 1, cadenceEveryBars: 8, allowSetupPickup: true, lightBaseMask: 'mask-window', strongBaseMask: 'replace-bar' },
  },
  'jazz-swing': {
    subdivision: 'triplet', subdivisionAccent: [1, 0.6, 0.82],
    phraseShape: ['base', 'answer', 'base', 'turnaround'], phraseAccent: [0.98, 0.96, 1, 1.04],
    transition: { lightBeats: 1, strongBeats: 2, openingPickupBeats: 2, cadenceEveryBars: 8, allowSetupPickup: true, lightBaseMask: 'mask-window', strongBaseMask: 'mask-window' },
  },
  'jazz-five-four-triplet': {
    subdivision: 'triplet', subdivisionAccent: [1, 0.6, 0.82],
    phraseShape: ['base', 'answer', 'lift', 'turnaround'], phraseAccent: [0.98, 0.97, 1.01, 1.04],
    transition: { lightBeats: 1, strongBeats: 2, openingPickupBeats: 1, cadenceEveryBars: 4, allowSetupPickup: false, lightBaseMask: 'keep', strongBaseMask: 'mask-window' },
  },
  'jazz-bossa': {
    subdivision: 'eighth', subdivisionAccent: [1, 0.72],
    phraseShape: ['base', 'answer', 'base', 'turnaround'], phraseAccent: [0.98, 0.97, 1, 1.02],
    transition: { lightBeats: 1, strongBeats: 1, openingPickupBeats: 1, cadenceEveryBars: 8, allowSetupPickup: true, lightBaseMask: 'mask-window', strongBaseMask: 'mask-window' },
  },
  'rubato-four': {
    subdivision: 'eighth', subdivisionAccent: [1, 0.78],
    phraseShape: ['base', 'answer', 'base', 'turnaround'], phraseAccent: [0.96, 0.98, 1, 1.03],
    transition: { lightBeats: 1, strongBeats: 2, openingPickupBeats: 1, cadenceEveryBars: 8, allowSetupPickup: false, lightBaseMask: 'mask-window', strongBaseMask: 'mask-window' },
  },
} as const satisfies Record<string, GrooveRhythmProfile>;

export type GrooveRhythmProfileId = keyof typeof GROOVE_RHYTHM_PROFILES;

export interface GrooveDrumIntent {
  kitProgram: GrooveDrumKitProgram;
  timekeeperFamily: string;
  liftFamily?: string;
  pickupFamily?: string;
  breakdownFamily?: string;
  fillFamilies: {
    light: GrooveDrumFillFamily;
    strong: GrooveDrumFillFamily;
    pickup: GrooveDrumFillFamily;
  };
  /** Optional combinatorial vocabulary materialized by Arranger into concrete fill hits. */
  fillVocabulary?: GrooveDrumFillVocabularyId;
  landing: GrooveLandingGesture;
  kickFollow: 'pulse' | 'bass';
  snareFollow: 'backbeat' | 'lead-accents' | 'comping';
}

export interface PickerRandom { next(): number }

export interface GrooveContract {
  id: string;
  name: string;
  style: GrooveStyleName;
  weight: number;
  /** 拍号/加法分组属于 groove 身份；未声明时沿用 style 的 TimeFeel。 */
  meter?: Meter;
  beatGrouping?: number[];
  /** A section or role may never establish a private bar-zero. */
  barOriginPolicy?: GrooveBarOriginPolicy;
  /** Exact clock coordinates available to score-owned rhythm families. */
  phaseLanes?: readonly GroovePhaseLane[];
  /** 可选的 song-level 速度身份；由 Arranger 的 TimePlanner 消费。 */
  tempoBpm?: number;
  tempoRange?: number;
  grid: GrooveGrid;
  density: GrooveDensity;
  /** Normalized KB reference; legacy fixtures may omit it and resolve by id. */
  rhythmProfile?: GrooveRhythmProfileId;
  compSwingRatio: number;       // comp/bass/drum swing 真源
  /**
   * Grid owned by the authored rhythm material before compSwingRatio is
   * applied. `authored` means the KB already contains its final triplet
   * positions and must not be swung a second time.
   */
  rhythmSwingSource?: GrooveRhythmSwingSource;
  /** Optional tempo projection; still part of this one GrooveContract. */
  swingCurve?: GrooveSwingCurve;
  melodySwingRatio: number;     // lead/MG melody swing 真源
  bassPocketMs: [number, number];
  chordPocketMs: [number, number];
  melodyStrongPocketMs: [number, number];
  melodyWeakPocketMs: [number, number];
  velocityHumanize: number;
  accentPattern: number[];
  articulation: GrooveArticulation;
  drum?: GrooveDrumIntent;
  pushProbability?: number;
  bassPattern?: GrooveBassPatternId;
  preferredTextureCases?: string[];
  allowedTextureCases?: string[];
  forbiddenTextureCases?: string[];
}

export function rhythmSwingSourceForContract(
  contract: Pick<GrooveContract, 'grid' | 'rhythmSwingSource'>,
): GrooveRhythmSwingSource {
  if (contract.rhythmSwingSource) return contract.rhythmSwingSource;
  if (contract.grid === 'dilla') return 'straight-sixteenths';
  if (contract.grid === 'shuffle') return 'authored';
  return 'straight-eighths';
}

const drumIntent = (
  kitProgram: GrooveDrumKitProgram,
  families: Pick<GrooveDrumIntent, 'timekeeperFamily' | 'liftFamily' | 'pickupFamily' | 'breakdownFamily'>,
  fillFamilies: GrooveDrumIntent['fillFamilies'],
  landing: GrooveLandingGesture,
  kickFollow: GrooveDrumIntent['kickFollow'],
  snareFollow: GrooveDrumIntent['snareFollow'],
  fillVocabulary?: GrooveDrumFillVocabularyId,
): GrooveDrumIntent => ({ kitProgram, ...families, fillFamilies, fillVocabulary, landing, kickFollow, snareFollow });

const DRUM_POP_RADIO = drumIntent(8, { timekeeperFamily: 'pop-backbeat', liftFamily: 'pop-backbeat', pickupFamily: 'pop-backbeat', breakdownFamily: 'ballad-halftime' }, { light: 'pop-snare-pickup', strong: 'pop-tom-build', pickup: 'pop-tom-build' }, 'kick-crash', 'bass', 'backbeat', POP_ROCK_FILL_VOCABULARY_ID);
const DRUM_CITYPOP = drumIntent(8, { timekeeperFamily: 'citypop-syncopated-boogie', liftFamily: 'citypop-disco-boogie', pickupFamily: 'citypop-disco-boogie', breakdownFamily: 'citypop-syncopated-boogie' }, { light: 'pop-snare-pickup', strong: 'pop-tom-build', pickup: 'pop-tom-build' }, 'kick-crash', 'bass', 'backbeat', POP_ROCK_FILL_VOCABULARY_ID);
const DRUM_JPOP = drumIntent(8, { timekeeperFamily: 'jpop-driving-8ths', liftFamily: 'jpop-driving-8ths', pickupFamily: 'jpop-driving-8ths', breakdownFamily: 'pop-backbeat' }, { light: 'pop-snare-pickup', strong: 'pop-tom-build', pickup: 'pop-tom-build' }, 'kick-crash', 'bass', 'backbeat', POP_ROCK_FILL_VOCABULARY_ID);
const DRUM_POP_BALLAD = drumIntent(8, { timekeeperFamily: 'ballad-halftime', liftFamily: 'ballad-halftime', pickupFamily: 'ballad-halftime', breakdownFamily: 'ballad-halftime' }, { light: 'pop-snare-pickup', strong: 'pop-snare-pickup', pickup: 'pop-snare-pickup' }, 'kick', 'pulse', 'backbeat', POP_ROCK_FILL_VOCABULARY_ID);
const DRUM_808_LOFI = drumIntent(25, { timekeeperFamily: 'tr808-lofi-boombap', liftFamily: 'tr808-lofi-boombap', pickupFamily: 'tr808-lofi-boombap', breakdownFamily: 'tr808-lofi-minimal' }, { light: 'lofi-one-shot', strong: 'lofi-one-shot', pickup: 'lofi-one-shot' }, 'kick', 'bass', 'backbeat');
const DRUM_808_LOFI_DUSTY = drumIntent(25, { timekeeperFamily: 'tr808-lofi-dusty-break', liftFamily: 'tr808-lofi-boombap', pickupFamily: 'tr808-lofi-dusty-break', breakdownFamily: 'tr808-lofi-minimal' }, { light: 'lofi-one-shot', strong: 'lofi-one-shot', pickup: 'lofi-one-shot' }, 'kick', 'bass', 'backbeat');
const DRUM_808_LOFI_HALFTIME = drumIntent(25, { timekeeperFamily: 'tr808-lofi-soul-halftime', liftFamily: 'tr808-lofi-soul-halftime', pickupFamily: 'tr808-lofi-soul-halftime', breakdownFamily: 'tr808-lofi-minimal' }, { light: 'lofi-one-shot', strong: 'lofi-one-shot', pickup: 'lofi-one-shot' }, 'kick', 'bass', 'backbeat');
const DRUM_808_RNB = drumIntent(25, { timekeeperFamily: 'tr808-rnb-pocket', liftFamily: 'tr808-rnb-pocket', pickupFamily: 'tr808-rnb-pocket', breakdownFamily: 'tr808-rnb-pocket' }, { light: 'rnb-pocket-turn', strong: 'rnb-pocket-turn', pickup: 'rnb-pocket-turn' }, 'kick', 'bass', 'backbeat');
const DRUM_808_DILLA = drumIntent(25, { timekeeperFamily: 'tr808-dilla-pocket', liftFamily: 'tr808-dilla-pocket', pickupFamily: 'tr808-dilla-pocket', breakdownFamily: 'tr808-rnb-pocket' }, { light: 'rnb-pocket-turn', strong: 'rnb-pocket-turn', pickup: 'rnb-pocket-turn' }, 'kick', 'bass', 'backbeat');
const DRUM_RNB_GOSPEL = drumIntent(8, { timekeeperFamily: 'rnb-gospel-triplet', liftFamily: 'rnb-gospel-triplet', pickupFamily: 'rnb-gospel-triplet', breakdownFamily: 'rnb-gospel-triplet' }, { light: 'rnb-gospel-triplet', strong: 'rnb-gospel-triplet', pickup: 'rnb-gospel-triplet' }, 'kick-crash', 'bass', 'backbeat');
const DRUM_RNB_MOTOWN = drumIntent(8, { timekeeperFamily: 'pop-backbeat', liftFamily: 'pop-backbeat', pickupFamily: 'pop-backbeat', breakdownFamily: 'pop-backbeat' }, { light: 'motown-tom-bridge', strong: 'motown-tom-bridge', pickup: 'motown-tom-bridge' }, 'kick-crash', 'bass', 'backbeat');
const DRUM_808_TRAP = drumIntent(25, { timekeeperFamily: 'tr808-trap-soul-halftime', liftFamily: 'tr808-trap-soul-halftime', pickupFamily: 'tr808-trap-soul-halftime', breakdownFamily: 'tr808-trap-soul-halftime' }, { light: 'trap-snare-roll', strong: 'trap-snare-roll', pickup: 'trap-snare-roll' }, 'kick', 'bass', 'backbeat');
const DRUM_JAZZ_SWING = drumIntent(40, { timekeeperFamily: 'jazz-swing-ride', liftFamily: 'jazz-bebop-comping', pickupFamily: 'jazz-swing-ride', breakdownFamily: 'jazz-brush-ballad' }, { light: 'jazz-triplet-setup', strong: 'jazz-triplet-setup', pickup: 'jazz-triplet-setup' }, 'kick-ride', 'pulse', 'comping');
const DRUM_SMOOTH_JAZZ = drumIntent(8, { timekeeperFamily: 'smooth-jazz-backbeat', liftFamily: 'smooth-jazz-backbeat', pickupFamily: 'smooth-jazz-backbeat', breakdownFamily: 'smooth-jazz-backbeat' }, { light: 'rnb-pocket-turn', strong: 'pop-tom-build', pickup: 'rnb-pocket-turn' }, 'kick-crash', 'bass', 'backbeat');
const DRUM_JAZZ_BALLAD = drumIntent(40, { timekeeperFamily: 'jazz-brush-ballad', liftFamily: 'jazz-brush-ballad', pickupFamily: 'jazz-brush-ballad', breakdownFamily: 'jazz-brush-ballad' }, { light: 'jazz-triplet-setup', strong: 'jazz-triplet-setup', pickup: 'jazz-triplet-setup' }, 'ride', 'pulse', 'comping');
const DRUM_JAZZ_BOSSA = drumIntent(40, { timekeeperFamily: 'jazz-bossa', liftFamily: 'jazz-bossa', pickupFamily: 'jazz-bossa', breakdownFamily: 'jazz-bossa' }, { light: 'jazz-bossa-cross-stick', strong: 'jazz-bossa-cross-stick', pickup: 'jazz-bossa-cross-stick' }, 'ride', 'pulse', 'comping');
const DRUM_ACG_ROOM = drumIntent(8, { timekeeperFamily: 'ballad-halftime', liftFamily: 'jpop-driving-8ths', pickupFamily: 'pop-backbeat', breakdownFamily: 'ballad-halftime' }, { light: 'pop-snare-pickup', strong: 'pop-tom-build', pickup: 'pop-tom-build' }, 'kick-crash', 'pulse', 'backbeat');

const POP_GROOVES: GrooveContract[] = [
  { id: 'pop_radio_straight', name: 'POP radio straight grid', style: 'POP', weight: 4.5, grid: 'straight', density: 'medium', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [0, 2], chordPocketMs: [0, 6], melodyStrongPocketMs: [0, 0], melodyWeakPocketMs: [0, 2], velocityHumanize: 0.05, accentPattern: [1.0, 0.88, 0.98, 0.86], articulation: 'legato', drum: DRUM_POP_RADIO, preferredTextureCases: ['Block_Chord', 'Broken_Chord', 'Pop_Broken_8ths_Sync', 'Pop_Alberti_Lyrical', 'Lyrical_10th_Broken'], allowedTextureCases: ['Block_Chord', 'Broken_Chord', 'Pop_Broken_8ths_Sync', 'Pop_Alberti_Lyrical', 'Pop_Half_Arp_Sweep', 'Arpeggio_Flow', 'Lyrical_10th_Broken', 'Piano_Question_Answer', 'Soft_Guitar_Pluck_8ths'], forbiddenTextureCases: ['Ambient_Reverse_Swell', 'Low_Pedal_Color_Wash'] },
  { id: 'pop_citypop_boogie', name: 'POP CityPop boogie pocket', style: 'POP', weight: 1.2, grid: 'straight', density: 'active', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [-2, 2], chordPocketMs: [0, 6], melodyStrongPocketMs: [0, 2], melodyWeakPocketMs: [0, 6], velocityHumanize: 0.05, accentPattern: [1.02, 0.88, 1.0, 0.88], articulation: 'legato', drum: DRUM_CITYPOP, pushProbability: 0.06, preferredTextureCases: ['Pop_Broken_8ths_Sync', 'Soft_Guitar_Pluck_8ths', 'Pop_Rnb_Expensive_Add9_Quartal'], allowedTextureCases: ['Pop_Broken_8ths_Sync', 'Pop_Wave_16ths', 'Pop_Half_Arp_Sweep', 'Pop_Piano_Arp_16ths', 'Soft_Guitar_Pluck_8ths', 'Pop_Rnb_Expensive_Add9_Quartal', 'Block_Chord', 'Broken_Chord'], forbiddenTextureCases: ['Ambient_Reverse_Swell', 'Low_Pedal_Color_Wash'] },
  { id: 'pop_jpop_push_8ths', name: 'POP/JPOP forward eighths', style: 'POP', weight: 5, grid: 'straight', density: 'medium', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [-1, 3], chordPocketMs: [0, 7], melodyStrongPocketMs: [0, 2], melodyWeakPocketMs: [2, 8], velocityHumanize: 0.06, accentPattern: [1.02, 0.9, 1.0, 0.88], articulation: 'legato', drum: DRUM_JPOP, pushProbability: 0.06, preferredTextureCases: ['Pop_Broken_8ths_Sync', 'Pop_Half_Arp_Sweep', 'Pop_Piano_Arp_16ths', 'Soft_Guitar_Pluck_8ths', 'Lyrical_10th_Broken'], allowedTextureCases: ['Pop_Broken_8ths_Sync', 'Pop_Half_Arp_Sweep', 'Pop_Piano_Arp_16ths', 'Soft_Guitar_Pluck_8ths', 'Lyrical_10th_Broken', 'Piano_Question_Answer', 'Pop_Ballad_158_Sweep'], forbiddenTextureCases: ['Ambient_Pad_Breath', 'Ambient_Reverse_Swell', 'Low_Pedal_Color_Wash', 'Pop_Anthem_Pulse'] },
  { id: 'pop_ballad_halftime', name: 'POP ballad half-time', style: 'POP', weight: 2.8, grid: 'straight', density: 'sparse', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [0, 4], chordPocketMs: [2, 12], melodyStrongPocketMs: [0, 0], melodyWeakPocketMs: [0, 0], velocityHumanize: 0.07, accentPattern: [1.0, 0.86, 0.98, 0.84], articulation: 'ballad', drum: DRUM_POP_BALLAD, preferredTextureCases: ['Lyrical_Felt_Piano_Sparse', 'Lyrical_10th_Broken', 'Piano_Wide_Color_Motion', 'Ambient_Pad_Breath', 'Soft_Guitar_Pluck_8ths', 'Piano_Question_Answer', 'Pop_Ballad_158_Sweep'], allowedTextureCases: ['HalfTime_Emotional_Pulse', 'Lyrical_Felt_Piano_Sparse', 'Lyrical_10th_Broken', 'Piano_Question_Answer', 'Pop_Ballad_158_Sweep', 'Piano_Wide_Color_Motion', 'Ambient_Pad_Breath', 'Low_Pedal_Color_Wash', 'Soft_Guitar_Pluck_8ths', 'Ambient_Reverse_Swell'], forbiddenTextureCases: ['Pop_Wave_16ths', 'Pop_Anthem_Pulse'] },
];

const LOFI_GROOVES: GrooveContract[] = [
  { id: 'lofi_soul_boombap', name: 'LOFI slow soul Boom-bap', style: 'LOFI', weight: 6, grid: 'straight', density: 'medium', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [0, 3], chordPocketMs: [2, 10], melodyStrongPocketMs: [0, 3], melodyWeakPocketMs: [3, 10], velocityHumanize: 0.08, accentPattern: [1, 0.86, 0.98, 0.84], articulation: 'legato', drum: DRUM_808_LOFI, bassPattern: 'lofi_soul_sparse', preferredTextureCases: ['Piano_CommonTone_Soft_Roll', 'Piano_Lofi_Late_Chord_Answer', 'Piano_Lofi_OneShot_Space'], allowedTextureCases: ['Piano_Lofi_Dusty_Chops', 'Piano_CommonTone_Soft_Roll', 'Piano_Lofi_Late_Chord_Answer', 'Piano_Lofi_OneShot_Space', 'Piano_HalfTime_Soft_Pulse'], forbiddenTextureCases: ['Piano_Wide_Color_Motion'] },
  { id: 'lofi_lazy_dilla', name: 'LOFI lazy Dilla pocket', style: 'LOFI', weight: 0.01, grid: 'dilla', density: 'medium', compSwingRatio: 0.58, rhythmSwingSource: 'straight-sixteenths', melodySwingRatio: 0.54, bassPocketMs: [-2, 5], chordPocketMs: [4, 20], melodyStrongPocketMs: [0, 5], melodyWeakPocketMs: [4, 18], velocityHumanize: 0.12, accentPattern: [0.96, 0.88, 0.94, 0.86], articulation: 'legato', drum: DRUM_808_LOFI, bassPattern: 'lofi_dilla_sparse', preferredTextureCases: ['Piano_Lofi_Dusty_Chops', 'Piano_CommonTone_Soft_Roll', 'Piano_Lofi_Late_Chord_Answer'], allowedTextureCases: ['Piano_Lofi_Dusty_Chops', 'Piano_CommonTone_Soft_Roll', 'Piano_Lofi_Late_Chord_Answer', 'Piano_HalfTime_Soft_Pulse', 'Piano_Lofi_Tape_Wobble_Arp'], forbiddenTextureCases: ['Piano_Wide_Color_Motion'] },
  { id: 'lofi_tape_late_chords', name: 'LOFI dusty Dilla chord answers', style: 'LOFI', weight: 2, grid: 'dilla', density: 'sparse', compSwingRatio: 0.58, rhythmSwingSource: 'straight-sixteenths', melodySwingRatio: 0.54, bassPocketMs: [-2, 5], chordPocketMs: [6, 20], melodyStrongPocketMs: [0, 4], melodyWeakPocketMs: [6, 18], velocityHumanize: 0.13, accentPattern: [0.96, 0.86, 0.94, 0.84], articulation: 'legato', drum: DRUM_808_LOFI_DUSTY, bassPattern: 'lofi_dilla_sparse', preferredTextureCases: ['Piano_Lofi_Late_Chord_Answer', 'Piano_Ambient_Sustain_Wash', 'Piano_Lofi_OneShot_Space'], allowedTextureCases: ['Piano_Lofi_Late_Chord_Answer', 'Piano_Ambient_Sustain_Wash', 'Piano_Lofi_OneShot_Space', 'Piano_CommonTone_Soft_Roll', 'Piano_Wide_Color_Motion'], forbiddenTextureCases: ['Piano_Lofi_Dusty_Chops'] },
  { id: 'lofi_halftime_dusty', name: 'LOFI half-time soul pulse', style: 'LOFI', weight: 1.2, grid: 'straight', density: 'sparse', compSwingRatio: 0.52, rhythmSwingSource: 'straight-eighths', melodySwingRatio: 0.51, bassPocketMs: [0, 4], chordPocketMs: [4, 14], melodyStrongPocketMs: [0, 4], melodyWeakPocketMs: [4, 12], velocityHumanize: 0.1, accentPattern: [0.98, 0.84, 0.94, 0.82], articulation: 'legato', drum: DRUM_808_LOFI_HALFTIME, bassPattern: 'lofi_halftime_hold', preferredTextureCases: ['Piano_HalfTime_Soft_Pulse', 'Piano_Emo_Broken_10th', 'Piano_Lofi_Tape_Wobble_Arp'], allowedTextureCases: ['Piano_HalfTime_Soft_Pulse', 'Piano_Emo_Broken_10th', 'Piano_Lofi_Tape_Wobble_Arp', 'Piano_Lofi_OneShot_Space', 'Piano_Ambient_Sustain_Wash'], forbiddenTextureCases: ['Piano_Wide_Color_Motion'] },
  { id: 'lofi_ambient_study', name: 'LOFI ambient study Boom-bap', style: 'LOFI', weight: 0.8, grid: 'straight', density: 'sparse', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [0, 3], chordPocketMs: [4, 14], melodyStrongPocketMs: [0, 3], melodyWeakPocketMs: [3, 10], velocityHumanize: 0.07, accentPattern: [0.98, 0.84, 0.94, 0.82], articulation: 'legato', drum: DRUM_808_LOFI, bassPattern: 'lofi_ambient_pedal', preferredTextureCases: ['Piano_Ambient_Sustain_Wash', 'Piano_CommonTone_Soft_Roll', 'Piano_Lofi_OneShot_Space'], allowedTextureCases: ['Piano_Ambient_Sustain_Wash', 'Piano_CommonTone_Soft_Roll', 'Piano_Lofi_OneShot_Space', 'Piano_Lofi_Late_Chord_Answer'], forbiddenTextureCases: ['Piano_Wide_Color_Motion', 'Piano_Lofi_Dusty_Chops'] },
];

const RNB_GROOVES: GrooveContract[] = [
  { id: 'rnb_neo_soul_laidback', name: 'RNB neo-soul laid-back pocket', style: 'RNB', weight: 4, grid: 'dilla', density: 'medium', compSwingRatio: 0.56, rhythmSwingSource: 'straight-sixteenths', melodySwingRatio: 0.53, bassPocketMs: [-1, 5], chordPocketMs: [4, 18], melodyStrongPocketMs: [0, 5], melodyWeakPocketMs: [6, 22], velocityHumanize: 0.10, accentPattern: [0.98, 0.9, 1.0, 0.88], articulation: 'legato', drum: DRUM_808_RNB, bassPattern: 'rnb_neo_soul_sparse', preferredTextureCases: ['RnB_Drop2_Color_Answer', 'RnB_Quartal_Breath_Roll', 'RnB_Neo_Soul_Roll', 'RnB_Laid_Back_Groove', 'Pop_Rnb_Expensive_Add9_Quartal'], allowedTextureCases: ['RnB_Drop2_Color_Answer', 'RnB_Quartal_Breath_Roll', 'RnB_InnerTight_Wide_Color', 'RnB_Neo_Soul_Roll', 'RnB_Laid_Back_Groove', 'Pop_Rnb_Expensive_Add9_Quartal', 'Piano_Question_Answer', 'Low_Pedal_Color_Wash'], forbiddenTextureCases: ['RnB_16th_Funk_Stabs'] },
  { id: 'rnb_dilla_pocket', name: 'RNB Dilla pocket', style: 'RNB', weight: 3, grid: 'dilla', density: 'active', compSwingRatio: 0.58, rhythmSwingSource: 'straight-sixteenths', melodySwingRatio: 0.54, bassPocketMs: [-2, 6], chordPocketMs: [6, 22], melodyStrongPocketMs: [0, 4], melodyWeakPocketMs: [8, 24], velocityHumanize: 0.12, accentPattern: [0.96, 0.9, 1.0, 0.88], articulation: 'legato', drum: DRUM_808_DILLA, bassPattern: 'dilla_pocket', preferredTextureCases: ['RnB_Quartal_Breath_Roll', 'RnB_Drop2_Color_Answer', 'RnB_Laid_Back_Groove', 'RnB_Neo_Soul_Roll'], allowedTextureCases: ['RnB_Quartal_Breath_Roll', 'RnB_Drop2_Color_Answer', 'RnB_InnerTight_Wide_Color', 'RnB_Laid_Back_Groove', 'RnB_Neo_Soul_Roll', 'Pop_Rnb_Expensive_Add9_Quartal', 'Piano_Question_Answer'], forbiddenTextureCases: ['RnB_16th_Funk_Stabs', 'HalfTime_Emotional_Pulse'] },
  { id: 'rnb_gospel_triplet', name: 'RNB gospel triplet pulse', style: 'RNB', weight: 2, grid: 'shuffle', density: 'active', compSwingRatio: 0.66, rhythmSwingSource: 'authored', melodySwingRatio: 0.66, bassPocketMs: [0, 4], chordPocketMs: [0, 10], melodyStrongPocketMs: [0, 4], melodyWeakPocketMs: [3, 12], velocityHumanize: 0.09, accentPattern: [1.0, 0.92, 1.04, 0.9], articulation: 'legato', drum: DRUM_RNB_GOSPEL, bassPattern: 'rnb_gospel_triplet', preferredTextureCases: ['RnB_Gospel_Triplets', 'RnB_Drop2_Color_Answer', 'RnB_Neo_Soul_Roll'], allowedTextureCases: ['RnB_Gospel_Triplets', 'RnB_Drop2_Color_Answer', 'RnB_InnerTight_Wide_Color', 'RnB_Neo_Soul_Roll', 'Piano_Question_Answer'] },
  { id: 'rnb_motown_backbeat', name: 'RNB Motown backbeat', style: 'RNB', weight: 1.5, grid: 'straight', density: 'active', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [0, 3], chordPocketMs: [0, 6], melodyStrongPocketMs: [0, 3], melodyWeakPocketMs: [0, 8], velocityHumanize: 0.06, accentPattern: [1.0, 0.94, 1.02, 0.94], articulation: 'short', drum: DRUM_RNB_MOTOWN, bassPattern: 'rnb_motown_syncopated', preferredTextureCases: ['RnB_16th_Funk_Stabs', 'RnB_Classic_Soul_Arp', 'RnB_Drop2_Color_Answer'], allowedTextureCases: ['RnB_16th_Funk_Stabs', 'RnB_Classic_Soul_Arp', 'RnB_Drop2_Color_Answer', 'Soft_Guitar_Pluck_8ths'] },
  { id: 'rnb_trap_soul_halftime', name: 'RNB trap-soul half-time', style: 'RNB', weight: 1.5, grid: 'straight', density: 'sparse', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [0, 4], chordPocketMs: [2, 14], melodyStrongPocketMs: [0, 5], melodyWeakPocketMs: [4, 16], velocityHumanize: 0.08, accentPattern: [0.98, 0.86, 1.0, 0.84], articulation: 'legato', drum: DRUM_808_TRAP, bassPattern: 'rnb_trap_soul_halftime', preferredTextureCases: ['RnB_InnerTight_Wide_Color', 'HalfTime_Emotional_Pulse', 'Low_Pedal_Color_Wash', 'Pop_Rnb_Expensive_Add9_Quartal'], allowedTextureCases: ['RnB_InnerTight_Wide_Color', 'RnB_Drop2_Color_Answer', 'HalfTime_Emotional_Pulse', 'Low_Pedal_Color_Wash', 'Pop_Rnb_Expensive_Add9_Quartal', 'Ambient_Reverse_Swell'] },
];

const JAZZ_GROOVES: GrooveContract[] = [
  {
    id: 'jazz_take_five_5_4',
    name: 'JAZZ 5/4 · 3+2 piano interlock',
    style: 'JAZZ',
    // Extracted from Take-Five-1.mid (SHA-256
    // 2af0225ca50206087922b71ca81382f37f349e79259859c4b2b7911b673473d1).
    // The contract owns the metric clock only. Role-specific onsets live in
    // roleRhythmPatterns and are materialized by Arranger.
    // The ordinary Jazz product selector is archetype-based and currently
    // keeps this entry internal; pool weight therefore remains schema-valid.
    weight: 1,
    meter: { numerator: 5, denominator: 4 },
    beatGrouping: [3, 2],
    barOriginPolicy: 'song-global',
    phaseLanes: [
      { id: 'quarter', offset: { numerator: 0, denominator: 1 }, postSwing: false },
      { id: 'triplet-late', offset: { numerator: 2, denominator: 3 }, postSwing: false },
      { id: 'authored-61-96', offset: { numerator: 61, denominator: 96 }, postSwing: false },
      { id: 'development-5-8', offset: { numerator: 5, denominator: 8 }, postSwing: false },
      { id: 'straight-sixteenth', offset: { numerator: 1, denominator: 4 }, postSwing: false },
      { id: 'lead-thirtieth-bar-cell', offset: { numerator: 1, denominator: 6 }, postSwing: false },
    ],
    // Source tempo meta event: 359281 microseconds per quarter.
    tempoBpm: 60_000_000 / 359_281,
    tempoRange: 0,
    grid: 'swing',
    density: 'medium',
    rhythmProfile: 'jazz-five-four-triplet',
    // Generic swing feel remains distinct from authored clock coordinates.
    // The recurring 61/96 piano phase lives in phaseLanes and role KB, never
    // overloaded into this broad feel ratio. Authored material bypasses it.
    compSwingRatio: 2 / 3,
    rhythmSwingSource: 'authored',
    melodySwingRatio: 2 / 3,
    // The first audition keeps the authored metric cell exact. Performance
    // variation belongs above this nominal score, never in the clock itself.
    bassPocketMs: [0, 0],
    chordPocketMs: [0, 0],
    melodyStrongPocketMs: [0, 3],
    melodyWeakPocketMs: [0, 8],
    velocityHumanize: 0,
    accentPattern: [1, 0.68, 0.76, 0.94, 0.82],
    articulation: 'bebop',
    drum: DRUM_JAZZ_SWING,
    bassPattern: 'bass.jazz-five-four-ostinato.v1',
    preferredTextureCases: ['Jazz_Drop_2_Comp'],
    allowedTextureCases: ['Jazz_Drop_2_Comp'],
  },
  { id: 'jazz_combo_swing', name: 'JAZZ combo ride swing', style: 'JAZZ', weight: 4, meter: { numerator: 4, denominator: 4 }, beatGrouping: [4], tempoBpm: 132, tempoRange: 56, grid: 'swing', density: 'medium', compSwingRatio: 0.66, swingCurve: 'jazz-tempo', melodySwingRatio: 0.67, bassPocketMs: [0, 4], chordPocketMs: [0, 10], melodyStrongPocketMs: [0, 3], melodyWeakPocketMs: [0, 8], velocityHumanize: 0.08, accentPattern: [1.0, 0.85, 1.05, 0.85], articulation: 'bebop', drum: DRUM_JAZZ_SWING, preferredTextureCases: ['Jazz_Drop_2_Comp', 'Jazz_Charleston_Comp', 'Jazz_Red_Garland_Block'], allowedTextureCases: ['Jazz_Drop_2_Comp', 'Jazz_Charleston_Comp', 'Jazz_Red_Garland_Block', 'Piano_Question_Answer'], forbiddenTextureCases: ['Ambient_Pad_Breath'] },
  { id: 'jazz_smooth_backbeat', name: 'JAZZ smooth backbeat', style: 'JAZZ', weight: 1.5, meter: { numerator: 4, denominator: 4 }, beatGrouping: [4], tempoBpm: 108, tempoRange: 18, grid: 'straight', density: 'medium', compSwingRatio: 0.52, melodySwingRatio: 0.52, bassPocketMs: [-1, 5], chordPocketMs: [2, 12], melodyStrongPocketMs: [0, 4], melodyWeakPocketMs: [4, 14], velocityHumanize: 0.08, accentPattern: [0.98, 0.9, 1.02, 0.9], articulation: 'legato', drum: DRUM_SMOOTH_JAZZ, preferredTextureCases: ['Jazz_Drop_2_Comp', 'Piano_Question_Answer', 'RnB_Drop2_Color_Answer'], allowedTextureCases: ['Jazz_Drop_2_Comp', 'Piano_Question_Answer', 'Jazz_Red_Garland_Block', 'RnB_Drop2_Color_Answer', 'RnB_Neo_Soul_Roll', 'Pop_Rnb_Expensive_Add9_Quartal'], forbiddenTextureCases: ['RnB_16th_Funk_Stabs', 'Ambient_Reverse_Swell'] },
  { id: 'jazz_medium_swing', name: 'JAZZ medium swing', style: 'JAZZ', weight: 4, meter: { numerator: 4, denominator: 4 }, beatGrouping: [4], tempoBpm: 132, tempoRange: 24, grid: 'swing', density: 'medium', compSwingRatio: 0.66, swingCurve: 'jazz-tempo', melodySwingRatio: 0.67, bassPocketMs: [0, 4], chordPocketMs: [0, 10], melodyStrongPocketMs: [0, 3], melodyWeakPocketMs: [0, 8], velocityHumanize: 0.08, accentPattern: [1.0, 0.85, 1.05, 0.85], articulation: 'bebop', drum: DRUM_JAZZ_SWING, preferredTextureCases: ['Jazz_Drop_2_Comp', 'Jazz_Charleston_Comp', 'Jazz_Red_Garland_Block'], allowedTextureCases: ['Jazz_Drop_2_Comp', 'Jazz_Charleston_Comp', 'Jazz_Red_Garland_Block', 'Piano_Question_Answer'], forbiddenTextureCases: ['Ambient_Pad_Breath'] },
  { id: 'jazz_ballad_loose', name: 'JAZZ ballad loose swing', style: 'JAZZ', weight: 2, meter: { numerator: 4, denominator: 4 }, beatGrouping: [4], tempoBpm: 72, tempoRange: 12, grid: 'swing', density: 'sparse', compSwingRatio: 0.58, swingCurve: 'jazz-tempo', melodySwingRatio: 0.56, bassPocketMs: [0, 6], chordPocketMs: [4, 18], melodyStrongPocketMs: [0, 6], melodyWeakPocketMs: [4, 16], velocityHumanize: 0.10, accentPattern: [0.98, 0.84, 1.02, 0.84], articulation: 'ballad', drum: DRUM_JAZZ_BALLAD, preferredTextureCases: ['Jazz_Drop_2_Comp', 'Piano_Question_Answer', 'Ambient_Pad_Breath'], allowedTextureCases: ['Jazz_Drop_2_Comp', 'Piano_Question_Answer', 'Ambient_Pad_Breath', 'Jazz_Red_Garland_Block'], forbiddenTextureCases: ['Jazz_Charleston_Comp'] },
  { id: 'jazz_bossa_straight_latin', name: 'JAZZ bossa straight latin', style: 'JAZZ', weight: 2, meter: { numerator: 4, denominator: 4 }, beatGrouping: [4], tempoBpm: 126, tempoRange: 18, grid: 'straight', density: 'medium', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [0, 3], chordPocketMs: [0, 8], melodyStrongPocketMs: [0, 4], melodyWeakPocketMs: [0, 8], velocityHumanize: 0.07, accentPattern: [1.0, 0.88, 0.98, 0.88], articulation: 'legato', drum: DRUM_JAZZ_BOSSA, preferredTextureCases: ['Bossa_Piano_Arp'], allowedTextureCases: ['Bossa_Piano_Arp', 'Jazz_Drop_2_Comp'] },
];

/** 首轮 4/4 Jazz 调教基线；其他 4/4 contracts 暂留 KB，不进入产品 archetype 选择。 */
export const JAZZ_4_4_GROOVE_CONTRACT = JAZZ_GROOVES.find((contract) => contract.id === 'jazz_combo_swing')!;

/** MIDI-derived 5/4 clock. Ordinary Jazz does not select it without its archetype. */
export const JAZZ_5_4_GROOVE_CONTRACT = JAZZ_GROOVES.find((contract) => contract.id === 'jazz_take_five_5_4')!;

const ACG_GROOVES: GrooveContract[] = [
  { id: 'acg_hisaishi_rubato_arp', name: 'ACG Hisaishi rubato arpeggio', style: 'ACG', weight: 4, grid: 'rubato', density: 'medium', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [-1, 4], chordPocketMs: [0, 18], melodyStrongPocketMs: [0, 8], melodyWeakPocketMs: [4, 18], velocityHumanize: 0.09, accentPattern: [1.0, 0.9, 0.96, 0.88], articulation: 'ballad', drum: DRUM_ACG_ROOM, preferredTextureCases: ['Piano_TopVoice_Planing', 'ACG_Quartal_Arp_Wave', 'ACG_Open_Broken_10th', 'ACG_Stride_Cantabile_Ballad'], allowedTextureCases: ['Piano_TopVoice_Planing', 'ACG_Quartal_Arp_Wave', 'ACG_Open_Broken_10th', 'ACG_Sakamoto_LH_Arp_RH_Penta', 'ACG_Ostinato_Hook_Pulse', 'ACG_Stride_Cantabile_Ballad', 'ACG_Anthem_Block_Push', 'ACG_Pedal_Wash_Color_Drops', 'ACG_Suspended_Block_Arrival', 'ACG_Bass_Tremolo_Color'] },
  { id: 'acg_planing_wash', name: 'ACG planing color wash', style: 'ACG', weight: 2.5, grid: 'rubato', density: 'sparse', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [-1, 4], chordPocketMs: [4, 22], melodyStrongPocketMs: [0, 10], melodyWeakPocketMs: [6, 22], velocityHumanize: 0.10, accentPattern: [0.96, 0.86, 0.92, 0.84], articulation: 'ballad', drum: DRUM_ACG_ROOM, preferredTextureCases: ['Piano_TopVoice_Planing', 'ACG_Pedal_Wash_Color_Drops', 'ACG_Sakamoto_LH_Arp_RH_Penta', 'ACG_Stride_Cantabile_Ballad'], allowedTextureCases: ['Piano_TopVoice_Planing', 'ACG_Pedal_Wash_Color_Drops', 'ACG_Sakamoto_LH_Arp_RH_Penta', 'ACG_Ostinato_Hook_Pulse', 'ACG_Stride_Cantabile_Ballad', 'ACG_Anthem_Block_Push', 'ACG_Open_Broken_10th', 'ACG_Quartal_Arp_Wave', 'ACG_Suspended_Block_Arrival', 'ACG_Bass_Tremolo_Color'] },
  { id: 'acg_jpop_456_drive', name: 'ACG/JPOP 4-5-6 drive', style: 'ACG', weight: 2.5, grid: 'straight', density: 'active', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [0, 3], chordPocketMs: [0, 8], melodyStrongPocketMs: [-4, 3], melodyWeakPocketMs: [-2, 8], velocityHumanize: 0.06, accentPattern: [1.02, 0.9, 1.0, 0.9], articulation: 'legato', drum: DRUM_ACG_ROOM, preferredTextureCases: ['ACG_Ostinato_Hook_Pulse', 'ACG_Anthem_Block_Push', 'ACG_Bass_Tremolo_Color', 'ACG_Quartal_Arp_Wave', 'ACG_Suspended_Block_Arrival'], allowedTextureCases: ['ACG_Ostinato_Hook_Pulse', 'ACG_Anthem_Block_Push', 'ACG_Bass_Tremolo_Color', 'ACG_Quartal_Arp_Wave', 'ACG_Suspended_Block_Arrival', 'ACG_Open_Broken_10th', 'Piano_TopVoice_Planing', 'ACG_Sakamoto_LH_Arp_RH_Penta', 'ACG_Stride_Cantabile_Ballad', 'ACG_Pedal_Wash_Color_Drops'] },
];

export const GROOVE_CONTRACT_POOL: GrooveContract[] = [...POP_GROOVES, ...LOFI_GROOVES, ...RNB_GROOVES, ...JAZZ_GROOVES, ...ACG_GROOVES];

const RHYTHM_PROFILE_BY_CONTRACT_ID: Readonly<Record<string, GrooveRhythmProfileId>> = {
  pop_radio_straight: 'pop-straight',
  pop_citypop_boogie: 'pop-straight',
  pop_jpop_push_8ths: 'pop-straight',
  pop_ballad_halftime: 'pop-ballad',
  lofi_lazy_dilla: 'lofi-pocket',
  lofi_soul_boombap: 'lofi-pocket',
  lofi_tape_late_chords: 'lofi-pocket',
  lofi_halftime_dusty: 'lofi-pocket',
  lofi_ambient_study: 'lofi-pocket',
  rnb_neo_soul_laidback: 'rnb-sixteenth',
  rnb_dilla_pocket: 'rnb-sixteenth',
  rnb_gospel_triplet: 'rnb-triplet',
  rnb_motown_backbeat: 'pop-straight',
  rnb_trap_soul_halftime: 'rnb-sixteenth',
  jazz_combo_swing: 'jazz-swing',
  jazz_take_five_5_4: 'jazz-five-four-triplet',
  jazz_smooth_backbeat: 'rnb-sixteenth',
  jazz_medium_swing: 'jazz-swing',
  jazz_ballad_loose: 'jazz-swing',
  jazz_bossa_straight_latin: 'jazz-bossa',
  acg_hisaishi_rubato_arp: 'rubato-four',
  acg_planing_wash: 'rubato-four',
  acg_jpop_456_drive: 'pop-straight',
};

/** Resolve the contract's phrase/transition vocabulary inside KB, never in Arranger. */
export function grooveRhythmProfileForContract(contract: Pick<GrooveContract, 'id' | 'rhythmProfile'>): GrooveRhythmProfile {
  const profileId = contract.rhythmProfile ?? RHYTHM_PROFILE_BY_CONTRACT_ID[contract.id] ?? 'pop-straight';
  return GROOVE_RHYTHM_PROFILES[profileId];
}

/** 该 style 的 contract pool(空 → 回退 POP)。 */
export function grooveContractsForStyle(style: GrooveStyleName): GrooveContract[] {
  const pool = GROOVE_CONTRACT_POOL.filter((c) => c.style === style);
  return pool.length > 0 ? pool : POP_GROOVES;
}

/** 按 weight 加权挑一条 contract(确定性:random.next() ∈ [0,1))。 */
export function pickGrooveContract(style: GrooveStyleName, random: PickerRandom): GrooveContract {
  const pool = grooveContractsForStyle(style);
  const total = pool.reduce((s, c) => s + Math.max(0, c.weight), 0);
  let roll = random.next() * total;
  for (const c of pool) { roll -= Math.max(0, c.weight); if (roll <= 0) return c; }
  return pool[pool.length - 1];
}

/** id → contract(查询/派生用;未知 → undefined)。 */
export function grooveContractById(id: string): GrooveContract | undefined {
  return GROOVE_CONTRACT_POOL.find((c) => c.id === id);
}

/** contract 对某 texture 的兼容/偏好打分(0=不允许/被禁;>0=允许,preferred/grid/density 加分)。 */
export function grooveTextureScore(contract: GrooveContract, texture: Pick<TextureProfile, 'textureCase' | 'mood'>): number {
  if (contract.allowedTextureCases && !contract.allowedTextureCases.includes(texture.textureCase)) return 0;
  if (contract.forbiddenTextureCases?.includes(texture.textureCase)) return 0;
  let score = 1;
  if (contract.preferredTextureCases?.includes(texture.textureCase)) score += 3;
  if (contract.density === 'sparse' && (texture.mood === 'ambient' || texture.mood === 'lyrical')) score += 1;
  if (contract.density === 'active' && (texture.mood === 'drive' || texture.mood === 'groove' || texture.mood === 'pocket')) score += 1;
  if (contract.grid === 'dilla' && texture.mood === 'pocket') score += 1;
  if (contract.grid === 'rubato' && (texture.mood === 'ambient' || texture.mood === 'lyrical')) score += 1;
  return score;
}

/** 据 contract 加权挑一条 texture(score>0 才入池)。无可用 → null。 */
export function pickGrooveTexture(textures: readonly TextureProfile[], contract: GrooveContract, random: PickerRandom): TextureProfile | null {
  const scored = textures.map((t) => ({ texture: t, score: grooveTextureScore(contract, t) })).filter((x) => x.score > 0);
  if (scored.length === 0) return null;
  const total = scored.reduce((s, x) => s + x.score, 0);
  let roll = random.next() * total;
  for (const x of scored) { roll -= x.score; if (roll <= 0) return x.texture; }
  return scored[scored.length - 1].texture;
}
