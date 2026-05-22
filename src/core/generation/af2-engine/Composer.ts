// ============================================================
// Composer — 作曲家层接口(用户 8 层架构 #4)
// ============================================================
//
// **Option A 接口起步**:本次仅定义接口契约,实现层 mg 暂不拆开。
//
// Composer 职责(用户 ideal):
//   在 Arranger 给的骨架(级数 + TSD)上,添加和声色彩(具体 chord quality
//   选择,如 maj7 / m9 / 13 / altered)+ voice-leading 实化(voicing MIDI +
//   bassMidi)→ 输出完整可演奏 Score。
//
// mg 黑盒映射(当前 Option A 实现):
//   - mg 的 decorateChordType(8-step 决策)= Composer 的"色彩"阶段
//   - mg 的 realizeProgression(voicing + bass + chordSymbol)= Composer 的
//     "实化"阶段
//   两者都在 mg.generateProgressions 内部一气呵成。
//
// Option B+ 未来路径:
//   AF2 可在 Arranger 输出和 Composer 输入之间注入决策(passing chords /
//   modal interchange suggestions / etc.),Composer 仍用 mg 实化。
//   或 AF2 自写 Composer,替代 mg 的"色彩 + 实化"逻辑。
// ============================================================

import type { ArrangerOutput } from './Arranger';
import type { Score } from './Score';

/**
 * Composer 接口 — 在 Arranger 骨架上填色彩 + voicing。
 *
 * 输入:ArrangerOutput(骨架 + meta)
 * 输出:Score(完整可演奏总谱,含 chord voicings)
 */
export interface Composer {
    compose(arrangerOutput: ArrangerOutput): Score;
}
