// ============================================================
// newEngine · render · windBreath compatibility wrapper
// ------------------------------------------------------------
// 气息模型已归到 instrumental/gestureExpression。保留旧入口给测试和历史调用,
// renderCoordinator 不再直接按 GM 号判断 wind,而是执行器配层下发的 gesture plan。
// ============================================================

import type { Timebase } from '../foundation';
import type { NoteIR } from '../ir/MusicalIR';
import {
  buildPipeWindBreathCcEvents,
  isPipeWindProgram,
  type GestureCcEvent,
  type WindBreathOptions,
} from '../instrumental/gestureExpression';

export type CcEvent = GestureCcEvent;
export type { WindBreathOptions };

/** GM Pipe 家族(72-79):长笛/排箫/尺八/口哨/陶笛等气声管乐。 */
export function isWindFamily(program: number): boolean {
  return isPipeWindProgram(program);
}

export function windBreathCcEvents(
  notes: readonly NoteIR[],
  timebase: Timebase,
  opts: WindBreathOptions = {},
): CcEvent[] {
  return buildPipeWindBreathCcEvents(notes, timebase, opts);
}
