// ============================================================
// Marcus (Neo-Soul Keys) — 参考 ALL_SOURCE_CODE.md / personas/MarcusNeoSoulKeys.ts
// ============================================================

import { MusicianProfile, RoleType, ContourType } from '../../types';
import { StyleId } from '../../config/StyleFlags';

export const MarcusNeoSoulKeys: MusicianProfile = {
    id: 'accomp_marcus_neosoul',
    name: 'Marcus (Neo-Soul Keys)',
    role: RoleType.AccompInst,
    styleId: StyleId.NeoSoul,
    instrumentId: 1,  // Electric Piano
    persona: {
        colorBias: 0.9,           // 全开 9/11/13 着色
        sparsityTendency: 0.8,    // 极稀疏（多休止）
        contourPreference: ContourType.Downward,
        syncopationAssault: 0.9,  // 重切分
        dynamicRange: [40, 85],
        signatureLickProb: 0.4,
    },
    description: 'Extremely sparse but complex voicings, heavy syncopation.',
};
