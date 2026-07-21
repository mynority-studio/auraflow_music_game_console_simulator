import { describe, expect, it } from 'vitest';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';
import { buildSongBundle, generateSongFromBundle } from '../generation/GenerationController';
import { isAcgLeadScheduledRelease, overlapsAcgLeadSilence, planAcgLeadPresence } from './acgLeadPresencePlan';

function arrangement(): ArrangementPlan {
  return {
    meter: { numerator: 4, denominator: 4 },
    sections: [
      { id: 'intro', role: 'intro', bars: 4, hookPolicy: 'none' },
      { id: 'theme', role: 'verse', bars: 4, hookPolicy: 'light' },
      { id: 'drop', role: 'bridge', bars: 2, hookPolicy: 'none' },
    ],
    openingGesture: { sectionId: 'intro', roleDelayBars: { lead: 2 } },
    rolePerformanceBySection: {
      lead: {
        intro: { entryMode: 'downbeat' },
        theme: { entryMode: 'downbeat' },
        drop: { entryMode: 'dropout' },
      },
    },
  } as unknown as ArrangementPlan;
}

function instrumentation(): Pick<InstrumentationPlan, 'activeRolesBySection'> {
  return {
    activeRolesBySection: {
      intro: ['bass', 'comp', 'lead'],
      theme: ['bass', 'comp', 'lead'],
      drop: ['bass', 'comp', 'lead'],
    },
  } as Pick<InstrumentationPlan, 'activeRolesBySection'>;
}

describe('render/acgLeadPresencePlan', () => {
  it('turns opening lead delay and dropout sections into scheduler-owned silence windows', () => {
    const plan = planAcgLeadPresence(arrangement(), instrumentation());
    expect(plan.silenceWindows).toEqual([
      { startBeat: 0, endBeat: 8, reason: 'planned-entry-delay', sectionId: 'intro' },
      { startBeat: 32, endBeat: 40, reason: 'performance-dropout', sectionId: 'drop' },
    ]);
    expect(overlapsAcgLeadSilence(7.8, 8.2, plan)).toBe(true);
    expect(overlapsAcgLeadSilence(8.1, 8.5, plan)).toBe(false);
    expect(isAcgLeadScheduledRelease(0, 8.25, plan)).toBe(true);
  });

  it('makes a section that lacks the lead role an explicit planned silence', () => {
    const input = {
      activeRolesBySection: {
        intro: ['bass', 'comp', 'lead'],
        theme: ['bass', 'comp'],
        drop: ['bass', 'comp', 'lead'],
      },
    } as unknown as Pick<InstrumentationPlan, 'activeRolesBySection'>;
    const plan = planAcgLeadPresence(arrangement(), input);
    expect(plan.silenceWindows).toContainEqual({
      // Adjacent theme silence + dropout are intentionally one uninterrupted
      // scheduler rest, so no generic note is generated at their boundary.
      startBeat: 16, endBeat: 40, reason: 'inactive-section', sectionId: 'theme',
    });
  });

  it('is honored end-to-end by generated ACG lead rather than a final density deletion', () => {
    let checked = 0;
    for (const seed of Array.from({ length: 16 }, (_, index) => index)) {
      const bundle = buildSongBundle({ seed, styleHint: 'acg', mood: 'lyrical', targetDuration: 90 });
      const presence = planAcgLeadPresence(bundle.arrangement, bundle.instrumentation);
      if (presence.silenceWindows.length === 0) continue;
      const result = generateSongFromBundle(bundle);
      expect(result.ir, `seed ${seed} should render`).toBeDefined();
      const lead = result.ir!.tracks.find((track) => track.role === 'lead')!;
      for (const note of lead.notes) {
        const startBeat = (note.startTick as number) / bundle.timebase.ppq;
        const endBeat = startBeat + (note.durationTicks as number) / bundle.timebase.ppq;
        expect(
          overlapsAcgLeadSilence(startBeat, endBeat, presence),
          `seed ${seed}: lead must not ring through a scheduler-owned silence`,
        ).toBe(false);
      }
      checked++;
      if (checked >= 3) break;
    }
    expect(checked, 'fixture range should exercise real arranger-owned ACG silences').toBeGreaterThanOrEqual(1);
  });
});
