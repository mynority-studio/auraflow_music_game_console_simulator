// ============================================================
// auraRoaming · padLookup(lead 音高 → 15 键位反查,纯函数)
// ------------------------------------------------------------
// 接管布局是按和弦重建的两八度安全音窗;lead 音符可能:
//   · 恰好在布局里(精确 midi 命中,重复 cell 取离中心 7 最近的);
//   · 只有同 pitch-class 的八度折叠(仍然"这个音在布局的这个位置");
//   · 完全不在 → 该提示跳过(引导必须诚实)。
// ============================================================

import { TAKEOVER_CENTER_PAD_INDEX } from '../../../core/generation/leadTakeoverSandbox/padLayout';

export interface PadLookupCell {
  index: number;
  midi: number;
  pc: number;
}

function nearestCenter(a: PadLookupCell, b: PadLookupCell): PadLookupCell {
  const da = Math.abs(a.index - TAKEOVER_CENTER_PAD_INDEX);
  const db = Math.abs(b.index - TAKEOVER_CENTER_PAD_INDEX);
  return db < da ? b : a;
}

export function padIndexForPitch(cells: readonly PadLookupCell[], pitch: number): number | null {
  let exact: PadLookupCell | null = null;
  let samePc: PadLookupCell | null = null;
  const pc = ((pitch % 12) + 12) % 12;
  for (const cell of cells) {
    if (cell.midi === pitch) exact = exact ? nearestCenter(exact, cell) : cell;
    else if (cell.pc === pc) samePc = samePc ? nearestCenter(samePc, cell) : cell;
  }
  if (exact) return exact.index;
  if (samePc) return samePc.index;
  return null;
}
