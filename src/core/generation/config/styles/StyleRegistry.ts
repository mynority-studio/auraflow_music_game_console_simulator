// ============================================================
// StyleRegistry — 按 StyleId 索引的风格注册表（参考架构 3 风格）
// ============================================================
// 用户决策：删 ACG，按 ALL_SOURCE_CODE.md 完整移植 ModernPop / ChillJazz / NeoSoul。
// ============================================================

import { StyleConfig } from '../../types';
import { StyleId } from '../StyleFlags';
import { PopStyle } from './PopStyle';
import { ChillJazzStyle } from './ChillJazzStyle';
import { NeoSoulStyle } from './NeoSoulStyle';

export const StyleRegistry: Record<number, StyleConfig> = {
    [StyleId.ModernPop]: PopStyle,
    [StyleId.ChillJazz]: ChillJazzStyle,
    [StyleId.NeoSoul]:   NeoSoulStyle,
};

export function getStyleConfig(styleId: StyleId): StyleConfig {
    return StyleRegistry[styleId] || PopStyle;
}

export function getAllAvailableStyles(): StyleConfig[] {
    return Object.values(StyleRegistry);
}
