// ============================================================
// mgStyle → DrumGridConfig 选择器
// ============================================================

import type { MgStyle } from '../../../../../../state/EngineSelectionStore';
import type { DrumGridConfig } from '../types';
import { POP_DRUM_GRID } from './POP';
import { JAZZ_DRUM_GRID } from './JAZZ';
import { BLUES_DRUM_GRID } from './BLUES';
import { RNB_DRUM_GRID } from './RNB';

export { POP_DRUM_GRID, JAZZ_DRUM_GRID, BLUES_DRUM_GRID, RNB_DRUM_GRID };

const MG_STYLE_TO_GRID: Record<MgStyle, DrumGridConfig> = {
    POP:   POP_DRUM_GRID,
    JAZZ:  JAZZ_DRUM_GRID,
    BLUES: BLUES_DRUM_GRID,
    RNB:   RNB_DRUM_GRID,
};

export function getDrumGridByMgStyle(style: MgStyle): DrumGridConfig {
    return MG_STYLE_TO_GRID[style];
}
