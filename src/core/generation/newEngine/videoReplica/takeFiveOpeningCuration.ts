// ============================================================
// Take Five opening · visual/spectral curation candidate v2
// ------------------------------------------------------------
// Raw evidence remains immutable. These exclusions remove high-confidence
// detector harmonics for A/B review; the product baseline is not switched
// until the candidate receives user approval.
// ============================================================

import {
  defineVideoReplicaScore,
  type VideoReplicaEventCorrection,
  type VideoReplicaEvidenceRejection,
  type VideoReplicaGestureAnnotation,
  type VideoReplicaRoleAssignment,
} from './VideoReplicaScore';
import { TAKE_FIVE_OPENING_EVIDENCE } from './takeFiveOpeningReplica';

const UPPER_PARTIAL_FALSE_POSITIVE_IDS = [
  'lead-008', // 5763 F#5 duplicates F#3 +24
  'lead-012', // 5967 F#5 duplicates F#3 +24
  'lead-013', // 6301 F#5 residual upper partial
  'lead-016', // 7715 F#5 duplicates the nearby F#3 attack
  'lead-019', // 8384 E5 duplicates E4 +12
  'lead-022', // 9313 F#5 duplicates F#4 +12
  'lead-023', // 10801 F#5, outside the observed right-hand register
  'lead-029', // 11581 F#5 duplicates F#4 +12
  'lead-030', // 12101 F#5 residual upper partial
  'lead-033', // 14054 F#5, outside the observed right-hand register
  'lead-039', // 18644 G5 duplicates G4 +12
  'lead-050', // 21525 E5 duplicates E4 +12
  'lead-051', // 22958 F#5 duplicates the nearby F#4 attack
  'lead-057', // 23366 F#5 duplicates F#4 +12
  'lead-059', // 23905 E5 duplicates E4 +12
] as const;

export const TAKE_FIVE_OPENING_CURATION_REJECTIONS: readonly VideoReplicaEvidenceRejection[] = [
  ...UPPER_PARTIAL_FALSE_POSITIVE_IDS.map((evidenceId) => ({
    evidenceId,
    reason: 'upper-partial detector false positive outside the observed right-hand register',
    method: 'frame-by-frame-hand-position-plus-octave-pair-spectrum',
    status: 'provisional' as const,
  })),
  {
    evidenceId: 'bass-011', // tick2993 B3
    reason: 'B3 detector partial before the right-hand entrance; no matching physical key attack',
    method: 'frame-by-frame-hand-position-plus-source-spectrum',
    status: 'provisional',
  },
];

const rejected = new Set(TAKE_FIVE_OPENING_CURATION_REJECTIONS.map((item) => item.evidenceId));
const roleAssignments: VideoReplicaRoleAssignment[] = TAKE_FIVE_OPENING_EVIDENCE.events
  .filter((event) => event.disposition === 'kept' && !rejected.has(event.evidenceId))
  .map((event) => {
    if (!event.roleHint) throw new Error(`Opening evidence ${event.evidenceId} lacks its provisional role hint`);
    return {
      evidenceId: event.evidenceId,
      role: event.roleHint.role,
      method: event.roleHint.method,
      status: 'provisional',
    };
  });

export const TAKE_FIVE_OPENING_CURATION_CANDIDATE_V2 = defineVideoReplicaScore({
  schemaVersion: 1,
  id: 'take-five-video-opening-curation-candidate-v2',
  replicaRevision: 'v2-remove-confirmed-detector-harmonics',
  evidence: TAKE_FIVE_OPENING_EVIDENCE,
  curationStatus: 'provisional',
  piano: { bank: 0, program: 0 },
  roleAssignments,
  rejections: TAKE_FIVE_OPENING_CURATION_REJECTIONS,
  durationPerformedTicks: 24_945,
});

// Every B3 below is touched by the visually tracked right hand. Their old
// Bass labels were solely artifacts of the MIDI-60 register threshold.
export const TAKE_FIVE_OPENING_V3_RIGHT_HAND_LEAD_IDS = [
  'bass-028', 'bass-035', 'bass-036', 'bass-045', 'bass-047',
  'bass-054', 'bass-070', 'bass-079', 'bass-082', 'bass-091',
] as const;

const CONTINUATION_FRAGMENT_REJECTIONS: readonly VideoReplicaEvidenceRejection[] = [
  {
    evidenceId: 'lead-007',
    reason: 'same-key detector continuation at tick 4667; the C#5 finger never lifts or reattacks',
    method: 'consecutive-frame-hand-pose-plus-default-threshold-transcription',
    status: 'provisional',
  },
];

export const TAKE_FIVE_OPENING_V3_CORRECTIONS: readonly VideoReplicaEventCorrection[] = [
  {
    evidenceId: 'lead-006',
    performedDurationTicks: 781,
    reason: 'join one sounding C#5 activation through the detector-supported end tick 5243; exact key-off versus pedal or natural tail remains unresolved',
    method: 'consecutive-frame-hand-pose-plus-default-threshold-transcription',
    status: 'provisional',
  },
];

export const TAKE_FIVE_OPENING_V3_GESTURES: readonly VideoReplicaGestureAnnotation[] = [
  {
    id: 'opening-legato-cs5-4462-5243',
    kind: 'legato-continuation',
    evidenceIds: ['lead-006', 'lead-007'],
    reason: 'there is no second C#5 note-on at the detector split; the joined tail may include key hold, pedal or natural decay',
    method: 'consecutive-frame-hand-pose-plus-pitch-specific-attack-ratio',
    status: 'provisional',
  },
  {
    id: 'opening-reattack-fs3-5763-5967',
    kind: 'reattack',
    evidenceIds: ['bass-020', 'bass-021'],
    reason: 'the second F#3 has a new target-frequency attack and a renewed left-hand key depression',
    method: 'consecutive-frame-hand-pose-plus-pitch-specific-attack-ratio',
    status: 'provisional',
  },
  {
    id: 'opening-reattack-fs3-7697-8161',
    kind: 'reattack',
    evidenceIds: ['bass-030', 'bass-031', 'bass-033'],
    reason: 'three independently supported F#3 attacks; bass-033 is the clearest final reattack',
    method: 'source-onset-oracle-plus-pitch-specific-attack-ratio',
    status: 'provisional',
  },
  {
    id: 'opening-reattack-d4-10819-11117',
    kind: 'reattack',
    evidenceIds: ['lead-024', 'lead-026'],
    reason: 'the second D4 has an independent target attack with the new F#4 gesture',
    method: 'consecutive-frame-hand-pose-plus-pitch-specific-attack-ratio',
    status: 'provisional',
  },
  {
    id: 'opening-reattack-d4-13327-13608',
    kind: 'reattack',
    evidenceIds: ['lead-031', 'lead-032'],
    reason: 'the second D4 has a renewed target attack aligned with the new G3 gesture',
    method: 'source-onset-oracle-plus-pitch-specific-attack-ratio',
    status: 'provisional',
  },
  {
    id: 'opening-roll-9276-9424',
    kind: 'micro-roll',
    evidenceIds: ['bass-041', 'bass-042', 'lead-020', 'bass-043', 'lead-021', 'bass-044', 'bass-045'],
    reason: 'visible staged piano roll spanning the retained attacks at ticks 9276 through 9424',
    method: 'frame-by-frame-video-plus-source-onset-sequence',
    status: 'provisional',
  },
  {
    id: 'opening-roll-14072-14109',
    kind: 'micro-roll',
    evidenceIds: ['lead-034', 'bass-064', 'lead-035', 'bass-065'],
    reason: 'visible 37-tick staged voicing; individual performed onsets must remain unsnapped',
    method: 'frame-by-frame-video-plus-source-onset-sequence',
    status: 'provisional',
  },
  {
    id: 'opening-roll-21525-21562',
    kind: 'micro-roll',
    evidenceIds: ['bass-093', 'lead-049', 'bass-094'],
    reason: 'visible staggered E-register entrance across ticks 21525 and 21562',
    method: 'frame-by-frame-video-plus-source-onset-sequence',
    status: 'provisional',
  },
];

export const TAKE_FIVE_OPENING_V3_REJECTIONS = [
  ...TAKE_FIVE_OPENING_CURATION_REJECTIONS,
  ...CONTINUATION_FRAGMENT_REJECTIONS,
] as const;
const v3RejectedIds = new Set(TAKE_FIVE_OPENING_V3_REJECTIONS.map((item) => item.evidenceId));
const v3RightHandIds = new Set<string>(TAKE_FIVE_OPENING_V3_RIGHT_HAND_LEAD_IDS);
const v3Assignments: VideoReplicaRoleAssignment[] = TAKE_FIVE_OPENING_EVIDENCE.events
  .filter((event) => event.disposition === 'kept' && !v3RejectedIds.has(event.evidenceId))
  .map((event) => {
    if (!event.roleHint) throw new Error(`Opening evidence ${event.evidenceId} lacks its provisional role hint`);
    const isReviewedRightHand = v3RightHandIds.has(event.evidenceId);
    return {
      evidenceId: event.evidenceId,
      role: isReviewedRightHand ? 'lead' : event.roleHint.role,
      method: isReviewedRightHand ? 'frame-by-frame-hand-pose-key-coordinate' : event.roleHint.method,
      status: 'provisional',
    };
  });

/**
 * A/B candidate v3: v2 pitch cleanup plus reviewed B3 hand ownership,
 * continuous-note joins and explicit rolls. It is not the product baseline.
 */
export const TAKE_FIVE_OPENING_CURATION_CANDIDATE_V3 = defineVideoReplicaScore({
  schemaVersion: 1,
  id: 'take-five-video-opening-curation-candidate-v3',
  replicaRevision: 'v3-hand-role-continuations-and-rolls',
  evidence: TAKE_FIVE_OPENING_EVIDENCE,
  curationStatus: 'provisional',
  piano: { bank: 0, program: 0 },
  roleAssignments: v3Assignments,
  rejections: TAKE_FIVE_OPENING_V3_REJECTIONS,
  corrections: TAKE_FIVE_OPENING_V3_CORRECTIONS,
  gestures: TAKE_FIVE_OPENING_V3_GESTURES,
  durationPerformedTicks: 24_945,
});
