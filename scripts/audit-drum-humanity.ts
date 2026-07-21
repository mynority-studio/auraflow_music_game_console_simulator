import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pc, createTimebase } from '../src/core/generation/newEngine/foundation';
import {
  buildSongBundle,
  generateSongFromBundle,
  type SongBundle,
} from '../src/core/generation/newEngine/generation/GenerationController';
import { freezeMusicalIR, type MusicalIR } from '../src/core/generation/newEngine/ir/MusicalIR';
import { musicalIRToSMF } from '../src/core/generation/newEngine/sandbox/midiFile';
import {
  auditDrumHumanity,
  type DrumHumanityAudit,
  type DrumVoiceAudit,
} from '../src/core/generation/newEngine/render/drumHumanityAudit';
import {
  grooveContractsForStyle,
  type GrooveStyleName,
} from '../src/core/generation/newEngine/knowledge/grooveContracts';
import { drumPerformanceVariants } from '../src/core/generation/newEngine/knowledge/grooves';
import { popRockFillRecipeDescriptors } from '../src/core/generation/newEngine/knowledge/drumFillVocabulary';

const STYLES = ['pop', 'rnb', 'lofi', 'jazz'] as const;
const TEMPOS = [84, 120, 168] as const;
const SEEDS = [3, 7, 42] as const;
const MAX_BARS = 16;
const OUT_DIR = resolve('tmp/drum-humanity-baseline');
const REPORT_PATH = resolve('docs/generated/drum_humanity_baseline.md');
const JSON_PATH = resolve('docs/generated/drum_humanity_baseline.json');
const AUDIO = process.env.AUDIT_DRUM_AUDIO === '1';

interface AuditRow {
  style: typeof STYLES[number];
  tempoBpm: number;
  seed: number;
  grooveContractId: string;
  patternFamilies: string[];
  audit: DrumHumanityAudit;
}

function bundleAtTempo(bundle: SongBundle, tempoBpm: number): SongBundle {
  return {
    ...bundle,
    arrangement: { ...bundle.arrangement, tempoBpm },
    timebase: createTimebase({
      ppq: bundle.timebase.ppq,
      meter: bundle.arrangement.meter,
      tempoMap: [{ atBeat: 0 as never, bpm: tempoBpm }],
    }),
  };
}

function clippedIr(ir: MusicalIR, tracks: readonly MusicalIR['tracks'][number][], maxBars: number): MusicalIR {
  const beatsPerBar = ir.timebase.meter.numerator * (4 / ir.timebase.meter.denominator);
  const duration = Math.min(ir.durationTicks as number, Math.round(maxBars * beatsPerBar * ir.timebase.ppq));
  return freezeMusicalIR({
    timebase: ir.timebase,
    durationTicks: duration as never,
    tracks: tracks.map((track) => ({
      ...track,
      notes: track.notes.filter((note) => (note.startTick as number) < duration).map((note) => ({ ...note })),
      programChanges: track.programChanges?.filter((event) => (event.atTick as number) < duration).map((event) => ({ ...event })),
      mixChanges: track.mixChanges?.filter((event) => (event.atTick as number) < duration).map((event) => ({ ...event, mix: { ...event.mix } })),
      pedalEvents: track.pedalEvents?.filter((event) => (event.atTick as number) < duration).map((event) => ({ ...event })),
      ccEvents: track.ccEvents?.filter((event) => (event.atTick as number) < duration).map((event) => ({ ...event })),
      pitchBendEvents: track.pitchBendEvents?.filter((event) => (event.atTick as number) < duration).map((event) => ({ ...event })),
    })),
  });
}

function average(rows: readonly AuditRow[], pick: (row: AuditRow) => number): number {
  return rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + pick(row), 0) / rows.length;
}

function voice(audit: DrumHumanityAudit, name: 'kick' | 'snare' | 'hat' | 'ride'): DrumVoiceAudit | undefined {
  return audit.voices[name];
}

function timekeeper(audit: DrumHumanityAudit): DrumVoiceAudit | undefined {
  const hat = voice(audit, 'hat');
  const ride = voice(audit, 'ride');
  return (ride?.count ?? 0) > (hat?.count ?? 0) ? ride : hat ?? ride;
}

function fmt(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '-' : value.toFixed(digits);
}

function renderAudio(midiPath: string, wavPath: string): void {
  const sf2 = [
    process.env.AUDIT_DRUM_SF2,
    resolve('public/Aura25_GM128.sf2'),
    resolve('docs/generated/Aura25_GM128_20260714_raw_level.sf2'),
  ].filter((candidate): candidate is string => !!candidate).find(existsSync);
  if (!sf2) throw new Error('Missing drum audit SoundFont; set AUDIT_DRUM_SF2');
  const result = spawnSync('swift', [
    resolve('scripts/render-midi-to-wav.swift'),
    '--midi', midiPath,
    '--sf2', sf2,
    '--out', wavPath,
    '--tail', '1',
  ], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Audio render failed for ${midiPath}`);
}

function vocabularySummary(style: typeof STYLES[number]) {
  const contracts = grooveContractsForStyle(style.toUpperCase() as GrooveStyleName);
  const families = new Set<string>();
  const fillFamilies = new Set<string>();
  const kits = new Set<number>();
  let hasPopRockVocabulary = false;
  for (const contract of contracts) {
    const drum = contract.drum;
    if (!drum) continue;
    kits.add(drum.kitProgram);
    [drum.timekeeperFamily, drum.liftFamily, drum.pickupFamily, drum.breakdownFamily]
      .filter((family): family is string => !!family)
      .forEach((family) => families.add(family));
    Object.values(drum.fillFamilies).forEach((family) => fillFamilies.add(family));
    if (drum.fillVocabulary) hasPopRockVocabulary = true;
  }
  const pitches = new Set<number>();
  let variants = 0;
  for (const family of families) {
    const material = drumPerformanceVariants({ patternFamily: family });
    variants += material.length;
    material.flat().forEach((hit) => pitches.add(hit.drum));
  }
  return {
    contracts: contracts.length,
    families: families.size,
    variants,
    fillFamilies: fillFamilies.size,
    fillRecipes: hasPopRockVocabulary ? popRockFillRecipeDescriptors().length : fillFamilies.size,
    kits: [...kits].sort((a, b) => a - b),
    pitches: [...pitches].sort((a, b) => a - b),
  };
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(resolve('docs/generated'), { recursive: true });

const rows: AuditRow[] = [];
for (const style of STYLES) {
  for (const tempoBpm of TEMPOS) {
    for (const seed of SEEDS) {
      const bundle = bundleAtTempo(buildSongBundle({
        seed,
        styleHint: style,
        mood: 'build',
        targetDuration: 72,
        key: pc(0),
      }), tempoBpm);
      const result = generateSongFromBundle(bundle);
      if (!result.ir || result.status === 'failed') {
        throw new Error(`${style}/${tempoBpm}/${seed} generation failed: ${result.report.findings.map((finding) => finding.ruleId).join(',')}`);
      }
      const drum = result.ir.tracks.find((track) => track.role === 'drum');
      if (!drum || drum.notes.length === 0) throw new Error(`${style}/${tempoBpm}/${seed} has no drum track`);
      const drumIr = clippedIr(result.ir, [{ ...drum, notes: [...drum.notes] }], MAX_BARS);
      const mixIr = clippedIr(result.ir, result.ir.tracks.map((track) => ({ ...track, notes: [...track.notes] })), MAX_BARS);
      const stem = resolve(OUT_DIR, `${style}-${tempoBpm}-${seed}.drums.mid`);
      writeFileSync(stem, Buffer.from(musicalIRToSMF(drumIr, tempoBpm, style)));

      if (AUDIO && tempoBpm === 120 && seed === 7) {
        const mix = resolve(OUT_DIR, `${style}-${tempoBpm}-${seed}.mix.mid`);
        writeFileSync(mix, Buffer.from(musicalIRToSMF(mixIr, tempoBpm, style)));
        renderAudio(stem, resolve(OUT_DIR, `${style}-${tempoBpm}-${seed}.drums.wav`));
        renderAudio(mix, resolve(OUT_DIR, `${style}-${tempoBpm}-${seed}.mix.wav`));
      }

      rows.push({
        style,
        tempoBpm,
        seed,
        grooveContractId: bundle.arrangement.songGrooveContract.id,
        patternFamilies: [...new Set(Object.values(bundle.arrangement.drumPerformanceBySection).map((performance) => performance.patternFamily))],
        audit: auditDrumHumanity({
          notes: drumIr.tracks[0]?.notes ?? [],
          ppq: bundle.timebase.ppq,
          beatsPerBar: bundle.arrangement.meter.numerator * (4 / bundle.arrangement.meter.denominator),
          tempoBpm,
          scorePlan: bundle.arrangement.grooveScorePlan,
          contractBySection: bundle.arrangement.grooveContractBySection,
        }),
      });
    }
  }
}

const lines = [
  '# Drum Humanity Production Audit',
  '',
  'Current production path: 4 styles x 3 tempos x 3 seeds. MIDI clips are written to `tmp/drum-humanity-baseline/`.',
  '',
  'Research anchors: [Groove MIDI Dataset](https://magenta.tensorflow.org/datasets/groove), [GrooVAE](https://magenta.tensorflow.org/groovae), [Ableton grooves](https://www.ableton.com/en/live-manual/12/using-grooves/), [Friberg and Sundstrom swing study](https://www.diva-portal.org/smash/get/diva2%3A1246291/DATASET01.pdf), [Drumeo rock guide](https://www.drumeo.com/beat/a-drummers-guide-to-rock/), [60 Must-Know Drum Fills](https://www.youtube.com/watch?v=7wskFK6HP6w).',
  '',
  '## Vocabulary Inventory',
  '',
  '| Style | Groove contracts | Pattern families | Base variants | Fill families | Reachable fill recipes | Kits | Authored base pitches | Rendered surfaces |',
  '|---|---:|---:|---:|---:|---:|---|---|---|',
  ...STYLES.map((style) => {
    const summary = vocabularySummary(style);
    const surfaces = [...new Set(rows
      .filter((row) => row.style === style)
      .flatMap((row) => row.audit.voicedKitPieces))].sort();
    return `| ${style.toUpperCase()} | ${summary.contracts} | ${summary.families} | ${summary.variants} | ${summary.fillFamilies} | ${summary.fillRecipes} | ${summary.kits.join(', ')} | ${summary.pitches.join(', ')} | ${surfaces.join(', ')} |`;
  }),
  '',
  '## Style Summary',
  '',
  '| Style | Notes | Rhythm repeat | Performance repeat | Snare accent/ghost | Hat velocity SD | Timing SD ms | Exact-grid |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
];

for (const style of STYLES) {
  const selected = rows.filter((row) => row.style === style);
  lines.push(`| ${style.toUpperCase()} | ${fmt(average(selected, (row) => row.audit.noteCount), 0)} | ${fmt(average(selected, (row) => row.audit.repeatedRhythmBarRatio) * 100)}% | ${fmt(average(selected, (row) => row.audit.repeatedPerformanceBarRatio) * 100)}% | ${fmt(average(selected.filter((row) => row.audit.snareAccentGhostSeparation !== null), (row) => row.audit.snareAccentGhostSeparation ?? 0))} | ${fmt(average(selected.filter((row) => timekeeper(row.audit)), (row) => timekeeper(row.audit)?.velocityStdDev ?? 0))} | ${fmt(average(selected, (row) => {
    const values = ['kick', 'snare', 'hat', 'ride']
      .map((name) => voice(row.audit, name as 'kick' | 'snare' | 'hat' | 'ride')?.timingOffsetStdDevMs)
      .filter((value): value is number => value !== undefined);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }))} | ${fmt(average(selected, (row) => {
    const values = Object.values(row.audit.voices).map((entry) => entry.exactGridRatio);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }) * 100)}% |`);
}

lines.push('', '## Matrix', '', '| Style | BPM | Seed | Contract | Families | Notes | Rhythm sig | Performance sig | Kick SD | Snare SD | Hat/Ride SD | Timing SD ms |', '|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---:|');
for (const row of rows) {
  const keeper = timekeeper(row.audit);
  const timingValues = Object.values(row.audit.voices).map((entry) => entry.timingOffsetStdDevMs);
  lines.push(`| ${row.style} | ${row.tempoBpm} | ${row.seed} | ${row.grooveContractId} | ${row.patternFamilies.join(', ')} | ${row.audit.noteCount} | ${row.audit.rhythmSignatureCount}/${row.audit.barCount} | ${row.audit.performanceSignatureCount}/${row.audit.barCount} | ${fmt(voice(row.audit, 'kick')?.velocityStdDev)} | ${fmt(voice(row.audit, 'snare')?.velocityStdDev)} | ${fmt(keeper?.velocityStdDev)} | ${fmt(timingValues.length ? timingValues.reduce((sum, value) => sum + value, 0) / timingValues.length : 0)} |`);
}

lines.push('', '## Interpretation', '', '- Rhythm signatures measure score/pattern diversity; performance signatures additionally include velocity.', '- Timing is measured against each bar\'s authored/swing-warped fine grid, so it reports performance displacement rather than the notated swing itself.', '- The regression thresholds guard against grid collapse and flat dynamics; the rendered listening clips remain the musical acceptance reference.');

writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`);
writeFileSync(JSON_PATH, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`Drum baseline: ${rows.length} clips`);
console.log(`Report: ${REPORT_PATH}`);
console.log(`MIDI: ${OUT_DIR}`);
