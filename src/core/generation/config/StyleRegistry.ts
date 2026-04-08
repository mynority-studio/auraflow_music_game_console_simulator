/**
 * 兼容适配层 — 将旧版 App 层 import 路径映射到新版 styles/ 子目录。
 * App 层代码 import { StyleRegistry } from 'config/StyleRegistry' 不需要修改。
 */
export { StyleRegistry, getAllAvailableStyles, getStyleConfig } from './styles/StyleRegistry';

// ── 旧版命名兼容 ──
import { getStyleConfig } from './styles/StyleRegistry';
import { StyleId } from './StyleFlags';

export const DefaultStyleConfig = getStyleConfig(StyleId.Default);
export const DarkSynthPopStyleConfig = DefaultStyleConfig;
export const LoFiChillStyleConfig = DefaultStyleConfig;
