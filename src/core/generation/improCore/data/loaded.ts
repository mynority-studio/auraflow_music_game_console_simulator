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

import { parseStyle, type StyleData } from './sty-parser';
import { parseVoicingSettings, type VoicingSettings } from './fv-parser';
import type { VoicingTypeRef } from './sty-parser';

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

// ============================================================
// .fv presets — glob 加载 5 个 voicing preset(Closed-High / Closed-Low /
// Open-Low / Quartal / Shell)。Map<basename, VoicingSettings>。
// ============================================================
const fvModules = import.meta.glob('./voicings/*.fv', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

export const ALL_VOICING_SETTINGS_MAP: ReadonlyMap<string, VoicingSettings> = (() => {
    const map = new Map<string, VoicingSettings>();
    for (const [path, raw] of Object.entries(fvModules)) {
        try {
            const settings = parseVoicingSettings(raw);
            // basename without .fv extension(./voicings/Closed-High.fv → 'Closed-High')
            const basename = path.split('/').pop()?.replace(/\.fv$/, '') ?? path;
            map.set(basename, settings);
        } catch (e) {
            console.warn(`[ImproCore] fv parse failed:${path}`, e);
        }
    }
    return map;
})();

/**
 * 根据 .sty 的 voicing-type 字段路由到对应 .fv preset。
 * open → Open-Low / closed → Closed-High / quartal → Quartal / shell → Shell。
 * unknown / custom / 缺失 → Closed-High fallback。
 */
const VOICING_TYPE_TO_FV: Record<VoicingTypeRef, string> = {
    open:    'Open-Low',
    closed:  'Closed-High',
    quartal: 'Quartal',
    shell:   'Shell',
    custom:  'Closed-High',   // .sty custom 引用专属 .fv 我们暂不解析,fallback
    unknown: 'Closed-High',
};

export function getVoicingSettingsForType(type: VoicingTypeRef): VoicingSettings {
    const fvName = VOICING_TYPE_TO_FV[type] ?? 'Closed-High';
    return ALL_VOICING_SETTINGS_MAP.get(fvName)
        ?? ALL_VOICING_SETTINGS_MAP.get('Closed-High')
        ?? Array.from(ALL_VOICING_SETTINGS_MAP.values())[0]!;
}

/** @deprecated 用 getVoicingSettingsForType 替代;保留个别 import 兼容 */
export const CLOSED_HIGH_VOICING_SETTINGS: VoicingSettings = getVoicingSettingsForType('closed');

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
