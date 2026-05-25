// ============================================================
// loaded.ts — 启动时加载 + 验证 3 个数据文件
// ============================================================
//
// Vite ?raw import 把数据文件 inline 进 bundle(同步加载,无 async)。
// 解析失败直接 throw(在 build 时不可能成功只在运行时;此时 caller 决定 fallback)。
//
// 提供:
//   BALLAD_STYLE / SWING_STYLE — 解析好的 StyleData
//   CLOSED_HIGH_VOICING_SETTINGS — 解析好的 VoicingSettings
//   ALL_STYLES — 数组,key = style 名
//   getStyleByName(name) — 查表 helper
//
// 单元自检函数 selfTest() — console.log 解析摘要,供 dev 验证。
// ============================================================

import balladStyRaw from './styles/ballad.sty?raw';
import swingStyRaw from './styles/swing.sty?raw';
import closedHighFvRaw from './voicings/Closed-High.fv?raw';
import { parseStyle, type StyleData } from './sty-parser';
import { parseVoicingSettings, type VoicingSettings } from './fv-parser';

export const BALLAD_STYLE: StyleData = parseStyle(balladStyRaw);
export const SWING_STYLE: StyleData = parseStyle(swingStyRaw);
export const CLOSED_HIGH_VOICING_SETTINGS: VoicingSettings = parseVoicingSettings(closedHighFvRaw);

export const ALL_STYLES: ReadonlyArray<StyleData> = [BALLAD_STYLE, SWING_STYLE];

export function getStyleByName(name: string): StyleData | null {
  for (const s of ALL_STYLES) {
    if (s.name === name) return s;
  }
  return null;
}

/**
 * Dev self-test — console.log 解析摘要。
 * 不在 production 自动跑,caller 显式 import 调用。
 */
export function selfTest(): void {
  console.log('[ImproCore] BALLAD_STYLE:', {
    name: BALLAD_STYLE.name,
    swing: BALLAD_STYLE.swing,
    voicingType: BALLAD_STYLE.voicingType,
    bassPatterns: BALLAD_STYLE.bassPatterns.length,
    chordPatterns: BALLAD_STYLE.chordPatterns.length,
    drumPatterns: BALLAD_STYLE.drumPatterns.length,
    firstBassPattern: BALLAD_STYLE.bassPatterns[0],
    firstChordPattern: BALLAD_STYLE.chordPatterns[0],
    firstDrumPattern: BALLAD_STYLE.drumPatterns[0],
  });
  console.log('[ImproCore] SWING_STYLE:', {
    name: SWING_STYLE.name,
    swing: SWING_STYLE.swing,
    bassPatterns: SWING_STYLE.bassPatterns.length,
    chordPatterns: SWING_STYLE.chordPatterns.length,
    drumPatterns: SWING_STYLE.drumPatterns.length,
  });
  console.log('[ImproCore] CLOSED_HIGH_VOICING_SETTINGS:', CLOSED_HIGH_VOICING_SETTINGS);
}
