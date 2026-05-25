// ============================================================
// Composer plugins — public API barrel
// ============================================================

export { DynamicHarmonyDecorator } from './DynamicHarmonyDecorator';
export { VoicingSmoother } from './VoicingSmoother';
export {
  HandPartitioner,
  partitionHands,
  mergeHands,
  DEFAULT_HAND_CONFIG,
} from './HandPartitioner';
export type { HandPartitionConfig } from './HandPartitioner';
export type { ComposerPluginMeta, DecorateResult } from './types';
