// ============================================================
// newEngine · band · BandSpec(音乐身份 + regime)
// ------------------------------------------------------------
// 架构定稿 Part 2.2 / 4。tonalityKind 一等 regime 开关(Slice 1 只跑 tonal)。
// Slice 1 字段:style/styleProfile/tonalityKind/key/mode/instrumentPool;
// scalePolicy/roleMap 等待 Instrumental/modal 消费者到位再补(轻耦合,按需扩)。
// ============================================================

import type { PitchClass } from '../foundation';

export type TonalityKind = 'tonal' | 'modal';
export type Mode = 'major' | 'minor';

export interface StyleProfile {
  accompDensity: number;   // 0..1
  padDensity: number;
  melodyFreedom: number;
  tensionCarrier: 'melody' | 'voicing' | 'both';
  colorBudget: number;
  beatStrictness: number;
}

export type InstrumentRoleName = 'bass' | 'comp' | 'pad' | 'lead' | 'drum';

export interface BandSpec {
  style: string;
  styleProfile: StyleProfile;
  tonalityKind: TonalityKind;
  key: PitchClass;
  mode: Mode;
  instrumentPool: InstrumentRoleName[];
}
