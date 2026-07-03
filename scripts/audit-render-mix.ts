import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateSong } from '../src/core/generation/newEngine/generation/GenerationController';
import { auditRenderedMix } from '../src/core/generation/newEngine/render/renderMixAudit';
import type { TrackIR } from '../src/core/generation/newEngine/ir/MusicalIR';

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
  '| Style | Seed | Status | Est. LUFS | Wet Energy | Peak Proxy dBFS | Tracks | Findings |',
  '|---|---:|---|---:|---:|---:|---|---|',
];

let pass = 0;
let warn = 0;
let error = 0;
let noIr = 0;

for (const style of STYLES) {
  for (const seed of SEEDS) {
    const result = generateSong({ seed, styleHint: style, mood: 'build', targetDuration: 90 });
    if (!result.ir) {
      noIr++;
      lines.push(`| ${style} | ${seed} | no-ir | n/a | n/a | n/a | n/a | generation returned no IR |`);
      continue;
    }

    const report = auditRenderedMix(result.ir.tracks as TrackIR[], {
      style,
      ppq: 480,
      durationTicks: result.ir.durationTicks as number,
      sectionTicks: [0],
    });

    if (report.status === 'pass') pass++;
    else if (report.status === 'warning') warn++;
    else error++;

    const tracks = report.trackMetrics
      .map((m) => `${m.role}:${fmt(m.busShare * 100, 0)}%/cc${fmt(m.averageVolume, 0)}`)
      .join(' ');
    const findings = report.findings.length
      ? report.findings.map((f) => `${f.severity}:${f.code}${f.role ? `(${f.role})` : ''}`).join('<br>')
      : 'ok';

    lines.push([
      `| ${style}`,
      seed,
      report.status,
      fmt(report.estimatedIntegratedLufs, 1),
      fmt(report.totalWetEnergyPerBeat, 3),
      fmt(report.estimatedPostMakeupPeakDbfs, 1),
      tracks,
      findings,
    ].join(' | ') + ' |');
  }
}

lines.splice(4, 0, `Summary: pass=${pass}, warning=${warn}, error=${error}, no-ir=${noIr}.`, '');
lines.push('');
lines.push('ESP32-S3 interpretation: warnings with `master.limiterWillWork` mean the shared post-TSF limiter/softclip stage is required; without that post-processing, the same MIDI balance can clip at the DAC.');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${lines.join('\n')}\n`);
console.log(`Wrote ${OUT}`);
console.log(`Summary: pass=${pass}, warning=${warn}, error=${error}, no-ir=${noIr}`);
