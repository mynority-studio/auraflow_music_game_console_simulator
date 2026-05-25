// ==========================================
// TonicizationPlanner — Tonicization (secondary ii-V) planner
// ==========================================
//
// L 阶段移植(2026-05-24,from mg/src/lib/tonicizationPlanner.ts May 22)。
//
// 词汇:
//   • Tonicization — 临时建立新主音(在 target 前插 ii-V/V),旋律必须 follow
//     新中心:scale 切换 Phrygian Dominant(minor target)/ Mixolydian(major
//     target),tendency 表 read against 新 key。多 chord 效果。
//   • Modal Interchange — 借单 chord,曲调中心不变。由 BorrowChordPlanner 处理。
//
// 4 种 placement(per-style weighted):
//   light       curr bar → V/X            (POP 0.45)
//   approach    curr 半 + V/X 半         (POP 0.35)
//   iiv_split   ii/X 半 + V/X 半         (JAZZ 0.45)
//   full_2bar   prev→ii/X, curr→V/X      (JAZZ 0.30)
//
// 防呆:
//   first-phrase guard / phrase-boundary guard / tonicization-target guard
//   home-target short-circuit / chain cooldown 2 / full_2bar 自适应 fallback
//
// Per-style 概率:POP 0.30 / JAZZ 0.65 / RNB 0.40 / BLUES 0
// Per-song 上限:POP 2 / JAZZ 4 / RNB 3 / BLUES 0
// ==========================================

import type { Af2AbstractStep, BorrowedSource } from './Af2Arranger';
import type { Random } from './utils/Random';

// POP-only(JAZZ/BLUES/RNB 已退役)
const TONICIZE_PROB: number = 0.30;
const TONICIZE_MAX_PER_SONG: number = 2;

type Placement = 'light' | 'approach' | 'iiv_split' | 'full_2bar';

const PLACEMENT_WEIGHTS: { light: number; approach: number; iiv_split: number; full_2bar: number } =
    { light: 0.45, approach: 0.35, iiv_split: 0.20, full_2bar: 0 };

function pickPlacement(roll: number): Placement {
    const w = PLACEMENT_WEIGHTS;
    if (roll < w.light) return 'light';
    if (roll < w.light + w.approach) return 'approach';
    if (roll < w.light + w.approach + w.iiv_split) return 'iiv_split';
    return 'full_2bar';
}

// Target multiplier — V/vi/IV/ii 是 pop staples(full prob),iii 半。
// I/i(home tonic)deliberately 缺席 — V/I 跟普通 V→I 一样,没新中心。
const TARGET_MULT: Record<string, number> = {
    V: 1.0, v: 1.0,
    vi: 1.0, VI: 1.0,
    IV: 1.0, iv: 1.0,
    ii: 1.0, II: 1.0,
    iii: 0.5, III: 0.5,
};

// Borrowed-target mult — Borrow Planner 已 rewrite next 为 modal interchange
// chord(bVI/bVII/iv/bII/bIII)时,Tonicization 仍可 approach via V/X(chromatic
// mediant tonicization,如 C → Eb7 → AbMaj7 with Ab as bVI)。
// 仅在曲后半,weight 远低于 diatonic — chromatic mediant 是 late-song accent。
const BORROWED_TARGET_MULT = 0.35;

/**
 * Read roman head + chord type → 'major' / 'minor' / 'forbidden'。
 *
 * Roman case 是 hint,chord type 是 authoritative。
 * Type 'm7' / 'm9' = minor regardless of label。
 */
function targetQuality(roman: string, type: string): 'major' | 'minor' | 'forbidden' {
    if (!roman) return 'forbidden';
    if (roman.includes('°') || roman.includes('ø')) return 'forbidden';
    if (roman.includes('/')) return 'forbidden';
    if (type === 'dim' || type === 'dim7' || type === 'm7b5' || type === 'm9b5') {
        return 'forbidden';
    }
    if (type === 'aug' || type === '7#5' || type === '+5') {
        return 'forbidden';
    }
    const isMinorType = (type.startsWith('m') && !type.startsWith('maj')) || type === 'min';
    if (isMinorType) return 'minor';
    const stripped = roman.replace(/^[b#n]+/, '');
    if (!stripped) return 'forbidden';
    const firstLetter = stripped[0];
    if (/[A-Z]/.test(firstLetter)) return 'major';
    if (/[a-z]/.test(firstLetter)) return 'minor';
    return 'forbidden';
}

/**
 * Extract roman quality 类别给 TARGET_MULT 查表用。
 */
function targetKey(roman: string): string | null {
    if (!roman) return null;
    const stripped = roman.replace(/^[b#n]+/, '');
    const m = stripped.match(/^([IVivXx]+)/);
    if (!m) return null;
    const head = m[1];
    return head.replace(/x/gi, '');
}

export interface PlanTonicizationOptions {
    skeleton: Af2AbstractStep[];
    motifInterval: number;
    random: Random;
    beatsPerMeasure: number;
    /**
     * 曲调 key root pc (0..11)。把 next.rootOffset(rel to song key)转
     * absolute localTonalCenterPc 给下游 evaluator 用。
     */
    songKeyRootPc: number;
}

/**
 * 主入口。返回新 skeleton 数组(原数组不动)。
 *
 * 对每个 potential target at index i+1,index i 的 slot 被 REPLACE 为
 * 2 slot ii-V approach。Target 本身留在原 position(在新数组里 +1 shift)。
 *
 * Skip 规则:首 slot / phrase boundary / dim/borrowed target /
 * adjacent insertion / home target / cooldown 中。
 */
export function planTonicization(opts: PlanTonicizationOptions): Af2AbstractStep[] {
    const { skeleton, motifInterval, random, beatsPerMeasure, songKeyRootPc } = opts;
    const baseProb = TONICIZE_PROB;
    if (baseProb === 0 || skeleton.length < 2) return skeleton.slice();

    const maxFires = TONICIZE_MAX_PER_SONG;
    let firesUsed = 0;

    const result: Af2AbstractStep[] = [];
    const splitBeats = Math.floor(beatsPerMeasure / 2);
    if (splitBeats < 1) return skeleton.slice();

    let prevWasInserted = false;
    // Chain cooldown — fire 后 set=2,接下来 2 bar 跳过。
    // 防 full_2bar 链锁(防反复覆盖 resolution target X)。
    let chainCooldown = 0;

    for (let i = 0; i < skeleton.length; i++) {
        const curr = skeleton[i];
        const next = i + 1 < skeleton.length ? skeleton[i + 1] : null;

        const isFirstPhrase = motifInterval > 0 && i < motifInterval;
        const isPhraseStart = motifInterval > 0 && i % motifInterval === 0;

        // Tonicization-target guard — prev=X/Y 且 curr.head=Y 时 curr 是
        // resolution target,不要二次改(会 orphan V/Y → Y cadence)。
        const prev = i > 0 ? result[result.length - 1] : null;
        let isPrevTonicizationTarget = false;
        if (prev) {
            const prevRoman = prev.roman ?? '';
            const slashSplit = prevRoman.split('/');
            if (slashSplit.length === 2) {
                const prevTarget = slashSplit[1];
                const currHead = curr.roman.replace(/^[b#n]+/, '').match(/^[IVivXx]+/)?.[0] ?? '';
                if (currHead === prevTarget) isPrevTonicizationTarget = true;
            }
        }

        // Home-key short-circuit — tonicize home tonic = V/I 跟 V→I 一样,
        // 没新中心。pre-roll 仍 consume 保持 stream 稳定。
        const isHomeTarget = next
            ? ((((next.rootOffset % 12) + 12) % 12) === songKeyRootPc % 12)
            : false;

        let fire = false;
        const capReached = firesUsed >= maxFires;
        const onCooldown = chainCooldown > 0;
        if (next && !prevWasInserted && !isFirstPhrase && !isPhraseStart && !curr.lockType
            && !isPrevTonicizationTarget && !isHomeTarget && !capReached && !onCooldown) {
            const roll = random.next();
            const quality = targetQuality(next.roman, next.type);
            if (quality !== 'forbidden') {
                const nextIsBorrowed = next.borrowedSource === 'modal_interchange'
                    || next.borrowedSource === 'backdoor_dominant'
                    || next.borrowedSource === 'chromatic_color';
                let mult: number;
                if (nextIsBorrowed) {
                    const isSecondHalf = i >= Math.floor(skeleton.length * 0.5);
                    mult = isSecondHalf ? BORROWED_TARGET_MULT : 0;
                } else {
                    const key = targetKey(next.roman);
                    mult = (key !== null && TARGET_MULT[key] !== undefined)
                        ? TARGET_MULT[key]
                        : 0;
                }
                const effectiveProb = baseProb * mult;
                fire = roll < effectiveProb;
            }
        }

        if (!fire || !next) {
            result.push(curr);
            prevWasInserted = false;
            if (chainCooldown > 0) chainCooldown--;
            continue;
        }

        // Build ii-V approaching next。
        //   targetOffset:semitones above song key(给 rootOffset 用)
        //   targetPcAbs:absolute pc(给 localTonalCenterPc 用)
        const quality = targetQuality(next.roman, next.type);
        const targetOffset = ((next.rootOffset % 12) + 12) % 12;
        const targetPcAbs = ((songKeyRootPc + targetOffset) % 12 + 12) % 12;
        const iiOffset = (targetOffset + 2) % 12;
        const VOffset  = (targetOffset + 7) % 12;

        const targetLabel = next.roman;
        let iiType: string;
        let VType: string;
        let forcedScale: string;
        if (quality === 'major') {
            iiType = 'm7';
            VType = '7';
            forcedScale = 'Mixolydian';
        } else {
            iiType = 'm7b5';
            VType = '7b9';
            forcedScale = 'Phrygian Dominant';
        }

        const iiSlotHalf: Af2AbstractStep = {
            roman: `ii/${targetLabel}`,
            type: iiType,
            scaleDegree: iiOffset,
            rootOffset: iiOffset,
            beats: splitBeats,
            localTonalCenterPc: targetPcAbs,
            borrowedSource: 'secondary_ii_v' as BorrowedSource,
            mustResolve: true,
            lockType: true,
        };
        const VSlotHalf: Af2AbstractStep = {
            roman: `V/${targetLabel}`,
            type: VType,
            scaleDegree: VOffset,
            rootOffset: VOffset,
            beats: beatsPerMeasure - splitBeats,
            localTonalCenterPc: targetPcAbs,
            forcedScale,
            borrowedSource: 'secondary_ii_v' as BorrowedSource,
            mustResolve: true,
            lockType: true,
        };
        const VSlotFull: Af2AbstractStep = {
            ...VSlotHalf,
            beats: beatsPerMeasure,
            borrowedSource: 'secondary_dominant' as BorrowedSource,  // light/approach = lone V/X
        };
        const iiSlotFull: Af2AbstractStep = {
            ...iiSlotHalf,
            beats: beatsPerMeasure,
        };
        const currFirstHalf: Af2AbstractStep = {
            ...curr,
            beats: splitBeats,
        };

        const placementRoll = random.next();
        let placement = pickPlacement(placementRoll);

        // full_2bar 需 backward-modify result[last]。Validate prev:
        //   • i=0 没 prev → 退 iiv_split
        //   • prev 是 Planner-inserted → 退
        //   • prev 在 phrase boundary → 会覆盖 phrase-start anchor → 退
        //   • prev 在 first phrase → home key 未稳 → 退
        //   • prev 是 lockType(borrowed)→ 不覆盖 Modal Interchange
        if (placement === 'full_2bar') {
            const prevIdx = i - 1;
            const prevIsPhraseStart = motifInterval > 0 && prevIdx % motifInterval === 0;
            const prevIsFirstPhrase = motifInterval > 0 && prevIdx < motifInterval;
            const prevSlot = i > 0 && result.length > 0 ? skeleton[prevIdx] : null;
            const canFull2Bar = !!prevSlot && !prevWasInserted
                && !prevIsPhraseStart && !prevIsFirstPhrase && !prevSlot.lockType;
            if (!canFull2Bar) placement = 'iiv_split';
        }

        if (placement === 'light') {
            result.push({ ...VSlotFull, tonicizationPlacement: 'light' });
        } else if (placement === 'approach') {
            result.push(
                { ...currFirstHalf, tonicizationPlacement: 'approach' },
                { ...VSlotHalf,     tonicizationPlacement: 'approach' },
            );
        } else if (placement === 'iiv_split') {
            result.push(
                { ...iiSlotHalf, tonicizationPlacement: 'iiv_split' },
                { ...VSlotHalf,  tonicizationPlacement: 'iiv_split' },
            );
        } else {
            // full_2bar — backward-overwrite result[last] + push V/X full bar
            result[result.length - 1] = { ...iiSlotFull, tonicizationPlacement: 'full_2bar' };
            result.push({
                ...VSlotFull,
                borrowedSource: 'secondary_ii_v' as BorrowedSource,
                tonicizationPlacement: 'full_2bar',
            });
        }
        prevWasInserted = true;
        firesUsed++;
        chainCooldown = 2;
    }

    return result;
}
