import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { JAZZ_5_4_ARCHETYPE_ID } from '../src/core/generation/newEngine/arranger/jazzArchetypePlanner';
import { validateJazzFiveFourScorePlan } from '../src/core/generation/newEngine/arranger/jazzFiveFourScorePlan';
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
import { assertGateGMidiClock } from './export-jazz-five-four-gate-g';

export const JAZZ_FIVE_FOUR_GENERATIVE_SEED = 1662 as const;
export const JAZZ_FIVE_FOUR_GENERATIVE_OUTPUT_DIR = resolve(
  `tmp/jazz-five-four-generative/seed-${JAZZ_FIVE_FOUR_GENERATIVE_SEED}`,
);

const PPQ = 480;
const BEATS_PER_BAR = 5;
const BAR_TICKS = PPQ * BEATS_PER_BAR;
const ENGINE_ROLES = new Set<InstrumentRole>(['bass', 'comp', 'lead', 'drum']);

export interface JazzFiveFourGenerativeArtifact {
  readonly fileName: string;
  readonly relativePath: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly noteCount: number;
  readonly roles: readonly InstrumentRole[];
  readonly source: 'production-final-ir-filter' | 'script-click-helper';
}

export interface JazzFiveFourGenerativeExportManifest {
  readonly outputDir: string;
  readonly seed: number;
  readonly actualBars: number;
  readonly scoreEventCount: number;
  readonly tempoBpm: number;
  readonly meter: '5/4';
  readonly ppq: 480;
  readonly groovePass: true;
  readonly leadPass: true;
  readonly artifacts: readonly JazzFiveFourGenerativeArtifact[];
  readonly scoreLogRelativePath: string;
  readonly reportRelativePath: string;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Jazz 5/4 generative export failed: ${message}`);
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
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

/** Exact role filter: stems never regenerate, quantize, transpose or humanize. */
function roleFilter(finalIr: MusicalIR, roles: ReadonlySet<InstrumentRole>): MusicalIR {
  return {
    timebase: finalIr.timebase,
    durationTicks: finalIr.durationTicks,
    tracks: finalIr.tracks
      .filter((track) => roles.has(track.role))
      .map(cloneTrackWithNotes),
  };
}

function eventSignatures(ir: MusicalIR): string[] {
  return ir.tracks.flatMap((track) => track.notes.map((note) =>
    `${track.role}|${note.startTick}|${note.durationTicks}|${note.pitch}|${note.velocity}|${track.program}`,
  )).sort();
}

function assertExactSubset(
  subset: MusicalIR,
  finalIr: MusicalIR,
  roles: ReadonlySet<InstrumentRole>,
): void {
  invariant(
    JSON.stringify(eventSignatures(subset))
      === JSON.stringify(eventSignatures(roleFilter(finalIr, roles))),
    `stem ${[...roles].join('+')} is not an exact FinalIR subset`,
  );
}

function clickIr(finalIr: MusicalIR, bars: number): MusicalIR {
  const notes: NoteIR[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    for (let beat = 0; beat < BEATS_PER_BAR; beat += 1) {
      const groupAccent = beat === 0 || beat === 3;
      notes.push({
        pitch: midi(groupAccent ? 76 : 77),
        startTick: ticks(bar * BAR_TICKS + beat * PPQ),
        durationTicks: ticks(24),
        velocity: groupAccent ? 112 : 72,
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
  return ir.tracks.reduce((sum, track) => sum + track.notes.length, 0);
}

function pitchName(pitch: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

function artifactTable(artifacts: readonly JazzFiveFourGenerativeArtifact[]): string {
  return artifacts.map((artifact) =>
    `| \`${artifact.fileName}\` | ${artifact.noteCount} | ${artifact.roles.join('+')} | \`${artifact.sha256}\` |`,
  ).join('\n');
}

/**
 * Export one deterministic product seed through the real production path.
 * The source MIDI/evidence oracle is never imported by this exporter.
 */
export function exportJazzFiveFourGenerative(
  outputDir = JAZZ_FIVE_FOUR_GENERATIVE_OUTPUT_DIR,
): JazzFiveFourGenerativeExportManifest {
  const bundle = buildSongBundle({
    seed: JAZZ_FIVE_FOUR_GENERATIVE_SEED,
    styleHint: 'jazz',
    mood: 'modern cool 5/4 generative production',
    targetDuration: 60,
    key: pc(4),
    mode: 'minor',
    jazzArchetypeId: JAZZ_5_4_ARCHETYPE_ID,
  });
  const score = bundle.jazzFiveFourScorePlan;
  invariant(score, 'product archetype did not produce JazzFiveFourScorePlan');
  invariant(score.compilationMode === 'generative', 'score is not in generative compilation mode');
  const scoreIssues = validateJazzFiveFourScorePlan(score);
  invariant(scoreIssues.length === 0, `invalid score (${scoreIssues.map((entry) => entry.message).join('; ')})`);

  const generated = generateSongFromBundle(bundle);
  invariant(generated.ir, `production FinalIR failed (${generated.report.findings.map((entry) => entry.reason).join('; ')})`);
  const finalIr = generated.ir;
  const grooveReport = assertJazzFiveFourGrooveMatch(score, finalIr);
  invariant(grooveReport.pass, `Gate G failed (${grooveReport.issues.join('; ')})`);
  const leadReport = auditJazzFiveFourLead({
    score,
    arrangement: bundle.arrangement,
    harmonic: bundle.harmonic,
  });
  invariant(leadReport.pass, `Gate L failed (${leadReport.hardViolations.join('; ')})`);

  const actualBars = bundle.arrangement.sections.reduce((sum, section) => sum + section.bars, 0);
  invariant(actualBars === 33, `product form must be 33 whole bars, received ${actualBars}`);
  invariant(Number(finalIr.durationTicks) === actualBars * BAR_TICKS, 'FinalIR duration misses the form boundary');
  invariant(finalIr.timebase.ppq === PPQ, 'FinalIR is not PPQ480');
  invariant(
    finalIr.timebase.meter.numerator === 5 && finalIr.timebase.meter.denominator === 4,
    'FinalIR is not 5/4',
  );

  const midiSources = [
    { fileName: 'full.mid', ir: roleFilter(finalIr, ENGINE_ROLES), roles: ENGINE_ROLES, source: 'production-final-ir-filter' as const },
    { fileName: 'full-no-lead.mid', ir: roleFilter(finalIr, new Set<InstrumentRole>(['bass', 'comp', 'drum'])), roles: new Set<InstrumentRole>(['bass', 'comp', 'drum']), source: 'production-final-ir-filter' as const },
    { fileName: 'bass.mid', ir: roleFilter(finalIr, new Set<InstrumentRole>(['bass'])), roles: new Set<InstrumentRole>(['bass']), source: 'production-final-ir-filter' as const },
    { fileName: 'comp.mid', ir: roleFilter(finalIr, new Set<InstrumentRole>(['comp'])), roles: new Set<InstrumentRole>(['comp']), source: 'production-final-ir-filter' as const },
    { fileName: 'lead.mid', ir: roleFilter(finalIr, new Set<InstrumentRole>(['lead'])), roles: new Set<InstrumentRole>(['lead']), source: 'production-final-ir-filter' as const },
    { fileName: 'drum.mid', ir: roleFilter(finalIr, new Set<InstrumentRole>(['drum'])), roles: new Set<InstrumentRole>(['drum']), source: 'production-final-ir-filter' as const },
    { fileName: 'click.mid', ir: clickIr(finalIr, actualBars), roles: new Set<InstrumentRole>(['drum']), source: 'script-click-helper' as const },
  ];

  mkdirSync(outputDir, { recursive: true });
  const artifacts: JazzFiveFourGenerativeArtifact[] = midiSources.map((source) => {
    if (source.source === 'production-final-ir-filter') {
      assertExactSubset(source.ir, finalIr, source.roles);
    }
    const bytes = musicalIRToSMF(source.ir, JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM, 'jazz');
    assertGateGMidiClock(bytes);
    const filePath = resolve(outputDir, source.fileName);
    writeFileSync(filePath, Buffer.from(bytes));
    return {
      fileName: source.fileName,
      relativePath: relative(process.cwd(), filePath),
      byteLength: bytes.length,
      sha256: sha256(bytes),
      noteCount: noteCount(source.ir),
      roles: [...new Set(source.ir.tracks.map((track) => track.role))],
      source: source.source,
    };
  });

  const semanticById = new Map(score.semanticEvents.map((event) => [event.eventId, event] as const));
  const performedById = new Map(score.performance.events.map((event) => [event.eventId, event] as const));
  const orderedEvents = [...score.instrumentEvents]
    .sort((left, right) => left.nominalTick - right.nominalTick
      || left.role.localeCompare(right.role)
      || left.pitch - right.pitch
      || left.eventId.localeCompare(right.eventId));
  const scoreLog = {
    schemaVersion: 1,
    seed: JAZZ_FIVE_FOUR_GENERATIVE_SEED,
    archetypeId: JAZZ_5_4_ARCHETYPE_ID,
    clock: score.clock,
    compilationMode: score.compilationMode,
    performanceMode: score.performance.mode,
    sections: bundle.arrangement.sections,
    harmony: bundle.harmonic.chordTimeline.map((span) => ({
      ...span,
      startBeat: Number(span.startBeat),
      durationBeats: Number(span.durationBeats),
      rootPc: Number(span.rootPc),
      bassPc: span.bassPc === undefined ? undefined : Number(span.bassPc),
      bassPedalPc: span.bassPedalPc === undefined ? undefined : Number(span.bassPedalPc),
    })),
    arranger: {
      ensemble: bundle.arrangement.jazzFiveFourEnsembleScore,
      leadDirectives: bundle.arrangement.jazzFiveFourLeadDirectives,
      harmonyDirectives: bundle.arrangement.jazzFiveFourHarmonyDirectives,
    },
    timingLinks: score.timingLinks,
    roleCounts: Object.fromEntries([...ENGINE_ROLES].map((role) => [
      role,
      orderedEvents.filter((event) => event.role === role).length,
    ])),
    events: orderedEvents.map((event, index) => {
      const semantic = semanticById.get(event.semanticEventId);
      const performed = performedById.get(event.eventId);
      invariant(semantic, `event ${event.eventId} has no semantic score event`);
      invariant(performed, `event ${event.eventId} has no performed score event`);
      return {
        index,
        eventId: event.eventId,
        role: event.role,
        sectionId: event.sectionId,
        absoluteBar: event.absoluteBar,
        barNumber: event.absoluteBar + 1,
        barInSection: event.barInSection,
        barInSectionNumber: event.barInSection + 1,
        nominalTick: event.nominalTick,
        performedTick: performed.tick,
        performanceResidualTicks: performed.tick - event.nominalTick,
        phaseTick: event.phaseTick,
        beatInBar: event.phaseTick / PPQ + 1,
        absoluteBeat: event.nominalTick / PPQ,
        durationTicks: event.durationTicks,
        durationBeats: event.durationTicks / PPQ,
        pitch: event.pitch,
        pitchName: event.role === 'drum' ? `GM-drum-${event.pitch}` : pitchName(event.pitch),
        velocity: event.velocity,
        program: event.program,
        bank: event.bank,
        timingLinkId: event.timingLinkId,
        pitchIntent: semantic.pitchIntent,
        provenance: score.provenanceByEventId[event.eventId],
      };
    }),
  };
  const scoreLogJson = `${JSON.stringify(scoreLog, null, 2)}\n`;
  const scoreLogPath = resolve(outputDir, 'score-log.json');
  writeFileSync(scoreLogPath, scoreLogJson);

  const report = {
    schemaVersion: 1,
    seed: JAZZ_FIVE_FOUR_GENERATIVE_SEED,
    archetypeId: JAZZ_5_4_ARCHETYPE_ID,
    production: {
      status: generated.status,
      attempts: generated.attempts,
      findings: generated.report.findings,
      finalIrSource: 'GenerationController.generateSongFromBundle',
      rendererPolicy: 'pure ScorePlan performance-event projection',
    },
    clock: {
      ppq: PPQ,
      meter: [5, 4],
      grouping: [3, 2],
      ticksPerBar: BAR_TICKS,
      tempoBpm: JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM,
    },
    form: bundle.arrangement.sections,
    scoreEventCount: score.instrumentEvents.length,
    scoreValidationIssues: scoreIssues,
    gateG: grooveReport,
    gateL: leadReport,
    scoreLog: {
      fileName: 'score-log.json',
      sha256: sha256(scoreLogJson),
      eventCount: scoreLog.events.length,
    },
    artifacts,
    clickDisclaimer: 'click.mid is listening assistance, not engine music.',
  };
  const reportJson = `${JSON.stringify(report, null, 2)}\n`;
  const reportPath = resolve(outputDir, 'report.json');
  writeFileSync(reportPath, reportJson);

  const readme = `# Jazz 5/4 generative production · seed ${JAZZ_FIVE_FOUR_GENERATIVE_SEED}

This pack is generated by the product \`${JAZZ_5_4_ARCHETYPE_ID}\` path: Arranger total score → Harmony-aware ScoreCompiler → pure FinalIR projection.

- Clock: 5/4, 3+2, PPQ480, ${JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM} BPM.
- Form: pickup 1 + head A 8 + head B 8 + head-out 8 + coda 8 = ${actualBars} bars.
- Opening: Bass + Lead + Drum. From bar 10: Comp + Lead + Drum; Bass is silent.
- \`score-log.json\` lists all ${score.instrumentEvents.length} notes/hits with nominal and performed ticks, bar/beat, pitch, Harmony intent and complete provenance.
- All musical MIDI files are exact role filters of one production FinalIR. \`click.mid\` is the only script-generated helper.
- \`full.wav\` may be produced locally from \`full.mid\`; it is a listening render, not an additional music-generation path and is excluded from the machine gates.

## Files

| File | Notes | Roles | SHA-256 |
| --- | ---: | --- | --- |
${artifactTable(artifacts)}

Gate G: **PASS**. Gate L: **PASS**. Score validation: **PASS**.
`;
  writeFileSync(resolve(outputDir, 'README.md'), readme);

  return {
    outputDir: relative(process.cwd(), outputDir),
    seed: JAZZ_FIVE_FOUR_GENERATIVE_SEED,
    actualBars,
    scoreEventCount: score.instrumentEvents.length,
    tempoBpm: JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM,
    meter: '5/4',
    ppq: PPQ,
    groovePass: true,
    leadPass: true,
    artifacts,
    scoreLogRelativePath: relative(process.cwd(), scoreLogPath),
    reportRelativePath: relative(process.cwd(), reportPath),
  };
}
