// ============================================================
// newEngine · sandbox · TraceDiff(A/B seed 对比,纯函数可测)
// ------------------------------------------------------------
// 两次 generateSong 的流程日志 + 关键指标对比:LCS 行对齐 diff(同/左独/右独)
// + 指标 delta(bpm/小节/音符数/状态)。面板并排渲染;diff 逻辑单测锁。
// ============================================================

import type { GenerationTrace } from '../generation';
import type { MusicalIR } from '../ir/MusicalIR';

export interface DiffRow {
  left?: string;  // A 行(undefined = A 无此行)
  right?: string; // B 行(undefined = B 无此行)
  same: boolean;  // 两侧同一行
}

/** LCS 行对齐 diff:相同行配对(same),增删行各占一侧(同 tick 顺序稳定)。 */
export function diffLines(a: readonly string[], b: readonly string[]): DiffRow[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ left: a[i], right: b[j], same: true }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ left: a[i], same: false }); i++; }
    else { rows.push({ right: b[j], same: false }); j++; }
  }
  while (i < n) rows.push({ left: a[i++], same: false });
  while (j < m) rows.push({ right: b[j++], same: false });
  return rows;
}

export interface MetricPair<T> { a: T; b: T; equal: boolean; }
export interface TraceComparison {
  rows: DiffRow[];
  changedCount: number;
  metrics: {
    bpm: MetricPair<number>;
    bars: MetricPair<number>;
    notes: MetricPair<number>;
    status: MetricPair<string>;
  };
}

const barsOf = (ir: MusicalIR): number => Math.round((ir.durationTicks as number) / (ir.timebase.ppq * 4));
const notesOf = (ir: MusicalIR): number => ir.tracks.reduce((s, t) => s + t.notes.length, 0);
const statusOf = (t: GenerationTrace): string => (t.audit.findings.length === 0 ? 'pass' : 'warning');
const pair = <T>(a: T, b: T): MetricPair<T> => ({ a, b, equal: a === b });

/** 两 trace 全面对比:行 diff + 指标 delta。 */
export function compareTraces(a: GenerationTrace, b: GenerationTrace): TraceComparison {
  const rows = diffLines(a.lines, b.lines);
  return {
    rows,
    changedCount: rows.filter((r) => !r.same).length,
    metrics: {
      bpm: pair(a.bpm, b.bpm),
      bars: pair(barsOf(a.ir), barsOf(b.ir)),
      notes: pair(notesOf(a.ir), notesOf(b.ir)),
      status: pair(statusOf(a), statusOf(b)),
    },
  };
}
