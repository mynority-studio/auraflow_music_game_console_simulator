// ============================================================
// PhraseContourShaper — per-sectionType 目标音区 bias
// ============================================================
//
// 原 Af2MelodyGen.phraseContourBias(2026-05-25 拆 plugin)。
//
// progress ∈ [0, 1](chord 在 section 内的进度)→ MIDI bias(±半音):
//   Verse / PreChorus / default arch    — sin 曲线峰值 +6
//   Chorus / BuildUp                    upward — 线性 0 → +10
//   Bridge                              downward — 线性 +6 → 0
//   Outro / PreOutro                    downward — 线性 +6 → 0(逐渐下沉)
//   Intro                               steady — 中性 0
// ============================================================

import { SectionType } from '../../../types';
import type { MelodyPluginMeta } from './types';

export const PhraseContourShaper: MelodyPluginMeta & {
    bias(sectionType: SectionType, progress: number): number;
} = {
    name: 'PhraseContourShaper',
    version: '1.0',
    prngConsumption: 'zero',
    description: 'Per-sectionType 目标音区 bias(Verse arch / Chorus 上行 / Bridge+Outro 下行 / Intro steady)',

    bias(sectionType, progress) {
        switch (sectionType) {
            case SectionType.Chorus:
            case SectionType.BuildUp:
                return progress * 10;
            case SectionType.Bridge:
                return (1 - progress) * 6;
            case SectionType.Outro:
            case SectionType.PreOutro:
                return (1 - progress) * 6;
            case SectionType.Intro:
                return 0;
            case SectionType.Verse:
            case SectionType.PreChorus:
            default:
                return Math.sin(progress * Math.PI) * 6;
        }
    },
};
