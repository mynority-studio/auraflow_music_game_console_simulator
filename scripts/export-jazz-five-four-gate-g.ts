import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID } from '../src/core/generation/newEngine/arranger/jazzArchetypePlanner';
import { midi, pc, ticks } from '../src/core/generation/newEngine/foundation';
import {
  buildSongBundle,
  generateSongFromBundle,
} from '../src/core/generation/newEngine/generation/GenerationController';
import { auditJazzFiveFourLead } from '../src/core/generation/newEngine/generation/jazzFiveFourLeadAuditor';
import type {
  InstrumentRole,
  MusicalIR,
  NoteIR,
  TrackIR,
} from '../src/core/generation/newEngine/ir/MusicalIR';
import {
  assertJazzFiveFourGrooveMatch,
  JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM,
} from '../src/core/generation/newEngine/render/jazzFiveFourGrooveMatcher';
import { musicalIRToSMF } from '../src/core/generation/newEngine/sandbox/midiFile';

const SEED = 1662;
const PPQ = 480;
const BEATS_PER_BAR = 5;
const BAR_TICKS = PPQ * BEATS_PER_BAR;
const SOURCE_TEMPO_US_PER_QUARTER = 359_281;
const REQUESTED_AUDITION_BARS = 16;
const TARGET_DURATION_SECONDS = REQUESTED_AUDITION_BARS * BEATS_PER_BAR * 60
  / JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM;
const ENGINE_ROLES = new Set<InstrumentRole>(['bass', 'comp', 'lead', 'drum']);
const GATE_ROLES = new Set<InstrumentRole>(['bass', 'comp', 'drum']);

export const JAZZ_FIVE_FOUR_GATE_G_OUTPUT_DIR = resolve('tmp/jazz-five-four-gate-g');

export interface JazzFiveFourGateGArtifact {
  fileName: string;
  relativePath: string;
  byteLength: number;
  sha256: string;
  noteCount: number;
  roles: readonly InstrumentRole[];
  source: 'production-final-ir-filter' | 'script-click-helper';
}

export interface JazzFiveFourGateGExportManifest {
  outputDir: string;
  requestedAuditionBars: number;
  actualBars: number;
  tempoBpm: number;
  tempoUsPerQuarter: number;
  meter: '5/4';
  ppq: number;
  gatePass: true;
  artifacts: readonly JazzFiveFourGateGArtifact[];
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Jazz 5/4 Gate-G export failed: ${message}`);
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function containsSequence(haystack: Uint8Array, needle: readonly number[]): boolean {
  outer: for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

/** Small fail-closed SMF clock check, kept in the exporter rather than runtime. */
export function assertGateGMidiClock(bytes: Uint8Array): void {
  invariant(bytes.length >= 14, 'SMF is shorter than its header');
  invariant(String.fromCharCode(...bytes.slice(0, 4)) === 'MThd', 'SMF header is missing');
  invariant(bytes[8] === 0 && bytes[9] === 0, 'SMF must be format 0');
  invariant(((bytes[12] << 8) | bytes[13]) === PPQ, `SMF division must be ${PPQ}`);
  invariant(
    containsSequence(bytes, [
      0xff,
      0x51,
      0x03,
      (SOURCE_TEMPO_US_PER_QUARTER >> 16) & 0xff,
      (SOURCE_TEMPO_US_PER_QUARTER >> 8) & 0xff,
      SOURCE_TEMPO_US_PER_QUARTER & 0xff,
    ]),
    `SMF must contain exact ${SOURCE_TEMPO_US_PER_QUARTER} us/qn tempo meta`,
  );
  invariant(
    containsSequence(bytes, [0xff, 0x58, 0x04, 0x05, 0x02, 0x18, 0x08]),
    'SMF must contain a 5/4 time-signature meta event',
  );
}

function cloneTrackWithNotes(track: MusicalIR['tracks'][number]): TrackIR {
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

/** Filter only; it cannot invent, transpose, quantize or otherwise rewrite notes. */
function finalIrRoleFilter(finalIr: MusicalIR, allowedRoles: ReadonlySet<InstrumentRole>): MusicalIR {
  return {
    timebase: finalIr.timebase,
    durationTicks: finalIr.durationTicks,
    tracks: finalIr.tracks
      .filter((track) => allowedRoles.has(track.role))
      .map(cloneTrackWithNotes),
  };
}

function eventSignatures(ir: MusicalIR): string[] {
  return ir.tracks.flatMap((track) => track.notes.map((note) =>
    `${track.role}|${note.startTick}|${note.durationTicks}|${note.pitch}|${note.velocity}`,
  )).sort();
}

function assertIsExactFinalIrSubset(subset: MusicalIR, finalIr: MusicalIR, roles: ReadonlySet<InstrumentRole>): void {
  const expected = eventSignatures(finalIrRoleFilter(finalIr, roles));
  const actual = eventSignatures(subset);
  invariant(JSON.stringify(actual) === JSON.stringify(expected), 'audition stem is not an exact FinalIR subset');
  invariant(subset.tracks.every((track) => roles.has(track.role)), 'audition stem contains an unrequested role');
}

function clickIr(finalIr: MusicalIR, bars: number): MusicalIR {
  const notes: NoteIR[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    for (let beat = 0; beat < BEATS_PER_BAR; beat += 1) {
      const accented = beat === 0 || beat === 3;
      notes.push({
        // GM wood blocks on the drum channel keep the audit click separate
        // from the engine's kick/snare/ride vocabulary.
        pitch: midi(accented ? 76 : 77),
        startTick: ticks(bar * BAR_TICKS + beat * PPQ),
        durationTicks: ticks(24),
        velocity: accented ? 112 : 72,
      });
    }
  }
  return {
    timebase: finalIr.timebase,
    durationTicks: ticks(bars * BAR_TICKS),
    tracks: [{ role: 'drum', notes, program: 0 }],
  };
}

function noteCount(ir: MusicalIR): number {
  return ir.tracks.reduce((total, track) => total + track.notes.length, 0);
}

function rolesOf(ir: MusicalIR): InstrumentRole[] {
  return [...new Set(ir.tracks.map((track) => track.role))];
}

function artifactMarkdown(artifacts: readonly JazzFiveFourGateGArtifact[]): string {
  return artifacts.map((artifact) =>
    `| \`${artifact.fileName}\` | ${artifact.noteCount} | ${artifact.roles.join('+')} | \`${artifact.sha256}\` |`,
  ).join('\n');
}

/**
 * Generate the Gate-G listening pack from the production FinalIR.
 *
 * This module deliberately does not import the supplied MIDI, the Evidence
 * Oracle or an attachment path. Canonical score validation is delegated to the
 * production Gate-G matcher before a byte is written.
 */
export function exportJazzFiveFourGateG(
  outputDir = JAZZ_FIVE_FOUR_GATE_G_OUTPUT_DIR,
): JazzFiveFourGateGExportManifest {
  const bundle = buildSongBundle({
    seed: SEED,
    styleHint: 'jazz',
    mood: 'MIDI reference quartet Gate G',
    targetDuration: TARGET_DURATION_SECONDS,
    key: pc(4),
    mode: 'minor',
    jazzArchetypeId: JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
    bandConstraint: {
      allowedRoles: ENGINE_ROLES,
      requiredRoles: ENGINE_ROLES,
    },
  });
  const score = bundle.jazzFiveFourScorePlan;
  invariant(score, 'explicit reference quartet did not produce JazzFiveFourScorePlan');

  const generated = generateSongFromBundle(bundle);
  invariant(generated.status !== 'failed', `production generation status is failed (${generated.report.findings.map((f) => f.reason).join('; ')})`);
  invariant(generated.ir, 'production renderer did not return FinalIR');
  const finalIr = generated.ir;
  const gateReport = assertJazzFiveFourGrooveMatch(score, finalIr);
  invariant(gateReport.pass, 'Gate G matcher returned a non-passing report');
  const leadReport = auditJazzFiveFourLead({
    score,
    arrangement: bundle.arrangement,
    harmonic: bundle.harmonic,
  });
  invariant(leadReport.pass, `Gate L auditor failed (${leadReport.hardViolations.join('; ')})`);

  invariant(finalIr.timebase.ppq === PPQ, `FinalIR PPQ ${finalIr.timebase.ppq} != ${PPQ}`);
  invariant(finalIr.timebase.meter.numerator === 5 && finalIr.timebase.meter.denominator === 4, 'FinalIR meter is not 5/4');
  invariant(
    Math.abs(finalIr.timebase.tempoMap[0]!.bpm - JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM) < 1e-9,
    'FinalIR tempo differs from exact reference tempo',
  );

  const actualBars = bundle.arrangement.sections.reduce((sum, section) => sum + section.bars, 0);
  invariant(actualBars === 33, `complete 5/4 reference form must be 33 bars, got ${actualBars}`);
  invariant(Number(finalIr.durationTicks) === actualBars * BAR_TICKS, 'FinalIR duration does not end on the complete form boundary');

  const full = finalIrRoleFilter(finalIr, ENGINE_ROLES);
  const fullNoLead = finalIrRoleFilter(finalIr, GATE_ROLES);
  const bass = finalIrRoleFilter(finalIr, new Set<InstrumentRole>(['bass']));
  const comp = finalIrRoleFilter(finalIr, new Set<InstrumentRole>(['comp']));
  const lead = finalIrRoleFilter(finalIr, new Set<InstrumentRole>(['lead']));
  const drum = finalIrRoleFilter(finalIr, new Set<InstrumentRole>(['drum']));
  const click = clickIr(finalIr, actualBars);

  assertIsExactFinalIrSubset(full, finalIr, ENGINE_ROLES);
  assertIsExactFinalIrSubset(fullNoLead, finalIr, GATE_ROLES);
  assertIsExactFinalIrSubset(bass, finalIr, new Set<InstrumentRole>(['bass']));
  assertIsExactFinalIrSubset(comp, finalIr, new Set<InstrumentRole>(['comp']));
  assertIsExactFinalIrSubset(lead, finalIr, new Set<InstrumentRole>(['lead']));
  assertIsExactFinalIrSubset(drum, finalIr, new Set<InstrumentRole>(['drum']));
  invariant(full.tracks.some((track) => track.role === 'lead'), 'full ensemble is missing Lead');
  invariant(!fullNoLead.tracks.some((track) => track.role === 'lead'), 'full-no-lead contains Lead');
  invariant(click.tracks[0]?.notes.length === actualBars * BEATS_PER_BAR, 'click does not contain exactly five quarter notes per bar');
  for (let bar = 0; bar < actualBars; bar += 1) {
    const barNotes = click.tracks[0]!.notes.slice(bar * BEATS_PER_BAR, (bar + 1) * BEATS_PER_BAR);
    invariant(barNotes.length === 5, `click bar ${bar + 1} does not contain five notes`);
    invariant(barNotes[0]!.velocity === 112 && barNotes[3]!.velocity === 112, `click bar ${bar + 1} is missing beat 1/4 accents`);
    invariant(barNotes[1]!.velocity === 72 && barNotes[2]!.velocity === 72 && barNotes[4]!.velocity === 72, `click bar ${bar + 1} accents a non-1/4 beat`);
  }

  mkdirSync(outputDir, { recursive: true });
  const midiSources = [
    { fileName: 'full.mid', ir: full, source: 'production-final-ir-filter' as const },
    { fileName: 'full-no-lead.mid', ir: fullNoLead, source: 'production-final-ir-filter' as const },
    { fileName: 'bass.mid', ir: bass, source: 'production-final-ir-filter' as const },
    { fileName: 'comp.mid', ir: comp, source: 'production-final-ir-filter' as const },
    { fileName: 'lead.mid', ir: lead, source: 'production-final-ir-filter' as const },
    { fileName: 'drum.mid', ir: drum, source: 'production-final-ir-filter' as const },
    { fileName: 'click.mid', ir: click, source: 'script-click-helper' as const },
  ];
  const artifacts: JazzFiveFourGateGArtifact[] = midiSources.map(({ fileName, ir, source }) => {
    const bytes = musicalIRToSMF(ir, JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM, 'jazz');
    assertGateGMidiClock(bytes);
    const path = resolve(outputDir, fileName);
    writeFileSync(path, Buffer.from(bytes));
    return {
      fileName,
      relativePath: relative(process.cwd(), path),
      byteLength: bytes.length,
      sha256: sha256(bytes),
      noteCount: noteCount(ir),
      roles: rolesOf(ir),
      source,
    };
  });

  const report = {
    schemaVersion: 1,
    request: {
      seed: SEED,
      key: 'E',
      mode: 'minor',
      jazzArchetypeId: JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
      requestedAuditionBars: REQUESTED_AUDITION_BARS,
      targetDurationSeconds: TARGET_DURATION_SECONDS,
    },
    production: {
      generationStatus: generated.status,
      generationAttempts: generated.attempts,
      auditFindings: generated.report.findings,
      finalIrSource: 'GenerationController.generateSongFromBundle',
      stemPolicy: 'role-filter-only; notes are unchanged subsets of production FinalIR',
      sections: bundle.arrangement.sections.map((section) => ({ id: section.id, bars: section.bars })),
      actualBars,
    },
    clock: {
      ppq: PPQ,
      meter: { numerator: 5, denominator: 4 },
      grouping: [3, 2],
      tempoBpm: JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM,
      tempoUsPerQuarter: SOURCE_TEMPO_US_PER_QUARTER,
      ticksPerBar: BAR_TICKS,
    },
    gateG: gateReport,
    gateL: leadReport,
    artifacts,
    auxiliaryDisclaimer: 'click.mid is script-only listening assistance; it is not engine music and is excluded from Gate G.',
  };
  const reportPath = resolve(outputDir, 'gate-g-report.json');
  const reportJson = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(reportPath, reportJson);

  const readme = `# Jazz 5/4 · Gate G audition pack

This pack is generated with seed ${SEED}, E minor, the explicit \`${JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID}\` archetype and the production renderer.

- Clock: 5/4, 3+2 grouping, ${PPQ} PPQ, ${JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM} BPM (${SOURCE_TEMPO_US_PER_QUARTER} µs/qn exactly).
- Length: ${actualBars} bars. A 16-bar audition was requested; the Arranger preserves the indivisible reference form: 1-bar pickup + 8-bar head A + 8-bar head B + 8-bar head-out + 8-bar coda = 33 bars.
- \`full.mid\`, \`full-no-lead.mid\`, \`bass.mid\`, \`comp.mid\`, \`lead.mid\`, and \`drum.mid\` are role filters of the same production FinalIR. Their notes are not regenerated, quantized, transposed or humanized by this script.
- \`click.mid\` is script-only listening assistance: five quarter-note clicks per bar, with beats 1 and 4 accented. It is **not engine music** and is excluded from Gate G.
- \`gate-g-report.json\` contains the Gate G matcher, Gate L Lead audit, score/FinalIR identity delta, timing-link checks, drift checks and production audit metadata.

## Suggested listening

1. Play \`click.mid\` alongside \`drum.mid\` to audit the 3+2 bar grid.
2. Add \`bass.mid\`, then \`comp.mid\`, to hear role alignment without Lead masking timing.
3. Use \`lead.mid\` with the click/chordal stems to audit the Grammar/Brick line.
4. Use \`full.mid\` for the complete production-score audition.

## MIDI hashes

| File | Notes | Roles | SHA-256 |
| --- | ---: | --- | --- |
${artifactMarkdown(artifacts)}

Gate G: **PASS**. Gate L: **PASS**. Report SHA-256: \`${sha256(reportJson)}\`.
`;
  writeFileSync(resolve(outputDir, 'README.md'), readme);

  return {
    outputDir: relative(process.cwd(), outputDir),
    requestedAuditionBars: REQUESTED_AUDITION_BARS,
    actualBars,
    tempoBpm: JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM,
    tempoUsPerQuarter: SOURCE_TEMPO_US_PER_QUARTER,
    meter: '5/4',
    ppq: PPQ,
    gatePass: true,
    artifacts,
  };
}
