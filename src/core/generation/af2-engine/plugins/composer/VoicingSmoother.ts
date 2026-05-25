// ============================================================
// VoicingSmoother(R + S2 阶段)— cross-chord voice leading post-pass
// ============================================================
//
// 原 Af2Composer.smoothChordVoicings + 配套 helpers(R 阶段 2026-05-24 +
// S2 阶段 phrase-arc 加 cost,2026-05-25 拆 plugin)。
//
// Composer 主循环已有 placeVoicingMidi 局部 voice leading(基于 prev),
// 但只 forward-aware,不看 next。本 plugin 是 post-pass smoother:
//   对每 chord(除首尾),试 4 个 inversion variants(整体 octave 移位):
//     - lift bottom +12 / +24    最低音上移八度
//     - drop top    -12 / -24    最高音下移八度
//   保 pc 集不变(只调 octave 不改音名)。
//   选 min cost = L1(prev, candidate) + L1(candidate, next) + arcCost
//
// S2 阶段:phrase-arc bonus 主动让 top voice 在 phrase 内形成"上 → 顶 → 回"
// 的弧形 motif,产生隐性旋律线感:
//   phrase position(i % 4):0 起点(0)/ 1-2 顶点(+ARC_AMP)/ 3 末点(0)
//   arcCost = |actualTopShift - expectedTopShift| × ARC_WEIGHT
//   ARC_WEIGHT 调小(0.6)避免 override L1 voice leading — tie-breaker 性质。
//
// 工程:
//   - PRNG 消耗:0(deterministic hill-climbing)
//   - O(N × 5) 时间;N 通常 16-32 chord,跑一遍 < 1ms
//   - 不影响 bassMidi(独立由 chord.bassMidi 决定)
//   - 不重算 notes display(notesMidi 是 audio truth,notes 是 UI 标签)
//   - 拔掉听感劣化(less smooth voice leading + 无 arc 感)但 chord 仍合法
// ============================================================

import type { ChordDef } from '../../types/ChordDef';
import { CHORD_RANGE } from '../../music-theory';
import type { ComposerPluginMeta } from './types';

/** Phrase 内 chord 数(motif 周期) */
const PHRASE_CHORD_COUNT = 4;
/** Top voice 在 phrase 顶点期望比起点高的半音数 */
const ARC_AMPLITUDE = 5;
/** Arc cost 权重(< 1 = tie-breaker 不主导 L1 voice leading) */
const ARC_WEIGHT = 0.6;

/**
 * 两个 voicing(已 sort)之间的 L1 距离 + 长度差异 penalty。
 */
function voicingL1(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
    if (a.length === 0 || b.length === 0) return 0;
    let sum = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
    sum += Math.abs(a.length - b.length) * 4;
    return sum;
}

/** Phrase position → expected top voice shift(arc:0 / +amp / +amp / 0) */
function expectedArcShift(phrasePos: number): number {
    if (phrasePos === 0) return 0;
    if (phrasePos === PHRASE_CHORD_COUNT - 1) return 0;
    return ARC_AMPLITUDE;
}

/** 取 voicing 顶音(已 sort,最后一个)。空 voicing 返 0(降级 cost) */
function topVoice(v: ReadonlyArray<number>): number {
    return v.length > 0 ? v[v.length - 1] : 0;
}

// ============================================================
// Phase 5(Impro-Visor invert-9th 移植,2026-05-25)
// ============================================================
// 检测 voicing 内相邻两音差 13 半音(小 9 度,muddy)→ 交换两音 pc(保各自
// octave 区),把差缩成 11 半音(major 7,干净)。
// 例:[C4=60, Db5=73] 差 13 → swap pc → [Db4=61, C5=72] 差 11。
// pc 集不变 → chord identity 保持。
// ============================================================
const MINOR_9_INTERVAL = 13;

/** 检测并修复 voicing 中所有相邻小 9 度。返回新 voicing(已 sort)。 */
function fixMinor9Intervals(voicing: ReadonlyArray<number>): number[] {
    if (voicing.length < 2) return voicing.slice();
    const result = voicing.slice();
    let changed = true;
    let maxIter = 4; // 防止极端 case 无限循环
    while (changed && maxIter-- > 0) {
        changed = false;
        for (let i = 0; i < result.length - 1; i++) {
            const lower = result[i]!;
            const upper = result[i + 1]!;
            if (upper - lower !== MINOR_9_INTERVAL) continue;
            // swap pc preserve octave 区
            const lowerOctave = Math.floor(lower / 12);
            const upperOctave = Math.floor(upper / 12);
            const lowerPc = lower % 12;
            const upperPc = upper % 12;
            const newLower = lowerOctave * 12 + upperPc;
            const newUpper = upperOctave * 12 + lowerPc;
            // 必须保升序 + 改善(差变小)
            if (newLower < newUpper && newUpper - newLower < MINOR_9_INTERVAL) {
                result[i] = newLower;
                result[i + 1] = newUpper;
                changed = true;
            }
        }
        if (changed) result.sort((a, b) => a - b);
    }
    return result;
}

/**
 * 生成 voicing 的 inversion candidates(原 + 4 个 octave-shift 变体)。
 * 所有 candidate 保 pc 集不变,只调单音 octave。
 * 越界(CHORD_RANGE [48, 81])的 candidate 过滤。
 */
function generateInversionCandidates(voicing: ReadonlyArray<number>): number[][] {
    if (voicing.length === 0) return [voicing.slice()];
    const candidates: number[][] = [voicing.slice()];
    const lastIdx = voicing.length - 1;

    // Lift bottom +12 / +24
    for (const lift of [12, 24]) {
        const lifted = voicing.slice();
        lifted[0] += lift;
        if (lifted[0] <= CHORD_RANGE.HIGH) {
            lifted.sort((a, b) => a - b);
            candidates.push(lifted);
        }
    }
    // Drop top -12 / -24
    for (const drop of [12, 24]) {
        const dropped = voicing.slice();
        dropped[lastIdx] -= drop;
        if (dropped[lastIdx] >= CHORD_RANGE.LOW) {
            dropped.sort((a, b) => a - b);
            candidates.push(dropped);
        }
    }
    return candidates;
}

export const VoicingSmoother: ComposerPluginMeta & {
    apply(chords: ReadonlyArray<ChordDef>): ChordDef[];
} = {
    name: 'VoicingSmoother',
    version: 'v1.2 (R + S2 + invert-9th)',
    prngConsumption: 'zero',
    description: 'Post-pass cross-chord voice leading smoother(inversion candidates + phrase-arc bonus + invert-9th detector)',

    apply(chords) {
        const out = chords.slice();
        if (out.length < 3) return out;  // 无 prev+next 上下文,跳过

        for (let i = 1; i < out.length - 1; i++) {
            const prev = out[i - 1].notesMidi;
            const next = out[i + 1].notesMidi;
            const curr = out[i].notesMidi;
            const candidates = generateInversionCandidates(curr);

            // S2:phrase-arc bonus 用 phrase position 算 expected top shift
            const phrasePos = i % PHRASE_CHORD_COUNT;
            const expectedShift = expectedArcShift(phrasePos);
            const prevTop = topVoice(prev);

            const computeCost = (cand: ReadonlyArray<number>): number => {
                const arcCost = Math.abs(topVoice(cand) - prevTop - expectedShift) * ARC_WEIGHT;
                return voicingL1(prev, cand) + voicingL1(cand, next) + arcCost;
            };

            let bestVoicing = curr;
            let bestCost = computeCost(curr);
            for (let c = 1; c < candidates.length; c++) {
                const cand = candidates[c];
                const cost = computeCost(cand);
                if (cost < bestCost) {
                    bestVoicing = cand;
                    bestCost = cost;
                }
            }

            // Phase 5:invert-9th detector — 把 muddy 小 9 度 swap 成 major 7
            const fixedVoicing = fixMinor9Intervals(bestVoicing);

            if (fixedVoicing !== curr) {
                // 替换 notesMidi(notes display 标签保持旧 octave — UI 用,不影响音频)
                out[i] = { ...out[i], notesMidi: fixedVoicing };
            }
        }
        // 首尾两个 chord 也跑一次 invert-9th 修复(主循环只覆盖 i in [1, length-2])
        if (out.length > 0) {
            const head = out[0]!;
            const fixedHead = fixMinor9Intervals(head.notesMidi);
            if (fixedHead.some((m, k) => m !== head.notesMidi[k])) {
                out[0] = { ...head, notesMidi: fixedHead };
            }
        }
        if (out.length > 1) {
            const tail = out[out.length - 1]!;
            const fixedTail = fixMinor9Intervals(tail.notesMidi);
            if (fixedTail.some((m, k) => m !== tail.notesMidi[k])) {
                out[out.length - 1] = { ...tail, notesMidi: fixedTail };
            }
        }
        return out;
    },
};
