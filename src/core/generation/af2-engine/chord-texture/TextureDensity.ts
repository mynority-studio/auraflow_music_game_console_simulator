// ============================================================
// TextureDensity — textureType 密度标签(Q+S 阶段共享)
// ============================================================
//
// Q 阶段(AccompGen)用 density filter:
//   energyLevel >= 7 → 偏 dense
//   energyLevel <= 3 → 偏 sparse
//
// S 阶段(Facade pickSongBase)用 medium filter:
//   per-song fork 从 sub-style pool 中抽 medium textureType 作为整曲 base
//
// 标签:
//   sparse:  长音 / 单击 / 整 bar 一击 — 留白,低能量
//   medium:  Charleston / clave / 走句 / arp — 中能量(适合 base)
//   dense:   8th pulse / 16th arp / anthem / ostinato — 高能量
// ============================================================

export type TextureDensity = 'sparse' | 'medium' | 'dense';

export const TEXTURE_DENSITY: Record<string, TextureDensity> = {
    // Sustained 系 — sparse
    'Single_Root':           'sparse',
    'Root_Octave':           'sparse',
    // PureWalk 系 — medium(bass 走句但 chord 不密)
    'Root_5_8':              'medium',
    'Root_7_5_8':            'medium',
    'Root_5_7_5':            'medium',
    'Root_Fifth_Bass':       'sparse',
    'Root_Octave_Pulse':     'medium',
    // WalkingBass — medium
    'Jazz_Walking_Bass':     'medium',
    // Bossa 系 — medium
    'Bossa_Piano_Arp':       'medium',
    'Bossa_Clave_Comping':   'medium',
    // Hemiola — medium
    'Jazz_Waltz_Hemiola':    'medium',
    // PureStab 系 — medium / dense
    'Stabs':                 'dense',
    'Syncopated_Stabs':      'medium',
    'Block_Chord_Staccato':  'medium',
    'RnB_16th_Funk_Stabs':   'dense',
    // GhostStab 系 — medium / dense
    'Blues_Stabs':           'medium',
    'RnB_Neo_Soul_Stab':     'dense',
    // ScratchSlap — dense(16th 密)/ medium
    'Funk_Guitar_Scratch':   'dense',
    'Slap_Bass_Line':        'medium',
    // ShuffleChop — medium / sparse
    'Blues_Chicago_Shuffle': 'medium',
    'Blues_Slow_Chops':      'sparse',
    // PopAnthem / PopBroken8th — dense
    'Pop_Anthem_Pulse':      'dense',
    'Pop_Broken_8ths_Sync':  'dense',
    // JazzCharleston — medium
    'Jazz_Charleston_Comp':  'medium',
    // PureArp — dense(16th 默认密)/ medium(8th)
    'Broken_Chord':          'medium',
    'Arpeggio_Flow':         'dense',
    'Arp_Seq':               'dense',
    'Pop_Piano_Arp_16ths':   'dense',
    // OstinatoLayered — dense
    'Ostinato_16s':          'dense',
    'Pop_Ostinato_Rock':     'dense',
    // Triplet — medium(12/8 三连不算 dense)
    'RnB_Gospel_Triplets':   'medium',
    'Blues_Slow_12_8_Arp':   'medium',
    // Roll — dense
    'RnB_Neo_Soul_Roll':     'dense',
    // BlockLayered — medium / sparse
    'Block_Chord':           'medium',
    'Jazz_Comping':          'sparse',  // sparse_off_beat 留白多
    // SweepProgressive — medium
    'Pop_Ballad_158_Sweep':  'medium',
    'RnB_Classic_Soul_Arp':  'medium',
    // GrooveDelay — medium
    'RnB_Laid_Back_Groove':  'medium',
    // SpecialVoicing — medium
    'Jazz_Drop_2_Comp':      'medium',
    // DoubleStopTremolo — dense
    'Blues_Tremolo_Comp':    'dense',
    // BoogieWalk — dense / medium
    'Blues_Boogie_Woogie':   'dense',
    'Blues_Shuffle_Bass':    'medium',
    // AnticipatedBlock — medium
    'Jazz_Red_Garland_Block':'medium',
    // CallAndResponse — sparse(melody silent 才填,稀疏)
    'Call_And_Response':     'sparse',
};
