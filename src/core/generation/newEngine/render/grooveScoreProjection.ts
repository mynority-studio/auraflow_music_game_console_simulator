// ============================================================
// newEngine · render · Groove Score Projection
// ------------------------------------------------------------
// Projects the Arranger-authored GrooveBarScore into rhythm-section touch.
// The score remains the single truth; role weights only model how strongly a
// bassist, comp player or lead player expresses the same metric information.
// ============================================================

import type { GrooveBarScore, GrooveScorePlan } from '../arranger/ArrangementPlan';
import type { TrackIR } from '../ir/MusicalIR';

type GrooveRole = 'bass' | 'comp' | 'lead';

const GROOVE_ROLES = new Set<string>(['bass', 'comp', 'lead']);

const ROLE_WEIGHT: Readonly<Record<GrooveRole, {
  beat: number;
  subdivision: number;
  phrase: number;
  energy: number;
}>> = {
  bass: { beat: 0.34, subdivision: 0.22, phrase: 0.72, energy: 0.7 },
  comp: { beat: 0.24, subdivision: 0.3, phrase: 0.88, energy: 0.82 },
  lead: { beat: 0.14, subdivision: 0.12, phrase: 0.92, energy: 0.78 },
};

const TRAJECTORY_SCALE: Readonly<Record<GrooveRole, Readonly<Record<NonNullable<GrooveBarScore['trajectory']>, number>>>> = {
  bass: { settled: 1, rising: 1.025, arrival: 1.05, peak: 1.035, falling: 0.96 },
  comp: { settled: 1, rising: 1.035, arrival: 1.06, peak: 1.045, falling: 0.94 },
  lead: { settled: 1, rising: 1.02, arrival: 1.05, peak: 1.04, falling: 0.95 },
};

function clampVelocity(value: number): number {
  return Math.max(1, Math.min(127, Math.round(value)));
}

function scoreByAbsoluteBar(plan: Readonly<GrooveScorePlan>): Map<number, Readonly<GrooveBarScore>> {
  const result = new Map<number, Readonly<GrooveBarScore>>();
  for (const section of Object.values(plan.bySection)) {
    for (const bar of section.bars) result.set(bar.absoluteBar, bar);
  }
  return result;
}

/** Public for contract tests and read-only audits. */
export function grooveScoreVelocityScale(
  role: GrooveRole,
  beatInBar: number,
  score: Readonly<GrooveBarScore>,
): number {
  const weight = ROLE_WEIGHT[role];
  const beatIndex = Math.max(0, Math.min(score.beatStrength.length - 1, Math.floor(beatInBar)));
  const beatStrength = score.beatStrength[beatIndex] ?? 1;
  const subdivisionCount = Math.max(1, score.subdivisionAccent.length);
  const fraction = ((beatInBar % 1) + 1) % 1;
  const subdivisionIndex = Math.round(fraction * subdivisionCount) % subdivisionCount;
  const subdivisionAccent = score.subdivisionAccent[subdivisionIndex] ?? 1;
  const energy = score.energy ?? 0.5;
  const trajectory = score.trajectory ?? 'settled';
  const phraseInteractionScale = score.lofiPhraseInteraction?.velocityScaleByRole[role] ?? 1;
  const scale = (1 + (beatStrength - 1) * weight.beat)
    * (1 + (subdivisionAccent - 1) * weight.subdivision)
    * (1 + (score.phraseAccent - 1) * weight.phrase)
    * (1 + (energy - 0.5) * 0.08 * weight.energy)
    * TRAJECTORY_SCALE[role][trajectory]
    * phraseInteractionScale;
  return Math.max(0.72, Math.min(1.22, scale));
}

export function applyGrooveScoreProjection(
  tracks: TrackIR[],
  plan: Readonly<GrooveScorePlan>,
  ppq: number,
  beatsPerBar: number,
  excludeRoles: ReadonlySet<string> = new Set(),
): TrackIR[] {
  const byBar = scoreByAbsoluteBar(plan);
  if (byBar.size === 0) return tracks;
  const barTicks = ppq * beatsPerBar;
  return tracks.map((track) => {
    if (!GROOVE_ROLES.has(track.role) || excludeRoles.has(track.role)) return track;
    const role = track.role as GrooveRole;
    return {
      ...track,
      notes: track.notes.map((note) => {
        const tick = note.startTick as number;
        const absoluteBar = Math.max(0, Math.floor(tick / barTicks));
        const score = byBar.get(absoluteBar);
        if (!score) return note;
        const beatInBar = ((tick / ppq) % beatsPerBar + beatsPerBar) % beatsPerBar;
        const velocity = clampVelocity(note.velocity * grooveScoreVelocityScale(role, beatInBar, score));
        return velocity === note.velocity ? note : { ...note, velocity };
      }),
    };
  });
}
