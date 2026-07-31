// ============================================================
// newEngine · arranger · ACG PianoScorePlan
// ------------------------------------------------------------
// ACG PIANOSONG 的钢琴不是由 renderer 临时挑一条 texture 后再补救，而是
// Arranger 在和声、乐句、RoadMap 已确定后写出的 phrase score。它一次下发
// lead / comp / bass 的句法；renderer 只把合法和弦音实化为 NoteIR。
// ============================================================

import type { ArrangementPlan, GrooveBarScore, Phrase, Section } from './ArrangementPlan';
import {
  acgPianoArrangementProfileForId,
  type AcgPianoArrangementProfileId,
} from './acgPianoArrangementProfiles';
import { phraseStartBeats } from './phraseTiming';
import type { HarmonicFunction, HarmonicPlan } from '../harmony/HarmonicPlan';
import {
  ACG_PIANO_REST_CONTINUITY_KNOWLEDGE,
  resolveAcgPianoContinuityRule,
  resolveAcgPianoLeadContinuityProfile,
  resolveAcgPianoWrittenContinuity,
  type AcgPianoLeadBoundaryBridgeKind,
  type AcgPianoLeadContinuityClass,
  type AcgPianoLeadContinuityProfile,
  type AcgPianoLeadShortGestureClass,
  type AcgPianoWrittenContinuityIntent,
} from '../knowledge/acgPianoContinuityKnowledge';
import {
  ACG_PIANO_METRIC_KNOWLEDGE,
  acgPianoOpeningKnowledgeFor,
  acgPianoOrchestrationSceneForId,
  resolveAcgPianoOrchestrationScene,
  type AcgPianoCompSurfaceFamily,
  type AcgPianoCompSurfaceIntent,
  type AcgPianoOpeningKnowledgeId,
  type AcgPianoOrchestrationSceneId,
  type AcgPianoPhraseOrchestrationRule,
} from '../knowledge/acgPianoArrangementKnowledge';
import type { GrooveTextureContract } from '../knowledge/textureProfiles';
import type { AcgPianoSongGrammarSubset } from '../knowledge/melodyStyleGrammarProfiles';
import type { AcgStableRole } from '../knowledge/melodyGrammarTypes';
import type { AcgLeadPresencePlan } from '../render/acgLeadPresencePlan';
import type { RoadMap } from '../render/mgRoadMapParser';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';

export const ACG_PIANO_TEXTURE_CASES = [
  'Piano_TopVoice_Planing',
  'ACG_Quartal_Arp_Wave',
  'ACG_Sakamoto_LH_Arp_RH_Penta',
  'ACG_Ostinato_Hook_Pulse',
  'ACG_Stride_Cantabile_Ballad',
  'ACG_Anthem_Block_Push',
  'ACG_Open_Broken_10th',
  'ACG_Suspended_Block_Arrival',
  'ACG_Bass_Tremolo_Color',
  'ACG_Pedal_Wash_Color_Drops',
] as const;

export type AcgPianoTextureCase = (typeof ACG_PIANO_TEXTURE_CASES)[number];
export type AcgPianoScorePhase = 'opening' | 'statement' | 'development' | 'lift' | 'return' | 'coda';
export type AcgPianoArrangementVariantId =
  | 'ripple-cantabile'
  | 'open-tenths'
  | 'pulse-to-wave'
  | 'answering-steps';

/** A phrase-level hand-shape; not a user-facing style or a renderer switch. */
export type AcgPianoPhraseGesture =
  | 'pedal-breath'
  | 'ripple-call'
  | 'broken-ten-lift'
  | 'downward-answer'
  | 'block-arrival'
  | 'ostinato-development'
  | 'release-coda';

/** Every audible comp event is authored by the phrase score before rendering. */
export type AcgPianoCompGesture = AcgPianoCompSurfaceIntent;

/**
 * A concrete middle-hand sentence written by the Arranger.  `gesture` remains
 * the coarse structural family used by cadence/budget contracts; the sentence
 * is what makes two `arp-up` or `block` slots audibly different without
 * handing rhythmic invention back to the renderer.
 */
export const ACG_PIANO_COMP_SENTENCES = [
  'full-breath',
  'bare-root-space',
  'pedal-reveal',
  'slow-roll-reveal',
  'ripple-eighths',
  'open-tenth-rise',
  'arch-wave',
  'turning-figure',
  'inner-counterline',
  'descending-echo',
  'hook-pulse',
  'offbeat-pulse',
  'tremolo-color',
  'block-push',
  'framed-arrival',
  'suspension-arrival',
  'late-question',
  'dyad-riff',
  'echo-tag',
] as const;

export type AcgPianoCompSentenceId = (typeof ACG_PIANO_COMP_SENTENCES)[number];

export type AcgPianoAttack = 'simultaneous' | 'roll-up' | 'roll-down';
export type AcgPianoVoiceSelection =
  | 'all'
  | 'low'
  | 'inner-low'
  | 'inner-high'
  | 'high'
  | 'lower-dyad'
  | 'upper-dyad';
export type AcgPianoEventRole = 'underlay' | 'answer' | 'arrival';
export type AcgPianoHarmonicTarget = 'current' | 'next';
export type AcgPianoBassMotion = 'pedal' | 'ripple' | 'open-tenth' | 'stride' | 'root-anchor';
export type AcgPianoLeadGrammarSubset = Exclude<AcgPianoSongGrammarSubset, 'all'>;
export type AcgPianoReturnShape = 'stableSingle' | 'sigh' | 'liftRiff';
export type AcgPianoMetricRole = 'structural' | 'flow' | 'pickup' | 'answer';
export type AcgPianoMetricAnchorKind =
  | 'bar-downbeat'
  | 'secondary-strong-beat'
  | 'weak-beat'
  | 'harmonic-arrival'
  | 'phrase-arrival';

/**
 * One shared metric point for the complete piano score.  BASS, COMP and LEAD
 * may use different surface rhythms, but their structural attacks reference
 * this same Arranger-owned clock instead of inventing three local grids.
 */
export interface AcgPianoMetricAnchor {
  id: string;
  /** Absolute beat in the song. */
  beat: number;
  bar: number;
  beatInBar: number;
  kind: AcgPianoMetricAnchorKind;
  /** 0..1 metric/accent weight consumed before NoteIR exists. */
  strength: number;
  sectionId: string;
  spanId?: string;
  phraseId?: string;
  roles: readonly ('bass' | 'comp' | 'lead')[];
}

export interface AcgPianoMetricGrid {
  beatsPerBar: number;
  /** Smallest structural onset slot; expressive offsets remain separate. */
  subdivisionBeats: number;
  /** Rubato smaller than this may remain attached to its declared anchor. */
  expressiveOffsetLimitBeats: number;
  /** A root-led arpeggio may enter shortly after the shared downbeat. */
  compEntryLimitBeats: number;
  /** Complete 2/3/4-voice roll width, not a per-voice allowance. */
  rollSpreadLimitBeats: number;
  anchors: readonly AcgPianoMetricAnchor[];
}
/**
 * A phrase-level comp sentence.  It is selected by the arranger before any
 * note is rendered, so a cue's middle contrast is not a renderer-side fill.
 */
export type AcgPianoSpanGestureCycle = readonly AcgPianoCompGesture[];

export interface AcgPianoSilenceWindow {
  /** Relative to the owning harmonic span for comp, absolute for lead phrase windows. */
  startBeat: number;
  endBeat: number;
  reason: 'phrase-breath' | 'lead-underlay' | 'lead-rest' | 'release';
}

export interface AcgPianoCompEvent {
  id: string;
  gesture: Exclude<AcgPianoCompGesture, 'tacet'>;
  /** Relative to the start of this event's owning harmonic span. */
  atBeat: number;
  durationBeats: number;
  voices: AcgPianoVoiceSelection;
  /** Only this event may turn a vertical voicing into a roll. */
  attack: AcgPianoAttack;
  /** Arrangement-owned source velocity in 0..1 before MIDI conversion. */
  velocity: number;
  harmonicTarget: AcgPianoHarmonicTarget;
  /** A D source span can explicitly author this terminal in the target T span. */
  resolutionSourceSpanId?: string;
  role: AcgPianoEventRole;
  /** Metric ownership is optional only for compact legacy test fixtures. */
  metricAnchorId?: string;
  /** Signed performed offset from the shared anchor, in beats. */
  metricOffsetBeats?: number;
  metricRole?: AcgPianoMetricRole;
  /** Arranger-written key/rest/damper semantics; renderer must not reclassify it. */
  continuity?: AcgPianoWrittenContinuityIntent;
}

export interface AcgPianoBassEvent {
  /** Relative to the start of the harmonic span. */
  atBeat: number;
  durationBeats: number;
  voice: 'root' | 'fifth' | 'tenth';
  velocity: number;
  /** Metric ownership is optional only for compact legacy test fixtures. */
  metricAnchorId?: string;
  metricOffsetBeats?: number;
  metricRole?: AcgPianoMetricRole;
  /** Arranger-written key/rest/damper semantics; renderer must not reclassify it. */
  continuity?: AcgPianoWrittenContinuityIntent;
}

export interface AcgPianoCompDirective {
  /** Same piano: comp owns the middle hand while lead owns the top line. */
  floorMidi: number;
  ceilingMidi: number;
  rollStepBeats: number;
  /** Complete written roll width; optional only for compact legacy fixtures. */
  rollSpreadLimitBeats?: number;
  maxVoices: number;
  gesture: AcgPianoCompGesture;
  /** Concrete score sentence. Optional only for compact unit-test fixtures. */
  sentenceId?: AcgPianoCompSentenceId;
  events: readonly AcgPianoCompEvent[];
  /** A tacet is a real score event, never a renderer-side density deletion. */
  silenceWindows: readonly AcgPianoSilenceWindow[];
}

export interface AcgPianoBassDirective {
  rootAnchorRequired: true;
  maxNotesPerSpan: number;
  motion: AcgPianoBassMotion;
  events: readonly AcgPianoBassEvent[];
}

export interface AcgPianoLeadDirective {
  grammarSubset: AcgPianoLeadGrammarSubset;
  /** Scheduler can only select an existing return brick in this allowed set. */
  returnShapes: readonly AcgPianoReturnShape[];
  /** KB-derived phrase rule; per-harmony slots below make it executable. */
  continuityProfile: AcgPianoLeadContinuityProfile;
  silenceWindows: readonly AcgPianoSilenceWindow[];
  interlock: {
    whenLeadActive: 'underlay' | 'tacet';
    whenLeadRest: 'answer' | 'underlay' | 'shared-rest';
  };
}

/** A cross-harmony continuation must be pre-proved by the Arranger. */
export interface AcgPianoLeadBoundaryBridge {
  kind: AcgPianoLeadBoundaryBridgeKind;
  /** Omitted only for the explicit release fallback. */
  targetSpanId?: string;
  /** Exact stable pitch classes admitted on both sides of the boundary. */
  continuationPcs?: readonly number[];
}

/**
 * One phrase × harmonic-segment top-line contract.  It is deliberately
 * separate from `spanById`: a single harmony may be split by a phrase edge,
 * and that edge must not lose the lead's semantic owner during span merging.
 */
export interface AcgPianoLeadContinuitySlot {
  id: string;
  phraseId: string;
  sourceSpanId: string;
  startBeat: number;
  endBeat: number;
  continuityClass: AcgPianoLeadContinuityClass;
  exposedGapBeats: number;
  minimumKeyDownBeats: number;
  releaseGuardBeats: number;
  reentryGuardBeats: number;
  maxOnsetNudgeBeats: number;
  allowedShortGestureClasses: readonly AcgPianoLeadShortGestureClass[];
  harmonicScope: 'current-chord';
  stableRoles: readonly AcgStableRole[];
  boundaryBridges: readonly AcgPianoLeadBoundaryBridge[];
  lowerHandPolicy: AcgPianoLeadContinuityProfile['lowerHandPolicy'];
  terminalTailPolicy: AcgPianoLeadContinuityProfile['terminalTailPolicy'];
}

export interface AcgPianoPhrasePlan {
  phraseId: string;
  sectionId: string;
  startBeat: number;
  endBeat: number;
  phase: AcgPianoScorePhase;
  formRole: Phrase['role'];
  cadenceTarget: Phrase['cadenceTarget'];
  gesture: AcgPianoPhraseGesture;
  /** Concrete within-phrase surface sentence; lead/tacet contracts may hard-override one slot. */
  spanGestureCycle: AcgPianoSpanGestureCycle;
  /** An adjacent phrase cannot repeat this signature unless explicitly marked as A'. */
  surfaceSignature: string;
  repeatPolicy: 'forbid-adjacent-repeat' | 'explicit-restatement';
  roadMapBinding: {
    brickIndices: readonly number[];
    brickFamilies: readonly string[];
    brickNames: readonly string[];
  };
  /** Arranger KB scene that owns the bass/COMP/lead relationship for this phrase. */
  orchestrationSceneId: AcgPianoOrchestrationSceneId;
  lead: AcgPianoLeadDirective;
}

export interface AcgPianoScoreSpan {
  spanId: string;
  sectionId: string;
  phraseId: string;
  phase: AcgPianoScorePhase;
  textureCase: AcgPianoTextureCase;
  /** A concrete ascent ending in an arrival event, not a renderer-only label. */
  upwardArpeggioLanding: boolean;
  comp: AcgPianoCompDirective;
  bass: AcgPianoBassDirective;
}

/** Why the scored piano keeps one physical damper down across harmony spans. */
export type AcgPianoPedalHoldReason = 'opening-afterglow' | 'phrase-air' | 'coda-dissolve' | 'lead-afterglow';

/**
 * A shared-piano damper interval, authored by the ACG arranger in absolute
 * beats.  This is not a renderer inference from NoteIR: it represents either
 * an arranger-written air sentence or a scheduler-authored lead afterglow,
 * while the instrumental pedal plan remains the hardware-capability
 * authority.
 */
export interface AcgPianoPedalHold {
  startBeat: number;
  endBeat: number;
  reason: AcgPianoPedalHoldReason;
  /** Legacy hold adapter: an early release must name the attack that restores the damper. */
  reengageBeat?: number;
}

export interface AcgPianoScorePlan {
  /** Internal arrangement subset; never maps to a UI style. */
  arrangementVariant: AcgPianoArrangementVariantId;
  /** The RoadMap is factual harmonic analysis; this plan only overlays interpretation. */
  roadMap?: RoadMap;
  leadPresencePlan?: AcgLeadPresencePlan;
  /** One metric/accent authority shared by all three written piano hands. */
  metricGrid: AcgPianoMetricGrid;
  /** All phrase owners when one harmonic span crosses a phrase boundary. */
  phraseIdsBySpan: Record<string, readonly string[]>;
  phraseById: Record<string, AcgPianoPhrasePlan>;
  /** Backward-compatible primary (first) phrase owner for a harmonic span. */
  phraseIdBySpan: Record<string, string>;
  textureBySpan: Record<string, AcgPianoTextureCase>;
  spanById: Record<string, AcgPianoScoreSpan>;
  /** Authoritative lead continuity score, retained across renderer retries. */
  leadContinuitySlots: readonly AcgPianoLeadContinuitySlot[];
  /** One physical piano's score-owned long-pedal intervals, shared by all hands. */
  sharedPedalHolds: readonly AcgPianoPedalHold[];
}

/**
 * Semantic score validator. Renderer ownership tests prove that timing is
 * preserved; this validator proves the timing handed to the renderer belongs
 * to the shared piano clock in the first place.
 */
export function validateAcgPianoMetricContract(plan: AcgPianoScorePlan): readonly string[] {
  const issues: string[] = [];
  const anchors = new Map(plan.metricGrid.anchors.map((anchor) => [anchor.id, anchor]));
  if (plan.metricGrid.subdivisionBeats <= 0) issues.push('metricGrid.subdivisionBeats must be positive');
  if (plan.metricGrid.compEntryLimitBeats > plan.metricGrid.subdivisionBeats + 1e-6) {
    issues.push('metricGrid.compEntryLimitBeats exceeds one subdivision');
  }
  for (const span of Object.values(plan.spanById)) {
    const spreadLimit = span.comp.rollSpreadLimitBeats ?? plan.metricGrid.rollSpreadLimitBeats;
    if (spreadLimit > plan.metricGrid.rollSpreadLimitBeats + 1e-6) {
      issues.push(`${span.spanId}: comp roll spread exceeds metric contract`);
    }
    for (const event of span.comp.events) {
      if (!event.metricAnchorId || !anchors.has(event.metricAnchorId)) {
        issues.push(`${span.spanId}:${event.id}: comp event has no valid metric anchor`);
        continue;
      }
      const offset = Math.abs(event.metricOffsetBeats ?? Infinity);
      const limit = event.metricRole === 'structural'
        ? plan.metricGrid.compEntryLimitBeats
        : plan.metricGrid.subdivisionBeats / 2;
      if (offset > limit + 1e-6) {
        issues.push(`${span.spanId}:${event.id}: comp ${event.metricRole ?? 'unknown'} offset ${offset.toFixed(3)} exceeds ${limit.toFixed(3)}`);
      }
    }
    for (const [index, event] of span.bass.events.entries()) {
      if (!event.metricAnchorId || !anchors.has(event.metricAnchorId)) {
        issues.push(`${span.spanId}:bass-${index}: bass event has no valid metric anchor`);
        continue;
      }
      const offset = Math.abs(event.metricOffsetBeats ?? Infinity);
      if (event.metricRole === 'structural' && offset > 1e-6) {
        issues.push(`${span.spanId}:bass-${index}: structural root is off its metric anchor`);
      } else if (offset > plan.metricGrid.subdivisionBeats / 2 + 1e-6) {
        issues.push(`${span.spanId}:bass-${index}: flow offset exceeds half a subdivision`);
      }
    }
  }
  return issues;
}

/** Every written lower/middle-hand attack must carry an explicit rest policy. */
export function validateAcgPianoWrittenContinuityContract(plan: AcgPianoScorePlan): readonly string[] {
  const issues: string[] = [];
  for (const span of Object.values(plan.spanById)) {
    for (const event of span.comp.events) {
      if (!event.continuity) {
        issues.push(`${span.spanId}:${event.id}: comp event has no written continuity intent`);
      } else if (event.continuity.continuityClass === 'fast-run'
        && event.continuity.damperPolicy !== 'dry-allowed') {
        issues.push(`${span.spanId}:${event.id}: fast run does not own its dry exception`);
      } else if (event.continuity.continuityClass !== 'fast-run'
        && event.continuity.damperPolicy !== 'pedal-default') {
        issues.push(`${span.spanId}:${event.id}: non-fast comp event lacks default pedal support`);
      }
    }
    for (const [index, event] of span.bass.events.entries()) {
      if (!event.continuity) {
        issues.push(`${span.spanId}:bass-${index}: bass event has no written continuity intent`);
      } else if (event.continuity.continuityClass !== 'fast-run'
        && event.continuity.damperPolicy !== 'pedal-default') {
        issues.push(`${span.spanId}:bass-${index}: non-fast bass event lacks default pedal support`);
      }
    }
  }
  return issues;
}

interface ArrangementSubset {
  id: AcgPianoArrangementVariantId;
  /** One cue keeps a compact, recognisable material vocabulary. */
  songPalette: readonly AcgPianoTextureCase[];
  palette: Record<AcgPianoScorePhase, readonly AcgPianoTextureCase[]>;
  upward: readonly AcgPianoTextureCase[];
  arrivals: readonly AcgPianoTextureCase[];
}

// These are internal ACG PIANOSONG arrangement subsets. They reuse the
// existing rich-texture material pool; the new phrase score decides when and
// how the material speaks rather than exposing another UI genre.
export const ACG_PIANO_ARRANGEMENT_SUBSETS: readonly ArrangementSubset[] = [
  {
    id: 'ripple-cantabile',
    songPalette: [
      'Piano_TopVoice_Planing', 'ACG_Sakamoto_LH_Arp_RH_Penta',
      'ACG_Open_Broken_10th', 'ACG_Quartal_Arp_Wave',
      'ACG_Suspended_Block_Arrival', 'ACG_Pedal_Wash_Color_Drops',
    ],
    palette: {
      opening: ['Piano_TopVoice_Planing', 'ACG_Sakamoto_LH_Arp_RH_Penta'],
      statement: ['ACG_Sakamoto_LH_Arp_RH_Penta', 'ACG_Open_Broken_10th'],
      development: ['ACG_Open_Broken_10th', 'ACG_Quartal_Arp_Wave'],
      lift: ['ACG_Quartal_Arp_Wave', 'ACG_Open_Broken_10th'],
      return: ['ACG_Open_Broken_10th', 'ACG_Suspended_Block_Arrival'],
      coda: ['ACG_Pedal_Wash_Color_Drops', 'Piano_TopVoice_Planing'],
    },
    upward: ['ACG_Open_Broken_10th', 'ACG_Quartal_Arp_Wave', 'ACG_Suspended_Block_Arrival'],
    arrivals: ['ACG_Suspended_Block_Arrival', 'ACG_Open_Broken_10th'],
  },
  {
    id: 'open-tenths',
    songPalette: [
      'ACG_Pedal_Wash_Color_Drops', 'Piano_TopVoice_Planing',
      'ACG_Open_Broken_10th', 'ACG_Quartal_Arp_Wave',
      'ACG_Stride_Cantabile_Ballad', 'ACG_Suspended_Block_Arrival',
    ],
    palette: {
      opening: ['ACG_Pedal_Wash_Color_Drops', 'Piano_TopVoice_Planing'],
      statement: ['ACG_Open_Broken_10th', 'Piano_TopVoice_Planing'],
      development: ['ACG_Quartal_Arp_Wave', 'ACG_Open_Broken_10th'],
      lift: ['ACG_Open_Broken_10th', 'ACG_Quartal_Arp_Wave'],
      return: ['ACG_Stride_Cantabile_Ballad', 'ACG_Suspended_Block_Arrival'],
      coda: ['Piano_TopVoice_Planing', 'ACG_Pedal_Wash_Color_Drops'],
    },
    upward: ['ACG_Open_Broken_10th', 'ACG_Quartal_Arp_Wave', 'Piano_TopVoice_Planing'],
    arrivals: ['ACG_Suspended_Block_Arrival', 'ACG_Stride_Cantabile_Ballad'],
  },
  {
    id: 'pulse-to-wave',
    songPalette: [
      'ACG_Pedal_Wash_Color_Drops', 'ACG_Ostinato_Hook_Pulse',
      'ACG_Open_Broken_10th', 'ACG_Quartal_Arp_Wave',
      'ACG_Suspended_Block_Arrival', 'ACG_Bass_Tremolo_Color',
    ],
    palette: {
      opening: ['ACG_Pedal_Wash_Color_Drops', 'ACG_Ostinato_Hook_Pulse'],
      statement: ['ACG_Ostinato_Hook_Pulse', 'ACG_Open_Broken_10th'],
      development: ['ACG_Open_Broken_10th', 'ACG_Ostinato_Hook_Pulse'],
      lift: ['ACG_Quartal_Arp_Wave', 'ACG_Open_Broken_10th'],
      return: ['ACG_Suspended_Block_Arrival', 'ACG_Open_Broken_10th'],
      coda: ['ACG_Pedal_Wash_Color_Drops', 'ACG_Open_Broken_10th'],
    },
    upward: ['ACG_Quartal_Arp_Wave', 'ACG_Open_Broken_10th', 'ACG_Suspended_Block_Arrival'],
    arrivals: ['ACG_Suspended_Block_Arrival', 'ACG_Open_Broken_10th'],
  },
  {
    id: 'answering-steps',
    songPalette: [
      'ACG_Stride_Cantabile_Ballad', 'Piano_TopVoice_Planing',
      'ACG_Quartal_Arp_Wave', 'ACG_Open_Broken_10th',
      'ACG_Suspended_Block_Arrival', 'ACG_Anthem_Block_Push',
    ],
    palette: {
      opening: ['ACG_Stride_Cantabile_Ballad', 'Piano_TopVoice_Planing'],
      statement: ['Piano_TopVoice_Planing', 'ACG_Stride_Cantabile_Ballad'],
      development: ['ACG_Quartal_Arp_Wave', 'ACG_Open_Broken_10th'],
      lift: ['ACG_Open_Broken_10th', 'ACG_Quartal_Arp_Wave'],
      return: ['ACG_Suspended_Block_Arrival', 'ACG_Anthem_Block_Push'],
      coda: ['Piano_TopVoice_Planing', 'ACG_Stride_Cantabile_Ballad'],
    },
    upward: ['Piano_TopVoice_Planing', 'ACG_Quartal_Arp_Wave', 'ACG_Open_Broken_10th'],
    arrivals: ['ACG_Suspended_Block_Arrival', 'ACG_Anthem_Block_Push'],
  },
];

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function choose<T>(seed: number, key: string, xs: readonly T[]): T {
  return xs[hash32(`${seed}|${key}`) % xs.length]!;
}

function isAllowed(texture: AcgPianoTextureCase, contract?: GrooveTextureContract): boolean {
  if (contract?.forbiddenTextureCases?.includes(texture)) return false;
  return !contract?.allowedTextureCases || contract.allowedTextureCases.length === 0 || contract.allowedTextureCases.includes(texture);
}

function chooseAllowed(
  seed: number,
  key: string,
  requested: readonly AcgPianoTextureCase[],
  contract?: GrooveTextureContract,
  songPalette: readonly AcgPianoTextureCase[] = ACG_PIANO_TEXTURE_CASES,
): AcgPianoTextureCase {
  const scoped = songPalette.filter((texture) => isAllowed(texture, contract));
  const requestedScoped = requested.filter((texture) => scoped.includes(texture));
  if (requestedScoped.length > 0) return choose(seed, key, requestedScoped);
  if (scoped.length > 0) return choose(seed, `${key}|subset-fallback`, scoped);
  const contractPool = ACG_PIANO_TEXTURE_CASES.filter((texture) => isAllowed(texture, contract));
  return choose(seed, `${key}|contract-fallback`, contractPool.length > 0 ? contractPool : songPalette);
}

function phaseForSection(section: Section, themeOrdinal: number): AcgPianoScorePhase {
  if (section.role === 'intro' || section.functionTag === 'setup') return 'opening';
  if (section.role === 'outro' || section.functionTag === 'tag' || section.functionTag === 'outro') return 'coda';
  if (section.role === 'bridge' || section.functionTag === 'build') return 'lift';
  if (section.role === 'chorus' || section.functionTag === 'headOut') return 'return';
  return themeOrdinal === 0 ? 'statement' : 'development';
}

function isThemeSection(section: Section): boolean {
  return section.role === 'verse' || section.functionTag === 'head';
}

function sectionPhases(arrangement: ArrangementPlan): Map<string, AcgPianoScorePhase> {
  const phases = new Map<string, AcgPianoScorePhase>();
  let themeOrdinal = 0;
  for (const section of arrangement.sections) {
    const ordinal = isThemeSection(section) ? themeOrdinal++ : themeOrdinal;
    phases.set(section.id, phaseForSection(section, ordinal));
  }
  return phases;
}

function phraseCandidates(
  phase: AcgPianoScorePhase,
  phrase: Phrase,
  hasLeadRest: boolean,
  profile: AcgPianoSurfaceProgram,
): readonly AcgPianoPhraseGesture[] {
  const cadence = phrase.role === 'cadence' || phrase.cadenceTarget === 'authentic' || phrase.cadenceTarget === 'climax';
  if (phase === 'opening') {
    if (profile === 'wide-cinema') return ['ripple-call', 'pedal-breath'];
    if (profile === 'ripple-journey') return hasLeadRest ? ['pedal-breath', 'ripple-call'] : ['ripple-call', 'pedal-breath'];
    return ['ripple-call', 'pedal-breath'];
  }
  if (phase === 'coda') return profile === 'ripple-journey'
    ? ['pedal-breath', 'release-coda']
    : ['release-coda'];
  if (phase === 'lift') return cadence
    ? ['broken-ten-lift', 'block-arrival', 'downward-answer']
    : ['broken-ten-lift', 'ostinato-development', 'downward-answer'];
  if (phase === 'return') return cadence
    ? ['block-arrival', 'downward-answer', 'broken-ten-lift']
    : ['downward-answer', 'ripple-call', 'block-arrival'];
  if (phase === 'development') return cadence
    ? ['broken-ten-lift', 'block-arrival', 'downward-answer']
    : ['broken-ten-lift', 'downward-answer', 'ostinato-development', 'ripple-call'];
  return cadence
    ? ['block-arrival', 'ripple-call', 'downward-answer']
    : ['ripple-call', 'downward-answer', 'pedal-breath'];
}

function choosePhraseGesture(
  seed: number,
  phrase: Phrase,
  phase: AcgPianoScorePhase,
  hasLeadRest: boolean,
  previous: AcgPianoPhraseGesture | undefined,
  profile: AcgPianoSurfaceProgram,
): AcgPianoPhraseGesture {
  const candidates = phraseCandidates(phase, phrase, hasLeadRest, profile);
  const contrasting = candidates.filter((candidate) => candidate !== previous);
  return choose(seed, `${phrase.id}|${phase}|phrase-gesture`, contrasting.length > 0 ? contrasting : candidates);
}

/**
 * Phrase gesture names the dramatic role; this cycle names the actual middle
 * hand sentence.  Every non-ostinato cycle contains a contrast (vertical,
 * pulse, or air) so “different phrase labels” cannot collapse into an
 * uninterrupted arpeggio wash.
 */
const SPAN_GESTURE_CYCLES: Record<AcgPianoPhraseGesture, readonly AcgPianoSpanGestureCycle[]> = {
  'pedal-breath': [
    ['pedal-hold', 'rolled-block'],
    ['pedal-hold', 'arp-up', 'pedal-hold'],
  ],
  'ripple-call': [
    ['arp-up', 'broken-wave', 'rolled-block', 'pedal-hold'],
    ['broken-wave', 'arp-up', 'pedal-hold', 'rolled-block'],
  ],
  'broken-ten-lift': [
    ['broken-wave', 'arp-up', 'pulse', 'rolled-block'],
    ['arp-up', 'broken-wave', 'rolled-block', 'pulse'],
  ],
  'downward-answer': [
    ['arp-down', 'broken-wave', 'rolled-block', 'pedal-hold'],
    ['broken-wave', 'arp-down', 'pedal-hold', 'rolled-block'],
  ],
  'block-arrival': [
    ['rolled-block', 'broken-wave', 'arp-up', 'block'],
    ['arp-up', 'pedal-hold', 'rolled-block', 'block'],
    ['rolled-block', 'arp-down', 'broken-wave', 'block'],
  ],
  'ostinato-development': [
    ['pulse', 'broken-wave', 'arp-up', 'pulse', 'rolled-block'],
    ['pulse', 'arp-up', 'broken-wave', 'pedal-hold', 'pulse'],
  ],
  'release-coda': [
    ['pedal-hold', 'tacet'],
    ['pedal-hold', 'tacet', 'tacet'],
    ['arp-down', 'tacet', 'pedal-hold'],
    ['rolled-block', 'tacet', 'pedal-hold'],
  ],
};

function spanGestureCycleForPhrase(
  seed: number,
  phrase: Phrase,
  phase: AcgPianoScorePhase,
  gesture: AcgPianoPhraseGesture,
  profile: AcgPianoSurfaceProgram,
  openingStrategy: AcgPianoOpeningKnowledgeId,
): AcgPianoSpanGestureCycle {
  if (phase === 'opening') {
    // The profile's openingStrategy is now executable score knowledge: it
    // selects a complete middle-register sentence before rendering.
    return acgPianoOpeningKnowledgeFor(openingStrategy).compSurfaceCycle;
  }
  const candidates = SPAN_GESTURE_CYCLES[gesture];
  const profiled = gesture === 'release-coda'
    ? profile === 'ripple-journey'
      ? candidates.slice(0, 2)
      : profile === 'wide-cinema'
        ? candidates.slice(-1)
        : profile === 'descending-memory'
          ? candidates.slice(2, 3)
          : candidates.slice(2)
    : candidates;
  return choose(seed, `${phrase.id}|${phase}|${gesture}|${profile}|comp-surface`, profiled.length > 0 ? profiled : candidates);
}

function grammarSubsetForPhrase(
  phase: AcgPianoScorePhase,
  gesture: AcgPianoPhraseGesture,
  binding: AcgPianoPhrasePlan['roadMapBinding'],
): AcgPianoLeadGrammarSubset {
  if (phase === 'opening' || gesture === 'pedal-breath') return 'intro-breath';
  if (binding.brickFamilies.some((family) => family === 'Borrowed' || family === 'GenDom')) return 'modal-color';
  if (phase === 'lift' || gesture === 'broken-ten-lift' || gesture === 'ostinato-development') return 'ascending-lift';
  if (gesture === 'block-arrival' || phase === 'return' || binding.brickFamilies.includes('Cadence')) return 'cadential-return';
  return 'cantabile-theme';
}

function grammarSubsetForScene(
  candidate: AcgPianoLeadGrammarSubset,
  scene: AcgPianoPhraseOrchestrationRule,
): AcgPianoLeadGrammarSubset {
  return scene.lead.allowedGrammarSubsets.includes(candidate)
    ? candidate
    : scene.lead.allowedGrammarSubsets[0]!;
}

function returnShapesForPhrase(phase: AcgPianoScorePhase, gesture: AcgPianoPhraseGesture): readonly AcgPianoReturnShape[] {
  if (phase === 'opening' || gesture === 'pedal-breath' || gesture === 'release-coda') return ['stableSingle'];
  if (gesture === 'downward-answer' || gesture === 'block-arrival' || phase === 'return') return ['sigh', 'stableSingle'];
  if (phase === 'development' || phase === 'lift' || gesture === 'broken-ten-lift') return ['liftRiff', 'sigh', 'stableSingle'];
  return ['sigh', 'stableSingle'];
}

function overlaps(start: number, end: number, window: { startBeat: number; endBeat: number }): boolean {
  return start < window.endBeat - 1e-4 && end > window.startBeat + 1e-4;
}

function leadWindowsForPhrase(
  startBeat: number,
  endBeat: number,
  leadPresencePlan?: AcgLeadPresencePlan,
): AcgPianoSilenceWindow[] {
  return (leadPresencePlan?.silenceWindows ?? [])
    .filter((window) => overlaps(startBeat, endBeat, window))
    .map((window) => ({
      startBeat: Math.max(startBeat, window.startBeat),
      endBeat: Math.min(endBeat, window.endBeat),
      reason: 'lead-rest' as const,
    }));
}

function phraseBinding(roadMap: RoadMap | undefined, startBeat: number, endBeat: number): AcgPianoPhrasePlan['roadMapBinding'] {
  const found = (roadMap?.bricks ?? [])
    .map((brick, brickIndex) => ({ brick, brickIndex }))
    .filter(({ brick }) => brick.startBeat < endBeat - 1e-4 && brick.startBeat + brick.durationBeats > startBeat + 1e-4);
  return {
    brickIndices: found.map(({ brickIndex }) => brickIndex),
    brickFamilies: [...new Set(found.map(({ brick }) => brick.family))],
    brickNames: [...new Set(found.map(({ brick }) => brick.name))],
  };
}

const ACG_PIANO_LEAD_STABLE_ROLES: readonly AcgStableRole[] = ['root', 'third', 'fifth', 'seventh'];

interface AcgPianoScoreSegment {
  span: HarmonicPlan['chordTimeline'][number];
  index: number;
  phrase: AcgPianoPhrasePlan;
  startBeat: number;
  endBeat: number;
}

function normalizePitchClasses(values: readonly number[]): readonly number[] {
  return [...new Set(values.map((value) => ((Number(value) % 12) + 12) % 12))].sort((left, right) => left - right);
}

function phraseAllowsLeadBoundaryBridge(phrase: AcgPianoPhrasePlan, atBeat: number): boolean {
  return !phrase.lead.silenceWindows.some((window) =>
    atBeat >= window.startBeat - 1e-4 && atBeat < window.endBeat - 1e-4);
}

/**
 * Compile the KB's phrase profile into executable, immutable score slots.
 * This is where exact common tones are decided: the scheduler receives only
 * a finite list of Arranger-proved pitch classes and may never re-infer a
 * cross-harmony permission from a finished melody.
 */
function buildAcgPianoLeadContinuitySlots(args: {
  segments: readonly AcgPianoScoreSegment[];
  harmonic: HarmonicPlan;
}): readonly AcgPianoLeadContinuitySlot[] {
  const slots: AcgPianoLeadContinuitySlot[] = [];
  for (const segment of args.segments) {
    const profile = segment.phrase.lead.continuityProfile;
    const spanStart = segment.span.startBeat as number;
    const spanEnd = spanStart + (segment.span.durationBeats as number);
    const endsAtHarmonyBoundary = Math.abs(segment.endBeat - spanEnd) <= 1e-4;
    const next = args.harmonic.chordTimeline[segment.index + 1];
    const nextStart = next ? next.startBeat as number : undefined;
    const targetSegment = next
      ? args.segments.find((candidate) => candidate.span.id === next.id
        && candidate.startBeat <= nextStart! + 1e-4
        && candidate.endBeat > nextStart! + 1e-4)
      : undefined;
    const boundaryBridges: AcgPianoLeadBoundaryBridge[] = [];

    if (endsAtHarmonyBoundary
      && next
      && targetSegment
      && phraseAllowsLeadBoundaryBridge(targetSegment.phrase, nextStart!)) {
      const sourceStable = normalizePitchClasses(args.harmonic.stableToneMap?.[segment.span.id] ?? []);
      const targetStable = normalizePitchClasses(args.harmonic.stableToneMap?.[next.id] ?? []);
      const sourceFunction = args.harmonic.chordFunctionTimeline[segment.index];
      const targetFunction = args.harmonic.chordFunctionTimeline[segment.index + 1];
      const dominantB9 = ((Number(next.rootPc) + 1) % 12 + 12) % 12;

      // Preserve the existing, deliberately narrow S→D b9 option, but write
      // its target span and exact pitch class at score time.
      if (sourceFunction === 'S' && targetFunction === 'D' && sourceStable.includes(dominantB9)) {
        boundaryBridges.push({
          kind: 'dominant-b9',
          targetSpanId: next.id,
          continuationPcs: [dominantB9],
        });
      }

      const commonTones = sourceStable.filter((pitchClass) => targetStable.includes(pitchClass));
      if (commonTones.length > 0) {
        boundaryBridges.push({
          kind: 'common-tone',
          targetSpanId: next.id,
          continuationPcs: commonTones,
        });
      }
    }

    // Fail closed: a boundary fragment without an Arranger-proved bridge is
    // an explicit release, never an accidental short carrier.
    boundaryBridges.push({ kind: 'release-at-boundary' });
    slots.push({
      id: `${segment.phrase.phraseId}:${segment.span.id}:${segment.startBeat.toFixed(4)}:${segment.endBeat.toFixed(4)}`,
      phraseId: segment.phrase.phraseId,
      sourceSpanId: segment.span.id,
      startBeat: segment.startBeat,
      endBeat: segment.endBeat,
      continuityClass: profile.continuityClass,
      exposedGapBeats: profile.exposedGapBeats,
      minimumKeyDownBeats: profile.minimumKeyDownBeats,
      releaseGuardBeats: profile.releaseGuardBeats,
      reentryGuardBeats: profile.reentryGuardBeats,
      maxOnsetNudgeBeats: profile.maxOnsetNudgeBeats,
      allowedShortGestureClasses: profile.allowedShortGestureClasses,
      harmonicScope: 'current-chord',
      stableRoles: ACG_PIANO_LEAD_STABLE_ROLES,
      boundaryBridges,
      lowerHandPolicy: profile.lowerHandPolicy,
      terminalTailPolicy: profile.terminalTailPolicy,
    });
  }
  return slots;
}

function clampEvent(atBeat: number, durationBeats: number, spanDuration: number): { atBeat: number; durationBeats: number } | null {
  const at = Math.max(0, Math.min(atBeat, spanDuration - 0.06));
  const duration = Math.max(0.08, Math.min(durationBeats, spanDuration - at - 0.03));
  return at + duration < spanDuration + 1e-4 ? { atBeat: at, durationBeats: duration } : null;
}

function event(
  id: string,
  gesture: Exclude<AcgPianoCompGesture, 'tacet'>,
  atBeat: number,
  durationBeats: number,
  spanDuration: number,
  voices: AcgPianoVoiceSelection,
  attack: AcgPianoAttack,
  velocity: number,
  role: AcgPianoEventRole,
  harmonicTarget: AcgPianoHarmonicTarget = 'current',
): AcgPianoCompEvent[] {
  const clamped = clampEvent(atBeat, durationBeats, spanDuration);
  return clamped ? [{ id, gesture, ...clamped, voices, attack, velocity, role, harmonicTarget }] : [];
}

function scaled(spanDuration: number, beatAtFour: number): number {
  return Math.max(0, beatAtFour * (spanDuration / 4));
}

function snapToAcgPianoSubdivision(beat: number, subdivisionBeats: number): number {
  if (!Number.isFinite(beat) || !Number.isFinite(subdivisionBeats) || subdivisionBeats <= 0) return beat;
  return Math.round(beat / subdivisionBeats) * subdivisionBeats;
}

function nearestAcgPianoMetricAnchor(
  grid: AcgPianoMetricGrid,
  absoluteBeat: number,
): AcgPianoMetricAnchor | undefined {
  let nearest: AcgPianoMetricAnchor | undefined;
  let distance = Infinity;
  for (const anchor of grid.anchors) {
    const candidateDistance = Math.abs(anchor.beat - absoluteBeat);
    if (candidateDistance < distance - 1e-9) {
      nearest = anchor;
      distance = candidateDistance;
    }
  }
  return nearest;
}

/**
 * Sentence tables describe musical shapes; this pass writes those shapes onto
 * the shared piano clock before the score becomes immutable.  It deliberately
 * preserves answer-window timing and explicit pickups, while removing the
 * independent .12/.14/.20/.28-style clocks that formerly accumulated across
 * the three hands.
 */
function bindCompEventsToAcgPianoMetricGrid(args: {
  events: readonly AcgPianoCompEvent[];
  absoluteSegmentStart: number;
  segmentDuration: number;
  grid: AcgPianoMetricGrid;
}): readonly AcgPianoCompEvent[] {
  const ordered = [...args.events].sort((left, right) => left.atBeat - right.atBeat || left.id.localeCompare(right.id));
  return ordered.map((event, index) => {
    const answer = event.role === 'answer' || event.gesture === 'answer-dyad';
    const firstEntry = !answer && index === 0 && event.atBeat <= 0.30 + 1e-6;
    const structuralEntry = event.role === 'arrival' || firstEntry;
    let atBeat = event.atBeat;
    if (answer) {
      const snapped = snapToAcgPianoSubdivision(atBeat, args.grid.subdivisionBeats);
      if (Math.abs(snapped - atBeat) <= args.grid.expressiveOffsetLimitBeats + 1e-6) atBeat = snapped;
    } else if (event.attack !== 'simultaneous' && firstEntry) {
      // Root-led arpeggios and rolls begin on the shared lower-hand anchor.
      // Their internal spread is bounded separately by rollSpreadLimitBeats.
      atBeat = 0;
    } else if (firstEntry && atBeat > args.grid.expressiveOffsetLimitBeats) {
      // A quiet middle-hand entry may follow the bass root, but never by the
      // former .20-.28 beat delay that sounded like a second pulse.
      atBeat = Math.min(args.grid.compEntryLimitBeats, args.segmentDuration - 0.06);
    } else {
      atBeat = snapToAcgPianoSubdivision(atBeat, args.grid.subdivisionBeats);
    }
    atBeat = Math.max(0, Math.min(atBeat, args.segmentDuration - 0.06));
    const durationBeats = Math.max(
      0.08,
      Math.min(event.durationBeats, args.segmentDuration - atBeat - 0.03),
    );
    const absoluteBeat = args.absoluteSegmentStart + atBeat;
    const anchor = nearestAcgPianoMetricAnchor(args.grid, absoluteBeat);
    const metricRole: AcgPianoMetricRole = answer ? 'answer' : structuralEntry ? 'structural' : 'flow';
    const accentScale = metricRole === 'structural'
      ? ACG_PIANO_METRIC_KNOWLEDGE.structuralAccentBase
        + (anchor?.strength ?? 0.8) * ACG_PIANO_METRIC_KNOWLEDGE.structuralAccentRange
      : metricRole === 'answer'
        ? ACG_PIANO_METRIC_KNOWLEDGE.answerAccentScale
        : ACG_PIANO_METRIC_KNOWLEDGE.flowAccentBase
          + (anchor?.strength ?? 0.6) * ACG_PIANO_METRIC_KNOWLEDGE.flowAccentRange;
    return {
      ...event,
      atBeat,
      durationBeats,
      velocity: Math.max(0.05, Math.min(1, event.velocity * accentScale)),
      metricAnchorId: anchor?.id,
      metricOffsetBeats: anchor ? absoluteBeat - anchor.beat : 0,
      metricRole,
    };
  });
}

function bindBassEventsToAcgPianoMetricGrid(args: {
  events: readonly AcgPianoBassEvent[];
  absoluteSegmentStart: number;
  segmentDuration: number;
  grid: AcgPianoMetricGrid;
}): readonly AcgPianoBassEvent[] {
  return args.events.map((event) => {
    const structural = event.voice === 'root' && event.atBeat <= 1e-4;
    const atBeat = structural
      ? 0
      : Math.max(
        0,
        Math.min(
          snapToAcgPianoSubdivision(event.atBeat, args.grid.subdivisionBeats),
          args.segmentDuration - 0.03,
        ),
      );
    const durationBeats = Math.max(
      0.02,
      Math.min(event.durationBeats, args.segmentDuration - atBeat - 0.02),
    );
    const absoluteBeat = args.absoluteSegmentStart + atBeat;
    const anchor = nearestAcgPianoMetricAnchor(args.grid, absoluteBeat);
    const accentScale = structural
      ? ACG_PIANO_METRIC_KNOWLEDGE.structuralAccentBase
        + (anchor?.strength ?? 0.8) * ACG_PIANO_METRIC_KNOWLEDGE.structuralAccentRange
      : ACG_PIANO_METRIC_KNOWLEDGE.flowAccentBase
        + (anchor?.strength ?? 0.6) * ACG_PIANO_METRIC_KNOWLEDGE.flowAccentRange;
    return {
      ...event,
      atBeat,
      durationBeats,
      velocity: Math.max(0.05, Math.min(1, event.velocity * accentScale)),
      metricAnchorId: anchor?.id,
      metricOffsetBeats: anchor ? absoluteBeat - anchor.beat : 0,
      metricRole: structural ? 'structural' : 'flow',
    };
  });
}

const ANSWER_DYAD_MIN_DURATION_BEATS = 0.08;
const ANSWER_DYAD_ENTRY_GUARD_BEATS = 0.04;
const ANSWER_DYAD_EXIT_GUARD_BEATS = 0.03;

/**
 * Answer dyads are allowed only inside the exact silence that the lead
 * scheduler owns. This deliberately returns null rather than clamping an
 * undersized window into active lead time.
 */
function answerTimingForWindow(
  answerWindow: { startBeat: number; endBeat: number } | undefined,
  spanDuration: number,
  desiredDuration: number,
): { atBeat: number; durationBeats: number } | null {
  if (!answerWindow) return null;
  const startBeat = Math.max(0, answerWindow.startBeat + ANSWER_DYAD_ENTRY_GUARD_BEATS);
  const endBeat = Math.min(spanDuration, answerWindow.endBeat - ANSWER_DYAD_EXIT_GUARD_BEATS);
  const available = endBeat - startBeat;
  if (available < ANSWER_DYAD_MIN_DURATION_BEATS - 1e-4) return null;
  return {
    atBeat: startBeat,
    durationBeats: Math.min(desiredDuration, available),
  };
}

function eventsForGesture(
  gesture: AcgPianoCompGesture,
  spanDuration: number,
  id: string,
  currentSpanArrival: boolean,
  answerWindow?: { startBeat: number; endBeat: number },
): readonly AcgPianoCompEvent[] {
  const at = (beatAtFour: number) => scaled(spanDuration, beatAtFour);
  const dur = (beatsAtFour: number) => Math.max(0.18, scaled(spanDuration, beatsAtFour));
  const answerTiming = answerTimingForWindow(answerWindow, spanDuration, dur(0.62));
  const answerEvent = (
    eventId: string,
    velocity: number,
    role: AcgPianoEventRole,
  ): AcgPianoCompEvent[] => answerTiming
    ? event(eventId, 'answer-dyad', answerTiming.atBeat, answerTiming.durationBeats, spanDuration, 'upper-dyad', 'simultaneous', velocity, role)
    : [];
  switch (gesture) {
    case 'tacet':
      return [];
    case 'pedal-hold':
      return event(`${id}:pedal`, 'pedal-hold', at(0.14), dur(2.45), spanDuration, 'lower-dyad', 'simultaneous', 0.22, 'underlay');
    case 'arp-up':
      return [
        ...event(`${id}:low`, 'arp-up', at(0.10), dur(0.62), spanDuration, 'low', 'simultaneous', 0.25, 'underlay'),
        ...event(`${id}:inner-low`, 'arp-up', at(0.65), dur(0.54), spanDuration, 'inner-low', 'simultaneous', 0.23, 'underlay'),
        ...event(`${id}:inner-high`, 'arp-up', at(1.16), dur(0.50), spanDuration, 'inner-high', 'simultaneous', 0.22, 'underlay'),
        ...event(`${id}:high`, 'arp-up', at(1.66), dur(0.72), spanDuration, 'high', 'simultaneous', currentSpanArrival ? 0.31 : 0.24, currentSpanArrival ? 'arrival' : 'underlay'),
      ];
    case 'arp-down':
      return [
        // A single authored roll uses every real voicing tone available at
        // render time, so a 2/3/4-voice chord always falls strictly instead
        // of guessing a third inner degree that may not exist.
        ...event(`${id}:fall`, 'arp-down', at(0.18), dur(1.52), spanDuration, 'all', 'roll-down', 0.25, 'underlay'),
        ...answerEvent(`${id}:dyad`, 0.25, 'answer'),
      ];
    case 'broken-wave':
      return [
        ...event(`${id}:low`, 'broken-wave', at(0.12), dur(0.48), spanDuration, 'low', 'simultaneous', 0.25, 'underlay'),
        ...event(`${id}:inner`, 'broken-wave', at(0.60), dur(0.46), spanDuration, 'inner-low', 'simultaneous', 0.22, 'underlay'),
        ...event(`${id}:high`, 'broken-wave', at(1.08), dur(0.50), spanDuration, 'high', 'simultaneous', 0.25, 'underlay'),
        ...event(`${id}:return`, 'broken-wave', at(1.56), dur(0.46), spanDuration, 'inner-high', 'simultaneous', 0.21, 'underlay'),
        ...answerEvent(`${id}:answer`, 0.22, currentSpanArrival ? 'arrival' : 'answer'),
      ];
    case 'rolled-block':
      return event(`${id}:roll`, 'rolled-block', at(0.06), dur(1.55), spanDuration, 'all', 'roll-up', 0.28, currentSpanArrival ? 'arrival' : 'underlay');
    case 'block':
      return event(`${id}:block`, 'block', at(0), dur(1.40), spanDuration, 'all', 'simultaneous', 0.30, currentSpanArrival ? 'arrival' : 'underlay');
    case 'answer-dyad':
      return answerEvent(`${id}:dyad`, 0.25, 'answer');
    case 'pulse':
      return [
        ...event(`${id}:pulse-a`, 'pulse', at(0.72), dur(0.38), spanDuration, 'lower-dyad', 'simultaneous', 0.22, 'underlay'),
        ...event(`${id}:pulse-b`, 'pulse', at(1.72), dur(0.36), spanDuration, 'upper-dyad', 'simultaneous', 0.23, 'underlay'),
        ...event(`${id}:pulse-c`, 'pulse', at(2.72), dur(0.36), spanDuration, 'lower-dyad', 'simultaneous', 0.22, 'underlay'),
      ];
  }
}

/**
 * Compile an Arranger-owned sentence into concrete score events.  These are
 * deliberately data-like, fixed patterns: the renderer only realizes the
 * authored timing/voice/attack and never improvises a replacement rhythm.
 */
function eventsForSentence(
  sentenceId: AcgPianoCompSentenceId,
  gesture: AcgPianoCompGesture,
  spanDuration: number,
  id: string,
  currentSpanArrival: boolean,
  answerWindow?: { startBeat: number; endBeat: number },
): readonly AcgPianoCompEvent[] {
  if (sentenceId === 'full-breath' || gesture === 'tacet') return [];
  const at = (beatAtFour: number) => scaled(spanDuration, beatAtFour);
  const dur = (beatsAtFour: number) => Math.max(0.18, scaled(spanDuration, beatsAtFour));
  const answerEvent = (
    eventId: string,
    velocity: number,
    role: AcgPianoEventRole,
  ): AcgPianoCompEvent[] => {
    const timing = answerTimingForWindow(answerWindow, spanDuration, dur(0.62));
    return timing
      ? event(eventId, gesture, timing.atBeat, timing.durationBeats, spanDuration, 'upper-dyad', 'simultaneous', velocity, role)
      : [];
  };
  const answerRiff = (): AcgPianoCompEvent[] => {
    if (!answerWindow) return [];
    const start = Math.max(0, answerWindow.startBeat + ANSWER_DYAD_ENTRY_GUARD_BEATS);
    const end = Math.min(spanDuration, answerWindow.endBeat - ANSWER_DYAD_EXIT_GUARD_BEATS);
    const usable = end - start;
    if (usable < ANSWER_DYAD_MIN_DURATION_BEATS - 1e-4) return [];
    const hitCount = usable >= dur(0.94) ? 3 : usable >= dur(0.46) ? 2 : 1;
    const gap = usable / hitCount;
    const hitDuration = Math.min(dur(0.32), Math.max(ANSWER_DYAD_MIN_DURATION_BEATS, gap * 0.68));
    return Array.from({ length: hitCount }, (_, index) => {
      const onset = start + gap * index;
      const remaining = end - onset;
      return event(
        `${id}:riff-${index}`,
        gesture,
        onset,
        Math.min(hitDuration, remaining),
        spanDuration,
        index % 2 === 0 ? 'upper-dyad' : 'lower-dyad',
        'simultaneous',
        0.21 + index * 0.018,
        'answer',
      );
    }).flat();
  };

  switch (sentenceId) {
    case 'bare-root-space':
      return event(`${id}:bare`, gesture, at(0.28), dur(1.34), spanDuration, 'lower-dyad', 'simultaneous', 0.19, 'underlay');
    case 'pedal-reveal':
      return [
        ...event(`${id}:bed`, gesture, at(0.14), dur(1.72), spanDuration, 'lower-dyad', 'simultaneous', 0.20, 'underlay'),
        ...event(`${id}:color`, gesture, at(2.76), dur(0.48), spanDuration, 'upper-dyad', 'simultaneous', 0.19, 'underlay'),
      ];
    case 'slow-roll-reveal':
      return event(`${id}:reveal`, gesture, at(0.20), dur(1.72), spanDuration, 'all', 'roll-up', 0.25, currentSpanArrival ? 'arrival' : 'underlay');
    case 'ripple-eighths':
      return [
        ...event(`${id}:low`, gesture, at(0.12), dur(0.44), spanDuration, 'low', 'simultaneous', 0.25, 'underlay'),
        ...event(`${id}:inner-a`, gesture, at(0.52), dur(0.38), spanDuration, 'inner-low', 'simultaneous', 0.22, 'underlay'),
        ...event(`${id}:inner-b`, gesture, at(0.96), dur(0.36), spanDuration, 'inner-high', 'simultaneous', 0.22, 'underlay'),
        ...event(`${id}:top`, gesture, at(1.42), dur(0.54), spanDuration, 'high', 'simultaneous', currentSpanArrival ? 0.31 : 0.24, currentSpanArrival ? 'arrival' : 'underlay'),
        ...event(`${id}:echo`, gesture, at(2.46), dur(0.38), spanDuration, 'inner-high', 'simultaneous', 0.20, 'underlay'),
      ];
    case 'open-tenth-rise':
      return [
        ...event(`${id}:open`, gesture, at(0.16), dur(0.52), spanDuration, 'low', 'simultaneous', 0.24, 'underlay'),
        ...event(`${id}:spread-a`, gesture, at(0.78), dur(0.46), spanDuration, 'inner-low', 'simultaneous', 0.22, 'underlay'),
        ...event(`${id}:spread-b`, gesture, at(1.46), dur(0.44), spanDuration, 'inner-high', 'simultaneous', 0.23, 'underlay'),
        ...event(`${id}:landing`, gesture, at(2.16), dur(0.66), spanDuration, 'high', 'simultaneous', currentSpanArrival ? 0.31 : 0.25, currentSpanArrival ? 'arrival' : 'underlay'),
      ];
    case 'arch-wave':
      return [
        ...event(`${id}:rise-low`, gesture, at(0.12), dur(0.34), spanDuration, 'low', 'simultaneous', 0.24, 'underlay'),
        ...event(`${id}:rise-inner`, gesture, at(0.50), dur(0.32), spanDuration, 'inner-low', 'simultaneous', 0.21, 'underlay'),
        ...event(`${id}:crest`, gesture, at(0.92), dur(0.36), spanDuration, 'inner-high', 'simultaneous', 0.23, 'underlay'),
        ...event(`${id}:top`, gesture, at(1.36), dur(0.46), spanDuration, 'high', 'simultaneous', currentSpanArrival ? 0.30 : 0.25, currentSpanArrival ? 'arrival' : 'underlay'),
        ...event(`${id}:fall-inner`, gesture, at(1.92), dur(0.34), spanDuration, 'inner-high', 'simultaneous', 0.21, 'underlay'),
        ...event(`${id}:fall-low`, gesture, at(2.40), dur(0.34), spanDuration, 'inner-low', 'simultaneous', 0.20, 'underlay'),
        ...event(`${id}:afterglow`, gesture, at(3.08), dur(0.36), spanDuration, 'upper-dyad', 'simultaneous', 0.19, 'underlay'),
      ];
    case 'turning-figure':
      return [
        ...event(`${id}:turn-a`, gesture, at(0.22), dur(0.34), spanDuration, 'inner-low', 'simultaneous', 0.22, 'underlay'),
        ...event(`${id}:turn-b`, gesture, at(0.68), dur(0.32), spanDuration, 'inner-high', 'simultaneous', 0.22, 'underlay'),
        ...event(`${id}:turn-c`, gesture, at(1.10), dur(0.34), spanDuration, 'upper-dyad', 'simultaneous', 0.23, 'underlay'),
        ...event(`${id}:turn-return`, gesture, at(1.78), dur(0.38), spanDuration, 'inner-high', 'simultaneous', 0.21, 'underlay'),
        ...event(`${id}:turn-land`, gesture, at(2.82), dur(0.52), spanDuration, 'lower-dyad', 'simultaneous', currentSpanArrival ? 0.28 : 0.22, currentSpanArrival ? 'arrival' : 'underlay'),
      ];
    case 'inner-counterline':
      return [
        ...event(`${id}:bed`, gesture, at(0.14), dur(1.86), spanDuration, 'lower-dyad', 'simultaneous', 0.20, 'underlay'),
        ...event(`${id}:counter-a`, gesture, at(0.68), dur(0.42), spanDuration, 'inner-high', 'simultaneous', 0.23, 'underlay'),
        ...event(`${id}:counter-b`, gesture, at(1.52), dur(0.42), spanDuration, 'inner-low', 'simultaneous', 0.22, 'underlay'),
        ...event(`${id}:counter-c`, gesture, at(2.36), dur(0.46), spanDuration, 'inner-high', 'simultaneous', currentSpanArrival ? 0.28 : 0.22, currentSpanArrival ? 'arrival' : 'underlay'),
      ];
    case 'descending-echo':
      return [
        ...event(`${id}:fall`, gesture, at(0.16), dur(1.38), spanDuration, 'all', 'roll-down', 0.24, 'underlay'),
        ...event(`${id}:echo-a`, gesture, at(2.18), dur(0.42), spanDuration, 'upper-dyad', 'simultaneous', 0.21, 'underlay'),
        ...event(`${id}:echo-b`, gesture, at(3.10), dur(0.36), spanDuration, 'inner-high', 'simultaneous', currentSpanArrival ? 0.27 : 0.20, currentSpanArrival ? 'arrival' : 'underlay'),
      ];
    case 'hook-pulse':
      return [0.48, 1.18, 1.96, 2.66, 3.30].flatMap((beat, index) => event(
        `${id}:hook-${index}`,
        gesture,
        at(beat),
        dur(0.30),
        spanDuration,
        index % 2 === 1 ? 'upper-dyad' : 'lower-dyad',
        'simultaneous',
        0.21 + Math.min(0.04, index * 0.01),
        index === 4 && currentSpanArrival ? 'arrival' : 'underlay',
      ));
    case 'offbeat-pulse':
      return [0.42, 1.42, 2.42, 3.42].flatMap((beat, index) => event(
        `${id}:offbeat-${index}`,
        gesture,
        at(beat),
        dur(0.34),
        spanDuration,
        index % 2 === 0 ? 'upper-dyad' : 'lower-dyad',
        'simultaneous',
        0.22,
        index === 3 && currentSpanArrival ? 'arrival' : 'underlay',
      ));
    case 'tremolo-color':
      return [0.12, 0.64, 1.18, 1.76, 2.38, 3.02].flatMap((beat, index) => event(
        `${id}:color-${index}`,
        gesture,
        at(beat),
        dur(0.26),
        spanDuration,
        index % 3 === 0 ? 'lower-dyad' : 'upper-dyad',
        'simultaneous',
        0.20 + (index === 5 && currentSpanArrival ? 0.07 : 0),
        index === 5 && currentSpanArrival ? 'arrival' : 'underlay',
      ));
    case 'block-push':
      return [0, 1.46, 2.00, 2.72, 3.46].flatMap((beat, index) => event(
        `${id}:push-${index}`,
        gesture,
        at(beat),
        dur(index === 0 ? 0.70 : 0.38),
        spanDuration,
        'all',
        'simultaneous',
        0.25 + Math.min(0.05, index * 0.012),
        (index === 0 || index === 4) && currentSpanArrival ? 'arrival' : 'underlay',
      ));
    case 'framed-arrival':
      return [
        ...event(`${id}:frame-open`, gesture, at(0.04), dur(1.16), spanDuration, 'all', 'roll-up', 0.27, 'arrival'),
        ...event(`${id}:frame-mid`, gesture, at(2.02), dur(0.48), spanDuration, 'inner-high', 'simultaneous', 0.22, 'underlay'),
        ...event(`${id}:frame-top`, gesture, at(3.08), dur(0.46), spanDuration, 'upper-dyad', 'simultaneous', 0.27, currentSpanArrival ? 'arrival' : 'underlay'),
      ];
    case 'suspension-arrival':
      return [
        ...event(`${id}:suspend`, gesture, at(0.08), dur(1.24), spanDuration, 'all', 'roll-up', 0.27, 'arrival'),
        ...event(`${id}:support`, gesture, at(2.28), dur(0.48), spanDuration, 'inner-high', 'simultaneous', 0.21, 'underlay'),
        ...event(`${id}:top`, gesture, at(3.20), dur(0.42), spanDuration, 'high', 'simultaneous', 0.26, currentSpanArrival ? 'arrival' : 'underlay'),
      ];
    case 'late-question':
      return answerEvent(`${id}:question`, 0.24, 'answer');
    case 'dyad-riff':
      return answerRiff();
    case 'echo-tag':
      return [
        ...event(`${id}:tag-roll`, gesture, at(0.10), dur(1.16), spanDuration, 'all', 'roll-up', 0.23, 'underlay'),
        ...event(`${id}:tag-echo-a`, gesture, at(2.18), dur(0.38), spanDuration, 'upper-dyad', 'simultaneous', 0.19, 'underlay'),
        ...event(`${id}:tag-echo-b`, gesture, at(3.18), dur(0.34), spanDuration, 'inner-high', 'simultaneous', 0.18, currentSpanArrival ? 'arrival' : 'underlay'),
      ];
    default:
      return eventsForGesture(gesture, spanDuration, id, currentSpanArrival, answerWindow);
  }
}

/**
 * A dominant span may prepare a resolution, but its terminal belongs to the
 * following tonic score span. It is queued by the D span, then attached to T
 * at beat zero; renderer execution remains strictly within the owning span.
 */
function arrivalAtTargetSpanForGesture(
  gesture: AcgPianoCompGesture,
  targetSpanDuration: number,
  id: string,
  resolutionSourceSpanId: string,
): readonly AcgPianoCompEvent[] {
  const dur = (beatsAtFour: number) => Math.max(0.18, scaled(targetSpanDuration, beatsAtFour));
  const atBoundary = (
    suffix: string,
    targetGesture: Exclude<AcgPianoCompGesture, 'tacet'>,
    durationBeats: number,
    voices: AcgPianoVoiceSelection,
    attack: AcgPianoAttack,
    velocity: number,
  ) => event(
    `${id}:next-tonic:${suffix}`,
    targetGesture,
    0,
    durationBeats,
    targetSpanDuration,
    voices,
    attack,
    velocity,
    'arrival',
  ).map((candidate) => ({ ...candidate, resolutionSourceSpanId }));

  if (gesture === 'arp-up') {
    return atBoundary('high', 'arp-up', dur(0.72), 'high', 'simultaneous', 0.32);
  }
  if (gesture === 'broken-wave') {
    return atBoundary('high', 'broken-wave', dur(0.68), 'high', 'simultaneous', 0.30);
  }
  if (gesture === 'rolled-block') {
    return atBoundary('roll', 'rolled-block', dur(1.35), 'all', 'roll-up', 0.31);
  }
  if (gesture === 'block') {
    return atBoundary('block', 'block', dur(1.40), 'all', 'simultaneous', 0.32);
  }
  return atBoundary('block', 'block', dur(1.24), 'all', 'simultaneous', 0.30);
}

/** A target phrase that is tacet under an active lead may still receive the
 * resolution only when the complete terminal fits its scheduler-owned breath. */
function targetPhraseAllowsResolutionTerminal(
  targetPhrase: AcgPianoPhrasePlan,
  targetSpanStartBeat: number,
  terminalEvents: readonly AcgPianoCompEvent[],
): boolean {
  if (targetPhrase.lead.interlock.whenLeadActive !== 'tacet') return true;
  if (targetPhrase.lead.interlock.whenLeadRest === 'shared-rest' || terminalEvents.length === 0) return false;
  return terminalEvents.every((event) => {
    const startBeat = targetSpanStartBeat + event.atBeat;
    const endBeat = startBeat + event.durationBeats;
    return targetPhrase.lead.silenceWindows.some((window) =>
      startBeat >= window.startBeat - 1e-4 && endBeat <= window.endBeat + 1e-4);
  });
}

/**
 * A D→T terminal owns T's downbeat.  If the target already authored a true
 * vertical arrival at that same tick, promote that target event with the
 * source provenance instead of writing the same piano attack twice.  A
 * slightly delayed roll is removed in favour of the exact T-downbeat terminal.
 */
function coalesceTargetTerminalWithLocalEvents(
  inheritedTerminalEvents: readonly AcgPianoCompEvent[],
  localEvents: readonly AcgPianoCompEvent[],
): readonly AcgPianoCompEvent[] {
  if (inheritedTerminalEvents.length === 0) return localEvents;
  const sourceTerminal = inheritedTerminalEvents.find((event) => event.role === 'arrival') ?? inheritedTerminalEvents[0]!;
  const verticalIndex = localEvents.findIndex((event) =>
    (event.gesture === 'block' || event.gesture === 'rolled-block') && event.atBeat <= 0.12);
  if (verticalIndex < 0) return [...inheritedTerminalEvents, ...localEvents];

  const localVertical = localEvents[verticalIndex]!;
  const remainingLocal = localEvents.filter((_, index) => index !== verticalIndex);
  if (localVertical.atBeat <= 1e-4) {
    return [
      {
        ...localVertical,
        role: 'arrival',
        resolutionSourceSpanId: sourceTerminal.resolutionSourceSpanId,
      },
      ...remainingLocal,
    ];
  }
  return [...inheritedTerminalEvents, ...remainingLocal];
}

/**
 * A preceding dominant may have written a single high-note terminal. If the
 * target phrase has spent its broken-motion budget and is intentionally a
 * contrast/air slot, preserve the D→T ownership but realize that terminal as
 * one quiet vertical arrival instead of smuggling another broken surface into
 * the target phrase after the budget has already spoken.
 */
function recastIncomingTerminalAsVerticalContrast(
  inheritedTerminalEvents: readonly AcgPianoCompEvent[],
  targetSpanDuration: number,
): readonly AcgPianoCompEvent[] {
  return inheritedTerminalEvents.map((event) => ({
    ...event,
    id: `${event.id}:vertical-contrast`,
    gesture: 'rolled-block' as const,
    atBeat: 0,
    durationBeats: Math.max(0.18, Math.min(event.durationBeats, targetSpanDuration - 0.03)),
    voices: 'all' as const,
    attack: 'roll-up' as const,
    velocity: Math.max(event.velocity, 0.29),
    role: 'arrival' as const,
  }));
}

function bassEventsForGesture(
  gesture: AcgPianoCompGesture,
  spanDuration: number,
): readonly AcgPianoBassEvent[] {
  const at = (beatAtFour: number) => scaled(spanDuration, beatAtFour);
  const dur = (beatsAtFour: number) => Math.max(0.18, scaled(spanDuration, beatsAtFour));
  // Phrase boundaries can bisect a harmonic span. The score must shorten or
  // omit a bass event here; bass rendering is not allowed to repair a leak.
  const fit = (events: readonly AcgPianoBassEvent[]): readonly AcgPianoBassEvent[] => events.flatMap((candidate) => {
    const atBeat = Math.max(0, Math.min(candidate.atBeat, spanDuration - 0.03));
    const room = spanDuration - atBeat - 0.02;
    if (room <= 0.01) return [];
    const durationBeats = Math.min(candidate.durationBeats, room);
    return durationBeats > 0.01 ? [{ ...candidate, atBeat, durationBeats }] : [];
  });
  const root: AcgPianoBassEvent = { atBeat: 0, durationBeats: Math.max(0.02, Math.min(Math.max(0.02, spanDuration - 0.05), dur(0.82))), voice: 'root', velocity: 0.46 };
  if (gesture === 'tacet') return fit([root]);
  if (gesture === 'pedal-hold') return fit([
    { ...root, durationBeats: Math.max(0.42, spanDuration - 0.08) },
    { atBeat: at(0.86), durationBeats: dur(0.68), voice: 'fifth', velocity: 0.25 },
  ]);
  if (gesture === 'block' || gesture === 'rolled-block') return fit([
    { ...root, durationBeats: Math.max(0.42, dur(1.28)), velocity: 0.48 },
    { atBeat: at(2.0), durationBeats: dur(0.72), voice: 'fifth', velocity: 0.29 },
  ]);
  if (gesture === 'arp-up' || gesture === 'broken-wave' || gesture === 'pulse') return fit([
    root,
    { atBeat: at(1.32), durationBeats: dur(0.52), voice: 'fifth', velocity: 0.27 },
    { atBeat: at(2.72), durationBeats: dur(0.46), voice: 'tenth', velocity: 0.24 },
  ]);
  return fit([
    root,
    { atBeat: at(2.0), durationBeats: dur(0.54), voice: 'fifth', velocity: 0.27 },
  ]);
}

/** Bass is a scored left hand, not a generic accompaniment fallback. The
 * sentence carries its root/fifth/tenth rhythm so the COMP pattern and bass
 * character change together while the root-on-downbeat contract remains hard. */
function bassEventsForSentence(
  sentenceId: AcgPianoCompSentenceId,
  gesture: AcgPianoCompGesture,
  spanDuration: number,
): readonly AcgPianoBassEvent[] {
  if (sentenceId === 'full-breath') return bassEventsForGesture('tacet', spanDuration);
  const at = (beatAtFour: number) => scaled(spanDuration, beatAtFour);
  const dur = (beatsAtFour: number) => Math.max(0.18, scaled(spanDuration, beatsAtFour));
  const fit = (events: readonly AcgPianoBassEvent[]): readonly AcgPianoBassEvent[] => events.flatMap((candidate) => {
    const atBeat = Math.max(0, Math.min(candidate.atBeat, spanDuration - 0.03));
    const room = spanDuration - atBeat - 0.02;
    if (room <= 0.01) return [];
    const durationBeats = Math.min(candidate.durationBeats, room);
    return durationBeats > 0.01 ? [{ ...candidate, atBeat, durationBeats }] : [];
  });
  const root: AcgPianoBassEvent = {
    atBeat: 0,
    durationBeats: Math.max(0.02, Math.min(Math.max(0.02, spanDuration - 0.05), dur(0.84))),
    voice: 'root',
    velocity: 0.46,
  };
  const rootPedal: AcgPianoBassEvent = { ...root, durationBeats: Math.max(0.42, spanDuration - 0.08) };
  const fifth = (beatAtFour: number, velocity = 0.27): AcgPianoBassEvent => ({
    atBeat: at(beatAtFour), durationBeats: dur(0.52), voice: 'fifth', velocity,
  });
  const tenth = (beatAtFour: number, velocity = 0.24): AcgPianoBassEvent => ({
    atBeat: at(beatAtFour), durationBeats: dur(0.50), voice: 'tenth', velocity,
  });

  switch (sentenceId) {
    case 'bare-root-space':
      return fit([{ ...rootPedal, velocity: 0.43 }]);
    case 'pedal-reveal':
      return fit([rootPedal, fifth(1.10, 0.24), tenth(2.86, 0.22)]);
    case 'slow-roll-reveal':
      return fit([root, fifth(1.92, 0.28), tenth(3.06, 0.23)]);
    case 'ripple-eighths':
      return fit([root, fifth(0.86), tenth(1.70), fifth(2.64, 0.25)]);
    case 'open-tenth-rise':
      return fit([root, tenth(1.24, 0.27), fifth(2.78, 0.26)]);
    case 'arch-wave':
      return fit([root, fifth(0.96), tenth(1.82, 0.25), fifth(2.88, 0.24)]);
    case 'turning-figure':
      return fit([root, fifth(1.52, 0.25), tenth(2.68, 0.24)]);
    case 'inner-counterline':
      return fit([rootPedal, fifth(2.24, 0.25)]);
    case 'descending-echo':
      return fit([root, tenth(1.68, 0.26), fifth(2.92, 0.25)]);
    case 'hook-pulse':
      return fit([root, fifth(0.50, 0.25), { ...root, atBeat: at(1.00), durationBeats: dur(0.42), velocity: 0.32 }, fifth(1.50, 0.24), tenth(2.00, 0.24), fifth(2.50, 0.23), { ...root, atBeat: at(3.00), durationBeats: dur(0.40), velocity: 0.31 }]);
    case 'offbeat-pulse':
      return fit([root, fifth(0.84, 0.24), tenth(1.84, 0.24), fifth(2.84, 0.23)]);
    case 'tremolo-color':
      return fit([root, fifth(0.62, 0.23), tenth(1.26, 0.23), fifth(1.92, 0.22), tenth(2.58, 0.22), fifth(3.18, 0.21)]);
    case 'block-push':
      return fit([{ ...root, durationBeats: dur(1.24), velocity: 0.48 }, fifth(2.00, 0.30), tenth(3.02, 0.26)]);
    case 'framed-arrival':
    case 'suspension-arrival':
      return fit([{ ...rootPedal, velocity: 0.47 }, fifth(1.22, 0.27), tenth(2.72, 0.24)]);
    case 'late-question':
    case 'dyad-riff':
      return fit([rootPedal, fifth(2.12, 0.23)]);
    case 'echo-tag':
      return fit([{ ...rootPedal, velocity: 0.43 }, fifth(2.62, 0.21)]);
  }
}

function motionForGesture(gesture: AcgPianoCompGesture): AcgPianoBassMotion {
  if (gesture === 'pedal-hold' || gesture === 'tacet') return 'pedal';
  if (gesture === 'arp-up' || gesture === 'broken-wave' || gesture === 'pulse') return 'ripple';
  if (gesture === 'arp-down') return 'stride';
  if (gesture === 'rolled-block' || gesture === 'block') return 'open-tenth';
  return 'root-anchor';
}

function motionForSentence(sentenceId: AcgPianoCompSentenceId, gesture: AcgPianoCompGesture): AcgPianoBassMotion {
  if (sentenceId === 'full-breath' || sentenceId === 'bare-root-space' || sentenceId === 'pedal-reveal' || sentenceId === 'inner-counterline' || sentenceId === 'echo-tag') return 'pedal';
  if (sentenceId === 'open-tenth-rise' || sentenceId === 'arch-wave' || sentenceId === 'ripple-eighths' || sentenceId === 'tremolo-color') return 'ripple';
  if (sentenceId === 'descending-echo') return 'stride';
  if (sentenceId === 'slow-roll-reveal' || sentenceId === 'framed-arrival' || sentenceId === 'suspension-arrival' || sentenceId === 'block-push') return 'open-tenth';
  return motionForGesture(gesture);
}

function bassMotionForScene(
  sceneId: AcgPianoOrchestrationSceneId,
  requested: AcgPianoBassMotion,
): AcgPianoBassMotion {
  const scene = acgPianoOrchestrationSceneForId(sceneId);
  return scene.bass.allowedMotion.includes(requested)
    ? requested
    : scene.bass.allowedMotion[0]!;
}

const SCORE_CONTINUITY_EPSILON = 1e-4;

function isAcgPianoSingleVoiceSelection(voices: AcgPianoVoiceSelection): boolean {
  return voices === 'low'
    || voices === 'inner-low'
    || voices === 'inner-high'
    || voices === 'high';
}

/**
 * Final score-writing pass for exposed single-note continuity.  It runs after
 * the Arranger has authored every comp/bass attack in this phrase slice and
 * before the score is handed to renderers.  It never creates an onset, spans
 * a harmonic boundary, or asks a renderer to infer a tail from NoteIR.
 */
function applyAcgPianoContinuityKnowledge(args: {
  sentenceId: AcgPianoCompSentenceId;
  gesture: AcgPianoCompGesture;
  segmentDuration: number;
  compEvents: readonly AcgPianoCompEvent[];
  bassEvents: readonly AcgPianoBassEvent[];
}): {
  compEvents: readonly AcgPianoCompEvent[];
  bassEvents: readonly AcgPianoBassEvent[];
} {
  const attacks = [...args.compEvents, ...args.bassEvents].map((event) => event.atBeat);
  const isTerminalCarrier = (atBeat: number): boolean => !attacks.some((attackBeat) =>
    attackBeat > atBeat + SCORE_CONTINUITY_EPSILON);
  const applyRule = <T extends { atBeat: number; durationBeats: number }>(
    event: T,
    rule: ReturnType<typeof resolveAcgPianoContinuityRule>,
  ): T => {
    if (!rule) return event;
    const availableUntilRelease = args.segmentDuration - rule.releaseGuardBeats - event.atBeat;
    if (availableUntilRelease <= event.durationBeats + SCORE_CONTINUITY_EPSILON) return event;

    if (rule.target === 'release-boundary') {
      return { ...event, durationBeats: availableUntilRelease };
    }

    // A minimum tail must actually fit before the score-owned release. It is
    // better to retain an intentional short cadence than silently cross a new
    // chord just to satisfy a duration target.
    if (availableUntilRelease < rule.minimumKeyDownBeats - SCORE_CONTINUITY_EPSILON) return event;
    return { ...event, durationBeats: Math.max(event.durationBeats, rule.minimumKeyDownBeats) };
  };

  return {
    compEvents: args.compEvents.map((event) => applyRule(event, resolveAcgPianoContinuityRule({
      role: 'comp',
      sentenceId: args.sentenceId,
      gesture: event.gesture,
      voice: event.voices,
      eventRole: event.role,
      isTerminalCarrier: isTerminalCarrier(event.atBeat),
      isSingleVoice: isAcgPianoSingleVoiceSelection(event.voices),
    }))),
    bassEvents: args.bassEvents.map((event) => applyRule(event, resolveAcgPianoContinuityRule({
      role: 'bass',
      sentenceId: args.sentenceId,
      gesture: args.gesture,
      voice: event.voice,
      isTerminalCarrier: isTerminalCarrier(event.atBeat),
      isSingleVoice: true,
    }))),
  };
}

function offsetCompEvents(events: readonly AcgPianoCompEvent[], offsetBeats: number): readonly AcgPianoCompEvent[] {
  return events.map((candidate) => ({ ...candidate, atBeat: candidate.atBeat + offsetBeats }));
}

function offsetBassEvents(events: readonly AcgPianoBassEvent[], offsetBeats: number): readonly AcgPianoBassEvent[] {
  return events.map((candidate) => ({ ...candidate, atBeat: candidate.atBeat + offsetBeats }));
}

function offsetSilenceWindows(windows: readonly AcgPianoSilenceWindow[], offsetBeats: number): readonly AcgPianoSilenceWindow[] {
  return windows.map((window) => ({
    ...window,
    startBeat: window.startBeat + offsetBeats,
    endBeat: window.endBeat + offsetBeats,
  }));
}

interface AcgPianoHandEventRef {
  role: 'comp' | 'bass';
  spanId: string;
  index: number;
  atBeat: number;
  durationBeats: number;
  spanEndBeat: number;
  /** A scored answer/pulse is short only because it resolves into nearby material. */
  connectedShortGesture: boolean;
}

function fastRunLengthAtBeat(onsets: readonly number[], targetBeat: number): number {
  const index = onsets.findIndex((beat) => Math.abs(beat - targetBeat) <= SCORE_CONTINUITY_EPSILON);
  if (index < 0) return 0;
  const maximumIoi = ACG_PIANO_REST_CONTINUITY_KNOWLEDGE.fastRunMaximumIoiBeats;
  let lo = index;
  let hi = index;
  while (lo > 0 && onsets[lo]! - onsets[lo - 1]! <= maximumIoi + SCORE_CONTINUITY_EPSILON) lo--;
  while (hi + 1 < onsets.length && onsets[hi + 1]! - onsets[hi]! <= maximumIoi + SCORE_CONTINUITY_EPSILON) hi++;
  return hi - lo + 1;
}

/**
 * Whole-score, per-hand continuity pass.  A COMP rest is still authored even
 * while the left hand moves, so the old segment-local combined attack test
 * cannot decide whether a middle-hand dyad is an exposed carrier.  This pass
 * labels every attack and lengthens only a genuinely exposed non-fast event,
 * bounded by its own harmonic release.
 */
function applyAcgPianoWholeScoreContinuity(args: {
  harmonic: HarmonicPlan;
  spanById: Readonly<Record<string, AcgPianoScoreSpan>>;
}): Record<string, AcgPianoScoreSpan> {
  const harmonicById = new Map(args.harmonic.chordTimeline.map((span) => [span.id, span]));
  const refs: AcgPianoHandEventRef[] = [];
  for (const [spanId, score] of Object.entries(args.spanById)) {
    const harmonic = harmonicById.get(spanId);
    if (!harmonic) continue;
    const startBeat = harmonic.startBeat as number;
    const spanEndBeat = startBeat + (harmonic.durationBeats as number);
    score.comp.events.forEach((event, index) => refs.push({
      role: 'comp', spanId, index, atBeat: startBeat + event.atBeat,
      durationBeats: event.durationBeats, spanEndBeat,
      connectedShortGesture: event.role === 'answer'
        || event.gesture === 'answer-dyad'
        || event.gesture === 'pulse',
    }));
    score.bass.events.forEach((event, index) => refs.push({
      role: 'bass', spanId, index, atBeat: startBeat + event.atBeat,
      durationBeats: event.durationBeats, spanEndBeat,
      connectedShortGesture: false,
    }));
  }

  const replacement = new Map<string, { durationBeats: number; continuity: AcgPianoWrittenContinuityIntent }>();
  for (const role of ['comp', 'bass'] as const) {
    const hand = refs.filter((ref) => ref.role === role)
      .sort((left, right) => left.atBeat - right.atBeat || left.spanId.localeCompare(right.spanId) || left.index - right.index);
    const onsets = [...new Set(hand.map((ref) => ref.atBeat))].sort((left, right) => left - right);
    for (const ref of hand) {
      const nextAttack = onsets.find((beat) => beat > ref.atBeat + SCORE_CONTINUITY_EPSILON);
      const restHorizon = nextAttack ?? ref.spanEndBeat;
      const restAfterKeyUpBeats = Math.max(0, restHorizon - (ref.atBeat + ref.durationBeats));
      const resolvedContinuity = resolveAcgPianoWrittenContinuity({
        durationBeats: ref.durationBeats,
        restAfterKeyUpBeats,
        fastRunAttackCount: fastRunLengthAtBeat(onsets, ref.atBeat),
      });
      const continuity: AcgPianoWrittenContinuityIntent = ref.connectedShortGesture
        && resolvedContinuity.continuityClass === 'exposed-carrier'
        ? { ...resolvedContinuity, continuityClass: 'connected' }
        : resolvedContinuity;
      let durationBeats = ref.durationBeats;
      if (continuity.continuityClass === 'exposed-carrier' && !ref.connectedShortGesture) {
        const releaseBeat = Math.min(nextAttack ?? ref.spanEndBeat, ref.spanEndBeat)
          - continuity.releaseGuardBeats;
        const available = Math.max(durationBeats, releaseBeat - ref.atBeat);
        // Prefer the full half-note carrier. When the harmony boundary is
        // nearer, use every legal key-down beat and let the shared damper
        // preserve the remaining acoustic tail.
        durationBeats = Math.max(durationBeats, Math.min(continuity.minimumKeyDownBeats, available));
      }
      replacement.set(`${role}:${ref.spanId}:${ref.index}`, { durationBeats, continuity });
    }
  }

  return Object.fromEntries(Object.entries(args.spanById).map(([spanId, score]) => [spanId, {
    ...score,
    comp: {
      ...score.comp,
      events: score.comp.events.map((event, index) => ({
        ...event,
        ...(replacement.get(`comp:${spanId}:${index}`) ?? {}),
      })),
    },
    bass: {
      ...score.bass,
      events: score.bass.events.map((event, index) => ({
        ...event,
        ...(replacement.get(`bass:${spanId}:${index}`) ?? {}),
      })),
    },
  }]));
}

/** Merge phrase-owned segments back into the one harmonic span consumed by renderers. */
function mergePhraseSegmentIntoScoreSpan(
  existing: AcgPianoScoreSpan | undefined,
  segment: AcgPianoScoreSpan,
): AcgPianoScoreSpan {
  if (!existing) return segment;
  const compEvents = [...existing.comp.events, ...segment.comp.events]
    .sort((left, right) => left.atBeat - right.atBeat || left.id.localeCompare(right.id));
  const bassEvents = [...existing.bass.events, ...segment.bass.events]
    .sort((left, right) => left.atBeat - right.atBeat || left.voice.localeCompare(right.voice));
  const activeGesture = existing.comp.gesture !== 'tacet' ? existing.comp.gesture : segment.comp.gesture;
  return {
    ...existing,
    upwardArpeggioLanding: existing.upwardArpeggioLanding || segment.upwardArpeggioLanding,
    comp: {
      ...existing.comp,
      maxVoices: Math.max(existing.comp.maxVoices, segment.comp.maxVoices),
      gesture: compEvents.length > 0 ? activeGesture : 'tacet',
      events: compEvents,
      silenceWindows: [...existing.comp.silenceWindows, ...segment.comp.silenceWindows]
        .sort((left, right) => left.startBeat - right.startBeat || left.endBeat - right.endBeat),
    },
    bass: {
      ...existing.bass,
      maxNotesPerSpan: bassEvents.length,
      events: bassEvents,
    },
  };
}

type AcgPianoSurfaceFamily = AcgPianoCompSurfaceFamily;
type AcgPianoProfileSurfaceFamily = 'air' | 'ripple' | 'pulse' | 'vertical' | 'answer';

const MAX_CONSECUTIVE_MIDDLE_BROKEN_SPANS = 5;

function isMiddlePhase(phase: AcgPianoScorePhase): boolean {
  return phase === 'development' || phase === 'lift' || phase === 'return';
}

function surfaceFamilyForGesture(gesture: AcgPianoCompGesture): AcgPianoSurfaceFamily {
  if (gesture === 'arp-up' || gesture === 'arp-down' || gesture === 'broken-wave') return 'broken-motion';
  if (gesture === 'block' || gesture === 'rolled-block') return 'vertical';
  if (gesture === 'pulse') return 'pulse';
  if (gesture === 'answer-dyad') return 'answer';
  return 'air';
}

interface AcgMiddleSurfaceBudget {
  consecutiveBrokenSpans: number;
}

interface AcgPianoPhraseAirBudget {
  fullTacetSpansByPhrase: Map<string, number>;
  consecutiveFullTacetByPhrase: Map<string, number>;
}

function fallbackGestureForScene(
  scene: AcgPianoPhraseOrchestrationRule,
  arrival: boolean,
): AcgPianoCompGesture {
  const candidates: readonly AcgPianoCompGesture[] = [
    ...(arrival ? ['rolled-block' as const] : []),
    scene.comp.fullTacetFallback,
    'broken-wave',
    'pulse',
    'pedal-hold',
  ];
  return candidates.find((candidate) =>
    scene.comp.allowedSurfaceFamilies.includes(surfaceFamilyForGesture(candidate)))
    ?? scene.comp.fullTacetFallback;
}

/**
 * Execute the arranger KB after profile/cadence selection but before a
 * sentence is compiled. A rest that exceeds the scene budget becomes a
 * written middle-register carrier; no renderer is asked to fill the hole.
 */
function enforcePhraseOrchestrationRule(args: {
  phrase: AcgPianoPhrasePlan;
  gesture: AcgPianoCompGesture;
  arrival: boolean;
  budget: AcgPianoPhraseAirBudget;
}): AcgPianoCompGesture {
  const scene = acgPianoOrchestrationSceneForId(args.phrase.orchestrationSceneId);
  let gesture = args.gesture;
  if (!scene.comp.allowedSurfaceFamilies.includes(surfaceFamilyForGesture(gesture))) {
    gesture = fallbackGestureForScene(scene, args.arrival);
  }

  const phraseId = args.phrase.phraseId;
  if (gesture !== 'tacet') {
    args.budget.consecutiveFullTacetByPhrase.set(phraseId, 0);
    return gesture;
  }

  const used = args.budget.fullTacetSpansByPhrase.get(phraseId) ?? 0;
  const consecutive = args.budget.consecutiveFullTacetByPhrase.get(phraseId) ?? 0;
  if (used >= scene.comp.maxFullTacetSpansPerPhrase
    || consecutive >= scene.comp.maxConsecutiveFullTacetSpans) {
    args.budget.consecutiveFullTacetByPhrase.set(phraseId, 0);
    return fallbackGestureForScene(scene, args.arrival);
  }

  args.budget.fullTacetSpansByPhrase.set(phraseId, used + 1);
  args.budget.consecutiveFullTacetByPhrase.set(phraseId, consecutive + 1);
  return gesture;
}

/**
 * A cue may sustain broken motion, but not indefinitely.  This is still part
 * of the arranger's one-pass score writing: when a middle sentence has spent
 * its broken-motion budget, the next slot is authored as a contrasting hand
 * shape before accompaniment rendering sees it.
 */
function enforceMiddleSurfaceBudget(args: {
  seed: number;
  phrase: AcgPianoPhrasePlan;
  spanIndex: number;
  arrival: boolean;
  gesture: AcgPianoCompGesture;
  budget: AcgMiddleSurfaceBudget;
}): AcgPianoCompGesture {
  const { seed, phrase, spanIndex, arrival, budget } = args;
  if (!isMiddlePhase(phrase.phase)) {
    budget.consecutiveBrokenSpans = 0;
    return args.gesture;
  }

  let gesture = args.gesture;
  if (surfaceFamilyForGesture(gesture) === 'broken-motion'
    && budget.consecutiveBrokenSpans >= MAX_CONSECUTIVE_MIDDLE_BROKEN_SPANS) {
    const candidates: readonly AcgPianoCompGesture[] = arrival
      ? ['rolled-block', 'block']
      : phrase.phase === 'development'
        ? ['pulse', 'rolled-block', 'pedal-hold']
        : phrase.phase === 'lift'
          ? ['rolled-block', 'pulse']
          : ['rolled-block', 'block', 'pedal-hold'];
    gesture = choose(seed, `${phrase.phraseId}|${spanIndex}|middle-surface-contrast`, candidates);
  }

  budget.consecutiveBrokenSpans = surfaceFamilyForGesture(gesture) === 'broken-motion'
    ? budget.consecutiveBrokenSpans + 1
    : 0;
  return gesture;
}

/**
 * The hidden song profile names an arc such as air → ripple → answer →
 * vertical. At each middle-phrase entrance it supplies a concrete contrast
 * target before the score is written. This is intentionally upstream of the
 * renderers and subordinate to scheduler-owned answer/rest contracts.
 */
function applyProfileMiddleSurfaceTarget(args: {
  seed: number;
  phrase: AcgPianoPhrasePlan;
  spanIndex: number;
  phraseOrdinal: number | undefined;
  profileArc: readonly AcgPianoProfileSurfaceFamily[];
  arrival: boolean;
  hasLeadAnswerWindow: boolean;
  gesture: AcgPianoCompGesture;
}): AcgPianoCompGesture {
  const {
    seed, phrase, spanIndex, phraseOrdinal, profileArc,
    arrival, hasLeadAnswerWindow, gesture,
  } = args;
  if (!isMiddlePhase(phrase.phase) || spanIndex !== 0 || arrival || profileArc.length === 0) return gesture;
  if (phrase.lead.interlock.whenLeadActive === 'tacet') return gesture;
  const target = profileArc[(phraseOrdinal ?? 0) % profileArc.length];
  if (target === 'answer') return hasLeadAnswerWindow ? 'answer-dyad' : 'pedal-hold';
  if (target === 'air') return 'pedal-hold';
  if (target === 'pulse') return 'pulse';
  if (target === 'vertical') return 'rolled-block';
  return choose(seed, `${phrase.phraseId}|${spanIndex}|profile-ripple`, ['arp-up', 'broken-wave']);
}

function gestureForSpan(args: {
  phraseGesture: AcgPianoPhraseGesture;
  spanIndex: number;
  spanCount: number;
  arrival: boolean;
  hasLeadAnswerWindow: boolean;
  phrase: AcgPianoPhrasePlan;
}): AcgPianoCompGesture {
  const { phraseGesture, spanIndex, spanCount, arrival, hasLeadAnswerWindow, phrase } = args;
  if (hasLeadAnswerWindow && phrase.lead.interlock.whenLeadRest !== 'underlay') {
    if (phrase.lead.interlock.whenLeadRest === 'shared-rest') return 'tacet';
    // A phrase whose active lead policy is tacet may only speak inside this
    // exact scheduler-owned breath; do not let a supporting arp spill back
    // into the active top line around a partial window.
    if (phrase.lead.interlock.whenLeadActive === 'tacet') return 'answer-dyad';
    return spanIndex % 2 === 0 ? 'answer-dyad' : 'arp-down';
  }
  if (phrase.lead.interlock.whenLeadActive === 'tacet') return 'tacet';
  const plannedSurface = phrase.spanGestureCycle?.length
    ? phrase.spanGestureCycle[spanIndex % phrase.spanGestureCycle.length]
    : undefined;
  if (arrival) {
    if (phraseGesture === 'block-arrival') return 'block';
    // A D→T cadence may retain its upward landing, but it must also honour the
    // phrase's prewritten contrast slot.  Otherwise dense dominant chains
    // overwrite every pulse/block/rest surface with the same arp-up sentence.
    if (plannedSurface === 'block' || plannedSurface === 'rolled-block') return plannedSurface;
    if (plannedSurface === 'pulse' || plannedSurface === 'tacet') return 'rolled-block';
    if (phraseGesture === 'broken-ten-lift' || phraseGesture === 'ripple-call') return 'arp-up';
    // No scheduler-owned breath means a dyad answer is forbidden. Retain the
    // phrase's downward energy as a genuine underlay instead.
    if (phraseGesture === 'downward-answer') return 'arp-down';
    if (phraseGesture === 'ostinato-development') return 'broken-wave';
    return 'pedal-hold';
  }
  if (plannedSurface) return plannedSurface;
  // Backward-compatible fallback for deliberately partial test fixtures.
  if (phraseGesture === 'pedal-breath') return spanIndex === 0 ? 'pedal-hold' : 'tacet';
  if (phraseGesture === 'release-coda') return spanIndex === 0 ? 'pedal-hold' : 'tacet';
  if (phraseGesture === 'ripple-call') return spanIndex === spanCount - 1 && phrase.formRole === 'antecedent' ? 'tacet' : (spanIndex % 2 === 0 ? 'arp-up' : 'broken-wave');
  if (phraseGesture === 'broken-ten-lift') return spanIndex % 2 === 0 ? 'broken-wave' : 'arp-up';
  if (phraseGesture === 'downward-answer') return spanIndex % 2 === 0 ? 'arp-down' : 'broken-wave';
  if (phraseGesture === 'ostinato-development') return spanIndex % 3 === 2 ? 'broken-wave' : 'pulse';
  return spanIndex === spanCount - 1 ? 'block' : 'rolled-block';
}

type AcgPianoSurfaceProgram = AcgPianoArrangementProfileId;

function subsetForSurfaceProgram(program: AcgPianoSurfaceProgram): ArrangementSubset {
  const id: AcgPianoArrangementVariantId = program === 'motif-first'
    ? 'pulse-to-wave'
    : program === 'dialogue-breath'
      ? 'answering-steps'
    : program === 'wide-cinema' || program === 'descending-memory'
      ? 'open-tenths'
      : 'ripple-cantabile';
  return ACG_PIANO_ARRANGEMENT_SUBSETS.find((candidate) => candidate.id === id)
    ?? ACG_PIANO_ARRANGEMENT_SUBSETS[0]!;
}

function weightedSentenceCandidates(
  candidates: readonly AcgPianoCompSentenceId[],
  preferred: readonly AcgPianoCompSentenceId[],
): readonly AcgPianoCompSentenceId[] {
  const allowedPreferred = preferred.filter((candidate) => candidates.includes(candidate));
  // Repeating a candidate here is a deliberate *arranger* weighting decision,
  // not renderer-side randomization. A profile remains recognisable across a
  // cue while the remaining choices still prevent mechanical repetition.
  return allowedPreferred.length > 0
    ? [...allowedPreferred, ...candidates]
    : candidates;
}

function sentenceCandidatesForSpan(args: {
  gesture: AcgPianoCompGesture;
  phase: AcgPianoScorePhase;
  profile: AcgPianoSurfaceProgram;
  arrival: boolean;
  hasLeadAnswerWindow: boolean;
}): readonly AcgPianoCompSentenceId[] {
  const { gesture, phase, profile, arrival, hasLeadAnswerWindow } = args;
  if (gesture === 'tacet') return ['full-breath'];
  if (gesture === 'answer-dyad') return hasLeadAnswerWindow ? ['late-question', 'dyad-riff'] : ['full-breath'];

  if (phase === 'opening') {
    if (gesture === 'pedal-hold') {
      return weightedSentenceCandidates(
        ['bare-root-space', 'pedal-reveal'],
        profile === 'ripple-journey' ? ['bare-root-space'] : ['pedal-reveal'],
      );
    }
    if (gesture === 'arp-up') {
      return weightedSentenceCandidates(
        ['ripple-eighths', 'open-tenth-rise'],
        profile === 'wide-cinema' ? ['open-tenth-rise'] : ['ripple-eighths'],
      );
    }
    if (gesture === 'broken-wave') return ['arch-wave', 'turning-figure'];
    if (gesture === 'pulse') return ['hook-pulse', 'offbeat-pulse'];
    if (gesture === 'rolled-block') return ['slow-roll-reveal', 'suspension-arrival'];
  }

  if (phase === 'coda') {
    if (gesture === 'pedal-hold') {
      return weightedSentenceCandidates(
        ['pedal-reveal', 'bare-root-space'],
        profile === 'ripple-journey' ? ['pedal-reveal'] : ['bare-root-space'],
      );
    }
    if (gesture === 'arp-down') return ['descending-echo'];
    if (gesture === 'rolled-block') {
      return weightedSentenceCandidates(
        ['suspension-arrival', 'echo-tag'],
        profile === 'wide-cinema' ? ['suspension-arrival'] : profile === 'descending-memory' ? ['echo-tag', 'suspension-arrival'] : ['echo-tag'],
      );
    }
    if (gesture === 'block') return ['framed-arrival', 'block-push'];
  }

  switch (gesture) {
    case 'pedal-hold':
      return ['pedal-reveal', 'bare-root-space'];
    case 'arp-up':
      return weightedSentenceCandidates(
        ['ripple-eighths', 'open-tenth-rise'],
        profile === 'wide-cinema' ? ['open-tenth-rise'] : ['ripple-eighths'],
      );
    case 'arp-down':
      return ['descending-echo'];
    case 'broken-wave':
      return weightedSentenceCandidates(
        ['arch-wave', 'turning-figure', 'inner-counterline'],
        profile === 'wide-cinema'
          ? ['arch-wave']
          : profile === 'motif-first' || profile === 'dialogue-breath'
            ? ['turning-figure']
            : ['inner-counterline'],
      );
    case 'pulse':
      return weightedSentenceCandidates(
        phase === 'lift' ? ['hook-pulse', 'offbeat-pulse', 'tremolo-color'] : ['hook-pulse', 'offbeat-pulse'],
        profile === 'motif-first' ? ['hook-pulse', 'tremolo-color'] : ['offbeat-pulse'],
      );
    case 'rolled-block':
      return weightedSentenceCandidates(
        ['slow-roll-reveal', 'framed-arrival', 'suspension-arrival'],
        arrival ? ['suspension-arrival'] : profile === 'ripple-journey' ? ['slow-roll-reveal'] : ['framed-arrival'],
      );
    case 'block':
      return weightedSentenceCandidates(
        ['block-push', 'framed-arrival'],
        arrival ? ['framed-arrival'] : ['block-push'],
      );
  }
}

function chooseSentenceForSpan(args: {
  seed: number;
  phrase: AcgPianoPhrasePlan;
  spanId: string;
  spanIndex: number;
  gesture: AcgPianoCompGesture;
  arrival: boolean;
  hasLeadAnswerWindow: boolean;
  profile: AcgPianoSurfaceProgram;
  previousSentence?: AcgPianoCompSentenceId;
}): AcgPianoCompSentenceId {
  const candidates = sentenceCandidatesForSpan({ ...args, phase: args.phrase.phase });
  const contrasting = candidates.filter((candidate) => candidate !== args.previousSentence);
  return choose(
    args.seed,
    `${args.phrase.phraseId}|${args.spanId}|${args.spanIndex}|${args.gesture}|sentence`,
    contrasting.length > 0 ? contrasting : candidates,
  );
}

function textureForSentence(
  seed: number,
  subset: ArrangementSubset,
  phrase: AcgPianoPhrasePlan,
  sentenceId: AcgPianoCompSentenceId,
  gesture: AcgPianoCompGesture,
  spanId: string,
  contract?: GrooveTextureContract,
): AcgPianoTextureCase {
  const requested: readonly AcgPianoTextureCase[] | undefined = sentenceId === 'bare-root-space' || sentenceId === 'pedal-reveal'
    ? ['ACG_Pedal_Wash_Color_Drops', 'Piano_TopVoice_Planing']
    : sentenceId === 'slow-roll-reveal'
      ? ['Piano_TopVoice_Planing', 'ACG_Suspended_Block_Arrival']
      : sentenceId === 'ripple-eighths' || sentenceId === 'arch-wave'
        ? ['ACG_Quartal_Arp_Wave', 'ACG_Open_Broken_10th']
        : sentenceId === 'open-tenth-rise'
          ? ['ACG_Open_Broken_10th', 'ACG_Quartal_Arp_Wave']
          : sentenceId === 'turning-figure' || sentenceId === 'inner-counterline'
            ? ['ACG_Sakamoto_LH_Arp_RH_Penta', 'ACG_Quartal_Arp_Wave']
            : sentenceId === 'descending-echo'
              ? ['Piano_TopVoice_Planing', 'ACG_Stride_Cantabile_Ballad']
              : sentenceId === 'hook-pulse' || sentenceId === 'offbeat-pulse'
                ? ['ACG_Ostinato_Hook_Pulse', 'ACG_Quartal_Arp_Wave']
                : sentenceId === 'tremolo-color'
                  ? ['ACG_Bass_Tremolo_Color', 'ACG_Quartal_Arp_Wave']
                  : sentenceId === 'block-push'
                    ? ['ACG_Anthem_Block_Push', 'ACG_Suspended_Block_Arrival']
                    : sentenceId === 'framed-arrival' || sentenceId === 'suspension-arrival'
                      ? ['ACG_Suspended_Block_Arrival', 'ACG_Anthem_Block_Push']
                      : sentenceId === 'late-question' || sentenceId === 'dyad-riff'
                        ? ['ACG_Stride_Cantabile_Ballad', 'Piano_TopVoice_Planing']
                        : sentenceId === 'echo-tag'
                          ? ['Piano_TopVoice_Planing', 'ACG_Pedal_Wash_Color_Drops']
                          : undefined;
  if (!requested) return textureForGesture(seed, subset, phrase, gesture, spanId, contract);
  return chooseAllowed(seed, `${subset.id}|${phrase.phraseId}|${spanId}|${sentenceId}`, requested, contract, subset.songPalette);
}

function textureForGesture(
  seed: number,
  subset: ArrangementSubset,
  phrase: AcgPianoPhrasePlan,
  gesture: AcgPianoCompGesture,
  spanId: string,
  contract?: GrooveTextureContract,
): AcgPianoTextureCase {
  const requested: readonly AcgPianoTextureCase[] = gesture === 'pedal-hold' || gesture === 'tacet'
    ? ['ACG_Pedal_Wash_Color_Drops', 'Piano_TopVoice_Planing']
    : gesture === 'arp-up'
      ? subset.upward
      : gesture === 'arp-down'
        ? ['Piano_TopVoice_Planing', 'ACG_Stride_Cantabile_Ballad', 'ACG_Sakamoto_LH_Arp_RH_Penta']
        : gesture === 'broken-wave'
          ? ['ACG_Open_Broken_10th', 'ACG_Quartal_Arp_Wave']
          : gesture === 'pulse'
            ? ['ACG_Ostinato_Hook_Pulse', 'ACG_Quartal_Arp_Wave']
            : gesture === 'block'
              ? ['ACG_Anthem_Block_Push', 'ACG_Suspended_Block_Arrival']
              : gesture === 'rolled-block'
                ? subset.arrivals
                : gesture === 'answer-dyad'
                  ? ['ACG_Stride_Cantabile_Ballad', 'Piano_TopVoice_Planing']
                  : subset.palette[phrase.phase];
  return chooseAllowed(seed, `${subset.id}|${phrase.phraseId}|${spanId}|${gesture}`, requested, contract, subset.songPalette);
}

/** Shared rule used by generation and direct renderer tests; no hidden render-side section choice. */
export function activeAcgPianoSectionIds(
  instrumentation: Pick<InstrumentationPlan, 'textureBySection' | 'textureYieldPolicy' | 'activeRolesBySection'>,
): Set<string> {
  const active = new Set<string>();
  for (const [sectionId, texture] of Object.entries(instrumentation.textureBySection)) {
    const roles = instrumentation.activeRolesBySection[sectionId] ?? [];
    const compFallback = roles.includes('comp') && !roles.includes('pad');
    if (instrumentation.textureYieldPolicy[texture] === 'active' || compFallback) active.add(sectionId);
  }
  return active;
}

const SCORE_PEDAL_EPSILON = 1e-4;

interface AcgPianoPedalAirCandidate {
  phraseId: string;
  phase: AcgPianoScorePhase;
  startBeat: number;
  endBeat: number;
}

/**
 * The phrase score already knows which spans are intentional air.  A single
 * such span is covered by the normal harmony pedal; two or more contiguous
 * air spans inside one phrase deserve one continuous damper interval.  This
 * lets an opening root or quiet dyad bloom through the written silence without
 * teaching the renderer to inspect or repair final notes.
 */
function compileSharedPedalHolds(
  candidates: readonly AcgPianoPedalAirCandidate[],
): readonly AcgPianoPedalHold[] {
  const ordered = [...candidates].sort((left, right) => left.startBeat - right.startBeat || left.endBeat - right.endBeat);
  const holds: AcgPianoPedalHold[] = [];
  let current: (AcgPianoPedalAirCandidate & { spanCount: number }) | undefined;

  const flush = (): void => {
    if (!current || current.spanCount < 2 || current.endBeat <= current.startBeat + SCORE_PEDAL_EPSILON) return;
    holds.push({
      startBeat: current.startBeat,
      endBeat: current.endBeat,
      reason: current.phase === 'opening'
        ? 'opening-afterglow'
        : current.phase === 'coda'
          ? 'coda-dissolve'
          : 'phrase-air',
    });
  };

  for (const candidate of ordered) {
    const continuesCurrent = current
      && current.phraseId === candidate.phraseId
      && candidate.startBeat <= current.endBeat + SCORE_PEDAL_EPSILON;
    if (!continuesCurrent) {
      flush();
      current = { ...candidate, spanCount: 1 };
      continue;
    }
    current.endBeat = Math.max(current.endBeat, candidate.endBeat);
    current.spanCount += 1;
  }
  flush();
  return holds;
}

/** A long carry may cross only a literal repeated harmony. Changed roots or
 * chord qualities must be re-pedalled by the final three-hand pedal score. */
function retainHarmonicallySafeSharedPedalHolds(
  holds: readonly AcgPianoPedalHold[],
  harmonic: HarmonicPlan,
): readonly AcgPianoPedalHold[] {
  const spans = [...harmonic.chordTimeline]
    .sort((left, right) => (left.startBeat as number) - (right.startBeat as number));
  const identity = (span: (typeof spans)[number]): string => [
    span.rootPc as number,
    span.chordType ?? span.quality,
    span.bassPc as number | undefined,
    span.bassRole,
    span.bassPedalPc as number | undefined,
  ].join('|');
  return holds.filter((hold) => {
    const crossed = spans.filter((span) => {
      const start = span.startBeat as number;
      return start > hold.startBeat + SCORE_PEDAL_EPSILON
        && start < hold.endBeat - SCORE_PEDAL_EPSILON;
    });
    return crossed.every((target) => {
      const targetIndex = spans.findIndex((span) => span.id === target.id);
      const source = spans[targetIndex - 1];
      return !!source && identity(source) === identity(target) && source.sectionId === target.sectionId;
    });
  });
}

function isSharedPedalAirSentence(
  sentenceId: AcgPianoCompSentenceId,
  gesture: AcgPianoCompGesture,
): boolean {
  return gesture === 'pedal-hold'
    || gesture === 'tacet'
    || sentenceId === 'bare-root-space'
    || sentenceId === 'pedal-reveal';
}

function buildAcgPianoMetricGrid(args: {
  arrangement: ArrangementPlan;
  harmonic: HarmonicPlan;
  phraseById: Readonly<Record<string, AcgPianoPhrasePlan>>;
}): AcgPianoMetricGrid {
  const beatsPerBar = args.arrangement.meter.numerator * (4 / args.arrangement.meter.denominator);
  const grooveBarByAbsoluteBar = new Map<number, GrooveBarScore>();
  for (const sectionScore of Object.values(args.arrangement.grooveScorePlan?.bySection ?? {})) {
    for (const bar of sectionScore.bars) grooveBarByAbsoluteBar.set(bar.absoluteBar, bar);
  }
  const totalBeats = Math.max(
    args.arrangement.sections.reduce((sum, section) => sum + section.bars * beatsPerBar, 0),
    ...args.harmonic.chordTimeline.map((span) => (span.startBeat as number) + (span.durationBeats as number)),
    0,
  );
  const phrases = Object.values(args.phraseById);
  const candidateBeats = new Set<number>();
  for (let beat = 0; beat < totalBeats - 1e-6; beat += ACG_PIANO_METRIC_KNOWLEDGE.subdivisionBeats) {
    candidateBeats.add(Math.round(beat * 1_000_000) / 1_000_000);
  }
  for (const span of args.harmonic.chordTimeline) candidateBeats.add(span.startBeat as number);
  for (const phrase of phrases) candidateBeats.add(phrase.startBeat);

  const anchors = [...candidateBeats]
    .sort((left, right) => left - right)
    .map((beat): AcgPianoMetricAnchor | null => {
      if (beat < -1e-6 || beat >= totalBeats - 1e-6) return null;
      const bar = Math.max(0, Math.floor((beat + 1e-6) / beatsPerBar));
      const beatInBar = beat - bar * beatsPerBar;
      const harmonicSpan = args.harmonic.chordTimeline.find((span) => {
        const start = span.startBeat as number;
        return beat >= start - 1e-6 && beat < start + (span.durationBeats as number) - 1e-6;
      });
      const phrase = phrases.find((candidate) =>
        beat >= candidate.startBeat - 1e-6 && beat < candidate.endBeat - 1e-6);
      const phraseStartsHere = phrase && Math.abs(phrase.startBeat - beat) <= 1e-6;
      const harmonyStartsHere = harmonicSpan
        && Math.abs((harmonicSpan.startBeat as number) - beat) <= 1e-6;
      const onIntegerBeat = Math.abs(beatInBar - Math.round(beatInBar)) <= 1e-6;
      const beatIndex = Math.max(0, Math.round(beatInBar));
      const grooveBar = grooveBarByAbsoluteBar.get(bar);
      const onEighthBeat = Math.abs(beatInBar * 2 - Math.round(beatInBar * 2)) <= 1e-6;
      const rawStrength = onIntegerBeat
        ? grooveBar?.beatStrength[beatIndex] ?? (beatIndex === 0 ? 1 : beatIndex === Math.floor(beatsPerBar / 2) ? 0.92 : 0.72)
        : onEighthBeat ? 0.52 : 0.42;
      const strength = phraseStartsHere
        ? 1
        : harmonyStartsHere
          ? Math.max(0.94, Math.min(1, rawStrength))
          : Math.max(0.35, Math.min(1, rawStrength));
      const kind: AcgPianoMetricAnchorKind = phraseStartsHere
        ? 'phrase-arrival'
        : harmonyStartsHere
          ? 'harmonic-arrival'
          : Math.abs(beatInBar) <= 1e-6
            ? 'bar-downbeat'
            : onIntegerBeat && strength >= 0.9
              ? 'secondary-strong-beat'
              : 'weak-beat';
      const sectionId = harmonicSpan?.sectionId ?? phrase?.sectionId;
      if (!sectionId) return null;
      return {
        id: `acg-metric-${Math.round(beat * 1000)}`,
        beat,
        bar,
        beatInBar,
        kind,
        strength,
        sectionId,
        ...(harmonicSpan ? { spanId: harmonicSpan.id } : {}),
        ...(phrase ? { phraseId: phrase.phraseId } : {}),
        // Authorization, not an obligation to attack: written rests remain rests.
        roles: ['bass', 'comp', 'lead'],
      };
    })
    .filter((anchor): anchor is AcgPianoMetricAnchor => anchor !== null);

  return {
    beatsPerBar,
    subdivisionBeats: ACG_PIANO_METRIC_KNOWLEDGE.subdivisionBeats,
    expressiveOffsetLimitBeats: ACG_PIANO_METRIC_KNOWLEDGE.expressiveOffsetLimitBeats,
    compEntryLimitBeats: ACG_PIANO_METRIC_KNOWLEDGE.compEntryLimitBeats,
    rollSpreadLimitBeats: ACG_PIANO_METRIC_KNOWLEDGE.rollSpreadLimitBeats,
    anchors,
  };
}

/**
 * Build the authoritative ACG piano phrase score. Randomness is consumed only
 * here (via deterministic seed hashing); renderer-facing events are complete
 * timing/attack/density instructions, never texture renderer guesses.
 */
export function buildAcgPianoScorePlan(args: {
  seed: number;
  arrangement: ArrangementPlan;
  harmonic: HarmonicPlan;
  activeSectionIds: ReadonlySet<string>;
  grooveContract?: GrooveTextureContract;
  roadMap?: RoadMap;
  leadPresencePlan?: AcgLeadPresencePlan;
}): AcgPianoScorePlan {
  // A profile is picked once by the Arranger (and is hidden from the UI).  It
  // must drive the real score vocabulary too; otherwise different profile
  // labels merely report variation while every cue plays the same hand shape.
  const arrangementProfile = acgPianoArrangementProfileForId(args.arrangement.acgPianoArrangementProfileId);
  const surfaceProgram = arrangementProfile.id;
  const subset = subsetForSurfaceProgram(surfaceProgram);
  const phases = sectionPhases(args.arrangement);
  const phraseStarts = phraseStartBeats(args.arrangement);
  const phraseById: Record<string, AcgPianoPhrasePlan> = {};
  const phraseIdBySpan: Record<string, string> = {};
  let previousGesture: AcgPianoPhraseGesture | undefined;

  for (const phrase of args.arrangement.phrases) {
    const startBeat = phraseStarts[phrase.id] ?? 0;
    const endBeat = startBeat + phrase.bars * args.arrangement.meter.numerator * (4 / args.arrangement.meter.denominator);
    const phase = phases.get(phrase.sectionId) ?? 'statement';
    const leadSilence = leadWindowsForPhrase(startBeat, endBeat, args.leadPresencePlan);
    const binding = phraseBinding(args.roadMap, startBeat, endBeat);
    const orchestrationScene = resolveAcgPianoOrchestrationScene({
      phase,
      hasLeadRest: leadSilence.length > 0,
      cadenceTarget: phrase.cadenceTarget,
    });
    const gesture = choosePhraseGesture(args.seed, phrase, phase, leadSilence.length > 0, previousGesture, surfaceProgram);
    const spanGestureCycle = spanGestureCycleForPhrase(
      args.seed,
      phrase,
      phase,
      gesture,
      surfaceProgram,
      arrangementProfile.openingStrategy,
    );
    const grammarSubset = grammarSubsetForScene(
      grammarSubsetForPhrase(phase, gesture, binding),
      orchestrationScene,
    );
    const continuityProfile = resolveAcgPianoLeadContinuityProfile({
      phase,
      phraseGesture: gesture,
      cadenceTarget: phrase.cadenceTarget,
      grammarSubset,
      hasPlannedLeadSilence: leadSilence.length > 0,
    });
    const explicitRestatement = !!phrase.repeatGroup && previousGesture !== undefined;
    // Signature intentionally describes the audible hand-shape, not the seed.
    // Adjacent phrases are checked against it so an ACG cue cannot disguise a
    // repeated comp sentence behind a different random identifier.
    const surfaceSignature = `${orchestrationScene.id}:${gesture}:${spanGestureCycle.join('>')}:${grammarSubset}:${phrase.cadenceTarget}`;
    phraseById[phrase.id] = {
      phraseId: phrase.id,
      sectionId: phrase.sectionId,
      startBeat,
      endBeat,
      phase,
      formRole: phrase.role,
      cadenceTarget: phrase.cadenceTarget,
      gesture,
      spanGestureCycle,
      surfaceSignature,
      repeatPolicy: explicitRestatement ? 'explicit-restatement' : 'forbid-adjacent-repeat',
      roadMapBinding: binding,
      orchestrationSceneId: orchestrationScene.id,
      lead: {
        grammarSubset,
        returnShapes: returnShapesForPhrase(phase, gesture),
        continuityProfile,
        silenceWindows: leadSilence,
        interlock: {
          // `middle-underlay` and `lower-shell` are both audible COMP support;
          // their concrete density is expressed by the span sentence below.
          whenLeadActive: 'underlay',
          whenLeadRest: orchestrationScene.comp.whenLeadRest === 'shared-rest'
            ? 'shared-rest'
            : orchestrationScene.comp.whenLeadRest === 'continue-underlay'
              ? 'underlay'
              : 'answer',
        },
      },
    };
    previousGesture = gesture;
  }

  const phrasesBySection = new Map<string, AcgPianoPhrasePlan[]>();
  for (const phrase of Object.values(phraseById)) {
    const list = phrasesBySection.get(phrase.sectionId) ?? [];
    list.push(phrase);
    phrasesBySection.set(phrase.sectionId, list);
  }
  for (const list of phrasesBySection.values()) list.sort((a, b) => a.startBeat - b.startBeat);
  const metricGrid = buildAcgPianoMetricGrid({
    arrangement: args.arrangement,
    harmonic: args.harmonic,
    phraseById,
  });
  const middlePhraseOrdinalById = new Map<string, number>();
  let middlePhraseOrdinal = 0;
  for (const phrase of Object.values(phraseById).sort((left, right) => left.startBeat - right.startBeat)) {
    if (!isMiddlePhase(phrase.phase)) continue;
    middlePhraseOrdinalById.set(phrase.phraseId, middlePhraseOrdinal++);
  }

  const textureBySpan: Record<string, AcgPianoTextureCase> = {};
  const spanById: Record<string, AcgPianoScoreSpan> = {};
  const phraseIdsBySpan: Record<string, readonly string[]> = {};
  const sharedPedalAirCandidates: AcgPianoPedalAirCandidate[] = [];
  // A D span queues its terminal for the next T span. This keeps every event
  // inside the score span that owns its sounding harmony and avoids renderer
  // side cross-span scheduling.
  const pendingTargetArrivalsBySpanId: Record<string, readonly AcgPianoCompEvent[]> = {};
  const middleSurfaceBudget: AcgMiddleSurfaceBudget = { consecutiveBrokenSpans: 0 };
  const phraseAirBudget: AcgPianoPhraseAirBudget = {
    fullTacetSpansByPhrase: new Map(),
    consecutiveFullTacetByPhrase: new Map(),
  };
  const sentenceIdsByPhrase = new Map<string, AcgPianoCompSentenceId[]>();
  let previousSentenceId: AcgPianoCompSentenceId | undefined;
  const timeline = args.harmonic.chordTimeline;
  const scoreSegments: AcgPianoScoreSegment[] = timeline.flatMap((span, index) => {
    const harmonicStart = span.startBeat as number;
    const harmonicEnd = harmonicStart + (span.durationBeats as number);
    return (phrasesBySection.get(span.sectionId) ?? [])
      .filter((phrase) => harmonicStart < phrase.endBeat - 1e-4 && harmonicEnd > phrase.startBeat + 1e-4)
      .map((phrase) => ({
        span,
        index,
        phrase,
        startBeat: Math.max(harmonicStart, phrase.startBeat),
        endBeat: Math.min(harmonicEnd, phrase.endBeat),
      }));
  }).filter((segment) => segment.endBeat > segment.startBeat + 1e-4)
    .sort((left, right) => left.startBeat - right.startBeat || left.index - right.index || left.phrase.startBeat - right.phrase.startBeat);
  const leadContinuitySlots = buildAcgPianoLeadContinuitySlots({
    segments: scoreSegments,
    harmonic: args.harmonic,
  });

  for (const segment of scoreSegments) {
    const { span, index, phrase, startBeat: segmentStart, endBeat: segmentEnd } = segment;
    const harmonicStart = span.startBeat as number;
    const harmonicEnd = harmonicStart + (span.durationBeats as number);
    const segmentOffset = segmentStart - harmonicStart;
    const segmentDuration = segmentEnd - segmentStart;
    const startsHarmonicSpan = segmentOffset <= 1e-4;
    phraseIdBySpan[span.id] ??= phrase.phraseId;
    const phraseOwners = phraseIdsBySpan[span.id] ?? [];
    if (!phraseOwners.includes(phrase.phraseId)) phraseIdsBySpan[span.id] = [...phraseOwners, phrase.phraseId];
    if (!args.activeSectionIds.has(span.sectionId)) {
      middleSurfaceBudget.consecutiveBrokenSpans = 0;
      continue;
    }

    const phraseSpans = timeline.filter((candidate) => {
      const candidateStart = candidate.startBeat as number;
      const candidateEnd = candidateStart + (candidate.durationBeats as number);
      return candidate.sectionId === phrase.sectionId
        && candidateStart < phrase.endBeat - 1e-4
        && candidateEnd > phrase.startBeat + 1e-4;
    });
    const spanIndex = Math.max(0, phraseSpans.findIndex((candidate) => candidate.id === span.id));
    const next = timeline[index + 1];
    const func = args.harmonic.chordFunctionTimeline[index] ?? 'T';
    const nextFunc: HarmonicFunction | undefined = next
      ? args.harmonic.chordFunctionTimeline[index + 1]
      : undefined;
    const nextPhrase = next
      ? (phrasesBySection.get(next.sectionId) ?? []).find((candidate) => (next.startBeat as number) >= candidate.startBeat - 1e-4
        && (next.startBeat as number) < candidate.endBeat - 1e-4)
      : undefined;
    const nextSpanDuration = next && nextPhrase
      ? Math.max(0, Math.min(next.durationBeats as number, nextPhrase.endBeat - (next.startBeat as number)))
      : 0;
    const adjacentDominantResolution = startsHarmonicSpan
      && func === 'D'
      && nextFunc === 'T'
      && nextSpanDuration > 0.01;
    const atPhraseEnd = segmentEnd >= phrase.endBeat - 1e-4 && spanIndex === phraseSpans.length - 1;
    const phraseArrival = atPhraseEnd
      && (phrase.cadenceTarget !== 'open' || phrase.formRole === 'cadence');
    const requestedArrival = adjacentDominantResolution || phraseArrival;
    const leadRestWindows = phrase.lead.silenceWindows
      .filter((window) => overlaps(segmentStart, segmentEnd, window));
    const leadRestWindow = leadRestWindows[0];
    // A span can contain several planned breaths. Choose the first one that
    // can actually fit a legal dyad rather than letting an earlier tiny rest
    // hide a later usable answer window.
    const answerWindow = leadRestWindows
      .map((window) => ({
        startBeat: Math.max(0, window.startBeat - segmentStart),
        endBeat: Math.min(segmentDuration, window.endBeat - segmentStart),
      }))
      .find((window) => !!answerTimingForWindow(window, segmentDuration, Math.max(0.18, scaled(segmentDuration, 0.62))));
    const hasLeadAnswerWindow = !!answerTimingForWindow(answerWindow, segmentDuration, Math.max(0.18, scaled(segmentDuration, 0.62)));
    let compGesture = gestureForSpan({
      phraseGesture: phrase.gesture,
      spanIndex,
      spanCount: phraseSpans.length,
      arrival: requestedArrival,
      hasLeadAnswerWindow,
      phrase,
    });
    // An answer needs an actual lead breath. A D→T resolution has a different
    // terminal obligation, so it must prepare/land rather than leave a dyad
    // stranded on the outgoing dominant.
    if (adjacentDominantResolution && compGesture === 'answer-dyad') compGesture = 'arp-up';
    compGesture = applyProfileMiddleSurfaceTarget({
      seed: args.seed,
      phrase,
      spanIndex,
      phraseOrdinal: middlePhraseOrdinalById.get(phrase.phraseId),
      profileArc: arrangementProfile.middleSurfaceArc,
      arrival: requestedArrival,
      hasLeadAnswerWindow,
      gesture: compGesture,
    });
    compGesture = enforceMiddleSurfaceBudget({
      seed: args.seed,
      phrase,
      spanIndex,
      arrival: requestedArrival,
      gesture: compGesture,
      budget: middleSurfaceBudget,
    });
    compGesture = enforcePhraseOrchestrationRule({
      phrase,
      gesture: compGesture,
      arrival: requestedArrival,
      budget: phraseAirBudget,
    });
    let sentenceId = chooseSentenceForSpan({
      seed: args.seed,
      phrase,
      spanId: span.id,
      spanIndex,
      gesture: compGesture,
      arrival: requestedArrival,
      hasLeadAnswerWindow,
      profile: surfaceProgram,
      previousSentence: previousSentenceId,
    });
    const sourceAllowsActiveComp = phrase.lead.interlock.whenLeadActive !== 'tacet';
    const targetTerminalEvents = adjacentDominantResolution && next
      ? arrivalAtTargetSpanForGesture(
        compGesture,
        nextSpanDuration,
        `${phrase.phraseId}:${span.id}`,
        span.id,
      )
      : [];
    const targetSectionActive = !!next && args.activeSectionIds.has(next.sectionId);
    const resolvesIntoNextT = adjacentDominantResolution
      && sourceAllowsActiveComp
      && targetSectionActive
      && !!nextPhrase
      && targetPhraseAllowsResolutionTerminal(nextPhrase, next!.startBeat as number, targetTerminalEvents);
    const inheritedTargetArrivals = startsHarmonicSpan ? pendingTargetArrivalsBySpanId[span.id] ?? [] : [];
    const recastInheritedAsContrast = compGesture === 'tacet'
      && inheritedTargetArrivals.length > 0
      && isMiddlePhase(phrase.phase);
    const inheritedEventsForScore = recastInheritedAsContrast
      ? recastIncomingTerminalAsVerticalContrast(inheritedTargetArrivals, segmentDuration)
      : inheritedTargetArrivals;
    // If a terminal cannot safely enter the target phrase, the source keeps
    // its own phrase-end arrival instead of silently losing both ends.
    const currentSpanArrival = phraseArrival && !resolvesIntoNextT;
    const localEvents = eventsForSentence(sentenceId, compGesture, segmentDuration, `${phrase.phraseId}:${span.id}`, currentSpanArrival, answerWindow);
    let events = coalesceTargetTerminalWithLocalEvents(inheritedEventsForScore, localEvents);
    if (resolvesIntoNextT) pendingTargetArrivalsBySpanId[next!.id] = targetTerminalEvents;
    // A breath shorter than one legal dyad is still intentional silence.  It
    // must not be relabelled as an empty "answer". Outside a coda shared-rest,
    // the KB writes a real middle-hand carrier here rather than leaving a hole.
    if (compGesture === 'answer-dyad' && events.length === 0) {
      const scene = acgPianoOrchestrationSceneForId(phrase.orchestrationSceneId);
      compGesture = enforcePhraseOrchestrationRule({
        phrase,
        gesture: scene.comp.whenLeadRest === 'shared-rest'
          ? 'tacet'
          : scene.comp.fullTacetFallback,
        arrival: requestedArrival,
        budget: phraseAirBudget,
      });
      sentenceId = chooseSentenceForSpan({
        seed: args.seed,
        phrase,
        spanId: span.id,
        spanIndex,
        gesture: compGesture,
        arrival: requestedArrival,
        hasLeadAnswerWindow: false,
        profile: surfaceProgram,
        previousSentence: previousSentenceId,
      });
      events = eventsForSentence(
        sentenceId,
        compGesture,
        segmentDuration,
        `${phrase.phraseId}:${span.id}`,
        currentSpanArrival,
      );
    }
    if (compGesture === 'tacet' && inheritedEventsForScore.length > 0) {
      compGesture = inheritedEventsForScore[0]!.gesture;
      sentenceId = recastInheritedAsContrast || compGesture === 'rolled-block'
        ? 'suspension-arrival'
        : 'framed-arrival';
    }
    const silenceWindows: readonly AcgPianoSilenceWindow[] = compGesture === 'tacet'
      ? [{ startBeat: 0, endBeat: segmentDuration, reason: leadRestWindow ? 'lead-rest' : 'phrase-breath' }]
      : [];
    // Per-voice step remains deterministic, while the renderer additionally
    // enforces metricGrid.rollSpreadLimitBeats across the complete voicing.
    const rollStepBeats = [0.042, 0.05, 0.058][hash32(`${args.seed}|${span.id}|roll`) % 3]!;
    const textureCase = textureForSentence(args.seed, subset, phrase, sentenceId, compGesture, span.id, args.grooveContract);
    events = [...bindCompEventsToAcgPianoMetricGrid({
      events,
      absoluteSegmentStart: segmentStart,
      segmentDuration,
      grid: metricGrid,
    })];
    const bassEvents = bindBassEventsToAcgPianoMetricGrid({
      events: bassEventsForSentence(sentenceId, compGesture, segmentDuration),
      absoluteSegmentStart: segmentStart,
      segmentDuration,
      grid: metricGrid,
    });
    const continuityApplied = applyAcgPianoContinuityKnowledge({
      sentenceId,
      gesture: compGesture,
      segmentDuration,
      compEvents: events,
      bassEvents,
    });
    events = continuityApplied.compEvents;
    const scoreSpan: AcgPianoScoreSpan = {
      spanId: span.id,
      sectionId: span.sectionId,
      phraseId: phrase.phraseId,
      phase: phrase.phase,
      textureCase,
      upwardArpeggioLanding: events.some((candidate) => candidate.role === 'arrival'
        && (candidate.gesture === 'arp-up' || candidate.gesture === 'broken-wave' || candidate.gesture === 'rolled-block')),
      comp: {
        floorMidi: 48,
        ceilingMidi: 60,
        rollStepBeats,
        rollSpreadLimitBeats: metricGrid.rollSpreadLimitBeats,
        maxVoices: phrase.phase === 'lift' || phrase.phase === 'return' ? 4 : 3,
        gesture: compGesture,
        sentenceId,
        events: offsetCompEvents(events, segmentOffset),
        silenceWindows: offsetSilenceWindows(silenceWindows, segmentOffset),
      },
      bass: {
        rootAnchorRequired: acgPianoOrchestrationSceneForId(
          phrase.orchestrationSceneId,
        ).bass.rootAnchorRequired,
        maxNotesPerSpan: bassEvents.length,
        motion: bassMotionForScene(
          phrase.orchestrationSceneId,
          motionForSentence(sentenceId, compGesture),
        ),
        events: offsetBassEvents(continuityApplied.bassEvents, segmentOffset),
      },
    };
    textureBySpan[span.id] ??= textureCase;
    spanById[span.id] = mergePhraseSegmentIntoScoreSpan(spanById[span.id], scoreSpan);
    // Only whole harmony spans may suppress a harmony-boundary re-pedal.
    // A phrase can split a span; that local boundary is a score detail, not a
    // license to invent a new CC64 transition that the instrumental plan did
    // not authorize.
    const ownsWholeHarmonicSpan = startsHarmonicSpan
      && Math.abs(segmentEnd - harmonicEnd) <= SCORE_PEDAL_EPSILON;
    if (ownsWholeHarmonicSpan && isSharedPedalAirSentence(sentenceId, compGesture)) {
      sharedPedalAirCandidates.push({
        phraseId: phrase.phraseId,
        phase: phrase.phase,
        startBeat: harmonicStart,
        endBeat: harmonicEnd,
      });
    }
    const phraseSentences = sentenceIdsByPhrase.get(phrase.phraseId) ?? [];
    phraseSentences.push(sentenceId);
    sentenceIdsByPhrase.set(phrase.phraseId, phraseSentences);
    previousSentenceId = sentenceId;
  }

  // Record the sentences actually chosen by the score, so trace/audit data
  // cannot claim phrase variation that the execution plan did not contain.
  for (const [phraseId, sentenceIds] of sentenceIdsByPhrase) {
    const phrase = phraseById[phraseId];
    if (!phrase) continue;
    phraseById[phraseId] = {
      ...phrase,
      surfaceSignature: `${phrase.surfaceSignature}:${sentenceIds.join('>')}`,
    };
  }

  const sharedPedalHolds = retainHarmonicallySafeSharedPedalHolds(
    compileSharedPedalHolds(sharedPedalAirCandidates),
    args.harmonic,
  );
  const continuitySpanById = applyAcgPianoWholeScoreContinuity({
    harmonic: args.harmonic,
    spanById,
  });

  const score: AcgPianoScorePlan = {
    arrangementVariant: subset.id,
    roadMap: args.roadMap,
    leadPresencePlan: args.leadPresencePlan,
    metricGrid,
    phraseIdsBySpan,
    phraseById,
    phraseIdBySpan,
    textureBySpan,
    spanById: continuitySpanById,
    leadContinuitySlots,
    sharedPedalHolds,
  };
  const metricIssues = validateAcgPianoMetricContract(score);
  if (metricIssues.length > 0) {
    throw new Error(`ACG PianoScorePlan metric contract failed: ${metricIssues.join('; ')}`);
  }
  const continuityIssues = validateAcgPianoWrittenContinuityContract(score);
  if (continuityIssues.length > 0) {
    throw new Error(`ACG PianoScorePlan continuity contract failed: ${continuityIssues.join('; ')}`);
  }
  return score;
}

/**
 * Revoice existing legal chord tones into the planned middle hand. This only
 * chooses octaves; gesture/timing/attack remains the arranger's score.
 */
export function revoiceAcgPianoScoreVoicing(midis: readonly number[], directive: AcgPianoCompDirective): number[] {
  const source = [...new Set(midis.filter(Number.isFinite))].sort((a, b) => a - b);
  const placed: number[] = [];
  for (let index = 0; index < source.length; index++) {
    const midi = source[index]!;
    const target = source.length <= 1
      ? (directive.floorMidi + directive.ceilingMidi) / 2
      : directive.floorMidi + 4 + ((directive.ceilingMidi - directive.floorMidi - 8) * index) / (source.length - 1);
    const candidates: number[] = [];
    for (let octave = -5; octave <= 5; octave++) {
      const candidate = midi + octave * 12;
      if (candidate >= directive.floorMidi && candidate <= directive.ceilingMidi) candidates.push(candidate);
    }
    if (candidates.length === 0) continue;
    const selected = candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0]!;
    if (!placed.includes(selected)) placed.push(selected);
  }
  const sorted = placed.sort((a, b) => a - b);
  if (sorted.length <= directive.maxVoices) return sorted;
  if (directive.maxVoices <= 1) return [sorted[0]!];
  const out: number[] = [];
  for (let index = 0; index < directive.maxVoices; index++) {
    const pick = sorted[Math.round((index * (sorted.length - 1)) / (directive.maxVoices - 1))]!;
    if (!out.includes(pick)) out.push(pick);
  }
  return out;
}
