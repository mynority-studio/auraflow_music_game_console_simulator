// ============================================================
// Nina (Chill Jazz Piano) — 参考 ALL_SOURCE_CODE.md / personas/NinaChillJazzPiano.ts
// ============================================================

import { MusicianProfile, RoleType, ContourType } from '../../types';
import { StyleId } from '../../config/StyleFlags';

export const NinaChillJazzPiano: MusicianProfile = {
    id: 'accomp_nina_chill_jazz',
    name: 'Nina (Chill Jazz Piano)',
    role: RoleType.AccompInst,
    styleId: StyleId.ChillJazz,
    instrumentId: 0,  // Grand Piano
    persona: {
        colorBias: 0.8,           // 重色彩 9/11
        sparsityTendency: 0.65,   // 给旋律留空间
        contourPreference: ContourType.Downward,
        syncopationAssault: 0.5,  // 放松切分
        dynamicRange: [30, 75],   // 极轻触
        signatureLickProb: 0.2,
    },
    description: 'Soft, sophisticated jazz voicings with laid-back timing and a gentle touch.',
};
