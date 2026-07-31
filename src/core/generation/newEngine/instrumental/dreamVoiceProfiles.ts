// ============================================================
// newEngine · instrumental · Dream 5504 voice profiles
// ------------------------------------------------------------
// GMBK5X128 has two different address spaces:
// - modern GM: CC0 0..40 + Program Change (128 capitals + 141 variations)
// - MT-32 compatibility: CC0 127 + Program Change
//
// Only the modern GM space belongs in automatic orchestration.  A profile is
// keyed by the complete hardware address, never by Program Change alone.
// This registry classifies physical playing behaviour; it deliberately does
// not select a style palette or invent per-preset CC curves.
// ============================================================

import type { InstrumentRoleName } from '../band/BandSpec';
import {
  GM128_DRUM_KITS,
  GM128_MAIN_PROGRAMS,
  GM128_VARIATION_PROGRAMS,
  type GM128CatalogItem,
  type GM128CatalogSource,
} from '../../../sound/GMBK5X128Catalog';

export type DreamVoiceFamily =
  | 'acoustic-piano'
  | 'electric-piano'
  | 'acoustic-keyed-pluck'
  | 'electric-keyed-pluck'
  | 'mallet'
  | 'electric-organ'
  | 'free-reed'
  | 'acoustic-guitar'
  | 'electric-guitar'
  | 'guitar-harmonics'
  | 'acoustic-bass'
  | 'electric-bass'
  | 'synth-bass'
  | 'organ-bass'
  | 'bowed-string'
  | 'plucked-string'
  | 'orchestral-percussion'
  | 'ensemble-string'
  | 'choir-voice'
  | 'brass'
  | 'saxophone'
  | 'reed-woodwind'
  | 'flute-woodwind'
  | 'synth-lead'
  | 'synth-pad'
  | 'synth-texture'
  | 'world-plucked'
  | 'world-wind'
  | 'world-bowed'
  | 'pitched-percussion'
  | 'sfx'
  | 'drum-kit';

/** The top-level player/gesture family used by orchestration and future CC lanes. */
export type DreamPerformanceFamily =
  | 'keyboard'
  | 'mallet'
  | 'free-reed'
  | 'guitar'
  | 'plucked-string'
  | 'bass'
  | 'bowed-string'
  | 'wind'
  | 'synth'
  | 'voice'
  | 'percussion'
  | 'effect';

/** A concrete subfamily whose notes, continuity and CC policy can be audited together. */
export type DreamPerformanceSubfamily =
  | 'acoustic-piano'
  | 'electric-piano'
  | 'acoustic-keyed-pluck'
  | 'electric-keyed-pluck'
  | 'vibraphone'
  | 'mallet-strike'
  | 'electric-organ'
  | 'free-reed'
  | 'acoustic-guitar'
  | 'electric-guitar'
  | 'guitar-harmonics'
  | 'acoustic-bass'
  | 'electric-bass'
  | 'synth-bass'
  | 'organ-bass'
  | 'bowed-solo-string'
  | 'bowed-ensemble-string'
  | 'plucked-orchestral-string'
  | 'brass'
  | 'saxophone'
  | 'reed-woodwind'
  | 'flute-woodwind'
  | 'synth-lead'
  | 'synth-pad'
  | 'synth-texture'
  | 'choir-voice'
  | 'world-plucked'
  | 'world-wind'
  | 'world-bowed'
  | 'pitched-percussion'
  | 'orchestral-percussion'
  | 'drum-kit'
  | 'sfx';

/** 一级：由真实演奏动作决定，先于音色名称与 GM Program。 */
export type DreamPlayingMechanism =
  | 'keybed'
  | 'bellows-keybed'
  | 'blown-wind'
  | 'plucked-string'
  | 'bowed-string'
  | 'struck'
  | 'drum-kit'
  | 'effect';

/**
 * 二级：同一演奏机制下的乐器类别。这里区分原声、电声与合成器的
 * 乐器身份；不能仅因都由 MIDI 键盘触发就共用日后的 CC 合同。
 */
export type DreamInstrumentClass =
  | 'acoustic-piano'
  | 'electric-piano'
  | 'synth-keyboard'
  | 'acoustic-keyed-pluck'
  | 'electric-keyed-pluck'
  | 'electric-organ'
  | 'accordion'
  | 'harmonica'
  | 'vibraphone'
  | 'mallet-percussion'
  | 'acoustic-guitar'
  | 'electric-guitar'
  | 'acoustic-guitar-harmonics'
  | 'electric-guitar-harmonics'
  | 'acoustic-bass'
  | 'electric-bass'
  | 'synth-bass'
  | 'organ-bass'
  | 'bowed-solo-string'
  | 'bowed-ensemble-string'
  | 'orchestral-plucked-string'
  | 'harp'
  | 'world-plucked-string'
  | 'thumb-piano'
  | 'brass'
  | 'saxophone'
  | 'single-reed-woodwind'
  | 'double-reed-woodwind'
  | 'air-reed-woodwind'
  | 'bagpipe'
  | 'world-double-reed'
  | 'choir-voice'
  | 'pitched-percussion'
  | 'orchestral-percussion'
  | 'drum-kit'
  | 'effect';

/** 原生/电声/合成来源是二级分类的必要属性，不是混音标签。 */
export type DreamSoundSource = 'acoustic' | 'electric' | 'synth' | 'hybrid' | 'effect';

/**
 * Small, reusable controller-policy vocabulary. This is deliberately broader
 * than the catalog identity: one contract is the future CC dispatch boundary,
 * while instrumentClass / gestureSubfamily retain the detail needed for
 * palette search and later note-level gesture work.
 *
 * A contract is not CC permission. `dreamCcCapabilities` remains the only
 * authorization source for a generated controller event.
 */
export type DreamCcExpressionContract =
  | 'piano-damper'
  | 'continuous-acoustic'
  | 'keyed-sustain'
  | 'electronic-keybed'
  | 'plucked-struck'
  | 'drum';

export const DREAM_CC_EXPRESSION_CONTRACTS = [
  'piano-damper',
  'continuous-acoustic',
  'keyed-sustain',
  'electronic-keybed',
  'plucked-struck',
  'drum',
] as const satisfies readonly DreamCcExpressionContract[];

/** Future CC lanes attach to this physical playing behaviour, not to a GM number. */
export type DreamExpressionFamily =
  | 'piano-damper'
  | 'electric-keyboard'
  | 'plucked-keyboard'
  | 'mallet-damper'
  | 'mallet-strike'
  | 'organ-sustain'
  | 'free-reed-sustain'
  | 'guitar-pluck'
  | 'bass-pluck'
  | 'synth-bass'
  | 'bowed-string'
  | 'plucked-string'
  | 'brass-air'
  | 'sax-air'
  | 'woodwind-air'
  | 'synth-lead'
  | 'synth-pad'
  | 'pitched-percussion'
  | 'sfx'
  | 'drum-kit';

/** Catalog identity describes the source sound; gesture identity describes how it may be performed. */
export type DreamGestureFamily =
  | 'keybed'
  | 'mallet'
  | 'fretted-string'
  | 'bass-string'
  | 'bowed-string'
  | 'orchestral-pluck'
  | 'wind'
  | 'synth'
  | 'voice'
  | 'percussion'
  | 'drum'
  | 'effect';

/**
 * The smallest reusable performance contract. A subfamily is shared only
 * when its note connection, tail, and safe controller policy can be shared.
 * This is deliberately independent from acoustic/electric/synth catalog names.
 */
export type DreamGestureSubfamily =
  | 'hammered-piano-damper'
  | 'electric-piano-keybed'
  | 'keyed-pluck'
  | 'organ-keyhold'
  | 'accordion-bellows-keyhold'
  | 'harmonica-breath'
  | 'vibraphone-damper'
  | 'mallet-strike'
  | 'fretted-pluck'
  | 'fretted-muted'
  | 'fretted-slide'
  | 'guitar-harmonics'
  | 'bass-fingered-pluck'
  | 'bass-picked-pluck'
  | 'bass-slap'
  | 'bass-synth'
  | 'bass-organ-sustain'
  | 'bowed-solo-string'
  | 'bowed-contrabass'
  | 'bowed-ensemble-string'
  | 'bowed-tremolo-ensemble'
  | 'bowed-slow-ensemble'
  | 'orchestral-pizzicato'
  | 'harp-pluck'
  | 'world-plucked-string'
  | 'thumb-pluck'
  | 'brass-breath'
  | 'sax-breath'
  | 'single-reed-breath'
  | 'double-reed-breath'
  | 'flute-breath'
  | 'world-double-reed-breath'
  | 'bagpipe-drone'
  | 'synth-lead-keybed'
  | 'synth-pad-sustain'
  | 'choir-sustain'
  | 'pitched-strike'
  | 'score-percussion'
  | 'drum-acoustic-kit'
  | 'drum-electronic-kit'
  | 'drum-808-kit'
  | 'drum-jazz-kit'
  | 'drum-brush-kit'
  | 'drum-orchestral-kit'
  | 'drum-sfx-kit'
  | 'drum-cm-kit'
  | 'effect-event';

/**
 * Runtime-complete vocabulary for classification audit. Every declared
 * subfamily must have at least one shipped GMBK address; see the registry test.
 * This is taxonomy only. It makes no assertion about CC or rendered gestures.
 */
export const DREAM_GESTURE_SUBFAMILIES = [
  'hammered-piano-damper', 'electric-piano-keybed', 'keyed-pluck', 'organ-keyhold',
  'accordion-bellows-keyhold', 'harmonica-breath', 'vibraphone-damper', 'mallet-strike',
  'fretted-pluck', 'fretted-muted', 'fretted-slide', 'guitar-harmonics',
  'bass-fingered-pluck', 'bass-picked-pluck', 'bass-slap', 'bass-synth', 'bass-organ-sustain',
  'bowed-solo-string', 'bowed-contrabass', 'bowed-ensemble-string', 'bowed-tremolo-ensemble', 'bowed-slow-ensemble',
  'orchestral-pizzicato', 'harp-pluck', 'world-plucked-string', 'thumb-pluck',
  'brass-breath', 'sax-breath', 'single-reed-breath', 'double-reed-breath', 'flute-breath',
  'world-double-reed-breath', 'bagpipe-drone',
  'synth-lead-keybed', 'synth-pad-sustain', 'choir-sustain', 'pitched-strike', 'score-percussion',
  'drum-acoustic-kit', 'drum-electronic-kit', 'drum-808-kit', 'drum-jazz-kit', 'drum-brush-kit',
  'drum-orchestral-kit', 'drum-sfx-kit', 'drum-cm-kit', 'effect-event',
] as const satisfies readonly DreamGestureSubfamily[];

export type DreamVoiceMode = 'polyphonic-decay' | 'polyphonic-sustain' | 'monophonic-sustain' | 'percussive' | 'effect';
export type DreamArrangementStatus = 'available' | 'manual-only' | 'audition-only';
export type DreamVoiceAddressSpace = 'modern-gm' | 'mt32-compatibility' | 'drum-kit';

export interface DreamVoiceAddress {
  /** CC0 bank; drum kits deliberately have no melodic bank address. */
  bank?: number;
  program: number;
  role?: InstrumentRoleName;
}

export interface DreamVoiceProfile {
  address: Readonly<DreamVoiceAddress>;
  addressSpace: DreamVoiceAddressSpace;
  name: string;
  source: GM128CatalogSource;
  /** 一级：键盘、吹奏、弹拨、弓弦、击奏等真实触发机制。 */
  playingMechanism: DreamPlayingMechanism;
  /** 二级：机制之下的具体乐器类别，包含原声/电声/合成器区分。 */
  instrumentClass: DreamInstrumentClass;
  soundSource: DreamSoundSource;
  /**
   * One of six reusable CC-expression contracts. Undefined means an effect
   * event, so it must stay manual-only and cannot enter automatic CC dispatch.
   */
  ccExpressionContract: DreamCcExpressionContract | undefined;
  /**
   * Legacy grouping retained for existing callers. New palettes and UI should
   * query playingMechanism / instrumentClass instead.
   */
  family: DreamVoiceFamily;
  performanceFamily: DreamPerformanceFamily;
  performanceSubfamily: DreamPerformanceSubfamily;
  expressionFamily: DreamExpressionFamily;
  gestureFamily: DreamGestureFamily;
  gestureSubfamily: DreamGestureSubfamily;
  mode: DreamVoiceMode;
  /** Physical/renderer capability only. Style palettes decide whether to use it. */
  roleCapabilities: readonly InstrumentRoleName[];
  /** Available means safe to place in a future style palette; it is not a selection weight. */
  arrangementStatus: DreamArrangementStatus;
}

type Classification = Omit<DreamVoiceProfile, 'address' | 'addressSpace' | 'name' | 'source'>;

/**
 * Map the physical source identity to the small automatic-CC vocabulary.
 * This runs after exact CC0+Program overrides, so e.g. CC0=3/PC89 Rotary
 * String becomes continuous-acoustic rather than inheriting PC89's pad slot.
 */
function ccExpressionContractFor(
  family: DreamVoiceFamily,
  gestureSubfamily: DreamGestureSubfamily,
): DreamCcExpressionContract | undefined {
  switch (family) {
    case 'acoustic-piano':
      return 'piano-damper';
    case 'bowed-string':
    case 'ensemble-string':
    case 'world-bowed':
    case 'brass':
    case 'saxophone':
    case 'reed-woodwind':
    case 'flute-woodwind':
    case 'world-wind':
      return 'continuous-acoustic';
    case 'free-reed':
      return gestureSubfamily === 'harmonica-breath' ? 'continuous-acoustic' : 'keyed-sustain';
    case 'electric-organ':
    case 'organ-bass':
      return 'keyed-sustain';
    case 'electric-piano':
    case 'electric-keyed-pluck':
    case 'synth-bass':
    case 'synth-lead':
    case 'synth-pad':
    case 'synth-texture':
    case 'choir-voice':
      return 'electronic-keybed';
    case 'acoustic-keyed-pluck':
    case 'mallet':
    case 'acoustic-guitar':
    case 'electric-guitar':
    case 'guitar-harmonics':
    case 'acoustic-bass':
    case 'electric-bass':
    case 'plucked-string':
    case 'world-plucked':
    case 'pitched-percussion':
    case 'orchestral-percussion':
      return 'plucked-struck';
    case 'drum-kit':
      return 'drum';
    case 'sfx':
      return undefined;
  }
}

/** The user-facing orchestration hierarchy. It deliberately precedes CC design. */
function instrumentHierarchy(
  family: DreamVoiceFamily,
  gestureSubfamily: DreamGestureSubfamily,
): Pick<Classification, 'playingMechanism' | 'instrumentClass' | 'soundSource'> {
  switch (family) {
    case 'acoustic-piano': return { playingMechanism: 'keybed', instrumentClass: 'acoustic-piano', soundSource: 'acoustic' };
    case 'electric-piano': return { playingMechanism: 'keybed', instrumentClass: 'electric-piano', soundSource: 'electric' };
    case 'acoustic-keyed-pluck': return { playingMechanism: 'keybed', instrumentClass: 'acoustic-keyed-pluck', soundSource: 'acoustic' };
    case 'electric-keyed-pluck': return { playingMechanism: 'keybed', instrumentClass: 'electric-keyed-pluck', soundSource: 'electric' };
    case 'electric-organ': return { playingMechanism: 'keybed', instrumentClass: 'electric-organ', soundSource: 'electric' };
    case 'free-reed': return gestureSubfamily === 'harmonica-breath'
      ? { playingMechanism: 'blown-wind', instrumentClass: 'harmonica', soundSource: 'acoustic' }
      : { playingMechanism: 'bellows-keybed', instrumentClass: 'accordion', soundSource: 'acoustic' };
    case 'mallet': return gestureSubfamily === 'vibraphone-damper'
      ? { playingMechanism: 'struck', instrumentClass: 'vibraphone', soundSource: 'acoustic' }
      : { playingMechanism: 'struck', instrumentClass: 'mallet-percussion', soundSource: 'acoustic' };
    case 'acoustic-guitar': return { playingMechanism: 'plucked-string', instrumentClass: 'acoustic-guitar', soundSource: 'acoustic' };
    case 'electric-guitar': return { playingMechanism: 'plucked-string', instrumentClass: 'electric-guitar', soundSource: 'electric' };
    case 'guitar-harmonics': return { playingMechanism: 'plucked-string', instrumentClass: 'electric-guitar-harmonics', soundSource: 'electric' };
    case 'acoustic-bass': return { playingMechanism: 'plucked-string', instrumentClass: 'acoustic-bass', soundSource: 'acoustic' };
    case 'electric-bass': return { playingMechanism: 'plucked-string', instrumentClass: 'electric-bass', soundSource: 'electric' };
    case 'synth-bass': return { playingMechanism: 'keybed', instrumentClass: 'synth-bass', soundSource: 'synth' };
    case 'organ-bass': return { playingMechanism: 'keybed', instrumentClass: 'organ-bass', soundSource: 'electric' };
    case 'bowed-string': return { playingMechanism: 'bowed-string', instrumentClass: 'bowed-solo-string', soundSource: 'acoustic' };
    case 'ensemble-string': return { playingMechanism: 'bowed-string', instrumentClass: 'bowed-ensemble-string', soundSource: 'acoustic' };
    case 'plucked-string': return gestureSubfamily === 'harp-pluck'
      ? { playingMechanism: 'plucked-string', instrumentClass: 'harp', soundSource: 'acoustic' }
      : { playingMechanism: 'plucked-string', instrumentClass: 'orchestral-plucked-string', soundSource: 'acoustic' };
    case 'world-plucked': return gestureSubfamily === 'thumb-pluck'
      ? { playingMechanism: 'plucked-string', instrumentClass: 'thumb-piano', soundSource: 'acoustic' }
      : { playingMechanism: 'plucked-string', instrumentClass: 'world-plucked-string', soundSource: 'acoustic' };
    case 'world-bowed': return { playingMechanism: 'bowed-string', instrumentClass: 'bowed-solo-string', soundSource: 'acoustic' };
    case 'brass': return { playingMechanism: 'blown-wind', instrumentClass: 'brass', soundSource: 'acoustic' };
    case 'saxophone': return { playingMechanism: 'blown-wind', instrumentClass: 'saxophone', soundSource: 'acoustic' };
    case 'reed-woodwind': return gestureSubfamily === 'double-reed-breath'
      ? { playingMechanism: 'blown-wind', instrumentClass: 'double-reed-woodwind', soundSource: 'acoustic' }
      : { playingMechanism: 'blown-wind', instrumentClass: 'single-reed-woodwind', soundSource: 'acoustic' };
    case 'flute-woodwind': return { playingMechanism: 'blown-wind', instrumentClass: 'air-reed-woodwind', soundSource: 'acoustic' };
    case 'world-wind': return gestureSubfamily === 'bagpipe-drone'
      ? { playingMechanism: 'blown-wind', instrumentClass: 'bagpipe', soundSource: 'acoustic' }
      : { playingMechanism: 'blown-wind', instrumentClass: 'world-double-reed', soundSource: 'acoustic' };
    case 'synth-lead':
    case 'synth-pad':
    case 'synth-texture': return { playingMechanism: 'keybed', instrumentClass: 'synth-keyboard', soundSource: 'synth' };
    case 'choir-voice': return { playingMechanism: 'keybed', instrumentClass: 'choir-voice', soundSource: 'acoustic' };
    case 'pitched-percussion': return { playingMechanism: 'struck', instrumentClass: 'pitched-percussion', soundSource: 'acoustic' };
    case 'orchestral-percussion': return { playingMechanism: 'struck', instrumentClass: 'orchestral-percussion', soundSource: 'acoustic' };
    case 'drum-kit': return {
      playingMechanism: 'drum-kit', instrumentClass: 'drum-kit',
      soundSource: ['drum-electronic-kit', 'drum-808-kit', 'drum-sfx-kit', 'drum-cm-kit'].includes(gestureSubfamily) ? 'electric' : 'acoustic',
    };
    case 'sfx': return { playingMechanism: 'effect', instrumentClass: 'effect', soundSource: 'effect' };
  }
}

function performanceClassification(
  family: DreamVoiceFamily,
  expressionFamily: DreamExpressionFamily,
): Pick<Classification, 'performanceFamily' | 'performanceSubfamily'> {
  switch (family) {
    case 'acoustic-piano': return { performanceFamily: 'keyboard', performanceSubfamily: 'acoustic-piano' };
    case 'electric-piano': return { performanceFamily: 'keyboard', performanceSubfamily: 'electric-piano' };
    case 'acoustic-keyed-pluck': return { performanceFamily: 'keyboard', performanceSubfamily: 'acoustic-keyed-pluck' };
    case 'electric-keyed-pluck': return { performanceFamily: 'keyboard', performanceSubfamily: 'electric-keyed-pluck' };
    case 'mallet': return expressionFamily === 'mallet-damper'
      ? { performanceFamily: 'mallet', performanceSubfamily: 'vibraphone' }
      : { performanceFamily: 'mallet', performanceSubfamily: 'mallet-strike' };
    case 'electric-organ': return { performanceFamily: 'keyboard', performanceSubfamily: 'electric-organ' };
    case 'free-reed': return { performanceFamily: 'free-reed', performanceSubfamily: 'free-reed' };
    case 'acoustic-guitar': return { performanceFamily: 'guitar', performanceSubfamily: 'acoustic-guitar' };
    case 'electric-guitar': return { performanceFamily: 'guitar', performanceSubfamily: 'electric-guitar' };
    case 'guitar-harmonics': return { performanceFamily: 'guitar', performanceSubfamily: 'guitar-harmonics' };
    case 'acoustic-bass': return { performanceFamily: 'bass', performanceSubfamily: 'acoustic-bass' };
    case 'electric-bass': return { performanceFamily: 'bass', performanceSubfamily: 'electric-bass' };
    case 'synth-bass': return { performanceFamily: 'bass', performanceSubfamily: 'synth-bass' };
    case 'organ-bass': return { performanceFamily: 'bass', performanceSubfamily: 'organ-bass' };
    case 'bowed-string': return { performanceFamily: 'bowed-string', performanceSubfamily: 'bowed-solo-string' };
    case 'ensemble-string': return { performanceFamily: 'bowed-string', performanceSubfamily: 'bowed-ensemble-string' };
    case 'plucked-string': return { performanceFamily: 'plucked-string', performanceSubfamily: 'plucked-orchestral-string' };
    case 'brass': return { performanceFamily: 'wind', performanceSubfamily: 'brass' };
    case 'saxophone': return { performanceFamily: 'wind', performanceSubfamily: 'saxophone' };
    case 'reed-woodwind': return { performanceFamily: 'wind', performanceSubfamily: 'reed-woodwind' };
    case 'flute-woodwind': return { performanceFamily: 'wind', performanceSubfamily: 'flute-woodwind' };
    case 'world-plucked': return { performanceFamily: 'plucked-string', performanceSubfamily: 'world-plucked' };
    case 'world-wind': return { performanceFamily: 'wind', performanceSubfamily: 'world-wind' };
    case 'world-bowed': return { performanceFamily: 'bowed-string', performanceSubfamily: 'world-bowed' };
    case 'synth-lead': return { performanceFamily: 'synth', performanceSubfamily: 'synth-lead' };
    case 'synth-pad': return { performanceFamily: 'synth', performanceSubfamily: 'synth-pad' };
    case 'synth-texture': return { performanceFamily: 'synth', performanceSubfamily: 'synth-texture' };
    case 'choir-voice': return { performanceFamily: 'voice', performanceSubfamily: 'choir-voice' };
    case 'pitched-percussion': return { performanceFamily: 'percussion', performanceSubfamily: 'pitched-percussion' };
    case 'orchestral-percussion': return { performanceFamily: 'percussion', performanceSubfamily: 'orchestral-percussion' };
    case 'drum-kit': return { performanceFamily: 'percussion', performanceSubfamily: 'drum-kit' };
    case 'sfx': return { performanceFamily: 'effect', performanceSubfamily: 'sfx' };
  }
}

function gestureClassification(
  family: DreamVoiceFamily,
  expressionFamily: DreamExpressionFamily,
): Pick<Classification, 'gestureFamily' | 'gestureSubfamily'> {
  switch (family) {
    case 'acoustic-piano': return { gestureFamily: 'keybed', gestureSubfamily: 'hammered-piano-damper' };
    case 'electric-piano': return { gestureFamily: 'keybed', gestureSubfamily: 'electric-piano-keybed' };
    case 'acoustic-keyed-pluck':
    case 'electric-keyed-pluck': return { gestureFamily: 'keybed', gestureSubfamily: 'keyed-pluck' };
    case 'electric-organ': return { gestureFamily: 'keybed', gestureSubfamily: 'organ-keyhold' };
    case 'free-reed': return { gestureFamily: 'keybed', gestureSubfamily: 'accordion-bellows-keyhold' };
    case 'mallet': return expressionFamily === 'mallet-damper'
      ? { gestureFamily: 'mallet', gestureSubfamily: 'vibraphone-damper' }
      : { gestureFamily: 'mallet', gestureSubfamily: 'mallet-strike' };
    case 'acoustic-guitar':
    case 'electric-guitar': return { gestureFamily: 'fretted-string', gestureSubfamily: 'fretted-pluck' };
    case 'guitar-harmonics': return { gestureFamily: 'fretted-string', gestureSubfamily: 'guitar-harmonics' };
    case 'acoustic-bass': return { gestureFamily: 'bass-string', gestureSubfamily: 'bass-fingered-pluck' };
    case 'electric-bass': return { gestureFamily: 'bass-string', gestureSubfamily: 'bass-fingered-pluck' };
    case 'synth-bass': return { gestureFamily: 'bass-string', gestureSubfamily: 'bass-synth' };
    case 'organ-bass': return { gestureFamily: 'bass-string', gestureSubfamily: 'bass-organ-sustain' };
    case 'bowed-string': return { gestureFamily: 'bowed-string', gestureSubfamily: 'bowed-solo-string' };
    case 'ensemble-string': return { gestureFamily: 'bowed-string', gestureSubfamily: 'bowed-ensemble-string' };
    case 'plucked-string': return { gestureFamily: 'orchestral-pluck', gestureSubfamily: 'orchestral-pizzicato' };
    case 'brass': return { gestureFamily: 'wind', gestureSubfamily: 'brass-breath' };
    case 'saxophone': return { gestureFamily: 'wind', gestureSubfamily: 'sax-breath' };
    // Modern GM profiles split single and double reeds below. This fallback is
    // for compatibility entries whose sound name lacks enough identity.
    case 'reed-woodwind': return { gestureFamily: 'wind', gestureSubfamily: 'single-reed-breath' };
    case 'flute-woodwind': return { gestureFamily: 'wind', gestureSubfamily: 'flute-breath' };
    case 'world-plucked': return { gestureFamily: 'orchestral-pluck', gestureSubfamily: 'world-plucked-string' };
    case 'world-wind': return { gestureFamily: 'wind', gestureSubfamily: 'world-double-reed-breath' };
    case 'world-bowed': return { gestureFamily: 'bowed-string', gestureSubfamily: 'bowed-solo-string' };
    case 'synth-lead': return { gestureFamily: 'synth', gestureSubfamily: 'synth-lead-keybed' };
    case 'synth-pad': return { gestureFamily: 'synth', gestureSubfamily: 'synth-pad-sustain' };
    case 'synth-texture':
    case 'sfx': return { gestureFamily: 'effect', gestureSubfamily: 'effect-event' };
    case 'choir-voice': return { gestureFamily: 'voice', gestureSubfamily: 'choir-sustain' };
    case 'pitched-percussion': return { gestureFamily: 'percussion', gestureSubfamily: 'pitched-strike' };
    case 'orchestral-percussion': return { gestureFamily: 'percussion', gestureSubfamily: 'score-percussion' };
    case 'drum-kit': return { gestureFamily: 'drum', gestureSubfamily: 'drum-acoustic-kit' };
  }
}

const playable = (
  family: DreamVoiceFamily,
  expressionFamily: DreamExpressionFamily,
  mode: DreamVoiceMode,
  roleCapabilities: readonly InstrumentRoleName[],
): Classification => {
  const gesture = gestureClassification(family, expressionFamily);
  return {
    family,
    expressionFamily,
    ...instrumentHierarchy(family, gesture.gestureSubfamily),
    ...performanceClassification(family, expressionFamily),
    ...gesture,
    ccExpressionContract: ccExpressionContractFor(family, gesture.gestureSubfamily),
    mode,
    roleCapabilities,
    arrangementStatus: 'available',
  };
};

const manual = (
  family: DreamVoiceFamily,
  expressionFamily: DreamExpressionFamily,
  mode: DreamVoiceMode,
): Classification => {
  const gesture = gestureClassification(family, expressionFamily);
  return {
    family,
    expressionFamily,
    ...instrumentHierarchy(family, gesture.gestureSubfamily),
    ...performanceClassification(family, expressionFamily),
    ...gesture,
    ccExpressionContract: ccExpressionContractFor(family, gesture.gestureSubfamily),
    mode,
    roleCapabilities: [],
    arrangementStatus: 'manual-only',
  };
};

function withGesture(
  classification: Classification,
  gestureFamily: DreamGestureFamily,
  gestureSubfamily: DreamGestureSubfamily,
): Classification {
  return {
    ...classification,
    ...instrumentHierarchy(classification.family, gestureSubfamily),
    gestureFamily,
    gestureSubfamily,
    ccExpressionContract: ccExpressionContractFor(classification.family, gestureSubfamily),
  };
}

function withInstrumentSource(
  classification: Classification,
  instrumentClass: DreamInstrumentClass,
  soundSource: DreamSoundSource,
): Classification {
  return { ...classification, instrumentClass, soundSource };
}

function baseClassification(program: number): Classification {
  // GM PC2 is Electric Grand Piano. Keep it with electric pianos rather than
  // treating the whole 0..3 range as acoustic solely because of its position.
  if (program === 0 || program === 1 || program === 3) return playable('acoustic-piano', 'piano-damper', 'polyphonic-decay', ['lead', 'comp', 'bass']);
  if (program === 2 || program === 4 || program === 5) return playable('electric-piano', 'electric-keyboard', 'polyphonic-decay', ['lead', 'comp']);
  if (program === 6) return playable('acoustic-keyed-pluck', 'plucked-keyboard', 'polyphonic-decay', ['lead', 'comp']);
  if (program === 7) return playable('electric-keyed-pluck', 'plucked-keyboard', 'polyphonic-decay', ['lead', 'comp']);
  if (program === 11) return playable('mallet', 'mallet-damper', 'polyphonic-decay', ['lead', 'comp']);
  if (program <= 15) return playable('mallet', 'mallet-strike', 'polyphonic-decay', ['lead', 'comp']);
  if (program <= 20) return playable('electric-organ', 'organ-sustain', 'polyphonic-sustain', ['lead', 'pad']);
  // Accordion and bandoneon are bellows-and-keyboard instruments. Harmonica is
  // a mouth-blown free reed, so it must not inherit the same future gesture.
  if (program === 21 || program === 23) return withGesture(
    playable('free-reed', 'free-reed-sustain', 'polyphonic-sustain', ['lead', 'pad']),
    'keybed', 'accordion-bellows-keyhold',
  );
  if (program === 22) return withGesture(
    playable('free-reed', 'free-reed-sustain', 'monophonic-sustain', ['lead']),
    'wind', 'harmonica-breath',
  );
  if (program <= 26) return playable('acoustic-guitar', 'guitar-pluck', 'polyphonic-decay', ['lead', 'comp']);
  if (program <= 30) return playable('electric-guitar', 'guitar-pluck', 'polyphonic-decay', ['lead', 'comp']);
  if (program === 31) return playable('guitar-harmonics', 'guitar-pluck', 'polyphonic-decay', ['lead']);
  if (program === 32) return playable('acoustic-bass', 'bass-pluck', 'monophonic-sustain', ['bass']);
  if (program === 33 || program === 35) return playable('electric-bass', 'bass-pluck', 'monophonic-sustain', ['bass']);
  if (program === 34) return withGesture(
    playable('electric-bass', 'bass-pluck', 'monophonic-sustain', ['bass']),
    'bass-string', 'bass-picked-pluck',
  );
  if (program === 36 || program === 37) return withGesture(
    playable('electric-bass', 'bass-pluck', 'monophonic-sustain', ['bass']),
    'bass-string', 'bass-slap',
  );
  if (program <= 39) return playable('synth-bass', 'synth-bass', 'monophonic-sustain', ['bass']);
  if (program <= 42) return playable('bowed-string', 'bowed-string', 'monophonic-sustain', ['lead']);
  if (program === 43) return withGesture(
    playable('bowed-string', 'bowed-string', 'monophonic-sustain', ['bass']),
    'bowed-string', 'bowed-contrabass',
  );
  // GM44/48/49 are bow-sustained string sections. Their five-track role is
  // pad-like, but their physical expression belongs with bowed strings, not
  // with an electronic/synth pad.
  if (program === 44) return withGesture(
    playable('ensemble-string', 'bowed-string', 'polyphonic-sustain', ['pad']),
    'bowed-string', 'bowed-tremolo-ensemble',
  );
  if (program === 45) return playable('plucked-string', 'plucked-string', 'polyphonic-decay', ['lead', 'comp']);
  if (program === 46) return withGesture(
    playable('plucked-string', 'plucked-string', 'polyphonic-decay', ['lead', 'comp']),
    'orchestral-pluck', 'harp-pluck',
  );
  if (program === 47) return manual('orchestral-percussion', 'pitched-percussion', 'percussive');
  if (program === 48) return playable('ensemble-string', 'bowed-string', 'polyphonic-sustain', ['pad']);
  if (program === 49) return withGesture(
    playable('ensemble-string', 'bowed-string', 'polyphonic-sustain', ['pad']),
    'bowed-string', 'bowed-slow-ensemble',
  );
  if (program <= 51) return playable('synth-pad', 'synth-pad', 'polyphonic-sustain', ['pad']);
  if (program <= 54) return playable('choir-voice', 'synth-pad', 'polyphonic-sustain', ['pad']);
  if (program === 55) return manual('orchestral-percussion', 'pitched-percussion', 'percussive');
  if (program <= 61) return playable('brass', 'brass-air', 'monophonic-sustain', ['lead']);
  if (program <= 63) return playable('synth-lead', 'synth-lead', 'polyphonic-sustain', ['lead', 'comp']);
  if (program <= 67) return playable('saxophone', 'sax-air', 'monophonic-sustain', ['lead']);
  if (program <= 70) return withGesture(
    playable('reed-woodwind', 'woodwind-air', 'monophonic-sustain', ['lead']),
    'wind', 'double-reed-breath',
  );
  if (program === 71) return withGesture(
    playable('reed-woodwind', 'woodwind-air', 'monophonic-sustain', ['lead']),
    'wind', 'single-reed-breath',
  );
  if (program <= 79) return playable('flute-woodwind', 'woodwind-air', 'monophonic-sustain', ['lead']);
  if (program <= 87) return playable('synth-lead', 'synth-lead', 'monophonic-sustain', ['lead']);
  if (program <= 95) return playable('synth-pad', 'synth-pad', 'polyphonic-sustain', ['pad']);
  if (program <= 103) return manual('synth-texture', 'sfx', 'effect');
  if (program <= 107) return withGesture(
    playable('world-plucked', 'plucked-string', 'polyphonic-decay', ['lead', 'comp']),
    'orchestral-pluck', 'world-plucked-string',
  );
  if (program === 108) return withGesture(
    playable('world-plucked', 'plucked-string', 'polyphonic-decay', ['lead', 'comp']),
    'orchestral-pluck', 'thumb-pluck',
  );
  if (program === 110) return playable('world-bowed', 'bowed-string', 'monophonic-sustain', ['lead']);
  if (program === 109) return withGesture(
    playable('world-wind', 'woodwind-air', 'monophonic-sustain', ['lead']),
    'wind', 'bagpipe-drone',
  );
  if (program === 111) return withGesture(
    playable('world-wind', 'woodwind-air', 'monophonic-sustain', ['lead']),
    'wind', 'world-double-reed-breath',
  );
  if (program <= 115) return playable('pitched-percussion', 'pitched-percussion', 'percussive', ['lead', 'comp']);
  return manual(program <= 119 ? 'orchestral-percussion' : 'sfx', program <= 119 ? 'pitched-percussion' : 'sfx', program <= 119 ? 'percussive' : 'effect');
}

/** Variations that genuinely change a Program family's physical role. */
const CLASSIFICATION_OVERRIDES: Readonly<Record<string, Classification>> = {
  // Hammond slot, but the official variation is explicitly an organ bass.
  '40/16': playable('organ-bass', 'organ-sustain', 'monophonic-sustain', ['bass']),
  // These have different triggering/tail contracts from ordinary picked guitar.
  '24/24': withInstrumentSource(
    playable('guitar-harmonics', 'guitar-pluck', 'polyphonic-decay', ['lead']),
    'acoustic-guitar-harmonics', 'acoustic',
  ),
  '16/31': withInstrumentSource(
    playable('guitar-harmonics', 'guitar-pluck', 'polyphonic-decay', ['lead']),
    'acoustic-guitar-harmonics', 'acoustic',
  ),
  '8/28': withGesture(
    playable('electric-guitar', 'guitar-pluck', 'polyphonic-decay', ['lead', 'comp']),
    'fretted-string', 'fretted-muted',
  ),
  '8/26': withGesture(
    playable('electric-guitar', 'guitar-pluck', 'polyphonic-decay', ['lead', 'comp']),
    'fretted-string', 'fretted-slide',
  ),
  '32/25': withGesture(
    playable('electric-guitar', 'guitar-pluck', 'polyphonic-decay', ['lead', 'comp']),
    'fretted-string', 'fretted-slide',
  ),
  // Feedback and a pre-recorded brass fall are arranger cues, never generic five-track voices.
  '8/30': manual('sfx', 'sfx', 'effect'),
  '8/31': manual('sfx', 'sfx', 'effect'),
  '16/61': manual('brass', 'brass-air', 'effect'),
  // Warm Pad slot, but this variation is a rotary string ensemble rather than a synth pad.
  '3/89': playable('ensemble-string', 'bowed-string', 'polyphonic-sustain', ['pad']),
};

function melodicKey(bank: number, program: number): string {
  return `${bank}/${program}`;
}

function profileForCatalogItem(item: GM128CatalogItem): DreamVoiceProfile {
  const bank = item.bank;
  const classification = CLASSIFICATION_OVERRIDES[melodicKey(bank, item.program)] ?? baseClassification(item.program);
  return Object.freeze({
    address: Object.freeze({ bank, program: item.program }),
    addressSpace: 'modern-gm',
    name: item.name,
    source: item.source,
    ...classification,
    roleCapabilities: Object.freeze([...classification.roleCapabilities]),
  });
}

function auditionOnly(classification: Classification): Classification {
  return {
    ...classification,
    roleCapabilities: [],
    arrangementStatus: 'audition-only',
  };
}

/**
 * CC0=127 is an MT-32 compatibility map, so program numbers cannot be used
 * as identity. Classify the actual official sound name for catalog/audition
 * only; it never becomes an automatic-arrangement candidate.
 */
function mt32CompatibilityClassification(name: string, fallbackProgram: number): Classification {
  const n = name.toLowerCase();
  const playableAudition = (
    family: DreamVoiceFamily,
    expressionFamily: DreamExpressionFamily,
    mode: DreamVoiceMode,
  ) => auditionOnly(playable(family, expressionFamily, mode, []));
  const manualAudition = (family: DreamVoiceFamily, expressionFamily: DreamExpressionFamily, mode: DreamVoiceMode) =>
    auditionOnly(manual(family, expressionFamily, mode));

  if (/breath noise|helicopter|bird|telephone|laughing|screaming|punch|heart beat|footsteps|gun shot|laser gun|explosion/.test(n)) return manualAudition('sfx', 'sfx', 'effect');
  if (/acou piano|bright acoustic|honky-tonk/.test(n)) return playableAudition('acoustic-piano', 'piano-damper', 'polyphonic-decay');
  if (/electric grand|electric piano|detuned ep/.test(n)) return playableAudition('electric-piano', 'electric-keyboard', 'polyphonic-decay');
  if (n.includes('organ')) return playableAudition('electric-organ', 'organ-sustain', 'polyphonic-sustain');
  if (n.includes('harmonica')) return withGesture(
    playableAudition('free-reed', 'free-reed-sustain', 'monophonic-sustain'),
    'wind', 'harmonica-breath',
  );
  if (/accordion|bandoneon/.test(n)) return withGesture(
    playableAudition('free-reed', 'free-reed-sustain', 'polyphonic-sustain'),
    'keybed', 'accordion-bellows-keyhold',
  );
  if (/harpsichord|clavinet/.test(n)) return playableAudition('acoustic-keyed-pluck', 'plucked-keyboard', 'polyphonic-decay');
  if (n.includes('vibraphone')) return playableAudition('mallet', 'mallet-damper', 'polyphonic-decay');
  if (/celesta|kalimba|tinkle bell|glockenspiel|tubular bell|xylophone|marimba|agogo|steel drums|woodblock/.test(n)) return playableAudition('mallet', 'mallet-strike', 'polyphonic-decay');
  if (/synth brass|saw lead|square lead|synth calliope|charang/.test(n)) return playableAudition('synth-lead', 'synth-lead', 'polyphonic-sustain');
  if (/synth bass/.test(n)) return playableAudition('synth-bass', 'synth-bass', 'monophonic-sustain');
  if (/fantasia|bowed glass pad|soundtrack|atmosphere|crystal|ice rain/.test(n)) return playableAudition('synth-pad', 'synth-pad', 'polyphonic-sustain');
  if (/choir/.test(n)) return playableAudition('choir-voice', 'synth-pad', 'polyphonic-sustain');
  if (/soprano sax|alto sax|tenor sax|baritone sax/.test(n)) return playableAudition('saxophone', 'sax-air', 'monophonic-sustain');
  if (/clarinet/.test(n)) return withGesture(
    playableAudition('reed-woodwind', 'woodwind-air', 'monophonic-sustain'),
    'wind', 'single-reed-breath',
  );
  if (/oboe|english horn|bassoon/.test(n)) return withGesture(
    playableAudition('reed-woodwind', 'woodwind-air', 'monophonic-sustain'),
    'wind', 'double-reed-breath',
  );
  if (n.includes('bagpipe')) return withGesture(
    playableAudition('world-wind', 'woodwind-air', 'monophonic-sustain'),
    'wind', 'bagpipe-drone',
  );
  if (/flute|piccolo|recorder|pan flute|bottle blow|whistle|shakuhachi/.test(n)) return playableAudition('flute-woodwind', 'woodwind-air', 'monophonic-sustain');
  if (/trumpet|trombone|tuba|french horns|brass/.test(n)) return playableAudition('brass', 'brass-air', 'monophonic-sustain');
  if (n.includes('contrabass')) return auditionOnly(withGesture(
    playable('bowed-string', 'bowed-string', 'monophonic-sustain', []),
    'bowed-string', 'bowed-contrabass',
  ));
  if (/violin|viola|cello|fiddle/.test(n)) return playableAudition('bowed-string', 'bowed-string', 'monophonic-sustain');
  if (n.includes('tremolo strings')) return auditionOnly(withGesture(
    playable('ensemble-string', 'bowed-string', 'polyphonic-sustain', []),
    'bowed-string', 'bowed-tremolo-ensemble',
  ));
  if (n.includes('string ensemble')) return playableAudition('ensemble-string', 'bowed-string', 'polyphonic-sustain');
  if (n.includes('pizzicato')) return playableAudition('plucked-string', 'plucked-string', 'polyphonic-decay');
  if (n.includes('harp')) return auditionOnly(withGesture(
    playable('plucked-string', 'plucked-string', 'polyphonic-decay', []),
    'orchestral-pluck', 'harp-pluck',
  ));
  if (/sitar|banjo|shamisen|koto/.test(n)) return withGesture(
    playableAudition('world-plucked', 'plucked-string', 'polyphonic-decay'),
    'orchestral-pluck', 'world-plucked-string',
  );
  if (n.includes('kalimba')) return withGesture(
    playableAudition('world-plucked', 'plucked-string', 'polyphonic-decay'),
    'orchestral-pluck', 'thumb-pluck',
  );
  if (/hawaiian|steel guitar/.test(n)) return withGesture(
    playableAudition('electric-guitar', 'guitar-pluck', 'polyphonic-decay'),
    'fretted-string', 'fretted-slide',
  );
  if (n.includes('guitar')) return playableAudition('electric-guitar', 'guitar-pluck', 'polyphonic-decay');
  if (/slap bass/.test(n)) return withGesture(
    playableAudition('electric-bass', 'bass-pluck', 'monophonic-sustain'),
    'bass-string', 'bass-slap',
  );
  if (/picked bass/.test(n)) return withGesture(
    playableAudition('electric-bass', 'bass-pluck', 'monophonic-sustain'),
    'bass-string', 'bass-picked-pluck',
  );
  if (/acoustic bass|bass-j|fretless bass/.test(n)) return playableAudition('electric-bass', 'bass-pluck', 'monophonic-sustain');
  if (/timpani|tom|taiko|synth drum|808 tom|reverse cymbal|triangle|orchestra hit|castanets/.test(n)) return manualAudition('orchestral-percussion', 'pitched-percussion', 'percussive');
  return auditionOnly(baseClassification(fallbackProgram));
}

function compatibilityProfileForCatalogItem(item: GM128CatalogItem): DreamVoiceProfile {
  const classification = mt32CompatibilityClassification(item.name, item.program);
  return Object.freeze({
    address: Object.freeze({ bank: 127, program: item.program }),
    addressSpace: 'mt32-compatibility',
    name: item.name,
    source: item.source,
    ...classification,
    roleCapabilities: Object.freeze([]),
  });
}

function drumGestureSubfamilyFor(program: number): DreamGestureSubfamily {
  if (program === 24) return 'drum-electronic-kit';
  if (program === 25) return 'drum-808-kit';
  if (program === 32) return 'drum-jazz-kit';
  if (program === 40) return 'drum-brush-kit';
  if (program === 48) return 'drum-orchestral-kit';
  if (program === 56) return 'drum-sfx-kit';
  if (program === 127) return 'drum-cm-kit';
  return 'drum-acoustic-kit';
}

const MODERN_MELODIC_ITEMS = [
  ...GM128_MAIN_PROGRAMS,
  ...GM128_VARIATION_PROGRAMS.filter((item) => item.bank !== 127),
];
const MT32_COMPATIBILITY_ITEMS = GM128_VARIATION_PROGRAMS.filter((item) => item.bank === 127);

/** The only melodic address space available to future automatic orchestration. */
export const DREAM5504_MODERN_MELODIC_VOICE_PROFILES: readonly DreamVoiceProfile[] = Object.freeze(
  MODERN_MELODIC_ITEMS.map(profileForCatalogItem),
);

/** Complete CC0=127 compatibility catalog. Audition-only, never an automatic palette source. */
export const DREAM5504_MT32_COMPATIBILITY_VOICE_PROFILES: readonly DreamVoiceProfile[] = Object.freeze(
  MT32_COMPATIBILITY_ITEMS.map(compatibilityProfileForCatalogItem),
);

export const DREAM5504_DRUM_VOICE_PROFILES: readonly DreamVoiceProfile[] = Object.freeze(
  GM128_DRUM_KITS.map((item) => {
    const gestureSubfamily = drumGestureSubfamilyFor(item.program);
    return Object.freeze({
      address: Object.freeze({ program: item.program, role: 'drum' as const }),
      addressSpace: 'drum-kit' as const,
      name: item.name,
      source: item.source,
      ...instrumentHierarchy('drum-kit', gestureSubfamily),
      family: 'drum-kit' as const,
      performanceFamily: 'percussion' as const,
      performanceSubfamily: 'drum-kit' as const,
      expressionFamily: 'drum-kit' as const,
      gestureFamily: 'drum' as const,
      gestureSubfamily,
      ccExpressionContract: 'drum' as const,
      mode: 'percussive' as const,
      roleCapabilities: Object.freeze(['drum'] as const),
      arrangementStatus: 'available' as const,
    });
  }),
);

/** Modern GM inventory plus the dedicated Channel-10 drum kits. MT-32 is intentionally absent. */
export const DREAM5504_ORCHESTRATION_VOICE_PROFILES: readonly DreamVoiceProfile[] = Object.freeze([
  ...DREAM5504_MODERN_MELODIC_VOICE_PROFILES,
  ...DREAM5504_DRUM_VOICE_PROFILES,
]);

/** All 407 shipped addresses: modern GM, dedicated drum kits, and MT-32 compatibility audition map. */
export const DREAM5504_FULL_AUDITION_VOICE_PROFILES: readonly DreamVoiceProfile[] = Object.freeze([
  ...DREAM5504_ORCHESTRATION_VOICE_PROFILES,
  ...DREAM5504_MT32_COMPATIBILITY_VOICE_PROFILES,
]);

/** Future style palettes may only draw from this set; it carries no style weight by itself. */
export const DREAM5504_AUTOMATIC_ARRANGEMENT_VOICE_PROFILES: readonly DreamVoiceProfile[] = Object.freeze(
  DREAM5504_ORCHESTRATION_VOICE_PROFILES.filter((profile) => profile.arrangementStatus === 'available'),
);

/** One-shots, ambience and SFX require an explicit arranger cue, never a five-track fallback. */
export const DREAM5504_MANUAL_ONLY_VOICE_PROFILES: readonly DreamVoiceProfile[] = Object.freeze(
  DREAM5504_ORCHESTRATION_VOICE_PROFILES.filter((profile) => profile.arrangementStatus === 'manual-only'),
);

export const DREAM5504_MODERN_MELODIC_VOICE_COUNT = DREAM5504_MODERN_MELODIC_VOICE_PROFILES.length;
export const DREAM5504_DRUM_KIT_COUNT = DREAM5504_DRUM_VOICE_PROFILES.length;
export const DREAM5504_MT32_COMPATIBILITY_VOICE_COUNT = GM128_VARIATION_PROGRAMS.filter((item) => item.bank === 127).length;
export const DREAM5504_FULL_AUDITION_VOICE_COUNT = DREAM5504_FULL_AUDITION_VOICE_PROFILES.length;

const melodicProfileByKey = new Map(
  DREAM5504_MODERN_MELODIC_VOICE_PROFILES.map((profile) => [
    melodicKey(profile.address.bank ?? 0, profile.address.program),
    profile,
  ]),
);
const drumProfileByProgram = new Map(
  DREAM5504_DRUM_VOICE_PROFILES.map((profile) => [profile.address.program, profile]),
);
const mt32CompatibilityProfileByProgram = new Map(
  DREAM5504_MT32_COMPATIBILITY_VOICE_PROFILES.map((profile) => [profile.address.program, profile]),
);

export function dreamVoiceProfileFor(address: DreamVoiceAddress): DreamVoiceProfile | undefined {
  if (address.role === 'drum') return drumProfileByProgram.get(address.program);
  return melodicProfileByKey.get(melodicKey(address.bank ?? 0, address.program));
}

/** Full catalog lookup for the audition UI and audit exports. It does not change auto-arrangement eligibility. */
export function dreamVoiceAuditionProfileFor(address: DreamVoiceAddress): DreamVoiceProfile | undefined {
  if (address.role === 'drum') return drumProfileByProgram.get(address.program);
  if ((address.bank ?? 0) === 127) return mt32CompatibilityProfileByProgram.get(address.program);
  return dreamVoiceProfileFor(address);
}

export function isDreamVoiceRoleCapable(address: DreamVoiceAddress, role: InstrumentRoleName): boolean {
  return dreamVoiceProfileFor({ ...address, role })?.roleCapabilities.includes(role) ?? false;
}

export function isDreamVoiceAvailableForAutomaticArrangement(address: DreamVoiceAddress): boolean {
  return dreamVoiceProfileFor(address)?.arrangementStatus === 'available';
}

/** Query helper for a future style palette. It never assigns weights or combinations. */
export function dreamVoiceProfilesForFamily(
  family: DreamVoiceFamily,
  status?: DreamArrangementStatus,
): readonly DreamVoiceProfile[] {
  return DREAM5504_ORCHESTRATION_VOICE_PROFILES.filter((profile) =>
    profile.family === family && (status === undefined || profile.arrangementStatus === status));
}

/** 一级查询：先按真实演奏机制选乐手，再决定具体乐器和音色。 */
export function dreamVoiceProfilesForPlayingMechanism(
  playingMechanism: DreamPlayingMechanism,
  status?: DreamArrangementStatus,
): readonly DreamVoiceProfile[] {
  return DREAM5504_ORCHESTRATION_VOICE_PROFILES.filter((profile) =>
    profile.playingMechanism === playingMechanism && (status === undefined || profile.arrangementStatus === status));
}

/** 二级查询：原声/电声/合成器乐器类别，尚不决定 CC 或手势。 */
export function dreamVoiceProfilesForInstrumentClass(
  instrumentClass: DreamInstrumentClass,
  status?: DreamArrangementStatus,
): readonly DreamVoiceProfile[] {
  return DREAM5504_ORCHESTRATION_VOICE_PROFILES.filter((profile) =>
    profile.instrumentClass === instrumentClass && (status === undefined || profile.arrangementStatus === status));
}

/** Query by playing family, e.g. piano, guitar or wind, before choosing a palette. */
export function dreamVoiceProfilesForPerformanceFamily(
  performanceFamily: DreamPerformanceFamily,
  status?: DreamArrangementStatus,
): readonly DreamVoiceProfile[] {
  return DREAM5504_ORCHESTRATION_VOICE_PROFILES.filter((profile) =>
    profile.performanceFamily === performanceFamily && (status === undefined || profile.arrangementStatus === status));
}

/** Query a concrete player type, e.g. electric-piano or saxophone. */
export function dreamVoiceProfilesForPerformanceSubfamily(
  performanceSubfamily: DreamPerformanceSubfamily,
  status?: DreamArrangementStatus,
): readonly DreamVoiceProfile[] {
  return DREAM5504_ORCHESTRATION_VOICE_PROFILES.filter((profile) =>
    profile.performanceSubfamily === performanceSubfamily && (status === undefined || profile.arrangementStatus === status));
}

/** Query the exact reusable gesture contract rather than a catalog/GM-number family. */
export function dreamVoiceProfilesForGestureSubfamily(
  gestureSubfamily: DreamGestureSubfamily,
  includeAuditionOnly = false,
): readonly DreamVoiceProfile[] {
  const source = includeAuditionOnly ? DREAM5504_FULL_AUDITION_VOICE_PROFILES : DREAM5504_ORCHESTRATION_VOICE_PROFILES;
  return source.filter((profile) => profile.gestureSubfamily === gestureSubfamily);
}

/**
 * Query the small CC-policy layer. This does not authorize or generate a CC;
 * it only gives a future policy designer the correctly addressed voice set.
 */
export function dreamVoiceProfilesForCcExpressionContract(
  ccExpressionContract: DreamCcExpressionContract,
  includeAuditionOnly = false,
): readonly DreamVoiceProfile[] {
  const source = includeAuditionOnly ? DREAM5504_FULL_AUDITION_VOICE_PROFILES : DREAM5504_ORCHESTRATION_VOICE_PROFILES;
  return source.filter((profile) => profile.ccExpressionContract === ccExpressionContract);
}

/** Query helper for a future five-track palette. Defaults to voices safe for automatic consideration. */
export function dreamVoiceProfilesForRole(
  role: InstrumentRoleName,
  includeManualOnly = false,
): readonly DreamVoiceProfile[] {
  const source = includeManualOnly ? DREAM5504_ORCHESTRATION_VOICE_PROFILES : DREAM5504_AUTOMATIC_ARRANGEMENT_VOICE_PROFILES;
  return source.filter((profile) => profile.roleCapabilities.includes(role));
}

export const DREAM5504_VOICE_FAMILY_COUNTS: Readonly<Record<DreamVoiceFamily, number>> = Object.freeze(
  DREAM5504_ORCHESTRATION_VOICE_PROFILES.reduce<Record<DreamVoiceFamily, number>>((counts, profile) => {
    counts[profile.family] = (counts[profile.family] ?? 0) + 1;
    return counts;
  }, {} as Record<DreamVoiceFamily, number>),
);
