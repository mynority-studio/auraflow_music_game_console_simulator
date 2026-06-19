// ============================================================
// motifSandbox · model · 单声部 lead beat 域清洗(no swallowed / no same-pitch overlap)
// ------------------------------------------------------------
// CODEX directive: docs/q_r_motif_no_swallowed_notes_directive.md(2026-06-19,Phase 3)。
// weaver finalLead(吸 1/16 后)可能出现同 onset+同 pitch 双音 / 同 pitch overlap → 短音 noteOff 提前关长音。
// beat 域纯函数(只依赖 MotifNote,不依赖 newEngine);tick 域兜底在 newEngine/render/leadSanitizer.ts。
// ★ 合并策略:同 onset+同 pitch → 取长 dur / 大 vel / occurrenceKind 优先级 quote>develop>connect(quote 不被吞)。
// ============================================================

import type { MotifNote } from './types';

const KIND_RANK: Record<string, number> = { quote: 3, develop: 2, connect: 1 };
const kindRank = (k?: string): number => (k ? KIND_RANK[k] ?? 0 : 0);

export interface SanitizeBeatOpts { gapBeat?: number; minDurBeat?: number; }

/** beat 域(MotifNote):① 合并同 onsetBeat+同 midi(长 dur/大 vel/quote 优先);② 消解同 pitch overlap(前音裁到 nextStart-gap)。 */
export function sanitizeMotifLeadNotes(notes: readonly MotifNote[], opts: SanitizeBeatOpts = {}): MotifNote[] {
  const gap = opts.gapBeat ?? 0.01;
  const minDur = opts.minDurBeat ?? 0.03;
  const sorted = [...notes].sort((a, b) => a.onsetBeat - b.onsetBeat);
  // ① coalesce 同 onset + 同 midi
  const out: MotifNote[] = [];
  for (const n of sorted) {
    const ex = out.find((c) => c.midi === n.midi && Math.abs(c.onsetBeat - n.onsetBeat) < 1e-6);
    if (!ex) { out.push({ ...n }); continue; }
    ex.durationBeat = Math.max(ex.durationBeat, n.durationBeat);   // 取较长
    ex.velocity = Math.max(ex.velocity, n.velocity);               // 取较大
    ex.accent = Math.max(ex.accent, n.accent);
    if (kindRank(n.occurrenceKind) > kindRank(ex.occurrenceKind)) ex.occurrenceKind = n.occurrenceKind; // quote>develop>connect
    if ((n.structuralToneScore ?? 0) > (ex.structuralToneScore ?? 0)) ex.structuralToneScore = n.structuralToneScore;
  }
  out.sort((a, b) => a.onsetBeat - b.onsetBeat);
  // ② 同 pitch overlap:前音裁到 nextStart - gap(quote 不丢,裁到最小安全时值)
  for (let i = 0; i < out.length; i++) {
    const iEnd = out[i].onsetBeat + out[i].durationBeat;
    for (let j = i + 1; j < out.length; j++) {
      if (out[j].onsetBeat >= iEnd - 1e-9) break;                  // j 起点已过 i 末 → 无重叠
      if (out[j].midi === out[i].midi) { out[i].durationBeat = Math.max(minDur, out[j].onsetBeat - out[i].onsetBeat - gap); break; }
    }
  }
  return out;
}
