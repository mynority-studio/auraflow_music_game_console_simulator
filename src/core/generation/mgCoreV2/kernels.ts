// ============================================================
// kernels.ts — 6 个钢琴伴奏 kernel(2026-05-28 Phase 3)
// ============================================================
//
// Kernel = 纯函数 (chord, styleVector, ctx) → NoteEvent[]
//   每个 kernel 实现一种"原子"伴奏模式,通过 StyleVector 参数控制变奏。
//   StyleVector 4 axis 都是连续值 → 同一个 kernel 在不同 vector 下听感不同。
//
// 6 kernels:
//   Harmony 类(右手):BlockChord / Arpeggio / PedalSustained / Stab
//   Bass 类(左手):  BassRoot / BassWalk
//
// pickKernels() 按 vector 自动挑 1 个 bass + 1 个 harmony,组合渲染。
// ============================================================

import type { ChordDef, NoteEvent } from '../mgEngine/musicEngine';
import type { StyleName } from '../mgEngine/styleDictionary';
import {
    type StyleVector,
    articulationToDurRatio,
    volumeToVelocity,
    registerSpreadToOctaveGap,
} from './styleVector';

export interface KernelContext {
    /** 该 chord 在全曲中的绝对起始 beat */
    startBeat: number;
    /** 该 chord 的持续 beat 数 */
    duration: number;
    /** style vector */
    vector: StyleVector;
}

export type Kernel = (chord: ChordDef, ctx: KernelContext) => NoteEvent[];

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** 取 chord voicing,需要时按 registerSpread 调高八度部分音 */
function getVoicingForRH(chord: ChordDef, vector: StyleVector): number[] {
    const base = chord.notesMidi.slice().sort((a, b) => a - b);
    if (base.length === 0) return [];
    // registerSpread > 0.5 时:把最低音降一个八度作为厚度,其他保留在 oct5
    if (vector.registerSpread > 0.7 && base.length >= 3) {
        // wide:lowest 升一组高八度对应位置(简化:只保留高 3 音 + 顶音 +12)
        return [...base.slice(-3), base[base.length - 1] + 12];
    }
    return base;
}

function getBassNote(chord: ChordDef, vector: StyleVector): number {
    // registerSpread 高 → bass 更低
    const baseBass = chord.bassMidi;
    const gap = registerSpreadToOctaveGap(vector.registerSpread);
    if (gap >= 3 && baseBass > 36) return baseBass - 12;  // 拉到 C2 区
    return baseBass;
}

// ─────────────────────────────────────────────────────────────────
// HARMONY KERNELS
// ─────────────────────────────────────────────────────────────────

/**
 * BlockChord — 柱式和弦
 *   density ≤ 0.3:每 chord 1 击(beat 0)
 *   density 0.3-0.7:每 chord 2 击(beat 0 + beat 2)
 *   density > 0.7:每 chord 4 击(beat 0/1/2/3 八分音符级)
 */
export const BlockChord: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const voicing = getVoicingForRH(chord, ctx.vector);
    const vel = volumeToVelocity(ctx.vector.volume);
    const baseDur = articulationToDurRatio(ctx.vector.articulation);

    let strokeBeats: number[];
    if (ctx.vector.density <= 0.3) {
        strokeBeats = [0];
    } else if (ctx.vector.density <= 0.7) {
        strokeBeats = ctx.duration > 2 ? [0, 2] : [0];
    } else {
        strokeBeats = [0, 1, 2, 3].filter(b => b < ctx.duration);
    }

    for (const b of strokeBeats) {
        const isFirstBeat = b === 0;
        const dynVel = isFirstBeat ? vel : Math.round(vel * 0.85);
        for (const m of voicing) {
            events.push({
                noteNumber: m,
                time: ctx.startBeat + b,
                duration: Math.min(baseDur, ctx.duration - b),
                velocity: dynVel,
                part: 'chord',
            });
        }
    }
    return events;
};

/**
 * Arpeggio — 琶音上行(可循环 voicing)
 *   density 直接控制速率:0.3 = 4 个音/bar,0.7 = 8 个,1.0 = 16 个
 */
export const Arpeggio: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const voicing = getVoicingForRH(chord, ctx.vector);
    if (voicing.length === 0) return events;
    const vel = volumeToVelocity(ctx.vector.volume);

    const notesPerBar = Math.max(2, Math.round(2 + ctx.vector.density * 14));  // 2-16
    const step = ctx.duration / notesPerBar;
    const dur = step * articulationToDurRatio(ctx.vector.articulation);

    for (let i = 0; i < notesPerBar; i++) {
        const pitch = voicing[i % voicing.length];
        events.push({
            noteNumber: pitch,
            time: ctx.startBeat + i * step,
            duration: dur,
            velocity: Math.round(vel * (i === 0 ? 1.0 : 0.85)),
            part: 'chord',
        });
    }
    return events;
};

/**
 * PedalSustained — 整 chord 长音持续(legato),voicing 一起按下,duration 满
 */
export const PedalSustained: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const voicing = getVoicingForRH(chord, ctx.vector);
    const vel = volumeToVelocity(ctx.vector.volume * 0.85);  // 长音稍轻

    for (const m of voicing) {
        events.push({
            noteNumber: m,
            time: ctx.startBeat,
            duration: ctx.duration * 0.98,  // 留 2% 给下一个 chord
            velocity: vel,
            part: 'chord',
        });
    }
    return events;
};

/**
 * Stab — 短促 staccato 击点(强 articulation 反转)
 *   每 chord 2-3 击,duration 强制 0.2 beat 内
 */
export const Stab: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const voicing = getVoicingForRH(chord, ctx.vector);
    const vel = volumeToVelocity(ctx.vector.volume * 1.05);  // stab 稍亮
    const stabDur = 0.2;  // staccato 强制

    const beats: number[] = ctx.vector.density > 0.5
        ? [0, 1.5, 2.5].filter(b => b < ctx.duration)  // 切分 stabs
        : [0, 2].filter(b => b < ctx.duration);

    for (const b of beats) {
        for (const m of voicing) {
            events.push({
                noteNumber: m,
                time: ctx.startBeat + b,
                duration: stabDur,
                velocity: vel,
                part: 'chord',
            });
        }
    }
    return events;
};

// ─────────────────────────────────────────────────────────────────
// BASS KERNELS
// ─────────────────────────────────────────────────────────────────

/**
 * BassRoot — 单根音(每 chord 1 击,duration 满)
 */
export const BassRoot: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const bass = getBassNote(chord, ctx.vector);
    const vel = Math.round(volumeToVelocity(ctx.vector.volume) * 1.1);
    const dur = ctx.duration * articulationToDurRatio(ctx.vector.articulation);

    events.push({
        noteNumber: bass,
        time: ctx.startBeat,
        duration: Math.min(dur, ctx.duration * 0.98),
        velocity: vel,
        part: 'bass',
    });
    return events;
};

/**
 * BassWalk — 走动 bass(根-五-根-五,或根-3-5-根)
 *   每拍一个音,4 拍 chord 走 4 步
 */
export const BassWalk: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const root = getBassNote(chord, ctx.vector);
    const fifth = root + 7;
    const third = root + 4;  // 简化:major 三度;后续可读 chord.type 决定
    const vel = Math.round(volumeToVelocity(ctx.vector.volume) * 1.1);
    const stepDur = ctx.duration / Math.max(1, Math.floor(ctx.duration));

    // 4 拍 chord: [root, third, fifth, root+7]
    // 2 拍 chord: [root, fifth]
    const pattern = ctx.duration >= 4
        ? [root, third, fifth, root + 12 - 5]  // 1-3-5-(b7 或 b1 重根)
        : [root, fifth];

    const noteDur = stepDur * articulationToDurRatio(ctx.vector.articulation);

    for (let i = 0; i < pattern.length; i++) {
        if (i * stepDur >= ctx.duration) break;
        events.push({
            noteNumber: pattern[i],
            time: ctx.startBeat + i * stepDur,
            duration: Math.min(noteDur, ctx.duration - i * stepDur),
            velocity: i === 0 ? vel : Math.round(vel * 0.9),
            part: 'bass',
        });
    }
    return events;
};

// ─────────────────────────────────────────────────────────────────
// OFF-BEAT / LAYERING KERNELS(Phase 3.E)
// ─────────────────────────────────────────────────────────────────

/**
 * StabBackbeat — 后半拍 stab(beat 2 + beat 4,即 chord-relative offset 1 + 3)
 *   跟 BlockChord 在 beat 1+3 上的下拍击点形成 1-2-3-4 完整覆盖
 *   音量略低(陪衬下拍 chord)
 */
export const StabBackbeat: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const voicing = getVoicingForRH(chord, ctx.vector);
    const vel = Math.round(volumeToVelocity(ctx.vector.volume) * 0.85);
    const stabDur = 0.3;
    // 后半拍位置(chord-relative offset 1 + 3)
    const beats = [1, 3].filter(b => b < ctx.duration);
    for (const b of beats) {
        for (const m of voicing) {
            events.push({
                noteNumber: m,
                time: ctx.startBeat + b,
                duration: stabDur,
                velocity: vel,
                part: 'chord',
            });
        }
    }
    return events;
};

/**
 * Charleston — 1 + 1.5 (and-of-1) 切分音 + 持续到 beat 2
 *   爵士最经典的 comping 节奏,跟 walking bass 配对天然
 */
export const Charleston: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const voicing = getVoicingForRH(chord, ctx.vector);
    const vel = volumeToVelocity(ctx.vector.volume);
    // 一组 charleston 单元:[0 短 stab, 0.5 长 stab]。chord ≥ 4 拍再来一组 [2, 2.5]
    const units = ctx.duration >= 4 ? [0, 2] : [0];
    for (const u of units) {
        if (u >= ctx.duration) continue;
        // 第一击:beat 1 短 stab(0.3 beat)
        for (const m of voicing) {
            events.push({
                noteNumber: m,
                time: ctx.startBeat + u,
                duration: 0.3,
                velocity: vel,
                part: 'chord',
            });
        }
        // 第二击:beat 1.5 长按(持续到下一拍)
        if (u + 0.5 < ctx.duration) {
            for (const m of voicing) {
                events.push({
                    noteNumber: m,
                    time: ctx.startBeat + u + 0.5,
                    duration: Math.min(1.5, ctx.duration - (u + 0.5)),
                    velocity: Math.round(vel * 0.85),
                    part: 'chord',
                });
            }
        }
    }
    return events;
};

/**
 * AlbertiBass — 阿尔贝蒂左手:根-五-三-五 八分音符摆动(古典 + lofi 招牌)
 *   只 emit bass 三音,在 oct3 区域,每拍 0.5 beat 一个音
 */
export const AlbertiBass: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const root = getBassNote(chord, ctx.vector);
    const fifth = root + 7;
    const third = root + 4;  // 简化:暂不区分大小三度
    const vel = Math.round(volumeToVelocity(ctx.vector.volume) * 0.95);
    const noteDur = 0.5 * articulationToDurRatio(ctx.vector.articulation);

    // 4-note Alberti pattern: root-5-3-5,8 分音符
    const pattern = [root, fifth, third, fifth];
    const stepDur = 0.5;
    const steps = Math.floor(ctx.duration / stepDur);

    for (let i = 0; i < steps; i++) {
        events.push({
            noteNumber: pattern[i % pattern.length],
            time: ctx.startBeat + i * stepDur,
            duration: noteDur,
            velocity: i === 0 || i === 4 ? vel : Math.round(vel * 0.85),
            part: 'bass',
        });
    }
    return events;
};

/**
 * ArpFill — chord 下半 bar 的 8 分音 arpeggio 填充
 *   beat 2.5 ~ beat 4 之间 emit voicing 上行 / 下行
 *   跟 BlockChord(在 beat 1+3 给和声锚定)互补,填补"空隙"
 */
export const ArpFill: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const voicing = getVoicingForRH(chord, ctx.vector);
    if (voicing.length === 0) return events;
    const vel = Math.round(volumeToVelocity(ctx.vector.volume) * 0.75);
    const dur = 0.4 * articulationToDurRatio(ctx.vector.articulation);

    // 只在 chord 下半部分填(offset 2.5 → end)
    const startOffset = Math.max(2.5, ctx.duration - 1.5);
    let i = 0;
    for (let t = startOffset; t < ctx.duration - 0.2; t += 0.5, i++) {
        const pitch = voicing[i % voicing.length];
        events.push({
            noteNumber: pitch,
            time: ctx.startBeat + t,
            duration: dur,
            velocity: vel,
            part: 'chord',
        });
    }
    return events;
};

// ─────────────────────────────────────────────────────────────────
// STYLE RECIPES — 每 style 的多 kernel 组合(Phase 3.F)
// ─────────────────────────────────────────────────────────────────

/**
 * 每个 style 由多个 kernel 在不同 beat 位置层叠组成,形成真正的
 * LH/RH "切片组合"。kernel 之间通过 beat 位错开避免重复。
 */
export const STYLE_RECIPES: Record<StyleName, Kernel[]> = {
    POP: [
        // LH:稳定 root 击点
        BassRoot,
        // RH:1+3 下拍 block chord + 2+4 后拍 stab(标准 four-on-the-floor 流行)
        BlockChord,
        StabBackbeat,
    ],
    LOFI: [
        // LH:简单根音
        BassRoot,
        // RH:整 chord 长按 + 下半 bar arp 填充(招牌的"梦境感")
        PedalSustained,
        ArpFill,
    ],
    JAZZ: [
        // LH:walking bass
        BassWalk,
        // RH:charleston 切分 + 偶尔 stab 加 swing
        Charleston,
        StabBackbeat,
    ],
    BLUES: [
        // LH:阿尔贝蒂式摆动(blues / boogie 招牌)
        AlbertiBass,
        // RH:1+3 block chord
        BlockChord,
    ],
    RNB: [
        // LH:稳定 root
        BassRoot,
        // RH:长按 pedal + 下半 bar arp
        PedalSustained,
        ArpFill,
    ],
};

/**
 * 选当前 style 的 kernel 列表。adapter 对每个 chord 逐个 apply。
 * vector 参数留 hook 用于后续根据 vector 动态调整 recipe(目前未用)。
 */
export function pickKernels(vector: StyleVector, style: StyleName): Kernel[] {
    void vector;  // 当前 recipe 选 style 表;后续可加 density 阈值动态加 ArpFill 等
    return STYLE_RECIPES[style] ?? STYLE_RECIPES.POP;
}
