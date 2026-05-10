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

function makeStubStyle(id: StyleId): StyleConfig {
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
    };
}

export const StyleRegistry: Record<StyleId, StyleConfig> = {
    [StyleId.ModernPop]: makeStubStyle(StyleId.ModernPop),
    [StyleId.ChillJazz]: makeStubStyle(StyleId.ChillJazz),
    [StyleId.NeoSoul]: makeStubStyle(StyleId.NeoSoul),
};

export function getStyleConfig(id: StyleId): StyleConfig {
    return StyleRegistry[id] ?? StyleRegistry[StyleId.ModernPop];
}

export function getAllAvailableStyles(): StyleConfig[] {
    return Object.values(StyleRegistry);
}

export const AcgStyleConfig: StyleConfig = StyleRegistry[StyleId.ModernPop];
