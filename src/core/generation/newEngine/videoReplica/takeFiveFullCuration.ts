// ============================================================
// Take Five full performance · event-level curation candidate
// ------------------------------------------------------------
// This composes reviewed opening facts with high-confidence post-handoff
// facts. It remains an A/B candidate and never replaces the product baseline
// without explicit approval.
// ============================================================

import {
  defineVideoReplicaScore,
  type VideoReplicaCuratedNoteAddition,
  type VideoReplicaEventCorrection,
  type VideoReplicaEvidenceRejection,
  type VideoReplicaGestureAnnotation,
  type VideoReplicaRoleAssignment,
} from './VideoReplicaScore';
import { TAKE_FIVE_FULL_EVIDENCE } from './takeFiveFullReplica';
import {
  TAKE_FIVE_OPENING_V3_CORRECTIONS,
  TAKE_FIVE_OPENING_V3_GESTURES,
  TAKE_FIVE_OPENING_V3_REJECTIONS,
  TAKE_FIVE_OPENING_V3_RIGHT_HAND_LEAD_IDS,
} from './takeFiveOpeningCuration';

export const TAKE_FIVE_POST_HANDOFF_REJECTIONS: readonly VideoReplicaEvidenceRejection[] = [{
  evidenceId: 'lead-073',
  reason: 'F#5 upper-partial false positive duplicating the physical F#4 attack at tick 35428',
  method: 'frame-by-frame-hand-position-plus-octave-pair-spectrum',
  status: 'provisional',
}];

export const TAKE_FIVE_TAIL_REJECTIONS_V3: readonly VideoReplicaEvidenceRejection[] = [
  {
    evidenceId: 'comp-187',
    reason: 'G#3 upper-partial false positive duplicating the physical G#2 attack at tick 65932; the G#3 key is not struck',
    method: 'frame-by-frame-key-coordinate-plus-octave-pair-spectrum',
    status: 'provisional',
  },
  {
    evidenceId: 'lead-168',
    reason: 'F#5 upper-partial false positive while the visible right hand remains in the physical F#4 register',
    method: 'frame-by-frame-hand-position-plus-octave-pair-spectrum',
    status: 'provisional',
  },
  {
    evidenceId: 'lead-170',
    reason: 'F#5 upper-partial false positive while the visible right hand remains in the physical F#4 register',
    method: 'frame-by-frame-hand-position-plus-octave-pair-spectrum',
    status: 'provisional',
  },
];

export const TAKE_FIVE_POST_HANDOFF_CORRECTIONS: readonly VideoReplicaEventCorrection[] = [{
  evidenceId: 'lead-069',
  midi: 64,
  reason: 'the physical right-hand key at tick 31228 is E4; the detector reported its E5 upper partial',
  method: 'frame-by-frame-key-coordinate-plus-source-spectrum',
  status: 'provisional',
}];

export const TAKE_FIVE_POST_HANDOFF_GESTURES: readonly VideoReplicaGestureAnnotation[] = [
  {
    id: 'post-roll-28830-28867',
    kind: 'micro-roll',
    evidenceIds: ['lead-064', 'comp-025', 'comp-026'],
    reason: 'right hand enters before the descending left-hand pair over 37 performed ticks',
    method: 'frame-by-frame-video-plus-source-onset-sequence',
    status: 'provisional',
  },
  {
    id: 'post-roll-31228-31302',
    kind: 'micro-roll',
    evidenceIds: ['comp-036', 'lead-069', 'comp-037'],
    reason: 'E3/E4 attack precedes the low E2 by 74 performed ticks',
    method: 'frame-by-frame-video-plus-source-onset-sequence',
    status: 'provisional',
  },
  {
    id: 'post-roll-43998-44035',
    kind: 'micro-roll',
    evidenceIds: ['lead-094', 'comp-094', 'comp-095'],
    reason: 'right-hand C5 precedes the left-hand G3/C4 voicing by 37 performed ticks',
    method: 'frame-by-frame-video-plus-source-onset-sequence',
    status: 'provisional',
  },
];

export const TAKE_FIVE_MIDDLE_GESTURES_V3: readonly VideoReplicaGestureAnnotation[] = [
  {
    id: 'middle-reattack-fs4-35205-35428',
    kind: 'reattack',
    evidenceIds: ['lead-071', 'lead-072'],
    reason: 'two independent F#4 attacks with a visible lift and renewed target-pitch onset',
    method: 'consecutive-frame-hand-motion-plus-pitch-specific-onset-peaks',
    status: 'provisional',
  },
  {
    id: 'middle-reattack-bb2-36118-36322',
    kind: 'reattack',
    evidenceIds: ['comp-061', 'comp-065'],
    reason: 'two independent Bb2 attacks inside the repeated left-hand ostinato',
    method: 'consecutive-frame-hand-motion-plus-pitch-specific-onset-peaks',
    status: 'provisional',
  },
  {
    id: 'middle-reattack-d5-41693-41897',
    kind: 'reattack',
    evidenceIds: ['lead-085', 'lead-087'],
    reason: 'two independent D5 attacks separated by a visible right-hand repositioning',
    method: 'consecutive-frame-hand-motion-plus-pitch-specific-onset-peaks',
    status: 'provisional',
  },
  {
    id: 'middle-reattack-a2-43311-43478',
    kind: 'reattack',
    evidenceIds: ['comp-092', 'comp-093'],
    reason: 'the second A2 has a renewed left-hand motion and an independent target-pitch onset',
    method: 'consecutive-frame-hand-motion-plus-pitch-specific-onset-peaks',
    status: 'provisional',
  },
  {
    id: 'middle-roll-35168-35205',
    kind: 'micro-roll',
    evidenceIds: ['comp-053', 'comp-054', 'lead-071'],
    reason: 'D3, D4 and F#4 enter low-to-high across the retained 37 performed ticks',
    method: 'frame-by-frame-video-plus-pitch-specific-onset-sequence',
    status: 'provisional',
  },
];

export const TAKE_FIVE_TAIL_GESTURES_V3: readonly VideoReplicaGestureAnnotation[] = [
  {
    id: 'tail-roll-53942-53980',
    kind: 'micro-roll',
    evidenceIds: ['comp-128', 'comp-129', 'lead-128'],
    reason: 'D3, D4 and F#4 enter low-to-high across the retained 38 performed ticks',
    method: 'frame-by-frame-video-plus-source-onset-sequence',
    status: 'provisional',
  },
  {
    id: 'tail-roll-54444-54481',
    kind: 'micro-roll',
    evidenceIds: ['lead-130', 'comp-131', 'comp-132', 'comp-133'],
    reason: 'D5 enters before the C4/D4 middle pair and the final F#3 across 37 performed ticks',
    method: 'frame-by-frame-video-plus-source-onset-sequence',
    status: 'provisional',
  },
  {
    id: 'tail-roll-76155-76174',
    kind: 'micro-roll',
    evidenceIds: ['comp-251', 'comp-252', 'comp-253', 'lead-173', 'lead-174'],
    reason: 'the C3/G3 low pair precedes the C4/E4/G4 upper group by 19 performed ticks',
    method: 'frame-by-frame-video-plus-source-onset-sequence',
    status: 'provisional',
  },
];

export const TAKE_FIVE_TAIL_CORRECTIONS_V4: readonly VideoReplicaEventCorrection[] = [{
  evidenceId: 'lead-178',
  performedDurationTicks: 760,
  reason: 'the final E4 remains physically held and spectrally audible across the last F bass attack; the detector split its continuation at tick 81393',
  method: 'frame-by-frame-key-hold-plus-pitch-band-decay-plus-multi-threshold-continuation',
  status: 'provisional',
}];

/**
 * Basic Pitch converted source seconds to independent rounded note spans. In
 * these Comp reattacks the prior span ends one tick after the next attack,
 * making its MIDI note-off swallow the new same-key note-on. Each correction
 * changes only the prior key-off by one tick; no onset or Groove fact moves.
 */
export const TAKE_FIVE_COMP_REATTACK_LIFECYCLE_CORRECTIONS_V5: readonly VideoReplicaEventCorrection[] = [
  { evidenceId: 'comp-052', performedDurationTicks: 185, nextEvidenceId: 'comp-053' },
  { evidenceId: 'comp-066', performedDurationTicks: 501, nextEvidenceId: 'comp-069' },
  { evidenceId: 'comp-138', performedDurationTicks: 278, nextEvidenceId: 'comp-141' },
  { evidenceId: 'comp-154', performedDurationTicks: 1_244, nextEvidenceId: 'comp-159' },
  { evidenceId: 'comp-165', performedDurationTicks: 705, nextEvidenceId: 'comp-167' },
  { evidenceId: 'comp-174', performedDurationTicks: 726, nextEvidenceId: 'comp-178' },
  { evidenceId: 'comp-188', performedDurationTicks: 278, nextEvidenceId: 'comp-190' },
  { evidenceId: 'comp-212', performedDurationTicks: 315, nextEvidenceId: 'comp-215' },
  { evidenceId: 'comp-217', performedDurationTicks: 315, nextEvidenceId: 'comp-220' },
  { evidenceId: 'comp-219', performedDurationTicks: 538, nextEvidenceId: 'comp-222' },
  { evidenceId: 'comp-258', performedDurationTicks: 538, nextEvidenceId: 'comp-260' },
  { evidenceId: 'comp-254', performedDurationTicks: 2_472, nextEvidenceId: 'comp-263' },
  { evidenceId: 'comp-267', performedDurationTicks: 705, nextEvidenceId: 'comp-269' },
].map(({ evidenceId, performedDurationTicks, nextEvidenceId }) => ({
  evidenceId,
  performedDurationTicks,
  reason: `one-tick detector rounding overlap made the old note-off cancel the physical same-key reattack ${nextEvidenceId}`,
  method: 'direct-smf-event-lifecycle-audit-plus-source-onset-flux',
  status: 'provisional' as const,
}));

export const TAKE_FIVE_FULL_CURATION_REJECTIONS = [
  ...TAKE_FIVE_OPENING_V3_REJECTIONS,
  ...TAKE_FIVE_POST_HANDOFF_REJECTIONS,
] as const;

export const TAKE_FIVE_FULL_CURATION_CORRECTIONS = [
  ...TAKE_FIVE_OPENING_V3_CORRECTIONS,
  ...TAKE_FIVE_POST_HANDOFF_CORRECTIONS,
] as const;

export const TAKE_FIVE_FULL_CURATION_GESTURES = [
  ...TAKE_FIVE_OPENING_V3_GESTURES,
  ...TAKE_FIVE_POST_HANDOFF_GESTURES,
] as const;

export const TAKE_FIVE_FULL_CURATION_REJECTIONS_V3 = [
  ...TAKE_FIVE_FULL_CURATION_REJECTIONS,
  ...TAKE_FIVE_TAIL_REJECTIONS_V3,
] as const;

export const TAKE_FIVE_FULL_CURATION_CORRECTIONS_V3 = [
  ...TAKE_FIVE_FULL_CURATION_CORRECTIONS,
] as const;

export const TAKE_FIVE_FULL_CURATION_GESTURES_V3 = [
  ...TAKE_FIVE_FULL_CURATION_GESTURES,
  ...TAKE_FIVE_MIDDLE_GESTURES_V3,
  ...TAKE_FIVE_TAIL_GESTURES_V3,
] as const;

export const TAKE_FIVE_FULL_CURATION_CORRECTIONS_V4 = [
  ...TAKE_FIVE_FULL_CURATION_CORRECTIONS_V3,
  ...TAKE_FIVE_TAIL_CORRECTIONS_V4,
] as const;

export const TAKE_FIVE_FULL_CURATION_CORRECTIONS_V5 = [
  ...TAKE_FIVE_FULL_CURATION_CORRECTIONS_V4,
  ...TAKE_FIVE_COMP_REATTACK_LIFECYCLE_CORRECTIONS_V5,
] as const;

/**
 * The second full-video pass found the same one-tick Basic Pitch rounding
 * overlap in six opening reattacks.  As in v5, only the predecessor key-off
 * changes; every physical successor onset remains untouched.
 */
export const TAKE_FIVE_OPENING_REATTACK_LIFECYCLE_CORRECTIONS_V6: readonly VideoReplicaEventCorrection[] = [
  { evidenceId: 'bass-006', performedDurationTicks: 501, nextEvidenceId: 'bass-008' },
  { evidenceId: 'bass-037', performedDurationTicks: 148, nextEvidenceId: 'bass-038' },
  { evidenceId: 'bass-058', performedDurationTicks: 501, nextEvidenceId: 'bass-059' },
  { evidenceId: 'bass-069', performedDurationTicks: 501, nextEvidenceId: 'bass-071' },
  { evidenceId: 'bass-084', performedDurationTicks: 278, nextEvidenceId: 'bass-087' },
  { evidenceId: 'lead-042', performedDurationTicks: 445, nextEvidenceId: 'lead-044' },
].map(({ evidenceId, performedDurationTicks, nextEvidenceId }) => ({
  evidenceId,
  performedDurationTicks,
  reason: `one-tick detector rounding overlap made the old note-off cancel the physical same-key reattack ${nextEvidenceId}`,
  method: 'full-song-smf-lifecycle-audit-plus-source-video-reattack-review',
  status: 'provisional' as const,
}));

export const TAKE_FIVE_FALSE_SPLIT_REJECTIONS_V6: readonly VideoReplicaEvidenceRejection[] = [{
  evidenceId: 'lead-147',
  reason: 'the F#4 key remains continuously held from the observed attack at tick 60536; there is no lift and re-press at tick 61080',
  method: 'exhaustive-frame-motion-plus-three-threshold-pitch-lifecycle-review',
  status: 'provisional',
}];

const OBSERVATION_METHOD_V6 = 'exhaustive-video-key-contact-plus-three-threshold-pitch-plus-source-spectrum; velocity-from-role-specific-detector-amplitude-regression';

/**
 * Positive observations omitted by the immutable detector evidence.  Each was
 * reviewed across the complete 28-item omission queue.  D4@40295 is
 * deliberately absent: its audio and physical-key evidence conflict, so it
 * remains an isolated hold rather than entering this fixed-score candidate.
 */
export const TAKE_FIVE_FULL_CURATION_ADDITIONS_V6: readonly VideoReplicaCuratedNoteAddition[] = [
  {
    observationId: 'observed-v6-03378-d3', role: 'bass',
    performedStartTick: 3_378, performedDurationTicks: 167, midi: 50, velocity: 60,
    sourceVideoWindowSeconds: [3.55325, 3.76325],
    relatedEvidenceIds: ['bass-012'], relatedStrikeGroupId: 'strike-009',
    reason: 'left-hand D3 contact plus three-config/spectral onset; short pickup into the next D3 reattack',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-08156-b3', role: 'lead',
    performedStartTick: 8_156, performedDurationTicks: 223, midi: 59, velocity: 51,
    sourceVideoWindowSeconds: [6.5395, 6.7495],
    relatedEvidenceIds: ['bass-033'], relatedStrikeGroupId: 'strike-029',
    reason: 'right-hand B3 contact joins F#3 five ticks later',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-08379-e2', role: 'bass',
    performedStartTick: 8_379, performedDurationTicks: 316, midi: 40, velocity: 55,
    sourceVideoWindowSeconds: [6.678875, 6.888875],
    relatedEvidenceIds: ['bass-034', 'bass-035', 'lead-017', 'lead-018'], relatedStrikeGroupId: 'strike-030',
    reason: 'low E2 key contact supplies the root under the chord five ticks later',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-10107-b2', role: 'bass',
    performedStartTick: 10_107, performedDurationTicks: 504, midi: 47, velocity: 55,
    sourceVideoWindowSeconds: [7.758875, 7.968875],
    relatedEvidenceIds: ['bass-046', 'bass-047'], relatedStrikeGroupId: 'strike-038',
    reason: 'left-hand B2 contact forms the B2-F#3-B3 foundation',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-10555-d3', role: 'bass',
    performedStartTick: 10_555, performedDurationTicks: 241, midi: 50, velocity: 52,
    sourceVideoWindowSeconds: [8.038875, 8.248875],
    relatedEvidenceIds: ['bass-048'], relatedStrikeGroupId: 'strike-039',
    reason: 'visible D3 to F#3 roll with four decoder configurations and strong onset rise',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-15591-d3', role: 'bass',
    performedStartTick: 15_591, performedDurationTicks: 167, midi: 50, velocity: 55,
    sourceVideoWindowSeconds: [11.186375, 11.396375],
    relatedEvidenceIds: ['bass-071'], relatedStrikeGroupId: 'strike-062',
    reason: 'visible D3 to F#3 roll plus strong independent D3 onset',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-39533-c3', role: 'comp',
    performedStartTick: 39_533, performedDurationTicks: 204, midi: 48, velocity: 50,
    sourceVideoWindowSeconds: [26.150125, 26.360125],
    relatedEvidenceIds: ['lead-078'], relatedStrikeGroupId: 'strike-152',
    reason: 'left-hand C3 contact is near-synchronous with C5',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-40555-g3', role: 'comp',
    performedStartTick: 40_555, performedDurationTicks: 223, midi: 55, velocity: 50,
    sourceVideoWindowSeconds: [26.788875, 26.998875],
    relatedEvidenceIds: ['lead-081', 'comp-082'],
    reason: 'left-hand G3 contact and independent onset precede the following D4/C5 roll',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-43065-a2', role: 'comp',
    performedStartTick: 43_065, performedDurationTicks: 241, midi: 45, velocity: 57,
    sourceVideoWindowSeconds: [28.357625, 28.567625],
    relatedEvidenceIds: ['lead-091'],
    reason: 'left-hand A2 pickup is visible before the following upper attack',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-59682-d3', role: 'comp',
    performedStartTick: 59_682, performedDurationTicks: 204, midi: 50, velocity: 51,
    sourceVideoWindowSeconds: [38.74325, 38.95325],
    relatedEvidenceIds: ['comp-154', 'comp-155', 'lead-146'],
    reason: 'left thumb contacts D3 at the start of the D3-A2-D2 descending roll',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-59775-a2', role: 'comp',
    performedStartTick: 59_775, performedDurationTicks: 316, midi: 45, velocity: 51,
    sourceVideoWindowSeconds: [38.801375, 39.011375],
    relatedEvidenceIds: ['comp-154', 'comp-155', 'lead-146', 'comp-156'], relatedStrikeGroupId: 'strike-246',
    reason: 'left hand contacts A2 between the observed D3 and retained D2 attacks',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-60536-fs4', role: 'lead',
    performedStartTick: 60_536, performedDurationTicks: 671, midi: 66, velocity: 57,
    sourceVideoWindowSeconds: [39.277, 39.487],
    relatedEvidenceIds: ['comp-157', 'comp-158'], relatedStrikeGroupId: 'strike-248',
    reason: 'right hand physically attacks and holds F#4 until the genuine reattack at 61212',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-63994-a2', role: 'comp',
    performedStartTick: 63_994, performedDurationTicks: 299, midi: 45, velocity: 56,
    sourceVideoWindowSeconds: [41.43825, 41.64825],
    relatedEvidenceIds: ['comp-176'], relatedStrikeGroupId: 'strike-265',
    reason: 'left-hand A2 and retained A3 form a visible rolled octave',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-67546-d5', role: 'lead',
    performedStartTick: 67_546, performedDurationTicks: 186, midi: 74, velocity: 51,
    sourceVideoWindowSeconds: [43.65825, 43.86825],
    relatedEvidenceIds: ['lead-162', 'comp-195', 'comp-196'], relatedStrikeGroupId: 'strike-281',
    reason: 'right-hand D5 contact precedes A4 by 23 ticks',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-73622-g4', role: 'lead',
    performedStartTick: 73_622, performedDurationTicks: 448, midi: 67, velocity: 70,
    sourceVideoWindowSeconds: [47.45575, 47.66575],
    relatedEvidenceIds: ['comp-236'],
    reason: 'right-hand G4 contact and three decoder configurations support a sustained upper note',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-76169-a2', role: 'comp',
    performedStartTick: 76_169, performedDurationTicks: 167, midi: 45, velocity: 54,
    sourceVideoWindowSeconds: [49.047625, 49.257625],
    relatedEvidenceIds: ['comp-251', 'comp-252', 'comp-253', 'lead-173', 'lead-174'], relatedStrikeGroupId: 'strike-320',
    reason: 'left-hand A2 contact belongs to the wide A2-C3-G3-C4-E4-G4 voicing',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
  {
    observationId: 'observed-v6-76318-e3', role: 'comp',
    performedStartTick: 76_318, performedDurationTicks: 204, midi: 52, velocity: 51,
    sourceVideoWindowSeconds: [49.14075, 49.35075],
    reason: 'left-hand E3 contact and strong spectrum support a later inner-voice roll-in',
    method: OBSERVATION_METHOD_V6, status: 'provisional',
  },
];

/**
 * The fresh v6 source/render audit isolated one sub-frame timing correction.
 * Four independent transient configurations place the E3 hammer attack 45
 * ticks before Basic Pitch's stable-pitch event boundary.  The original
 * absolute end tick remains detector-supported, so duration grows by the same
 * 45 ticks.  V6 remains immutable for audit provenance.
 */
export const TAKE_FIVE_FULL_CURATION_ADDITIONS_V7: readonly VideoReplicaCuratedNoteAddition[] =
  TAKE_FIVE_FULL_CURATION_ADDITIONS_V6.map((addition): VideoReplicaCuratedNoteAddition => (
    addition.observationId === 'observed-v6-76318-e3'
      ? {
          ...addition,
          performedStartTick: 76_273,
          performedDurationTicks: 249,
          sourceVideoWindowSeconds: [49.112625, 49.322625],
          reason: 'left-hand E3 hammer transient is at tick 76273; two stable decodings retain the absolute end at tick 76522',
          method: `${OBSERVATION_METHOD_V6}; four-detector-source-render-transient-alignment`,
        }
      : addition
  ));

export const TAKE_FIVE_FULL_CURATION_REJECTIONS_V6 = [
  ...TAKE_FIVE_FULL_CURATION_REJECTIONS_V3,
  ...TAKE_FIVE_FALSE_SPLIT_REJECTIONS_V6,
] as const;

export const TAKE_FIVE_FULL_CURATION_CORRECTIONS_V6 = [
  ...TAKE_FIVE_FULL_CURATION_CORRECTIONS_V5,
  ...TAKE_FIVE_OPENING_REATTACK_LIFECYCLE_CORRECTIONS_V6,
] as const;

const reviewedRightHandIds = new Set<string>(TAKE_FIVE_OPENING_V3_RIGHT_HAND_LEAD_IDS);
function buildRoleAssignments(
  rejections: readonly VideoReplicaEvidenceRejection[],
): VideoReplicaRoleAssignment[] {
  const rejectedIds = new Set<string>(rejections.map((item) => item.evidenceId));
  return TAKE_FIVE_FULL_EVIDENCE.events
    .filter((event) => event.disposition === 'kept' && !rejectedIds.has(event.evidenceId))
    .map((event) => {
      if (!event.roleHint) throw new Error(`Full evidence ${event.evidenceId} lacks its provisional role hint`);
      const isReviewedRightHand = reviewedRightHandIds.has(event.evidenceId);
      return {
        evidenceId: event.evidenceId,
        role: isReviewedRightHand ? 'lead' : event.roleHint.role,
        method: isReviewedRightHand ? 'frame-by-frame-hand-pose-key-coordinate' : event.roleHint.method,
        status: 'provisional',
      };
    });
}

const roleAssignmentsV2 = buildRoleAssignments(TAKE_FIVE_FULL_CURATION_REJECTIONS);
const roleAssignmentsV3 = buildRoleAssignments(TAKE_FIVE_FULL_CURATION_REJECTIONS_V3);
const roleAssignmentsV6 = buildRoleAssignments(TAKE_FIVE_FULL_CURATION_REJECTIONS_V6);

export const TAKE_FIVE_FULL_CURATION_CANDIDATE_V2 = defineVideoReplicaScore({
  schemaVersion: 1,
  id: 'take-five-video-full-curation-candidate-v2',
  replicaRevision: 'v2-opening-v3-plus-post-handoff-high-confidence',
  evidence: TAKE_FIVE_FULL_EVIDENCE,
  curationStatus: 'provisional',
  piano: { bank: 0, program: 0 },
  roleAssignments: roleAssignmentsV2,
  rejections: TAKE_FIVE_FULL_CURATION_REJECTIONS,
  corrections: TAKE_FIVE_FULL_CURATION_CORRECTIONS,
  gestures: TAKE_FIVE_FULL_CURATION_GESTURES,
  durationPerformedTicks: 85_860,
});

export const TAKE_FIVE_FULL_CURATION_CANDIDATE_V3 = defineVideoReplicaScore({
  schemaVersion: 1,
  id: 'take-five-video-full-curation-candidate-v3',
  replicaRevision: 'v3-middle-reattacks-plus-tail-false-partial-review',
  evidence: TAKE_FIVE_FULL_EVIDENCE,
  curationStatus: 'provisional',
  piano: { bank: 0, program: 0 },
  roleAssignments: roleAssignmentsV3,
  rejections: TAKE_FIVE_FULL_CURATION_REJECTIONS_V3,
  corrections: TAKE_FIVE_FULL_CURATION_CORRECTIONS_V3,
  gestures: TAKE_FIVE_FULL_CURATION_GESTURES_V3,
  durationPerformedTicks: 85_860,
});

/**
 * Independent v4 audition candidate. V3 remains immutable for historical A/B
 * provenance; this revision changes only the evidence-supported final E4 tail.
 */
export const TAKE_FIVE_FULL_CURATION_CANDIDATE_V4 = defineVideoReplicaScore({
  schemaVersion: 1,
  id: 'take-five-video-full-curation-candidate-v4',
  replicaRevision: 'v4-tail-e4-audible-duration-review',
  evidence: TAKE_FIVE_FULL_EVIDENCE,
  curationStatus: 'provisional',
  piano: { bank: 0, program: 0 },
  roleAssignments: roleAssignmentsV3,
  rejections: TAKE_FIVE_FULL_CURATION_REJECTIONS_V3,
  corrections: TAKE_FIVE_FULL_CURATION_CORRECTIONS_V4,
  gestures: TAKE_FIVE_FULL_CURATION_GESTURES_V3,
  durationPerformedTicks: 85_860,
});

/**
 * Independent Comp-lifecycle review candidate. V4 remains immutable; v5
 * changes only thirteen one-tick Comp key-offs that otherwise cancel the
 * following same-key attacks in Standard MIDI playback.
 */
export const TAKE_FIVE_FULL_CURATION_CANDIDATE_V5 = defineVideoReplicaScore({
  schemaVersion: 1,
  id: 'take-five-video-full-curation-candidate-v5',
  replicaRevision: 'v5-comp-same-key-reattack-lifecycle-review',
  evidence: TAKE_FIVE_FULL_EVIDENCE,
  curationStatus: 'provisional',
  piano: { bank: 0, program: 0 },
  roleAssignments: roleAssignmentsV3,
  rejections: TAKE_FIVE_FULL_CURATION_REJECTIONS_V3,
  corrections: TAKE_FIVE_FULL_CURATION_CORRECTIONS_V5,
  gestures: TAKE_FIVE_FULL_CURATION_GESTURES_V3,
  durationPerformedTicks: 85_860,
});

/**
 * Independent full-video exception-review candidate. V5 remains immutable and
 * the product route remains on the historical baseline. This revision adds
 * only source-observed omissions, removes one false F#4 split and repairs six
 * opening note-off collisions; it moves no performed attack.
 */
export const TAKE_FIVE_FULL_CURATION_CANDIDATE_V6 = defineVideoReplicaScore({
  schemaVersion: 1,
  id: 'take-five-video-full-curation-candidate-v6',
  replicaRevision: 'v6-complete-video-exception-review',
  evidence: TAKE_FIVE_FULL_EVIDENCE,
  curationStatus: 'provisional',
  piano: { bank: 0, program: 0 },
  roleAssignments: roleAssignmentsV6,
  rejections: TAKE_FIVE_FULL_CURATION_REJECTIONS_V6,
  corrections: TAKE_FIVE_FULL_CURATION_CORRECTIONS_V6,
  additions: TAKE_FIVE_FULL_CURATION_ADDITIONS_V6,
  gestures: TAKE_FIVE_FULL_CURATION_GESTURES_V3,
  durationPerformedTicks: 85_860,
});

/**
 * Independent sub-frame E3 attack candidate. V6 and the 555-note product
 * baseline remain untouched; this revision changes only one source-observed
 * event from 76318/204 to 76273/249, preserving end tick 76522.
 */
export const TAKE_FIVE_FULL_CURATION_CANDIDATE_V7 = defineVideoReplicaScore({
  schemaVersion: 1,
  id: 'take-five-video-full-curation-candidate-v7',
  replicaRevision: 'v7-e3-hammer-onset-review',
  evidence: TAKE_FIVE_FULL_EVIDENCE,
  curationStatus: 'provisional',
  piano: { bank: 0, program: 0 },
  roleAssignments: roleAssignmentsV6,
  rejections: TAKE_FIVE_FULL_CURATION_REJECTIONS_V6,
  corrections: TAKE_FIVE_FULL_CURATION_CORRECTIONS_V6,
  additions: TAKE_FIVE_FULL_CURATION_ADDITIONS_V7,
  gestures: TAKE_FIVE_FULL_CURATION_GESTURES_V3,
  durationPerformedTicks: 85_860,
});
