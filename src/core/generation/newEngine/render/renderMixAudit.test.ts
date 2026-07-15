import { describe, expect, it } from 'vitest';
import { ticks, midi } from '../foundation';
import { generateSong } from '../generation/GenerationController';
import { generateMusicSync } from '../../musicGeneration/MusicGenerationService';
import type { TrackIR } from '../ir/MusicalIR';
import { auditRenderedMix, HARDWARE_SPEAKER_PROFILE, MASTERING_AUDIT_STANDARD } from './renderMixAudit';

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
    expect(MASTERING_AUDIT_STANDARD.esp32Port.sampleRateHz).toBe(24000);
    expect(MASTERING_AUDIT_STANDARD.hardwareMaster.route).toContain('Dream 5504/SAM');
    expect(MASTERING_AUDIT_STANDARD.esp32Port.requiredPostTsfStage).toContain('Dream/SAM shared FX');
    expect(MASTERING_AUDIT_STANDARD.hardwareMaster.webCompressorAfterDevicePostChain).toBe(false);
    expect(MASTERING_AUDIT_STANDARD.hardwareMaster.playbackStyleMasterLiftCalibration.acg.targetPlaybackIntegratedLufs).toBe(-12.4);
    expect(MASTERING_AUDIT_STANDARD.hardwareSpeaker.model).toBe(HARDWARE_SPEAKER_PROFILE.model);
  });

  it('硬件喇叭规格进入混音审计标准', () => {
    expect(HARDWARE_SPEAKER_PROFILE.model).toBe('YD3411-H-YC16-8B');
    expect(HARDWARE_SPEAKER_PROFILE.enclosureCc).toBe(4);
    expect(HARDWARE_SPEAKER_PROFILE.impedanceOhm).toBe(4);
    expect(HARDWARE_SPEAKER_PROFILE.ratedPowerWRms).toBe(2);
    expect(HARDWARE_SPEAKER_PROFILE.resonanceHz).toBe(630);
    expect(HARDWARE_SPEAKER_PROFILE.sensitivityDbSpl.at2kHz - HARDWARE_SPEAKER_PROFILE.sensitivityDbSpl.at400Hz).toBe(9);
    expect(HARDWARE_SPEAKER_PROFILE.mixBandsHz.lowCutProtection).toBe(75);
    expect(HARDWARE_SPEAKER_PROFILE.guardrails.bassReverbCcMax).toBe(12);
    expect(HARDWARE_SPEAKER_PROFILE.guardrails.drumReverbCcMax).toBe(18);
    expect(HARDWARE_SPEAKER_PROFILE.guardrails.roomDrumReverbCcMax).toBe(24);
    expect(HARDWARE_SPEAKER_PROFILE.guardrails.drumTransientCcMax).toBe(78);
    expect(HARDWARE_SPEAKER_PROFILE.guardrails.bassSustainedBusShareMinDefault).toBe(0.12);
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
    expect(report.findings.some((f) => f.code === 'master.outputClipRisk')).toBe(true);
  });

  it('审计计入进入设备保护链前的 master lift,用于抓宏观风格音量不均衡', () => {
    const tracks: TrackIR[] = [
      {
        role: 'lead',
        program: 0,
        mix: { volume: 92, pan: 64, reverb: 36, chorus: 0 },
        notes: [{ pitch: midi(76), startTick: ticks(0), durationTicks: ticks(960), velocity: 100 }],
      },
    ];
    const pop = auditRenderedMix(tracks, ctx('pop', 1920));
    const acg = auditRenderedMix(tracks, ctx('acg', 1920));
    const popLiftDb = 20 * Math.log10(pop.playbackMasterLift);
    const acgLiftDb = 20 * Math.log10(acg.playbackMasterLift);
    expect(pop.playbackMasterLift).toBe(MASTERING_AUDIT_STANDARD.hardwareMaster.playbackStyleMasterLift.pop);
    expect(acg.playbackMasterLift).toBe(MASTERING_AUDIT_STANDARD.hardwareMaster.playbackStyleMasterLift.acg);
    expect(acg.targetPlaybackIntegratedLufs).toBe(-12.4);
    expect(acg.estimatedPlaybackIntegratedLufs).toBeCloseTo(acg.estimatedIntegratedLufs + acgLiftDb, 3);
    expect(acg.playbackLoudnessDeltaDb).toBeCloseTo(acg.estimatedPlaybackIntegratedLufs - acg.targetPlaybackIntegratedLufs, 3);
    expect(acg.recommendedPlaybackMasterLift).toBeGreaterThan(pop.recommendedPlaybackMasterLift);
    expect(acg.estimatedDeviceOutputPeakDbfs).toBeCloseTo(pop.estimatedDeviceOutputPeakDbfs + acgLiftDb - popLiftDb, 3);
  });

  it('hardware reverb audit 优先使用器配层已选 spaceProfile,不重新按 style/hasPad 推导', () => {
    const tracks: TrackIR[] = [
      {
        role: 'lead',
        program: 5,
        mix: { volume: 90, pan: 64, reverb: 58, chorus: 50 },
        notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(960), velocity: 100 }],
      },
    ];
    const dryFallback = auditRenderedMix(tracks, ctx('pop', 1920));
    const selectedSynthetic = auditRenderedMix(tracks, {
      ...ctx('pop', 1920),
      spaceProfile: 'syntheticSoftRoom',
      world: 'syntheticSoft',
    });
    expect(selectedSynthetic.totalHardwareReverbInputEnergyPerBeat).toBeGreaterThan(dryFallback.totalHardwareReverbInputEnergyPerBeat);
  });

  it('hardware reverb bus audit covers pitnkl so pad/comp cannot flood the shared room silently', () => {
    const seedPitnkl = 3306999508;
    const result = generateMusicSync({ seed: seedPitnkl, styleHint: 'rnb', mood: 'build', targetDuration: 120 });
    expect(result.ir).toBeTruthy();
    const report = auditRenderedMix(result.ir!.tracks as TrackIR[], ctx('rnb', result.ir!.durationTicks as number));
    const pad = report.trackMetrics.find((m) => m.role === 'pad');
    const comp = report.trackMetrics.find((m) => m.role === 'comp');
    expect(report.totalHardwareReverbInputEnergyPerBeat).toBeGreaterThan(0);
    expect(pad?.hardwareReverbBusShare ?? 0).toBeLessThanOrEqual(0.28);
    expect(comp?.hardwareReverbBusShare ?? 0).toBeLessThanOrEqual(HARDWARE_SPEAKER_PROFILE.guardrails.compHardwareReverbBusShareMax);
    expect(report.findings.some((f) => f.code === 'mix.hardwarePadReverbDominant')).toBe(false);
    expect(report.findings.some((f) => f.code === 'mix.hardwareCompReverbDominant')).toBe(false);
  });

  it('小喇叭 guardrail 会抓出鼓轨混响过湿', () => {
    const tracks: TrackIR[] = [
      {
        role: 'drum',
        program: 0,
        mix: { volume: 100, pan: 64, reverb: 36, chorus: 0 },
        notes: [{ pitch: midi(36), startTick: ticks(0), durationTicks: ticks(120), velocity: 118 }],
      },
      {
        role: 'comp',
        program: 0,
        mix: { volume: 84, pan: 52, reverb: 30, chorus: 6 },
        notes: [{ pitch: midi(60), startTick: ticks(0), durationTicks: ticks(960), velocity: 82 }],
      },
    ];
    const report = auditRenderedMix(tracks, ctx('pop', 1920));
    expect(report.findings.some((f) => f.code === 'speaker.drumReverbTooWet' && f.role === 'drum')).toBe(true);
  });

  it('Room 鼓组允许受控 room send,但更湿仍会报警', () => {
    const base: TrackIR = {
      role: 'drum',
      program: 8,
      mix: { volume: 60, pan: 64, reverb: 24, chorus: 0 },
      notes: [{ pitch: midi(36), startTick: ticks(0), durationTicks: ticks(120), velocity: 118 }],
    };
    expect(auditRenderedMix([base], ctx('pop', 1920)).findings.some((f) => f.code === 'speaker.drumReverbTooWet')).toBe(false);
    const tooWet = auditRenderedMix([{ ...base, mix: { ...base.mix!, reverb: 30 } }], ctx('pop', 1920));
    expect(tooWet.findings.some((f) => f.code === 'speaker.drumReverbTooWet' && f.role === 'drum')).toBe(true);
  });

  it('小喇叭 guardrail 会抓出鼓瞬态过前和 bass 被埋', () => {
    const tracks: TrackIR[] = [
      {
        role: 'drum',
        program: 0,
        mix: { volume: 100, pan: 64, reverb: 12, chorus: 0 },
        notes: [{ pitch: midi(36), startTick: ticks(0), durationTicks: ticks(120), velocity: 127 }],
      },
      {
        role: 'bass',
        program: 32,
        mix: { volume: 45, pan: 64, reverb: 8, chorus: 0 },
        notes: [{ pitch: midi(40), startTick: ticks(0), durationTicks: ticks(960), velocity: 80 }],
      },
      {
        role: 'comp',
        program: 0,
        mix: { volume: 92, pan: 52, reverb: 42, chorus: 8 },
        notes: [
          { pitch: midi(60), startTick: ticks(0), durationTicks: ticks(960), velocity: 90 },
          { pitch: midi(64), startTick: ticks(0), durationTicks: ticks(960), velocity: 90 },
          { pitch: midi(67), startTick: ticks(0), durationTicks: ticks(960), velocity: 90 },
        ],
      },
    ];
    const report = auditRenderedMix(tracks, ctx('pop', 1920));
    expect(report.findings.some((f) => f.code === 'speaker.drumTransientTooForward' && f.role === 'drum')).toBe(true);
    expect(report.findings.some((f) => f.code === 'mix.bassTooHidden' && f.role === 'bass')).toBe(true);
  });

  it('代表性残留 warning seed 已收敛为可预期 info 或 pass', () => {
    const cases = [
      ['pop', 99],
      ['jazz', 1],
      ['jazz', 2],
      ['jazz', 7],
      ['jazz', 99],
      ['lofi', 3],
      ['lofi', 42],
      ['rnb', 1],
    ] as const;

    for (const [style, seed] of cases) {
      const result = generateMusicSync({ seed, styleHint: style, mood: 'build', targetDuration: 90 });
      expect(result.ir, `${style}/${seed} should generate IR`).toBeTruthy();
      const report = auditRenderedMix(result.ir!.tracks as TrackIR[], {
        ...ctx(style, result.ir!.durationTicks as number),
        spaceProfile: result.uiSnapshot.spaceProfile,
        world: result.uiSnapshot.world,
      });
      expect(report.findings.filter((f) => f.severity !== 'info'), `${style}/${seed}`).toEqual([]);
    }
  });

  it('lofi/4 的声明 bass pedal 不再把 mix audit 样本打成 no-ir', () => {
    const result = generateMusicSync({ seed: 4, styleHint: 'lofi', mood: 'build', targetDuration: 90 });
    expect(result.status).toBe('ok');
    expect(result.ir).toBeTruthy();
    const findings = (result.report as { findings: { severity: string; ruleId: string }[] }).findings;
    expect(findings.some((f) => f.severity === 'error' && f.ruleId === 'avoid-long-exposure')).toBe(false);
  });

});
