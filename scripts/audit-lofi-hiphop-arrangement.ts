import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pc } from '../src/core/generation/newEngine/foundation';
import {
  buildSongBundle,
  generateSongFromBundle,
  type SongBundle,
} from '../src/core/generation/newEngine/generation/GenerationController';
import {
  DRUM,
  lofiDrumPhrases,
  type DrumHit,
} from '../src/core/generation/newEngine/knowledge/grooves';
import {
  freezeMusicalIR,
  type MusicalIR,
  type TrackIR,
} from '../src/core/generation/newEngine/ir/MusicalIR';
import { musicalIRToSMF } from '../src/core/generation/newEngine/sandbox/midiFile';

const SEED_COUNT = 200;
const REVIEW_SEEDS = [0, 2, 7, 42, 99] as const;
const REPORT_PATH = resolve('docs/generated/lofi_hiphop_arrangement_audit.md');
const JSON_PATH = resolve('docs/generated/lofi_hiphop_arrangement_audit.json');
const REVIEW_DIR = resolve('tmp/lofi-hiphop-arrangement');
const SNARES = new Set<number>([DRUM.SIDESTICK, DRUM.SNARE, DRUM.CLAP, 40]);

interface AuditRow {
  seed: number;
  tempoBpm: number;
  grooveContractId: string;
  patternFamily: string;
  phraseId: string;
  phraseFamily: string;
  mainLoopBars: number;
  uniqueRhythmSignatureRatio: number;
  corePhraseCoverage: number;
  structuralMutationBarRatio: number;
  backbeatAnchorCoverage: number;
  harmonicPeriod: number;
  leadPlannedActiveBarCoverage: number;
  longestLeadSilenceBars: number;
}

function structuralSignature(hits: readonly DrumHit[]): string {
  return hits
    .map((hit) => `${hit.drum}@${hit.beat.toFixed(3)}`)
    .sort()
    .join('|');
}

function minimalPeriod(values: readonly string[]): number {
  if (values.length === 0) return 0;
  for (let period = 1; period <= values.length; period++) {
    if (values.every((value, index) => value === values[index % period])) return period;
  }
  return values.length;
}

function hasSnareAt(hits: readonly DrumHit[], beat: number): boolean {
  return hits.some((hit) => SNARES.has(hit.drum) && Math.abs(hit.beat - beat) < 1e-6);
}

function auditBundle(bundle: SongBundle, seed: number): AuditRow {
  const { arrangement, instrumentation, harmonic } = bundle;
  const loops = arrangement.sections.filter((section) => section.functionTag === 'loop');
  const scoreBars = loops.flatMap((section) => arrangement.grooveScorePlan.bySection[section.id].bars);
  const patterns = loops.flatMap((section) => instrumentation.drumPatternBySectionBar[section.id]);
  const phraseId = scoreBars[0]?.drumPhraseId ?? 'missing';
  const phrase = lofiDrumPhrases(arrangement.songGrooveContract.drum?.timekeeperFamily)
    .find((candidate) => candidate.id === phraseId);
  const loopAbsoluteBars = new Set(scoreBars.map((bar) => bar.absoluteBar));
  const mutationBars = new Set(scoreBars
    .filter((bar) => bar.structuralMutation)
    .map((bar) => bar.absoluteBar));
  for (const boundary of arrangement.grooveScorePlan.boundaries) {
    if (loopAbsoluteBars.has(boundary.sourceBar)) mutationBars.add(boundary.sourceBar);
  }
  const legalBackbeats = patterns.filter((pattern) => phrase?.backbeatMode === 'halftime-three'
    ? hasSnareAt(pattern, 2)
    : hasSnareAt(pattern, 1) && hasSnareAt(pattern, 3)).length;
  const firstLoop = loops[0];
  const identities = harmonic.chordTimeline
    .filter((span) => span.sectionId === firstLoop?.id)
    .map((span) => `${span.rootPc}:${span.chordType ?? span.quality}`);
  const presence = arrangement.lofiLeadPresencePlan!;
  const activeLeadBars = loops.reduce(
    (sum, section) => sum + (presence.activeBarsBySection[section.id]?.length ?? 0),
    0,
  );
  const longestLeadSilenceBars = presence.silenceWindows.reduce(
    (max, window) => Math.max(max, window.endBarInSection - window.startBarInSection),
    0,
  );

  return {
    seed,
    tempoBpm: arrangement.tempoBpm,
    grooveContractId: arrangement.songGrooveContractId,
    patternFamily: arrangement.drumPerformanceBySection[firstLoop?.id]?.patternFamily ?? 'missing',
    phraseId,
    phraseFamily: phrase?.family ?? 'missing',
    mainLoopBars: scoreBars.length,
    uniqueRhythmSignatureRatio: new Set(patterns.map(structuralSignature)).size / Math.max(1, patterns.length),
    corePhraseCoverage: 1 - mutationBars.size / Math.max(1, scoreBars.length),
    structuralMutationBarRatio: mutationBars.size / Math.max(1, scoreBars.length),
    backbeatAnchorCoverage: legalBackbeats / Math.max(1, patterns.length),
    harmonicPeriod: minimalPeriod(identities),
    leadPlannedActiveBarCoverage: activeLeadBars / Math.max(1, scoreBars.length),
    longestLeadSilenceBars,
  };
}

function cloneTrack(track: MusicalIR['tracks'][number]): TrackIR {
  return {
    ...track,
    notes: track.notes.map((note) => ({ ...note })),
    programChanges: track.programChanges?.map((event) => ({ ...event })),
    pedalEvents: track.pedalEvents?.map((event) => ({ ...event })),
    mix: track.mix ? { ...track.mix } : undefined,
    mixChanges: track.mixChanges?.map((event) => ({ ...event, mix: { ...event.mix } })),
    ccEvents: track.ccEvents?.map((event) => ({ ...event })),
    pitchBendEvents: track.pitchBendEvents?.map((event) => ({ ...event })),
  };
}

function stemIr(ir: MusicalIR, roles: readonly TrackIR['role'][]): MusicalIR {
  const include = new Set(roles);
  return freezeMusicalIR({
    timebase: ir.timebase,
    durationTicks: ir.durationTicks,
    tracks: ir.tracks.filter((track) => include.has(track.role)).map(cloneTrack),
  });
}

function reviewLog(bundle: SongBundle, ir: MusicalIR, row: AuditRow): Record<string, unknown> {
  const bpb = bundle.arrangement.meter.numerator * (4 / bundle.arrangement.meter.denominator);
  const loopBars = new Set(Object.values(bundle.arrangement.grooveScorePlan.bySection)
    .flatMap((section) => section.bars)
    .filter((bar) => bundle.arrangement.sections.find((candidate) => candidate.id === bar.sectionId)?.functionTag === 'loop')
    .map((bar) => bar.absoluteBar));
  const lead = ir.tracks.find((track) => track.role === 'lead');
  const audibleLeadBars = new Set((lead?.notes ?? [])
    .map((note) => Math.floor(((note.startTick as number) / bundle.timebase.ppq) / bpb))
    .filter((bar) => loopBars.has(bar)));
  const silenceWindows = bundle.arrangement.lofiLeadPresencePlan?.silenceWindows ?? [];
  const leadOnsetsInSilence = (lead?.notes ?? []).filter((note) => {
    const beat = (note.startTick as number) / bundle.timebase.ppq;
    return silenceWindows.some((window) =>
      beat > window.startBeat + 0.1 && beat < window.endBeat - 0.1);
  }).length;
  const drum = ir.tracks.find((track) => track.role === 'drum');
  const finalRhythmByBar = new Map<number, string[]>();
  for (const note of drum?.notes ?? []) {
    const absoluteBeat = (note.startTick as number) / bundle.timebase.ppq;
    const absoluteBar = Math.floor(absoluteBeat / bpb);
    if (!loopBars.has(absoluteBar)) continue;
    const beat = absoluteBeat - absoluteBar * bpb;
    const quantized = Math.round(beat * 4) / 4;
    const events = finalRhythmByBar.get(absoluteBar) ?? [];
    events.push(`${note.pitch}@${quantized.toFixed(2)}`);
    finalRhythmByBar.set(absoluteBar, events);
  }
  const finalSignatures = [...finalRhythmByBar.values()].map((events) => events.sort().join('|'));

  return {
    ...row,
    leadAudibleBarCoverage: audibleLeadBars.size / Math.max(1, loopBars.size),
    leadOnsetsInSilence,
    finalDrumUniqueRhythmSignatureRatio:
      new Set(finalSignatures).size / Math.max(1, finalSignatures.length),
    leadSilenceWindows: silenceWindows,
    activeLeadBarsBySection: bundle.arrangement.lofiLeadPresencePlan?.activeBarsBySection,
  };
}

mkdirSync(resolve('docs/generated'), { recursive: true });
mkdirSync(REVIEW_DIR, { recursive: true });

const bundles = Array.from({ length: SEED_COUNT }, (_, seed) => ({
  seed,
  bundle: buildSongBundle({
    seed,
    styleHint: 'lofi',
    mood: 'build',
    targetDuration: 120,
    key: pc(0),
  }),
}));
const rows = bundles.map(({ bundle, seed }) => auditBundle(bundle, seed));
const reviewLogs: Record<number, Record<string, unknown>> = {};

for (const seed of REVIEW_SEEDS) {
  const bundle = bundles[seed].bundle;
  const result = generateSongFromBundle(bundle);
  if (!result.ir || result.status === 'failed') {
    throw new Error(`LOFI review seed ${seed} failed: ${result.report.findings.map((finding) => finding.ruleId).join(',')}`);
  }
  const dir = resolve(REVIEW_DIR, `seed-${seed}`);
  mkdirSync(dir, { recursive: true });
  const stems = [
    ['drum.mid', ['drum']],
    ['drum+bass.mid', ['drum', 'bass']],
    ['drum+bass+comp.mid', ['drum', 'bass', 'comp']],
    ['full.mid', ['drum', 'bass', 'comp', 'pad', 'lead']],
  ] as const;
  for (const [name, roles] of stems) {
    const ir = stemIr(result.ir, roles);
    writeFileSync(resolve(dir, name), Buffer.from(musicalIRToSMF(ir, bundle.arrangement.tempoBpm, 'lofi')));
  }
  const log = reviewLog(bundle, result.ir, rows[seed]);
  reviewLogs[seed] = log;
  writeFileSync(resolve(dir, 'arrangement-log.json'), `${JSON.stringify(log, null, 2)}\n`);
}

const average = (pick: (row: AuditRow) => number): number =>
  rows.reduce((sum, row) => sum + pick(row), 0) / rows.length;
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const familyCounts = Object.fromEntries([...new Set(rows.map((row) => row.phraseFamily))]
  .map((family) => [family, rows.filter((row) => row.phraseFamily === family).length]));
const shortHarmonyRate = rows.filter((row) => row.harmonicPeriod >= 2 && row.harmonicPeriod <= 4).length / rows.length;
const hardGates = {
  tempo: rows.every((row) => row.tempoBpm >= 70 && row.tempoBpm <= 86),
  corePhraseCoverage: rows.every((row) => row.corePhraseCoverage >= 0.7),
  uniqueRhythmRatio: rows.every((row) => row.uniqueRhythmSignatureRatio <= 0.35),
  mutationBudget: rows.every((row) => row.structuralMutationBarRatio <= 0.25),
  backbeat: rows.every((row) => row.backbeatAnchorCoverage === 1),
  harmonicPeriod: rows.every((row) => row.harmonicPeriod <= 8) && shortHarmonyRate >= 0.7,
  leadPresence: rows.every((row) => row.leadPlannedActiveBarCoverage >= 0.25
    && row.leadPlannedActiveBarCoverage <= 0.45
    && row.longestLeadSilenceBars >= 4),
  reviewLeadRealization: Object.values(reviewLogs).every((log) =>
    log.leadOnsetsInSilence === 0
    && (log.leadAudibleBarCoverage as number) >= 0.25
    && (log.leadAudibleBarCoverage as number) <= 0.45),
  reviewFinalDrum: Object.values(reviewLogs).every((log) =>
    (log.finalDrumUniqueRhythmSignatureRatio as number) <= 0.35),
};

const lines = [
  '# LOFI Hip Hop Arrangement Audit',
  '',
  `Generated from ${SEED_COUNT} deterministic LOFI seeds. This report audits arrangement only; it does not score timbre, EQ, mix, noise, saturation or mastering.`,
  '',
  '## Hard gates',
  '',
  '| Gate | Result | Evidence |',
  '|---|---|---|',
  `| Tempo 70–86 BPM | ${hardGates.tempo ? 'PASS' : 'FAIL'} | ${Math.min(...rows.map((row) => row.tempoBpm))}–${Math.max(...rows.map((row) => row.tempoBpm))} BPM |`,
  `| Two-bar core phrase coverage ≥70% | ${hardGates.corePhraseCoverage ? 'PASS' : 'FAIL'} | average ${pct(average((row) => row.corePhraseCoverage))} |`,
  `| Unique one-bar signature ratio ≤35% | ${hardGates.uniqueRhythmRatio ? 'PASS' : 'FAIL'} | average ${pct(average((row) => row.uniqueRhythmSignatureRatio))} |`,
  `| Structural mutation bars ≤25% | ${hardGates.mutationBudget ? 'PASS' : 'FAIL'} | average ${pct(average((row) => row.structuralMutationBarRatio))} |`,
  `| Boom-bap / half-time backbeat anchors | ${hardGates.backbeat ? 'PASS' : 'FAIL'} | average ${pct(average((row) => row.backbeatAnchorCoverage))} |`,
  `| 2–4 chord short-loop rate ≥70%; all periods ≤8 | ${hardGates.harmonicPeriod ? 'PASS' : 'FAIL'} | short-loop ${pct(shortHarmonyRate)}, max period ${Math.max(...rows.map((row) => row.harmonicPeriod))} |`,
  `| Lead plan 25–45% active + ≥4-bar rest | ${hardGates.leadPresence ? 'PASS' : 'FAIL'} | average ${pct(average((row) => row.leadPlannedActiveBarCoverage))} |`,
  `| Review Lead audible bars 25–45% and no rest-window onset | ${hardGates.reviewLeadRealization ? 'PASS' : 'FAIL'} | seeds ${REVIEW_SEEDS.join(', ')} |`,
  `| Review FinalIR drum unique ratio ≤35% | ${hardGates.reviewFinalDrum ? 'PASS' : 'FAIL'} | seeds ${REVIEW_SEEDS.join(', ')} |`,
  '',
  '## Vocabulary coverage',
  '',
  `- Phrase identities used: ${new Set(rows.map((row) => row.phraseId)).size}.`,
  `- Family counts: ${Object.entries(familyCounts).map(([family, count]) => `${family}=${count}`).join(', ')}.`,
  '- Review MIDI: `tmp/lofi-hiphop-arrangement/seed-{0,2,7,42,99}/`.',
  '',
  '## Fixed review seeds',
  '',
  '| Seed | Contract | Phrase | Planned Lead | Audible Lead | Lead-onsets-in-rest | Final drum unique ratio |',
  '|---:|---|---|---:|---:|---:|---:|',
  ...REVIEW_SEEDS.map((seed) => {
    const row = reviewLogs[seed];
    return `| ${seed} | ${row.grooveContractId} | ${row.phraseId} | ${pct(row.leadPlannedActiveBarCoverage as number)} | ${pct(row.leadAudibleBarCoverage as number)} | ${row.leadOnsetsInSilence} | ${pct(row.finalDrumUniqueRhythmSignatureRatio as number)} |`;
  }),
  '',
  '## Interpretation',
  '',
  '- Within one song, the Arranger reuses a selected two-bar phrase; variety is primarily across seeds.',
  '- Bars marked as structural mutations are restricted to scored 4/8-bar cadence positions.',
  '- Dilla timing and velocity remain Performance concerns and are deliberately excluded from structural signatures.',
  '- Lead rests are admitted before NoteIR realization; the final density gate does not manufacture them.',
  '',
];

writeFileSync(REPORT_PATH, lines.join('\n'));
writeFileSync(JSON_PATH, `${JSON.stringify({ hardGates, familyCounts, rows, reviewLogs }, null, 2)}\n`);

if (Object.values(hardGates).some((passed) => !passed)) {
  throw new Error(`LOFI Hip Hop arrangement hard gate failed: ${JSON.stringify(hardGates)}`);
}

console.log(`LOFI Hip Hop arrangement audit: ${SEED_COUNT} seeds`);
console.log(`Report: ${REPORT_PATH}`);
console.log(`Review MIDI: ${REVIEW_DIR}`);
