// ============================================================
// SubStyleProgressions — mg sub-style × progressions 集成(P5 阶段)
// ============================================================
//
// P 阶段(SubStyleTextures)让 sub-style 影响 AccompGen textureType 偏好,
// P5 阶段让 sub-style 影响 Arranger 进行池,实现真正的 sub-style 风味分家:
//   Pop Ballad         vs  Modern Stadium Pop   (IV-V-iii-vi vs I-vi-IV-V)
//   Jazz Swing         vs  Bossa Nova            (ii-V-I cycle vs ii-V-VImaj7)
//   Neo Soul R&B       vs  Motown Soul           (m9 modal vs vi-ii-V anatole)
//
// 数据来源:mg/src/lib/styleDictionary.ts _SUBSTYLES[*].progressions(May 22)。
// 精选每 sub-style 3-5 个 Major + 2-3 个 Minor(不全搬,去重 + 去过长 secondary
// dom 模板)。
//
// 范围限制:
//   - BLUES 3 sub-style 不覆盖(12-bar 切片结构跟 SECTION_POOLS_BY_STYLE
//     紧耦合,sub-style 改 progression 会破 12-bar 完整性)。
//     BLUES sub-style 区分仍走 P 阶段 SubStyleTextures(textureType pool)。
//   - sub-style 进行池不分 sectionType — 跟 mg 一致;同 sub-style 内
//     verse vs chorus 仍可通过 hash 抽到不同 progression。
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
    // ============================================================
    // POP(6 sub-style)
    // ============================================================
    PopBallad: {
        Major: [
            // IV-V-iii-vi(Joe Hisaishi / 久石让 经典)
            [c('IV','maj',5,4), c('V','maj',7,5), c('iii','min',4,3), c('vi','min',9,6)],
            // I-V-vi-IV(Axis of Awesome)
            [c('I','maj',0,1), c('V','maj',7,5), c('vi','min',9,6), c('IV','maj',5,4)],
            // ii-V-I-IV(jazz-pop 转 IV)
            [c('ii','min',2,2), c('V','maj',7,5), c('I','maj',0,1), c('IV','maj',5,4)],
            // I-vi-ii-V(50s + Anatole 风)
            [c('I','maj',0,1), c('vi','min',9,6), c('ii','min',2,2), c('V','maj',7,5)],
            // vi-IV-I-V(sad 抒情)
            [c('vi','min',9,6), c('IV','maj',5,4), c('I','maj',0,1), c('V','maj',7,5)],
            // jazz-pop 加色(maj7 / 7sus4)
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
            // anthem-driven
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
        // mg 只给 1 个 Minor("VI-IV-i-v")— 我加几个 Major variation 完整化
        Major: [
            [c('I','maj',0,1), c('V','maj',7,5), c('vi','min',9,6), c('IV','maj',5,4)],
            [c('vi','min',9,6), c('IV','maj',5,4), c('I','maj',0,1), c('V','maj',7,5)],
            // Max Martin 标志:数学网格 + 短促
            [c('I','maj',0,1), c('IV','maj',5,4), c('V','maj',7,5), c('V','maj',7,5)],
        ],
        Minor: [
            // mg 原样
            [c('VI','maj',8,6), c('IV','maj',5,4), c('i','min',0,1), c('v','min',7,5)],
            [c('i','min',0,1), c('VI','maj',8,6), c('VII','maj',10,7), c('III','maj',3,3)],
        ],
    },
    AsianPopWalkdown: {
        // 根音下行线条 — Asian Pop 王道
        Major: [
            // mg 原样(I-V-vi-IV 加色)
            [c('I','add9',0,1), c('V','maj',7,5), c('vi','m7',9,6), c('IV','maj9',5,4)],
            // 真正的 walkdown(根音 0-11-9-7 半音下行)
            [c('I','maj',0,1), c('V','maj',7,5), c('vi','min',9,6), c('iii','min',4,3)],
            // vi-IV-iii-vi
            [c('vi','min',9,6), c('IV','maj',5,4), c('iii','min',4,3), c('vi','min',9,6)],
        ],
        Minor: [
            [c('i','min',0,1), c('VII','maj',10,7), c('VI','maj',8,6), c('v','min',7,5)],
            [c('i','min',0,1), c('VI','maj',8,6), c('III','maj',3,3), c('VII','maj',10,7)],
        ],
    },
    ModernStadiumPop: {
        // 万能四和弦 + add9 / sus4 顶部持续音
        Major: [
            // mg 原样(I add9 - V sus4 - vi m7 - IV add9)
            [c('I','add9',0,1), c('V','sus4',7,5), c('vi','m7',9,6), c('IV','add9',5,4)],
            // 4-chord 变形
            [c('vi','m7',9,6), c('IV','add9',5,4), c('I','add9',0,1), c('V','sus4',7,5)],
            [c('I','add9',0,1), c('IV','add9',5,4), c('vi','m7',9,6), c('V','sus4',7,5)],
        ],
        // Stadium 通常 Major 调,Minor 进行池继承 Pop default
        Minor: [
            [c('i','min',0,1), c('VI','maj',8,6), c('III','maj',3,3), c('VII','maj',10,7)],
        ],
    },
    ModernTrap: {
        // mg 原样(i-i-i-bII 冰冷)
        Minor: [
            [c('i','min',0,1), c('i','min',0,1), c('i','min',0,1), c('bII','maj',1,2)],
            // 几个变体
            [c('i','m7',0,1), c('bVI','maj7',8,6), c('bIII','maj7',3,3), c('bVII','7',10,7)],
            [c('i','min',0,1), c('VII','maj',10,7), c('i','min',0,1), c('VI','maj',8,6)],
        ],
        // Trap 通常 Minor 调,Major 进行池继承 Pop default
        Major: [
            [c('I','maj',0,1), c('vi','min',9,6), c('IV','maj',5,4), c('V','maj',7,5)],
        ],
    },

    // ============================================================
    // JAZZ(3 sub-style)
    // ============================================================
    JazzSwing: {
        Major: [
            // ii-V-I-vi(标准 turnaround)
            [c('ii','m7',2,2), c('V','7',7,5), c('I','maj7',0,1), c('vi','m7',9,6)],
            // I-vi-ii-V(Anatole)
            [c('I','maj7',0,1), c('vi','m7',9,6), c('ii','m7',2,2), c('V','7',7,5)],
            // iii-vi-ii-V(descending mediant + cycle)
            [c('iii','m7',4,3), c('vi','m7',9,6), c('ii','m7',2,2), c('V','7',7,5)],
            // IV-V-iii-vi(jazz approach)
            [c('IV','maj7',5,4), c('V','7',7,5), c('iii','m7',4,3), c('vi','m7',9,6)],
            // Imaj7-V7-vim7-IVmaj7(POP-jazz fusion)
            [c('I','maj7',0,1), c('V','7',7,5), c('vi','m7',9,6), c('IV','maj7',5,4)],
        ],
        Minor: [
            // 标准 minor ii-V-i
            [c('ii','m7b5',2,2), c('V','7b9',7,5), c('i','m7',0,1), c('iv','m7',5,4)],
            // modal jazz
            [c('i','m7',0,1), c('bVI','maj7',8,6), c('bIII','maj7',3,3), c('bVII','7',10,7)],
            // i-iv-V-i 含 V7b9
            [c('i','m7',0,1), c('iv','m7',5,4), c('V','7b9',7,5), c('i','m7',0,1)],
        ],
    },
    JazzChromaticDrop: {
        // 三全音替代 → 半音 bass 下行
        Major: [
            // mg 原样:I-bII7-iim7-V7(bII7 替 V/V,bass 0-1-2-7)
            [c('I','maj7',0,1), c('bII','7',1,2), c('ii','m7',2,2), c('V','7',7,5)],
            // 标准 ii-V-I + tritone sub on V
            [c('ii','m7',2,2), c('bII','7',1,2), c('I','maj7',0,1), c('vi','m7',9,6)],
            // bIII7-bVI7-V7(连续 tritone descent)
            [c('I','maj7',0,1), c('bIII','7',3,3), c('bII','7',1,2), c('V','7',7,5)],
        ],
        Minor: [
            // tritone sub in minor context
            [c('i','m7',0,1), c('bII','7',1,2), c('iv','m7',5,4), c('bVII','7',10,7)],
            [c('ii','m7b5',2,2), c('bII','7',1,2), c('i','m7',0,1), c('i','m7',0,1)],
        ],
    },
    BossaNova: {
        // bossa clave 律动 + jazz harmony
        Major: [
            // ii-V-I-VImaj7(bossa cycle)
            [c('ii','m7',2,2), c('V','7',7,5), c('I','maj7',0,1), c('vi','m7',9,6)],
            // Imaj7-VIm7-iim7-V7(Anatole bossa)
            [c('I','maj7',0,1), c('vi','m7',9,6), c('ii','m7',2,2), c('V','7',7,5)],
            // IV-iii-ii-I(descending bossa)
            [c('IV','maj7',5,4), c('iii','m7',4,3), c('ii','m7',2,2), c('I','maj7',0,1)],
        ],
        Minor: [
            [c('ii','m7b5',2,2), c('V','7b9',7,5), c('i','m7',0,1), c('iv','m7',5,4)],
            [c('i','m7',0,1), c('iv','m7',5,4), c('bVII','7',10,7), c('bIII','maj7',3,3)],
        ],
    },

    // ============================================================
    // RNB(3 sub-style)
    // ============================================================
    NeoSoulRnB: {
        Major: [
            // mg 原样 / neo-soul 标志
            [c('ii','m9',2,2), c('V','7sus4',7,5), c('I','maj9',0,1), c('iii','m9',4,3)],
            // Imaj7-iiim7-vim7-IVmaj7(neo-soul descending)
            [c('I','maj7',0,1), c('iii','m7',4,3), c('vi','m7',9,6), c('IV','maj7',5,4)],
            // ii_m9-V13-iiim9-vim9
            [c('ii','m9',2,2), c('V','13',7,5), c('iii','m9',4,3), c('vi','m9',9,6)],
            // IVmaj9-V13-iiim9-vim9
            [c('IV','maj9',5,4), c('V','13',7,5), c('iii','m9',4,3), c('vi','m9',9,6)],
        ],
        Minor: [
            // Stevie modal
            [c('i','m9',0,1), c('bIII','maj9',3,3), c('bVI','maj9',8,6), c('bVII','7',10,7)],
            // D'Angelo ballad
            [c('iv','m9',5,4), c('V','7sus4',7,5), c('i','m9',0,1), c('bVI','maj9',8,6)],
            // i-iv-bVII-bIII
            [c('i','m7',0,1), c('iv','m7',5,4), c('bVII','7',10,7), c('bIII','maj7',3,3)],
        ],
    },
    GospelNeoSoul: {
        // mg 原样(单 progression — vii_m7b5-III7#9-vim11-bVI dim7)
        // 高度色彩化 gospel
        Major: [
            [c('vii','m7b5',11,7), c('III','7#9',4,3), c('vi','m11',9,6), c('bVI','dim7',8,6)],
            // 加色 ii-V-I
            [c('ii','m9',2,2), c('V','7b9',7,5), c('I','maj9',0,1), c('vi','m11',9,6)],
            // gospel descending
            [c('I','maj9',0,1), c('vii','m7b5',11,7), c('vi','m11',9,6), c('V','7b9',7,5)],
        ],
        Minor: [
            // gospel minor
            [c('i','m9',0,1), c('bVI','maj9',8,6), c('iv','m9',5,4), c('V','7b9',7,5)],
            [c('ii','m7b5',2,2), c('V','7b9',7,5), c('i','m9',0,1), c('bVI','maj9',8,6)],
        ],
    },
    MotownSoul: {
        Major: [
            // mg 原样:I-vi-ii-V(经典 Anatole / 50s)
            [c('I','maj',0,1), c('vi','min',9,6), c('ii','m7',2,2), c('V','7',7,5)],
            // I-V-vi-IV(motown anthem)
            [c('I','maj',0,1), c('V','maj',7,5), c('vi','min',9,6), c('IV','maj',5,4)],
            // Imaj7-vim7-iim7-V7(motown jazz 边缘)
            [c('I','maj7',0,1), c('vi','m7',9,6), c('ii','m7',2,2), c('V','7',7,5)],
            // ii-V-I-VI(soul cycle)
            [c('ii','m7',2,2), c('V','7',7,5), c('I','maj7',0,1), c('vi','m7',9,6)],
        ],
        Minor: [
            [c('i','m7',0,1), c('iv','m7',5,4), c('V','7',7,5), c('i','m7',0,1)],
            [c('i','min',0,1), c('VI','maj',8,6), c('III','maj',3,3), c('VII','maj',10,7)],
        ],
    },

    // BLUES 3 sub-style 不在此覆盖 — 12-bar 切片结构由 SECTION_POOLS_BY_STYLE
    // 维护;sub-style 区分仅走 SubStyleTextures(textureType 池)。
};
