// Pure audition transform: one explicitly bounded note on a copied MusicalIR.
// It has no VideoReplicaScore, approval, product or generation-layer authority.

import { midi, ticks } from '../src/core/generation/newEngine/foundation';
import { freezeMusicalIR, type MusicalIR } from '../src/core/generation/newEngine/ir/MusicalIR';

export const TAKE_FIVE_F3_ISOLATION_DELTA = Object.freeze({
  role: 'comp' as const,
  performedStartTick: 43_288,
  performedDurationTicks: 167,
  midi: 53,
  velocity: 55,
});

export function buildTakeFiveF3IsolationIr(baseIr: MusicalIR): MusicalIR {
  const delta = TAKE_FIVE_F3_ISOLATION_DELTA;
  if (!baseIr.tracks.some((track) => track.role === delta.role)) {
    throw new RangeError(`F3 isolation requires a ${delta.role} track`);
  }
  return freezeMusicalIR({
    timebase: baseIr.timebase,
    durationTicks: baseIr.durationTicks,
    tracks: baseIr.tracks.map((track) => ({
      role: track.role,
      bank: track.bank,
      program: track.program,
      notes: [
        ...track.notes.map((note) => ({ ...note })),
        ...(track.role === delta.role ? [{
          pitch: midi(delta.midi),
          startTick: ticks(delta.performedStartTick),
          durationTicks: ticks(delta.performedDurationTicks),
          velocity: delta.velocity,
        }] : []),
      ].sort((left, right) => (
        (left.startTick as number) - (right.startTick as number)
        || (left.pitch as number) - (right.pitch as number)
      )),
    })),
  });
}
