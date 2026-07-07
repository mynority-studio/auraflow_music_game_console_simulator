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

const MOTIF_LEAD_PRESENCE_FLOOR = 82;
const MOTIF_LEAD_TARGET_AVG = 92;
const MOTIF_LEAD_GAIN_THRESHOLD = 88;
const MOTIF_LEAD_MAX_GAIN = 2.5;
const MOTIF_LEAD_BOOSTED_CEILING = 118;

function clampVelocity(v: number, hi = 127): number {
  return Math.max(1, Math.min(hi, Math.round(v)));
}

/** Q+R lead 音(velocity 0..1)→ 权威 lead 音(beats,velocity 1..127)。 */
export function motifNoteToLeadNote(n: MotifNote): MotifLeadNote {
  return { pitch: Math.round(n.midi), onsetBeat: n.onsetBeat, durationBeat: n.durationBeat, velocity: clampVelocity((n.velocity || 0.7) * 127) };
}

/** Q+R 整编用 lead presence:用户轻弹的 motif 进完整 pop/乐队伴奏时不能被 comp 盖住。 */
export function motifNotesToLeadNotes(notes: readonly MotifNote[]): MotifLeadNote[] {
  const raw = notes.map(motifNoteToLeadNote);
  if (!raw.length) return raw;

  const avg = raw.reduce((sum, n) => sum + n.velocity, 0) / raw.length;
  const gain = avg < MOTIF_LEAD_GAIN_THRESHOLD
    ? Math.min(MOTIF_LEAD_MAX_GAIN, MOTIF_LEAD_TARGET_AVG / Math.max(1, avg))
    : 1;

  return raw.map((n) => ({
    ...n,
    velocity: clampVelocity(
      Math.max(MOTIF_LEAD_PRESENCE_FLOOR, n.velocity * gain),
      gain > 1 ? MOTIF_LEAD_BOOSTED_CEILING : 127,
    ),
  }));
}

/** 一次 Q+R weave 结果 → Q+N 注入合同(harmony + lead 都做权威)。 */
export function buildMotifSongOverride(result: MotifWeaverResult, keyPc: number, mode: ScaleMode): MotifSongOverride {
  return {
    harmony: sandboxProgressionToHarmonicPlan(result.progression, keyPc, mode),
    lead: motifNotesToLeadNotes(result.lead),
    key: { keyPc: ((keyPc % 12) + 12) % 12, mode }, // 供 generateSongFromMotif 把 16-bar 和声 tile 满 arrangement 时重装配
  };
}
