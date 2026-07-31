// ============================================================
// newEngine · arranger · LeadScorePlan core
// ------------------------------------------------------------
// A small, style-neutral continuity contract for lead score planners.
// It deliberately contains no MIDI, pedal, grammar expansion or concrete
// pitch selection: the Arranger proves the time/harmony boundary contract,
// then a style scheduler chooses material inside that contract.
// ============================================================

/** Stable harmonic functions a score may require at a landing. */
export type LeadStableRole = 'root' | 'third' | 'fifth' | 'seventh';

/** The two boundary outcomes every style may safely share. */
export type LeadContinuityBoundaryBridgeKind =
  | 'common-tone'
  | 'release-at-boundary';

/**
 * A boundary permission is authored against exact harmonic-span identities.
 * `continuationPcs` is omitted for an explicit release; a scheduler must not
 * infer a cross-harmony continuation that is not written here.
 */
export interface LeadContinuityBoundaryBridge<
  TKind extends string = LeadContinuityBoundaryBridgeKind,
> {
  readonly kind: TKind;
  readonly targetSpanId?: string;
  readonly continuationPcs?: readonly number[];
}

/** Read-only RoadMap provenance carried by a score slot. */
export interface LeadScoreRoadMapBinding {
  readonly brickIndices: readonly number[];
  readonly brickFamilies: readonly string[];
  readonly brickNames: readonly string[];
}

/**
 * The common part of a phrase × harmonic-segment lead contract.
 *
 * `minimumWrittenDurationBeats` applies only when an exposed single event is
 * selected. A scheduler can preserve an explicitly connected short gesture,
 * but it must otherwise write a carrier of at least this duration or select
 * the explicit release bridge. This avoids treating a later NoteIR gate as a
 * composition decision.
 */
export interface LeadContinuitySlotCore<
  TShortGestureClass extends string = string,
  TBridgeKind extends string = LeadContinuityBoundaryBridgeKind,
> {
  readonly id: string;
  readonly phraseId: string;
  readonly sourceSpanId: string;
  readonly startBeat: number;
  readonly endBeat: number;
  readonly exposedGapBeats: number;
  readonly minimumWrittenDurationBeats: number;
  readonly releaseGuardBeats: number;
  readonly reentryGuardBeats: number;
  readonly maxOnsetNudgeBeats: number;
  readonly allowedShortGestureClasses: readonly TShortGestureClass[];
  /** No short class is legal as an unconnected terminal fragment. */
  readonly shortGestureMustResolve: boolean;
  readonly harmonicScope: 'current-chord';
  readonly stableRoles: readonly LeadStableRole[];
  readonly boundaryBridges: readonly LeadContinuityBoundaryBridge<TBridgeKind>[];
}
