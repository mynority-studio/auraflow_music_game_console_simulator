// ============================================================
// newEngine · render · Jazz 5/4 score projector
// ------------------------------------------------------------
// The post-harmony score has already resolved rhythm, pitch and performance.
// This boundary only converts performed events to NoteIR and preserves the
// existing track's output metadata. It never selects or edits musical content.
// ============================================================

import { midi, ticks } from '../foundation';
import type { JazzFiveFourScorePlan, JazzFiveFourScoreRole } from '../arranger/jazzFiveFourScorePlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

const ROLE_ORDER: readonly JazzFiveFourScoreRole[] = ['bass', 'comp', 'drum', 'lead'];

function notesForRole(plan: JazzFiveFourScorePlan, role: JazzFiveFourScoreRole): NoteIR[] {
  return plan.performance.events
    .filter((event) => event.role === role)
    .map((event) => ({
      pitch: midi(event.pitch),
      startTick: ticks(event.tick),
      durationTicks: ticks(event.durationTicks),
      velocity: event.velocity,
    }))
    .sort((a, b) =>
      (a.startTick as number) - (b.startTick as number)
      || (a.pitch as number) - (b.pitch as number)
      || (a.durationTicks as number) - (b.durationTicks as number)
      || a.velocity - b.velocity);
}

function programForRole(plan: JazzFiveFourScorePlan, role: JazzFiveFourScoreRole): {
  program?: number;
  bank?: number;
} {
  const first = plan.performance.events.find((event) => event.role === role);
  return first ? { program: first.program, ...(first.bank === undefined ? {} : { bank: first.bank }) } : {};
}

/**
 * Replace only score-owned role notes. Track mix/program automation remains an
 * output concern and is retained from the normal instrumentation projection.
 */
export function projectJazzFiveFourScoreTracks(
  tracks: readonly TrackIR[],
  plan: JazzFiveFourScorePlan | undefined,
): TrackIR[] {
  if (!plan) return tracks.map((track) => ({ ...track, notes: [...track.notes] }));
  if (
    plan.performance.mode !== 'reference-zero'
    && plan.performance.mode !== 'reference-authored-lead'
    && plan.performance.mode !== 'score-budgeted'
  ) {
    throw new Error(`Unsupported Jazz 5/4 performed-score mode: ${plan.performance.mode}`);
  }

  const byRole = new Map(tracks.map((track) => [track.role, track] as const));
  const out: TrackIR[] = [];
  const emitted = new Set<JazzFiveFourScoreRole>();

  for (const track of tracks) {
    if (!ROLE_ORDER.includes(track.role as JazzFiveFourScoreRole)) {
      out.push({ ...track, notes: [...track.notes] });
      continue;
    }
    const role = track.role as JazzFiveFourScoreRole;
    emitted.add(role);
    out.push({
      ...track,
      ...programForRole(plan, role),
      notes: notesForRole(plan, role),
    });
  }

  for (const role of ROLE_ORDER) {
    if (emitted.has(role) || !plan.performance.events.some((event) => event.role === role)) continue;
    const base = byRole.get(role);
    out.push({
      ...(base ?? { role }),
      ...programForRole(plan, role),
      role,
      notes: notesForRole(plan, role),
    });
  }
  return out;
}

export function jazzFiveFourScoreEventSignature(plan: JazzFiveFourScorePlan): string[] {
  return plan.performance.events
    .map((event) => `${event.role}|${event.tick}|${event.durationTicks}|${event.pitch}|${event.velocity}`)
    .sort();
}

export function jazzFiveFourTrackEventSignature(
  tracks: readonly {
    readonly role: string;
    readonly notes: readonly {
      readonly startTick: number;
      readonly durationTicks: number;
      readonly pitch: number;
      readonly velocity: number;
    }[];
  }[],
  ownedRoles: readonly JazzFiveFourScoreRole[] = ROLE_ORDER,
): string[] {
  const allowed = new Set<string>(ownedRoles);
  return tracks
    .filter((track) => allowed.has(track.role))
    .flatMap((track) => track.notes.map((note) =>
      `${track.role}|${note.startTick as number}|${note.durationTicks as number}|${note.pitch as number}|${note.velocity}`))
    .sort();
}

/** Fail closed if any late stage changed cardinality or a musical field. */
export function assertJazzFiveFourProjectionIdentity(
  tracks: Parameters<typeof jazzFiveFourTrackEventSignature>[0],
  plan: JazzFiveFourScorePlan,
): void {
  const expected = jazzFiveFourScoreEventSignature(plan);
  const actual = jazzFiveFourTrackEventSignature(tracks);
  if (expected.length !== actual.length || expected.some((event, index) => event !== actual[index])) {
    throw new Error(`Jazz 5/4 score projection identity violated: expected ${expected.length} events, received ${actual.length}`);
  }
}
