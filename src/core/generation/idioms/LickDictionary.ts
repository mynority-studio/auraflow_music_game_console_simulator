/**
 * LickDictionary — 签名乐句库（V3.5）
 *
 * 4 个预录乐手签名 lick — 当 PianoAccompIdiom 触发 signatureLickProb 时，
 * 用整和弦时长替换 grid 渲染，pitches 通过 snapToPool 吸附到当前 chord-tone 池。
 *
 * Lick 数据格式（移植自 SampleDEMO.md LickDictionary）：
 *   - offset       : 距 chord.startBeat 的拍数偏移
 *   - duration     : 单音持续拍数
 *   - pitchOffset  : 相对 chord root 的半音偏移（0 = root, 12 = octave up, -12 = octave down）
 *   - velocity     : 0-1 浮点（之后被 persona.dynamicRange 乘）
 *
 * 4 个 lick：
 *   - Bebop II-V-I Run          (4 beat)  — 爵士长 Run，9/octave/7/13/5/11/3/leading/root
 *   - Syncopated Latin Comp     (2 beat)  — 切分 comping，左手 root/5 + 右手 3-stack
 *   - Bluesy Double Stop Lick   (2 beat)  — 蓝调小三度滑入，右手双音
 *   - Charlie Parker Triplet    (2 beat)  — 三连音 bebop run
 *
 * 选 lick 策略：确定性 hash（chordIndex * 53 % licks.length），零 PRNG。
 *
 * 约束遵从：
 *   D-1: 零 PRNG（用 chordIndex hash）
 *   P-1: lick 数据是 flat 对象
 *   S-3: 全同步纯函数
 *
 * @author AuraFlow Tap! BandEngine V3.5
 */

export interface LickNote {
    /** 距 chord.startBeat 的拍数偏移 */
    offset: number;
    /** 单音持续拍数 */
    duration: number;
    /** 相对 chord root PC 的半音偏移（任意整数，可负） */
    pitchOffset: number;
    /** 力度（0-1，会被 PianoAccompIdiom 按 persona 缩放） */
    velocity: number;
}

export interface Lick {
    name: string;
    /** lick 总时长（拍） — caller 截断到 chord 时长内 */
    durationBeats: number;
    lh: LickNote[];
    rh: LickNote[];
}

// ============================================================
// 4 签名 lick
// ============================================================

const LICKS: ReadonlyArray<Lick> = Object.freeze([
    // 1. Bebop II-V-I Run — 4 beat
    {
        name: 'Bebop II-V-I Run',
        durationBeats: 4,
        lh: [
            { offset: 0,   duration: 1.5, pitchOffset: -12, velocity: 0.8 },  // root 低八度
            { offset: 0,   duration: 1.5, pitchOffset: 4,   velocity: 0.7 },  // 3rd
            { offset: 0,   duration: 1.5, pitchOffset: 10,  velocity: 0.7 },  // 7th
            { offset: 2.5, duration: 1.0, pitchOffset: 4,   velocity: 0.6 },
            { offset: 2.5, duration: 1.0, pitchOffset: 10,  velocity: 0.6 },
        ],
        rh: [
            { offset: 0.5,  duration: 0.25, pitchOffset: 14, velocity: 0.9 },  // 9th
            { offset: 0.75, duration: 0.25, pitchOffset: 12, velocity: 0.8 },  // octave
            { offset: 1.0,  duration: 0.25, pitchOffset: 10, velocity: 0.85 }, // 7th
            { offset: 1.25, duration: 0.25, pitchOffset: 9,  velocity: 0.8 },  // 13th
            { offset: 1.5,  duration: 0.25, pitchOffset: 7,  velocity: 0.9 },  // 5th
            { offset: 1.75, duration: 0.25, pitchOffset: 5,  velocity: 0.75 }, // 11th
            { offset: 2.0,  duration: 0.25, pitchOffset: 4,  velocity: 0.85 }, // 3rd
            { offset: 2.25, duration: 0.5,  pitchOffset: -1, velocity: 0.7 },  // leading
            { offset: 2.75, duration: 1.25, pitchOffset: 0,  velocity: 0.95 }, // resolve to root
        ],
    },
    // 2. Syncopated Latin Comp — 2 beat
    {
        name: 'Syncopated Latin Comp',
        durationBeats: 2,
        lh: [
            { offset: 0,   duration: 0.5, pitchOffset: -12, velocity: 0.85 },
            { offset: 1.5, duration: 0.5, pitchOffset: -5,  velocity: 0.8 },
        ],
        rh: [
            { offset: 0.5, duration: 0.5, pitchOffset: 4,  velocity: 0.85 },
            { offset: 0.5, duration: 0.5, pitchOffset: 7,  velocity: 0.85 },
            { offset: 0.5, duration: 0.5, pitchOffset: 10, velocity: 0.85 },
            { offset: 1.5, duration: 0.5, pitchOffset: 4,  velocity: 0.9 },
            { offset: 1.5, duration: 0.5, pitchOffset: 7,  velocity: 0.9 },
            { offset: 1.5, duration: 0.5, pitchOffset: 10, velocity: 0.9 },
        ],
    },
    // 3. Bluesy Double Stop Lick — 2 beat
    {
        name: 'Bluesy Double Stop',
        durationBeats: 2,
        lh: [
            { offset: 0, duration: 1.5, pitchOffset: -12, velocity: 0.9 },
            { offset: 0, duration: 1.5, pitchOffset: -5,  velocity: 0.8 },
        ],
        rh: [
            { offset: 0,    duration: 0.25, pitchOffset: 3,  velocity: 0.8 },  // minor 3rd
            { offset: 0.25, duration: 0.25, pitchOffset: 4,  velocity: 0.9 },  // major 3rd（蓝调撞色）
            { offset: 0.25, duration: 0.25, pitchOffset: 7,  velocity: 0.9 },
            { offset: 0.75, duration: 0.5,  pitchOffset: 10, velocity: 0.85 }, // minor 7th
            { offset: 0.75, duration: 0.5,  pitchOffset: 15, velocity: 0.85 },
            { offset: 1.5,  duration: 0.5,  pitchOffset: 12, velocity: 1.0 },  // root octave
        ],
    },
    // 4. Charlie Parker Triplet — 2 beat
    {
        name: 'Charlie Parker Triplet',
        durationBeats: 2,
        lh: [
            { offset: 0, duration: 1.0, pitchOffset: -12, velocity: 0.8 },
            { offset: 0, duration: 1.0, pitchOffset: 4,   velocity: 0.7 },
            { offset: 0, duration: 1.0, pitchOffset: 10,  velocity: 0.7 },
        ],
        rh: [
            { offset: 0,    duration: 0.33, pitchOffset: 14, velocity: 0.8 },
            { offset: 0.33, duration: 0.33, pitchOffset: 12, velocity: 0.85 },
            { offset: 0.66, duration: 0.33, pitchOffset: 10, velocity: 0.8 },
            { offset: 1.0,  duration: 0.5,  pitchOffset: 14, velocity: 0.9 },
            { offset: 1.5,  duration: 0.5,  pitchOffset: 16, velocity: 0.9 },
        ],
    },
]);

// ============================================================
// 公开 API
// ============================================================

/**
 * 按 chordIndex 确定性选 lick（零 PRNG）。
 * 用法：caller 已经通过 signatureLickProb 判定触发，此函数返回选中的 lick。
 */
export function pickLickDeterministic(chordIndex: number): Lick {
    const idx = ((chordIndex * 53) | 0) % LICKS.length;
    const safe = idx < 0 ? idx + LICKS.length : idx;
    return LICKS[safe];
}

/** 暴露 lick 总数（测试用） */
export function getLickPoolSize(): number {
    return LICKS.length;
}
