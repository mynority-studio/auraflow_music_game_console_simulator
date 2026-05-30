// ============================================================
// ImproCore engine — ChordPart(最小子集)
// imp/data/ChordPart.java 生成路径所需:getCurrentChord(slot)
// ============================================================
//
// 从用户键入的和弦串构建。支持 Impro-Visor 原生 leadsheet 语法:
//   - `|` 分小节(每小节 480 slot),小节内多和弦平分小节时长
//   - `/` 重复上一个和弦(延续)
//   - 无 `|` 时退回旧行为:每个和弦各占一 bar(向后兼容)
// lick-gen 的 checkNote / 和弦上下文按 slot 查当前和弦。
// ============================================================

import { Chord } from './chord';
import { MEASURE_LENGTH } from './constants';

export interface ChordSpan { chord: Chord; start: number; end: number; }

const REPEAT = '/'; // leadsheet 里 / = 重复上一个和弦

export class ChordPart {
    private spans: ChordSpan[] = [];
    private totalSlots = 0;

    private pushChord(chord: Chord | null, start: number, dur: number): void {
        if (chord) this.spans.push({ chord, start, end: start + dur });
    }

    /**
     * 从和弦名 token 数组构建,每个 barSlots(默认 480)一个和弦。
     * 不解析 `|` / `/`(纯 token 路径)。保留用于内部/测试;
     * 面板请用 fromText(支持 leadsheet 语法)。
     */
    static fromTokens(tokens: string[], barSlots: number = MEASURE_LENGTH): ChordPart {
        const cp = new ChordPart();
        let slot = 0;
        for (const tok of tokens) {
            cp.pushChord(Chord.makeChord(tok, barSlots), slot, barSlots);
            slot += barSlots;
        }
        cp.totalSlots = slot;
        return cp;
    }

    /**
     * 从 leadsheet 文本构建,忠实 Impro-Visor 语法:
     *   "FM7 Gm7 | Am7 | F7 / / Bb13"  →  小节内和弦平分 barSlots,/ 重复上一和弦。
     * 无 `|` 时退回 fromTokens 行为(每和弦一 bar),向后兼容旧串。
     */
    static fromText(text: string, barSlots: number = MEASURE_LENGTH): ChordPart {
        const hasBarlines = text.includes('|');
        if (!hasBarlines) {
            const tokens = text.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
            return ChordPart.fromTokens(tokens, barSlots);
        }

        const cp = new ChordPart();
        let slot = 0;
        let lastChord: Chord | null = null;
        // 按 | 切小节,空小节(连续 ||)跳过
        const bars = text.split('|').map(b => b.trim()).filter(Boolean);
        for (const bar of bars) {
            const cells = bar.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
            if (cells.length === 0) continue;
            // 小节内平分:逐格分配,把整除余数顺次补到前面的格,保证小节恰好 barSlots
            const n = cells.length;
            const base = Math.floor(barSlots / n);
            let rem = barSlots - base * n;
            for (const cell of cells) {
                const dur = base + (rem > 0 ? 1 : 0);
                if (rem > 0) rem--;
                if (cell === REPEAT) {
                    cp.pushChord(lastChord, slot, dur);
                } else {
                    const chord = Chord.makeChord(cell, dur);
                    cp.pushChord(chord, slot, dur);
                    if (chord) lastChord = chord;
                }
                slot += dur;
            }
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
