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

const STYLE_TEXTURE_POOL: Record<MgStyle, Partial<Record<SectionType, ReadonlyArray<string>>>> = {
    POP: {
        [SectionType.Intro]:     ['Single_Root', 'Root_Octave'],
        [SectionType.Verse]:     ['Pop_Anthem_Pulse', 'Pop_Broken_8ths_Sync'],
        [SectionType.PreChorus]: ['Pop_Anthem_Pulse', 'Pop_Broken_8ths_Sync'],
        [SectionType.Chorus]:    ['Pop_Anthem_Pulse', 'Pop_Broken_8ths_Sync', 'Pop_Piano_Arp_16ths'],
        [SectionType.Bridge]:    ['Pop_Broken_8ths_Sync', 'Pop_Piano_Arp_16ths'],
        [SectionType.BuildUp]:   ['Pop_Anthem_Pulse'],
        [SectionType.Drop]:      ['Pop_Anthem_Pulse'],
        [SectionType.Break]:     ['Single_Root'],
        [SectionType.Breakdown]: ['Single_Root'],
        [SectionType.Outro]:     ['Single_Root', 'Root_Octave'],
        [SectionType.PreOutro]:  ['Root_Octave', 'Pop_Anthem_Pulse'],
    },
    JAZZ: {
        [SectionType.Intro]:     ['Single_Root', 'Jazz_Charleston_Comp'],
        [SectionType.Verse]:     ['Jazz_Charleston_Comp', 'Bossa_Clave_Comping'],
        [SectionType.PreChorus]: ['Jazz_Charleston_Comp'],
        [SectionType.Chorus]:    ['Jazz_Charleston_Comp', 'Bossa_Piano_Arp'],
        [SectionType.Bridge]:    ['Bossa_Piano_Arp', 'Bossa_Clave_Comping'],
        [SectionType.BuildUp]:   ['Jazz_Charleston_Comp'],
        [SectionType.Drop]:      ['Jazz_Charleston_Comp'],
        [SectionType.Break]:     ['Single_Root'],
        [SectionType.Breakdown]: ['Single_Root'],
        [SectionType.Outro]:     ['Single_Root', 'Jazz_Charleston_Comp'],
        [SectionType.PreOutro]:  ['Jazz_Charleston_Comp'],
    },
    BLUES: {
        [SectionType.Intro]:     ['Single_Root', 'Root_Octave'],
        [SectionType.Verse]:     ['Blues_Boogie_Woogie', 'Blues_Stabs'],
        [SectionType.PreChorus]: ['Blues_Stabs'],
        [SectionType.Chorus]:    ['Blues_Boogie_Woogie', 'Blues_Stabs'],
        [SectionType.Bridge]:    ['Blues_Stabs'],
        [SectionType.BuildUp]:   ['Blues_Stabs'],
        [SectionType.Drop]:      ['Blues_Boogie_Woogie'],
        [SectionType.Break]:     ['Single_Root'],
        [SectionType.Breakdown]: ['Single_Root'],
        [SectionType.Outro]:     ['Single_Root', 'Blues_Boogie_Woogie'],
        [SectionType.PreOutro]:  ['Blues_Boogie_Woogie'],
    },
    RNB: {
        [SectionType.Intro]:     ['Single_Root', 'Pop_Piano_Arp_16ths'],
        [SectionType.Verse]:     ['Pop_Piano_Arp_16ths', 'RnB_Classic_Soul_Arp'],
        [SectionType.PreChorus]: ['RnB_Neo_Soul_Stab', 'Pop_Piano_Arp_16ths'],
        [SectionType.Chorus]:    ['Pop_Piano_Arp_16ths', 'RnB_Neo_Soul_Stab'],
        [SectionType.Bridge]:    ['RnB_Classic_Soul_Arp', 'Pop_Piano_Arp_16ths'],
        [SectionType.BuildUp]:   ['RnB_Neo_Soul_Stab'],
        [SectionType.Drop]:      ['RnB_Neo_Soul_Stab'],
        [SectionType.Break]:     ['Single_Root'],
        [SectionType.Breakdown]: ['Single_Root', 'Pop_Piano_Arp_16ths'],
        [SectionType.Outro]:     ['Single_Root', 'Pop_Piano_Arp_16ths'],
        [SectionType.PreOutro]:  ['Pop_Piano_Arp_16ths', 'RnB_Classic_Soul_Arp'],
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
        const events = ChordTextureEngine.applyByTextureType(
            textureType, chordDef, nextChordDef,
            chord.startBeat, chordDef.duration, chordRng,
            'accomp',
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
