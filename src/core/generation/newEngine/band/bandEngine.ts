// ============================================================
// newEngine · band · BandEngine
// ------------------------------------------------------------
// 架构定稿 Part 4 / 3 表:GenerationRequest → BandSpec。
// Slice 1 tonal:从 styleHint 取 styleProfile,key/mode 可由 request 指定(默认 C 大调)。
// 当前为确定性映射,无随机选择(rng 在做风格内随机选项时再接入)。
// ============================================================

import { pc, type PitchClass } from '../foundation';
import { MAJOR_SCALE, NATURAL_MINOR } from '../knowledge/scales';
import { modalScale, type ChurchMode } from '../knowledge/modes';
import type { BandSpec, Mode, StyleProfile, TonalityKind } from './BandSpec';

export interface GenerationRequest {
  seed: number;
  styleHint: string;
  mood: string;
  targetDuration: number; // 秒
  key?: PitchClass;
  mode?: Mode;
  tonalityKind?: TonalityKind; // 可显式请求 modal(否则由 styleHint 推断)
  modalMode?: ChurchMode;      // modal 时指定教会调式(默认 dorian)
}

const STYLE_PROFILES: Record<string, StyleProfile> = {
  lofi: { accompDensity: 0.4, padDensity: 0.6, melodyFreedom: 0.5, tensionCarrier: 'voicing', colorBudget: 0.4, beatStrictness: 0.4 },
  jazz: { accompDensity: 0.7, padDensity: 0.2, melodyFreedom: 0.8, tensionCarrier: 'both', colorBudget: 0.8, beatStrictness: 0.5 },
  pop: { accompDensity: 0.6, padDensity: 0.4, melodyFreedom: 0.4, tensionCarrier: 'melody', colorBudget: 0.3, beatStrictness: 0.8 },
  // modal:和声静态(低 colorBudget=不加功能离调)+ 旋律自由跑音阶(高 melodyFreedom)
  modal: { accompDensity: 0.45, padDensity: 0.6, melodyFreedom: 0.85, tensionCarrier: 'melody', colorBudget: 0.2, beatStrictness: 0.5 },
  default: { accompDensity: 0.5, padDensity: 0.4, melodyFreedom: 0.5, tensionCarrier: 'both', colorBudget: 0.4, beatStrictness: 0.6 },
};

export function buildBandSpec(req: GenerationRequest): BandSpec {
  const style = Object.prototype.hasOwnProperty.call(STYLE_PROFILES, req.styleHint)
    ? req.styleHint
    : 'default';
  const tonalityKind: TonalityKind = req.tonalityKind ?? (style === 'modal' ? 'modal' : 'tonal');
  const key = req.key ?? pc(0);
  const mode = req.mode ?? 'major';

  if (tonalityKind === 'modal') {
    const modalModeName: ChurchMode = req.modalMode ?? 'dorian'; // 默认 Dorian(最常用 modal vamp)
    return {
      style,
      styleProfile: STYLE_PROFILES[style],
      tonalityKind,
      key,
      mode,
      primaryScale: modalScale(key, modalModeName),
      modalModeName,
      instrumentPool: ['bass', 'comp', 'pad', 'lead', 'drum'],
    };
  }

  // tonal:primaryScale = 调内音阶(身份提示;实际逐和弦看 chordScaleMap)
  const diat = mode === 'minor' ? NATURAL_MINOR : MAJOR_SCALE;
  return {
    style,
    styleProfile: STYLE_PROFILES[style],
    tonalityKind,
    key,
    mode,
    primaryScale: diat.map((iv) => pc((key + iv) % 12)),
    instrumentPool: ['bass', 'comp', 'pad', 'lead', 'drum'],
  };
}
