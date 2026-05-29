// ============================================================
// metadata.ts — Layer 1 metadata 抽取(从 mg ctx / timeline)
// ============================================================
//
// 给后续 layer 提供:
//   - sectionFunction:全曲 1 个标签(INTRO/VERSE/CHORUS/BRIDGE/OUTRO)
//   - phraseRoleByBar:per-bar Caplin phrase 角色(antecedent_end / song_end 等)
//   - melodyDensityByBar:per-bar melody attack 数(L5 ducking 用)
//   - songPositionByBar:per-bar 启发式(intro / main / outro,基于位置)
//   - hasMelody:全曲是否有 melody(影响 RH 张力 / dropout)
//
// P1 阶段:metadata 抽出后存进 diagnostic console log 验证。P2+ 才被各层消费。
// ============================================================

import type {
    ChordDef,
    NoteEvent,
    MusicTimeline,
    ResolvedGenerationContext,
    SectionFunction,
} from '../mgEngine/musicEngine';
import type { PhraseRole } from '../mgEngine/musicTheory';

/** Heuristic 段落分类(per-bar)— 不是 mg 给的,我们基于 bar position 启发式分 */
export type SongPosition = 'intro' | 'main' | 'outro';

export interface SongMetadata {
    /** mg 全曲 section 标签(1 个) */
    sectionFunction: SectionFunction;
    /** per-bar Caplin phrase 角色(可能缺失) */
    phraseRoleByBar: PhraseRole[];
    /** per-bar melody attack 数(L5 ducking 用 — melody 密集时 RH 减弱) */
    melodyDensityByBar: number[];
    /** per-bar 启发式段落位置(intro/main/outro) */
    songPositionByBar: SongPosition[];
    /** 全曲是否有 melody */
    hasMelody: boolean;
    /** 总 bar 数 */
    totalBars: number;
}

/**
 * 从 mg 拿 sectionFunction(只需 resolveGeneration 跑一次,本来就跑了 ctx 拿走)。
 */
function getSectionFunction(ctx: ResolvedGenerationContext): SectionFunction {
    return ctx.sectionFunction;
}

/**
 * per-bar melody attack 计数 — 把 melody events 按 chord bar 边界 bucket。
 */
function computeMelodyDensity(events: NoteEvent[], chords: ChordDef[]): number[] {
    const out = new Array<number>(chords.length).fill(0);
    const melody = events.filter(e => e.part === 'melody');
    let beatAcc = 0;
    for (let i = 0; i < chords.length; i++) {
        const cStart = beatAcc;
        const cEnd = beatAcc + chords[i].duration;
        out[i] = melody.filter(e => e.time >= cStart && e.time < cEnd).length;
        beatAcc = cEnd;
    }
    return out;
}

/**
 * 启发式 song position 分类:
 *   前 1/8 → intro
 *   后 1/8 → outro
 *   中间 → main
 *
 * 简单粗略,P4 phase 接 mg 真实 phrase segments 再细化。
 */
function computeSongPosition(totalBars: number): SongPosition[] {
    const introBars = Math.max(1, Math.floor(totalBars / 8));
    const outroBars = Math.max(1, Math.floor(totalBars / 8));
    const out: SongPosition[] = [];
    for (let i = 0; i < totalBars; i++) {
        if (i < introBars) out.push('intro');
        else if (i >= totalBars - outroBars) out.push('outro');
        else out.push('main');
    }
    return out;
}

/**
 * 主入口:从 mg ctx + timeline + chords 抽 metadata。
 */
export function extractMetadata(
    ctx: ResolvedGenerationContext,
    timeline: MusicTimeline,
    chords: ChordDef[],
): SongMetadata {
    const sectionFunction = getSectionFunction(ctx);
    const phraseRoleByBar = timeline.phraseRoleByBar ?? [];
    const melodyDensityByBar = computeMelodyDensity(timeline.events, chords);
    const songPositionByBar = computeSongPosition(chords.length);
    const melodyCount = timeline.events.filter(e => e.part === 'melody').length;
    return {
        sectionFunction,
        phraseRoleByBar,
        melodyDensityByBar,
        songPositionByBar,
        hasMelody: melodyCount > 0,
        totalBars: chords.length,
    };
}
