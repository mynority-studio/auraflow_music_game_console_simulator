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
import type { StyleBaseTexture } from './styleBaseTexture';

export interface PatternArgs {
    /** Viterbi 选的 voicing(sorted ascending,RH register 48-84) */
    voicing: number[];
    /** chord root MIDI(chord.rootMidi clamped to bass register)— 用于 interval 计算 */
    rootMidi: number;
    /** chord bass MIDI(chord.bassMidi clamped 到 bass register 38-50)— 实际弹的"贝斯音",
     *  slash chord 时 ≠ rootMidi(例 Dm/F 的 bassMidi=F,rootMidi=D) */
    bassMidi: number;
    /** chord 在全曲的绝对起始 beat */
    startBeat: number;
    /** chord 持续 beat 数 */
    duration: number;
    /**
     * 下一 chord 的 bass MIDI(全曲最后 chord 时 undefined)。
     * walking bass 用于 beat 4 leading tone approach。
     */
    nextBassMidi?: number;
    /**
     * 当前 style 的 base texture(L1 提供)。
     * P1 阶段:patterns 只读 baseTexture.velocityScale 微调输出。
     * P2+:patterns 用 fillProb / syncShiftProb / restProb 做概率决策。
     */
    baseTexture: StyleBaseTexture;
}

export type Pattern = (args: PatternArgs) => NoteData[];

// ─────────────────────────────────────────────────────────────────
// Velocity constants(0-1 float)— 基线值,patterns 内 ×= baseTexture.velocityScale
// ─────────────────────────────────────────────────────────────────

const BASELINE_BASS_STRONG = 0.85;
const BASELINE_BASS_WEAK   = 0.72;
const BASELINE_RH_DOWN     = 0.72;
const BASELINE_RH_UP       = 0.60;

/** Pattern 内统一调速:baseline × baseTexture.velocityScale */
function vBassStrong(t: StyleBaseTexture): number { return BASELINE_BASS_STRONG * t.velocityScale; }
function vBassWeak(t: StyleBaseTexture): number   { return BASELINE_BASS_WEAK   * t.velocityScale; }
function vRhDown(t: StyleBaseTexture): number     { return BASELINE_RH_DOWN     * t.velocityScale; }
function vRhUp(t: StyleBaseTexture): number       { return BASELINE_RH_UP       * t.velocityScale; }

// ─────────────────────────────────────────────────────────────────
// BASS PATTERNS
// ─────────────────────────────────────────────────────────────────

/**
 * bassRootSustained — bass root 整 chord 长按(LOFI/RNB 招牌)
 *   emit:bassMidi @ beat 0,duration = chord 全长 * 0.95
 *   音源:chord.bassMidi(本身是 chord tone)
 */
export const bassRootSustained: Pattern = ({ bassMidi, startBeat, duration, baseTexture }) => [{
    pitch: bassMidi,
    onset: startBeat,
    duration: duration * 0.95,
    velocity: vBassStrong(baseTexture),
}];

/**
 * bassRoot5 — root @ beat 0,fifth @ beat 2(经典流行 bass)
 *   emit:bassMidi @ 0 + (voicing 中找 5th)@ 2
 *   音源:bassMidi + voicing 中 PC 距 root +7/+6/+8 的音
 *   chord < 4 beat 时退化为单 root
 */
export const bassRoot5: Pattern = ({ voicing, rootMidi, bassMidi, startBeat, duration, baseTexture }) => {
    if (duration < 4) {
        return [{ pitch: bassMidi, onset: startBeat, duration: duration * 0.95, velocity: vBassStrong(baseTexture) }];
    }
    const out: NoteData[] = [
        { pitch: bassMidi, onset: startBeat, duration: 2 * 0.95, velocity: vBassStrong(baseTexture) },
    ];
    // Beat 2 fifth(用 chord ROOT 算 interval,从 voicing 找实音,wrap 到 bass register)
    // slash chord 时 bass ≠ root,但 5th 仍以 root 为参考
    const fifth = pickIntervalInBassRegister(voicing, rootMidi, bassMidi, [7, 6, 8]);
    // fallback:若 voicing 无 5th,且 chord 真无 5th(power chord 极少见)→ 用 bassMidi 兜底
    // 注意 fallback 不再用 bassMidi+7(slash chord 时可能出非 chord tone)
    const beat2Note = fifth ?? bassMidi;
    out.push({
        pitch: beat2Note,
        onset: startBeat + 2,
        duration: (duration - 2) * 0.95,
        velocity: vBassWeak(baseTexture),
    });
    return out;
};

/**
 * bassWalkingClassic — Walking bass(4 拍 chord 用 quarter notes 走 chord tone + leading tone)
 *
 * Pattern(4-beat chord):
 *   beat 0: chord.bassMidi(root,strong)
 *   beat 1: voicing 中的 3rd(chord tone,wrap 到 bass register)
 *   beat 2: voicing 中的 5th(chord tone)
 *   beat 3: **leading tone to next chord's bassMidi**(半音 approach,
 *           **唯一允许的非当前-chord-tone**,严格约束:beat 4 weak / short / 必 resolve)
 *
 * 2-beat chord:退化到 beat 0 root + beat 1 fifth(都是 chord tone)
 *
 * 这是教科书 jazz/pop walking bass 写法。**leading tone exception 必须文档化**,
 * 它是 V3 patterns 里唯一一个允许 non-chord-tone 的位置,
 * 用 nextBassMidi 半音下 / 半音上选最近的(注意必须 wrap 在 bass register)。
 */
export const bassWalkingClassic: Pattern = ({ voicing, rootMidi, bassMidi, startBeat, duration, nextBassMidi, baseTexture }) => {
    if (duration < 4) {
        // 2-beat chord 退化:bass(slash 可能 ≠ root)+ fifth(从 root 算)
        const fifth = pickIntervalInBassRegister(voicing, rootMidi, bassMidi, [7, 6, 8]) ?? bassMidi;
        return [
            { pitch: bassMidi, onset: startBeat, duration: 0.95, velocity: vBassStrong(baseTexture) },
            { pitch: fifth, onset: startBeat + 1, duration: 0.95, velocity: vBassWeak(baseTexture) },
        ];
    }

    const out: NoteData[] = [];
    const stepDur = 0.95;
    // 用 chord ROOT 算 interval(从 voicing 找实音),从而 slash chord 时也走 chord tone
    const third = pickIntervalInBassRegister(voicing, rootMidi, bassMidi, [3, 4]) ?? bassMidi;
    const fifth = pickIntervalInBassRegister(voicing, rootMidi, bassMidi, [7, 6, 8]) ?? bassMidi;

    out.push({ pitch: bassMidi, onset: startBeat,     duration: stepDur, velocity: vBassStrong(baseTexture) });
    out.push({ pitch: third,    onset: startBeat + 1, duration: stepDur, velocity: vBassWeak(baseTexture) });
    out.push({ pitch: fifth,    onset: startBeat + 2, duration: stepDur, velocity: vBassWeak(baseTexture) });

    // Beat 4:leading tone to next chord's bass(approach by half-step)
    if (nextBassMidi !== undefined) {
        // 选半音下 / 半音上里离 bass register 中心(MIDI 44)最近的
        const candA = nextBassMidi - 1;
        const candB = nextBassMidi + 1;
        // 必须落在 bass register [38, 50]
        const inRange = (m: number): boolean => m >= 38 && m <= 50;
        let leading: number;
        if (inRange(candA) && inRange(candB)) {
            // 偏好半音下 approach(更"自然下行"听感)
            leading = candA;
        } else if (inRange(candA)) {
            leading = candA;
        } else if (inRange(candB)) {
            leading = candB;
        } else {
            // 都不在 range,wrap candA
            leading = candA;
            while (leading > 50) leading -= 12;
            while (leading < 38) leading += 12;
        }
        out.push({ pitch: leading, onset: startBeat + 3, duration: stepDur, velocity: vBassWeak(baseTexture) });
    } else {
        // 全曲最后 chord:beat 4 退到 root(干净收)
        out.push({ pitch: bassMidi, onset: startBeat + 3, duration: stepDur, velocity: vBassWeak(baseTexture) });
    }

    return out;
};

/**
 * Helper:从 voicing 找"距 ROOT 某 interval"的音,wrap 到 bass register([nearMidi-3, nearMidi+9])。
 * rootMidi 用于 interval PC 计算(slash chord 时,root ≠ bass)。
 * nearMidi 用于 register wrap(typically = bassMidi,保证 walking 各音在同一八度区)。
 * 找不到返 null。
 */
function pickIntervalInBassRegister(
    voicing: number[],
    rootMidi: number,
    nearMidi: number,
    semisCandidates: number[],
): number | null {
    const rootPc = ((rootMidi % 12) + 12) % 12;
    for (const semis of semisCandidates) {
        const targetPc = (rootPc + semis) % 12;
        for (const m of voicing) {
            if (((m % 12) + 12) % 12 === targetPc) {
                let p = m;
                while (p > nearMidi + 9) p -= 12;
                while (p < nearMidi - 3) p += 12;
                return p;
            }
        }
    }
    return null;
}

/**
 * bassRootOctave — root low @ beat 0,root octave @ beat 2
 *   emit:bassMidi + bassMidi+12(若 +12 不超 60 = C4)
 *   音源:bassMidi(同 PC,不同八度,仍是 chord tone)
 */
export const bassRootOctave: Pattern = ({ bassMidi, startBeat, duration, baseTexture }) => {
    const out: NoteData[] = [
        { pitch: bassMidi, onset: startBeat, duration: Math.min(2, duration) * 0.95, velocity: vBassStrong(baseTexture) },
    ];
    if (duration < 4) return out;
    const octave = bassMidi + 12 <= 60 ? bassMidi + 12 : bassMidi;
    out.push({
        pitch: octave,
        onset: startBeat + 2,
        duration: (duration - 2) * 0.95,
        velocity: vBassWeak(baseTexture),
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
export const chordBlockOnce: Pattern = ({ voicing, startBeat, duration, baseTexture }) => {
    return voicing.map(m => ({
        pitch: m,
        onset: startBeat,
        duration: duration * 0.95,
        velocity: vRhDown(baseTexture),
    }));
};

/**
 * chordBlockTwice — full voicing @ beat 0 + beat 2(4-beat chord 才有第二击)
 *   音源:voicing
 */
export const chordBlockTwice: Pattern = ({ voicing, startBeat, duration, baseTexture }) => {
    const out: NoteData[] = [];
    const strokeDur = Math.min(2, duration) * 0.95;
    for (const m of voicing) {
        out.push({ pitch: m, onset: startBeat, duration: strokeDur, velocity: vRhDown(baseTexture) });
    }
    if (duration >= 4) {
        const rep2Dur = Math.min(2, duration - 2) * 0.95;
        for (const m of voicing) {
            out.push({ pitch: m, onset: startBeat + 2, duration: rep2Dur, velocity: vRhUp(baseTexture) });
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
export const chordCharleston: Pattern = ({ voicing, startBeat, duration, baseTexture }) => {
    const out: NoteData[] = [];
    const phraseAtBeat = (b: number, isHalf: boolean): void => {
        if (b >= duration) return;
        for (const m of voicing) {
            out.push({
                pitch: m,
                onset: startBeat + b,
                duration: isHalf ? Math.min(1.5, duration - b) * 0.95 : 0.3,
                velocity: isHalf ? vRhUp(baseTexture) : vRhDown(baseTexture),
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
export const chordArpUp: Pattern = ({ voicing, startBeat, duration, baseTexture }) => {
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
            velocity: i === 0 ? vRhDown(baseTexture) : vRhUp(baseTexture),
        });
    }
    return out;
};

/**
 * chordRhythmicHits — 节奏多样化 chord stab(jazz/pop comping 经典)
 *
 * Pattern(4-beat chord):
 *   beat 0    : short stab(0.4 beat)
 *   beat 0.75 : dotted-quarter held(持续 1.25 beat 到 beat 2)
 *   (beat 2-3 rest)
 *   beat 3.5  : 8th anticipation stab(eighth note before next chord)
 *
 * 2-beat chord:
 *   beat 0 short stab + beat 1.5 anticipation
 *
 * 关键特性:**有 rest**(beat 2-3 留空)+ **dotted rhythm**(beat 0.75)
 * + **anticipation**(beat 3.5)— 不再是均匀 8 分音的"音游谱面"。
 * 音源:voicing(全 chord tone)
 */
export const chordRhythmicHits: Pattern = ({ voicing, startBeat, duration, baseTexture }) => {
    const out: NoteData[] = [];
    if (voicing.length === 0) return out;

    const pushVoicing = (offset: number, dur: number, vel: number): void => {
        if (offset >= duration) return;
        const actualDur = Math.min(dur, duration - offset);
        for (const m of voicing) {
            out.push({
                pitch: m,
                onset: startBeat + offset,
                duration: actualDur * 0.95,
                velocity: vel,
            });
        }
    };

    if (duration >= 4) {
        pushVoicing(0,    0.4,  vRhDown(baseTexture));   // short stab
        pushVoicing(0.75, 1.25, vRhUp(baseTexture));     // dotted-quarter held
        // beat 2-3 rest
        pushVoicing(3.5,  0.5,  vRhDown(baseTexture));   // anticipation
    } else {
        pushVoicing(0,    0.4,  vRhDown(baseTexture));
        pushVoicing(1.5,  0.5,  vRhUp(baseTexture));
    }
    return out;
};

/**
 * chordArpAlberti — Alberti 左手:[low, top, mid, top] 循环
 *   pattern:voicing[0] - voicing[top] - voicing[mid] - voicing[top]
 *   音源:voicing(选索引 0、length-1、length/2)
 */
export const chordArpAlberti: Pattern = ({ voicing, startBeat, duration, baseTexture }) => {
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
            velocity: i % 4 === 0 ? vRhDown(baseTexture) : vRhUp(baseTexture),
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
        // LH walking 给"流动",beat 4 半音 leading 到下 chord
        bass: bassWalkingClassic,
        // RH 节奏化 stab(rest + anticipation),不再均匀 8 分
        chord: [chordRhythmicHits],
    },
    LOFI: {
        // LH 长按维持 dream 感
        bass: bassRootSustained,
        // RH 长按 + 上行 arp,arp 提供横向流动
        chord: [chordBlockOnce, chordArpUp],
    },
    JAZZ: {
        // LH classic jazz walking,leading tone 半音解决
        bass: bassWalkingClassic,
        // RH 节奏化 comping(Charleston-like + anticipation)
        chord: [chordRhythmicHits],
    },
    BLUES: {
        // LH Alberti 摆动(blues piano LH 招牌)
        bass: bassRootOctave,
        // RH Alberti arp 跟 LH 错位互补
        chord: [chordArpAlberti],
    },
    RNB: {
        // LH 长按
        bass: bassRootSustained,
        // RH 节奏化 + 偶尔 arp,加 R&B 软切分感
        chord: [chordRhythmicHits, chordArpUp],
    },
};
