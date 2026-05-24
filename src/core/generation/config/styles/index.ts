// ============================================================
// config/styles/index.ts — AF2 唯一引擎后的极简 stub(2026-05-24)
// ============================================================
//
// 历史:本文件原承载 StyleHarmonyBundle / StyleStage5Bundle 完整 per-style
//        配置(POP / JAZZ / NEOSOUL),供老 AF pipeline 消费。
//        删 AF 后,AF2 不消费 bundle 配置(进行池 / Conductor 模板 / Drum grid
//        都已内化到 af2-engine/)。
//
// 仍保留的极小表面:
//   - StyleStage5Bundle 接口:JamSessionManager 仍读 stage5Bundle.personas[2]?.topologyConfig
//     作 motif preprocessing topology(可选)。
//   - getStyleStage5Bundle(styleId) 返回 stub bundle(personas 空数组,
//     personas[2] === undefined → topologyConfig 退化默认)。
//
// 删:
//   - StyleHarmonyBundle / getStyleHarmonyBundle(无 caller)
//   - ModernPop.ts / ChillJazz.ts / NeoSoul.ts(整文件删,只引用旧 AF 类型)
// ============================================================

import type { MusicianPersona } from '../../types';
import type { StyleId } from '../StyleFlags';

export interface StyleStage5Bundle {
    /** 长度 === ROLE_COUNT(4)。AF2 路径不消费,纯 stub */
    personas: MusicianPersona[];
}

const EMPTY_BUNDLE: StyleStage5Bundle = { personas: [] };

export function getStyleStage5Bundle(_styleId: StyleId): StyleStage5Bundle {
    void _styleId;
    return EMPTY_BUNDLE;
}
