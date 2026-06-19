// ============================================================
// newEngine · render · 单声部 lead tick 域清洗(no same-pitch overlap)
// ------------------------------------------------------------
// CODEX directive: docs/q_r_motif_no_swallowed_notes_directive.md(2026-06-19,Phase 4)。
// lead 是单声部:导出 MIDI 前 NoteIR 必须【无同 pitch 同 startTick 双 noteOn、无同 pitch overlap】——
// 否则短音 noteOff 会提前关掉同 pitch 长音。纯 NoteIR 工具(无 motifSandbox 依赖)→ Q+R preview / Q+N 走 A 共用。
// ★ 最终保险:即使上游漏了,也不让同 pitch overlap 进 musicalIRToMidiEvents()。
// ============================================================

import { ticks } from '../foundation';
import type { NoteIR } from '../ir/MusicalIR';

export interface SanitizeTickOpts { gapTicks?: number; minDurTicks?: number; }

/** tick 域单声部清洗:① 合并同 startTick+同 pitch(取长 dur/大 vel);② 同 pitch overlap → 前音裁到 nextStart-gap。 */
export function sanitizeLeadNoteIR(notes: readonly NoteIR[], opts: SanitizeTickOpts = {}): NoteIR[] {
  const gap = opts.gapTicks ?? 1;
  const minDur = opts.minDurTicks ?? 1;
  const sorted = [...notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
  // ① coalesce 同 startTick + 同 pitch
  const out: NoteIR[] = [];
  for (const n of sorted) {
    const ex = out.find((c) => (c.pitch as number) === (n.pitch as number) && (c.startTick as number) === (n.startTick as number));
    if (!ex) { out.push({ ...n }); continue; }
    ex.durationTicks = ticks(Math.max(ex.durationTicks as number, n.durationTicks as number));
    ex.velocity = Math.max(ex.velocity, n.velocity);
  }
  out.sort((a, b) => (a.startTick as number) - (b.startTick as number));
  // ② 同 pitch overlap:前音裁到 nextStart - gap(≥ minDur)
  for (let i = 0; i < out.length; i++) {
    const iStart = out[i].startTick as number, iEnd = iStart + (out[i].durationTicks as number);
    for (let j = i + 1; j < out.length; j++) {
      const js = out[j].startTick as number;
      if (js >= iEnd) break;
      if ((out[j].pitch as number) === (out[i].pitch as number)) { out[i].durationTicks = ticks(Math.max(minDur, js - iStart - gap)); break; }
    }
  }
  return out;
}
