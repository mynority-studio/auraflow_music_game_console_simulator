// ============================================================
// SubStyleProgressions — POP sub-style × progressions(POP-only flat 化后)
// ============================================================
//
// 仅保留 6 个 POP sub-style 的进行池。AF2 已退化为 POP-only,JAZZ / BLUES / RNB
// sub-style 进行池全部删除。
//
// 数据来源:mg/src/lib/styleDictionary.ts _SUBSTYLES[*].progressions(May 22)。
// 精选每 sub-style 3-5 个 Major + 2-3 个 Minor。
// ============================================================

import type { Af2AbstractStep } from './Af2Arranger';
import type { SubStyle } from './SubStyleTextures';

type ProgressionPool = ReadonlyArray<ReadonlyArray<Af2AbstractStep>>;

// 紧凑 chord def builder
const c = (roman: string, type: string, rootOffset: number, scaleDegree: number): Af2AbstractStep =>
    ({ roman, type, rootOffset, scaleDegree });

export interface SubStyleProgressionPool {
    Major?: ProgressionPool;
    Minor?: ProgressionPool;
}

export const SUB_STYLE_PROGRESSIONS: Partial<Record<SubStyle, SubStyleProgressionPool>> = {
    PopBallad: {
        Major: [
            [c('IV','maj',5,4), c('V','maj',7,5), c('iii','min',4,3), c('vi','min',9,6)],
            [c('I','maj',0,1), c('V','maj',7,5), c('vi','min',9,6), c('IV','maj',5,4)],
            [c('ii','min',2,2), c('V','maj',7,5), c('I','maj',0,1), c('IV','maj',5,4)],
            [c('I','maj',0,1), c('vi','min',9,6), c('ii','min',2,2), c('V','maj',7,5)],
            [c('vi','min',9,6), c('IV','maj',5,4), c('I','maj',0,1), c('V','maj',7,5)],
            [c('ii','m7',2,2), c('V','7sus4',7,5), c('I','maj9',0,1), c('iii','m7',4,3)],
        ],
        Minor: [
            [c('i','min',0,1), c('VI','maj',8,6), c('III','maj',3,3), c('VII','maj',10,7)],
            [c('iv','min',5,4), c('v','min',7,5), c('i','min',0,1), c('VI','maj',8,6)],
            [c('i','min',0,1), c('iv','min',5,4), c('V','maj',7,5), c('i','min',0,1)],
            [c('i','add9',0,1), c('iv','m9',5,4), c('VII','7',10,7), c('III','maj7',3,3)],
        ],
    },
    SynthPop: {
        Major: [
            [c('I','maj',0,1), c('V','maj',7,5), c('vi','min',9,6), c('IV','maj',5,4)],
            [c('vi','min',9,6), c('IV','maj',5,4), c('I','maj',0,1), c('V','maj',7,5)],
            [c('I','maj',0,1), c('IV','maj',5,4), c('V','maj',7,5), c('vi','min',9,6)],
            [c('IV','maj',5,4), c('I','maj',0,1), c('V','maj',7,5), c('vi','min',9,6)],
        ],
        Minor: [
            [c('i','min',0,1), c('VII','maj',10,7), c('VI','maj',8,6), c('VII','maj',10,7)],
            [c('i','min',0,1), c('VI','maj',8,6), c('III','maj',3,3), c('VII','maj',10,7)],
        ],
    },
    MaxMartinPop: {
        Major: [
            [c('I','maj',0,1), c('V','maj',7,5), c('vi','min',9,6), c('IV','maj',5,4)],
            [c('vi','min',9,6), c('IV','maj',5,4), c('I','maj',0,1), c('V','maj',7,5)],
            [c('I','maj',0,1), c('IV','maj',5,4), c('V','maj',7,5), c('V','maj',7,5)],
        ],
        Minor: [
            [c('VI','maj',8,6), c('IV','maj',5,4), c('i','min',0,1), c('v','min',7,5)],
            [c('i','min',0,1), c('VI','maj',8,6), c('VII','maj',10,7), c('III','maj',3,3)],
        ],
    },
    AsianPopWalkdown: {
        Major: [
            [c('I','add9',0,1), c('V','maj',7,5), c('vi','m7',9,6), c('IV','maj9',5,4)],
            [c('I','maj',0,1), c('V','maj',7,5), c('vi','min',9,6), c('iii','min',4,3)],
            [c('vi','min',9,6), c('IV','maj',5,4), c('iii','min',4,3), c('vi','min',9,6)],
        ],
        Minor: [
            [c('i','min',0,1), c('VII','maj',10,7), c('VI','maj',8,6), c('v','min',7,5)],
            [c('i','min',0,1), c('VI','maj',8,6), c('III','maj',3,3), c('VII','maj',10,7)],
        ],
    },
    ModernStadiumPop: {
        Major: [
            [c('I','add9',0,1), c('V','sus4',7,5), c('vi','m7',9,6), c('IV','add9',5,4)],
            [c('vi','m7',9,6), c('IV','add9',5,4), c('I','add9',0,1), c('V','sus4',7,5)],
            [c('I','add9',0,1), c('IV','add9',5,4), c('vi','m7',9,6), c('V','sus4',7,5)],
        ],
        Minor: [
            [c('i','min',0,1), c('VI','maj',8,6), c('III','maj',3,3), c('VII','maj',10,7)],
        ],
    },
    ModernTrap: {
        Minor: [
            [c('i','min',0,1), c('i','min',0,1), c('i','min',0,1), c('bII','maj',1,2)],
            [c('i','m7',0,1), c('bVI','maj7',8,6), c('bIII','maj7',3,3), c('bVII','7',10,7)],
            [c('i','min',0,1), c('VII','maj',10,7), c('i','min',0,1), c('VI','maj',8,6)],
        ],
        Major: [
            [c('I','maj',0,1), c('vi','min',9,6), c('IV','maj',5,4), c('V','maj',7,5)],
        ],
    },
};
