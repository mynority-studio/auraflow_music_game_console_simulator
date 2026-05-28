// ============================================================
// patterns.ts — V3 横向 texture pattern 库(2026-05-28)
// ============================================================
//
// 灵感来源:MMA stdlib(~/vibe_coding/mma/lib/stdlib/*.mma),通过 audit-mma-
// patterns.ts 提取 122 文件的时间-事件分布,数据驱动选典型 pattern。
//
// **审计承诺(度量衡对账)**:
//   - 每个 pattern emit 的 pitch **100% 来自**:
//     * voicing[](V3 Viterbi 选的 chord tones),或
//     * bassMidi(chord.bassMidi 直接,本身是 chord 实音)
//   - **无 scale 经过音 / 无 extension 强加 / 无 hardcoded interval** →
//     由构造保证不出冲突音。
//   - 时间单位:beat 0-indexed from chord start(MMA 的 1 → 我们 0)
//   - duration 单位:beat(MMA 的 4 → 1 beat,8 → 0.5 beat)
//   - velocity:0-1 float(NoteData 标准)
//
// 跟 mg V1 的差异:
//   - mg 用 50+ 个 hardcoded applyTexture switch case
//   - V3 用少数(<10)pure function pattern,正交组合;voicing 已被 Viterbi
//     全局优化,patterns 只负责"横向流动"
// ============================================================

import type { NoteData } from '../ir';

export interface PatternArgs {
    /** Viterbi 选的 voicing(sorted ascending,RH register 48-84) */
    voicing: number[];
    /** chord bass MIDI(已 clamp 到 bass register 38-50) */
    bassMidi: number;
    /** chord 在全曲的绝对起始 beat */
    startBeat: number;
    /** chord 持续 beat 数 */
    duration: number;
}

export type Pattern = (args: PatternArgs) => NoteData[];

// ─────────────────────────────────────────────────────────────────
// Velocity constants(0-1 float)
// ─────────────────────────────────────────────────────────────────

const VEL_BASS_STRONG = 0.72;
const VEL_BASS_WEAK   = 0.62;
const VEL_RH_DOWNBEAT = 0.62;
const VEL_RH_UPBEAT   = 0.52;

// ─────────────────────────────────────────────────────────────────
// BASS PATTERNS
// ─────────────────────────────────────────────────────────────────

/**
 * bassRootSustained — bass root 整 chord 长按(LOFI/RNB 招牌)
 *   emit:bassMidi @ beat 0,duration = chord 全长 * 0.95
 *   音源:chord.bassMidi(本身是 chord tone)
 */
export const bassRootSustained: Pattern = ({ bassMidi, startBeat, duration }) => [{
    pitch: bassMidi,
    onset: startBeat,
    duration: duration * 0.95,
    velocity: VEL_BASS_STRONG,
}];

/**
 * bassRoot5 — root @ beat 0,fifth @ beat 2(经典流行 bass)
 *   emit:bassMidi @ 0 + (voicing 中找 5th)@ 2
 *   音源:bassMidi + voicing 中 PC 距 root +7/+6/+8 的音
 *   chord < 4 beat 时退化为单 root
 */
export const bassRoot5: Pattern = ({ voicing, bassMidi, startBeat, duration }) => {
    const out: NoteData[] = [
        { pitch: bassMidi, onset: startBeat, duration: 2 * 0.95, velocity: VEL_BASS_STRONG },
    ];
    if (duration < 4) return [{ pitch: bassMidi, onset: startBeat, duration: duration * 0.95, velocity: VEL_BASS_STRONG }];

    // 从 voicing 找 5th(寻最近 fifth interval 的实音,wrap 到 bass register)
    const rootPc = ((bassMidi % 12) + 12) % 12;
    let fifthMidi: number | null = null;
    for (const m of voicing) {
        const pc = ((m % 12) + 12) % 12;
        const interval = ((pc - rootPc) + 12) % 12;
        if (interval === 7 || interval === 6 || interval === 8) {
            // 把这个 fifth wrap 到 bass register(bassMidi ± 6 内)
            let p = m;
            while (p > bassMidi + 9) p -= 12;
            while (p < bassMidi - 3) p += 12;
            fifthMidi = p;
            break;
        }
    }
    // 没找到 5th(罕见,只有 power chord 之类)→ 用 bassMidi 兜底
    const beat2Note = fifthMidi ?? bassMidi;
    out.push({
        pitch: beat2Note,
        onset: startBeat + 2,
        duration: (duration - 2) * 0.95,
        velocity: VEL_BASS_WEAK,
    });
    return out;
};

/**
 * bassRootOctave — root low @ beat 0,root octave @ beat 2
 *   emit:bassMidi + bassMidi+12(若 +12 不超 60 = C4)
 *   音源:bassMidi(同 PC,不同八度,仍是 chord tone)
 */
export const bassRootOctave: Pattern = ({ bassMidi, startBeat, duration }) => {
    const out: NoteData[] = [
        { pitch: bassMidi, onset: startBeat, duration: Math.min(2, duration) * 0.95, velocity: VEL_BASS_STRONG },
    ];
    if (duration < 4) return out;
    const octave = bassMidi + 12 <= 60 ? bassMidi + 12 : bassMidi;
    out.push({
        pitch: octave,
        onset: startBeat + 2,
        duration: (duration - 2) * 0.95,
        velocity: VEL_BASS_WEAK,
    });
    return out;
};

// ─────────────────────────────────────────────────────────────────
// CHORD PATTERNS
// ─────────────────────────────────────────────────────────────────

/**
 * chordBlockOnce — full voicing @ beat 0,长按全 chord
 *   emit:voicing 全音 @ 0,duration = chord 全长 * 0.95
 *   音源:voicing(Viterbi 选,全 chord tone)
 */
export const chordBlockOnce: Pattern = ({ voicing, startBeat, duration }) => {
    return voicing.map(m => ({
        pitch: m,
        onset: startBeat,
        duration: duration * 0.95,
        velocity: VEL_RH_DOWNBEAT,
    }));
};

/**
 * chordBlockTwice — full voicing @ beat 0 + beat 2(4-beat chord 才有第二击)
 *   音源:voicing
 */
export const chordBlockTwice: Pattern = ({ voicing, startBeat, duration }) => {
    const out: NoteData[] = [];
    const strokeDur = Math.min(2, duration) * 0.95;
    for (const m of voicing) {
        out.push({ pitch: m, onset: startBeat, duration: strokeDur, velocity: VEL_RH_DOWNBEAT });
    }
    if (duration >= 4) {
        const rep2Dur = Math.min(2, duration - 2) * 0.95;
        for (const m of voicing) {
            out.push({ pitch: m, onset: startBeat + 2, duration: rep2Dur, velocity: VEL_RH_UPBEAT });
        }
    }
    return out;
};

/**
 * chordCharleston — beat 0 短 stab + beat 0.5 长按(典型 jazz comping)
 *   pattern:
 *     [0]      voicing,short(0.3 beat)
 *     [0.5]    voicing,sustained(到 beat 2 为止)
 *     若 duration >= 4:beat 2/2.5 重复一组
 *   音源:voicing
 */
export const chordCharleston: Pattern = ({ voicing, startBeat, duration }) => {
    const out: NoteData[] = [];
    const phraseAtBeat = (b: number, isHalf: boolean): void => {
        if (b >= duration) return;
        for (const m of voicing) {
            out.push({
                pitch: m,
                onset: startBeat + b,
                duration: isHalf ? Math.min(1.5, duration - b) * 0.95 : 0.3,
                velocity: isHalf ? VEL_RH_UPBEAT : VEL_RH_DOWNBEAT,
            });
        }
    };
    phraseAtBeat(0,   false);  // short stab
    phraseAtBeat(0.5, true);   // sustained
    if (duration >= 4) {
        phraseAtBeat(2,   false);
        phraseAtBeat(2.5, true);
    }
    return out;
};

/**
 * chordArpUp — voicing 音逐个上行,8 分音符
 *   pattern:voicing[i] @ beat i*0.5(i 取模 voicing.length)
 *   音源:voicing(每个音都是 chord tone)
 */
export const chordArpUp: Pattern = ({ voicing, startBeat, duration }) => {
    const out: NoteData[] = [];
    if (voicing.length === 0) return out;
    const stepDur = 0.5;
    const noteDur = stepDur * 0.95;
    const steps = Math.floor(duration / stepDur);
    for (let i = 0; i < steps; i++) {
        const pitch = voicing[i % voicing.length];
        out.push({
            pitch,
            onset: startBeat + i * stepDur,
            duration: noteDur,
            velocity: i === 0 ? VEL_RH_DOWNBEAT : VEL_RH_UPBEAT,
        });
    }
    return out;
};

/**
 * chordArpAlberti — Alberti 左手:[low, top, mid, top] 循环
 *   pattern:voicing[0] - voicing[top] - voicing[mid] - voicing[top]
 *   音源:voicing(选索引 0、length-1、length/2)
 */
export const chordArpAlberti: Pattern = ({ voicing, startBeat, duration }) => {
    const out: NoteData[] = [];
    if (voicing.length < 2) return out;
    const low = voicing[0];
    const high = voicing[voicing.length - 1];
    const mid = voicing[Math.floor(voicing.length / 2)];
    const stepDur = 0.5;
    const noteDur = stepDur * 0.95;
    const pattern = [low, high, mid, high];
    const steps = Math.floor(duration / stepDur);
    for (let i = 0; i < steps; i++) {
        out.push({
            pitch: pattern[i % pattern.length],
            onset: startBeat + i * stepDur,
            duration: noteDur,
            velocity: i % 4 === 0 ? VEL_RH_DOWNBEAT : VEL_RH_UPBEAT,
        });
    }
    return out;
};

// ─────────────────────────────────────────────────────────────────
// 按 style 自动选 patterns(per-style pattern combo)
// ─────────────────────────────────────────────────────────────────

import type { StyleName } from '../mgEngine/styleDictionary';

export interface StylePatterns {
    bass: Pattern;
    /** 多个 chord pattern 同时 fire,事件层叠 */
    chord: Pattern[];
}

export const STYLE_PATTERNS: Record<StyleName, StylePatterns> = {
    POP: {
        bass: bassRoot5,
        chord: [chordBlockTwice],            // 1+3 拍 block,典型 pop balad
    },
    LOFI: {
        bass: bassRootSustained,
        chord: [chordBlockOnce, chordArpUp], // 长按 + 上行 arp,梦境感
    },
    JAZZ: {
        bass: bassRoot5,
        chord: [chordCharleston],            // 1 + 1.5 切分 comping
    },
    BLUES: {
        bass: bassRootOctave,
        chord: [chordArpAlberti],            // Alberti 8 分摆动
    },
    RNB: {
        bass: bassRootSustained,
        chord: [chordBlockOnce, chordArpUp], // 同 LOFI,稍亮(velocity 在 NoteData 0-1 不分)
    },
};
