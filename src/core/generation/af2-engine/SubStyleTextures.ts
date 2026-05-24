// ============================================================
// SubStyleTextures — mg sub-style × primaryTextures 集成(P 阶段)
// ============================================================
//
// 当前 AF2 STYLE_TEXTURE_POOL 仅 by 4 macro mgStyle(POP/JAZZ/BLUES/RNB),
// mg styleDictionary 有 15 sub-style 各自 cherry-pick textureType。
// 本模块移植 mg primaryTextures 数据,让 AF2 跨 sub-style 听感真分家:
//   Pop Ballad      vs  Modern Stadium Pop  (前者 Ballad arp,后者 anthem pulse)
//   Jazz Swing      vs  Bossa Nova           (前者 Charleston,后者 clave)
//   Dominant Blues  vs  Minor Blues          (前者全 dom 系列,后者保守)
//   Neo Soul R&B    vs  Motown Soul          (前者 Roll/Gospel,后者 Funk Stabs)
//
// 简化(P 阶段):
//   - SubStyle 只影响 AccompGen textureType pool;Arranger / Composer 仍 by mgStyle
//   - 跳过 mg 中 AF2 未实装的 textureType(Pop_Alberti_Lyrical /
//     Pop_Half_Arp_Sweep / Pop_Wave_16ths)— TextureTypeMapping 未覆盖会
//     fallback 'Single_Root',效果不准,所以从 primaryTextures 里去掉
//
// 选择机制(Facade):
//   1. options.generation.detectedSubStyle 显式传 → 用 user 值
//   2. PRNG `af2_substyle_${seed}` 从 SUB_STYLES_BY_MG[mgStyle] 抽
//   3. AccompGen pickTextureType:sub-style pool > section pool fallback
// ============================================================

import type { MgStyle } from '../../../state/EngineSelectionStore';

export type SubStyle =
    // POP(6)
    | 'PopBallad'           // 抒情慢歌,arp + ballad sweep
    | 'SynthPop'             // 合成器 pop,anthem + 8th sync
    | 'MaxMartinPop'         // 数学极简,死锁 8th + arp
    | 'AsianPopWalkdown'     // 根音下行,8th sync + anthem
    | 'ModernStadiumPop'     // 万能四和弦,anthem + ostinato
    | 'ModernTrap'           // 冰冷合成 + 808 + 三连击,Block + Broken
    // JAZZ(3)
    | 'JazzSwing'            // bebop,Charleston + Drop-2 + Red Garland
    | 'JazzChromaticDrop'    // 三全音替代下行,Drop-2 主导
    | 'BossaNova'            // clave 律动,Bossa + Hemiola
    // BLUES(3)
    | 'DominantBlues'        // 全 dom 系列(全部 5 个 blues 文饰)
    | 'MinorBlues'           // 保守 minor(Slow_12_8_Arp + Tremolo + Slow_Chops)
    | 'BluesTurnaround'      // 12-bar 回转,全 5 个 blues 文饰
    // RNB(3)
    | 'NeoSoulRnB'           // D'Angelo,Roll + Gospel triplets + Laid Back
    | 'GospelNeoSoul'        // 同 NeoSoulRnB(mg primaryTextures 相同)
    | 'MotownSoul';          // 切分 + Funk Stabs + Classic Soul

/**
 * Per mgStyle 候选 sub-style 池。Facade PRNG fork 从此抽,均匀分布。
 * Cross-mgStyle 不混(POP 调不会选 JazzSwing sub-style)。
 */
export const SUB_STYLES_BY_MG: Record<MgStyle, ReadonlyArray<SubStyle>> = {
    POP:   ['PopBallad', 'SynthPop', 'MaxMartinPop', 'AsianPopWalkdown', 'ModernStadiumPop', 'ModernTrap'],
    JAZZ:  ['JazzSwing', 'JazzChromaticDrop', 'BossaNova'],
    BLUES: ['DominantBlues', 'MinorBlues', 'BluesTurnaround'],
    RNB:   ['NeoSoulRnB', 'GospelNeoSoul', 'MotownSoul'],
};

/**
 * mg primaryTextures(已 filter 掉 AF2 未实装的 textureType)。
 * AccompGen pickTextureType 优先用此池,缺则 fallback 到 STYLE_TEXTURE_POOL[mgStyle][sectionType]。
 *
 * 数据来源:mg/src/lib/styleDictionary.ts _SUBSTYLES[*].primaryTextures(May 22)。
 */
export const SUB_STYLE_PRIMARY_TEXTURES: Record<SubStyle, ReadonlyArray<string>> = {
    // POP
    PopBallad:         ['Pop_Piano_Arp_16ths', 'Pop_Broken_8ths_Sync', 'Pop_Ballad_158_Sweep'],
    SynthPop:          ['Pop_Broken_8ths_Sync', 'Pop_Anthem_Pulse'],
    MaxMartinPop:      ['Pop_Piano_Arp_16ths', 'Pop_Broken_8ths_Sync', 'Pop_Ballad_158_Sweep'],
    AsianPopWalkdown:  ['Pop_Broken_8ths_Sync', 'Pop_Anthem_Pulse'],
    ModernStadiumPop:  ['Pop_Anthem_Pulse', 'Pop_Ostinato_Rock'],
    ModernTrap:        ['Block_Chord', 'Broken_Chord'],
    // JAZZ
    JazzSwing:         ['Jazz_Drop_2_Comp', 'Jazz_Charleston_Comp', 'Jazz_Red_Garland_Block'],
    JazzChromaticDrop: ['Jazz_Drop_2_Comp', 'Jazz_Charleston_Comp', 'Jazz_Red_Garland_Block'],
    BossaNova:         ['Bossa_Piano_Arp', 'Jazz_Waltz_Hemiola'],
    // BLUES
    DominantBlues:     ['Blues_Slow_12_8_Arp', 'Blues_Tremolo_Comp', 'Blues_Boogie_Woogie', 'Blues_Chicago_Shuffle', 'Blues_Slow_Chops'],
    MinorBlues:        ['Blues_Slow_12_8_Arp', 'Blues_Tremolo_Comp', 'Blues_Slow_Chops'],
    BluesTurnaround:   ['Blues_Slow_12_8_Arp', 'Blues_Tremolo_Comp', 'Blues_Boogie_Woogie', 'Blues_Chicago_Shuffle', 'Blues_Slow_Chops'],
    // RNB
    NeoSoulRnB:        ['RnB_Neo_Soul_Roll', 'RnB_Gospel_Triplets', 'RnB_Laid_Back_Groove'],
    GospelNeoSoul:     ['RnB_Neo_Soul_Roll', 'RnB_Gospel_Triplets', 'RnB_Laid_Back_Groove'],
    MotownSoul:        ['RnB_16th_Funk_Stabs', 'RnB_Classic_Soul_Arp'],
};
