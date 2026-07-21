// ============================================================
// newEngine · videoReplica · evidence-led fixed performance
// ------------------------------------------------------------
// Dependency direction:
//   immutable video evidence -> curated role score -> MusicalIR
//                           \-> analysis sidecars (Groove/Harmony/Form)
// Analysis is deliberately absent from the compiler input, so it cannot
// quantize, regenerate or otherwise rewrite a performed event.
// ============================================================

import {
  beats,
  createTimebase,
  deepFreeze,
  midi,
  ticks,
  type DeepReadonly,
} from '../foundation';
import { freezeMusicalIR, type MusicalIR } from '../ir/MusicalIR';

export type VideoReplicaRole = 'bass' | 'comp' | 'lead';
export type VideoReplicaCurationStatus = 'provisional' | 'confirmed';

export interface VideoReplicaSourceManifest {
  schemaVersion: 1;
  videoSha256: string;
  videoByteLength: number;
  /** Extractor's absolute source-video anchor for performed tick zero; A/B fitting may annotate a refined alignment separately. */
  tickZeroAtVideoSeconds: number;
  ppq: number;
  bpm: number;
  meter: { numerator: number; denominator: number };
}

export interface VideoReplicaRoleHint {
  role: VideoReplicaRole;
  method: string;
  status: 'unverified';
}

export interface VideoReplicaEvidenceEventInput {
  evidenceId: string;
  sourceRow: number;
  performedStartTick: number;
  performedDurationTicks: number;
  midi: number;
  velocity: number;
  roleHint?: VideoReplicaRoleHint;
  disposition: 'kept' | 'rejected' | 'needs-review';
}

export interface VideoReplicaEvidenceEvent extends VideoReplicaEvidenceEventInput {
  strikeGroupId: string;
}

export interface VideoReplicaStrikeGroup {
  id: string;
  anchorTick: number;
  spreadTicks: number;
  evidenceIds: readonly string[];
  interpretation: 'unreviewed' | 'simultaneous' | 'micro-roll';
}

export interface VideoReplicaEvidenceSetInput {
  id: string;
  detectorRevision: string;
  sourceArtifactSha256: string;
  source: VideoReplicaSourceManifest;
  /** Fixed-anchor grouping window. Individual onsets are never moved. */
  strikeGroupingToleranceTicks: number;
  events: readonly VideoReplicaEvidenceEventInput[];
}

export interface VideoReplicaEvidenceSetData {
  id: string;
  detectorRevision: string;
  sourceArtifactSha256: string;
  source: VideoReplicaSourceManifest;
  strikeGroupingToleranceTicks: number;
  durationPerformedTicks: number;
  events: readonly VideoReplicaEvidenceEvent[];
  strikeGroups: readonly VideoReplicaStrikeGroup[];
}

export type VideoReplicaEvidenceSet = DeepReadonly<VideoReplicaEvidenceSetData>;

export interface VideoReplicaRoleAssignment {
  evidenceId: string;
  role: VideoReplicaRole;
  method: string;
  status: VideoReplicaCurationStatus;
}

export interface VideoReplicaEvidenceRejection {
  evidenceId: string;
  reason: string;
  method: string;
  status: VideoReplicaCurationStatus;
}

export interface VideoReplicaEventCorrection {
  evidenceId: string;
  performedStartTick?: number;
  performedDurationTicks?: number;
  midi?: number;
  velocity?: number;
  reason: string;
  method: string;
  status: VideoReplicaCurationStatus;
}

/**
 * A reviewed relationship between detector events. This is score metadata,
 * not a renderer instruction: every performed onset remains controlled only
 * by the included evidence event and its explicit correction, if any.
 */
export interface VideoReplicaGestureAnnotation {
  id: string;
  kind: 'simultaneous-strike' | 'micro-roll' | 'legato-continuation' | 'reattack';
  /** Ordered physical evidence members; rejected continuation fragments may remain referenced. */
  evidenceIds: readonly string[];
  reason: string;
  method: string;
  status: VideoReplicaCurationStatus;
}

interface VideoReplicaScoreNoteBase {
  eventId: string;
  role: VideoReplicaRole;
  performedStartTick: number;
  performedDurationTicks: number;
  midi: number;
  velocity: number;
  assignmentMethod: string;
  assignmentStatus: VideoReplicaCurationStatus;
}

export interface VideoReplicaEvidenceScoreNote extends VideoReplicaScoreNoteBase {
  origin: 'evidence';
  evidenceId: string;
  strikeGroupId: string;
  correction?: VideoReplicaEventCorrection;
}

/**
 * A note absent from detector output but positively observed in the source.
 * It is deliberately separate from corrections so a missing note is never
 * disguised as a pitch edit to an unrelated detector event.
 */
export interface VideoReplicaCuratedNoteAddition {
  observationId: string;
  role: VideoReplicaRole;
  performedStartTick: number;
  performedDurationTicks: number;
  midi: number;
  velocity: number;
  sourceVideoWindowSeconds: readonly [number, number];
  relatedEvidenceIds?: readonly string[];
  relatedStrikeGroupId?: string;
  reason: string;
  method: string;
  status: VideoReplicaCurationStatus;
}

export interface VideoReplicaObservedScoreNote extends VideoReplicaScoreNoteBase {
  origin: 'curated-observation';
  observationId: string;
  sourceVideoWindowSeconds: readonly [number, number];
  relatedEvidenceIds: readonly string[];
  relatedStrikeGroupId?: string;
}

export type VideoReplicaScoreNote = VideoReplicaEvidenceScoreNote | VideoReplicaObservedScoreNote;

export interface VideoReplicaScoreInput {
  schemaVersion: 1;
  id: string;
  replicaRevision: string;
  evidence: VideoReplicaEvidenceSet;
  curationStatus: VideoReplicaCurationStatus;
  piano: { bank: number; program: number };
  roleAssignments: readonly VideoReplicaRoleAssignment[];
  /** Curatorial exclusions remain traceable to immutable evidence IDs. */
  rejections?: readonly VideoReplicaEvidenceRejection[];
  /** Reviewed corrections produce score facts while raw evidence stays intact. */
  corrections?: readonly VideoReplicaEventCorrection[];
  /** Positive source observations for notes the detector omitted. */
  additions?: readonly VideoReplicaCuratedNoteAddition[];
  /** Reviewed gesture semantics are annotation-only and cannot rewrite notes. */
  gestures?: readonly VideoReplicaGestureAnnotation[];
  /** May be any performed tick; a video replica need not end on a barline. */
  durationPerformedTicks?: number;
}

export interface VideoReplicaScoreData {
  schemaVersion: 1;
  id: string;
  replicaRevision: string;
  sourceEvidenceId: string;
  /** Immutable detector artifact identity copied from the evidence set. */
  sourceEvidenceArtifactSha256: string;
  /** Immutable detector/build revision copied from the evidence set. */
  sourceEvidenceDetectorRevision: string;
  source: VideoReplicaSourceManifest;
  curationStatus: VideoReplicaCurationStatus;
  piano: { bank: number; program: number };
  durationPerformedTicks: number;
  notes: readonly VideoReplicaScoreNote[];
  rejections: readonly VideoReplicaEvidenceRejection[];
  corrections: readonly VideoReplicaEventCorrection[];
  additions: readonly VideoReplicaCuratedNoteAddition[];
  gestures: readonly VideoReplicaGestureAnnotation[];
  tracks: Readonly<Record<VideoReplicaRole, readonly VideoReplicaScoreNote[]>>;
}

export type VideoReplicaScore = DeepReadonly<VideoReplicaScoreData>;

/**
 * A Standard MIDI channel cannot identify which same-pitch note instance an
 * off event belongs to. If an earlier key-off lands after a later reattack,
 * that off can silence the new attack. This audit reports the score facts; it
 * never clips, quantizes or otherwise mutates the fixed performance.
 */
export interface VideoReplicaSameKeyReattackCollision {
  role: VideoReplicaRole;
  midi: number;
  previousEventId: string;
  nextEventId: string;
  previousStartTick: number;
  previousOffTick: number;
  nextOnTick: number;
  overlapTicks: number;
}

export interface VideoReplicaTickWindow {
  startTickInclusive: number;
  endTickExclusive: number;
}

export interface CompiledVideoReplica {
  score: VideoReplicaScore;
  ir: MusicalIR;
  eventIndex: Readonly<Record<string, {
    role: VideoReplicaRole;
    trackIndex: number;
    noteIndex: number;
  }>>;
}

function assertInteger(name: string, value: number, min = 0): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} must be an integer >= ${min}; got ${value}`);
  }
}

function assertSource(source: VideoReplicaSourceManifest): void {
  if (source.schemaVersion !== 1) throw new RangeError(`Unsupported VideoReplica source schema ${source.schemaVersion}`);
  if (!/^[a-f\d]{64}$/u.test(source.videoSha256)) throw new RangeError('VideoReplica videoSha256 must be lowercase SHA-256');
  assertInteger('source.videoByteLength', source.videoByteLength, 1);
  if (!Number.isFinite(source.tickZeroAtVideoSeconds) || source.tickZeroAtVideoSeconds < 0) {
    throw new RangeError('VideoReplica tickZeroAtVideoSeconds must be finite and non-negative');
  }
  assertInteger('source.ppq', source.ppq, 1);
  if (!Number.isFinite(source.bpm) || source.bpm <= 0) throw new RangeError(`Invalid VideoReplica BPM ${source.bpm}`);
  assertInteger('source.meter.numerator', source.meter.numerator, 1);
  assertInteger('source.meter.denominator', source.meter.denominator, 1);
}

function assertEvidenceEvent(event: VideoReplicaEvidenceEventInput): void {
  assertInteger(`${event.evidenceId}.sourceRow`, event.sourceRow);
  assertInteger(`${event.evidenceId}.performedStartTick`, event.performedStartTick);
  assertInteger(`${event.evidenceId}.performedDurationTicks`, event.performedDurationTicks, 1);
  assertInteger(`${event.evidenceId}.midi`, event.midi);
  assertInteger(`${event.evidenceId}.velocity`, event.velocity, 1);
  if (event.midi > 127 || event.velocity > 127) throw new RangeError(`Evidence event ${event.evidenceId} exceeds MIDI range`);
}

/**
 * Build physical strike groups with a fixed anchor. This avoids single-link
 * chaining while retaining every original onset inside the group.
 */
function groupEvidenceEvents(
  events: readonly VideoReplicaEvidenceEventInput[],
  toleranceTicks: number,
): { events: VideoReplicaEvidenceEvent[]; strikeGroups: VideoReplicaStrikeGroup[] } {
  const mutableGroups: Array<{ id: string; anchorTick: number; eventIndexes: number[] }> = [];
  const groupByEventIndex = new Map<number, string>();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    let group = mutableGroups[mutableGroups.length - 1];
    if (!group || event.performedStartTick - group.anchorTick > toleranceTicks) {
      group = {
        id: `strike-${String(mutableGroups.length + 1).padStart(3, '0')}`,
        anchorTick: event.performedStartTick,
        eventIndexes: [],
      };
      mutableGroups.push(group);
    }
    group.eventIndexes.push(index);
    groupByEventIndex.set(index, group.id);
  }
  const groupedEvents = events.map((event, index): VideoReplicaEvidenceEvent => ({
    ...event,
    strikeGroupId: groupByEventIndex.get(index)!,
  }));
  const strikeGroups = mutableGroups.map((group): VideoReplicaStrikeGroup => {
    const members = group.eventIndexes.map((index) => groupedEvents[index]!);
    const spreadTicks = Math.max(...members.map((event) => event.performedStartTick)) - group.anchorTick;
    return {
      id: group.id,
      anchorTick: group.anchorTick,
      spreadTicks,
      evidenceIds: members.map((event) => event.evidenceId),
      interpretation: 'unreviewed',
    };
  });
  return { events: groupedEvents, strikeGroups };
}

/** Define immutable detector/curation evidence without assigning functional roles. */
export function defineVideoReplicaEvidenceSet(input: VideoReplicaEvidenceSetInput): VideoReplicaEvidenceSet {
  assertSource(input.source);
  assertInteger('strikeGroupingToleranceTicks', input.strikeGroupingToleranceTicks, 1);
  if (!/^[a-f\d]{64}$/u.test(input.sourceArtifactSha256)) {
    throw new RangeError('VideoReplica sourceArtifactSha256 must be lowercase SHA-256');
  }
  const ids = new Set<string>();
  const rows = new Set<number>();
  let previousStart = -1;
  for (const event of input.events) {
    if (ids.has(event.evidenceId)) throw new RangeError(`Duplicate evidence id ${event.evidenceId}`);
    if (rows.has(event.sourceRow)) throw new RangeError(`Duplicate evidence source row ${event.sourceRow}`);
    ids.add(event.evidenceId);
    rows.add(event.sourceRow);
    assertEvidenceEvent(event);
    if (event.performedStartTick < previousStart) {
      throw new RangeError('VideoReplica evidence must retain chronological source order');
    }
    previousStart = event.performedStartTick;
  }
  const { events, strikeGroups } = groupEvidenceEvents(input.events, input.strikeGroupingToleranceTicks);
  const durationPerformedTicks = Math.max(0, ...events
    .filter((event) => event.disposition !== 'rejected')
    .map((event) => event.performedStartTick + event.performedDurationTicks));
  return deepFreeze({
    id: input.id,
    detectorRevision: input.detectorRevision,
    sourceArtifactSha256: input.sourceArtifactSha256,
    source: input.source,
    strikeGroupingToleranceTicks: input.strikeGroupingToleranceTicks,
    durationPerformedTicks,
    events,
    strikeGroups,
  });
}

/** Resolve curated functional roles while copying all performed facts from evidence. */
export function defineVideoReplicaScore(input: VideoReplicaScoreInput): VideoReplicaScore {
  if (input.schemaVersion !== 1) throw new RangeError(`Unsupported VideoReplica score schema ${input.schemaVersion}`);
  const assignmentByEvidenceId = new Map<string, VideoReplicaRoleAssignment>();
  for (const assignment of input.roleAssignments) {
    if (assignmentByEvidenceId.has(assignment.evidenceId)) {
      throw new RangeError(`Duplicate role assignment ${assignment.evidenceId}`);
    }
    assignmentByEvidenceId.set(assignment.evidenceId, assignment);
  }
  const rejectionByEvidenceId = new Map<string, VideoReplicaEvidenceRejection>();
  for (const rejection of input.rejections ?? []) {
    if (rejectionByEvidenceId.has(rejection.evidenceId)) {
      throw new RangeError(`Duplicate evidence rejection ${rejection.evidenceId}`);
    }
    if (assignmentByEvidenceId.has(rejection.evidenceId)) {
      throw new RangeError(`Evidence ${rejection.evidenceId} cannot be both assigned and rejected`);
    }
    rejectionByEvidenceId.set(rejection.evidenceId, rejection);
  }
  const correctionByEvidenceId = new Map<string, VideoReplicaEventCorrection>();
  for (const correction of input.corrections ?? []) {
    if (correctionByEvidenceId.has(correction.evidenceId)) {
      throw new RangeError(`Duplicate event correction ${correction.evidenceId}`);
    }
    if (rejectionByEvidenceId.has(correction.evidenceId)) {
      throw new RangeError(`Rejected evidence ${correction.evidenceId} cannot also be corrected`);
    }
    if (
      correction.performedStartTick === undefined
      && correction.performedDurationTicks === undefined
      && correction.midi === undefined
      && correction.velocity === undefined
    ) {
      throw new RangeError(`Event correction ${correction.evidenceId} changes no performed fact`);
    }
    correctionByEvidenceId.set(correction.evidenceId, correction);
  }
  const kept = input.evidence.events.filter((event) => event.disposition === 'kept');
  if (assignmentByEvidenceId.size + rejectionByEvidenceId.size !== kept.length) {
    throw new RangeError(`Assignments plus rejections must cover all ${kept.length} kept evidence events exactly`);
  }
  const evidenceNotes = kept.filter((event) => !rejectionByEvidenceId.has(event.evidenceId)).map((event): VideoReplicaEvidenceScoreNote => {
    const assignment = assignmentByEvidenceId.get(event.evidenceId);
    if (!assignment) throw new RangeError(`Missing role assignment ${event.evidenceId}`);
    if (input.curationStatus === 'confirmed' && assignment.status !== 'confirmed') {
      throw new RangeError(`Confirmed score contains provisional assignment ${event.evidenceId}`);
    }
    const correction = correctionByEvidenceId.get(event.evidenceId);
    if (correction && input.curationStatus === 'confirmed' && correction.status !== 'confirmed') {
      throw new RangeError(`Confirmed score contains provisional correction ${event.evidenceId}`);
    }
    const performedStartTick = correction?.performedStartTick ?? event.performedStartTick;
    const performedDurationTicks = correction?.performedDurationTicks ?? event.performedDurationTicks;
    const correctedMidi = correction?.midi ?? event.midi;
    const correctedVelocity = correction?.velocity ?? event.velocity;
    assertInteger(`${event.evidenceId}.scoreStartTick`, performedStartTick);
    assertInteger(`${event.evidenceId}.scoreDurationTicks`, performedDurationTicks, 1);
    assertInteger(`${event.evidenceId}.scoreMidi`, correctedMidi);
    assertInteger(`${event.evidenceId}.scoreVelocity`, correctedVelocity, 1);
    if (correctedMidi > 127 || correctedVelocity > 127) {
      throw new RangeError(`Corrected score event ${event.evidenceId} exceeds MIDI range`);
    }
    return {
      origin: 'evidence',
      eventId: event.evidenceId,
      evidenceId: event.evidenceId,
      strikeGroupId: event.strikeGroupId,
      role: assignment.role,
      performedStartTick,
      performedDurationTicks,
      midi: correctedMidi,
      velocity: correctedVelocity,
      assignmentMethod: assignment.method,
      assignmentStatus: assignment.status,
      ...(correction ? { correction } : {}),
    };
  });
  for (const evidenceId of assignmentByEvidenceId.keys()) {
    if (!kept.some((event) => event.evidenceId === evidenceId)) {
      throw new RangeError(`Role assignment references non-kept evidence ${evidenceId}`);
    }
  }
  for (const [evidenceId, rejection] of rejectionByEvidenceId) {
    if (!kept.some((event) => event.evidenceId === evidenceId)) {
      throw new RangeError(`Rejection references non-kept evidence ${evidenceId}`);
    }
    if (input.curationStatus === 'confirmed' && rejection.status !== 'confirmed') {
      throw new RangeError(`Confirmed score contains provisional rejection ${evidenceId}`);
    }
  }
  for (const evidenceId of correctionByEvidenceId.keys()) {
    if (!assignmentByEvidenceId.has(evidenceId)) {
      throw new RangeError(`Correction requires an included role assignment for ${evidenceId}`);
    }
  }
  const evidenceById = new Map(input.evidence.events.map((event) => [event.evidenceId, event]));
  const strikeGroupIds = new Set(input.evidence.strikeGroups.map((group) => group.id));
  const additionIds = new Set<string>();
  const additions = (input.additions ?? []).map((addition): VideoReplicaCuratedNoteAddition => {
    if (!addition.observationId.trim()) throw new RangeError('VideoReplica observation id must not be empty');
    if (evidenceById.has(addition.observationId)) {
      throw new RangeError(`Observation id ${addition.observationId} collides with raw evidence`);
    }
    if (additionIds.has(addition.observationId)) {
      throw new RangeError(`Duplicate note observation ${addition.observationId}`);
    }
    additionIds.add(addition.observationId);
    assertInteger(`${addition.observationId}.performedStartTick`, addition.performedStartTick);
    assertInteger(`${addition.observationId}.performedDurationTicks`, addition.performedDurationTicks, 1);
    assertInteger(`${addition.observationId}.midi`, addition.midi);
    assertInteger(`${addition.observationId}.velocity`, addition.velocity, 1);
    if (addition.midi > 127 || addition.velocity > 127) {
      throw new RangeError(`Observed score event ${addition.observationId} exceeds MIDI range`);
    }
    const [windowStart, windowEnd] = addition.sourceVideoWindowSeconds;
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowStart < 0 || windowEnd < windowStart) {
      throw new RangeError(`Observation ${addition.observationId} has an invalid source-video window`);
    }
    const relatedEvidenceIds = [...(addition.relatedEvidenceIds ?? [])];
    const relatedIds = new Set<string>();
    for (const evidenceId of relatedEvidenceIds) {
      if (relatedIds.has(evidenceId)) {
        throw new RangeError(`Observation ${addition.observationId} repeats related evidence ${evidenceId}`);
      }
      relatedIds.add(evidenceId);
      if (!evidenceById.has(evidenceId)) {
        throw new RangeError(`Observation ${addition.observationId} references unknown evidence ${evidenceId}`);
      }
    }
    if (addition.relatedStrikeGroupId && !strikeGroupIds.has(addition.relatedStrikeGroupId)) {
      throw new RangeError(`Observation ${addition.observationId} references unknown strike group ${addition.relatedStrikeGroupId}`);
    }
    if (input.curationStatus === 'confirmed' && addition.status !== 'confirmed') {
      throw new RangeError(`Confirmed score contains provisional observation ${addition.observationId}`);
    }
    return {
      ...addition,
      sourceVideoWindowSeconds: [windowStart, windowEnd],
      relatedEvidenceIds,
    };
  });
  const additionNotes: VideoReplicaObservedScoreNote[] = additions.map((addition) => ({
    origin: 'curated-observation',
    eventId: addition.observationId,
    observationId: addition.observationId,
    role: addition.role,
    performedStartTick: addition.performedStartTick,
    performedDurationTicks: addition.performedDurationTicks,
    midi: addition.midi,
    velocity: addition.velocity,
    assignmentMethod: addition.method,
    assignmentStatus: addition.status,
    sourceVideoWindowSeconds: addition.sourceVideoWindowSeconds,
    relatedEvidenceIds: addition.relatedEvidenceIds ?? [],
    ...(addition.relatedStrikeGroupId ? { relatedStrikeGroupId: addition.relatedStrikeGroupId } : {}),
  }));
  // Modern JS sort is stable, so existing evidence ordering stays byte-for-byte
  // unchanged when a score has no additions; observations are inserted by time.
  const notes: VideoReplicaScoreNote[] = [...evidenceNotes, ...additionNotes]
    .sort((left, right) => left.performedStartTick - right.performedStartTick);
  const gestureIds = new Set<string>();
  const gestures = (input.gestures ?? []).map((gesture): VideoReplicaGestureAnnotation => {
    if (!gesture.id.trim()) throw new RangeError('VideoReplica gesture id must not be empty');
    if (gestureIds.has(gesture.id)) throw new RangeError(`Duplicate gesture id ${gesture.id}`);
    gestureIds.add(gesture.id);
    if (gesture.evidenceIds.length < 2) {
      throw new RangeError(`Gesture ${gesture.id} must reference at least two evidence events`);
    }
    const memberIds = new Set<string>();
    let previousStart = -1;
    for (const evidenceId of gesture.evidenceIds) {
      if (memberIds.has(evidenceId)) {
        throw new RangeError(`Gesture ${gesture.id} repeats evidence ${evidenceId}`);
      }
      memberIds.add(evidenceId);
      const event = evidenceById.get(evidenceId);
      if (!event) throw new RangeError(`Gesture ${gesture.id} references unknown evidence ${evidenceId}`);
      if (event.performedStartTick < previousStart) {
        throw new RangeError(`Gesture ${gesture.id} evidence must be ordered by performed onset`);
      }
      previousStart = event.performedStartTick;
    }
    if (input.curationStatus === 'confirmed' && gesture.status !== 'confirmed') {
      throw new RangeError(`Confirmed score contains provisional gesture ${gesture.id}`);
    }
    return { ...gesture, evidenceIds: [...gesture.evidenceIds] };
  });
  const minimumDuration = Math.max(0, ...notes.map((note) => note.performedStartTick + note.performedDurationTicks));
  const durationPerformedTicks = input.durationPerformedTicks ?? minimumDuration;
  assertInteger('durationPerformedTicks', durationPerformedTicks, minimumDuration);
  const tracks = {
    bass: notes.filter((note) => note.role === 'bass'),
    comp: notes.filter((note) => note.role === 'comp'),
    lead: notes.filter((note) => note.role === 'lead'),
  };
  for (const [role, roleNotes] of Object.entries(tracks)) {
    for (let index = 1; index < roleNotes.length; index += 1) {
      if (roleNotes[index]!.performedStartTick < roleNotes[index - 1]!.performedStartTick) {
        throw new RangeError(`Corrections leave ${role} score events out of chronological order`);
      }
    }
  }
  return deepFreeze({
    schemaVersion: 1 as const,
    id: input.id,
    replicaRevision: input.replicaRevision,
    sourceEvidenceId: input.evidence.id,
    sourceEvidenceArtifactSha256: input.evidence.sourceArtifactSha256,
    sourceEvidenceDetectorRevision: input.evidence.detectorRevision,
    source: input.evidence.source,
    curationStatus: input.curationStatus,
    piano: input.piano,
    durationPerformedTicks,
    notes,
    rejections: [...rejectionByEvidenceId.values()],
    corrections: [...correctionByEvidenceId.values()],
    additions,
    gestures,
    tracks,
  });
}

/**
 * Exact 1:1 projection. No Groove, grid, Harmony, renderer or RNG is accepted
 * by this API, and performed event fields pass through unchanged.
 */
export function compileVideoReplicaScore(score: VideoReplicaScore): CompiledVideoReplica {
  const timebase = createTimebase({
    ppq: score.source.ppq,
    meter: score.source.meter,
    tempoMap: [{ atBeat: beats(0), bpm: score.source.bpm }],
  });
  const roles = ['bass', 'comp', 'lead'] as const;
  const eventIndex: Record<string, { role: VideoReplicaRole; trackIndex: number; noteIndex: number }> = {};
  const tracks = roles.map((role, trackIndex) => ({
    role,
    bank: score.piano.bank,
    program: score.piano.program,
    notes: score.tracks[role].map((note, noteIndex) => {
      eventIndex[note.eventId] = { role, trackIndex, noteIndex };
      return {
        pitch: midi(note.midi),
        startTick: ticks(note.performedStartTick),
        durationTicks: ticks(note.performedDurationTicks),
        velocity: note.velocity,
      };
    }),
  }));
  const ir = freezeMusicalIR({
    tracks,
    timebase,
    durationTicks: ticks(score.durationPerformedTicks),
  });
  return deepFreeze({ score, ir, eventIndex });
}

/**
 * Find same-role/same-key overlaps whose old note-off would arrive after a
 * newer note-on on the same MIDI channel. The optional window is keyed to the
 * newer attack, which is the event at risk of being swallowed.
 */
export function findVideoReplicaSameKeyReattackCollisions(
  score: VideoReplicaScore,
  window?: VideoReplicaTickWindow,
): readonly VideoReplicaSameKeyReattackCollision[] {
  if (window) {
    assertInteger('window.startTickInclusive', window.startTickInclusive);
    assertInteger('window.endTickExclusive', window.endTickExclusive, window.startTickInclusive + 1);
  }
  const collisions: VideoReplicaSameKeyReattackCollision[] = [];
  for (const role of ['bass', 'comp', 'lead'] as const) {
    const byMidi = new Map<number, Array<VideoReplicaScore['notes'][number]>>();
    for (const note of score.tracks[role]) {
      const notes = byMidi.get(note.midi) ?? [];
      notes.push(note);
      byMidi.set(note.midi, notes);
    }
    for (const [midiValue, notes] of byMidi) {
      const chronological = [...notes].sort((left, right) => (
        left.performedStartTick - right.performedStartTick
        || left.eventId.localeCompare(right.eventId)
      ));
      for (let nextIndex = 1; nextIndex < chronological.length; nextIndex += 1) {
        const next = chronological[nextIndex]!;
        if (
          window
          && (next.performedStartTick < window.startTickInclusive
            || next.performedStartTick >= window.endTickExclusive)
        ) continue;
        for (let previousIndex = 0; previousIndex < nextIndex; previousIndex += 1) {
          const previous = chronological[previousIndex]!;
          const previousOffTick = previous.performedStartTick + previous.performedDurationTicks;
          if (previousOffTick <= next.performedStartTick) continue;
          collisions.push({
            role,
            midi: midiValue,
            previousEventId: previous.eventId,
            nextEventId: next.eventId,
            previousStartTick: previous.performedStartTick,
            previousOffTick,
            nextOnTick: next.performedStartTick,
            overlapTicks: previousOffTick - next.performedStartTick,
          });
        }
      }
    }
  }
  return deepFreeze(collisions.sort((left, right) => (
    left.nextOnTick - right.nextOnTick
    || left.role.localeCompare(right.role)
    || left.midi - right.midi
    || left.previousEventId.localeCompare(right.previousEventId)
  )));
}

/** Fail an export/approval gate without silently changing score semantics. */
export function assertNoVideoReplicaSameKeyReattackCollisions(
  score: VideoReplicaScore,
  window?: VideoReplicaTickWindow,
): void {
  const collisions = findVideoReplicaSameKeyReattackCollisions(score, window);
  if (!collisions.length) return;
  const facts = collisions.map((collision) => (
    `${collision.role}:${collision.midi} ${collision.previousEventId}`
    + ` off@${collision.previousOffTick} after ${collision.nextEventId}`
    + ` on@${collision.nextOnTick}`
  )).join('; ');
  throw new RangeError(`VideoReplica contains same-key MIDI reattack collisions: ${facts}`);
}

export function videoSecondsAtPerformedTick(source: VideoReplicaSourceManifest, performedTick: number): number {
  return source.tickZeroAtVideoSeconds + performedTick / source.ppq * 60 / source.bpm;
}
