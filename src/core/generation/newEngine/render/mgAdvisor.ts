// ============================================================
// newEngine · render · MgAdvisor(MG strict 移植 Loop 3b)
// Provenance: ../melodygenerative/src/lib/improvisor/Advisor.ts 忠实港(cp + 改 import)。
// fallbackTokensForBrick:某 brick 展开出 0 token 时的兜底(generateImprovisorMelody stage 3b)。
// ============================================================

// Advisor.ts — Fallback lick selector when grammar can't expand a brick.
//
// CLEAN-ROOM stance:
//   - This module is intentionally minimal. It does NOT use the GPL-
//     derived IMPROVISOR_LICKS data. Instead, it produces a generic
//     fallback token sequence for any brick.
//   - When the user later wants per-musician advice, they can populate
//     `addAdvisorSource()` with project-original (or properly licensed)
//     advice templates.

import type { AbstractMelodyToken } from '../knowledge/melodyGrammarTypes';
import type { BrickMatch } from './mgRoadMapParser';

/** Generic fallback: alternating chord-tone + scale-tone over the
 *  brick duration, ending on a chord tone for stability. */
export function fallbackTokensForBrick(brick: BrickMatch): AbstractMelodyToken[] {
  const dur = brick.durationBeats;
  const noteDur = 0.5;  // 8th notes
  const count = Math.max(2, Math.floor(dur / noteDur));
  const out: AbstractMelodyToken[] = [];
  for (let i = 0; i < count; i++) {
    const isStrong = i % 2 === 0;
    out.push({ kind: isStrong ? 'C' : 'S', duration: noteDur });
  }
  // Override last to chord tone for cadential stability
  if (out.length > 0) out[out.length - 1] = { kind: 'C', duration: noteDur };
  return out;
}
