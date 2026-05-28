// ============================================================
// kernels.ts — 钢琴伴奏 kernel(2026-05-28 Phase 4 重写)
// ============================================================
//
// 每个 kernel 是 (chord, vector, ctx) → NoteEvent[] 的纯函数,自带
// activate(vector) 谓词决定该 bar 是否 fire。
//
// **没有 STYLE_RECIPE_SETS 硬表** — kernel 列表是全局共享的,谁触发由 vector
// 自己说了算。这才是真正的 dimensional 切片。
//
// Bass kernels 互斥(pickBass 选 1 个);Harmony kernels 各自独立 fire 可层叠。
// ============================================================

import type { ChordDef, NoteEvent } from '../mgEngine/musicEngine';
import {
    type StyleVector,
    articulationToDurRatio,
    voicingSpreadToOctaveGap,
    BASE_VELOCITY,
} from './styleVector';

export interface KernelContext {
    startBeat: number;
    duration: number;
    vector: StyleVector;
    barIndex: number;
    totalBars: number;
}

export type Kernel = (chord: ChordDef, ctx: KernelContext) => NoteEvent[];

export interface KernelDescriptor {
    name: string;
    kernel: Kernel;
    activate: (v: StyleVector) => boolean;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function getVoicingForRH(chord: ChordDef, vector: StyleVector): number[] {
    const base = chord.notesMidi.slice().sort((a, b) => a - b);
    if (base.length === 0) return [];
    // voicingSpread > 0.7:wide,顶音 +12 octave
    if (vector.voicingSpread > 0.7 && base.length >= 3) {
        return [...base.slice(-3), base[base.length - 1] + 12];
    }
    return base;
}

function getBassNote(chord: ChordDef, vector: StyleVector): number {
    const baseBass = chord.bassMidi;
    const gap = voicingSpreadToOctaveGap(vector.voicingSpread);
    if (gap >= 3 && baseBass > 36) return baseBass - 12;
    return baseBass;
}

/**
 * 从 chord.notesMidi 反推真实 chord tone,bass 区域 wrap 到合理八度。
 *
 * **核心保证**:返回值的 pitch class **永远是 chord 实际包含的音**(即
 * chord.notesMidi 里某个音的 mod 12)。没有任何 hardcoded fallback 到非
 * 和弦音。sus / dyad / power chord / 任何稀疏 voicing 都安全。
 *
 * Role 优先级链(找不到目标音类则降级到下一个,最差降到 root,绝不出错音):
 *   third   :  b3(3) → maj3(4) → sus2(2) → sus4(5) → 5th(7) → root(0)
 *   fifth   :  P5(7) → d5(6) → A5(8) → root(0)
 *   seventh :  b7(10) → maj7(11) → 6(9) → root(0)
 */
function chordToneAt(chord: ChordDef, role: 'third' | 'fifth' | 'seventh', vector: StyleVector): number {
    const rootPc = ((chord.rootMidi % 12) + 12) % 12;
    const intervals = new Set<number>();
    for (const m of chord.notesMidi) {
        intervals.add((((m % 12) - rootPc) + 12) % 12);
    }
    // root 永远存在(保险)
    intervals.add(0);

    /** 找第一个在 intervals 里的 semis,找不到返 0(root) */
    const firstAvailable = (candidates: number[]): number => {
        for (const s of candidates) if (intervals.has(s)) return s;
        return 0;
    };

    let semis: number;
    if (role === 'third') {
        // minor 3 / major 3 / sus2 / sus4 / 5th / root —— 全部从 chord 实音里挑
        semis = firstAvailable([3, 4, 2, 5, 7]);
    } else if (role === 'fifth') {
        semis = firstAvailable([7, 6, 8]);
    } else {
        // seventh:b7 优先,大七次之,然后 6 度
        semis = firstAvailable([10, 11, 9]);
    }

    const bassRef = getBassNote(chord, vector);
    const bassOct = Math.floor(bassRef / 12);
    let result = bassOct * 12 + ((rootPc + semis) % 12);
    while (result < bassRef - 6) result += 12;
    while (result > bassRef + 6) result -= 12;
    return result;
}

/** density [0,1] + 基线 → MIDI velocity,phrase 强弱可在 kernel 内额外调 */
function densityVel(v: StyleVector, isStrong: boolean = false): number {
    const base = BASE_VELOCITY + (v.density - 0.5) * 20;  // density 0 → 70, 1 → 90
    return Math.round(isStrong ? base + 10 : base);
}

// ─────────────────────────────────────────────────────────────────
// HARMONY KERNELS(各自独立 activate,可层叠)
// ─────────────────────────────────────────────────────────────────

/**
 * BlockChord — 柱式和弦,strokes/bar 由 density 决定
 *   density 0.0 → 1 stroke (beat 0)
 *   density 0.5 → 2 strokes (beat 0, 2)
 *   density 1.0 → 4 strokes (beat 0, 1, 2, 3)
 */
export const BlockChord: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const voicing = getVoicingForRH(chord, ctx.vector);
    const dur = ctx.duration * articulationToDurRatio(ctx.vector.articulation) * 0.5;

    const strokesCount = Math.max(1, Math.min(4, Math.round(1 + ctx.vector.density * 3)));
    // 选合理 beat 位置:1 stroke→[0],2→[0,2],3→[0,1.5,2.5],4→[0,1,2,3]
    const beatPositions: number[][] = [
        [0],
        [0, 2],
        [0, 1.5, 2.5],
        [0, 1, 2, 3],
    ];
    const beats = beatPositions[strokesCount - 1].filter(b => b < ctx.duration);

    for (const b of beats) {
        const isDown = b === 0 || b === 2;
        const vel = densityVel(ctx.vector, isDown);
        for (const m of voicing) {
            events.push({
                noteNumber: m,
                time: ctx.startBeat + b,
                duration: Math.min(dur, ctx.duration - b),
                velocity: vel,
                part: 'chord',
            });
        }
    }
    return events;
};

/**
 * Arpeggio — 高密度连续 8th 琶音(density > 0.7 才会触发)
 */
export const Arpeggio: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const voicing = getVoicingForRH(chord, ctx.vector);
    if (voicing.length === 0) return events;
    const notesPerBar = Math.round(4 + ctx.vector.density * 8);  // 4-12
    const step = ctx.duration / notesPerBar;
    const dur = step * articulationToDurRatio(ctx.vector.articulation) * 1.2;

    for (let i = 0; i < notesPerBar; i++) {
        const pitch = voicing[i % voicing.length];
        events.push({
            noteNumber: pitch,
            time: ctx.startBeat + i * step,
            duration: dur,
            velocity: densityVel(ctx.vector, i === 0),
            part: 'chord',
        });
    }
    return events;
};

/**
 * PedalSustained — 整 chord 长按(legato + 高 pedalUsage 触发)
 */
export const PedalSustained: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const voicing = getVoicingForRH(chord, ctx.vector);
    const vel = Math.round(densityVel(ctx.vector) * 0.85);
    for (const m of voicing) {
        events.push({
            noteNumber: m,
            time: ctx.startBeat,
            duration: ctx.duration * 0.98,
            velocity: vel,
            part: 'chord',
        });
    }
    return events;
};

/**
 * Stab — 极 staccato 短 stab(articulation < 0.3 才会触发)
 */
export const Stab: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const voicing = getVoicingForRH(chord, ctx.vector);
    const vel = Math.round(densityVel(ctx.vector, true) * 1.05);
    const beats = ctx.vector.density > 0.5
        ? [0, 1.5, 2.5].filter(b => b < ctx.duration)
        : [0, 2].filter(b => b < ctx.duration);
    for (const b of beats) {
        for (const m of voicing) {
            events.push({
                noteNumber: m,
                time: ctx.startBeat + b,
                duration: 0.2,
                velocity: vel,
                part: 'chord',
            });
        }
    }
    return events;
};

/**
 * StabBackbeat — 后半拍(beat 2+4)stab(syncopation > 0.25 触发)
 */
export const StabBackbeat: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const voicing = getVoicingForRH(chord, ctx.vector);
    const vel = Math.round(densityVel(ctx.vector) * 0.85);
    const beats = [1, 3].filter(b => b < ctx.duration);
    for (const b of beats) {
        for (const m of voicing) {
            events.push({
                noteNumber: m,
                time: ctx.startBeat + b,
                duration: 0.3,
                velocity: vel,
                part: 'chord',
            });
        }
    }
    return events;
};

/**
 * Charleston — beat 1 短 stab + beat 1.5 长按(syncopation > 0.55 触发)
 */
export const Charleston: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const voicing = getVoicingForRH(chord, ctx.vector);
    const vel = densityVel(ctx.vector);
    const units = ctx.duration >= 4 ? [0, 2] : [0];
    for (const u of units) {
        if (u >= ctx.duration) continue;
        for (const m of voicing) {
            events.push({
                noteNumber: m,
                time: ctx.startBeat + u,
                duration: 0.3,
                velocity: vel,
                part: 'chord',
            });
        }
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
 * ArpFill — chord 下半 bar 8 分音 arp 填充(中等 density 触发)
 */
export const ArpFill: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const voicing = getVoicingForRH(chord, ctx.vector);
    if (voicing.length === 0) return events;
    const vel = Math.round(densityVel(ctx.vector) * 0.75);
    const dur = 0.4 * articulationToDurRatio(ctx.vector.articulation);
    const startOffset = Math.max(2.5, ctx.duration - 1.5);
    let i = 0;
    for (let t = startOffset; t < ctx.duration - 0.2; t += 0.5, i++) {
        events.push({
            noteNumber: voicing[i % voicing.length],
            time: ctx.startBeat + t,
            duration: dur,
            velocity: vel,
            part: 'chord',
        });
    }
    return events;
};

// ─────────────────────────────────────────────────────────────────
// BASS KERNELS(互斥,pickBass 选 1)
// ─────────────────────────────────────────────────────────────────

export const BassRoot: Kernel = (chord, ctx) => {
    const bass = getBassNote(chord, ctx.vector);
    const vel = Math.round(densityVel(ctx.vector, true) * 1.05);
    const dur = ctx.duration * articulationToDurRatio(ctx.vector.articulation);
    return [{
        noteNumber: bass,
        time: ctx.startBeat,
        duration: Math.min(dur, ctx.duration * 0.98),
        velocity: vel,
        part: 'bass',
    }];
};

export const BassWalk: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const root = getBassNote(chord, ctx.vector);
    // 从 chord.notesMidi 反推真实三度/五度(自动识别 major/minor/dim,调内安全)
    const third = chordToneAt(chord, 'third', ctx.vector);
    const fifth = chordToneAt(chord, 'fifth', ctx.vector);
    const vel = Math.round(densityVel(ctx.vector, true) * 1.05);
    const stepDur = ctx.duration / Math.max(1, Math.floor(ctx.duration));
    // Walk: root → 3rd → 5th → octave(4 beat),or root → 5th(2 beat)
    const pattern = ctx.duration >= 4 ? [root, third, fifth, root + 12] : [root, fifth];
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

export const AlbertiBass: Kernel = (chord, ctx) => {
    const events: NoteEvent[] = [];
    const root = getBassNote(chord, ctx.vector);
    // 自动 minor/major 识别(同 BassWalk)
    const third = chordToneAt(chord, 'third', ctx.vector);
    const fifth = chordToneAt(chord, 'fifth', ctx.vector);
    const vel = Math.round(densityVel(ctx.vector) * 0.95);
    const noteDur = 0.5 * articulationToDurRatio(ctx.vector.articulation);
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

// ─────────────────────────────────────────────────────────────────
// Activation 谓词 + pickBass 互斥选择
// ─────────────────────────────────────────────────────────────────

/**
 * Bass kernels 互斥 — 一首歌一拍只能一个 bass kernel 弹。按 vector 三段分:
 *   bassLinearity < 0.4 → BassRoot(静态根音/pedal)
 *   0.4 ≤ bassLinearity ≤ 0.65 + 低 pedalUsage → AlbertiBass(摆动)
 *   bassLinearity > 0.65 + 低 pedalUsage → BassWalk(走动)
 *   pedalUsage 很高时(LOFI/RNB)→ 强制 BassRoot,因为踩满踏板下 walking 会糊
 */
export function pickBass(v: StyleVector): { name: string; kernel: Kernel } {
    if (v.pedalUsage > 0.6) return { name: 'BassRoot', kernel: BassRoot };
    if (v.bassLinearity > 0.65) return { name: 'BassWalk', kernel: BassWalk };
    if (v.bassLinearity >= 0.4) return { name: 'AlbertiBass', kernel: AlbertiBass };
    return { name: 'BassRoot', kernel: BassRoot };
}

/**
 * Harmony kernels — 每个独立 activate,可层叠。
 *
 * 谓词设计原则:
 *   - 每个 kernel 占据 vector 空间的一片"舒适区"
 *   - 区与区之间有重叠 → 高维 vector 可同时触发多个 → 层叠 = 切片组合
 *   - PedalSustained + BlockChord/ArpFill 互斥(pedalUsage 阈值反向)
 */
export const HARMONY_KERNELS: KernelDescriptor[] = [
    {
        name: 'BlockChord',
        kernel: BlockChord,
        activate: v => v.pedalUsage < 0.75,
    },
    {
        name: 'PedalSustained',
        kernel: PedalSustained,
        activate: v => v.pedalUsage > 0.5,
    },
    {
        name: 'StabBackbeat',
        kernel: StabBackbeat,
        activate: v => v.syncopation > 0.25 && v.pedalUsage < 0.7,
    },
    {
        name: 'Charleston',
        kernel: Charleston,
        activate: v => v.syncopation > 0.55 && v.pedalUsage < 0.6,
    },
    {
        name: 'ArpFill',
        kernel: ArpFill,
        activate: v => v.density > 0.35 && v.density < 0.7 && v.pedalUsage < 0.85,
    },
    {
        name: 'Arpeggio',
        kernel: Arpeggio,
        activate: v => v.density > 0.7 && v.pedalUsage < 0.5,
    },
    {
        name: 'Stab',
        kernel: Stab,
        activate: v => v.articulation < 0.3,
    },
];
