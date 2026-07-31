import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pc } from '../src/core/generation/newEngine/foundation';
import {
  buildSongBundle,
  generateSongFromBundle,
  type SongBundle,
} from '../src/core/generation/newEngine/generation/GenerationController';
import {
  DRUM,
  lofiAuxiliaryTopLoopById,
  lofiDrumPhraseById,
  type DrumHit,
} from '../src/core/generation/newEngine/knowledge/grooves';
import {
  freezeMusicalIR,
  type MusicalIR,
  type TrackIR,
} from '../src/core/generation/newEngine/ir/MusicalIR';
import {
  minimumVoiceLeadingAssignment,
} from '../src/core/generation/newEngine/instrumental/foundationVoiceLeading';
import { musicalIRToSMF } from '../src/core/generation/newEngine/sandbox/midiFile';

const SEED_COUNT = Number(process.env.LOFI_AUDIT_SEEDS ?? 500);
const REFERENCE_MANIFEST_PATH = resolve('docs/lofi-reference-arrangement-manifest.json');
const REFERENCE_ENVELOPE_PATH = resolve('docs/generated/lofi_reference_arrangement_envelope.json');
const BEFORE_PATH = resolve('docs/generated/lofi_musical_foundation_before.json');
const AFTER_PATH = resolve('docs/generated/lofi_musical_foundation_after.json');
const REPORT_PATH = resolve('docs/generated/lofi_musical_foundation_comparison.md');
const MANUAL_REVIEW_PATH = resolve('docs/generated/lofi_reference_manual_review.csv');
const REVIEW_DIR = resolve('tmp/lofi-musical-foundation-review');

const SNARES = new Set<number>([DRUM.SIDESTICK, DRUM.SNARE, DRUM.CLAP, 40]);
const HATS = new Set<number>([DRUM.CHAT, DRUM.OHAT, DRUM.PHAT]);

interface EnvelopeFeature {
  p10: number;
  median: number;
  p90: number;
  unit: string;
}

interface ReferenceFamily {
  id: string;
  referenceIds: string[];
  confidence: number;
  features: Record<string, EnvelopeFeature>;
}

interface ReferenceManifest {
  schemaVersion: number;
  scope: string;
  measurementPolicy: Record<string, string>;
  references: Array<{
    id: string;
    title: string;
    url: string;
    evidence: string;
    confidence: number;
  }>;
  familyEnvelopes: ReferenceFamily[];
}

interface VoiceMetrics {
  transitionCount: number;
  meanMovement: number | null;
  p95Movement: number | null;
  topVoiceJumpP95: number | null;
  commonToneRetention: number | null;
  crossingCount: number;
}

interface FoundationAuditRow {
  seed: number;
  generationStatus: string;
  tempoBpm: number;
  planId: string;
  archetypeId: string;
  grooveContractId: string;
  drumPhraseId: string;
  drumPhraseFamily: string;
  topLoopId: string | null;
  harmonyPoolId: string;
  harmonicPrototypeId: string;
  bassPatternId: string;
  voicingFamily: string;
  padFamily: string;
  planTraceable: boolean;
  corePhraseCoverage: number;
  structuralMutationBarRatio: number;
  boundaryCount: number;
  coreDrumPeriodBars: number;
  combinedDrumPeriodBars: number;
  backbeatCoverage: number;
  beatOneKickCoverage: number;
  kickHitsPerBar: number;
  kickSyncopationRatio: number;
  hatDownbeatVelocityContrast: number | null;
  auxiliaryHitsPerBar: number;
  finalDrumPlanProvenance: number;
  harmonicPeriodChords: number;
  extendedHarmonyCoverage: number;
  strongDominantTonicRate: number;
  bassOnsetsPerBar: number;
  bassKickCoincidence: number | null;
  compAttacksPerBar: number;
  compVoicesPerAttack: number | null;
  padAttacksPerBar: number;
  padVoicesPerAttack: number | null;
  padSustainCoverage: number;
  leadActiveBarCoverage: number;
  leadNotesPerActiveBar: number;
  longestPlannedLeadRestBars: number;
  foundationLeadCollisionRate: number | null;
  compVoiceLeading: VoiceMetrics;
  padVoiceLeading: VoiceMetrics;
  nearestReferenceFamily: string;
  referenceEnvelopeDistance: number;
}

function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function stats(values: readonly number[]): {
  count: number;
  p10: number | null;
  median: number | null;
  p90: number | null;
  mean: number | null;
} {
  return {
    count: values.length,
    p10: round(quantile(values, 0.1)),
    median: round(quantile(values, 0.5)),
    p90: round(quantile(values, 0.9)),
    mean: values.length ? round(average(values)) : null,
  };
}

function minimalPeriod(values: readonly string[]): number {
  if (values.length === 0) return 0;
  for (let period = 1; period <= values.length; period++) {
    if (values.every((value, index) => value === values[index % period])) return period;
  }
  return values.length;
}

function signature(hits: readonly DrumHit[]): string {
  return hits
    .map((hit) => `${hit.drum}@${hit.beat.toFixed(3)}`)
    .sort()
    .join('|');
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

function stemIr(
  ir: MusicalIR,
  roles: readonly TrackIR['role'][],
  replaceDrum?: TrackIR,
): MusicalIR {
  const include = new Set(roles);
  const tracks = ir.tracks
    .filter((track) => include.has(track.role))
    .map((track) => track.role === 'drum' && replaceDrum ? replaceDrum : cloneTrack(track));
  return freezeMusicalIR({
    timebase: ir.timebase,
    durationTicks: ir.durationTicks,
    tracks,
  });
}

function loopContext(bundle: SongBundle): {
  beatsPerBar: number;
  loopBars: Set<number>;
  loopBarCount: number;
  scoreBars: Array<{
    sectionId: string;
    absoluteBar: number;
    structuralMutation?: boolean;
    drumTopLoopId?: string;
    drumTopLoopBarIndex?: number;
  }>;
} {
  const beatsPerBar = bundle.arrangement.meter.numerator
    * (4 / bundle.arrangement.meter.denominator);
  const loopSections = new Set(bundle.arrangement.sections
    .filter((section) => section.functionTag === 'loop')
    .map((section) => section.id));
  const scoreBars = Object.values(bundle.arrangement.grooveScorePlan.bySection)
    .flatMap((section) => section.bars)
    .filter((bar) => loopSections.has(bar.sectionId));
  const loopBars = new Set(scoreBars.map((bar) => bar.absoluteBar));
  return { beatsPerBar, loopBars, loopBarCount: scoreBars.length, scoreBars };
}

function notesForLoop(
  track: MusicalIR['tracks'][number] | undefined,
  ppq: number,
  beatsPerBar: number,
  loopBars: ReadonlySet<number>,
) {
  return (track?.notes ?? []).filter((note) => {
    const beat = (note.startTick as number) / ppq;
    return loopBars.has(Math.floor((beat + 1e-6) / beatsPerBar));
  });
}

function onsetGroups(notes: readonly MusicalIR['tracks'][number]['notes'][number][]): number[][] {
  const groups = new Map<number, number[]>();
  for (const note of notes) {
    const at = note.startTick as number;
    const pitches = groups.get(at) ?? [];
    pitches.push(note.pitch as number);
    groups.set(at, pitches);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, pitches]) => [...new Set(pitches)].sort((a, b) => a - b));
}

function voiceLeadingMetrics(voicings: readonly number[][]): VoiceMetrics {
  const movements: number[] = [];
  const topJumps: number[] = [];
  const commonToneRates: number[] = [];
  let crossings = 0;
  for (let index = 1; index < voicings.length; index++) {
    const previous = voicings[index - 1];
    const current = voicings[index];
    if (!previous.length || !current.length) continue;
    const assignment = minimumVoiceLeadingAssignment(previous, current, 5);
    if (assignment.pairs.length) {
      movements.push(...assignment.pairs.map((pair) => pair.distance));
      topJumps.push(Math.abs(
        current[current.length - 1] - previous[previous.length - 1],
      ));
      commonToneRates.push(
        assignment.pairs.filter((pair) => pair.distance === 0).length / assignment.pairs.length,
      );
      for (let left = 0; left < assignment.pairs.length; left++) {
        for (let right = left + 1; right < assignment.pairs.length; right++) {
          const a = assignment.pairs[left];
          const b = assignment.pairs[right];
          if ((a.previous - b.previous) * (a.current - b.current) < 0) crossings++;
        }
      }
    }
  }
  return {
    transitionCount: Math.max(0, voicings.length - 1),
    meanMovement: round(movements.length ? average(movements) : null),
    p95Movement: round(quantile(movements, 0.95)),
    topVoiceJumpP95: round(quantile(topJumps, 0.95)),
    commonToneRetention: round(commonToneRates.length ? average(commonToneRates) : null),
    crossingCount: crossings,
  };
}

function compVoicings(bundle: SongBundle, track: MusicalIR['tracks'][number] | undefined): number[][] {
  if (!track) return [];
  const ppq = bundle.timebase.ppq;
  const out: number[][] = [];
  for (const span of bundle.harmonic.chordTimeline) {
    const lo = (span.startBeat as number) * ppq - ppq * 0.12;
    const hi = ((span.startBeat as number) + (span.durationBeats as number)) * ppq;
    const candidates = track.notes.filter((note) =>
      (note.startTick as number) >= lo && (note.startTick as number) < hi);
    if (!candidates.length) continue;
    // A texture may arpeggiate one planned chord across several attacks.  Its
    // first single note is not the chord's "top voice"; compare the union of
    // pitches actually used inside each harmonic span so block and arpeggiated
    // Comp are measured by the same musical definition.
    out.push([...new Set(candidates.map((note) => note.pitch as number))]
      .sort((a, b) => a - b));
  }
  return out;
}

function padVoicings(bundle: SongBundle, track: MusicalIR['tracks'][number] | undefined): number[][] {
  if (!track) return [];
  const ppq = bundle.timebase.ppq;
  const out: number[][] = [];
  for (const span of bundle.harmonic.chordTimeline) {
    const anchor = (span.startBeat as number) * ppq + 1;
    const active = track.notes
      .filter((note) =>
        (note.startTick as number) <= anchor
        && (note.startTick as number) + (note.durationTicks as number) > anchor)
      .map((note) => note.pitch as number);
    if (active.length) out.push([...new Set(active)].sort((a, b) => a - b));
  }
  return out;
}

function padSustainCoverage(
  notes: readonly MusicalIR['tracks'][number]['notes'][number][],
  ppq: number,
  beatsPerBar: number,
  loopBars: ReadonlySet<number>,
): number {
  if (!loopBars.size || !notes.length) return 0;
  const intervals = notes
    .map((note) => ({
      lo: (note.startTick as number) / ppq,
      hi: ((note.startTick as number) + (note.durationTicks as number)) / ppq,
    }))
    .flatMap((interval) => [...loopBars].map((bar) => ({
      lo: Math.max(interval.lo, bar * beatsPerBar),
      hi: Math.min(interval.hi, (bar + 1) * beatsPerBar),
    })))
    .filter((interval) => interval.hi > interval.lo)
    .sort((a, b) => a.lo - b.lo);
  if (!intervals.length) return 0;
  let covered = 0;
  let lo = intervals[0].lo;
  let hi = intervals[0].hi;
  for (const interval of intervals.slice(1)) {
    if (interval.lo <= hi) hi = Math.max(hi, interval.hi);
    else {
      covered += hi - lo;
      lo = interval.lo;
      hi = interval.hi;
    }
  }
  covered += hi - lo;
  return covered / (loopBars.size * beatsPerBar);
}

function finalDrumProvenance(
  bundle: SongBundle,
  ir: MusicalIR,
  loopBars: ReadonlySet<number>,
  beatsPerBar: number,
): number {
  const drum = ir.tracks.find((track) => track.role === 'drum');
  if (!drum) return 0;
  const expected = new Map<number, readonly DrumHit[]>();
  for (const section of bundle.arrangement.sections) {
    const patterns = bundle.instrumentation.drumPatternBySectionBar[section.id] ?? [];
    const bars = bundle.arrangement.grooveScorePlan.bySection[section.id]?.bars ?? [];
    bars.forEach((bar, index) => expected.set(bar.absoluteBar, patterns[index] ?? []));
  }
  const actual = notesForLoop(drum, bundle.timebase.ppq, beatsPerBar, loopBars);
  if (!actual.length) return 0;
  let traced = 0;
  for (const note of actual) {
    const beat = (note.startTick as number) / bundle.timebase.ppq;
    const bar = Math.floor((beat + 1e-6) / beatsPerBar);
    const inBar = beat - bar * beatsPerBar;
    const hit = (expected.get(bar) ?? []).find((candidate) =>
      candidate.drum === (note.pitch as number)
      && Math.abs(candidate.beat - inBar) <= 0.26);
    if (hit) traced++;
  }
  return traced / actual.length;
}

function referenceDistance(
  row: Omit<FoundationAuditRow, 'nearestReferenceFamily' | 'referenceEnvelopeDistance'>,
  family: ReferenceFamily,
): number {
  const values: Record<string, number> = {
    tempoBpm: row.tempoBpm,
    kickHitsPerBar: row.kickHitsPerBar,
    backbeatCoverage: row.backbeatCoverage,
    beatOneKickCoverage: row.beatOneKickCoverage,
    harmonicPeriodChords: row.harmonicPeriodChords,
    bassOnsetsPerBar: row.bassOnsetsPerBar,
    compAttacksPerBar: row.compAttacksPerBar,
    padAttacksPerBar: row.padAttacksPerBar,
    leadActiveBarCoverage: row.leadActiveBarCoverage,
  };
  const distances = Object.entries(family.features).flatMap(([key, envelope]) => {
    const value = values[key];
    if (value === undefined || !Number.isFinite(value)) return [];
    const width = Math.max(1e-6, envelope.p90 - envelope.p10);
    if (value < envelope.p10) return [(envelope.p10 - value) / width];
    if (value > envelope.p90) return [(value - envelope.p90) / width];
    return [0];
  });
  return distances.length ? average(distances) : Number.POSITIVE_INFINITY;
}

function auxiliaryCoreTrack(bundle: SongBundle, ir: MusicalIR): TrackIR | undefined {
  const drum = ir.tracks.find((track) => track.role === 'drum');
  if (!drum) return undefined;
  const { beatsPerBar, scoreBars } = loopContext(bundle);
  const auxiliary = scoreBars.flatMap((bar) => {
    const loop = lofiAuxiliaryTopLoopById(bar.drumTopLoopId);
    const index = bar.drumTopLoopBarIndex;
    if (!loop || index === undefined) return [];
    return loop.bars[index].map((hit) => ({
      pitch: hit.drum,
      beat: bar.absoluteBar * beatsPerBar + hit.beat,
    }));
  });
  return {
    ...cloneTrack(drum),
    notes: drum.notes
      .filter((note) => {
        const beat = (note.startTick as number) / bundle.timebase.ppq;
        return !auxiliary.some((event) =>
          event.pitch === (note.pitch as number) && Math.abs(event.beat - beat) <= 0.26);
      })
      .map((note) => ({ ...note })),
  };
}

function auditSong(
  bundle: SongBundle,
  ir: MusicalIR,
  generationStatus: string,
  seed: number,
  families: readonly ReferenceFamily[],
): FoundationAuditRow {
  const foundation = bundle.arrangement.lofiFoundationPlan;
  if (!foundation) throw new Error(`LOFI seed ${seed} has no LofiFoundationPlan`);
  const phrase = lofiDrumPhraseById(foundation.drumPhraseId);
  if (!phrase) throw new Error(`LOFI seed ${seed} selected missing phrase ${foundation.drumPhraseId}`);
  const topLoop = lofiAuxiliaryTopLoopById(foundation.topLoopId);
  const { beatsPerBar, loopBars, loopBarCount, scoreBars } = loopContext(bundle);
  const primaryLoopSection = bundle.arrangement.sections.find((section) => section.functionTag === 'loop');
  const harmonicPrototypeId = bundle.harmonic.chordTimeline
    .find((span) => span.sectionId === primaryLoopSection?.id)?.sourcePrototypeId ?? 'unattributed';
  const patterns = scoreBars.map((bar) => {
    const sectionBars = bundle.arrangement.grooveScorePlan.bySection[bar.sectionId]?.bars ?? [];
    const index = sectionBars.findIndex((candidate) => candidate.absoluteBar === bar.absoluteBar);
    return bundle.instrumentation.drumPatternBySectionBar[bar.sectionId]?.[index] ?? [];
  });
  const mutationBars = scoreBars.filter((bar) => bar.structuralMutation).length;
  const legalBackbeats = patterns.filter((pattern) => phrase.backbeatMode === 'halftime-three'
    ? pattern.some((hit) => SNARES.has(hit.drum) && Math.abs(hit.beat - 2) < 1e-6)
    : [1, 3].every((beat) =>
      pattern.some((hit) => SNARES.has(hit.drum) && Math.abs(hit.beat - beat) < 1e-6))).length;
  const beatOneKicks = patterns.filter((pattern) =>
    pattern.some((hit) => hit.drum === DRUM.KICK && Math.abs(hit.beat) < 1e-6)).length;
  const kickHits = patterns.flatMap((pattern) => pattern.filter((hit) => hit.drum === DRUM.KICK));
  const syncopatedKicks = kickHits.filter((hit) => Math.abs(hit.beat - Math.round(hit.beat)) > 1e-6);
  const hats = patterns.flatMap((pattern) => pattern.filter((hit) => HATS.has(hit.drum)));
  const downHat = hats.filter((hit) => Math.abs(hit.beat - Math.round(hit.beat)) < 1e-6);
  const offHat = hats.filter((hit) => Math.abs(hit.beat - Math.round(hit.beat)) >= 1e-6);
  const topFourBars = topLoop
    ? Array.from({ length: 4 }, (_, index) => [
      ...phrase.bars[index % 2],
      ...topLoop.bars[index],
    ])
    : Array.from({ length: 4 }, (_, index) => [...phrase.bars[index % 2]]);
  const firstLoop = bundle.arrangement.sections.find((section) => section.functionTag === 'loop');
  const harmonicSpans = bundle.harmonic.chordTimeline
    .filter((span) => span.sectionId === firstLoop?.id);
  const identities = harmonicSpans.map((span) => `${span.rootPc}:${span.chordType ?? span.quality}`);
  const extended = harmonicSpans.filter((span) =>
    /(6|7|9|11|13|add|sus)/i.test(span.chordType ?? span.quality)).length;
  let dominantTonic = 0;
  let functionalPairs = 0;
  for (let index = 1; index < harmonicSpans.length; index++) {
    const currentIndex = bundle.harmonic.chordTimeline.indexOf(harmonicSpans[index]);
    const previousIndex = bundle.harmonic.chordTimeline.indexOf(harmonicSpans[index - 1]);
    if (previousIndex < 0 || currentIndex < 0) continue;
    functionalPairs++;
    if (
      bundle.harmonic.chordFunctionTimeline[previousIndex] === 'D'
      && bundle.harmonic.chordFunctionTimeline[currentIndex] === 'T'
    ) dominantTonic++;
  }

  const drum = ir.tracks.find((track) => track.role === 'drum');
  const bass = ir.tracks.find((track) => track.role === 'bass');
  const comp = ir.tracks.find((track) => track.role === 'comp');
  const pad = ir.tracks.find((track) => track.role === 'pad');
  const lead = ir.tracks.find((track) => track.role === 'lead');
  const loopBass = notesForLoop(bass, bundle.timebase.ppq, beatsPerBar, loopBars);
  const loopComp = notesForLoop(comp, bundle.timebase.ppq, beatsPerBar, loopBars);
  const loopPad = notesForLoop(pad, bundle.timebase.ppq, beatsPerBar, loopBars);
  const loopLead = notesForLoop(lead, bundle.timebase.ppq, beatsPerBar, loopBars);
  const loopDrum = notesForLoop(drum, bundle.timebase.ppq, beatsPerBar, loopBars);
  const compGroups = onsetGroups(loopComp);
  const padGroups = onsetGroups(loopPad);
  const kickBeats = loopDrum
    .filter((note) => (note.pitch as number) === DRUM.KICK)
    .map((note) => (note.startTick as number) / bundle.timebase.ppq);
  const bassKickMatches = loopBass.map((note) => {
    const beat = (note.startTick as number) / bundle.timebase.ppq;
    return kickBeats.some((kick) => Math.abs(kick - beat) <= 0.12) ? 1 : 0;
  });
  const audibleLeadBars = new Set(loopLead.map((note) =>
    Math.floor((((note.startTick as number) / bundle.timebase.ppq) + 1e-6) / beatsPerBar)));
  const leadCollisions = loopLead.map((note) => {
    const tick = note.startTick as number;
    const pitch = note.pitch as number;
    const candidates = [...loopComp, ...loopPad, ...loopBass];
    return candidates.some((candidate) =>
      Math.abs((candidate.startTick as number) - tick) <= bundle.timebase.ppq * 0.08
      && Math.abs((candidate.pitch as number) - pitch) <= 2) ? 1 : 0;
  });
  const longestPlannedLeadRestBars = Math.max(
    0,
    ...bundle.arrangement.lofiLeadPresencePlan!.silenceWindows
      .map((window) => window.endBarInSection - window.startBarInSection),
  );

  const base = {
    seed,
    generationStatus,
    tempoBpm: bundle.arrangement.tempoBpm,
    planId: foundation.id,
    archetypeId: foundation.archetypeId,
    grooveContractId: foundation.grooveContractId,
    drumPhraseId: foundation.drumPhraseId,
    drumPhraseFamily: phrase.family,
    topLoopId: foundation.topLoopId ?? null,
    harmonyPoolId: foundation.harmonyPoolId,
    harmonicPrototypeId,
    bassPatternId: foundation.bassPatternId,
    voicingFamily: foundation.voicingIntent.family,
    padFamily: foundation.padIntent.family,
    planTraceable:
      bundle.arrangement.songGrooveContractId === foundation.grooveContractId
      && foundation.harmonyPoolId === `lofi-progression-pool:${bundle.band.mode}`
      && harmonicPrototypeId !== 'unattributed'
      && scoreBars.every((bar) =>
        bundle.arrangement.grooveScorePlan.bySection[bar.sectionId].bars
          .find((candidate) => candidate.absoluteBar === bar.absoluteBar)?.drumPhraseId
          === foundation.drumPhraseId)
      && scoreBars.every((bar) => bar.drumTopLoopId === foundation.topLoopId)
      && scoreBars.every((bar) =>
        bundle.arrangement.grooveScorePlan.bySection[bar.sectionId].bassPatternId
        === foundation.bassPatternId),
    corePhraseCoverage: 1 - mutationBars / Math.max(1, loopBarCount),
    structuralMutationBarRatio: mutationBars / Math.max(1, loopBarCount),
    boundaryCount: bundle.arrangement.grooveScorePlan.boundaries.length,
    coreDrumPeriodBars: minimalPeriod(phrase.bars.map(signature)),
    combinedDrumPeriodBars: minimalPeriod(topFourBars.map(signature)),
    backbeatCoverage: legalBackbeats / Math.max(1, patterns.length),
    beatOneKickCoverage: beatOneKicks / Math.max(1, patterns.length),
    kickHitsPerBar: kickHits.length / Math.max(1, patterns.length),
    kickSyncopationRatio: syncopatedKicks.length / Math.max(1, kickHits.length),
    hatDownbeatVelocityContrast: downHat.length && offHat.length
      ? average(downHat.map((hit) => hit.vel)) - average(offHat.map((hit) => hit.vel))
      : null,
    auxiliaryHitsPerBar: topLoop
      ? topLoop.bars.reduce((sum, bar) => sum + bar.length, 0) / topLoop.bars.length
      : 0,
    finalDrumPlanProvenance: finalDrumProvenance(bundle, ir, loopBars, beatsPerBar),
    harmonicPeriodChords: minimalPeriod(identities),
    extendedHarmonyCoverage: extended / Math.max(1, harmonicSpans.length),
    strongDominantTonicRate: dominantTonic / Math.max(1, functionalPairs),
    bassOnsetsPerBar: loopBass.length / Math.max(1, loopBarCount),
    bassKickCoincidence: bassKickMatches.length ? average(bassKickMatches) : null,
    compAttacksPerBar: compGroups.length / Math.max(1, loopBarCount),
    compVoicesPerAttack: compGroups.length ? average(compGroups.map((group) => group.length)) : null,
    padAttacksPerBar: padGroups.length / Math.max(1, loopBarCount),
    padVoicesPerAttack: padGroups.length ? average(padGroups.map((group) => group.length)) : null,
    padSustainCoverage: padSustainCoverage(loopPad, bundle.timebase.ppq, beatsPerBar, loopBars),
    leadActiveBarCoverage: audibleLeadBars.size / Math.max(1, loopBarCount),
    leadNotesPerActiveBar: loopLead.length / Math.max(1, audibleLeadBars.size),
    longestPlannedLeadRestBars,
    foundationLeadCollisionRate: leadCollisions.length ? average(leadCollisions) : null,
    compVoiceLeading: voiceLeadingMetrics(compVoicings(bundle, comp)),
    padVoiceLeading: voiceLeadingMetrics(padVoicings(bundle, pad)),
  } satisfies Omit<FoundationAuditRow, 'nearestReferenceFamily' | 'referenceEnvelopeDistance'>;
  const referenceScores = families
    .map((family) => ({ id: family.id, distance: referenceDistance(base, family) }))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  return {
    ...base,
    nearestReferenceFamily: referenceScores[0]?.id ?? 'unavailable',
    referenceEnvelopeDistance: referenceScores[0]?.distance ?? Number.POSITIVE_INFINITY,
  };
}

function metric(rows: readonly FoundationAuditRow[], pick: (row: FoundationAuditRow) => number | null) {
  return stats(rows.map(pick).filter((value): value is number => value !== null && Number.isFinite(value)));
}

function pct(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function num(value: number | null, digits = 2): string {
  return value === null ? 'n/a' : value.toFixed(digits);
}

function selectReviewSeeds(rows: readonly FoundationAuditRow[]): number[] {
  const selected: number[] = [];
  for (const archetype of [...new Set(rows.map((row) => row.archetypeId))].sort()) {
    selected.push(...rows.filter((row) => row.archetypeId === archetype).slice(0, 3).map((row) => row.seed));
  }
  const edge = [...rows].sort((a, b) => {
    const aScore = a.referenceEnvelopeDistance + (a.compVoiceLeading.p95Movement ?? 0) / 24
      + (a.foundationLeadCollisionRate ?? 0);
    const bScore = b.referenceEnvelopeDistance + (b.compVoiceLeading.p95Movement ?? 0) / 24
      + (b.foundationLeadCollisionRate ?? 0);
    return bScore - aScore || a.seed - b.seed;
  });
  for (const row of edge) {
    if (!selected.includes(row.seed)) selected.push(row.seed);
    if (selected.length >= 16) break;
  }
  return selected.slice(0, 16).sort((a, b) => a - b);
}

function exportReviewSeed(seed: number, row: FoundationAuditRow): void {
  const bundle = buildSongBundle({
    seed,
    styleHint: 'lofi',
    mood: 'build',
    targetDuration: 120,
    key: pc(0),
  });
  const result = generateSongFromBundle(bundle);
  if (!result.ir || result.status === 'failed') {
    throw new Error(`Review seed ${seed} failed during export`);
  }
  const dir = resolve(REVIEW_DIR, `seed-${seed}`);
  mkdirSync(dir, { recursive: true });
  const coreDrum = auxiliaryCoreTrack(bundle, result.ir);
  const exports = [
    ['drum.mid', stemIr(result.ir, ['drum'], coreDrum)],
    ['drum+top.mid', stemIr(result.ir, ['drum'])],
    ['foundation.mid', stemIr(result.ir, ['drum', 'bass', 'comp', 'pad'])],
    ['full.mid', stemIr(result.ir, ['drum', 'bass', 'comp', 'pad', 'lead'])],
  ] as const;
  for (const [name, ir] of exports) {
    writeFileSync(
      resolve(dir, name),
      Buffer.from(musicalIRToSMF(ir, bundle.arrangement.tempoBpm, 'lofi')),
    );
  }
  const harmonicCycle = bundle.harmonic.chordTimeline
    .filter((span) =>
      span.sectionId === bundle.arrangement.sections
        .find((section) => section.functionTag === 'loop')?.id)
    .map((span) => ({
      rootPc: span.rootPc,
      chordType: span.chordType ?? span.quality,
      durationBeats: span.durationBeats,
    }));
  const arrangementLog = {
    row,
    foundationPlan: bundle.arrangement.lofiFoundationPlan,
    harmonicCycle,
    sections: bundle.arrangement.sections,
  };
  writeFileSync(resolve(dir, 'foundation-log.json'), `${JSON.stringify(arrangementLog, null, 2)}\n`);
  writeFileSync(resolve(dir, 'arrangement-log.json'), `${JSON.stringify(arrangementLog, null, 2)}\n`);
  const family = (JSON.parse(readFileSync(REFERENCE_MANIFEST_PATH, 'utf8')) as ReferenceManifest)
    .familyEnvelopes.find((candidate) => candidate.id === row.nearestReferenceFamily);
  writeFileSync(resolve(dir, 'feature-comparison.json'), `${JSON.stringify({
    seed,
    nearestReferenceFamily: row.nearestReferenceFamily,
    normalizedEnvelopeDistance: row.referenceEnvelopeDistance,
    generated: row,
    referenceEnvelope: family ?? null,
  }, null, 2)}\n`);
  writeFileSync(resolve(dir, 'review.md'), [
    `# LOFI Foundation blind review — seed ${seed}`,
    '',
    `Archetype: \`${row.archetypeId}\`  `,
    `Nearest arrangement family: \`${row.nearestReferenceFamily}\`  `,
    `Envelope distance: \`${row.referenceEnvelopeDistance.toFixed(4)}\``,
    '',
    'Listen in this order: `drum.mid` → `drum+top.mid` → `foundation.mid` → `full.mid`.',
    '',
    '| Criterion | 0 / 1 / 2 | Notes |',
    '|---|---:|---|',
    '| Boom-bap identity |  |  |',
    '| Slow-soul weight |  |  |',
    '| Loop coherence |  |  |',
    '| Harmony / voicing naturalness |  |  |',
    '| Foundation completeness without Lead |  |  |',
    '| Melodic space |  |  |',
    '| Originality / non-copy |  |  |',
    '',
    'Hard-fail observations: overly busy Kick, mechanical eight-bar fill, Pad cluster jumping,',
    'large audible Comp voice jumps, foundation collapse when Lead is removed, or dependence on',
    'timbre/low-pass/noise to read as LOFI.',
    '',
  ].join('\n'));
}

mkdirSync(resolve('docs/generated'), { recursive: true });
mkdirSync(REVIEW_DIR, { recursive: true });

const manifest = JSON.parse(readFileSync(REFERENCE_MANIFEST_PATH, 'utf8')) as ReferenceManifest;
writeFileSync(REFERENCE_ENVELOPE_PATH, `${JSON.stringify({
  schemaVersion: manifest.schemaVersion,
  scope: manifest.scope,
  measurementPolicy: manifest.measurementPolicy,
  familyEnvelopes: manifest.familyEnvelopes,
}, null, 2)}\n`);
writeFileSync(MANUAL_REVIEW_PATH, [
  'reference_id,title,url,evidence,confidence,review_status,reviewer_notes',
  ...manifest.references.map((reference) =>
    [
      reference.id,
      JSON.stringify(reference.title),
      reference.url,
      reference.evidence,
      reference.confidence,
      reference.id === 'REF-A' ? 'reviewed' : 'family-anchor',
      '',
    ].join(',')),
  '',
].join('\n'));

const beforeBaseline = {
  schemaVersion: 1,
  status: 'frozen-pre-v2-baseline',
  source: 'LOFI-HIPHOP-ARRANGEMENT-V1 200-seed audit captured before V2 implementation',
  sampleCount: 200,
  limitation: 'The V1 audit did not yet expose final kick density, auxiliary-loop, voicing or Pad metrics; those fields remain null rather than being fabricated.',
  metrics: {
    tempoBpm: { min: 71, max: 85 },
    corePhraseCoverageMean: 0.878,
    uniqueOneBarSignatureRatioMean: 0.091,
    structuralMutationBarRatioMean: 0.122,
    backbeatCoverageMean: 1,
    shortHarmonyRate: 0.8,
    leadPlannedActiveBarCoverageMean: 0.388,
    kickHitsPerBar: null,
    auxiliaryHitsPerBar: null,
    compVoiceLeading: null,
    padVoiceLeading: null,
  },
};
writeFileSync(BEFORE_PATH, `${JSON.stringify(beforeBaseline, null, 2)}\n`);

const rows: FoundationAuditRow[] = [];
for (let seed = 0; seed < SEED_COUNT; seed++) {
  const bundle = buildSongBundle({
    seed,
    styleHint: 'lofi',
    mood: 'build',
    targetDuration: 120,
    key: pc(0),
  });
  const result = generateSongFromBundle(bundle);
  if (!result.ir || result.status === 'failed') {
    throw new Error(
      `LOFI seed ${seed} failed generation: ${result.report.findings.map((finding) => finding.ruleId).join(',')}`,
    );
  }
  rows.push(auditSong(bundle, result.ir, result.status, seed, manifest.familyEnvelopes));
}

const archetypeCounts = Object.fromEntries([...new Set(rows.map((row) => row.archetypeId))]
  .map((id) => [id, rows.filter((row) => row.archetypeId === id).length]));
const phraseCounts = Object.fromEntries([...new Set(rows.map((row) => row.drumPhraseId))]
  .map((id) => [id, rows.filter((row) => row.drumPhraseId === id).length]));
const harmonicPrototypeCounts = Object.fromEntries([...new Set(rows.map((row) => row.harmonicPrototypeId))]
  .map((id) => [id, rows.filter((row) => row.harmonicPrototypeId === id).length]));
const foundationCombinationCounts = Object.fromEntries([
  ...new Set(rows.map((row) =>
    `${row.archetypeId}|${row.drumPhraseId}|${row.topLoopId ?? 'none'}|${row.harmonicPrototypeId}`)),
].map((id) => [id, rows.filter((row) =>
  `${row.archetypeId}|${row.drumPhraseId}|${row.topLoopId ?? 'none'}|${row.harmonicPrototypeId}` === id).length]));
const selectedPhrases = Object.keys(phraseCounts)
  .map((id) => lofiDrumPhraseById(id))
  .filter((phrase): phrase is NonNullable<ReturnType<typeof lofiDrumPhraseById>> => !!phrase);
const distinctTwoBarKickMasks = new Set(selectedPhrases.map((phrase) =>
  phrase.bars
    .map((bar) => bar
      .filter((hit) => hit.drum === DRUM.KICK)
      .map((hit) => hit.beat.toFixed(3))
      .join(','))
    .join('|'))).size;
const auxiliaryIdentities = new Set(rows
  .map((row) => row.topLoopId)
  .filter((id): id is string => !!id));
const expectedWeights: Record<string, number> = {
  'slow-soul-boombap': 0.6,
  'dusty-dilla-boombap': 0.2,
  'slow-soul-halftime': 0.12,
  'ambient-study-boombap': 0.08,
};
const archetypeDistributionError = Math.max(...Object.entries(expectedWeights).map(([id, expected]) =>
  Math.abs((archetypeCounts[id] ?? 0) / rows.length - expected)));

const summary = {
  tempoBpm: metric(rows, (row) => row.tempoBpm),
  corePhraseCoverage: metric(rows, (row) => row.corePhraseCoverage),
  structuralMutationBarRatio: metric(rows, (row) => row.structuralMutationBarRatio),
  kickHitsPerBar: metric(rows, (row) => row.kickHitsPerBar),
  kickSyncopationRatio: metric(rows, (row) => row.kickSyncopationRatio),
  backbeatCoverage: metric(rows, (row) => row.backbeatCoverage),
  beatOneKickCoverage: metric(rows, (row) => row.beatOneKickCoverage),
  hatDownbeatVelocityContrast: metric(rows, (row) => row.hatDownbeatVelocityContrast),
  auxiliaryHitsPerBar: metric(rows, (row) => row.auxiliaryHitsPerBar),
  finalDrumPlanProvenance: metric(rows, (row) => row.finalDrumPlanProvenance),
  harmonicPeriodChords: metric(rows, (row) => row.harmonicPeriodChords),
  extendedHarmonyCoverage: metric(rows, (row) => row.extendedHarmonyCoverage),
  bassOnsetsPerBar: metric(rows, (row) => row.bassOnsetsPerBar),
  bassKickCoincidence: metric(rows, (row) => row.bassKickCoincidence),
  compAttacksPerBar: metric(rows, (row) => row.compAttacksPerBar),
  compVoicesPerAttack: metric(rows, (row) => row.compVoicesPerAttack),
  compMeanVoiceMovement: metric(rows, (row) => row.compVoiceLeading.meanMovement),
  compP95VoiceMovement: metric(rows, (row) => row.compVoiceLeading.p95Movement),
  compTopVoiceJumpP95: metric(rows, (row) => row.compVoiceLeading.topVoiceJumpP95),
  padAttacksPerBar: metric(rows, (row) => row.padAttacksPerBar),
  padVoicesPerAttack: metric(rows, (row) => row.padVoicesPerAttack),
  padSustainCoverage: metric(rows, (row) => row.padSustainCoverage),
  padMeanVoiceMovement: metric(rows, (row) => row.padVoiceLeading.meanMovement),
  leadActiveBarCoverage: metric(rows, (row) => row.leadActiveBarCoverage),
  leadNotesPerActiveBar: metric(rows, (row) => row.leadNotesPerActiveBar),
  foundationLeadCollisionRate: metric(rows, (row) => row.foundationLeadCollisionRate),
  referenceEnvelopeDistance: metric(rows, (row) => row.referenceEnvelopeDistance),
};
const withoutRefAFamilies = manifest.familyEnvelopes.filter((family) =>
  family.referenceIds.some((id) => id !== 'REF-A'));
const leaveRefAMatchRate = rows.filter((row) =>
  Math.min(...withoutRefAFamilies.map((family) => referenceDistance(row, family))) <= 0.35)
  .length / rows.length;
const maximumPhraseShare = Math.max(...Object.values(phraseCounts)) / rows.length;
const maximumHarmonicPrototypeShare = Math.max(...Object.values(harmonicPrototypeCounts)) / rows.length;
const maximumFoundationCombinationShare =
  Math.max(...Object.values(foundationCombinationCounts)) / rows.length;
const shortHarmonyRate = rows.filter((row) =>
  row.harmonicPeriodChords >= 2 && row.harmonicPeriodChords <= 4).length / rows.length;
const extendedHarmonyMajorityRate = rows.filter((row) =>
  row.extendedHarmonyCoverage >= 0.75).length / rows.length;
const compTopVoiceJumpPopulationP95 = quantile(
  rows.map((row) => row.compVoiceLeading.topVoiceJumpP95)
    .filter((value): value is number => value !== null),
  0.95,
);

const hardGates = {
  allGenerated: rows.length === SEED_COUNT && rows.every((row) => row.generationStatus !== 'failed'),
  planTraceability: rows.every((row) => row.planTraceable),
  archetypeCoverage: Object.keys(expectedWeights).every((id) => (archetypeCounts[id] ?? 0) > 0),
  archetypeDistribution: archetypeDistributionError <= 0.08,
  boomBapBackbeat: rows.every((row) => row.backbeatCoverage === 1),
  beatOneKick: rows.every((row) => row.beatOneKickCoverage === 1),
  sparseKick: (summary.kickHitsPerBar.mean ?? 99) >= 1.25
    && (summary.kickHitsPerBar.mean ?? 99) <= 3.25
    && (summary.kickHitsPerBar.p90 ?? 99) <= 4,
  phrasePeriod: rows.every((row) =>
    row.coreDrumPeriodBars <= 2 && row.combinedDrumPeriodBars <= 4),
  vocabularyDiversity: distinctTwoBarKickMasks >= 16 && auxiliaryIdentities.size >= 4,
  noDominantExactIdentity: maximumPhraseShare <= 0.2
    && maximumHarmonicPrototypeShare <= 0.2
    && maximumFoundationCombinationShare <= 0.2,
  mutationBudget: rows.every((row) => row.structuralMutationBarRatio <= 0.125),
  noRendererBoundaryFill: rows.every((row) => row.boundaryCount === 0),
  finalDrumProvenance: rows.every((row) => row.finalDrumPlanProvenance >= 0.98),
  // Short Soul/Jazz cells remain the center of gravity, not an exclusive
  // allow-list. The complete pre-existing LOFI pool and the Clark-derived
  // additions are all ordinary candidates, including a minority of 8-bar
  // identities.
  shortExtendedHarmony: shortHarmonyRate >= 0.7
    && extendedHarmonyMajorityRate >= 0.75
    && (summary.extendedHarmonyCoverage.mean ?? 0) >= 0.75
    && rows.every((row) =>
      // A one-chord third-bass/pedal vamp is a documented low-energy pool
      // member, not a failed loop. It remains a minority because the 2–4
      // chord population gate above still has to pass.
      row.harmonicPeriodChords >= 1
      && row.harmonicPeriodChords <= 8),
  compVoiceLeading: (summary.compMeanVoiceMovement.p90 ?? 99) <= 6
    && (compTopVoiceJumpPopulationP95 ?? 99) <= 7
    && rows.every((row) => row.compVoiceLeading.crossingCount === 0),
  padEconomy: (summary.padVoicesPerAttack.p90 ?? 99) <= 3
    && (summary.padAttacksPerBar.p90 ?? 99) <= 2,
  leadSpace: rows.every((row) =>
    row.leadActiveBarCoverage >= 0.2
    && row.leadActiveBarCoverage <= 0.5
    && row.longestPlannedLeadRestBars >= 4),
  roleCollision: (summary.foundationLeadCollisionRate.p90 ?? 99) <= 0.2,
  referenceFamilyMatch: rows.filter((row) => row.referenceEnvelopeDistance <= 0.35).length
    / rows.length >= 0.95,
  leaveRefAOut: leaveRefAMatchRate >= 0.95,
};

const reviewSeeds = selectReviewSeeds(rows);
const selectedReviewDirs = new Set(reviewSeeds.map((seed) => `seed-${seed}`));
for (const entry of readdirSync(REVIEW_DIR, { withFileTypes: true })) {
  if (
    entry.isDirectory()
    && /^seed-\d+$/.test(entry.name)
    && !selectedReviewDirs.has(entry.name)
  ) {
    rmSync(resolve(REVIEW_DIR, entry.name), { recursive: true });
  }
}
for (const seed of reviewSeeds) {
  exportReviewSeed(seed, rows.find((row) => row.seed === seed)!);
}

const after = {
  schemaVersion: 1,
  scope: manifest.scope,
  seedCount: SEED_COUNT,
  archetypeCounts,
  phraseCounts,
  harmonicPrototypeCounts,
  foundationCombinationCounts,
  distinctTwoBarKickMasks,
  auxiliaryIdentities: [...auxiliaryIdentities].sort(),
  maximumPhraseShare: round(maximumPhraseShare),
  maximumHarmonicPrototypeShare: round(maximumHarmonicPrototypeShare),
  maximumFoundationCombinationShare: round(maximumFoundationCombinationShare),
  compTopVoiceJumpPopulationP95: round(compTopVoiceJumpPopulationP95),
  leaveRefAMatchRate: round(leaveRefAMatchRate),
  archetypeDistributionError: round(archetypeDistributionError),
  hardGates,
  summary,
  reviewSeeds,
  rows,
};
writeFileSync(AFTER_PATH, `${JSON.stringify(after, null, 2)}\n`);

const nearestCounts = Object.fromEntries([...new Set(rows.map((row) => row.nearestReferenceFamily))]
  .map((id) => [id, rows.filter((row) => row.nearestReferenceFamily === id).length]));
const lines = [
  '# LOFI Hip Hop Musical Foundation V2 — 500-seed comparison',
  '',
  `Scope: ${manifest.scope}`,
  '',
  `Generated seeds: **${SEED_COUNT}**. Review pack: \`${REVIEW_DIR}/seed-*/\`.`,
  '',
  '## Outcome',
  '',
  '| Gate | Result | Evidence |',
  '|---|---|---|',
  `| One traceable song-level FoundationPlan | ${hardGates.planTraceability ? 'PASS' : 'FAIL'} | ${rows.filter((row) => row.planTraceable).length}/${rows.length} |`,
  `| Four archetypes covered and weighted | ${hardGates.archetypeCoverage && hardGates.archetypeDistribution ? 'PASS' : 'FAIL'} | ${Object.entries(archetypeCounts).map(([id, count]) => `${id}=${count}`).join(', ')} |`,
  `| 2/4 or declared half-time backbeat | ${hardGates.boomBapBackbeat ? 'PASS' : 'FAIL'} | mean ${pct(summary.backbeatCoverage.mean)} |`,
  `| Beat-one Kick anchor | ${hardGates.beatOneKick ? 'PASS' : 'FAIL'} | mean ${pct(summary.beatOneKickCoverage.mean)} |`,
  `| Sparse Kick grammar | ${hardGates.sparseKick ? 'PASS' : 'FAIL'} | mean ${num(summary.kickHitsPerBar.mean)}; p90 ${num(summary.kickHitsPerBar.p90)} hits/bar |`,
  `| Two-bar core / four-bar combined drum period | ${hardGates.phrasePeriod ? 'PASS' : 'FAIL'} | core p90 ${num(metric(rows, (row) => row.coreDrumPeriodBars).p90)}; combined p90 ${num(metric(rows, (row) => row.combinedDrumPeriodBars).p90)} bars |`,
  `| Drum/Top vocabulary diversity | ${hardGates.vocabularyDiversity ? 'PASS' : 'FAIL'} | ${distinctTwoBarKickMasks} two-bar Kick masks; ${auxiliaryIdentities.size} TopLoop identities |`,
  `| No exact identity dominates >20% | ${hardGates.noDominantExactIdentity ? 'PASS' : 'FAIL'} | phrase ${pct(maximumPhraseShare)}; harmony ${pct(maximumHarmonicPrototypeShare)}; full combination ${pct(maximumFoundationCombinationShare)} |`,
  `| Arranger mutation budget | ${hardGates.mutationBudget ? 'PASS' : 'FAIL'} | mean ${pct(summary.structuralMutationBarRatio.mean)} |`,
  `| No renderer boundary fill | ${hardGates.noRendererBoundaryFill ? 'PASS' : 'FAIL'} | boundary count ${rows.reduce((sum, row) => sum + row.boundaryCount, 0)} |`,
  `| Final drum notes trace to score | ${hardGates.finalDrumProvenance ? 'PASS' : 'FAIL'} | p10 ${pct(summary.finalDrumPlanProvenance.p10)} |`,
  `| Pooled Soul/Jazz harmony (short/extended remain the majority) | ${hardGates.shortExtendedHarmony ? 'PASS' : 'FAIL'} | short ${pct(shortHarmonyRate)}; period median ${num(summary.harmonicPeriodChords.median)}; extended mean ${pct(summary.extendedHarmonyCoverage.mean)}; ≥75% extended rows ${pct(extendedHarmonyMajorityRate)} |`,
  `| Comp one-to-one voice leading | ${hardGates.compVoiceLeading ? 'PASS' : 'FAIL'} | movement p90 ${num(summary.compMeanVoiceMovement.p90)} semitones; top-jump population p95 ${num(compTopVoiceJumpPopulationP95)} |`,
  `| Economical Pad | ${hardGates.padEconomy ? 'PASS' : 'FAIL'} | voices/attack p90 ${num(summary.padVoicesPerAttack.p90)}; attacks/bar p90 ${num(summary.padAttacksPerBar.p90)} |`,
  `| Lead consumes planned space | ${hardGates.leadSpace ? 'PASS' : 'FAIL'} | active bars median ${pct(summary.leadActiveBarCoverage.median)} |`,
  `| Foundation/Lead collisions controlled | ${hardGates.roleCollision ? 'PASS' : 'FAIL'} | collision p90 ${pct(summary.foundationLeadCollisionRate.p90)} |`,
  `| Nearest reference-family envelope | ${hardGates.referenceFamilyMatch ? 'PASS' : 'FAIL'} | distance p90 ${num(summary.referenceEnvelopeDistance.p90, 3)} |`,
  `| Leave REF-A out | ${hardGates.leaveRefAOut ? 'PASS' : 'FAIL'} | ${pct(leaveRefAMatchRate)} still match another family envelope |`,
  '',
  '## Musical distribution',
  '',
  `- Kick: ${num(summary.kickHitsPerBar.mean)} hits/bar average; syncopated share ${pct(summary.kickSyncopationRatio.mean)}.`,
  `- Hat downbeat/offbeat velocity contrast: ${num(summary.hatDownbeatVelocityContrast.mean)} MIDI velocity points.`,
  `- Auxiliary percussion: ${num(summary.auxiliaryHitsPerBar.mean)} hits/bar across the whole seed distribution.`,
  `- Bass: ${num(summary.bassOnsetsPerBar.mean)} onsets/bar; Kick coincidence ${pct(summary.bassKickCoincidence.mean)}.`,
  `- Comp: ${num(summary.compAttacksPerBar.mean)} attacks/bar, ${num(summary.compVoicesPerAttack.mean)} voices/attack.`,
  `- Pad: ${num(summary.padAttacksPerBar.mean)} attacks/bar, sustain coverage ${pct(summary.padSustainCoverage.mean)}.`,
  `- Lead: ${pct(summary.leadActiveBarCoverage.mean)} active bars, ${num(summary.leadNotesPerActiveBar.mean)} notes per active bar.`,
  '',
  '## Reference-family comparison',
  '',
  `Nearest-family counts: ${Object.entries(nearestCounts).map(([id, count]) => `${id}=${count}`).join(', ')}.`,
  '',
  'REF-A is the high-confidence structural anchor. REF-B–G are deliberately broad family anchors; uncertain audio-derived values remain null and are not hard gates.',
  '',
  '## Before / after',
  '',
  '| Metric | V1 before | V2 after |',
  '|---|---:|---:|',
  `| Core phrase coverage | ${pct(beforeBaseline.metrics.corePhraseCoverageMean)} | ${pct(summary.corePhraseCoverage.mean)} |`,
  `| Structural mutation bars | ${pct(beforeBaseline.metrics.structuralMutationBarRatioMean)} | ${pct(summary.structuralMutationBarRatio.mean)} |`,
  `| Backbeat coverage | ${pct(beforeBaseline.metrics.backbeatCoverageMean)} | ${pct(summary.backbeatCoverage.mean)} |`,
  `| 2–4 chord loop rate | ${pct(beforeBaseline.metrics.shortHarmonyRate)} | ${pct(shortHarmonyRate)} |`,
  `| Lead active bars | ${pct(beforeBaseline.metrics.leadPlannedActiveBarCoverageMean)} planned | ${pct(summary.leadActiveBarCoverage.mean)} audible |`,
  `| Final drum score provenance | not measured | ${pct(summary.finalDrumPlanProvenance.mean)} |`,
  `| Comp mean voice movement | not measured | ${num(summary.compMeanVoiceMovement.mean)} semitones |`,
  `| Pad voices/attack | not measured | ${num(summary.padVoicesPerAttack.mean)} |`,
  '',
  '## Review pack',
  '',
  `Seeds: ${reviewSeeds.join(', ')}.`,
  '',
  'Each seed contains four MIDI layers plus `arrangement-log.json`, `feature-comparison.json`, and a blind `review.md` sheet.',
  '',
];
writeFileSync(REPORT_PATH, lines.join('\n'));

if (Object.values(hardGates).some((passed) => !passed)) {
  throw new Error(`LOFI Musical Foundation hard gate failed: ${JSON.stringify(hardGates)}`);
}

console.log(`LOFI Musical Foundation audit: ${SEED_COUNT} seeds`);
console.log(`Report: ${REPORT_PATH}`);
console.log(`Review MIDI: ${REVIEW_DIR}`);
