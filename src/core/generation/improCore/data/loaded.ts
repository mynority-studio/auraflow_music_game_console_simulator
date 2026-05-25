// ============================================================
// loaded.ts — 启动时加载 145 个 .sty + 1 个 .fv
// ============================================================
//
// Vite import.meta.glob ?raw 把 145 个 .sty 文件全部 inline 进 bundle
// (同步加载,无 async,build 时 webpack/vite 处理)。
// 解析失败的 .sty 被 try/catch + console.warn,不阻塞启动。
//
// 提供:
//   ALL_STYLES_MAP        — Map<name, StyleData> 全 styles 索引
//   ALL_STYLE_NAMES       — string[] 按名字字母序(UI dropdown 用)
//   BALLAD_STYLE / SWING_STYLE — 向后兼容个别 export
//   CLOSED_HIGH_VOICING_SETTINGS — 解析好的 VoicingSettings
//   getStyleByName(name)  — 查表 helper(找不到返 ballad fallback)
//
// 单元自检函数 selfTest() — console.log 解析摘要,供 dev 验证。
// ============================================================

import closedHighFvRaw from './voicings/Closed-High.fv?raw';
import { parseStyle, type StyleData } from './sty-parser';
import { parseVoicingSettings, type VoicingSettings } from './fv-parser';

// ?raw glob:vite 5+ 用 query/import 形式
const styleModules = import.meta.glob('./styles/*.sty', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

export const ALL_STYLES_MAP: ReadonlyMap<string, StyleData> = (() => {
    const map = new Map<string, StyleData>();
    for (const [path, raw] of Object.entries(styleModules)) {
        try {
            const style = parseStyle(raw);
            if (style.name) map.set(style.name, style);
        } catch (e) {
            console.warn(`[ImproCore] parse failed:${path}`, e);
        }
    }
    return map;
})();

export const ALL_STYLE_NAMES: ReadonlyArray<string> = Array.from(ALL_STYLES_MAP.keys()).sort();

export function getStyleByName(name: string): StyleData {
    return ALL_STYLES_MAP.get(name) ?? ALL_STYLES_MAP.get('ballad') ?? Array.from(ALL_STYLES_MAP.values())[0]!;
}

// 向后兼容个别 export(ImproEngineFacade 旧 import)
export const BALLAD_STYLE: StyleData = getStyleByName('ballad');
export const SWING_STYLE: StyleData = getStyleByName('swing');

export const CLOSED_HIGH_VOICING_SETTINGS: VoicingSettings = parseVoicingSettings(closedHighFvRaw);

/**
 * Dev self-test — console.log 加载摘要。
 * 不在 production 自动跑,caller 显式 import 调用。
 */
export function selfTest(): void {
    console.log(`[ImproCore] loaded ${ALL_STYLES_MAP.size} styles:`, ALL_STYLE_NAMES);
    console.log('[ImproCore] BALLAD sample:', {
        name: BALLAD_STYLE.name,
        bassPatterns: BALLAD_STYLE.bassPatterns.length,
        chordPatterns: BALLAD_STYLE.chordPatterns.length,
        drumPatterns: BALLAD_STYLE.drumPatterns.length,
    });
    console.log('[ImproCore] CLOSED_HIGH_VOICING_SETTINGS:', CLOSED_HIGH_VOICING_SETTINGS);
}
