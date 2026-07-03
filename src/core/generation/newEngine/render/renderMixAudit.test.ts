import { describe, expect, it } from 'vitest';
import { ticks, midi } from '../foundation';
import { generateSong } from '../generation/GenerationController';
import type { TrackIR } from '../ir/MusicalIR';
import { auditRenderedMix, MASTERING_AUDIT_STANDARD } from './renderMixAudit';

const ctx = (style: string, durationTicks: number, sectionTicks: number[] = [0]) => ({
  style,
  ppq: 480,
  durationTicks,
  sectionTicks,
});

describe('render/renderMixAudit — 全轨混音与母带检测', () => {
  it('联网审计后的母带基准落为 ESP32 可移植常量', () => {
    expect(MASTERING_AUDIT_STANDARD.streamingReferenceIntegratedLufs).toBe(-14);
    expect(MASTERING_AUDIT_STANDARD.truePeakCeilingDbtp).toBe(-1);
    expect(MASTERING_AUDIT_STANDARD.esp32SamplePeakCeilingDbfs).toBe(-1.5);
    expect(MASTERING_AUDIT_STANDARD.esp32Port.requiredPostTsfStage).toContain('limiter');
  });

  it('代表 seed 全部有 TrackMix 合同且无硬件 error', () => {
    for (const style of ['pop', 'jazz', 'lofi', 'rnb', 'acg']) {
      for (const seed of [0, 1, 3, 7, 11, 42]) {
        const r = generateSong({ seed, styleHint: style, mood: 'build', targetDuration: 90 });
        if (!r.ir) continue;
        const report = auditRenderedMix(r.ir.tracks as TrackIR[], ctx(style, r.ir.durationTicks as number));
        expect(report.findings.filter((f) => f.severity === 'error'), `${style}/${seed}`).toEqual([]);
        expect(report.trackMetrics.length, `${style}/${seed} tracks`).toBeGreaterThanOrEqual(3);
        for (const m of report.trackMetrics) {
          expect(m.averageVolume, `${style}/${seed}/${m.role} avg CC7`).toBeGreaterThanOrEqual(0);
          expect(m.averageVolume, `${style}/${seed}/${m.role} avg CC7`).toBeLessThanOrEqual(127);
          expect(m.busShare, `${style}/${seed}/${m.role} share`).toBeGreaterThanOrEqual(0);
          expect(m.busShare, `${style}/${seed}/${m.role} share`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('能抓出缺 mix 与 CC 越界', () => {
    const tracks: TrackIR[] = [
      {
        role: 'lead',
        program: 0,
        mix: { volume: 150, pan: 64, reverb: 30, chorus: 0 },
        notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(480), velocity: 110 }],
      },
      {
        role: 'comp',
        program: 0,
        notes: [{ pitch: midi(60), startTick: ticks(0), durationTicks: ticks(480), velocity: 90 }],
      },
    ];
    const report = auditRenderedMix(tracks, ctx('pop', 1920));
    expect(report.status).toBe('error');
    expect(report.findings.some((f) => f.code === 'mix.ccOutOfRange' && f.role === 'lead')).toBe(true);
    expect(report.findings.some((f) => f.code === 'mix.missingTrackMix' && f.role === 'comp')).toBe(true);
  });

  it('把所有轨道纳入同一输出总线风险估计', () => {
    const tracks: TrackIR[] = [
      {
        role: 'lead',
        program: 0,
        mix: { volume: 100, pan: 64, reverb: 40, chorus: 0 },
        notes: [{ pitch: midi(76), startTick: ticks(0), durationTicks: ticks(960), velocity: 120 }],
      },
      {
        role: 'comp',
        program: 0,
        mix: { volume: 96, pan: 52, reverb: 42, chorus: 8 },
        notes: [
          { pitch: midi(60), startTick: ticks(0), durationTicks: ticks(960), velocity: 115 },
          { pitch: midi(64), startTick: ticks(0), durationTicks: ticks(960), velocity: 115 },
          { pitch: midi(67), startTick: ticks(0), durationTicks: ticks(960), velocity: 115 },
        ],
      },
      {
        role: 'drum',
        program: 0,
        mix: { volume: 110, pan: 64, reverb: 20, chorus: 0 },
        notes: [{ pitch: midi(36), startTick: ticks(0), durationTicks: ticks(120), velocity: 127 }],
      },
    ];
    const report = auditRenderedMix(tracks, ctx('pop', 1920));
    expect(report.peakPreMasterLinear).toBeGreaterThan(1);
    expect(report.findings.some((f) => f.code === 'master.limiterWillWork')).toBe(true);
  });
});
