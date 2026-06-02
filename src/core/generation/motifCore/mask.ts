// ============================================================
// motifCore — Beat-aware mask(节拍感知的「流派遮罩」)
// ============================================================
//
// 问题:motif 在原和弦上 realize 一次后整段复制,贴到 SmartGen 的借用/转调
//   和弦上会冲突。improCore 的 rectify 吸附到「整条和弦音阶」,音阶里含 avoid/
//   张力音(如 F over CM7 的 11),且对强拍长音一视同仁 → 强拍上的张力音很出戏。
//
// 解法(不 mute,按节拍权重 re-target):
//   - 结构音(强拍 beat1/3 或 长音 ≥二分)→ 吸到「和弦音」(最稳,顶掉冲突)
//   - 流动音(弱拍短音)→ 吸到「和弦音阶」或「流派五声」(保留流动色彩)
//
// 复用 improCore rectify.ts:38-41 的最近半音吸附逻辑,improCore 不动。
// ============================================================

import type { SlotNote, ChordPart, Chord } from '../improCore/engine';

const BAR = 480; // WHOLE

/** 最近半音吸附到目标 PC 集(同 rectify:先 +d 再 -d,已在集内不动) */
function snapToPCs(pitch: number, pcs: number[]): number {
    if (pcs.length === 0) return pitch;
    const pc = ((pitch % 12) + 12) % 12;
    if (pcs.includes(pc)) return pitch;
    for (let d = 1; d <= 6; d++) {
        if (pcs.includes(((pc + d) % 12 + 12) % 12)) return pitch + d;
        if (pcs.includes(((pc - d) % 12 + 12) % 12)) return pitch - d;
    }
    return pitch;
}

/** 结构音判定:落在强拍(beat 1 / beat 3)或长音(≥ 二分)→ true */
function isStructural(slot: number, dur: number): boolean {
    const inBar = ((slot % BAR) + BAR) % BAR;
    const onStrongBeat = inBar === 0 || inBar === 240; // beat 1 / beat 3
    const isLong = dur >= 240;                          // 二分及以上
    return onStrongBeat || isLong;
}

const MAJOR_PENT = [0, 2, 4, 7, 9];   // do re mi sol la(去 4/7 avoid)
const MINOR_PENT = [0, 3, 5, 7, 10];

function chordPCs(ch: Chord): number[] {
    return ch.getSpellMIDIarray().map(m => ((m % 12) + 12) % 12);
}

/**
 * 强拍锚点 = 和弦的「稳定骨架」(1/3/5/7),剔除 extension(9/11/13)。
 *
 * 关键:improCore 的 getSpell() 返回完整拼写 —— m9/maj9/add9 会把 9 音、
 * 9sus4 会把 11 音也列进「和弦音」。直接拿来当强拍吸附目标,会把强拍长音
 * 吸到 9/11 这种「想解决而未解决」的张力音上(= 用户听到的难受)。
 * 这里按相对 root 的半音度数过滤,只留三和弦+七和弦骨架;保护 dim 的 b5 /
 * aug 的 #5 / dim7 的 bb7 不被误删(它们是骨架不是张力)。
 */
export function anchorPCs(ch: Chord): number[] {
    const root = ((ch.getRootSemitones() % 12) + 12) % 12;
    const fam = ch.getFamily();
    const isDim = /diminished/.test(fam);
    const isAug = /augmented/.test(fam);
    const out: number[] = [];
    for (const m of ch.getSpellMIDIarray()) {
        const deg = ((m - root) % 12 + 12) % 12; // 相对 root 半音
        const keep =
            deg === 0 ||                  // 1
            deg === 3 || deg === 4 ||     // b3 / 3
            deg === 7 ||                  // 5
            deg === 10 || deg === 11 ||   // b7 / 7
            (isDim && deg === 6) ||       // dim b5
            (isAug && deg === 8) ||       // aug #5
            (isDim && deg === 9);         // dim7 bb7
        if (keep) out.push(((m % 12) + 12) % 12);
    }
    return out.length ? out : chordPCs(ch); // 兜底(理论不空)
}

function scalePCs(ch: Chord): number[] {
    const sc = ch.getFirstScalePCs();
    return sc && sc.length ? sc : chordPCs(ch);
}

/** 和弦相对五声(按 root + 大小调家族)*/
function pentPCs(ch: Chord): number[] {
    const root = ((ch.getRootSemitones() % 12) + 12) % 12;
    const fam = ch.getFamily();
    const isMinor = /minor|half-diminished|diminished/.test(fam);
    return (isMinor ? MINOR_PENT : MAJOR_PENT).map(x => (x + root) % 12);
}

export type WeakTarget = 'scale' | 'pentatonic';

/**
 * 节拍感知遮罩:结构音吸和弦音,流动音吸音阶/五声。
 * @param weakTarget 弱拍流动音的吸附目标('scale' 保留更多色彩 / 'pentatonic' 更"流行干净")
 */
export function beatAwareMask(notes: SlotNote[], cp: ChordPart, weakTarget: WeakTarget = 'scale'): SlotNote[] {
    return notes.map(n => {
        if (n.pitch < 0) return n;
        const ch = cp.getCurrentChord(n.startSlot);
        if (!ch || ch.isNOCHORD()) return n;
        if (isStructural(n.startSlot, n.durationSlots)) {
            return { ...n, pitch: snapToPCs(n.pitch, anchorPCs(ch)) };
        }
        return { ...n, pitch: snapToPCs(n.pitch, weakTarget === 'pentatonic' ? pentPCs(ch) : scalePCs(ch)) };
    });
}
