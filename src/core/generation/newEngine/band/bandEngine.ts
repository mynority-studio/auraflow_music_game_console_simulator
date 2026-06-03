// ============================================================
// newEngine · band · BandEngine
// ------------------------------------------------------------
// 架构定稿 Part 4 / 3 表:GenerationRequest → BandSpec。
// Slice 1 tonal:从 styleHint 取 styleProfile,key/mode 可由 request 指定(默认 C 大调)。
// 当前为确定性映射,无随机选择(rng 在做风格内随机选项时再接入)。
// ============================================================

import { pc, type PitchClass } from '../foundation';
import type { BandSpec, Mode, StyleProfile } from './BandSpec';

export interface GenerationRequest {
  seed: number;
  styleHint: string;
  mood: string;
  targetDuration: number; // 秒
  key?: PitchClass;
  mode?: Mode;
}

const STYLE_PROFILES: Record<string, StyleProfile> = {
  lofi: { accompDensity: 0.4, padDensity: 0.6, melodyFreedom: 0.5, tensionCarrier: 'voicing', colorBudget: 0.4, beatStrictness: 0.4 },
  jazz: { accompDensity: 0.7, padDensity: 0.2, melodyFreedom: 0.8, tensionCarrier: 'both', colorBudget: 0.8, beatStrictness: 0.5 },
  pop: { accompDensity: 0.6, padDensity: 0.4, melodyFreedom: 0.4, tensionCarrier: 'melody', colorBudget: 0.3, beatStrictness: 0.8 },
  default: { accompDensity: 0.5, padDensity: 0.4, melodyFreedom: 0.5, tensionCarrier: 'both', colorBudget: 0.4, beatStrictness: 0.6 },
};

export function buildBandSpec(req: GenerationRequest): BandSpec {
  const style = Object.prototype.hasOwnProperty.call(STYLE_PROFILES, req.styleHint)
    ? req.styleHint
    : 'default';
  return {
    style,
    styleProfile: STYLE_PROFILES[style],
    tonalityKind: 'tonal',
    key: req.key ?? pc(0),
    mode: req.mode ?? 'major',
    instrumentPool: ['bass', 'comp', 'pad', 'lead', 'drum'],
  };
}
