import { describe, expect, it } from 'vitest';
import { pc } from '../foundation';
import { buildSongBundle, generateSongFromBundle } from '../generation/GenerationController';
import type { NoteIR } from '../ir/MusicalIR';
import {
  realizeCompPerformance,
} from './accompanimentRenderer';
import { renderTextureChordHits } from './textureRenderer';

const ZQBDWZ_SEED = 3_600_133_724;

function windowStats(
  notes: readonly NoteIR[],
  ppq: number,
  startBeat: number,
  endBeat: number,
): {
  noteCount: number;
  polyphonicOnsets: number;
  connectedRatio: number;
  maxSilentGap: number;
  hasHumanTiming: boolean;
  velocityCount: number;
} {
  const inWindow = notes
    .map((note) => ({
      startBeat: (note.startTick as number) / ppq,
      durationBeats: (note.durationTicks as number) / ppq,
      velocity: note.velocity,
    }))
    .filter((note) => note.startBeat >= startBeat && note.startBeat < endBeat);
  const onsetSizes = new Map<number, number>();
  for (const note of inWindow) {
    const onsetTick = Math.round(note.startBeat * ppq);
    onsetSizes.set(onsetTick, (onsetSizes.get(onsetTick) ?? 0) + 1);
  }
  const intervals = inWindow
    .map((note) => ({
      start: note.startBeat,
      end: Math.min(endBeat, note.startBeat + note.durationBeats),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = startBeat;
  let maxSilentGap = 0;
  for (const interval of intervals) {
    if (interval.start > cursor) maxSilentGap = Math.max(maxSilentGap, interval.start - cursor);
    cursor = Math.max(cursor, interval.end);
  }
  maxSilentGap = Math.max(maxSilentGap, endBeat - cursor);
  return {
    noteCount: inWindow.length,
    polyphonicOnsets: [...onsetSizes.values()].filter((size) => size >= 2).length,
    connectedRatio: inWindow.filter((note) => note.durationBeats >= 0.5).length / inWindow.length,
    maxSilentGap,
    hasHumanTiming: inWindow.some((note) =>
      Math.abs(note.startBeat * 2 - Math.round(note.startBeat * 2)) > 0.02),
    velocityCount: new Set(inWindow.map((note) => note.velocity)).size,
  };
}

describe('LOFI Comp continuity', () => {
  it('turns a generic one-note LOFI arp grid into an anchored two-hand, voice-safe performance', () => {
    const voiced = [52, 55, 59, 62];
    const raw = renderTextureChordHits('Piano_Emo_Broken_10th', voiced, 4);
    const performed = realizeCompPerformance(
      'Piano_Emo_Broken_10th',
      raw,
      voiced,
      4,
      {
        brokenChordTechnique: 'anchored-finger-legato',
        anchorRetriggerBeats: 2,
        fingerOverlapBeats: 0.14,
        harmonicReleaseBeats: 0.1,
        chordGateRatioByContinuity: {
          continuous: 0.94,
          semiContinuous: 0.84,
          sparse: 0.64,
          delayedEntry: 0.78,
        },
        commonToneBridgeMaxBeats: 0.65,
        damperPolicy: 'when-documented',
        unsupportedDamperFallback: 'finger-legato',
      },
      false,
    );

    expect(raw).toHaveLength(8);
    expect(raw.every((hit) => hit.midis.length === 1 && hit.dur === 0.3)).toBe(true);
    expect(performed.filter((hit) => hit.tRel === 0)).toHaveLength(2);
    expect(performed.filter((hit) => hit.tRel === 2)).toHaveLength(2);
    expect(performed.filter((hit) => hit.midis[0] === 52).map((hit) => hit.dur)).toEqual([1.9, 1.9]);
    expect(performed.filter((hit) => hit.midis[0] !== 52).slice(0, -1)
      .every((hit) => hit.dur >= 0.6)).toBe(true);
    expect(performed.every((hit) => hit.tRel + hit.dur <= 3.9 + 1e-9)).toBe(true);

    const twoVoiceShell = realizeCompPerformance(
      'Piano_Emo_Broken_10th',
      renderTextureChordHits('Piano_Emo_Broken_10th', [52, 59], 4),
      [52, 59],
      4,
      {
        brokenChordTechnique: 'anchored-finger-legato',
        anchorRetriggerBeats: 2,
        fingerOverlapBeats: 0.14,
        harmonicReleaseBeats: 0.1,
        chordGateRatioByContinuity: {
          continuous: 0.94,
          semiContinuous: 0.84,
          sparse: 0.64,
          delayedEntry: 0.78,
        },
        commonToneBridgeMaxBeats: 0.65,
        damperPolicy: 'when-documented',
        unsupportedDamperFallback: 'finger-legato',
      },
      false,
    );
    expect(twoVoiceShell.filter((hit) => hit.midis[0] === 59).slice(0, -1)
      .every((hit) => hit.dur >= 0.5)).toBe(true);

    const registerLimitedLine = realizeCompPerformance(
      'Piano_Emo_Broken_10th',
      renderTextureChordHits('Piano_Emo_Broken_10th', [59], 4),
      [59],
      4,
      {
        brokenChordTechnique: 'anchored-finger-legato',
        anchorRetriggerBeats: 2,
        fingerOverlapBeats: 0.14,
        harmonicReleaseBeats: 0.1,
        chordGateRatioByContinuity: {
          continuous: 0.94,
          semiContinuous: 0.84,
          sparse: 0.64,
          delayedEntry: 0.78,
        },
        commonToneBridgeMaxBeats: 0.65,
        damperPolicy: 'when-documented',
        unsupportedDamperFallback: 'finger-legato',
      },
      false,
    );
    expect(registerLimitedLine).toHaveLength(8);
    expect(registerLimitedLine.slice(0, -1).every((hit) =>
      hit.midis[0] === 59 && hit.dur >= 0.5)).toBe(true);
  });

  it('connects the lower guide between block-chord attacks while upper voices still breathe', () => {
    const voiced = [52, 55, 59, 62];
    const raw = renderTextureChordHits('Piano_HalfTime_Soft_Pulse', voiced, 4);
    const performed = realizeCompPerformance(
      'Piano_HalfTime_Soft_Pulse',
      raw,
      voiced,
      4,
      {
        brokenChordTechnique: 'anchored-finger-legato',
        anchorRetriggerBeats: 2,
        fingerOverlapBeats: 0.14,
        harmonicReleaseBeats: 0.1,
        chordGateRatioByContinuity: {
          continuous: 0.94,
          semiContinuous: 0.84,
          sparse: 0.64,
          delayedEntry: 0.78,
        },
        commonToneBridgeMaxBeats: 0.65,
        damperPolicy: 'when-documented',
        unsupportedDamperFallback: 'finger-legato',
      },
      false,
    );

    expect(raw.map((hit) => hit.dur)).toEqual([0.75, 0.75]);
    const guides = performed.filter((hit) => hit.midis.length === 1 && hit.midis[0] === 52);
    const upper = performed.filter((hit) => hit.midis.length === 3);
    expect(guides.map((hit) => hit.tRel)).toEqual([0.025, 2.025]);
    expect(guides[0].dur).toBeCloseTo(2);
    expect(guides[1].dur).toBeCloseTo(1.875);
    expect(upper.map((hit) => hit.dur)).toEqual([1.68, 1.575]);
    expect(upper.every((hit) => hit.dur < 2)).toBe(true);
  });

  it('fixes zqbdwz at both middle broken-chord passages; FM 电钢踏板已 documented(2026-08-12 板测),finger-legato 让位', () => {
    const bundle = buildSongBundle({
      seed: ZQBDWZ_SEED,
      styleHint: 'lofi',
      mood: 'build',
      targetDuration: 120,
      key: pc(0),
    });
    const result = generateSongFromBundle(bundle);
    expect(result.status).not.toBe('failed');
    const comp = result.ir!.tracks.find((track) => track.role === 'comp')!;
    expect(comp).toBeDefined();

    expect(bundle.arrangement.lofiFoundationPlan?.compIntent).toMatchObject({
      brokenChordTechnique: 'anchored-finger-legato',
      fingerOverlapBeats: 0.14,
      damperPolicy: 'when-documented',
      unsupportedDamperFallback: 'finger-legato',
    });
    expect(bundle.instrumentation.roleBank.comp).toBe(16);
    expect(bundle.instrumentation.roleProgram.comp).toBe(5);
    expect(bundle.instrumentation.gestureExpressionByRole.comp).toMatchObject({
      kind: 'keyboard-touch',
      noteShape: 'finger-legato',
      gateRatio: 1,
    });
    // 2026-08-12 用户板测:EP+CC64 documented → 不再断言"无踏板";damperPolicy
    // 'when-documented' 的设计本就预期此升级,finger-legato 仅作无踏板段的后备。
    expect(bundle.arrangement.sections.some((section) =>
      bundle.instrumentation.pedalPlanByRole.comp?.disabledBySection[section.id] === 'non-piano-voice'))
      .toBe(false);
    expect(result.report.textureCases).toContain('Piano_Emo_Broken_10th');

    for (const [startBeat, endBeat] of [[32, 64], [96, 128]] as const) {
      const stats = windowStats(comp.notes, bundle.timebase.ppq, startBeat, endBeat);
      // Phrase Interaction V3 deliberately thins the upper Comp while Lead
      // speaks. Continuity, polyphonic anchors and maximum silent gap remain
      // the musical gates; raw note count must no longer reward overplaying.
      expect(stats.noteCount).toBeGreaterThanOrEqual(70);
      expect(stats.polyphonicOnsets).toBeGreaterThanOrEqual(16);
      expect(
        stats.connectedRatio,
        `${bundle.arrangement.lofiFoundationPlan?.harmonyPoolId} ${JSON.stringify({
          stats,
          textures: result.report.texturePerBar,
          sample: comp.notes
            .filter((note) => (note.startTick as number) / bundle.timebase.ppq >= startBeat
              && (note.startTick as number) / bundle.timebase.ppq < startBeat + 2)
            .map((note) => ({
              pitch: note.pitch,
              start: (note.startTick as number) / bundle.timebase.ppq,
              duration: (note.durationTicks as number) / bundle.timebase.ppq,
            })),
        })}`,
      ).toBeGreaterThanOrEqual(0.75);
      // A planned call/response breath may leave the first beat of the answer
      // bar open. This is not the old accidental gap between every arp key.
      expect(stats.maxSilentGap).toBeLessThanOrEqual(1.3);
      expect(stats.hasHumanTiming).toBe(true);
      expect(stats.velocityCount).toBeGreaterThanOrEqual(12);
    }
  });

  it('keeps documented acoustic-piano LOFI Comp on the planned CC64 path', () => {
    const bundle = buildSongBundle({
      seed: 0,
      styleHint: 'lofi',
      mood: 'build',
      targetDuration: 120,
      key: pc(0),
    });
    expect(bundle.instrumentation.roleProgram.comp).toBe(0);
    expect(bundle.instrumentation.pedalPlanByRole.comp?.events.length).toBeGreaterThan(0);
    const result = generateSongFromBundle(bundle);
    const comp = result.ir!.tracks.find((track) => track.role === 'comp')!;
    expect(comp.pedalEvents?.some((event) => event.down)).toBe(true);
    expect(comp.pedalEvents?.some((event) => !event.down)).toBe(true);
  });

  it('projects every active arranger answer bar as a real late Comp attack', () => {
    for (const seed of [7, 12]) {
      const bundle = buildSongBundle({
        seed,
        styleHint: 'lofi',
        mood: 'build',
        targetDuration: 120,
        key: pc(0),
      });
      const result = generateSongFromBundle(bundle);
      const comp = result.ir!.tracks.find((track) => track.role === 'comp')!;
      const beatsPerBar = bundle.timebase.meter.numerator * (4 / bundle.timebase.meter.denominator);
      const answerBars = (bundle.arrangement.lofiPhraseInteractionPlan?.bars ?? [])
        .filter((bar) => bar.compRole === 'answer'
          && (bundle.instrumentation.activeRolesBySection[bar.sectionId] ?? []).includes('comp'));

      expect(answerBars.length, `seed ${seed} must exercise arranger answer bars`).toBeGreaterThan(0);
      expect(result.report.findings.filter((finding) => finding.ruleId === 'comp-continuity-gap'))
        .toEqual([]);
      for (const bar of answerBars) {
        const entryBeat = bar.compAnswerEntryBeat;
        expect(entryBeat, `seed ${seed} answer bar ${bar.absoluteBar} needs a score entry`).toBeDefined();
        const expected = bar.absoluteBar * beatsPerBar + entryBeat!;
        const barEnd = (bar.absoluteBar + 1) * beatsPerBar;
        const hasLateAttack = comp.notes.some((note) => {
          const beat = (note.startTick as number) / bundle.timebase.ppq;
          return beat >= expected - 0.16 && beat < barEnd - 0.02;
        });
        expect(hasLateAttack, `seed ${seed} answer bar ${bar.absoluteBar}`).toBe(true);
      }
    }
  });
});
