// ============================================================
// Af2AccompGen — AF2 自家伴奏生成器(N 阶段:接 ChordTextureEngine)
// ============================================================
//
// 8 层架构 #6 "乐手 idiom" 内的 accomp 算法。PianoIdiom.planAccomp 调用本模块。
//
// N 阶段(2026-05-24)从 mg 移植 chord-texture 系统:per chord 从
// (mgStyle, sectionType)textureType pool 抽 1 个 textureType,走
// ChordTextureEngine.applyByTextureType 渲染。
//
// 替换 B2 阶段的简单 4 pattern (Block/Arp/Stab/Sustained)。
//
// PRNG 隔离:每 chord 新建独立 `accomp_${seed}_${chord.startBeat}` Random,
// 不影响主 rng 流;family 内部消耗 random 不传染。
//
// bass 过滤:partFilter='accomp' — family 输出含 bass + accomp,
// 我们只取 accomp(bass 走 BassIdiom)。
//
// 输入约束:
//   chord.voicing 应非空(Composer 输出保证);空时 fallback root pc 三和弦
//   voicing 在 RELATIVE 空间(AbsoluteTransposer 后期 +keyOffset)
// ============================================================

import type { NoteData, SectionMetadata } from '../types';
import type { GeneratedChord } from '../ir';
import { SectionType } from '../types';
import type { MusicianPlanInput } from './Conductor';
import { getMyRolesInSection, findSectionIdxForBeat } from './Conductor';
import type { MgStyle } from '../../../state/EngineSelectionStore';
import { Random } from './utils/Random';
import { ChordTextureEngine } from './chord-texture/ChordTextureEngine';
import { generatedChordToChordDef } from './chord-texture/adapter';
import type { NoteEvent } from './chord-texture/types';

// ============================================================
// Per-mgStyle × sectionType textureType pool(N 阶段 8 family 覆盖)
// ============================================================
//
// 设计语义:
//   POP   直拍 anthem + broken 8th 律动 + arp 16th(chorus)
//   JAZZ  Charleston comping 主力,bossa 偶尔
//   BLUES Boogie Woogie + Stabs(blues 律动 + 切分)
//   RNB   Neo-soul stab + classic arp(16th 神经质)
//
// 通用低能量段(Intro / Outro / Break / Breakdown):Single_Root 留白
//
// fallback 路径:风格未匹配 sectionType → POP 同 sectionType → ['Single_Root']
// ============================================================

// N5 扩展:加入新 textureType
//   PureWalk(bass 行走)→ POP Intro
//   Block_Chord / Ostinato_16s / Pop_Ostinato_Rock → POP Verse-Chorus
//   Jazz_Walking_Bass / Jazz_Comping / Jazz_Drop_2_Comp / Jazz_Red_Garland_Block
//     / Jazz_Waltz_Hemiola → JAZZ
//   Blues_Chicago_Shuffle / Blues_Slow_Chops / Blues_Slow_12_8_Arp / Blues_Tremolo_Comp
//     / Blues_Shuffle_Bass → BLUES
//   RnB_Classic_Soul_Arp(SweepProgressive 修正)/ RnB_Laid_Back_Groove
//     / RnB_16th_Funk_Stabs / RnB_Gospel_Triplets / RnB_Neo_Soul_Roll → RNB
//   Pop_Ballad_158_Sweep → POP Bridge / 慢段
//
// 未塞入 pool 的 textureType(仍在 TEXTURE_MAPPING 可 explicit 调用):
//   Funk_Guitar_Scratch / Slap_Bass_Line(留 FUNK mgStyle 时启用)
//   Root_7_5_8 / Root_5_7_5 / Root_Fifth_Bass / Root_Octave_Pulse
//   Stabs / Syncopated_Stabs / Block_Chord_Staccato / Arpeggio_Flow / Arp_Seq
const STYLE_TEXTURE_POOL: Record<MgStyle, Partial<Record<SectionType, ReadonlyArray<string>>>> = {
    POP: {
        [SectionType.Intro]:     ['Single_Root', 'Root_Octave', 'Root_5_8'],
        [SectionType.Verse]:     ['Pop_Anthem_Pulse', 'Pop_Broken_8ths_Sync', 'Block_Chord', 'Pop_Ostinato_Rock'],
        [SectionType.PreChorus]: ['Pop_Anthem_Pulse', 'Pop_Broken_8ths_Sync', 'Pop_Ostinato_Rock', 'Block_Chord'],
        [SectionType.Chorus]:    ['Pop_Anthem_Pulse', 'Pop_Broken_8ths_Sync', 'Pop_Piano_Arp_16ths', 'Pop_Ostinato_Rock'],
        [SectionType.Bridge]:    ['Pop_Broken_8ths_Sync', 'Pop_Piano_Arp_16ths', 'Pop_Ballad_158_Sweep', 'Ostinato_16s'],
        [SectionType.BuildUp]:   ['Pop_Anthem_Pulse', 'Pop_Ostinato_Rock'],
        [SectionType.Drop]:      ['Pop_Anthem_Pulse', 'Block_Chord'],
        [SectionType.Break]:     ['Single_Root', 'Pop_Ballad_158_Sweep'],
        [SectionType.Breakdown]: ['Single_Root', 'Pop_Ballad_158_Sweep'],
        [SectionType.Outro]:     ['Single_Root', 'Root_Octave', 'Pop_Ballad_158_Sweep'],
        [SectionType.PreOutro]:  ['Root_Octave', 'Pop_Anthem_Pulse', 'Pop_Ballad_158_Sweep'],
    },
    JAZZ: {
        [SectionType.Intro]:     ['Single_Root', 'Jazz_Charleston_Comp', 'Jazz_Comping'],
        [SectionType.Verse]:     ['Jazz_Charleston_Comp', 'Bossa_Clave_Comping', 'Jazz_Comping', 'Jazz_Walking_Bass', 'Call_And_Response'],
        [SectionType.PreChorus]: ['Jazz_Charleston_Comp', 'Jazz_Comping', 'Jazz_Drop_2_Comp'],
        [SectionType.Chorus]:    ['Jazz_Charleston_Comp', 'Bossa_Piano_Arp', 'Jazz_Drop_2_Comp', 'Jazz_Red_Garland_Block'],
        [SectionType.Bridge]:    ['Bossa_Piano_Arp', 'Bossa_Clave_Comping', 'Jazz_Waltz_Hemiola', 'Jazz_Drop_2_Comp', 'Call_And_Response'],
        [SectionType.BuildUp]:   ['Jazz_Charleston_Comp', 'Jazz_Red_Garland_Block'],
        [SectionType.Drop]:      ['Jazz_Charleston_Comp', 'Jazz_Drop_2_Comp'],
        [SectionType.Break]:     ['Single_Root', 'Jazz_Comping'],
        [SectionType.Breakdown]: ['Single_Root', 'Jazz_Comping'],
        [SectionType.Outro]:     ['Single_Root', 'Jazz_Charleston_Comp'],
        [SectionType.PreOutro]:  ['Jazz_Charleston_Comp', 'Jazz_Walking_Bass'],
    },
    BLUES: {
        [SectionType.Intro]:     ['Single_Root', 'Root_Octave'],
        [SectionType.Verse]:     ['Blues_Boogie_Woogie', 'Blues_Stabs', 'Blues_Chicago_Shuffle', 'Blues_Tremolo_Comp'],
        [SectionType.PreChorus]: ['Blues_Stabs', 'Blues_Tremolo_Comp'],
        [SectionType.Chorus]:    ['Blues_Boogie_Woogie', 'Blues_Stabs', 'Blues_Chicago_Shuffle'],
        [SectionType.Bridge]:    ['Blues_Stabs', 'Blues_Slow_Chops', 'Blues_Slow_12_8_Arp'],
        [SectionType.BuildUp]:   ['Blues_Stabs', 'Blues_Boogie_Woogie'],
        [SectionType.Drop]:      ['Blues_Boogie_Woogie', 'Block_Chord'],
        [SectionType.Break]:     ['Single_Root', 'Blues_Slow_Chops'],
        [SectionType.Breakdown]: ['Single_Root', 'Blues_Slow_12_8_Arp'],
        [SectionType.Outro]:     ['Single_Root', 'Blues_Boogie_Woogie', 'Blues_Slow_Chops'],
        [SectionType.PreOutro]:  ['Blues_Boogie_Woogie', 'Blues_Shuffle_Bass'],
    },
    RNB: {
        [SectionType.Intro]:     ['Single_Root', 'Pop_Piano_Arp_16ths', 'RnB_Classic_Soul_Arp'],
        [SectionType.Verse]:     ['Pop_Piano_Arp_16ths', 'RnB_Classic_Soul_Arp', 'RnB_Laid_Back_Groove', 'RnB_16th_Funk_Stabs', 'Call_And_Response'],
        [SectionType.PreChorus]: ['RnB_Neo_Soul_Stab', 'Pop_Piano_Arp_16ths', 'RnB_16th_Funk_Stabs'],
        [SectionType.Chorus]:    ['Pop_Piano_Arp_16ths', 'RnB_Neo_Soul_Stab', 'RnB_Gospel_Triplets', 'RnB_Neo_Soul_Roll'],
        [SectionType.Bridge]:    ['RnB_Classic_Soul_Arp', 'Pop_Piano_Arp_16ths', 'RnB_Neo_Soul_Roll', 'RnB_Laid_Back_Groove', 'Call_And_Response'],
        [SectionType.BuildUp]:   ['RnB_Neo_Soul_Stab', 'RnB_Gospel_Triplets'],
        [SectionType.Drop]:      ['RnB_Neo_Soul_Stab', 'RnB_16th_Funk_Stabs'],
        [SectionType.Break]:     ['Single_Root', 'RnB_Laid_Back_Groove'],
        [SectionType.Breakdown]: ['Single_Root', 'Pop_Piano_Arp_16ths'],
        [SectionType.Outro]:     ['Single_Root', 'Pop_Piano_Arp_16ths', 'RnB_Classic_Soul_Arp'],
        [SectionType.PreOutro]:  ['Pop_Piano_Arp_16ths', 'RnB_Classic_Soul_Arp', 'RnB_Laid_Back_Groove'],
    },
};

const DEFAULT_TEXTURE_POOL: ReadonlyArray<string> = ['Single_Root'];

// Per-mgStyle 高 sparsity / 高 syncopation 偏好覆盖 textureType
const SPARSITY_FALLBACK = 'Single_Root';
const SYNCOPATION_PREFERENCE: Record<MgStyle, string> = {
    POP:   'Pop_Broken_8ths_Sync',
    JAZZ:  'Jazz_Charleston_Comp',
    BLUES: 'Blues_Stabs',
    RNB:   'RnB_Neo_Soul_Stab',
};

/**
 * TextureType 选择 — pool hash 均分;persona 加权偏好:
 *   - sparsityTendency 高 → 偏 Single_Root(留白)
 *   - syncopationAssault 高 → 偏 per-mgStyle 切分 textureType
 *
 * PRNG 消耗:0(deterministic hash)。
 */
function pickTextureType(
    sectionType: SectionType,
    chordIdxInSection: number,
    mgStyle: MgStyle,
    sparsity: number = 0,
    syncopation: number = 0,
): string {
    const stylePool = STYLE_TEXTURE_POOL[mgStyle];
    const pool = stylePool[sectionType] ?? STYLE_TEXTURE_POOL.POP[sectionType] ?? DEFAULT_TEXTURE_POOL;
    const h = (chordIdxInSection * 11 + (sectionType as number) * 13) & 0xff;
    let pick = pool[h % pool.length];
    const h2 = ((h * 31 + 17) & 0xff) / 255;
    if (h2 < sparsity * 0.6) pick = SPARSITY_FALLBACK;
    else if (h2 < sparsity * 0.6 + syncopation * 0.5) pick = SYNCOPATION_PREFERENCE[mgStyle];
    return pick;
}

// ============================================================
// 主入口
// ============================================================

export function generateAf2Accomp(
    chords: ReadonlyArray<GeneratedChord>,
    sections: ReadonlyArray<SectionMetadata>,
    input: MusicianPlanInput,
): NoteData[] {
    const out: NoteData[] = [];
    const sectionChordIdx = new Map<number, number>();

    // Persona 消费
    const persona = input.musician?.persona;
    const sparsity = persona?.sparsityTendency ?? 0;
    const syncopation = persona?.syncopationAssault ?? 0;
    const dynamicLo = (persona?.dynamicRange?.[0] ?? 55) / 127;
    const dynamicHi = (persona?.dynamicRange?.[1] ?? 100) / 127;
    const dynamicMid = (dynamicLo + dynamicHi) / 2;
    const mgStyle: MgStyle = input.mgStyle ?? 'POP';

    // N6 阶段:melody peer NoteData → NoteEvent 一次性转换(Cross-track family
    // 如 CallAndResponse 需要 NoteEvent;Facade 已在 accomp closure 内从
    // peers.get(mainMusicianId) 注入 melodyPeerNotes)。
    const melodyEvents: ReadonlyArray<NoteEvent> | undefined = input.melodyPeerNotes
        ? input.melodyPeerNotes.map(n => ({
            noteNumber: n.pitch,
            time: n.onset,
            duration: n.duration,
            velocity: n.velocity * 127,
            part: 'melody' as const,
        }))
        : undefined;

    for (let ci = 0; ci < chords.length; ci++) {
        const chord = chords[ci];
        const nextChord = chords[ci + 1] ?? null;
        const sectionIdx = findSectionIdxForBeat(chord.startBeat, sections);
        if (sectionIdx < 0) continue;

        const myRoles = getMyRolesInSection(input, sectionIdx);
        if (!myRoles.includes('accomp')) {
            sectionChordIdx.set(sectionIdx, (sectionChordIdx.get(sectionIdx) ?? 0) + 1);
            continue;
        }

        const chordIdxInSection = sectionChordIdx.get(sectionIdx) ?? 0;
        sectionChordIdx.set(sectionIdx, chordIdxInSection + 1);

        const sectionType = sections[sectionIdx].sectionType;
        const textureType = pickTextureType(sectionType, chordIdxInSection, mgStyle, sparsity, syncopation);
        const voicing = chord.voicing ?? [];
        if (voicing.length === 0) continue;

        // GeneratedChord → ChordDef adapter
        const chordDef = generatedChordToChordDef(chord);
        const nextChordDef = nextChord ? generatedChordToChordDef(nextChord) : null;

        // Per-chord deterministic Random — family 内 rng 不传染主 stream
        const chordRng = new Random(`accomp_${mgStyle}_${chord.startBeat.toFixed(2)}_${ci}`);

        // 调用 ChordTextureEngine,只取 accomp(bass 走 BassIdiom)
        // N6:传 melodyEvents 给 cross-track family(CallAndResponse 等)
        const events = ChordTextureEngine.applyByTextureType(
            textureType, chordDef, nextChordDef,
            chord.startBeat, chordDef.duration, chordRng,
            'accomp',
            melodyEvents,
        );

        // Velocity 重映射到 persona.dynamicRange + 微浮动(±10%)
        for (let i = 0; i < events.length; i++) {
            const n = events[i];
            const velH = ((sectionIdx * 7 + chordIdxInSection * 19 + i * 23) & 0xff) / 255;
            const vel = dynamicMid + (velH - 0.5) * (dynamicHi - dynamicLo) * 0.4;
            // 保留 family 输出 velocity 的相对差(对 family 内的 strong/weak 区分有用):
            // 用 family velocity 与 0.6 中线的偏差做缩放
            const relScale = n.velocity / 0.6;
            out.push({
                ...n,
                velocity: Math.max(0.1, Math.min(1, vel * relScale)),
            });
        }
    }
    return out;
}
