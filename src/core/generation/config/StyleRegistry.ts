/**
 * 兼容适配层 — 将旧版 App 层 import 路径映射到新版 styles/ 子目录。
 */
export { StyleRegistry, getAllAvailableStyles, getStyleConfig } from './styles/StyleRegistry';

import { getStyleConfig } from './styles/StyleRegistry';
import { StyleId } from './StyleFlags';

export const DefaultStyleConfig = getStyleConfig(StyleId.Default);
