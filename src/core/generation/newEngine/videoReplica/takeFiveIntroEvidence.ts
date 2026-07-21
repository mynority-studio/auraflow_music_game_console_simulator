// ============================================================
// Take Five video · performed first-15-second evidence view
// ------------------------------------------------------------
// The section boundary is performed tick 24000. Events that begin before it
// remain intact even when their tails cross into the following section.
// ============================================================

import type { VideoReplicaEvidenceEventInput } from './VideoReplicaScore';
import {
  parseTakeFiveFullEvidence,
  TAKE_FIVE_FULL_EVIDENCE_CSV,
} from './takeFiveFullEvidence';

export const TAKE_FIVE_OPENING_CSV_SHA256 = '6a90d90a5c26279afe850fce6907a1e33a1bc239c0e4c3457d391e8c5d5d9633';
export const TAKE_FIVE_OPENING_CANONICAL_EVENT_SHA256 = '7b13b8d1b410570018ba6829744d8a23b9d3791b7aae6947ee42ef0ebaedcdc2';
export const TAKE_FIVE_OPENING_STRIKE_GROUP_SHA256 = '1e56db8ea1a667cce77086bda43cc8210031d99ebdfd67b3d068de26f6a0603a';

export const TAKE_FIVE_OPENING_EVIDENCE_CSV = TAKE_FIVE_FULL_EVIDENCE_CSV
  .split('\n')
  .filter((row) => Number(row.split(',')[1]) < 24_000)
  .join('\n');

export function parseTakeFiveOpeningEvidence(): VideoReplicaEvidenceEventInput[] {
  return parseTakeFiveFullEvidence().filter((event) => event.performedStartTick < 24_000);
}
