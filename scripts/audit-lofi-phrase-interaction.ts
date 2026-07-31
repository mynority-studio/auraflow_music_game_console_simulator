import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pc } from '../src/core/generation/newEngine/foundation';
import { buildSongBundle } from '../src/core/generation/newEngine/generation/GenerationController';
import { listProgressionPrototypes } from '../src/core/generation/newEngine/knowledge/progressions';
import {
  auditLofiGrammarLocalHarmony,
  auditLofiTextureRolesLocalHarmony,
  type LofiLocalHarmonyFinding,
} from '../src/core/generation/newEngine/render/lofiLocalHarmonyAudit';
import {
  renderSongFull,
} from '../src/core/generation/newEngine/render/renderCoordinator';
import type { MgLeadDebugCapture } from '../src/core/generation/newEngine/render/mgLeadRenderer';
import type {
  LofiPhraseBarInteraction,
} from '../src/core/generation/newEngine/arranger/ArrangementPlan';
import type { MgNoteEvent } from '../src/core/generation/newEngine/render/mgMelodyRealizer';
import type { NoteIR } from '../src/core/generation/newEngine/ir/MusicalIR';

const SEED_COUNT = Number(process.env.LOFI_PHRASE_AUDIT_SEEDS ?? 200);
const OUTPUT_DIR = resolve('docs/generated');
const JSON_PATH = resolve(OUTPUT_DIR, 'lofi_phrase_interaction_local_harmony_audit.json');
const MARKDOWN_PATH = resolve(OUTPUT_DIR, 'lofi_phrase_interaction_local_harmony_audit.md');

const CLARK_DERIVED_IDS = [
  'lofi_major_plagal_descent_2',
  'lofi_major_whole_step_planing_4',
  'lofi_major_parallel_minor_fall_4',
  'lofi_minor_turnaround_4',
  'lofi_minor_aeolian_ebb_8',
  'lofi_minor_late_cadence_4',
  'lofi_minor_third_bass_vamp_4',
] as const;

interface AuditRow {
  seed: number;
  mode: 'major' | 'minor';
  harmonyPoolId: string;
  sourcePrototypeIds: string[];
  grammarEvents: number;
  grammarOnsetConformanceRate: number;
  grammarStructuralConformanceRate: number;
  grammarFillConformanceRate: number;
  grammarApproaches: number;
  grammarResolvedApproaches: number;
  grammarLocalFallbackApproaches: number;
  grammarLongCrossChordExposures: number;
  compNotes: number;
  compConformingAttacks: number;
  compLongCrossChordExposures: number;
  padNotes: number;
  padConformingAttacks: number;
  padLongCrossChordExposures: number;
  findingCount: number;
  statementVariationReturnSentences: number;
  returnRhythmMatches: number;
  variationRhythmMatches: number;
  terminalResolutions: number;
  compSupportOnsets: number;
  compRestOnsets: number;
  answerBars: number;
  leadNotesInAnswerBars: number;
}

interface Totals {
  grammarEvents: number;
  grammarConformingOnsets: number;
  grammarStructuralEvents: number;
  grammarStructuralConforming: number;
  grammarFillEvents: number;
  grammarFillConforming: number;
  grammarApproaches: number;
  grammarResolvedApproaches: number;
  grammarLocalFallbackApproaches: number;
  grammarLongCrossChordExposures: number;
  compNotes: number;
  compConformingAttacks: number;
  compLongCrossChordExposures: number;
  padNotes: number;
  padConformingAttacks: number;
  padLongCrossChordExposures: number;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 1;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function eventsInCue(
  events: readonly MgNoteEvent[],
  cue: Readonly<LofiPhraseBarInteraction>,
  beatsPerBar: number,
): MgNoteEvent[] {
  const start = cue.absoluteBar * beatsPerBar;
  const end = start + beatsPerBar;
  return events
    .filter((event) => event.part === 'melody'
      && event.time >= start - 1e-6
      && event.time < end - 1e-6)
    .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
}

function notesInCue(
  notes: readonly NoteIR[],
  cue: Readonly<LofiPhraseBarInteraction>,
  beatsPerBar: number,
  ppq: number,
): NoteIR[] {
  const start = cue.absoluteBar * beatsPerBar;
  const end = start + beatsPerBar;
  return notes.filter((note) => {
    const beat = (note.startTick as number) / ppq;
    return beat >= start - 0.08 && beat < end - 0.08;
  });
}

function onsetCount(notes: readonly NoteIR[]): number {
  return new Set(notes.map((note) => note.startTick as number)).size;
}

function rhythmMatches(
  source: readonly MgNoteEvent[],
  target: readonly MgNoteEvent[],
  sourceBar: number,
  targetBar: number,
  beatsPerBar: number,
  variation: boolean,
): boolean {
  if (source.length < 3 || target.length !== source.length) return false;
  const sourcePhase = source.map((event) => event.time - sourceBar * beatsPerBar);
  const targetPhase = target.map((event) => event.time - targetBar * beatsPerBar);
  return sourcePhase.every((phase, index) => {
    const difference = Math.abs((targetPhase[index] ?? Number.POSITIVE_INFINITY) - phase);
    return variation && index === sourcePhase.length - 1 ? difference <= 0.27 : difference <= 0.04;
  });
}

const rows: AuditRow[] = [];
const findings: Array<LofiLocalHarmonyFinding & { seed: number }> = [];
const totals: Totals = {
  grammarEvents: 0,
  grammarConformingOnsets: 0,
  grammarStructuralEvents: 0,
  grammarStructuralConforming: 0,
  grammarFillEvents: 0,
  grammarFillConforming: 0,
  grammarApproaches: 0,
  grammarResolvedApproaches: 0,
  grammarLocalFallbackApproaches: 0,
  grammarLongCrossChordExposures: 0,
  compNotes: 0,
  compConformingAttacks: 0,
  compLongCrossChordExposures: 0,
  padNotes: 0,
  padConformingAttacks: 0,
  padLongCrossChordExposures: 0,
};
const phraseTotals = {
  sentences: 0,
  returnRhythmMatches: 0,
  variationRhythmMatches: 0,
  terminalResolutions: 0,
  dynamicArcSentences: 0,
  compSupportOnsets: 0,
  compSupportBars: 0,
  compRestOnsets: 0,
  compRestBars: 0,
  answerBars: 0,
  answerBarsWithComp: 0,
  leadNotesInAnswerBars: 0,
  tracedTurnarounds: 0,
  turnaroundBars: 0,
  kickOffsetsMs: [] as number[],
  snareOffsetsMs: [] as number[],
  systemicPocketPlans: 0,
};

for (let seed = 0; seed < SEED_COUNT; seed++) {
  const mode = seed % 2 === 0 ? 'major' : 'minor';
  const bundle = buildSongBundle({
    seed,
    styleHint: 'lofi',
    mood: 'build',
    targetDuration: 120,
    key: pc(0),
    mode,
  });
  const capture: MgLeadDebugCapture = {};
  const rendered = renderSongFull(
    bundle.band,
    bundle.arrangement,
    bundle.harmonic,
    bundle.instrumentation,
    bundle.timebase,
    bundle.seedRng,
    undefined,
    undefined,
    undefined,
    undefined,
    bundle.acgPianoScorePlan,
    bundle.jazzFiveFourScorePlan,
    capture,
  );
  const grammar = auditLofiGrammarLocalHarmony(capture.grammarEvents ?? [], bundle.harmonic);
  const [comp, pad] = auditLofiTextureRolesLocalHarmony(
    rendered.ir,
    bundle.harmonic,
    bundle.timebase,
  );
  const sourcePrototypeIds = [...new Set(bundle.harmonic.chordTimeline
    .map((span) => span.sourcePrototypeId)
    .filter((id): id is string => !!id))].sort();
  const foundation = bundle.arrangement.lofiFoundationPlan;
  if (!foundation) throw new Error(`LOFI seed ${seed} has no FoundationPlan`);
  const interaction = bundle.arrangement.lofiPhraseInteractionPlan;
  if (!interaction) throw new Error(`LOFI seed ${seed} has no PhraseInteractionPlan`);
  const beatsPerBar = bundle.arrangement.meter.numerator
    * (4 / bundle.arrangement.meter.denominator);
  const loopSectionIds = new Set(bundle.arrangement.sections
    .filter((section) => section.functionTag === 'loop')
    .map((section) => section.id));
  const cues = interaction.bars.filter((cue) => loopSectionIds.has(cue.sectionId));
  const grammarEvents = capture.grammarEvents ?? [];
  const leadNotes = rendered.ir.tracks.find((track) => track.role === 'lead')?.notes ?? [];
  const compNotes = rendered.ir.tracks.find((track) => track.role === 'comp')?.notes ?? [];
  const drumNotes = rendered.ir.tracks.find((track) => track.role === 'drum')?.notes ?? [];
  let rowSentences = 0;
  let rowReturnRhythmMatches = 0;
  let rowVariationRhythmMatches = 0;
  let rowTerminalResolutions = 0;
  let rowCompSupportOnsets = 0;
  let rowCompRestOnsets = 0;
  let rowAnswerBars = 0;
  let rowLeadNotesInAnswerBars = 0;

  if (interaction.pocket.kickAnchorMs === 0
      && interaction.pocket.snareDragMs > 0
      && interaction.pocket.hatOffbeatMs > interaction.pocket.hatOnbeatMs) {
    phraseTotals.systemicPocketPlans += 1;
  }

  for (const cue of cues) {
    const cueCompNotes = notesInCue(compNotes, cue, beatsPerBar, bundle.timebase.ppq);
    const cueOnsets = onsetCount(cueCompNotes);
    if (cue.compRole === 'support') {
      phraseTotals.compSupportOnsets += cueOnsets;
      phraseTotals.compSupportBars += 1;
      rowCompSupportOnsets += cueOnsets;
    } else {
      phraseTotals.compRestOnsets += cueOnsets;
      phraseTotals.compRestBars += 1;
      rowCompRestOnsets += cueOnsets;
    }
    if (cue.compRole === 'answer') {
      const cueStart = cue.absoluteBar * beatsPerBar;
      const cueEnd = cueStart + beatsPerBar;
      const cueLeadNotes = leadNotes.filter((note) => {
        const beat = (note.startTick as number) / bundle.timebase.ppq;
        // Ignore only a sub-0.1-beat boundary pocket belonging to the
        // neighboring authored phrase. The interior of an answer bar is the
        // actual Lead-rest contract.
        return beat > cueStart + 0.1 && beat < cueEnd - 0.1;
      });
      phraseTotals.answerBars += 1;
      rowAnswerBars += 1;
      if (cueOnsets > 0) phraseTotals.answerBarsWithComp += 1;
      phraseTotals.leadNotesInAnswerBars += cueLeadNotes.length;
      rowLeadNotesInAnswerBars += cueLeadNotes.length;
    }
  }

  for (const statement of cues.filter((cue) => cue.leadRole === 'statement' && cue.motifId)) {
    const variation = cues.find((cue) =>
      cue.absoluteBar === statement.absoluteBar + 1
      && cue.motifId === statement.motifId
      && cue.leadRole === 'variation');
    const returned = cues.find((cue) =>
      cue.absoluteBar === statement.absoluteBar + 3
      && cue.motifId === statement.motifId
      && cue.leadRole === 'return');
    if (!variation || !returned) continue;
    const source = eventsInCue(grammarEvents, statement, beatsPerBar).slice(0, 5);
    const varied = eventsInCue(grammarEvents, variation, beatsPerBar);
    const returnedEvents = eventsInCue(grammarEvents, returned, beatsPerBar);
    if (source.length < 3 || varied.length !== source.length || returnedEvents.length !== source.length) continue;
    rowSentences += 1;
    phraseTotals.sentences += 1;
    if (rhythmMatches(source, varied, statement.absoluteBar, variation.absoluteBar, beatsPerBar, true)) {
      rowVariationRhythmMatches += 1;
      phraseTotals.variationRhythmMatches += 1;
    }
    if (rhythmMatches(source, returnedEvents, statement.absoluteBar, returned.absoluteBar, beatsPerBar, false)) {
      rowReturnRhythmMatches += 1;
      phraseTotals.returnRhythmMatches += 1;
    }
    if (mean(varied.map((event) => event.velocity)) > mean(returnedEvents.map((event) => event.velocity))) {
      phraseTotals.dynamicArcSentences += 1;
    }
    const terminal = returnedEvents[returnedEvents.length - 1]!;
    const terminalSpan = bundle.harmonic.chordTimeline.find((span) =>
      terminal.time >= (span.startBeat as number) - 1e-6
      && terminal.time < (span.startBeat as number) + (span.durationBeats as number) - 1e-6);
    const terminalPc = ((terminal.noteNumber % 12) + 12) % 12;
    const stable = new Set([
      ...(terminalSpan ? bundle.harmonic.stableToneMap[terminalSpan.id] ?? [] : []),
      ...(terminalSpan ? bundle.harmonic.colorToneMap[terminalSpan.id] ?? [] : []),
    ].map(Number));
    if (terminalSpan && stable.has(terminalPc)) {
      rowTerminalResolutions += 1;
      phraseTotals.terminalResolutions += 1;
    }
  }

  const scoreBars = Object.values(bundle.arrangement.grooveScorePlan.bySection)
    .flatMap((sectionScore) => sectionScore.bars)
    .filter((bar) => loopSectionIds.has(bar.sectionId));
  const kickPitches = new Set([35, 36]);
  const snarePitches = new Set([37, 38, 39, 40]);
  for (const bar of scoreBars) {
    const barStart = bar.absoluteBar * beatsPerBar;
    const inBar = drumNotes.map((note) => ({
      note,
      beat: (note.startTick as number) / bundle.timebase.ppq - barStart,
    })).filter(({ beat }) => beat >= -0.08 && beat < beatsPerBar - 0.02);
    for (const target of bar.drumInteraction?.structuralKickBeats ?? []) {
      const nearest = inBar
        .filter(({ note }) => kickPitches.has(note.pitch as number))
        .sort((a, b) => Math.abs(a.beat - target) - Math.abs(b.beat - target))[0];
      if (nearest && Math.abs(nearest.beat - target) <= 0.18) {
        phraseTotals.kickOffsetsMs.push((nearest.beat - target) * 60_000 / bundle.arrangement.tempoBpm);
      }
    }
    for (const target of bar.drumInteraction?.structuralSnareBeats ?? []) {
      const nearest = inBar
        .filter(({ note }) => snarePitches.has(note.pitch as number))
        .sort((a, b) => Math.abs(a.beat - target) - Math.abs(b.beat - target))[0];
      if (nearest && Math.abs(nearest.beat - target) <= 0.18) {
        phraseTotals.snareOffsetsMs.push((nearest.beat - target) * 60_000 / bundle.arrangement.tempoBpm);
      }
    }
    if (bar.drumPhraseRole === 'turnaround') {
      phraseTotals.turnaroundBars += 1;
      if (bar.lofiPhraseInteraction?.drumRole === 'answer'
          && bar.lofiPhraseInteraction.leadRole === 'rest') {
        phraseTotals.tracedTurnarounds += 1;
      }
    }
  }

  totals.grammarEvents += grammar.totalEvents;
  totals.grammarConformingOnsets += grammar.conformingOnsets;
  totals.grammarStructuralEvents += grammar.structuralEvents;
  totals.grammarStructuralConforming += Math.round(
    grammar.structuralConformanceRate * grammar.structuralEvents,
  );
  totals.grammarFillEvents += grammar.fillEvents;
  totals.grammarFillConforming += Math.round(grammar.fillConformanceRate * grammar.fillEvents);
  totals.grammarApproaches += grammar.approachEvents;
  totals.grammarResolvedApproaches += grammar.resolvedApproaches;
  totals.grammarLocalFallbackApproaches += grammar.localFallbackApproaches;
  totals.grammarLongCrossChordExposures += grammar.longCrossChordExposureCount;
  totals.compNotes += comp.totalNotes;
  totals.compConformingAttacks += comp.conformingAttacks;
  totals.compLongCrossChordExposures += comp.longCrossChordExposureCount;
  totals.padNotes += pad.totalNotes;
  totals.padConformingAttacks += pad.conformingAttacks;
  totals.padLongCrossChordExposures += pad.longCrossChordExposureCount;
  findings.push(...grammar.findings.map((finding) => ({ ...finding, seed })));
  findings.push(...comp.findings.map((finding) => ({ ...finding, seed })));
  findings.push(...pad.findings.map((finding) => ({ ...finding, seed })));

  rows.push({
    seed,
    mode,
    harmonyPoolId: foundation.harmonyPoolId,
    sourcePrototypeIds,
    grammarEvents: grammar.totalEvents,
    grammarOnsetConformanceRate: round(grammar.onsetConformanceRate),
    grammarStructuralConformanceRate: round(grammar.structuralConformanceRate),
    grammarFillConformanceRate: round(grammar.fillConformanceRate),
    grammarApproaches: grammar.approachEvents,
    grammarResolvedApproaches: grammar.resolvedApproaches,
    grammarLocalFallbackApproaches: grammar.localFallbackApproaches,
    grammarLongCrossChordExposures: grammar.longCrossChordExposureCount,
    compNotes: comp.totalNotes,
    compConformingAttacks: comp.conformingAttacks,
    compLongCrossChordExposures: comp.longCrossChordExposureCount,
    padNotes: pad.totalNotes,
    padConformingAttacks: pad.conformingAttacks,
    padLongCrossChordExposures: pad.longCrossChordExposureCount,
    findingCount: grammar.findings.length + comp.findings.length + pad.findings.length,
    statementVariationReturnSentences: rowSentences,
    returnRhythmMatches: rowReturnRhythmMatches,
    variationRhythmMatches: rowVariationRhythmMatches,
    terminalResolutions: rowTerminalResolutions,
    compSupportOnsets: rowCompSupportOnsets,
    compRestOnsets: rowCompRestOnsets,
    answerBars: rowAnswerBars,
    leadNotesInAnswerBars: rowLeadNotesInAnswerBars,
  });
}

const poolIds = new Set(listProgressionPrototypes({ style: 'LOFI' }).map((prototype) => prototype.id));
const prototypeCounts: Record<string, number> = {};
for (const row of rows) {
  for (const id of row.sourcePrototypeIds) prototypeCounts[id] = (prototypeCounts[id] ?? 0) + 1;
}
const selectedPrototypeIds = Object.keys(prototypeCounts);
const selectedClarkIds = CLARK_DERIVED_IDS.filter((id) => prototypeCounts[id] > 0);
const maximumClarkSongShare = Math.max(
  0,
  ...CLARK_DERIVED_IDS.map((id) => (prototypeCounts[id] ?? 0) / rows.length),
);
const summary = {
  grammarOnsetConformanceRate: round(ratio(totals.grammarConformingOnsets, totals.grammarEvents)),
  grammarStructuralConformanceRate: round(ratio(
    totals.grammarStructuralConforming,
    totals.grammarStructuralEvents,
  )),
  grammarFillConformanceRate: round(ratio(totals.grammarFillConforming, totals.grammarFillEvents)),
  grammarApproachConformanceRate: round(ratio(
    totals.grammarResolvedApproaches + totals.grammarLocalFallbackApproaches,
    totals.grammarApproaches,
  )),
  grammarLongCrossChordExposureRate: round(ratio(
    totals.grammarLongCrossChordExposures,
    totals.grammarEvents,
  )),
  compAttackConformanceRate: round(ratio(totals.compConformingAttacks, totals.compNotes)),
  compLongCrossChordExposureRate: round(ratio(
    totals.compLongCrossChordExposures,
    totals.compNotes,
  )),
  padAttackConformanceRate: round(ratio(totals.padConformingAttacks, totals.padNotes)),
  padLongCrossChordExposureRate: round(ratio(
    totals.padLongCrossChordExposures,
    totals.padNotes,
  )),
  motifVariationRhythmMatchRate: round(ratio(
    phraseTotals.variationRhythmMatches,
    phraseTotals.sentences,
  )),
  motifReturnRhythmMatchRate: round(ratio(
    phraseTotals.returnRhythmMatches,
    phraseTotals.sentences,
  )),
  terminalResolutionRate: round(ratio(
    phraseTotals.terminalResolutions,
    phraseTotals.sentences,
  )),
  dynamicArcSentenceRate: round(ratio(
    phraseTotals.dynamicArcSentences,
    phraseTotals.sentences,
  )),
  compSupportOnsetsPerBar: round(ratio(
    phraseTotals.compSupportOnsets,
    phraseTotals.compSupportBars,
  )),
  compRestOnsetsPerBar: round(ratio(
    phraseTotals.compRestOnsets,
    phraseTotals.compRestBars,
  )),
  answerCompPresenceRate: round(ratio(
    phraseTotals.answerBarsWithComp,
    phraseTotals.answerBars,
  )),
  kickStructuralOffsetMedianMs: round(median(phraseTotals.kickOffsetsMs)),
  kickStructuralOffsetStdDevMs: round(standardDeviation(phraseTotals.kickOffsetsMs)),
  snareStructuralOffsetMedianMs: round(median(phraseTotals.snareOffsetsMs)),
  snareStructuralOffsetStdDevMs: round(standardDeviation(phraseTotals.snareOffsetsMs)),
};
const hardGates = {
  clarkIsCandidateOnly: rows.every((row) =>
    row.harmonyPoolId === `lofi-progression-pool:${row.mode}`)
    && CLARK_DERIVED_IDS.every((id) => poolIds.has(id)),
  noClarkCandidateDominates: maximumClarkSongShare <= 0.2,
  oldAndClarkPoolBothConsumed:
    selectedPrototypeIds.some((id) => CLARK_DERIVED_IDS.includes(id as typeof CLARK_DERIVED_IDS[number]))
    && selectedPrototypeIds.some((id) => !CLARK_DERIVED_IDS.includes(id as typeof CLARK_DERIVED_IDS[number])),
  grammarStructuralLocalHarmony: summary.grammarStructuralConformanceRate >= 0.995,
  grammarFillLocalHarmony: summary.grammarFillConformanceRate >= 0.99,
  grammarApproachResolution: summary.grammarApproachConformanceRate >= 0.995,
  grammarNoLongIllegalSuspension: summary.grammarLongCrossChordExposureRate <= 0.002,
  compLocalChordAttacks: summary.compAttackConformanceRate >= 0.999,
  compNoLongIllegalSuspension: summary.compLongCrossChordExposureRate <= 0.001,
  padLocalContractAttacks: summary.padAttackConformanceRate >= 0.995,
  padNoLongIllegalSuspension: summary.padLongCrossChordExposureRate <= 0.002,
  phraseScorePresentForEverySeed: phraseTotals.systemicPocketPlans === rows.length,
  statementVariationReturnCompiled:
    phraseTotals.sentences >= Math.floor(rows.length * 0.8)
    && summary.motifVariationRhythmMatchRate >= 0.95
    && summary.motifReturnRhythmMatchRate >= 0.95,
  terminalTensionResolves: summary.terminalResolutionRate >= 0.995,
  phraseDynamicArcSurvivesMicroVariation: summary.dynamicArcSentenceRate >= 0.95,
  compYieldsWhenLeadSpeaks:
    summary.compSupportOnsetsPerBar < summary.compRestOnsetsPerBar,
  compAnswersOnlyInsideLeadRest:
    phraseTotals.answerBars > 0
    && phraseTotals.leadNotesInAnswerBars === 0
    // A section may assign the answer to Drum alone, but whenever Comp is
    // present it can only answer inside this Lead-rest score. Across the
    // sample at least half of the planned answers must include Comp.
    && summary.answerCompPresenceRate >= 0.5,
  drumTurnaroundTracesToAnswerScore:
    phraseTotals.turnaroundBars > 0
    && phraseTotals.tracedTurnarounds === phraseTotals.turnaroundBars,
  systemicKickSnarePocket:
    Math.abs(summary.kickStructuralOffsetMedianMs) <= 3
    && summary.kickStructuralOffsetStdDevMs <= 3
    && summary.snareStructuralOffsetMedianMs >= 14
    && summary.snareStructuralOffsetMedianMs <= 26
    && summary.snareStructuralOffsetStdDevMs <= 3,
};

mkdirSync(OUTPUT_DIR, { recursive: true });
const report = {
  schemaVersion: 2,
  task: 'LOFI-HIPHOP-PHRASE-INTERACTION-V3',
  scope: 'Arrangement only: pooled harmony, phrase interaction score, realized grammar/texture, motif and systemic groove.',
  seedCount: SEED_COUNT,
  poolSize: poolIds.size,
  clarkDerivedIds: CLARK_DERIVED_IDS,
  selectedClarkIds,
  maximumClarkSongShare: round(maximumClarkSongShare),
  prototypeCounts,
  totals,
  phraseTotals: {
    sentences: phraseTotals.sentences,
    returnRhythmMatches: phraseTotals.returnRhythmMatches,
    variationRhythmMatches: phraseTotals.variationRhythmMatches,
    terminalResolutions: phraseTotals.terminalResolutions,
    dynamicArcSentences: phraseTotals.dynamicArcSentences,
    compSupportOnsets: phraseTotals.compSupportOnsets,
    compSupportBars: phraseTotals.compSupportBars,
    compRestOnsets: phraseTotals.compRestOnsets,
    compRestBars: phraseTotals.compRestBars,
    answerBars: phraseTotals.answerBars,
    answerBarsWithComp: phraseTotals.answerBarsWithComp,
    leadNotesInAnswerBars: phraseTotals.leadNotesInAnswerBars,
    tracedTurnarounds: phraseTotals.tracedTurnarounds,
    turnaroundBars: phraseTotals.turnaroundBars,
    systemicPocketPlans: phraseTotals.systemicPocketPlans,
    kickOffsetSamples: phraseTotals.kickOffsetsMs.length,
    snareOffsetSamples: phraseTotals.snareOffsetsMs.length,
  },
  summary,
  hardGates,
  findingCounts: Object.fromEntries([...new Set(findings.map((finding) => finding.kind))]
    .map((kind) => [kind, findings.filter((finding) => finding.kind === kind).length])),
  findingSamples: findings.slice(0, 100),
  rows,
};
writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);

const markdown = [
  '# LOFI-HIPHOP-PHRASE-INTERACTION-V3 — Local harmony audit',
  '',
  `Seeds: **${SEED_COUNT}** (major/minor alternating). This is a read-only audit; it does not edit NoteIR.`,
  '',
  '## Pool consumption',
  '',
  `- Complete LOFI pool: ${poolIds.size} prototypes.`,
  `- Clark-derived candidates reached: ${selectedClarkIds.length}/${CLARK_DERIVED_IDS.length} (${selectedClarkIds.join(', ') || 'none'}).`,
  `- Maximum single Clark-derived candidate song share: ${pct(maximumClarkSongShare)}.`,
  `- Other pre-existing LOFI candidates reached: ${selectedPrototypeIds.filter((id) =>
    !CLARK_DERIVED_IDS.includes(id as typeof CLARK_DERIVED_IDS[number])).length}.`,
  '',
  '## Local-harmony measurements',
  '',
  '| Measurement | Result |',
  '|---|---:|',
  `| Grammar structural terminal conformance | ${pct(summary.grammarStructuralConformanceRate)} |`,
  `| Grammar fill terminal conformance | ${pct(summary.grammarFillConformanceRate)} |`,
  `| Grammar A terminal conformance (paired resolution or local fallback) | ${pct(summary.grammarApproachConformanceRate)} |`,
  `| Grammar long illegal cross-chord exposure | ${pct(summary.grammarLongCrossChordExposureRate)} |`,
  `| Comp attack chord-spelling conformance | ${pct(summary.compAttackConformanceRate)} |`,
  `| Comp long illegal cross-chord exposure | ${pct(summary.compLongCrossChordExposureRate)} |`,
  `| Pad attack contract conformance | ${pct(summary.padAttackConformanceRate)} |`,
  `| Pad long illegal cross-chord exposure | ${pct(summary.padLongCrossChordExposureRate)} |`,
  '',
  '## Phrase interaction measurements',
  '',
  '| Measurement | Result |',
  '|---|---:|',
  `| Compiled statement → variation → return sentences | ${phraseTotals.sentences} |`,
  `| Variation rhythm fingerprint match | ${pct(summary.motifVariationRhythmMatchRate)} |`,
  `| Return rhythm fingerprint match | ${pct(summary.motifReturnRhythmMatchRate)} |`,
  `| Return terminal local-stable resolution | ${pct(summary.terminalResolutionRate)} |`,
  `| Variation louder than release/return | ${pct(summary.dynamicArcSentenceRate)} |`,
  `| Comp onsets / Lead-support bar | ${summary.compSupportOnsetsPerBar.toFixed(2)} |`,
  `| Comp onsets / Lead-rest bar | ${summary.compRestOnsetsPerBar.toFixed(2)} |`,
  `| Answer bars with Comp gesture | ${pct(summary.answerCompPresenceRate)} |`,
  `| Lead notes inside Comp-answer bars | ${phraseTotals.leadNotesInAnswerBars} |`,
  `| Kick structural offset median ± σ | ${summary.kickStructuralOffsetMedianMs.toFixed(2)} ± ${summary.kickStructuralOffsetStdDevMs.toFixed(2)} ms |`,
  `| Snare structural offset median ± σ | ${summary.snareStructuralOffsetMedianMs.toFixed(2)} ± ${summary.snareStructuralOffsetStdDevMs.toFixed(2)} ms |`,
  `| Traceable Drum turnaround bars | ${phraseTotals.tracedTurnarounds}/${phraseTotals.turnaroundBars} |`,
  '',
  '## Gates',
  '',
  ...Object.entries(hardGates).map(([id, passed]) => `- ${passed ? 'PASS' : 'FAIL'} — \`${id}\``),
  '',
  '## Finding counts',
  '',
  ...Object.entries(report.findingCounts).map(([kind, count]) => `- \`${kind}\`: ${count}`),
  '',
].join('\n');
writeFileSync(MARKDOWN_PATH, `${markdown}\n`);

console.log(JSON.stringify({
  seedCount: SEED_COUNT,
  selectedClarkIds,
  selectedPrototypeCount: selectedPrototypeIds.length,
  summary,
  hardGates,
  findingCounts: report.findingCounts,
}, null, 2));
