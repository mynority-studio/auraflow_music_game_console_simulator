import { describe, expect, it } from 'vitest';
import { generateMusicSync } from '../../musicGeneration/MusicGenerationService';
import type { TrackIR } from '../ir/MusicalIR';
import { auditRenderedMix } from './renderMixAudit';

const STYLES = ['pop', 'jazz', 'lofi', 'rnb'] as const;
const SEEDS = [...Array.from({ length: 23 }, (_, index) => index), 3000];

describe('non-ACG render audit regression', () => {
  it('keeps the 24-seed style matrix free of blocking, mix, continuity, and octave-leap regressions', () => {
    for (const style of STYLES) {
      for (const seed of SEEDS) {
        const result = generateMusicSync({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
        expect(result.status, `${style}/${seed} generation status`).toBe('ok');
        expect(result.ir, `${style}/${seed} IR`).toBeTruthy();

        const report = result.report as {
          findings?: Array<{ severity: string; ruleId: string }>;
        } | undefined;
        const findings = report?.findings ?? [];
        expect(
          findings.filter((finding) => finding.severity === 'error' || finding.severity === 'fatal'),
          `${style}/${seed} blocking findings`,
        ).toEqual([]);
        expect(
          findings.filter((finding) =>
            finding.ruleId === 'comp-continuity-gap' || finding.ruleId === 'texture-clock-drift'
          ),
          `${style}/${seed} continuity findings`,
        ).toEqual([]);

        const mix = auditRenderedMix(result.ir!.tracks as TrackIR[], {
          style,
          ppq: 480,
          durationTicks: result.ir!.durationTicks as number,
          sectionTicks: [0],
          spaceProfile: result.uiSnapshot.spaceProfile,
          world: result.uiSnapshot.world,
        });
        expect(mix.findings.filter((finding) => finding.severity === 'error'), `${style}/${seed} mix errors`).toEqual([]);
        expect(
          mix.findings.filter((finding) => finding.code === 'master.outputClipRisk' || finding.code === 'mix.dryBaselineFxLeak' || finding.code === 'mix.dreamDefaultChannelVolume'),
          `${style}/${seed} Dream safety findings`,
        ).toEqual([]);

        const lead = result.ir!.tracks.find((track) => track.role === 'lead');
        const ordered = [...(lead?.notes ?? [])].sort((a, b) =>
          (a.startTick as number) - (b.startTick as number) || (a.pitch as number) - (b.pitch as number)
        );
        let maxLeap = 0;
        for (let index = 1; index < ordered.length; index++) {
          maxLeap = Math.max(maxLeap, Math.abs((ordered[index].pitch as number) - (ordered[index - 1].pitch as number)));
        }
        expect(maxLeap, `${style}/${seed} max consecutive lead leap`).toBeLessThanOrEqual(12);
      }
    }
  }, 20_000);

  it('LOFI 不按风格伪造踏板或未标定的电钢 CC72，独立 bass 永不继承钢琴踏板', () => {
    const result = generateMusicSync({ seed: 4, styleHint: 'lofi', mood: 'build', targetDuration: 120 });
    expect(result.ir).toBeTruthy();
    const lead = result.ir!.tracks.find((track) => track.role === 'lead');
    const comp = result.ir!.tracks.find((track) => track.role === 'comp');
    const bass = result.ir!.tracks.find((track) => track.role === 'bass');

    for (const track of [lead, comp]) {
      const releaseEvents = (track?.ccEvents ?? []).filter((event) => event.controller === 72);
      expect(releaseEvents).toEqual([]);
    }
    expect(bass?.pedalEvents).toBeUndefined();
  });
});
