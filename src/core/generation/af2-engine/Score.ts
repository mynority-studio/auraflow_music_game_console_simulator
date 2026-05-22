// ============================================================
// Score — Conductor / Musician 共享的 "总谱" 数据契约(C.1)
// ============================================================
//
// 在用户的 8 层架构里,Score 是"编曲师 + 作曲家"输出的产物,Conductor 拿 Score
// + Band 决定谁演什么 role,再分发给 musicians,musicians 看 Score + 自己 role
// 编自己的演奏。
//
// 当前阶段(C.1):
//   Score 是 mg + SectionPlanner 输出的素材打包(已存在,只是散落在
//   GeneratedTrack / MusicContext / mg.MusicTimeline 等多个对象里)。本文件
//   只做数据契约打包,不引入新算法。
//
// 后续阶段:
//   - C.3+:musician.plan(score, role, peers) 让 musician 看 Score 编自己演奏
//   - 未来 Arranger/Composer 分离时:harmonicPath(只 Numeral+TSD) +
//     voicedChords(含 voicing) 可能分成两个字段,实现"骨架与色彩分离"
// ============================================================

import type { GeneratedChord, SectionMetadata, Tonality } from '../types';

/**
 * Score — 一首歌的完整总谱(可读,musicians 不应 mutate)。
 *
 * 字段全部来自 mg pipeline + SectionPlanner 的输出,没有新计算。
 * 任何"装饰 / 色彩 / 演绎"由 musician 在 plan() 时按 role 决定。
 */
export interface Score {
    /** 全曲和弦进行(含 voicing + TSD effectiveFunc + numeral + startBeat/endBeat) */
    readonly chords: ReadonlyArray<GeneratedChord>;
    /** 段落骨架(含 sectionType + energyLevel + startBeat/endBeat) */
    readonly sections: ReadonlyArray<SectionMetadata>;
    /** Tempo(BPM) */
    readonly bpm: number;
    /** 调号字符串(如 'C', 'Db')+ keyOffset(0..11)+ tonality */
    readonly key: string;
    readonly keyOffset: number;
    readonly tonality: Tonality;
    /** Time signature `[upper, lower]` — 如 [4,4] / [6,8] */
    readonly timeSignature: readonly [number, number];
}
