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
import type { Prng } from './prng';
import type { ChordScale } from './scale';
import { walkScaleToTarget } from './scale';

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
    /** 当前 style 的 base texture(参数集) */
    baseTexture: StyleBaseTexture;
    /** Per-bar deterministic PRNG(P2 概率决策都用它) */
    prng: Prng;
    /** Per-chord local scale(P2 walking scale-run 用) */
    scale: ChordScale;
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
export const bassWalkingClassic: Pattern = ({
    voicing, rootMidi, bassMidi, startBeat, duration, nextBassMidi,
    baseTexture, prng, scale,
}) => {
    if (duration < 4) {
        const fifth = pickIntervalInBassRegister(voicing, rootMidi, bassMidi, [7, 6, 8]) ?? bassMidi;
        return [
            { pitch: bassMidi, onset: startBeat, duration: 0.95, velocity: vBassStrong(baseTexture) },
            { pitch: fifth, onset: startBeat + 1, duration: 0.95, velocity: vBassWeak(baseTexture) },
        ];
    }

    const out: NoteData[] = [];
    const stepDur = 0.95;
    const third = pickIntervalInBassRegister(voicing, rootMidi, bassMidi, [3, 4]) ?? bassMidi;
    const fifth = pickIntervalInBassRegister(voicing, rootMidi, bassMidi, [7, 6, 8]) ?? bassMidi;

    out.push({ pitch: bassMidi, onset: startBeat,     duration: stepDur, velocity: vBassStrong(baseTexture) });
    out.push({ pitch: third,    onset: startBeat + 1, duration: stepDur, velocity: vBassWeak(baseTexture) });
    out.push({ pitch: fifth,    onset: startBeat + 2, duration: stepDur, velocity: vBassWeak(baseTexture) });

    // P2:beat 3+ 的 approach 决策
    //   - 概率 fillProb × 0.5 触发 "2-tone scale run"(beat 2.5 + 3 走 scale 半 ~ 全步逼近)
    //   - 否则保留 P1 单 leading tone(beat 3 半音 approach)
    if (nextBassMidi !== undefined && scale && prng.chance(baseTexture.fillProb * 0.5)) {
        // Scale run:从 fifth 出发,走 scale 2 步到 nextBassMidi
        const scalePath = walkScaleToTarget(scale, fifth, nextBassMidi, 2);
        if (scalePath.length === 2) {
            // 替换 beat 3 单 leading tone → beat 2.5 + 3 两步 scale 行进
            // 注意:scale 内音可能不在当前 chord PCs(那才是"走 scale 流动"的意义),
            // 但严格在 scale 内 → audit 通过的"scale-run exception"
            const p1 = clampToBassRegister(scalePath[0]);
            const p2 = clampToBassRegister(scalePath[1]);
            out.push({ pitch: p1, onset: startBeat + 2.5, duration: 0.45, velocity: vBassWeak(baseTexture) * 0.95 });
            out.push({ pitch: p2, onset: startBeat + 3.0, duration: 0.95, velocity: vBassWeak(baseTexture) });
            return out;
        }
        // path 不够 2 步 → fallback 单 leading tone
    }

    // P1 fallback:单 leading tone @ beat 3
    if (nextBassMidi !== undefined) {
        const candA = nextBassMidi - 1;
        const candB = nextBassMidi + 1;
        const inRange = (m: number): boolean => m >= 38 && m <= 50;
        let leading: number;
        if (inRange(candA))      leading = candA;
        else if (inRange(candB)) leading = candB;
        else { leading = candA; while (leading > 50) leading -= 12; while (leading < 38) leading += 12; }
        out.push({ pitch: leading, onset: startBeat + 3, duration: stepDur, velocity: vBassWeak(baseTexture) });
    } else {
        out.push({ pitch: bassMidi, onset: startBeat + 3, duration: stepDur, velocity: vBassWeak(baseTexture) });
    }

    return out;
};

/** clamp 到 bass register [38, 50] — 保留 PC */
function clampToBassRegister(m: number): number {
    let p = m;
    while (p > 50) p -= 12;
    while (p < 38) p += 12;
    return p;
}

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
 * 同 pickIntervalInBassRegister,但 wrap 到 LH "中低音区" [50, 62](D3-D4)。
 * 用于 stride 的中音 chord stab、shell voicing 的 3rd/7th — 这些不该跟低音
 * 根重叠也不该跟 RH(48-84)抢顶部空间,所以专走 50-62 这层。
 */
function pickIntervalInMidLowRegister(
    voicing: number[],
    rootMidi: number,
    semisCandidates: number[],
): number | null {
    const rootPc = ((rootMidi % 12) + 12) % 12;
    for (const semis of semisCandidates) {
        const targetPc = (rootPc + semis) % 12;
        for (const m of voicing) {
            if (((m % 12) + 12) % 12 === targetPc) {
                let p = m;
                while (p > 62) p -= 12;
                while (p < 50) p += 12;
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

/**
 * bassStride — Stride piano LH(ragtime / blues / 老派爵士招牌)
 *
 * Pattern(4-beat chord,LH 单手包打):
 *   beat 0:低音区 root(MIDI ~38-44)
 *   beat 1:**mid-low chord stab**(从 voicing 取低 3 音 wrap 到 50-62)
 *   beat 2:低音区 fifth
 *   beat 3:mid-low chord stab(同 beat 1)
 *
 * 关键听感:低音 - 中音 - 低音 - 中音 跳跃,跟 walking quarter notes
 * 完全不同。LH 包揽了 bass 锚定 + 中音 chord 律动两件事。
 *
 * 音源:bassMidi(root)+ pickInterval(fifth)+ voicing[0..2] 移到 50-62 mid-low。
 * 全部 chord tone。
 *
 * 2-beat chord:退化为 beat 0 root + beat 1 chord stab。
 */
export const bassStride: Pattern = ({
    voicing, rootMidi, bassMidi, startBeat, duration, baseTexture,
}) => {
    const out: NoteData[] = [];
    // 低音区 root:bassMidi 通常已 clamp 38-50,stride 偏好更低 ~38-44 区
    const lowRoot = bassMidi > 44 ? bassMidi - 12 : bassMidi;
    const lowBass = Math.max(36, lowRoot);

    // Mid-low chord stab:取 voicing 最低 3 音 wrap 到 [50, 62]
    const stabNotes = voicing.slice(0, 3).map(m => {
        let p = m;
        while (p > 62) p -= 12;
        while (p < 50) p += 12;
        return p;
    });

    // Beat 0:低音区 root
    out.push({
        pitch: lowBass, onset: startBeat, duration: 0.9,
        velocity: vBassStrong(baseTexture),
    });

    // Beat 1:mid-low chord stab
    if (duration >= 2) {
        for (const m of stabNotes) {
            out.push({
                pitch: m, onset: startBeat + 1, duration: 0.4,
                velocity: vBassWeak(baseTexture),
            });
        }
    }

    if (duration >= 4) {
        // Beat 2:低音区 fifth
        const fifth = pickIntervalInBassRegister(voicing, rootMidi, lowBass, [7, 6, 8]) ?? lowBass;
        out.push({
            pitch: fifth, onset: startBeat + 2, duration: 0.9,
            velocity: vBassStrong(baseTexture) * 0.9,
        });
        // Beat 3:mid-low chord stab
        for (const m of stabNotes) {
            out.push({
                pitch: m, onset: startBeat + 3, duration: 0.4,
                velocity: vBassWeak(baseTexture),
            });
        }
    }

    return out;
};

/**
 * bassBossa — Bossa Nova bass(Latin / Brazilian / Latin-influenced R&B)
 *
 * Pattern(4-beat chord):
 *   beat 0   : root(1 beat held)
 *   beat 1.5 : fifth(anticipation,0.5 beat)
 *   beat 2   : root(1 beat held)
 *   beat 3.5 : fifth(anticipation,0.5 beat)
 *
 * 关键听感:**强拍根 + and-of-2/4 五度切分**,典型 Latin 推拉律动感。
 * 跟 walking / sustained / stride 完全是另一种节奏 DNA。
 *
 * 2-beat chord:beat 0 root + beat 1.5 fifth(单组)。
 */
export const bassBossa: Pattern = ({
    voicing, rootMidi, bassMidi, startBeat, duration, baseTexture,
}) => {
    const out: NoteData[] = [];
    const fifth = pickIntervalInBassRegister(voicing, rootMidi, bassMidi, [7, 6, 8]) ?? bassMidi;

    // Beat 0:root,1 beat
    out.push({
        pitch: bassMidi, onset: startBeat, duration: 1.0,
        velocity: vBassStrong(baseTexture),
    });

    // Beat 1.5:fifth,anticipation
    if (duration > 1.5) {
        out.push({
            pitch: fifth, onset: startBeat + 1.5, duration: 0.5,
            velocity: vBassWeak(baseTexture),
        });
    }

    if (duration >= 4) {
        // Beat 2:root
        out.push({
            pitch: bassMidi, onset: startBeat + 2, duration: 1.0,
            velocity: vBassStrong(baseTexture) * 0.9,
        });
        // Beat 3.5:fifth anticipation
        out.push({
            pitch: fifth, onset: startBeat + 3.5, duration: 0.5,
            velocity: vBassWeak(baseTexture),
        });
    }

    return out;
};

/**
 * bassShellVoicing — Jazz LH shell(现代爵士 comping 标准)
 *
 * Pattern(4-beat chord):
 *   beat 0:低音 root + mid-low 3rd + 7th(stab 持 1.5 beat)
 *   beat 2:同上(stab 持 1.5 beat)
 *
 * 关键听感:LH 不弹单线,弹"骨架和弦"(root + 3 + 7)— 现代 jazz 钢琴
 * 必备 voicing。Bill Evans / Herbie Hancock 标志性 LH 形态。
 *
 * 音源:bassMidi(root)+ pickIntervalInMidLowRegister 找 3rd / 7th。
 * 3rd/7th 来自 voicing 实音 → 严格 chord tone(没 7 时只弹 root + 3rd)。
 */
export const bassShellVoicing: Pattern = ({
    voicing, rootMidi, bassMidi, startBeat, duration, baseTexture,
}) => {
    const out: NoteData[] = [];
    const third   = pickIntervalInMidLowRegister(voicing, rootMidi, [3, 4]);
    const seventh = pickIntervalInMidLowRegister(voicing, rootMidi, [10, 11]);

    const pushStab = (beatOffset: number, holdDur: number, strong: boolean): void => {
        if (beatOffset >= duration) return;
        const vBass  = strong ? vBassStrong(baseTexture) : vBassWeak(baseTexture);
        const vShell = vBass * 0.82;
        // root(low)
        out.push({
            pitch: bassMidi, onset: startBeat + beatOffset,
            duration: Math.min(holdDur, duration - beatOffset),
            velocity: vBass,
        });
        // 3rd(mid-low)
        if (third !== null) {
            out.push({
                pitch: third, onset: startBeat + beatOffset,
                duration: Math.min(holdDur, duration - beatOffset),
                velocity: vShell,
            });
        }
        // 7th(mid-low)
        if (seventh !== null) {
            out.push({
                pitch: seventh, onset: startBeat + beatOffset,
                duration: Math.min(holdDur, duration - beatOffset),
                velocity: vShell,
            });
        }
    };

    // Beat 0:shell stab
    pushStab(0, 1.5, true);
    // Beat 2:shell stab(4-beat chord)
    if (duration >= 4) pushStab(2, 1.5, false);

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
 * chordRhythmicHits — 节奏化 chord stab + P2 概率扩展
 *
 * **Skeleton(deterministic)**:风格"灵魂"不动 — 同 style 总是这几个击点
 *   beat 0    : short stab(0.4 beat)
 *   beat 0.75 : dotted-quarter 长按到 beat 2
 *   beat 3.5  : 8th anticipation
 *
 * **P2 概率装饰(per-bar 不同)**:
 *   - restProb:beat 0 skeleton 击点有 restProb 概率被跳过(创造"喘息")
 *   - fillProb:beat 1.5 / beat 2.5 / beat 3 的 weak slot 概率补击(填空)
 *   - syncShiftProb:beat 0 stab 概率前移 0.25 beat(变成 beat 3.75 anticipation
 *                   into next bar — 但这里限定在本 chord 内)
 *
 * 音源:voicing(全 chord tone,概率装饰不出非和弦音)
 */
export const chordRhythmicHits: Pattern = ({ voicing, startBeat, duration, baseTexture, prng }) => {
    const out: NoteData[] = [];
    if (voicing.length === 0) return out;

    const pushVoicing = (offset: number, dur: number, vel: number): void => {
        if (offset < 0 || offset >= duration) return;
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
        // Skeleton — beat 0 stab(可被 restProb 跳过,或 syncShiftProb 前移)
        if (!prng.chance(baseTexture.restProb)) {
            const shift = prng.chance(baseTexture.syncShiftProb) ? -0.25 : 0;
            pushVoicing(0 + shift, 0.4, vRhDown(baseTexture));
        }
        // Skeleton — beat 0.75 dotted hold(skeleton 长按不动)
        pushVoicing(0.75, 1.25, vRhUp(baseTexture));
        // Skeleton — beat 3.5 anticipation
        pushVoicing(3.5, 0.5, vRhDown(baseTexture));

        // P2 概率 fill — weak slot 之间补击点
        // beat 1.5 (and-of-2,weight 0.4) — fillProb × weight
        if (prng.chance(baseTexture.fillProb * 0.4)) {
            pushVoicing(1.5, 0.3, vRhUp(baseTexture) * 0.85);
        }
        // beat 2.5 (and-of-3,weight 0.4)
        if (prng.chance(baseTexture.fillProb * 0.4)) {
            pushVoicing(2.5, 0.3, vRhUp(baseTexture) * 0.85);
        }
        // beat 3 (beat 4 strong-ish,weight 0.6)— "通过到 anticipation"的桥
        if (prng.chance(baseTexture.fillProb * 0.5)) {
            pushVoicing(3.0, 0.4, vRhUp(baseTexture));
        }
    } else {
        // 2-beat chord:skeleton 同 P1
        if (!prng.chance(baseTexture.restProb)) {
            pushVoicing(0, 0.4, vRhDown(baseTexture));
        }
        pushVoicing(1.5, 0.5, vRhUp(baseTexture));
        if (prng.chance(baseTexture.fillProb * 0.4)) {
            pushVoicing(0.75, 0.25, vRhUp(baseTexture) * 0.85);
        }
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
        // LH Stride(P3.5)— 低音根 + mid-low chord stab 跳跃,ragtime/blues 招牌
        bass: bassStride,
        // RH Alberti arp 跟 LH stride 错位互补
        chord: [chordArpAlberti],
    },
    RNB: {
        // LH Bossa(P3.5)— 切分根 + 5,Latin-influenced R&B groove
        bass: bassBossa,
        // RH 节奏化 + 偶尔 arp,跟 bossa LH 推拉互补
        chord: [chordRhythmicHits, chordArpUp],
    },
};
