// ============================================================
// Alex (Pop Piano) — 参考 ALL_SOURCE_CODE.md / personas/AlexPopPiano.ts
// ============================================================

import { MusicianProfile, RoleType, ContourType } from '../../types';
import { StyleId } from '../../config/StyleFlags';

export const AlexPopPiano: MusicianProfile = {
    id: 'accomp_alex_pop',
    name: 'Alex (Pop Piano)',
    role: RoleType.AccompInst,
    styleId: StyleId.ModernPop,
    instrumentId: 0,  // Grand Piano
    persona: {
        colorBias: 0.4,           // 适度色彩
        sparsityTendency: 0.5,    // 中等密度
        contourPreference: ContourType.Alternating,
        syncopationAssault: 0.3,  // 偏正拍
        dynamicRange: [35, 100],
        signatureLickProb: 0.15,
    },
    description: 'Solid pop piano accompaniment with moderate extensions.',
};
