// ============================================================
// newEngine · render · 用户 motif → LOFI 种子 cell(LOFI 深度融入)
// ------------------------------------------------------------
// LOFI lead 是 score-owned:blueprint.motifCell 在构建端展开成全曲
// statement/variation/return 乐句(comp call-response 同源耦合)。
// 深度融入 = 把用户 motif 的头部派生成 LofiLeadMotifCell 换掉内置种子:
// 三态展开/和声许可/时值裁剪/slot 绑定全部沿用构建端原生逻辑。
// 音高语义:cell 只带相对轮廓(diatonicStepFromPrevious),最终音高由
// 和声许可集重定 —— 属于用户裁决 §0.5 的"衍生材料";逐音原样的出现
// 仍由 authored span 保证(两条注入路在 span 内由 reserve 机制去重)。
// ============================================================

import type {
  LofiLeadMotifCell,
  LofiLeadMotifCellEvent,
  LofiLeadMotifHarmonicRole,
} from '../knowledge/lofiLeadPhraseBlueprints';
import type { UserMotifBrick } from './userMotifBrick';

const MAX_CELL_EVENTS = 4;   // 内置 cell 为 2-3 音;用户头部取 ≤4 音保持 lofi 呼吸感
const BAR_BEATS = 4;
const quantize = (x: number): number => Math.round(x * 4) / 4;

/** 用户 motif 头部 → LOFI 种子 cell。过密/过短(量化后撞位)返回 undefined = 保底用内置 cell。 */
export function deriveLofiMotifCellFromUserBrick(brick: UserMotifBrick): LofiLeadMotifCell | undefined {
  const notes = [...brick.notes]
    .filter((n) => n.durationBeat > 0)
    .sort((a, b) => a.onsetBeat - b.onsetBeat);
  if (notes.length < 2) return undefined;
  const base = notes[0].onsetBeat;
  const head = notes.filter((n) => n.onsetBeat - base < BAR_BEATS - 0.25 + 1e-6).slice(0, MAX_CELL_EVENTS);
  if (head.length < 2) return undefined;

  const events: LofiLeadMotifCellEvent[] = head.map((n, i) => {
    const offsetBeat = quantize(n.onsetBeat - base);
    const nextOffset = i < head.length - 1 ? quantize(head[i + 1].onsetBeat - base) : BAR_BEATS;
    const room = Math.max(0.25, Math.min(BAR_BEATS - offsetBeat, Math.max(0.25, nextOffset - offsetBeat)));
    const durationBeats = Math.max(0.25, Math.min(quantize(n.durationBeat), room));
    // desiredMidi = prev + step*2 半音(构建端语义)→ step ≈ 半音差 / 2,钳到内置 cell 的谦逊幅度
    const step = i === 0 ? 0 : Math.max(-3, Math.min(3, Math.round((n.pitch - head[i - 1].pitch) / 2)));
    const structural = (n.structuralToneScore ?? 0.5) >= 0.58;
    const harmonicRole: LofiLeadMotifHarmonicRole =
      i === head.length - 1 ? 'terminal' : i === 0 || structural ? 'anchor' : 'passing';
    return {
      offsetBeat,
      durationBeats,
      diatonicStepFromPrevious: step,
      harmonicRole,
      ...(i === 0 && durationBeats >= 1.5 ? { sustainPolicy: 'common-tone' as const } : {}),
    };
  });
  for (let i = 1; i < events.length; i++) {
    if (events[i].offsetBeat <= events[i - 1].offsetBeat + 1e-6) return undefined; // 量化撞位 → 放弃派生
  }
  return {
    id: `user-motif-cell-${brick.sourceMotifId ?? 'anon'}`,
    events,
    variationTransform: 'delay-tail', // 微妙变化,辨识度优先
    returnTransform: 'exact',         // 回归 = 原样再现种子
  };
}
