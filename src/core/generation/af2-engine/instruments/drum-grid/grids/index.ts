// ============================================================
// DrumGrid — POP-only(2026-05-25 大瘦身)
// ============================================================
// 原 mgStyle → DrumGridConfig 选择器,删 JAZZ/BLUES/RNB 后只剩 POP。
// 直接导出 POP grid 作 DRUM_GRID 常量。
// ============================================================

import type { DrumGridConfig } from '../types';
import { POP_DRUM_GRID } from './POP';

export { POP_DRUM_GRID };

/** POP-only drum grid(全曲唯一选项)*/
export const DRUM_GRID: DrumGridConfig = POP_DRUM_GRID;
