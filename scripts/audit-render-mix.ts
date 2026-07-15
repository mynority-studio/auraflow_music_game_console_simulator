import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateMusicSync } from '../src/core/generation/musicGeneration/MusicGenerationService';
import { auditRenderedMix, HARDWARE_SPEAKER_PROFILE } from '../src/core/generation/newEngine/render/renderMixAudit';
import type { TrackIR } from '../src/core/generation/newEngine/ir/MusicalIR';
import type { MixAuditReport } from '../src/core/generation/newEngine/render/renderMixAudit';

const STYLES = ['pop', 'jazz', 'lofi', 'rnb', 'acg'] as const;
const SEEDS = [0, 1, 2, 3, 4, 5, 7, 11, 42, 99] as const;
const OUT = resolve('docs/generated/render_mix_mastering_audit_report.md');

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : 'n/a';
}

const lines: string[] = [
  '# Render Mix / Mastering Audit',
  '',
  'Scope: final MusicalIR tracks after instrumentation mix attachment and render mix balance.',
  '',
  'External basis:',
  '- ITU-R BS.1770-5: programme loudness and true-peak measurement algorithm.',
  '- EBU R128: programme loudness, loudness range, maximum true peak, -1 dBTP production ceiling.',
  '- Spotify for Artists: -14 LUFS playback reference and -1 dBTP mastering guidance.',
  '- Apple Digital Masters: leave at least 1 dB headroom to avoid oversampling/AAC clipping.',
  '',
  `Hardware speaker target: ${HARDWARE_SPEAKER_PROFILE.model}, ${HARDWARE_SPEAKER_PROFILE.sizeMm.join('x')}mm, ${HARDWARE_SPEAKER_PROFILE.impedanceOhm}ohm, ${HARDWARE_SPEAKER_PROFILE.ratedPowerWRms}W RMS, F0 ${HARDWARE_SPEAKER_PROFILE.resonanceHz}Hz in ${HARDWARE_SPEAKER_PROFILE.enclosureCc}cc box.`,
  `Speaker mix guardrails: kick/body ${HARDWARE_SPEAKER_PROFILE.mixBandsHz.kickBody.join('-')}Hz, mid body ${HARDWARE_SPEAKER_PROFILE.mixBandsHz.midBody.join('-')}Hz, presence attack ${HARDWARE_SPEAKER_PROFILE.mixBandsHz.presenceAttack.join('-')}Hz, harshness control ${HARDWARE_SPEAKER_PROFILE.mixBandsHz.harshnessControl.join('-')}Hz; drum reverb CC <= ${HARDWARE_SPEAKER_PROFILE.guardrails.drumReverbCcMax}, drum transient CC <= ${HARDWARE_SPEAKER_PROFILE.guardrails.drumTransientCcMax}.`,
  '',
  '| Style | Seed | Status | Est. LUFS | Playback LUFS | Target | Delta | Master Lift | Recommended | Wet Energy | Hardware Drive Proxy dBFS | Tracks | Diagnosis | Findings |',
  '|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|',
];

let pass = 0;
let warn = 0;
let error = 0;
let noIr = 0;
const styleReports = new Map<string, MixAuditReport[]>();

function avg(vals: readonly number[]): number {
  return vals.length ? vals.reduce((sum, v) => sum + v, 0) / vals.length : Number.NaN;
}

function range(vals: readonly number[], digits = 1): string {
  if (!vals.length) return 'n/a';
  return `${Math.min(...vals).toFixed(digits)}..${Math.max(...vals).toFixed(digits)}`;
}

function diagnoseTags(report: MixAuditReport): string[] {
  const tags: string[] = [];
  const allowed = report.standard.hardwareMaster.playbackStyleMasterLiftCalibration[
    report.style as keyof typeof report.standard.hardwareMaster.playbackStyleMasterLiftCalibration
  ]?.acceptablePlaybackLufs;
  if (allowed && report.estimatedPlaybackIntegratedLufs < allowed[0]) tags.push('音量小');
  if (allowed && report.estimatedPlaybackIntegratedLufs > allowed[1]) tags.push('音量偏大');
  if (report.estimatedDeviceOutputPeakDbfs > report.standard.esp32SamplePeakCeilingDbfs + 6) tags.push('软削偏多');
  else if (report.estimatedDeviceOutputPeakDbfs > report.standard.esp32SamplePeakCeilingDbfs) tags.push('软削工作');
  const pad = report.trackMetrics.find((m) => m.role === 'pad');
  const bass = report.trackMetrics.find((m) => m.role === 'bass');
  const drum = report.trackMetrics.find((m) => m.role === 'drum');
  const bassShareFloor = report.style === 'acg'
    ? report.standard.hardwareSpeaker.guardrails.bassSustainedBusShareMinAcg
    : report.standard.hardwareSpeaker.guardrails.bassSustainedBusShareMinDefault;
  if (pad && pad.busShare > report.standard.hardwareSpeaker.guardrails.padSustainedBusShareMax) tags.push('pad偏大');
  if (pad && pad.hardwareReverbBusShare > report.standard.hardwareSpeaker.guardrails.padHardwareReverbBusShareMax) tags.push('pad空间偏多');
  if (bass && bass.noteCount > 0 && bass.busShare < bassShareFloor) tags.push('bass听感偏低');
  if (drum && drum.noteCount > 0 && drum.maxVolume > report.standard.hardwareSpeaker.guardrails.drumTransientCcMax) tags.push('鼓瞬态偏前');
  return tags;
}

function diagnose(report: MixAuditReport): string {
  const tags = diagnoseTags(report);
  return tags.length ? tags.join(' / ') : 'ok';
}

for (const style of STYLES) {
  for (const seed of SEEDS) {
    const result = generateMusicSync({ seed, styleHint: style, mood: 'build', targetDuration: 90 });
    if (!result.ir) {
      noIr++;
      lines.push(`| ${style} | ${seed} | no-ir | n/a | n/a | n/a | n/a | n/a | n/a | generation returned no IR |`);
      continue;
    }

    const report = auditRenderedMix(result.ir.tracks as TrackIR[], {
      style,
      ppq: 480,
      durationTicks: result.ir.durationTicks as number,
      sectionTicks: [0],
      spaceProfile: result.uiSnapshot.spaceProfile,
      world: result.uiSnapshot.world,
    });

    if (report.status === 'pass') pass++;
    else if (report.status === 'warning') warn++;
    else error++;
    const reports = styleReports.get(style) ?? [];
    reports.push(report);
    styleReports.set(style, reports);

    const tracks = report.trackMetrics
      .map((m) => `${m.role}:${fmt(m.busShare * 100, 0)}%/cc${fmt(m.averageVolume, 0)}/rv${fmt(m.hardwareReverbBusShare * 100, 0)}%`)
      .join(' ');
    const findings = report.findings.length
      ? report.findings.map((f) => `${f.severity}:${f.code}${f.role ? `(${f.role})` : ''}`).join('<br>')
      : 'ok';

    lines.push([
      `| ${style}`,
      seed,
      report.status,
      fmt(report.estimatedIntegratedLufs, 1),
      fmt(report.estimatedPlaybackIntegratedLufs, 1),
      fmt(report.targetPlaybackIntegratedLufs, 1),
      fmt(report.playbackLoudnessDeltaDb, 1),
      fmt(report.playbackMasterLift, 2),
      fmt(report.recommendedPlaybackMasterLift, 2),
      fmt(report.totalWetEnergyPerBeat, 3),
      fmt(report.estimatedDeviceOutputPeakDbfs, 1),
      tracks,
      diagnose(report),
      findings,
    ].join(' | ') + ' |');
  }
}

const styleSummary = [
  '## Style Master Lift Calibration',
  '',
  '| Style | Target Playback LUFS | Allowed | Current Lift | Recommended From Avg | Avg Playback LUFS | Playback Range | Avg Delta | Max Drive Proxy dBFS | Diagnosis |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',
];
for (const style of STYLES) {
  const reports = styleReports.get(style) ?? [];
  const first = reports[0];
  if (!first) continue;
  const cal = first.standard.hardwareMaster.playbackStyleMasterLiftCalibration[style];
  const play = reports.map((r) => r.estimatedPlaybackIntegratedLufs);
  const delta = reports.map((r) => r.playbackLoudnessDeltaDb);
  const drive = reports.map((r) => r.estimatedDeviceOutputPeakDbfs);
  const rec = reports.map((r) => r.recommendedPlaybackMasterLift);
  const tags = [...new Set(reports.flatMap(diagnoseTags))];
  styleSummary.push([
    `| ${style}`,
    fmt(cal.targetPlaybackIntegratedLufs, 1),
    `${fmt(cal.acceptablePlaybackLufs[0], 1)}..${fmt(cal.acceptablePlaybackLufs[1], 1)}`,
    fmt(cal.lift, 2),
    fmt(avg(rec), 2),
    fmt(avg(play), 1),
    range(play, 1),
    fmt(avg(delta), 1),
    fmt(Math.max(...drive), 1),
    tags.length ? tags.join('<br>') : 'ok',
  ].join(' | ') + ' |');
}

lines.splice(4, 0, `Summary: pass=${pass}, warning=${warn}, error=${error}, no-ir=${noIr}.`, '', ...styleSummary, '');
lines.push('');
lines.push('ESP32-S3 interpretation: `info:master.limiterWillWork` means the shared post-TSF limiter/softclip stage is expected to work; warnings are reserved for mix balance issues that still need musical or routing fixes.');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${lines.join('\n')}\n`);
console.log(`Wrote ${OUT}`);
console.log(`Summary: pass=${pass}, warning=${warn}, error=${error}, no-ir=${noIr}`);
