// ============================================================
// newEngine · instrumental · Foundation Voicing Planner
// ------------------------------------------------------------
// Produces the nominal Comp pitches for a LOFI harmonic span before NoteIR is
// emitted.  Keyboard and non-keyboard Comp use this same musical contract;
// instrument capability only narrows the final register.
// ============================================================

import { mod12 } from '../foundation';
import type { LofiFoundationPlan } from '../arranger/lofiFoundationPlanner';
import { minimumVoiceLeadingDistance } from './foundationVoiceLeading';
import { placeVoicingMidi } from '../knowledge/voicingPlacement';
import {
  applyArrangement,
  assembleVoicing,
  type VoicingStylePreference,
} from '../knowledge/voicingStyles';

export interface FoundationVoicingPlanArgs {
  rootPc: number;
  chordType: string;
  bassMidi: number;
  previous: readonly number[];
  intent: Readonly<LofiFoundationPlan['voicingIntent']>;
  includeRoot: boolean;
  register: readonly [number, number];
  maxVoices?: number;
}

function fitVoicingToRange(
  voicing: readonly number[],
  previous: readonly number[],
  low: number,
  high: number,
  maxVoices: number,
): number[] {
  const uniqueSource = [...new Map(voicing.map((pitch) => [mod12(pitch), pitch])).values()]
    .sort((a, b) => a - b);
  // Retain the voices closest to the authored register center if the chord
  // exposes more colors than this archetype permits.
  const center = (low + high) / 2;
  const selected = uniqueSource.length <= maxVoices
    ? uniqueSource
    : uniqueSource
    .map((pitch) => ({ pitch, distance: Math.abs(pitch - center) }))
    .sort((a, b) => a.distance - b.distance || a.pitch - b.pitch)
    .slice(0, maxVoices)
    .map((entry) => entry.pitch)
    .sort((a, b) => a - b);
  const candidates = selected.map((pitch) =>
    Array.from({ length: high - low + 1 }, (_, index) => low + index)
      .filter((candidate) => mod12(candidate) === mod12(pitch)));
  if (candidates.some((set) => set.length === 0)) return [];

  const sourceSpan = selected.length > 1
    ? selected[selected.length - 1] - selected[0]
    : 0;
  let best: number[] = [];
  let bestCost = Number.POSITIVE_INFINITY;
  const visit = (index: number, chosen: number[]): void => {
    if (index < candidates.length) {
      for (const pitch of candidates[index]) {
        if (!chosen.includes(pitch)) visit(index + 1, [...chosen, pitch]);
      }
      return;
    }
    const sorted = [...chosen].sort((a, b) => a - b);
    const span = sorted[sorted.length - 1] - sorted[0];
    let cost = Math.abs(span - sourceSpan) * 1.5;
    cost += Math.abs(averagePitch(sorted) - center) * 0.2;
    cost += minimumVoiceLeadingDistance(selected, sorted, 5) * 0.25;
    for (let voice = 1; voice < sorted.length; voice++) {
      const gap = sorted[voice] - sorted[voice - 1];
      if (gap < 3) cost += (3 - gap) * 8;
    }
    if (previous.length) {
      cost += minimumVoiceLeadingDistance(previous, sorted, 5) * 3;
      const topJump = Math.abs(
        sorted[sorted.length - 1] - previous[previous.length - 1],
      );
      cost += topJump;
      if (topJump > 5) cost += (topJump - 5) * 30;
    }
    const lexical = best.length === 0
      || sorted.some((pitch, voice) =>
        pitch !== best[voice] && pitch < best[voice]
        && sorted.slice(0, voice).every((value, prior) => value === best[prior]));
    if (cost < bestCost - 1e-9 || (Math.abs(cost - bestCost) <= 1e-9 && lexical)) {
      best = sorted;
      bestCost = cost;
    }
  };
  visit(0, []);
  return best;
}

function averagePitch(voicing: readonly number[]): number {
  return voicing.reduce((sum, pitch) => sum + pitch, 0) / Math.max(1, voicing.length);
}

export function planFoundationVoicing(args: FoundationVoicingPlanArgs): number[] {
  const maximum = Math.max(2, args.maxVoices ?? args.intent.maxVoicesWithBass);
  const preference: VoicingStylePreference = {
    rootPolicy: args.includeRoot ? 'include' : 'omit',
    density: args.intent.family === 'rootless-guide' ? Math.min(3, maximum) : maximum,
    addColorOnTriad: args.intent.family === 'rootless-guide',
  };
  const pcs = assembleVoicing(args.chordType, mod12(args.rootPc), preference);
  const placed = placeVoicingMidi(
    pcs,
    [...args.previous],
    args.bassMidi,
    args.chordType,
    args.rootPc,
  );
  const arranged = args.intent.family === 'drop2'
    ? applyArrangement(placed, 'drop2', args.bassMidi)
    : placed;
  const [low, high] = args.register;
  return fitVoicingToRange(arranged, args.previous, low, high, maximum);
}
