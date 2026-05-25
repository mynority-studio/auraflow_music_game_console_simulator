// ============================================================
// SubStyleTextures — POP sub-style × primaryTextures(POP-only flat 化后)
// ============================================================
//
// 仅保留 6 个 POP sub-style 与其 primaryTextures。AF2 已退化为 POP-only,
// JAZZ / BLUES / RNB sub-style 全部删除。
//
// 选择机制(Facade):
//   1. options.generation.detectedSubStyle 显式传 → 用 user 值(必须在 SUB_STYLES_POP 内)
//   2. PRNG `af2_substyle_${seed}` 从 SUB_STYLES_POP 抽
//   3. AccompGen pickTextureType:sub-style pool > section pool fallback
// ============================================================

export type SubStyle =
    | 'PopBallad'           // 抒情慢歌,arp + ballad sweep
    | 'SynthPop'             // 合成器 pop,anthem + 8th sync
    | 'MaxMartinPop'         // 数学极简,死锁 8th + arp
    | 'AsianPopWalkdown'     // 根音下行,8th sync + anthem
    | 'ModernStadiumPop'     // 万能四和弦,anthem + ostinato
    | 'ModernTrap';          // 冰冷合成 + 808 + 三连击,Block + Broken

/**
 * POP sub-style 候选池。Facade PRNG fork 从此抽,均匀分布。
 */
export const SUB_STYLES_POP: ReadonlyArray<SubStyle> = [
    'PopBallad', 'SynthPop', 'MaxMartinPop', 'AsianPopWalkdown', 'ModernStadiumPop', 'ModernTrap',
];

/**
 * mg primaryTextures(已 filter 掉 AF2 未实装的 textureType)。
 * AccompGen pickTextureType 优先用此池,缺则 fallback 到 SECTION_TEXTURE_POOL[sectionType]。
 */
export const SUB_STYLE_PRIMARY_TEXTURES: Record<SubStyle, ReadonlyArray<string>> = {
    PopBallad:         ['Pop_Piano_Arp_16ths', 'Pop_Broken_8ths_Sync', 'Pop_Ballad_158_Sweep'],
    SynthPop:          ['Pop_Broken_8ths_Sync', 'Pop_Anthem_Pulse'],
    MaxMartinPop:      ['Pop_Piano_Arp_16ths', 'Pop_Broken_8ths_Sync', 'Pop_Ballad_158_Sweep'],
    AsianPopWalkdown:  ['Pop_Broken_8ths_Sync', 'Pop_Anthem_Pulse'],
    ModernStadiumPop:  ['Pop_Anthem_Pulse', 'Pop_Ostinato_Rock'],
    ModernTrap:        ['Block_Chord', 'Broken_Chord'],
};
