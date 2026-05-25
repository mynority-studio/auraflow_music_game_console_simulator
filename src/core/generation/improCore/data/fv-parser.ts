// ============================================================
// fv-parser.ts — .fv voicing preset → VoicingSettings
// ============================================================
//
// 解析 Impro-Visor .fv 文件(每行一个 `(field-name value)`):
//
//   (comments "Auto Voicing Preset File. ...")
//   (LH-lower-limit 50)
//   (RH-lower-limit 50)
//   (LH-upper-limit 69)
//   ...
//   (invert-9th off)
//   (voice-all off)
//   (rootless off)
//
// 输出 VoicingSettings — 23 个数字 / boolean 字段。
// 缺失字段用 Impro-Visor 默认值(从 Closed-High.fv 参考)。
// ============================================================

import type { Polylist } from './polylist';
import { isAtom } from './polylist';
import { readMultiSexpr } from './sexpr-reader';

export interface VoicingSettings {
  // MIDI range
  lhLowerLimit: number;
  lhUpperLimit: number;
  rhLowerLimit: number;
  rhUpperLimit: number;
  // Spread(LH / RH 内最低最高 MIDI 距离上限)
  lhSpread: number;
  rhSpread: number;
  // 数量上下限
  lhMinNotes: number;
  lhMaxNotes: number;
  rhMinNotes: number;
  rhMaxNotes: number;
  // Motion bias
  prefMotion: number;        // -1 / 0 / +1
  prefMotionRange: number;
  // VoicingGenerator 加权参数
  prevVoicingMultiplier: number;
  halfStepMultiplier: number;
  fullStepMultiplier: number;
  lhColorPriority: number;
  rhColorPriority: number;
  maxPriority: number;
  priorityMultiplier: number;
  repeatMultiplier: number;
  halfStepReducer: number;
  fullStepReducer: number;
  leftMinInterval: number;
  rightMinInterval: number;
  // Flags
  invertM9th: boolean;
  voiceAll: boolean;
  rootless: boolean;
}

/**
 * Closed-High.fv 默认值 — 字段缺失时 fallback。
 */
export const DEFAULT_VOICING_SETTINGS: VoicingSettings = {
  lhLowerLimit: 50,
  lhUpperLimit: 69,
  rhLowerLimit: 50,
  rhUpperLimit: 69,
  lhSpread: 12,
  rhSpread: 12,
  lhMinNotes: 2,
  lhMaxNotes: 3,
  rhMinNotes: 3,
  rhMaxNotes: 4,
  prefMotion: 0,
  prefMotionRange: 1,
  prevVoicingMultiplier: 34,
  halfStepMultiplier: 23,
  fullStepMultiplier: 23,
  lhColorPriority: 0,
  rhColorPriority: 0,
  maxPriority: 10,
  priorityMultiplier: 7,
  repeatMultiplier: 5,
  halfStepReducer: 10,
  fullStepReducer: 10,
  leftMinInterval: 0,
  rightMinInterval: 0,
  invertM9th: false,
  voiceAll: false,
  rootless: false,
};

function valueOrDefault(value: Polylist | string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  if (isAtom(value)) return value;
  return fallback;
}

function parseBoolField(s: string): boolean {
  return s === 'on' || s === 'true' || s === '1';
}

/**
 * 解析 .fv 字符串 → VoicingSettings。
 * 缺失字段从 DEFAULT_VOICING_SETTINGS 填。
 */
export function parseVoicingSettings(src: string): VoicingSettings {
  const lists = readMultiSexpr(src);
  // 建索引:fieldName → value(atom)
  const byKey = new Map<string, string>();
  for (const list of lists) {
    if (list.length < 1) continue;
    const head = list[0];
    if (!isAtom(head)) continue;
    const v = list.length > 1 ? list[1]! : undefined;
    byKey.set(head, valueOrDefault(v, ''));
  }
  const num = (key: string, fallback: number): number => {
    const s = byKey.get(key);
    if (!s) return fallback;
    const n = parseFloat(s);
    return isNaN(n) ? fallback : n;
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const s = byKey.get(key);
    if (s === undefined) return fallback;
    return parseBoolField(s);
  };

  const d = DEFAULT_VOICING_SETTINGS;
  return {
    lhLowerLimit:          num('LH-lower-limit',          d.lhLowerLimit),
    lhUpperLimit:          num('LH-upper-limit',          d.lhUpperLimit),
    rhLowerLimit:          num('RH-lower-limit',          d.rhLowerLimit),
    rhUpperLimit:          num('RH-upper-limit',          d.rhUpperLimit),
    lhSpread:              num('LH-spread',               d.lhSpread),
    rhSpread:              num('RH-spread',               d.rhSpread),
    lhMinNotes:            num('LH-min-notes',            d.lhMinNotes),
    lhMaxNotes:            num('LH-max-notes',            d.lhMaxNotes),
    rhMinNotes:            num('RH-min-notes',            d.rhMinNotes),
    rhMaxNotes:            num('RH-max-notes',            d.rhMaxNotes),
    prefMotion:            num('pref-motion',             d.prefMotion),
    prefMotionRange:       num('pref-motion-range',       d.prefMotionRange),
    prevVoicingMultiplier: num('prev-voicing-multiplier', d.prevVoicingMultiplier),
    halfStepMultiplier:    num('half-step-multiplier',    d.halfStepMultiplier),
    fullStepMultiplier:    num('full-step-multiplier',    d.fullStepMultiplier),
    lhColorPriority:       num('LH-color-priority',       d.lhColorPriority),
    rhColorPriority:       num('RH-color-priority',       d.rhColorPriority),
    maxPriority:           num('max-priority',            d.maxPriority),
    priorityMultiplier:    num('priority-multiplier',     d.priorityMultiplier),
    repeatMultiplier:      num('repeat-multiplier',       d.repeatMultiplier),
    halfStepReducer:       num('half-step-reducer',       d.halfStepReducer),
    fullStepReducer:       num('full-step-reducer',       d.fullStepReducer),
    leftMinInterval:       num('left-min-interval',       d.leftMinInterval),
    rightMinInterval:      num('right-min-interval',      d.rightMinInterval),
    invertM9th:            bool('invert-9th',             d.invertM9th),
    voiceAll:              bool('voice-all',              d.voiceAll),
    rootless:              bool('rootless',               d.rootless),
  };
}
