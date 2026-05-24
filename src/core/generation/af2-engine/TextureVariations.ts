// ============================================================
// TextureVariations — Per-song Base + Section Variation 升降级表(S 阶段)
// ============================================================
//
// S 阶段(2026-05-24):per-song fork 一个 base textureType(整曲贯穿),
// 在 section 切换时按 energy 升级 / 降级到"同主题相关 family":
//   energy >= 7 (Chorus/Drop)     → VARIATIONS[base].dense  (升级,激动)
//   energy <= 3 (Intro/Outro/Break) → VARIATIONS[base].sparse(降级,留白)
//   energy 4-6 (Verse/Bridge/etc)   → base 直接用(整曲 60-70% bar 律动统一)
//
// 设计原则(用户讨论 + 那个 AI"动机克隆法则"):
//   1. 升降级目标尽量同主题(POP_Anthem 升 POP_Arp_16ths,不跳去 RnB)
//   2. sparse fallback 多数走 Single_Root / Sustained 系(最稳留白)
//   3. dense fallback 走 16th / pulse / ostinato 系(最激动)
//   4. 已是 dense 的 textureType(如 Pop_Piano_Arp_16ths)升级走更密(Ostinato_16s)
//   5. 已是 sparse 的 textureType(如 Single_Root)降级保持自己
//
// 数据来源:N+N5 阶段 TEXTURE_DENSITY 标签 + 风格主题相关性人工 curation。
// ============================================================

export interface TextureVariation {
    /** Energy <= 3 时使用(段落留白 — Intro/Outro/Break)*/
    sparse: string;
    /** Energy >= 7 时使用(段落激动 — Chorus/Drop)*/
    dense: string;
}

export const TEXTURE_VARIATIONS: Record<string, TextureVariation> = {
    // ============================================================
    // Sustained 系(都是 sparse,升级到主题相关 dense)
    // ============================================================
    'Single_Root':           { sparse: 'Single_Root',     dense: 'Pop_Anthem_Pulse'    },
    'Root_Octave':           { sparse: 'Single_Root',     dense: 'Pop_Anthem_Pulse'    },

    // ============================================================
    // PureWalk 系(bass walking,升降级走 Sustained / Pop_Anthem)
    // ============================================================
    'Root_5_8':              { sparse: 'Root_Octave',     dense: 'Pop_Anthem_Pulse'    },
    'Root_7_5_8':            { sparse: 'Root_Octave',     dense: 'Pop_Anthem_Pulse'    },
    'Root_5_7_5':            { sparse: 'Root_Octave',     dense: 'Pop_Anthem_Pulse'    },
    'Root_Fifth_Bass':       { sparse: 'Single_Root',     dense: 'Pop_Anthem_Pulse'    },
    'Root_Octave_Pulse':     { sparse: 'Root_Octave',     dense: 'Pop_Anthem_Pulse'    },

    // ============================================================
    // WalkingBass(JAZZ,降级到 Single_Root,升级到 Jazz_Drop_2)
    // ============================================================
    'Jazz_Walking_Bass':     { sparse: 'Single_Root',     dense: 'Jazz_Drop_2_Comp'    },

    // ============================================================
    // Bossa 系(JAZZ,降级 Single_Root,升级到更密 Drop-2)
    // ============================================================
    'Bossa_Piano_Arp':       { sparse: 'Single_Root',     dense: 'Jazz_Drop_2_Comp'    },
    'Bossa_Clave_Comping':   { sparse: 'Single_Root',     dense: 'Bossa_Piano_Arp'     },

    // ============================================================
    // Hemiola(JAZZ Bridge 用,升降级到 Jazz 系)
    // ============================================================
    'Jazz_Waltz_Hemiola':    { sparse: 'Single_Root',     dense: 'Jazz_Charleston_Comp'},

    // ============================================================
    // PureStab 系(stab 已 medium-dense,降级 Sustained,升级 16th)
    // ============================================================
    'Stabs':                 { sparse: 'Single_Root',     dense: 'Ostinato_16s'        },
    'Syncopated_Stabs':      { sparse: 'Single_Root',     dense: 'Stabs'               },
    'Block_Chord_Staccato':  { sparse: 'Single_Root',     dense: 'Stabs'               },
    'RnB_16th_Funk_Stabs':   { sparse: 'Single_Root',     dense: 'RnB_Neo_Soul_Stab'   },

    // ============================================================
    // GhostStab(RnB / Blues)
    // ============================================================
    'Blues_Stabs':           { sparse: 'Single_Root',     dense: 'Blues_Boogie_Woogie' },
    'RnB_Neo_Soul_Stab':     { sparse: 'Single_Root',     dense: 'RnB_Neo_Soul_Roll'   },

    // ============================================================
    // ScratchSlap(funk,升降级走 stab)
    // ============================================================
    'Funk_Guitar_Scratch':   { sparse: 'Single_Root',     dense: 'RnB_Neo_Soul_Stab'   },
    'Slap_Bass_Line':        { sparse: 'Single_Root',     dense: 'RnB_16th_Funk_Stabs' },

    // ============================================================
    // ShuffleChop(BLUES,降级 Single_Root,升级 Boogie)
    // ============================================================
    'Blues_Chicago_Shuffle': { sparse: 'Single_Root',     dense: 'Blues_Boogie_Woogie' },
    'Blues_Slow_Chops':      { sparse: 'Single_Root',     dense: 'Blues_Chicago_Shuffle'},

    // ============================================================
    // 族 C 8th Pulse — POP 主战场(Pop Ballad / Stadium / Synth Pop)
    // ============================================================
    'Pop_Anthem_Pulse':      { sparse: 'Single_Root',     dense: 'Pop_Piano_Arp_16ths' },
    'Pop_Broken_8ths_Sync':  { sparse: 'Single_Root',     dense: 'Pop_Piano_Arp_16ths' },
    'Jazz_Charleston_Comp':  { sparse: 'Single_Root',     dense: 'Jazz_Drop_2_Comp'    },

    // ============================================================
    // 族 D 16th Dense — PureArp / OstinatoLayered / Triplet / Roll
    // ============================================================
    'Broken_Chord':          { sparse: 'Single_Root',     dense: 'Arpeggio_Flow'       },
    'Arpeggio_Flow':         { sparse: 'Broken_Chord',    dense: 'Pop_Piano_Arp_16ths' },
    'Arp_Seq':               { sparse: 'Broken_Chord',    dense: 'Pop_Piano_Arp_16ths' },
    'Pop_Piano_Arp_16ths':   { sparse: 'Pop_Broken_8ths_Sync', dense: 'Ostinato_16s'   },
    'Ostinato_16s':          { sparse: 'Pop_Anthem_Pulse',dense: 'Pop_Ostinato_Rock'   },
    'Pop_Ostinato_Rock':     { sparse: 'Pop_Anthem_Pulse',dense: 'Ostinato_16s'        },
    'RnB_Gospel_Triplets':   { sparse: 'Single_Root',     dense: 'RnB_Neo_Soul_Roll'   },
    'Blues_Slow_12_8_Arp':   { sparse: 'Single_Root',     dense: 'Blues_Boogie_Woogie' },
    'RnB_Neo_Soul_Roll':     { sparse: 'RnB_Laid_Back_Groove', dense: 'RnB_Gospel_Triplets'},

    // ============================================================
    // 族 F Layered Sweep
    // ============================================================
    'Block_Chord':           { sparse: 'Single_Root',     dense: 'Pop_Anthem_Pulse'    },
    'Jazz_Comping':          { sparse: 'Single_Root',     dense: 'Jazz_Charleston_Comp'},
    'Pop_Ballad_158_Sweep':  { sparse: 'Single_Root',     dense: 'Pop_Piano_Arp_16ths' },
    'RnB_Classic_Soul_Arp':  { sparse: 'Single_Root',     dense: 'RnB_Neo_Soul_Roll'   },
    'RnB_Laid_Back_Groove':  { sparse: 'Single_Root',     dense: 'RnB_Neo_Soul_Stab'   },
    'Jazz_Drop_2_Comp':      { sparse: 'Single_Root',     dense: 'Jazz_Charleston_Comp'},
    'Blues_Tremolo_Comp':    { sparse: 'Blues_Slow_Chops',dense: 'Blues_Boogie_Woogie' },

    // ============================================================
    // 族 G Quality-Aware(BoogieWalk)
    // ============================================================
    'Blues_Boogie_Woogie':   { sparse: 'Blues_Slow_Chops',dense: 'Blues_Boogie_Woogie' },
    'Blues_Shuffle_Bass':    { sparse: 'Single_Root',     dense: 'Blues_Boogie_Woogie' },

    // ============================================================
    // 族 H Anticipated
    // ============================================================
    'Jazz_Red_Garland_Block':{ sparse: 'Single_Root',     dense: 'Jazz_Charleston_Comp'},

    // ============================================================
    // CallAndResponse(cross-track sparse,升级到 jazz comping)
    // ============================================================
    'Call_And_Response':     { sparse: 'Single_Root',     dense: 'Jazz_Drop_2_Comp'    },
};
