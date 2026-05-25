// ==========================================
// MinorBorrowPlanner — Minor 调 parallel-major borrow(K4 阶段)
// ==========================================
//
// Picardy(K3)负责 phrase ending i→I。本模块负责非 ending 的 borrow:
//
//   M2: iv → IV (Dorian-flavor borrow)
//     Minor 调里 iv 是 diatonic,IV 是借自 parallel Major / Dorian。
//     听感:让 minor verse 听到一个"明亮的 IV"片刻,产生 Dorian flavor。
//     idiom:Beatles "Eleanor Rigby" verse / Pink Floyd "Comfortably Numb" verse /
//            Radiohead "Karma Police" 副歌前借的 IV。
//
//   M3: bVI → VI (chromatic mediant)
//     bVI(rootOffset 8)是 Aeolian 自然小调的 6 度;VI(rootOffset 9)是
//     parallel Major 的 vi 位置移上来的 major triad。在 minor 调里产生
//     chromatic mediant 听感 — 不像 V→i 的标准解决,是斜向的"色彩转向"。
//     idiom:Coldplay / U2 大量用,作为 verse-to-chorus 桥
//
// 跟 BorrowChordPlanner(Major 调 7 rule)平行 — 后者 Minor 调
// short-circuit(K2 阶段加 'minor/Aeolian' 进 MODAL_HOME_MODES)。
// 本模块 Major 调 short-circuit(只在 isMinor=true 时跑)。
//
// Per-mgStyle prob:
//   POP   M2 0.20 / M3 0.10
//   JAZZ  M2 0.30 / M3 0.20
//   RNB   M2 0.25 / M3 0.15
//   BLUES M2 0    / M3 0(blues 不做色彩 borrow,保持 modal universe)
//
// Per-song 上限:POP 2 / JAZZ 3 / RNB 3 / BLUES 0 次 fire 总和。
//
// 5 道防呆(镜像 BorrowChordPlanner):
//   - lockType skip(Picardy / TonicizationPlanner 已锁的不再 reborrow)
//   - slash chord skip(secondary dominants 不动)
//   - first-phrase guard(开头 motifInterval 不动 — 让 minor 立住)
//   - tonicization-zone guard(prev/next 是 V/X 不动)
//   - phraseRole='ending' 跳过(让 Picardy 主导 ending)
// ==========================================

import type { Af2AbstractStep, BorrowedSource } from './Af2Arranger';
import type { Random } from './utils/Random';
import { classifyPhraseRole, type PhraseRole } from './utils/phrase-role';
import { romanHead } from './utils/roman';
import { MINOR_TO_MAJOR_TYPE } from './utils/minor-major-type';

// POP-only(JAZZ/BLUES/RNB 已退役)
const IV_BORROW_PROB: number = 0.20;
const VI_BORROW_PROB: number = 0.10;
const MAX_MINOR_BORROWS_PER_SONG: number = 2;

export interface PlanMinorBorrowOptions {
    skeleton: Af2AbstractStep[];
    motifInterval: number;
    random: Random;
}

/**
 * 主入口。返回新 skeleton 数组(原数组不动)。
 * Per slot 单 roll → 决定是否 fire(iv→IV 优先,bVI→VI 次之;每 slot 只 fire 1 种)。
 */
export function planMinorBorrows(opts: PlanMinorBorrowOptions): Af2AbstractStep[] {
    const { skeleton, motifInterval, random } = opts;
    const ivProb = IV_BORROW_PROB;
    const viProb = VI_BORROW_PROB;
    if ((ivProb + viProb) === 0 || skeleton.length < 2) return skeleton.slice();

    const maxFires = MAX_MINOR_BORROWS_PER_SONG;
    let firesUsed = 0;

    const result: Af2AbstractStep[] = [];
    for (let i = 0; i < skeleton.length; i++) {
        const curr = skeleton[i];

        // Defenses
        if (curr.lockType) { result.push(curr); continue; }
        if (curr.roman.includes('/')) { result.push(curr); continue; }
        if (motifInterval > 0 && i < motifInterval) { result.push(curr); continue; }

        const phraseRole = classifyPhraseRole(i, skeleton.length, motifInterval);
        if (phraseRole === 'ending') { result.push(curr); continue; }

        // Tonicization-zone guard
        const prev = result.length > 0 ? result[result.length - 1] : null;
        const next = i + 1 < skeleton.length ? skeleton[i + 1] : null;
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
        if (inTonicizationZone) { result.push(curr); continue; }

        // Single roll → decide which rule fires(if any)
        const roll = random.next();

        // M2: iv → IV(Dorian flavor)
        //   触发:curr 是 iv(rootOffset=5 + minor 家族 type),roll < ivProb
        const isIv = (((curr.rootOffset % 12) + 12) % 12) === 5
            && curr.type in MINOR_TO_MAJOR_TYPE
            && romanHead(curr.roman) === 'iv';
        if (isIv && firesUsed < maxFires && roll < ivProb) {
            const newType = MINOR_TO_MAJOR_TYPE[curr.type] ?? 'maj';
            result.push({
                ...curr,
                roman: 'IV',
                type: newType,
                borrowedFrom: 'IV (Dorian — parallel major)',
                borrowedSource: 'modal_interchange' as BorrowedSource,
                mustResolve: false,
                lockType: true,
            });
            firesUsed++;
            continue;
        }

        // M3: bVI → VI(chromatic mediant 6)
        //   触发:curr 是 bVI(rootOffset=8 + maj 家族 type),roll < ivProb + viProb
        const isBvi = (((curr.rootOffset % 12) + 12) % 12) === 8
            && (curr.type === 'maj' || curr.type === 'maj7' || curr.type === 'maj9' || curr.type === 'maj13')
            && romanHead(curr.roman) === 'bVI';
        if (isBvi && firesUsed < maxFires && roll < ivProb + viProb) {
            // VI = rootOffset 9(borrowed from parallel Major's vi position with maj quality)
            result.push({
                ...curr,
                roman: 'VI',
                rootOffset: 9,
                scaleDegree: 6,
                borrowedFrom: 'VI (chromatic mediant — parallel major)',
                borrowedSource: 'chromatic_color' as BorrowedSource,
                mustResolve: false,
                lockType: true,
            });
            firesUsed++;
            continue;
        }

        result.push(curr);
    }
    return result;
}
