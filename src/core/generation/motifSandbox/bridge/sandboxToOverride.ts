// ============================================================
// motifSandbox · bridge · Q+R 产物 → Q+N MotifSongOverride(走 A · PR3 高层入口)
// ------------------------------------------------------------
// 把一次 Q+R motif weave 结果(progression + lead)整体转成 generateSongFromMotif 的注入合同:
//   harmony = 权威和声(sandboxProgressionToHarmonicPlan),lead = 权威 lead(MotifNote→MotifLeadNote,beats)。
// 这是 UI / 调用方拿到的【单一转换入口】。
// ============================================================

import type { MotifSongOverride, MotifLeadNote } from '../../newEngine/generation/generateSongFromMotif';
import { sandboxProgressionToHarmonicPlan } from './sandboxToHarmonicPlan';
import type { MotifNote, MotifWeaverResult, ScaleMode } from '../model/types';

/** Q+R lead 音(velocity 0..1)→ 权威 lead 音(beats,velocity 1..127)。 */
export function motifNoteToLeadNote(n: MotifNote): MotifLeadNote {
  return { pitch: Math.round(n.midi), onsetBeat: n.onsetBeat, durationBeat: n.durationBeat, velocity: Math.max(1, Math.min(127, Math.round((n.velocity || 0.7) * 127))) };
}

/** 一次 Q+R weave 结果 → Q+N 注入合同(harmony + lead 都做权威)。 */
export function buildMotifSongOverride(result: MotifWeaverResult, keyPc: number, mode: ScaleMode): MotifSongOverride {
  return {
    harmony: sandboxProgressionToHarmonicPlan(result.progression, keyPc, mode),
    lead: result.lead.map(motifNoteToLeadNote),
  };
}
