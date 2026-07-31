import { describe, expect, it } from 'vitest';
import { pc } from '../foundation';
import { buildSongBundle, generateSongFromBundle } from '../generation/GenerationController';
import type { DrumHit } from '../knowledge/grooves';

const STYLES = ['pop', 'rnb', 'lofi', 'jazz'] as const;
const CONTENT_TAGS = new Set(['story', 'build', 'hook', 'loop', 'head', 'solo', 'headOut']);

const patternSignature = (hits: readonly DrumHit[]) =>
  hits.map((hit) => `${hit.drum}@${hit.beat}:${hit.vel}`).join('|');

function finalBarSignatures(
  notes: readonly { pitch: number; startTick: number }[],
  ppq: number,
  beatsPerBar: number,
): Set<string> {
  const barTicks = ppq * beatsPerBar;
  const byBar = new Map<number, string[]>();
  for (const note of notes) {
    const tick = note.startTick as number;
    const bar = Math.max(0, Math.floor((tick + 2) / barTicks));
    const beat = (tick - bar * barTicks) / ppq;
    const events = byBar.get(bar) ?? [];
    events.push(`${note.pitch as number}@${beat.toFixed(2)}`);
    byBar.set(bar, events);
  }
  return new Set([...byBar.values()].map((events) => events.sort().join('|')));
}

describe('drum groove diversity audit', () => {
  for (const style of STYLES) {
    it(`${style}: 12-seed score coverage, phrase variation, contract vocabulary and final-IR diversity`, () => {
      let scoredBars = 0;
      let plannedBars = 0;
      let contentSections = 0;
      let variedContentSections = 0;
      let lineupWithDrum = 0;
      let boundaryCount = 0;
      let finalDrumSongs = 0;
      let finalVariedSongs = 0;
      let expectedFinalDrumSongs = 0;
      const fillFamilies = new Set<string>();

      for (let seed = 0; seed < 12; seed++) {
        const bundle = buildSongBundle({
          seed,
          styleHint: style,
          mood: 'build',
          targetDuration: 120,
          key: pc(0),
        });
        const { arrangement, instrumentation } = bundle;
        if (bundle.band.instrumentPool.includes('drum')) lineupWithDrum += 1;
        plannedBars += arrangement.sections.reduce((sum, section) => sum + section.bars, 0);
        scoredBars += Object.values(arrangement.grooveScorePlan.bySection)
          .reduce((sum, section) => sum + section.bars.length, 0);
        boundaryCount += arrangement.grooveScorePlan.boundaries.length;
        arrangement.grooveScorePlan.boundaries.forEach((boundary) => fillFamilies.add(boundary.drumFillFamily));

        for (const section of arrangement.sections) {
          if (!CONTENT_TAGS.has(section.functionTag ?? '')
            || !instrumentation.activeRolesBySection[section.id].includes('drum')
            || section.bars < 4) continue;
          contentSections += 1;
          const patterns = instrumentation.drumPatternBySectionBar[section.id];
          if (new Set(patterns.map(patternSignature)).size > 1) variedContentSections += 1;
        }

        if (seed < 4) {
          if (arrangement.sections.some((section) => instrumentation.activeRolesBySection[section.id].includes('drum'))) {
            expectedFinalDrumSongs += 1;
          }
          const result = generateSongFromBundle(bundle);
          expect(result.status, `${style}/${seed}: ${result.report.findings.map((finding) => finding.ruleId).join(',')}`)
            .not.toBe('failed');
          const drum = result.ir!.tracks.find((track) => track.role === 'drum');
          if (drum?.notes.length) {
            finalDrumSongs += 1;
            const signatures = finalBarSignatures(drum.notes, bundle.timebase.ppq, arrangement.meter.numerator);
            if (signatures.size > 1) finalVariedSongs += 1;
          }
        }
      }

      expect(lineupWithDrum).toBe(12);
      expect(scoredBars).toBe(plannedBars);
      expect(contentSections).toBeGreaterThan(0);
      expect(variedContentSections).toBe(contentSections);
      if (style === 'lofi') {
        expect(boundaryCount).toBe(0);
        expect(fillFamilies.size).toBe(0);
      } else {
        expect(boundaryCount).toBeGreaterThan(0);
        expect(fillFamilies.size).toBeGreaterThan(0);
      }
      expect(finalDrumSongs).toBe(expectedFinalDrumSongs);
      expect(finalVariedSongs).toBe(expectedFinalDrumSongs);
    }, 15000);
  }
});
