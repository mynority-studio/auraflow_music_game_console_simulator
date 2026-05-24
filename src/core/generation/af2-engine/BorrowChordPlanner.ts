// ==========================================
// BorrowChordPlanner — Modal Interchange via positional rules
// ==========================================
//
// L 阶段移植(2026-05-24,from mg/src/lib/borrowedChordPlanner.ts May 22)。
//
// 词汇:
//   • Borrowed Chord(Modal Interchange)— 从同主音平行调借的 chord,
//     不改变曲调中心,旋律不换 scale。本模块处理。
//   • Tonicization — 临时建立新主音(插入 ii-V/V 在前),旋律必须 follow。
//     由 TonicizationPlanner 处理。
//
// 7 条 rule(priority 由窄到宽):
//   C   ii-V → bVI-bVII-I    cadential 上行半音 chain (Aeolian)
//   A2  IV → iv-bVII7        backdoor cadence,bVII7 标 D 功能 (Aeolian)
//   D   curr → bII (→ V)     Neapolitan,Phrygian-source
//   E1  IV bar → bVII-IV     I→bVII→IV rock 色 (Mixolydian)
//   E2  IV bar → bIII-IV     I→bIII→IV chromatic mediant (Mixolydian)
//   B   V bar → bVI-V        vi→bVI→V chromatic 下行 (Aeolian)
//   A1  IV → iv → T          叹息色,最简 replace (Aeolian)
//
// Per-song 单 source 锁定(forked Random):
//   80% Aeolian / 12% Mixolydian / 8% Phrygian
//   Rules source ≠ borrowSource 一律跳过 → 同曲不混源
//
// 5 道防呆:
//   first-phrase guard / tonicization-zone guard / modal-home-mode skip /
//   lockType skip / slash chord skip
//
// Per-style 概率 + 上限:
//   POP   0.45 / 3 次  | JAZZ  0.35 / 4 次
//   RNB   0.55 / 5 次  | BLUES 0    / 0 次(modal universe,no borrowing)
// ==========================================

import type { Af2AbstractStep, BorrowedSource } from './Af2Arranger';
import type { MgStyle } from '../../../state/EngineSelectionStore';
import type { Random } from './utils/Random';

const STYLE_BORROW_PROB: Record<MgStyle, number> = {
    POP:   0.45,
    JAZZ:  0.35,
    RNB:   0.55,
    BLUES: 0,
};

// Per-song fire 上限。Lerdahl/Berklee:"extended use dilutes tonality
// or causes unwanted modulation"。1-3 borrows / 16-bar 是 tasteful color,
// 4+ 开始听感像 key change。RNB / Neo-Soul tolerates more。
const STYLE_MAX_BORROWS_PER_SONG: Record<MgStyle, number> = {
    POP: 3,
    JAZZ: 4,
    RNB: 5,
    BLUES: 0,
};

export type BorrowSource = 'Aeolian' | 'Mixolydian' | 'Phrygian';

/**
 * TSD function inference from Roman。镜像 mg.harmonicFunctionFromRoman 语义。
 *   T = I, i, iii, III, vi, VI, bIII, bVI  (tonic + tonic substitutes)
 *   S = IV, iv, ii, II, bVII                (subdominant + borrowed S)
 *   D = V, v, vii, VII, anything with '/'   (dominant + secondary dom)
 */
function tsdFunction(roman: string): 'T' | 'S' | 'D' {
    if (!roman) return 'T';
    if (roman.includes('/')) return 'D';
    const base = roman.split('/')[0].replace(
        /maj7|maj9|maj13|m7|m9|m11|sus4|7sus4|9sus4|7b13|7#9|7alt|dim|aug|\+|o|ø|[0-9]/g, '',
    );
    if (['V', 'v', 'vii', 'VII'].includes(base)) return 'D';
    if (['IV', 'iv', 'ii', 'II', 'bVII'].includes(base)) return 'S';
    return 'T';
}

type PhraseRole = 'start' | 'middle' | 'cadence' | 'ending';

function classifyPhraseRole(i: number, total: number, motifInterval: number): PhraseRole {
    if (i === total - 1) return 'ending';
    if (motifInterval > 0 && (i + 1) % motifInterval === 0) return 'cadence';
    if (motifInterval > 0 && i % motifInterval === 0) return 'start';
    return 'middle';
}

/**
 * Strip accidentals + extract Roman head ('IV', 'iv', 'V', 'vi', 'I' 等)。
 */
function romanHead(roman: string): string {
    if (!roman) return '';
    const stripped = roman.replace(/^[b#n]+/, '');
    return stripped.match(/^[IVivXx]+/)?.[0] ?? '';
}

type Quality = 'maj' | 'min' | 'dom' | 'dim' | 'sus' | 'other';

function chordQuality(type: string): Quality {
    if (!type) return 'other';
    if (type === 'm7b5' || type === 'm9b5' || type === 'dim' || type === 'dim7') return 'dim';
    if (type.startsWith('sus')) return 'sus';
    if (type === '7sus4' || type === '9sus4') return 'sus';
    if (type === 'maj' || type === 'maj7' || type === 'maj9' || type === 'maj13'
        || type === 'maj7#11' || type === 'add9' || type === '6' || type === '6/9') return 'maj';
    if (type.startsWith('m') && !type.startsWith('maj')) return 'min';
    if (type === '7' || type === '9' || type === '11' || type === '13'
        || type === '7b9' || type === '7#9' || type === '7b13'
        || type === '7#11' || type === '7alt') return 'dom';
    return 'other';
}

/**
 * Rule:接 (curr, prev, prev2, next, phraseRole, bpm),
 * 返回 N 个 output slots REPLACE curr。返回 null = 不匹配。
 * 输出 slots 的 beats sum 必须 = curr 原 duration(曲长不变)。
 */
interface BorrowedRule {
    name: string;
    weight: number;
    source: BorrowSource;
    apply: (
        curr: Af2AbstractStep,
        prev: Af2AbstractStep | null,
        prev2: Af2AbstractStep | null,
        next: Af2AbstractStep | null,
        phraseRole: PhraseRole,
        bpm: number,
    ) => Af2AbstractStep[] | null;
}

// ─── Rule 定义 ─────────────────────────────────────────────────────

// Rule A1: IV → iv when next is T-function (I / vi / iii)。
// "S 借调放在 T 前"。叹息色。周杰伦"轨迹"/ Beatles "Yesterday"。
const RULE_A1: BorrowedRule = {
    name: 'A1: IV → iv → T',
    weight: 1.0,
    source: 'Aeolian',
    apply: (curr, _prev, _prev2, next, _phraseRole, _bpm) => {
        if (romanHead(curr.roman) !== 'IV') return null;
        if (chordQuality(curr.type) !== 'maj') return null;
        if (!next) return null;
        if (tsdFunction(next.roman) !== 'T') return null;
        return [{
            ...curr,
            type: 'm7',
            roman: 'iv',
            borrowedFrom: 'iv (parallel minor)',
            borrowedSource: 'modal_interchange' as BorrowedSource,
            mustResolve: false,
            lockType: true,
        }];
    },
};

// Rule A2: backdoor cadence iv → bVII7 → T。
// 替换 IV 的 bar 为 2 chords:iv(half) + bVII7(half) 接 T。
// bVII7 root 永远 10 半音 above key root,标 effectiveFunc = 'D'。
const RULE_A2: BorrowedRule = {
    name: 'A2: iv → bVII7 → T (backdoor)',
    weight: 0.8,
    source: 'Aeolian',
    apply: (curr, _prev, _prev2, next, _phraseRole, bpm) => {
        if (romanHead(curr.roman) !== 'IV') return null;
        if (chordQuality(curr.type) !== 'maj') return null;
        if (!next) return null;
        if (tsdFunction(next.roman) !== 'T') return null;
        const half = Math.floor(bpm / 2);
        const currBeats = curr.beats ?? bpm;
        if (currBeats < 2) return null;
        return [
            {
                ...curr,
                type: 'm7',
                roman: 'iv',
                borrowedFrom: 'iv (parallel minor)',
                borrowedSource: 'modal_interchange' as BorrowedSource,
                mustResolve: false,
                beats: half,
                lockType: true,
            },
            {
                roman: 'bVII7',
                type: '7',
                scaleDegree: 7,
                rootOffset: 10,
                beats: currBeats - half,
                borrowedFrom: 'bVII7 (backdoor cadence)',
                borrowedSource: 'backdoor_dominant' as BorrowedSource,
                mustResolve: true,
                effectiveFunc: 'D',
                lockType: true,
            },
        ];
    },
};

// Rule B: vi → bVI → D。
// prev=vi,curr=D-function → split curr 为 [bVI(half) + curr(half)]。
// vi(A) → bVI(Ab) → V(G) chromatic 下行 bass walk into dominant。
const RULE_B: BorrowedRule = {
    name: 'B: vi → bVI → D',
    weight: 0.7,
    source: 'Aeolian',
    apply: (curr, prev, _prev2, _next, _phraseRole, bpm) => {
        if (tsdFunction(curr.roman) !== 'D') return null;
        if (chordQuality(curr.type) === 'dim') return null;
        if (!prev || romanHead(prev.roman) !== 'vi') return null;
        const half = Math.floor(bpm / 2);
        const currBeats = curr.beats ?? bpm;
        if (currBeats < 2) return null;
        return [
            {
                roman: 'bVI',
                type: 'maj7',
                scaleDegree: 6,
                rootOffset: 8,
                beats: half,
                borrowedFrom: 'bVI (parallel minor)',
                borrowedSource: 'modal_interchange' as BorrowedSource,
                mustResolve: false,
                lockType: true,
            },
            {
                ...curr,
                beats: currBeats - half,
            },
        ];
    },
};

// Rule C: ii-V → bVI → bVII → I (cadential chain)。
// curr=I (maj),prev=V,prev2=ii,phraseRole=cadence/ending。
// 替换 I 的 4-beat bar 为 [bVI(1) + bVII(1) + I(rest)] —
// bass V→Ab→Bb→C 半音上行 into final tonic。
// Beatles "Let It Be" ending variant / 副歌 final 史诗。
const RULE_C: BorrowedRule = {
    name: 'C: ii-V → bVI → bVII → I (cadential)',
    weight: 0.85,
    source: 'Aeolian',
    apply: (curr, prev, prev2, _next, phraseRole, bpm) => {
        if (phraseRole !== 'cadence' && phraseRole !== 'ending') return null;
        if (romanHead(curr.roman) !== 'I') return null;
        if (chordQuality(curr.type) !== 'maj') return null;
        if (!prev || romanHead(prev.roman) !== 'V') return null;
        if (!prev2 || romanHead(prev2.roman) !== 'ii') return null;
        const currBeats = curr.beats ?? bpm;
        const insertBeats = Math.max(1, Math.floor(currBeats / 4));
        const remainingI = currBeats - 2 * insertBeats;
        if (remainingI < 1) return null;
        return [
            {
                roman: 'bVI',
                type: 'maj7',
                scaleDegree: 6,
                rootOffset: 8,
                beats: insertBeats,
                borrowedFrom: 'bVI (cadential chain)',
                borrowedSource: 'modal_interchange' as BorrowedSource,
                mustResolve: false,
                lockType: true,
            },
            {
                roman: 'bVII',
                type: 'maj7',
                scaleDegree: 7,
                rootOffset: 10,
                beats: insertBeats,
                borrowedFrom: 'bVII (cadential chain)',
                borrowedSource: 'modal_interchange' as BorrowedSource,
                mustResolve: false,
                lockType: true,
            },
            {
                ...curr,
                beats: remainingI,
            },
        ];
    },
};

// Rule D: curr → bII (→ V → I) Neapolitan / Phrygian-source。
// 替换 curr 为 bII maj7(rootOffset = 1 半音 above key)。
// Spanish / flamenco / cinematic / Latin pop。
const RULE_D: BorrowedRule = {
    name: 'D: bII → V → I (Neapolitan)',
    weight: 0.6,
    source: 'Phrygian',
    apply: (curr, _prev, _prev2, next, _phraseRole, _bpm) => {
        if (!next) return null;
        if (romanHead(next.roman) !== 'V') return null;
        if (chordQuality(curr.type) === 'dim') return null;
        return [{
            ...curr,
            type: 'maj7',
            roman: 'bII',
            rootOffset: 1,
            scaleDegree: 1,
            borrowedFrom: 'bII (Phrygian / Neapolitan)',
            borrowedSource: 'modal_interchange' as BorrowedSource,
            mustResolve: false,
            lockType: true,
        }];
    },
};

// Rule E1: I → bVII → IV (Mixolydian rock color)。
// curr=IV, prev=I → 插 bVII between → [bVII(half) + IV(half)]。
// Beatles "Yesterday" variant / Sweet Child O' Mine intro。
const RULE_E1: BorrowedRule = {
    name: 'E1: I → bVII → IV',
    weight: 0.6,
    source: 'Mixolydian',
    apply: (curr, prev, _prev2, _next, _phraseRole, bpm) => {
        if (romanHead(curr.roman) !== 'IV') return null;
        if (chordQuality(curr.type) !== 'maj') return null;
        if (!prev || romanHead(prev.roman) !== 'I') return null;
        const half = Math.floor(bpm / 2);
        const currBeats = curr.beats ?? bpm;
        if (currBeats < 2) return null;
        return [
            {
                roman: 'bVII',
                type: 'maj',
                scaleDegree: 7,
                rootOffset: 10,
                beats: half,
                borrowedFrom: 'bVII (Mixolydian — rock color)',
                borrowedSource: 'modal_interchange' as BorrowedSource,
                mustResolve: false,
                lockType: true,
            },
            {
                ...curr,
                beats: currBeats - half,
            },
        ];
    },
};

// Rule E2: I → bIII → IV (Mixolydian chromatic mediant variation)。
// Rock / alternative / film-score signature。
const RULE_E2: BorrowedRule = {
    name: 'E2: I → bIII → IV',
    weight: 0.5,
    source: 'Mixolydian',
    apply: (curr, prev, _prev2, _next, _phraseRole, bpm) => {
        if (romanHead(curr.roman) !== 'IV') return null;
        if (chordQuality(curr.type) !== 'maj') return null;
        if (!prev || romanHead(prev.roman) !== 'I') return null;
        const half = Math.floor(bpm / 2);
        const currBeats = curr.beats ?? bpm;
        if (currBeats < 2) return null;
        return [
            {
                roman: 'bIII',
                type: 'maj',
                scaleDegree: 3,
                rootOffset: 3,
                beats: half,
                borrowedFrom: 'bIII (parallel minor / chromatic mediant)',
                borrowedSource: 'modal_interchange' as BorrowedSource,
                mustResolve: false,
                lockType: true,
            },
            {
                ...curr,
                beats: currBeats - half,
            },
        ];
    },
};

// Rules priority(由窄到宽,首次匹配胜)。Source filter 在主入口。
const RULES: BorrowedRule[] = [
    RULE_C,   // ii-V-I + phrase ending — 最窄
    RULE_A2,  // backdoor — 比 A1 窄
    RULE_D,   // Neapolitan (Phrygian)
    RULE_E1,  // I → bVII → IV (Mixolydian)
    RULE_E2,  // I → bIII → IV (Mixolydian)
    RULE_B,   // vi-V (Aeolian)
    RULE_A1,  // 最简 replace (Aeolian)
];

export interface PlanBorrowedOptions {
    skeleton: Af2AbstractStep[];
    style: MgStyle;
    motifInterval: number;
    random: Random;
    beatsPerMeasure: number;
    /**
     * 当前调式名(用于 modal-home-mode skip)。
     * AF2 当前主要用 'Maj/Ionian',Minor 用 'minor/Aeolian'。
     */
    mode: string;
    /**
     * Per-song 单 borrow-source(由 caller forked Random 抽)。
     * Rules source ≠ borrowSource 一律跳过。
     */
    borrowSource: BorrowSource;
}

// 异国 / modal home 不参与借调(已经在 modal 色彩里再借 = 听感稀释)。
const MODAL_HOME_MODES = new Set([
    'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Locrian',
    'Blues', 'Major Blues', 'Minor Blues', 'Composite Blues', 'Country Blues',
    'Bebop Dominant', 'Bebop Major', 'Bebop Dorian', 'Altered',
    'Phrygian Dominant', 'Lydian Dominant',
]);

/**
 * 主入口。返回新 skeleton 数组(原数组不动)。
 * lockType 标记的 slot 跳过(其他 planner 已处理)。
 */
export function planBorrowedChords(opts: PlanBorrowedOptions): Af2AbstractStep[] {
    const { skeleton, style, motifInterval, random, beatsPerMeasure, mode } = opts;
    const baseProb = STYLE_BORROW_PROB[style] ?? 0;
    if (baseProb === 0 || skeleton.length < 2) return skeleton.slice();
    if (MODAL_HOME_MODES.has(mode)) return skeleton.slice();

    const maxFires = STYLE_MAX_BORROWS_PER_SONG[style] ?? 3;
    let firesUsed = 0;

    const result: Af2AbstractStep[] = [];

    for (let i = 0; i < skeleton.length; i++) {
        const curr = skeleton[i];

        if (curr.lockType) {
            result.push(curr);
            continue;
        }

        // Skip secondary dominants (V/X) — Tonicization 的工作,不要双重改
        if (curr.roman.includes('/')) {
            result.push(curr);
            continue;
        }

        const prev = result.length > 0 ? result[result.length - 1] : null;
        const prev2 = result.length > 1 ? result[result.length - 2] : null;
        const next = i + 1 < skeleton.length ? skeleton[i + 1] : null;
        const phraseRole = classifyPhraseRole(i, skeleton.length, motifInterval);

        // First-phrase guard(Berklee / Open Music Theory):
        // 开头 phrase 必须先建立 home key,再加 modal-interchange color。
        if (motifInterval > 0 && i < motifInterval) {
            result.push(curr);
            continue;
        }

        // Tonicization-zone protection(3 sub-case):
        //   (1) prev=V/X 且 curr.head=X — curr 是 resolution target
        //   (2) next=V/X 或 ii/X — curr 是 Tonicization 前最后 diatonic
        //   (3) prev2=V/Y 且 prev.head=Y — curr 是 resolution 后第一 chord
        let inTonicizationZone = false;
        if (prev) {
            const slashSplit = (prev.roman ?? '').split('/');
            if (slashSplit.length === 2) {
                const currHead = romanHead(curr.roman);
                if (currHead === slashSplit[1]) inTonicizationZone = true;
            }
        }
        if (!inTonicizationZone && next && (next.roman ?? '').includes('/')) {
            inTonicizationZone = true;
        }
        if (!inTonicizationZone && prev2 && prev) {
            const slashSplit2 = (prev2.roman ?? '').split('/');
            if (slashSplit2.length === 2) {
                const prevHead = romanHead(prev.roman);
                if (prevHead === slashSplit2[1]) inTonicizationZone = true;
            }
        }
        if (inTonicizationZone) {
            result.push(curr);
            continue;
        }

        // 单 roll per slot 保持 stream 稳定。同一 roll 同时决定 fire + which rule。
        const roll = random.next();

        let fired = false;
        for (const rule of RULES) {
            // Source filter:rule.source ≠ song's borrowSource 直接跳过。
            if (rule.source !== opts.borrowSource) continue;
            const out = rule.apply(curr, prev, prev2, next, phraseRole, beatsPerMeasure);
            if (!out) continue;
            if (firesUsed < maxFires && roll < baseProb * rule.weight) {
                result.push(...out);
                fired = true;
                firesUsed++;
            }
            break;
        }

        if (!fired) {
            result.push(curr);
        }
    }

    return result;
}
