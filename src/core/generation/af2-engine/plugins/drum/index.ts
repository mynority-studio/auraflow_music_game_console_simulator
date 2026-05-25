// ============================================================
// Drum plugins — public API barrel + default chains
// ============================================================

import { PersonaSparsity } from './PersonaSparsity';
import { CrossTrackModifier } from './CrossTrackModifier';
import { PersonaSyncopation } from './PersonaSyncopation';
import { BreakOverride } from './BreakOverride';
import { CrashOverride } from './CrashOverride';
import { FillOverride } from './FillOverride';
import { RideOverride } from './RideOverride';
import { OpenHihatOverride } from './OpenHihatOverride';
import type { DrumModifier, DrumOverride } from './types';

export { PersonaSparsity, CrossTrackModifier, PersonaSyncopation };
export { BreakOverride, CrashOverride, FillOverride, RideOverride, OpenHihatOverride };
export { FILL_STYLES_POP, pickFillStyle } from './FillOverride';
export type {
    DrumPluginMeta, DrumModifier, DrumOverride,
    DrumProbs, DrumHitState, DrumModifierContext, DrumOverrideContext,
    FillStyle,
} from './types';

/**
 * Modifier chain(pre-PRNG,顺序敏感):
 *   1. PersonaSparsity     — 先全 probs 减密
 *   2. CrossTrackModifier  — bass/chord onset 提升
 *   3. PersonaSyncopation  — off-beat snare 进一步加成(顺序后于 CrossTrack,
 *                            让 chord-syncopate 后的 snare 仍可被 persona 推高)
 */
export const DEFAULT_DRUM_MODIFIERS: ReadonlyArray<DrumModifier> = [
    PersonaSparsity,
    CrossTrackModifier,
    PersonaSyncopation,
];

/**
 * 互斥 Override chain(orchestrator if-else-if):Break > Crash > Fill > Ride。
 * 任一触发则其他不跑。
 */
export const EXCLUSIVE_DRUM_OVERRIDES: ReadonlyArray<DrumOverride> = [
    BreakOverride,
    CrashOverride,
    FillOverride,
    RideOverride,
];

/**
 * 独立 layer override(在 EXCLUSIVE chain 之后跑,可与 Ride 叠加):
 *   - OpenHihatOverride
 */
export const INDEPENDENT_DRUM_OVERRIDES: ReadonlyArray<DrumOverride> = [
    OpenHihatOverride,
];
