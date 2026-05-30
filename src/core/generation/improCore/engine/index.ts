// ============================================================
// ImproCore engine — 公开入口
// ============================================================
//
// import 本模块即初始化和弦词汇(副作用:./vocab-rom 注入 My.voc)。
// app 侧统一从这里 import,确保 getChordForm 可用。
// ============================================================

import './vocab-rom'; // 副作用:初始化活动词汇

export * from './constants';
export * from './pitch';
export * from './duration';
export { ChordForm, getChordForm, allChordFormNames, isVocabReady } from './vocab';
export { Chord, makeChordSymbol, NOCHORD, type ChordSymbol } from './chord';
export { ChordPart } from './chordpart';
export { Grammar, type GrammarChordContext } from './grammar';
export { realize, DEFAULT_PARAMS, type SlotNote, type LickGenParams } from './lickgen';
export { getGrammar, ALL_GRAMMAR_NAMES } from './grammar-rom';
export { parseStyle, type Style } from './style';
export { renderComping, type CompTracks } from './comp';
export { getStyle, ALL_STYLE_NAMES } from './style-rom';
export { generateVoicing, DEFAULT_VOICING_SETTINGS, type VoicingSettings } from './voicing';
export { getExpectancy, scoreMelody, pickBest } from './expectancy';
export { applySwing } from './swing';
export { rectify, inferKey, rectifyToKey } from './rectify';
export { parseTransform, applyTransform, type Substitution } from './transform';
export { getTransform, ALL_TRANSFORM_NAMES } from './transform-rom';
export { generateLstmMelody, type LstmGenOptions } from './lstm/lstm-gen';
export { getConnectome, ALL_CONNECTOME_NAMES } from './lstm/model-rom';
