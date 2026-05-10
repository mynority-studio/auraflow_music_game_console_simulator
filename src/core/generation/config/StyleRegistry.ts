/**
 * 兼容适配层 — 将旧版 App 层 import 路径映射到新版 styles/ 子目录。
 * App 层代码 import { StyleRegistry } from 'config/StyleRegistry' 不需要修改。
 */
export { StyleRegistry, getAllAvailableStyles, getStyleConfig } from './styles/StyleRegistry';

import { getStyleConfig } from './styles/StyleRegistry';
import { StyleId } from './StyleFlags';

// 兜底兼容：apps 层仍有少量 fallback 引用（`StyleRegistry[id] || AcgStyleConfig`）。
// 移植后 ACG 已删除，兜底默认到 ModernPop。
export const AcgStyleConfig = getStyleConfig(StyleId.ModernPop);
