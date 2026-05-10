// ============================================================
// Dave (Steady Pop Drums) — 参考 ALL_SOURCE_CODE.md / personas/DavePopDrums.ts
// ============================================================

import { MusicianProfile, RoleType, ContourType } from '../../types';
import { StyleId } from '../../config/StyleFlags';

export const DaveSteadyPopDrums: MusicianProfile = {
    id: 'drums_dave_pop',
    name: 'Dave (Steady Pop)',
    role: RoleType.Drums,
    styleId: StyleId.ModernPop,
    instrumentId: 3,  // Standard Drum Kit
    persona: {
        colorBias: 0.0,
        sparsityTendency: 0.6,    // 干净不杂
        contourPreference: ContourType.Random,
        syncopationAssault: 0.2,  // 极正拍
        dynamicRange: [45, 105],
        signatureLickProb: 0.05,
    },
    description: 'Straightforward 4/4 pop beats, very reliable.',
};
