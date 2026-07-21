import { describe, expect, it } from 'vitest';
import { pc } from '../foundation';
import { buildSongBundle, generateSongFromBundle } from '../generation/GenerationController';
import { DRUM, type DrumHit } from '../knowledge/grooves';
import { drumFeelProfileIdForContract } from '../knowledge/drumPerformanceKnowledge';

const cases = [
  { style: 'pop', contractStyle: 'POP', seed: 2 },
  { style: 'rnb', contractStyle: 'RNB', seed: 7 },
  { style: 'lofi', contractStyle: 'LOFI', seed: 7 },
  { style: 'jazz', contractStyle: 'JAZZ', seed: 0 },
] as const;

const patternSignature = (hits: readonly DrumHit[]) =>
  hits.map((hit) => `${hit.drum}@${hit.beat}:${hit.vel}`).join('|');

describe('GrooveScore production ownership', () => {
  it.each(cases)('$style: one song GrooveContract materializes every bar and drives A/A-prime drum variants', ({ style, contractStyle, seed }) => {
    const bundle = buildSongBundle({
      seed,
      styleHint: style,
      mood: 'build',
      targetDuration: 120,
      key: pc(0),
    });
    const { arrangement, instrumentation } = bundle;
    const contract = arrangement.songGrooveContract;
    const score = arrangement.grooveScorePlan;

    expect(contract.style).toBe(contractStyle);
    expect(score.grooveContractId).toBe(contract.id);
    expect(Object.values(score.bySection).reduce((sum, section) => sum + section.bars.length, 0))
      .toBe(arrangement.sections.reduce((sum, section) => sum + section.bars, 0));

    const activePatterns: (readonly DrumHit[])[] = [];
    const phraseRoles = new Set<string>();
    for (const section of arrangement.sections) {
      const sectionScore = score.bySection[section.id];
      expect(sectionScore.grooveContractId).toBe(contract.id);
      expect(sectionScore.bars).toHaveLength(section.bars);
      expect(sectionScore.bars.every((bar) => bar.beatStrength.join() === contract.accentPattern.join())).toBe(true);
      expect(sectionScore.bars.every((bar) => bar.energy !== undefined && bar.trajectory !== undefined)).toBe(true);
      expect(sectionScore.bars.every((bar) => bar.drumInteraction?.kickFollow === contract.drum!.kickFollow)).toBe(true);
      expect(sectionScore.bars.every((bar) => bar.drumInteraction?.snareFollow === contract.drum!.snareFollow)).toBe(true);
      expect(arrangement.drumPerformanceBySection[section.id]).toMatchObject({
        grooveContractId: contract.id,
        feelProfileId: drumFeelProfileIdForContract(contract),
      });
      sectionScore.bars.forEach((bar) => phraseRoles.add(bar.role));

      const patterns = instrumentation.drumPatternBySectionBar[section.id];
      expect(patterns).toHaveLength(section.bars);
      if (instrumentation.activeRolesBySection[section.id].includes('drum')) activePatterns.push(...patterns);
    }

    expect(phraseRoles.size).toBeGreaterThan(1);
    expect(activePatterns.length).toBeGreaterThan(0);
    expect(new Set(activePatterns.map(patternSignature)).size).toBeGreaterThan(1);

    const vocabulary = new Set(Object.values(contract.drum!.fillFamilies));
    expect(score.boundaries.length).toBeGreaterThan(0);
    expect(score.boundaries.every((boundary) => vocabulary.has(boundary.drumFillFamily))).toBe(true);
    if (style === 'pop') {
      expect(score.boundaries.every((boundary) => boundary.fillFunction !== undefined && boundary.fillScore !== undefined)).toBe(true);
      expect(new Set(score.boundaries.map((boundary) => boundary.fillScore!.recipeId)).size).toBeGreaterThan(1);
    }
  });

  it('Pop tomPickup becomes audible toms, followed by one scored kick-crash landing in final IR', () => {
    const bundle = buildSongBundle({
      seed: 2,
      styleHint: 'pop',
      mood: 'build',
      targetDuration: 120,
      key: pc(0),
    });
    const opening = bundle.arrangement.grooveScorePlan.boundaries.find((boundary) => boundary.opening);
    expect(bundle.arrangement.openingGesture).toMatchObject({
      mode: 'pickupFill',
      drumEntry: 'tomPickup',
      pickupBars: 1,
    });
    expect(opening).toMatchObject({
      sourceBar: 0,
      landingBar: 1,
      drumFillFamily: 'pop-tom-build',
      landing: 'kick-crash',
      baseMask: 'replace-bar',
    });

    const result = generateSongFromBundle(bundle);
    expect(result.status, result.report.findings.map((finding) => finding.ruleId).join(','))
      .not.toBe('failed');
    const drum = result.ir!.tracks.find((track) => track.role === 'drum')!;
    const barTicks = bundle.timebase.ppq * 4;
    const firstBarPitches = drum.notes
      .filter((note) => (note.startTick as number) < barTicks)
      .map((note) => note.pitch as number);
    const landingNotes = drum.notes
      .filter((note) => Math.abs((note.startTick as number) - barTicks) <= 2);
    const landingPitches = landingNotes
      .map((note) => note.pitch as number);

    expect(firstBarPitches.some((pitch) => new Set<number>([DRUM.TOM_LO, DRUM.TOM_MID, DRUM.TOM_HI]).has(pitch))).toBe(true);
    expect(landingPitches).toContain(DRUM.KICK);
    expect(landingPitches).toContain(DRUM.CRASH);
    expect(landingPitches.filter((pitch) => pitch === DRUM.CRASH)).toHaveLength(1);
    expect(new Set(landingNotes.map((note) => note.startTick as number)).size).toBe(1);
  });

  it('Pop final IR differentiates first-hook lift, final climax and outro release', () => {
    let bundle: ReturnType<typeof buildSongBundle> | undefined;
    for (let seed = 0; seed < 24; seed++) {
      const candidate = buildSongBundle({
        seed,
        styleHint: 'pop',
        mood: 'build',
        targetDuration: 120,
        key: pc(0),
      });
      if (candidate.arrangement.sections.filter((section) => section.functionTag === 'hook').length >= 2) {
        bundle = candidate;
        break;
      }
    }
    expect(bundle).toBeDefined();
    const arrangement = bundle!.arrangement;
    const climaxSectionId = arrangement.climaxMap[0]?.sectionId;
    const hookBoundaries = arrangement.grooveScorePlan.boundaries
      .filter((boundary) => arrangement.sections.find((section) => section.id === boundary.toSectionId)?.functionTag === 'hook');
    const firstHook = hookBoundaries.find((boundary) => boundary.toSectionId !== climaxSectionId)!;
    const climax = hookBoundaries.find((boundary) => boundary.toSectionId === climaxSectionId)!;
    const outroRelease = arrangement.grooveScorePlan.boundaries.find((boundary) =>
      boundary.fillFunction === 'release'
      && arrangement.sections.find((section) => section.id === boundary.toSectionId)?.functionTag === 'outro')!;

    expect(firstHook).toMatchObject({ fillFunction: 'lift', intensity: 2, landing: 'kick-crash' });
    expect(climax).toMatchObject({ fillFunction: 'climax', intensity: 3, landing: 'kick-crash' });
    expect(climax.fillScore).toMatchObject({
      rhythmClass: 'syncopated-sixteenth',
      orchestration: 'linear-hand-foot',
    });
    expect(outroRelease).toMatchObject({ intensity: 1, landing: 'none' });
    expect(arrangement.drumPerformanceBySection[firstHook.fromSectionId!].fillPolicy).toBe('turnaround');
    expect(arrangement.drumPerformanceBySection[climax.fromSectionId!].fillPolicy).toBe('big');

    const result = generateSongFromBundle(bundle!);
    expect(result.status, result.report.findings.map((finding) => finding.ruleId).join(','))
      .not.toBe('failed');
    const drum = result.ir!.tracks.find((track) => track.role === 'drum')!;
    const barTicks = bundle!.timebase.ppq * arrangement.meter.numerator;
    const atLanding = (landingBar: number, pitch: number) => drum.notes.filter((note) =>
      Math.abs((note.startTick as number) - landingBar * barTicks) <= 2
      && (note.pitch as number) === pitch);
    const climaxWindowStart = climax.landingBar * barTicks - climax.durationBeats * bundle!.timebase.ppq;
    const climaxWindow = drum.notes.filter((note) => {
      const tick = note.startTick as number;
      return tick >= climaxWindowStart - 2 && tick < climax.landingBar * barTicks - 2;
    });

    expect(atLanding(firstHook.landingBar, DRUM.CRASH)).toHaveLength(1);
    expect(atLanding(climax.landingBar, DRUM.CRASH)).toHaveLength(1);
    expect(atLanding(outroRelease.landingBar, DRUM.CRASH)).toHaveLength(0);
    expect(
      climaxWindow.some((note) => (note.pitch as number) === DRUM.KICK),
      JSON.stringify({ fillScore: climax.fillScore, notes: climaxWindow.map((note) => [note.pitch, note.startTick]) }),
    ).toBe(true);
    expect(climaxWindow.some((note) => new Set<number>([DRUM.TOM_HI, DRUM.TOM_MID, DRUM.TOM_LO]).has(note.pitch as number))).toBe(true);
  });

  it.each(cases)('$style: contracted rhythm-section follow survives into final IR', ({ style, seed }) => {
    const bundle = buildSongBundle({
      seed,
      styleHint: style,
      mood: 'build',
      targetDuration: 120,
      key: pc(0),
    });
    const result = generateSongFromBundle(bundle);
    expect(result.status, result.report.findings.map((finding) => finding.ruleId).join(','))
      .not.toBe('failed');
    const drum = result.ir!.tracks.find((track) => track.role === 'drum');
    expect(drum).toBeDefined();
    const ppq = bundle.timebase.ppq;
    const starts = (role: 'bass' | 'comp', pitch?: number): number[] => result.ir!.tracks
      .filter((track) => track.role === role)
      .flatMap((track) => track.notes)
      .filter((note) => pitch === undefined || (note.pitch as number) === pitch)
      .map((note) => (note.startTick as number) / ppq);
    const drumStarts = (pitch: number): number[] => drum!.notes
      .filter((note) => (note.pitch as number) === pitch)
      .map((note) => (note.startTick as number) / ppq);
    const near = (beat: number, source: readonly number[], tolerance = 0.14) =>
      source.some((candidate) => Math.abs(candidate - beat) <= tolerance);
    const contract = bundle.arrangement.songGrooveContract;

    if (contract.drum!.kickFollow === 'bass') {
      const bass = starts('bass');
      const alignedKicks = drumStarts(DRUM.KICK).filter((beat) => near(beat, bass));
      expect(alignedKicks.length, `${style} kick=${drumStarts(DRUM.KICK).length} bass=${bass.length}`).toBeGreaterThan(0);
    }
    if (contract.drum!.snareFollow === 'comping') {
      const comp = starts('comp');
      const caughtComp = drumStarts(DRUM.SNARE).filter((beat) => near(beat, comp, 0.08));
      expect(caughtComp.length, `${style} snare=${drumStarts(DRUM.SNARE).length} comp=${comp.length}`).toBeGreaterThan(0);
    }
  });
});
