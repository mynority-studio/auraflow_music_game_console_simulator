import type {
  LofiLeadPresencePlan,
  LofiLeadSilenceWindow,
  Section,
} from './ArrangementPlan';
import type { Meter } from '../foundation';
import {
  lofiLeadEventsForRole,
  type LofiLeadPhraseBlueprint,
} from '../knowledge/lofiLeadPhraseBlueprints';

const beatsPerBar = (meter: Meter): number =>
  meter.numerator * (4 / meter.denominator);

/**
 * LOFI lead is an answer voice, not a continuously active top line.
 * The first four eligible loop bars are intentionally silent; subsequent
 * activity is copied from the selected eight-bar phrase blueprint.
 */
export function planLofiLeadPresence(
  sections: readonly Section[],
  meter: Meter,
  leadSpace: {
    activeBarTarget: readonly [number, number];
    minimumContiguousRestBars: number;
  } = {
    activeBarTarget: [0.25, 0.45],
    minimumContiguousRestBars: 4,
  },
  blueprint?: LofiLeadPhraseBlueprint,
): LofiLeadPresencePlan {
  const activeBarsBySection: Record<string, number[]> = Object.fromEntries(
    sections.map((section) => [section.id, []]),
  );
  for (const section of sections) {
    if (section.functionTag !== 'loop' || section.bars <= 0) continue;
    const [minimumActive, maximumActive] = leadSpace.activeBarTarget;
    const targetRatio = (minimumActive + maximumActive) / 2;
    const targetActive = Math.max(
      1,
      Math.ceil(section.bars * minimumActive),
      Math.min(Math.floor(section.bars * maximumActive), Math.round(section.bars * targetRatio)),
    );
    const protectedSilentPrefix = section.bars >= 8
      ? leadSpace.minimumContiguousRestBars
      : Math.max(1, section.bars - targetActive);
    const indexes = Array.from({ length: section.bars }, (_, index) => index);
    const preferredCyclePositions = blueprint
      ? blueprint.roleByCycleBar
        .map((role, index) => role === 'rest' ? -1 : index)
        .filter((index) => index >= 0)
      : [4, 5, 7];
    const preferred = indexes.filter(
      (index) =>
        index >= protectedSilentPrefix
        && preferredCyclePositions.includes(index % (blueprint?.cycleBars ?? 8)),
    );
    if (blueprint && preferred.length > 0) {
      // The blueprint's rests are authored musical space. Do not back-fill
      // them merely to hit a statistical density target.
      activeBarsBySection[section.id] = preferred;
      continue;
    }
    const fallback = indexes
      .filter((index) => index >= protectedSilentPrefix && !preferred.includes(index))
      .sort((a, b) => b - a);
    activeBarsBySection[section.id] = [...preferred, ...fallback]
      .slice(0, targetActive)
      .sort((a, b) => a - b);
  }

  const bpb = beatsPerBar(meter);
  const silenceWindows: LofiLeadSilenceWindow[] = [];
  const entryBeats: number[] = [];
  let absoluteBar = 0;
  for (const section of sections) {
    if (section.functionTag !== 'loop') {
      absoluteBar += section.bars;
      continue;
    }
    const active = new Set(activeBarsBySection[section.id]);
    for (const bar of active) {
      const cyclePosition = bar % (blueprint?.cycleBars ?? 8);
      const role = blueprint?.roleByCycleBar[cyclePosition];
      const firstEvent = role && role !== 'rest'
        ? lofiLeadEventsForRole(blueprint, role)[0]?.event
        : undefined;
      entryBeats.push((absoluteBar + bar) * bpb + (firstEvent?.offsetBeat ?? 0.5));
    }
    let start: number | undefined;
    for (let bar = 0; bar <= section.bars; bar++) {
      const silent = bar < section.bars && !active.has(bar);
      if (silent && start === undefined) start = bar;
      if ((!silent || bar === section.bars) && start !== undefined) {
        silenceWindows.push({
          sectionId: section.id,
          startBarInSection: start,
          endBarInSection: bar,
          startBeat: (absoluteBar + start) * bpb,
          endBeat: (absoluteBar + bar) * bpb,
        });
        start = undefined;
      }
    }
    absoluteBar += section.bars;
  }

  return {
    activeBarsBySection,
    silenceWindows,
    entryBeats,
  };
}
