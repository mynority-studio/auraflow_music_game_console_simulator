// ============================================================
// mgEngine — 曲式层(Song Form)
// ============================================================
//
// 顶层宏观结构:在「风格已定、和声未生成」之间,先抽出歌曲的段落骨架
// (INTRO / VERSE / CHORUS / BRIDGE / OUTRO 等),genre-aware + 随机组合
// (有的歌有 intro、有的没有)。每段只是宏观和声框架,不涉及旋律/织体渲染,
// 故归 mg(和声权威)。Engine.generateSongForm 据此逐段调 generateProgressions
// 产出 48-64 小节的「分段进行」+ 段落元数据。
//
// 段落长度都用 2 的幂(4/8;blues 12),够长/可重复 → 记忆点;1.5-2min ≈ 48-64 小节。
// material 复用:同 materialKey 的段共享一块和声料(verse 重复=记忆点),
// 不同 materialKey 换料(verse≠chorus=对比)。
// ============================================================

import type { SectionFunction } from './musicEngine';
import type { StyleName } from './styleDictionary';

/** 最小随机源接口(Engine 的 Random 满足之;避免运行时循环依赖) */
interface Rng { next(): number; }

/** 一个曲式段落(宏观,和声层) */
export interface FormSection {
    /** mg 段落功能(驱动 generateProgression 选哪类进行素材) */
    function: SectionFunction;
    /** 段落小节数 */
    bars: number;
    /** 和声料标识:同 key 复用同一进行(记忆点),异 key 换料(对比) */
    materialKey: string;
    /** 展示标签(CHORUS / HOOK / A / B / TURNAROUND …) */
    label: string;
    /** OUTRO/ENDING:取素材末尾 bars(终止感);其余取开头 */
    fromEnd?: boolean;
}

/** generateSongForm 产出的段落跨度(供下游 melody/UI 标注) */
export interface SongSection {
    function: SectionFunction;
    label: string;
    startBar: number;
    bars: number;
}

const S = (fn: SectionFunction, bars: number, materialKey: string, label: string, fromEnd = false): FormSection =>
    ({ function: fn, bars, materialKey, label, fromEnd });

/**
 * 按风格抽一个曲式(随机组合可选段)。所有 StyleName 即 macro(POP/JAZZ/BLUES/RNB/LOFI)。
 * 返回有序段落列表,总长 ~32-64 小节。
 */
export function pickForm(style: StyleName, rng: Rng): FormSection[] {
    const chance = (p: number) => rng.next() < p;
    const rangeInt = (min: number, max: number) => min + Math.floor(rng.next() * (max - min + 1));

    switch (style) {
        case 'POP':
        case 'RNB': {
            // 简化 verse-chorus(8 小节段、重复出记忆点)。RNB 用 HOOK 标签。
            const hook = style === 'RNB' ? 'HOOK' : 'CHORUS';
            const f: FormSection[] = [];
            if (chance(0.6)) f.push(S('INTRO', 4, 'A', 'INTRO'));
            f.push(S('VERSE', 8, 'A', 'VERSE'));
            f.push(S('CHORUS', 8, 'B', hook));
            f.push(S('VERSE', 8, 'A', 'VERSE'));
            f.push(S('CHORUS', 8, 'B', hook));
            if (chance(0.7)) { f.push(S('BRIDGE', 8, 'C', 'BRIDGE')); f.push(S('CHORUS', 8, 'B', hook)); }
            if (chance(0.6)) f.push(S('OUTRO', 4, 'A', 'OUTRO', true));
            return f;
        }
        case 'JAZZ': {
            // AABA 32 小节,head in / head out(×2);A=主料、B=bridge 料。
            const f: FormSection[] = [];
            if (chance(0.4)) f.push(S('INTRO', 4, 'A', 'INTRO'));
            const aaba = (): FormSection[] => [
                S('VERSE', 8, 'A', 'A'), S('VERSE', 8, 'A', 'A'),
                S('BRIDGE', 8, 'B', 'B'), S('VERSE', 8, 'A', 'A'),
            ];
            f.push(...aaba(), ...aaba());
            if (chance(0.5)) f.push(S('OUTRO', 4, 'A', 'ENDING', true));
            return f;
        }
        case 'BLUES': {
            // 12-bar blues 反复 3-4 遍(同料=blues 形)+ 可选 turnaround 收尾。
            const f: FormSection[] = [];
            if (chance(0.4)) f.push(S('INTRO', 4, 'A', 'INTRO'));
            const n = rangeInt(3, 4);
            for (let i = 0; i < n; i++) f.push(S('CHORUS', 12, 'A', `CHORUS ${i + 1}`));
            if (chance(0.6)) f.push(S('OUTRO', 4, 'A', 'TURNAROUND', true));
            return f;
        }
        case 'LOFI':
        default: {
            // 简 loop:A/B 交替,可加变奏 + 淡入淡出。
            const f: FormSection[] = [];
            if (chance(0.6)) f.push(S('INTRO', 4, 'A', 'INTRO'));
            f.push(S('VERSE', 8, 'A', 'VERSE'), S('CHORUS', 8, 'B', 'CHORUS'),
                   S('VERSE', 8, 'A', 'VERSE'), S('CHORUS', 8, 'B', 'CHORUS'));
            if (chance(0.5)) f.push(S('VERSE', 8, 'A', 'VERSE'));
            if (chance(0.7)) f.push(S('OUTRO', 4, 'A', 'OUTRO', true));
            return f;
        }
    }
}
