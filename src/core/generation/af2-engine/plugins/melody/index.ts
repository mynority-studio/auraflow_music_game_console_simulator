// ============================================================
// Melody plugins — public API barrel
// ============================================================

export { RhythmPatternPicker } from './RhythmPatternPicker';
export { PhraseContourShaper } from './PhraseContourShaper';
export { PassingToneSelector } from './PassingToneSelector';
export { PhraseEndingDecider } from './PhraseEndingDecider';
export { SparsityGate } from './SparsityGate';
export { VelocityHumanizer } from './VelocityHumanizer';
export {
  MargulisExpectancyShaper,
  expectancyScore,
  pickByExpectancy,
} from './MargulisExpectancyShaper';
export {
  SlopeContourGate,
  clampToSlope,
  DEFAULT_SLOPE_BY_SECTION,
} from './SlopeContourGate';
export type { SlopeSpec } from './SlopeContourGate';
export {
  ApproachToneTargeter,
  approachPitch,
  shouldApproach,
} from './ApproachToneTargeter';
export type { MelodyPluginMeta } from './types';
