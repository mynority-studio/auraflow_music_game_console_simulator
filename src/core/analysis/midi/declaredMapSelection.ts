import type { MidiNoteSpan } from './types';

/**
 * SMF files often contain a short setup/pickup declaration at tick 0 and the
 * real main meter/key immediately afterwards. Preserve the complete map, but
 * choose the overview value by the declaration value that governs the most
 * performed note attacks. Repeated declarations of the same value accumulate.
 */
export function selectPrimaryDeclaredEvent<T extends { tick: number }>(
  events: ReadonlyArray<T>,
  notes: ReadonlyArray<MidiNoteSpan>,
  durationTicks: number,
  valueKey: (event: T) => string,
): T | null {
  if (events.length === 0) return null;
  const sorted = [...events].sort((left, right) => left.tick - right.tick);
  const nonDrumNotes = notes.filter((note) => note.channel !== 9);
  const groups = new Map<string, {
    event: T;
    noteCount: number;
    activeTicks: number;
  }>();

  for (let index = 0; index < sorted.length; index++) {
    const event = sorted[index];
    const nextTick = sorted.slice(index + 1)
      .find((candidate) => candidate.tick > event.tick)?.tick ?? durationTicks;
    const endTick = Math.max(event.tick, nextTick);
    const key = valueKey(event);
    const current = groups.get(key) ?? {
      event,
      noteCount: 0,
      activeTicks: 0,
    };
    current.noteCount += nonDrumNotes.filter((note) =>
      note.startTick >= event.tick && note.startTick < endTick).length;
    current.activeTicks += Math.max(0, endTick - event.tick);
    groups.set(key, current);
  }

  return Array.from(groups.values())
    .sort((left, right) =>
      (right.noteCount - left.noteCount)
      || (right.activeTicks - left.activeTicks)
      || (left.event.tick - right.event.tick))[0]?.event ?? null;
}
