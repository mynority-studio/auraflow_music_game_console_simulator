// ============================================================
// Reconciler plugins — public API barrel
// ============================================================

import { EnergyHumanizer } from './EnergyHumanizer';
import { CollisionDamper } from './CollisionDamper';
import { DropBuildupDynamics } from './DropBuildupDynamics';
import type { ReconcilerPluginMeta } from './types';

export { EnergyHumanizer, CollisionDamper, DropBuildupDynamics };
export type { ReconcilerPluginMeta } from './types';

/**
 * Reconciler 全部 plugin 的元数据清单(documentation / debug 用)。
 *
 * 注:3 个 plugin 的 apply 签名各不同(EnergyHumanizer 需 sections;
 * CollisionDamper 需 bass/melody peers;DropBuildupDynamics 需 kind + bpm),
 * 不能简单 reduce 链式调用。Facade 顺序调用 3 plugin(详见 Af2EngineFacade
 * Step 5.5-5.7)。
 *
 * Reconciler 层无 core,任一 plugin 拔掉听感劣化但不破坏正确性。
 */
export const RECONCILER_PLUGINS: ReadonlyArray<ReconcilerPluginMeta> = [
    EnergyHumanizer,
    CollisionDamper,
    DropBuildupDynamics,
];
