// ============================================================
// 🚧 STUB — StyleConfig 注册表占位
// ============================================================
//
// 历史功能：
//   将 StyleId 映射到完整 StyleConfig（和声池、节奏池、编配池、Persona 偏好等）。
//   原实现转发到 ./styles/{ModernPop, ChillJazz, NeoSoul, Shared}.ts。
//
// 重构期占位行为：
//   返回最小可编译的 StyleConfig 骨架。AcgStyleConfig 兜底到 ModernPop。
//   getStyleConfig(id) 命中即取，未命中则回退到 ModernPop。
//
// 重构方向：
//   新引擎应在 ./styles/ 子目录下逐风格定义完整 StyleConfig，再由本文件汇总注册。
// ============================================================

import { StyleConfig } from '../types';
import { StyleId, StyleIdName } from './StyleFlags';

function makeStubStyle(id: StyleId, overrides: Partial<StyleConfig> = {}): StyleConfig {
    return {
        id,
        name: StyleIdName[id] ?? `Style_${id}`,
        global: {
            bpmRange: [80, 120],
            timeSignaturePool: [{ signature: [4, 4], weight: 1 }],
            tonalityPool: [],
        },
        harmony: { major: {}, minor: {} },
        rhythm: {},
        orchestration: {
            melodyInstruments: [],
            chordInstruments: [],
            bassInstruments: [],
            drumInstruments: [],
            counterMelodyInstruments: [],
        },
        ...overrides,
    };
}

// ============================================================
// V4.2b — 进行池（移植自 SampleDEMO，适配各 style 风格特色）
// 段落键全小写：'intro' / 'verse' / 'preChorus' / 'chorus' / 'bridge' / 'outro'
// ============================================================

const POP_HARMONY_POOLS = {
    major: {
        intro: [
            ['I', 'V', 'vi', 'IV'],            // 经典 Pop Intro
            ['I', 'IVmaj7', 'I', 'IVmaj7'],
            ['vi', 'IV', 'I', 'V'],
        ],
        verse: [
            ['I', 'vi', 'IV', 'V'],            // 50s 进行（万能 Pop Verse）
            ['I', 'V', 'vi', 'IV'],            // 公主进行
            ['I', 'IV', 'ii', 'V'],
            ['vi', 'IV', 'I', 'V'],            // 忧郁 Pop Verse
            ['IVmaj7', 'I', 'IVmaj7', 'I'],    // floaty modern pop
        ],
        preChorus: [
            ['IV', 'V', 'iii', 'vi'],          // J-Pop Royal Road
            ['ii', 'V', 'I', 'vi'],
            ['IV', 'IV', 'V', 'V'],            // 经典 build-up
        ],
        chorus: [
            ['I', 'V', 'vi', 'IV'],            // 通用 Pop Chorus
            ['IVmaj7', 'V', 'iii', 'vi'],      // Royal Road Chorus
            ['vi', 'IV', 'I', 'V'],            // edgy modern pop
            ['I', 'IV', 'vi', 'V'],
            ['I', 'III7', 'vi', 'IV'],         // 副属和弦 punch
        ],
        bridge: [
            ['vi', 'iii', 'IV', 'I'],
            ['IV', 'V', 'I', 'I'],
            ['ii', 'V', 'iii', 'vi'],
        ],
        outro: [
            ['IV', 'iv', 'I', 'I'],            // Beatles 借调 iv
            ['vi', 'V', 'IV', 'I'],
            ['I', 'V', 'vi', 'IV'],
        ],
    },
    minor: {
        intro:     [['i', 'VI', 'i', 'VI'], ['i', 'v', 'VI', 'VII']],
        verse:     [['i', 'VI', 'III', 'VII'], ['i', 'iv', 'v', 'i'], ['i', 'VII', 'VI', 'v']],
        preChorus: [['iv', 'v', 'i', 'i'], ['VI', 'VII', 'i', 'i']],
        chorus:    [['VI', 'VII', 'i', 'v'], ['i', 'VI', 'III', 'VII']],
        bridge:    [['iv', 'i', 'VI', 'V']],
        outro:     [['VI', 'iv', 'i', 'i'], ['i', 'v', 'i', 'i']],
    },
};

const JAZZ_HARMONY_POOLS = {
    major: {
        intro: [
            ['Imaj7', 'vi7', 'ii7', 'V7'],     // ii-V-I 暖入
            ['ii7', 'V7', 'Imaj7', 'Imaj7'],
        ],
        verse: [
            ['Imaj7', 'vi7', 'ii7', 'V7'],     // Rhythm Changes A
            ['Imaj7', 'I7', 'IVmaj7', 'iv7'],  // 大调借调 iv
            ['Imaj7', 'iii7', 'vi7', 'ii7', 'V7', 'V7', 'Imaj7', 'V7'],  // 长 verse + turnaround
            ['IVmaj7', 'iii7', 'ii7', 'Imaj7'],
        ],
        preChorus: [
            ['ii7', 'V7', 'iii7', 'vi7'],
            ['IVmaj7', 'iii7', 'ii7', 'V7'],
        ],
        chorus: [
            ['Imaj7', 'IVmaj7', 'iii7', 'vi7'],
            ['Imaj7', 'vi7', 'ii7', 'V7'],
            ['Imaj7', 'I7', 'IVmaj7', 'iv7'],  // Cole Porter "Night & Day" 借调
        ],
        bridge: [
            ['iii7', 'VI7', 'ii7', 'V7'],      // Rhythm Changes B（circle of 5ths）
            ['IIImaj7', 'VI7', 'IImaj7', 'V7'],
        ],
        outro: [
            ['ii7', 'V7', 'Imaj7', 'Imaj7'],   // 标准 turnaround 收尾
            ['IVmaj7', 'iv7', 'Imaj7', 'Imaj7'],
        ],
    },
    minor: {
        intro:     [['i7', 'iiø', 'V7', 'i7']],
        verse:     [['i7', 'iiø', 'V7', 'i7'], ['i7', 'iv7', 'VII7', 'IIImaj7']],
        preChorus: [['iiø', 'V7', 'i7', 'i7']],
        chorus:    [['i7', 'VImaj7', 'iiø', 'V7']],
        bridge:    [['iv7', 'VII7', 'IIImaj7', 'VImaj7']],
        outro:     [['iiø', 'V7', 'i7', 'i7']],
    },
};

const NEOSOUL_HARMONY_POOLS = {
    major: {
        intro: [
            ['Imaj9', 'IVmaj9', 'Imaj9', 'IVmaj9'],   // Neo-Soul vamp
            ['vi9', 'IVmaj9', 'Imaj9', 'V9'],
        ],
        verse: [
            ['Imaj9', 'iii7', 'IVmaj9', 'V9'],
            ['IVmaj9', 'iii7', 'vi9', 'V9sus4'],
            ['Imaj9', 'bVIImaj7', 'IVmaj9', 'Imaj9'],  // 借调 bVII（Neo-Soul 标志）
        ],
        preChorus: [
            ['ii9', 'V9sus4', 'Imaj9', 'vi9'],
            ['IVmaj9', 'V9sus4', 'iii7', 'vi9'],
        ],
        chorus: [
            ['Imaj9', 'V9sus4', 'vi9', 'IVmaj9'],
            ['vi9', 'IVmaj9', 'Imaj9', 'V9sus4'],
            ['IVmaj9', 'iii7', 'ii9', 'Imaj9'],
        ],
        bridge: [
            ['iii7', 'bIIImaj7', 'ii9', 'V9'],
            ['vi9', 'bVImaj7', 'V9', 'V9sus4'],
        ],
        outro: [
            ['Imaj9', 'IVmaj9', 'Imaj9', 'Imaj9'],
            ['ii9', 'V9sus4', 'Imaj9', 'Imaj9'],
        ],
    },
    minor: {
        intro:     [['i9', 'VImaj9', 'i9', 'VImaj9']],
        verse:     [['i9', 'iv9', 'VII7', 'IIImaj9']],
        preChorus: [['iv9', 'V7sus4', 'i9', 'i9']],
        chorus:    [['i9', 'VImaj9', 'iv9', 'V7sus4']],
        bridge:    [['iv9', 'VII7', 'IIImaj9', 'VImaj9']],
        outro:     [['iv9', 'V7sus4', 'i9', 'i9']],
    },
};

export const StyleRegistry: Record<StyleId, StyleConfig> = {
    [StyleId.POP]: makeStubStyle(StyleId.POP, {
        passingChordProb: 0.3,
        chromaticPassingProb: 0.3,
        anticipationProb: 0.3,
        tensionLimits: 9,
        densityBaseline: 0.6,
        harmony: POP_HARMONY_POOLS,
    }),
    [StyleId.JAZZ]: makeStubStyle(StyleId.JAZZ, {
        passingChordProb: 0.5,
        chromaticPassingProb: 0.5,
        anticipationProb: 0.6,
        tensionLimits: 11,
        densityBaseline: 0.4,
        swingRatio: 0.55,
        harmony: JAZZ_HARMONY_POOLS,
    }),
    [StyleId.RNB]: makeStubStyle(StyleId.RNB, {
        passingChordProb: 0.6,
        chromaticPassingProb: 0.7,
        anticipationProb: 0.7,
        tensionLimits: 13,
        densityBaseline: 0.5,
        swingRatio: 0.6,
        harmony: NEOSOUL_HARMONY_POOLS,
    }),
    // C.1 — BLUES stub:enum 已加但 config 暂未实装,临时回落 JAZZ(mg JAZZ 含 BLUES 元素)
    // C.4/Phase 2 阶段决定是否提供独立 BLUES config(目前默认 pool 不抽 BLUES)
    [StyleId.BLUES]: makeStubStyle(StyleId.BLUES, {
        passingChordProb: 0.5,
        chromaticPassingProb: 0.5,
        anticipationProb: 0.5,
        tensionLimits: 9,
        densityBaseline: 0.5,
        swingRatio: 0.6,
        harmony: JAZZ_HARMONY_POOLS,  // 临时复用 JAZZ pool
    }),
};

export function getStyleConfig(id: StyleId): StyleConfig {
    return StyleRegistry[id] ?? StyleRegistry[StyleId.POP];
}

export function getAllAvailableStyles(): StyleConfig[] {
    return Object.values(StyleRegistry);
}

export const AcgStyleConfig: StyleConfig = StyleRegistry[StyleId.POP];
