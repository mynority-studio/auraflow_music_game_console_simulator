/**
 * 兼容适配层 — 将旧版 App 层 import 路径映射到新版 styles/ 子目录。
 * App 层代码 import { StyleRegistry } from 'config/StyleRegistry' 不需要修改。
 */
export { StyleRegistry, getAllAvailableStyles, getStyleConfig } from './styles/StyleRegistry';

import { getStyleConfig } from './styles/StyleRegistry';
import { StyleId } from './StyleFlags';

// 当前唯一注册风格，作为缺省/兜底配置
export const AcgStyleConfig = getStyleConfig(StyleId.AcgLightMusic);
