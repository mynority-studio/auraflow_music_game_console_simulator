// ============================================================
// ImproCore engine — ChordPart(最小子集)
// imp/data/ChordPart.java 生成路径所需:getCurrentChord(slot)
// ============================================================
//
// Phase 3:从用户键入的和弦串构建,默认一 bar(480 slot)一个和弦。
// lick-gen 的 checkNote / 和弦上下文按 slot 查当前和弦。
// ============================================================

import { Chord } from './chord';
import { MEASURE_LENGTH } from './constants';

export interface ChordSpan { chord: Chord; start: number; end: number; }

export class ChordPart {
    private spans: ChordSpan[] = [];
    private totalSlots = 0;

    /** 从和弦名串构建,每个 barSlots(默认 480)一个和弦;非法和弦记为 null span(NC 效果) */
    static fromTokens(tokens: string[], barSlots: number = MEASURE_LENGTH): ChordPart {
        const cp = new ChordPart();
        let slot = 0;
        for (const tok of tokens) {
            const chord = Chord.makeChord(tok, barSlots);
            if (chord) cp.spans.push({ chord, start: slot, end: slot + barSlots });
            slot += barSlots;
        }
        cp.totalSlots = slot;
        return cp;
    }

    getTotalSlots(): number { return this.totalSlots; }

    /** 各和弦段(comping 渲染用,含 next chord 做 approach)*/
    getSpans(): readonly ChordSpan[] { return this.spans; }

    /** 当前 slot 的和弦;落在空隙(非法和弦)返回 null */
    getCurrentChord(slot: number): Chord | null {
        for (const s of this.spans) {
            if (slot >= s.start && slot < s.end) return s.chord;
        }
        // 超出末尾 → 用最后一个和弦(faithful:IV getCurrentChord clamps)
        if (this.spans.length > 0 && slot >= this.totalSlots) {
            return this.spans[this.spans.length - 1]!.chord;
        }
        return null;
    }
}
