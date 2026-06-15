// ============================================================
// motifSandbox · model · 审计 + quote 校验
// ------------------------------------------------------------
// 校验:第一槽原样 motif(head)、真有发展(developVariants>1 不是复制)、密度/留白、
//   非 jazz diatonic、跳进/jazziness。
// ============================================================

import type { MotifNote, MotifOccurrence, MotifWeaveAudit, ScaleMode, UserMotif } from './types';
import { isInScale } from './scale';
import { fitRange, identity } from './motifTransform';

const EPS = 1e-6;
const BAR = 4;
const LEAD_LOW = 60, LEAD_HIGH = 84;

/** 某 startBeat 处是否原样复现 refNotes(逐音 onset 相对 + pitch)。 */
function quotedAt(lead: readonly MotifNote[], refNotes: readonly MotifNote[], startBeat: number): boolean {
  for (const m of refNotes) {
    const want = startBeat + m.onsetBeat;
    if (!lead.find((n) => Math.abs(n.onsetBeat - want) < EPS && n.midi === m.midi)) return false;
  }
  return true;
}

export function auditMotifWeave(
  lead: readonly MotifNote[],
  motif: UserMotif,
  occurrences: readonly MotifOccurrence[],
  keyPc: number,
  mode: ScaleMode,
  ctx: { totalBars: number },
): MotifWeaveAudit {
  const sorted = [...lead].sort((a, b) => a.onsetBeat - b.onsetBeat);
  let maxLeap = 0;
  for (let i = 1; i < sorted.length; i++) maxLeap = Math.max(maxLeap, Math.abs(sorted[i].midi - sorted[i - 1].midi));
  const chromatic = sorted.filter((n) => !isInScale(n.midi, keyPc, mode)).length;
  const chromaticRatio = sorted.length ? chromatic / sorted.length : 0;
  const dense = sorted.filter((n) => n.durationBeat <= 0.25 + EPS).length;
  const jazzinessScore = Math.min(1, chromaticRatio * 0.6 + (sorted.length ? dense / sorted.length : 0) * 0.3 + Math.min(1, Math.max(0, maxLeap - 9) / 8) * 0.1);

  const refQuote = fitRange(identity(motif.notes), LEAD_LOW, LEAD_HIGH);
  const motifQuotedFirstCycle = quotedAt(lead, refQuote, 0);

  const themeStatements = occurrences.filter((o) => o.kind === 'quote' || o.kind === 'develop').length;
  const developVariants = new Set(occurrences.filter((o) => o.kind === 'develop').map((o) => o.label)).size;
  const connectSlots = sorted.filter((n) => n.occurrenceKind === 'connect').length; // 连接留白音数(透气)
  const notesPerBar = ctx.totalBars ? sorted.length / ctx.totalBars : 0;
  const sounding = sorted.reduce((a, n) => a + n.durationBeat, 0);
  const restRatio = Math.max(0, 1 - sounding / (ctx.totalBars * BAR));

  return {
    motifQuotedFirstCycle,
    themeStatements,
    developVariants,
    connectSlots,
    notesPerBar,
    restRatio,
    maxLeap,
    chromaticRatio,
    jazzinessScore,
  };
}

export { quotedAt };
