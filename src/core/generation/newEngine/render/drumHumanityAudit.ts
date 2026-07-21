import type { GrooveScorePlan } from '../arranger/ArrangementPlan';
import type { NoteIR } from '../ir/MusicalIR';
import {
  rhythmSwingSourceForContract,
  type GrooveContract,
} from '../knowledge/grooveContracts';
import { tempoAwareJazzSwingRatio } from '../knowledge/drumPerformanceKnowledge';
import { swingBeat } from './swing';

export type DrumAuditVoice = 'kick' | 'snare' | 'hat' | 'ride' | 'tom' | 'crash' | 'percussion';

export interface DrumVoiceAudit {
  count: number;
  velocityMin: number;
  velocityMax: number;
  velocityMean: number;
  velocityStdDev: number;
  uniqueVelocities: number;
  repeatedVelocityRatio: number;
  timingOffsetMeanMs: number;
  timingOffsetStdDevMs: number;
  exactGridRatio: number;
}

export interface DrumHumanityAudit {
  noteCount: number;
  barCount: number;
  voicedKitPieces: DrumAuditVoice[];
  rhythmSignatureCount: number;
  performanceSignatureCount: number;
  repeatedRhythmBarRatio: number;
  repeatedPerformanceBarRatio: number;
  snareAccentGhostSeparation: number | null;
  voices: Partial<Record<DrumAuditVoice, DrumVoiceAudit>>;
}

export interface DrumHumanityAuditOptions {
  notes: readonly NoteIR[];
  ppq: number;
  beatsPerBar: number;
  tempoBpm: number;
  scorePlan: Readonly<GrooveScorePlan>;
  contractBySection: Readonly<Record<string, DrumAuditGrooveContract>>;
}

type DrumAuditGrooveContract = Readonly<Pick<
  GrooveContract,
  'grid' | 'rhythmSwingSource' | 'compSwingRatio' | 'swingCurve'
>>;

interface AuditedHit {
  note: Readonly<NoteIR>;
  voice: DrumAuditVoice;
  absoluteBar: number;
  beatInBar: number;
  timingOffsetMs: number;
}

const PITCH_VOICE: Readonly<Record<number, DrumAuditVoice>> = {
  35: 'kick', 36: 'kick',
  37: 'snare', 38: 'snare', 39: 'snare', 40: 'snare',
  42: 'hat', 44: 'hat', 46: 'hat',
  51: 'ride', 53: 'ride', 59: 'ride',
  41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom', 58: 'tom',
  49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash',
};

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const stdDev = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

function repeatedAdjacentRatio(values: readonly number[]): number {
  if (values.length < 2) return 0;
  let repeated = 0;
  for (let index = 1; index < values.length; index++) {
    if (values[index] === values[index - 1]) repeated += 1;
  }
  return repeated / (values.length - 1);
}

function repeatRatio(signatures: readonly string[]): number {
  if (signatures.length === 0) return 0;
  return 1 - new Set(signatures).size / signatures.length;
}

function expectedGridTick(
  tick: number,
  absoluteBar: number,
  ppq: number,
  beatsPerBar: number,
  tempoBpm: number,
  scorePlan: Readonly<GrooveScorePlan>,
  contractBySection: Readonly<Record<string, DrumAuditGrooveContract>>,
): number {
  const score = Object.values(scorePlan.bySection)
    .flatMap((section) => section.bars)
    .find((bar) => bar.absoluteBar === absoluteBar);
  if (!score) return Math.round(tick / Math.max(1, ppq / 8)) * Math.max(1, ppq / 8);
  const contract = contractBySection[score.sectionId];
  if (!contract) return tick;

  // Jazz comp-follow may legally combine a triplet ride grid with swung
  // sixteenth comping. Twelve is their common grid; eight covers 32nd rolls.
  // This measures performance displacement, not authored cross-grid rhythm.
  const stepsPerBeat = score.subdivision === 'triplet' ? 12 : 8;
  const source = rhythmSwingSourceForContract(contract);
  const swingRatio = contract.swingCurve === 'jazz-tempo'
    ? tempoAwareJazzSwingRatio(contract.compSwingRatio, tempoBpm)
    : contract.compSwingRatio;
  const barStartBeat = absoluteBar * beatsPerBar;
  const candidates: number[] = [];
  for (let index = 0; index <= beatsPerBar * stepsPerBeat; index++) {
    const authoredBeat = barStartBeat + index / stepsPerBeat;
    const performedBeat = swingBeat(authoredBeat, swingRatio, source);
    candidates.push(Math.round(performedBeat * ppq));
  }
  const boundary = scorePlan.boundaries.find((candidate) => candidate.sourceBar === absoluteBar);
  for (const fillHit of boundary?.fillScore?.hits ?? []) {
    const authoredBeat = barStartBeat + beatsPerBar + fillHit.offsetBeatsFromEnd;
    candidates.push(Math.round(swingBeat(authoredBeat, swingRatio, source) * ppq));
  }
  return candidates.reduce((nearest, candidate) =>
    Math.abs(candidate - tick) < Math.abs(nearest - tick) ? candidate : nearest, candidates[0] ?? tick);
}

function scoreByAbsoluteBar(scorePlan: Readonly<GrooveScorePlan>): Map<number, Readonly<GrooveScorePlan['bySection'][string]['bars'][number]>> {
  const out = new Map<number, Readonly<GrooveScorePlan['bySection'][string]['bars'][number]>>();
  for (const section of Object.values(scorePlan.bySection)) {
    for (const bar of section.bars) out.set(bar.absoluteBar, bar);
  }
  return out;
}

function isStructuralSnare(
  hit: AuditedHit,
  score: Readonly<GrooveScorePlan['bySection'][string]['bars'][number]> | undefined,
  ppq: number,
  beatsPerBar: number,
  tempoBpm: number,
  contract: DrumAuditGrooveContract | undefined,
): boolean {
  if (!score?.drumInteraction || !contract) return false;
  const source = rhythmSwingSourceForContract(contract);
  const swingRatio = contract.swingCurve === 'jazz-tempo'
    ? tempoAwareJazzSwingRatio(contract.compSwingRatio, tempoBpm)
    : contract.compSwingRatio;
  const absoluteBarBeat = hit.absoluteBar * beatsPerBar;
  return score.drumInteraction.structuralSnareBeats.some((beat) => {
    const performed = swingBeat(absoluteBarBeat + beat, swingRatio, source) - absoluteBarBeat;
    return Math.abs(hit.beatInBar - performed) <= Math.max(0.08, 18 / ppq);
  });
}

export function auditDrumHumanity(options: DrumHumanityAuditOptions): DrumHumanityAudit {
  const { notes, ppq, beatsPerBar, tempoBpm, scorePlan, contractBySection } = options;
  const barTicks = ppq * beatsPerBar;
  const scoreByBar = scoreByAbsoluteBar(scorePlan);
  const hits: AuditedHit[] = [...notes]
    .sort((a, b) => (a.startTick as number) - (b.startTick as number) || (a.pitch as number) - (b.pitch as number))
    .map((note) => {
      const tick = note.startTick as number;
      const absoluteBar = Math.max(0, Math.floor((tick + 1) / barTicks));
      const expected = expectedGridTick(tick, absoluteBar, ppq, beatsPerBar, tempoBpm, scorePlan, contractBySection);
      return {
        note,
        voice: PITCH_VOICE[note.pitch as number] ?? 'percussion',
        absoluteBar,
        beatInBar: (tick - absoluteBar * barTicks) / ppq,
        timingOffsetMs: ((tick - expected) / ppq) * (60_000 / tempoBpm),
      };
    });

  const barCount = Math.max(0, ...hits.map((hit) => hit.absoluteBar + 1));
  const rhythmByBar: string[] = [];
  const performanceByBar: string[] = [];
  for (let bar = 0; bar < barCount; bar++) {
    const barHits = hits.filter((hit) => hit.absoluteBar === bar);
    rhythmByBar.push(barHits.map((hit) => `${hit.note.pitch}@${hit.beatInBar.toFixed(3)}`).join('|'));
    performanceByBar.push(barHits.map((hit) => `${hit.note.pitch}@${hit.beatInBar.toFixed(3)}:${hit.note.velocity}`).join('|'));
  }

  const voices: Partial<Record<DrumAuditVoice, DrumVoiceAudit>> = {};
  const presentVoices = [...new Set(hits.map((hit) => hit.voice))].sort() as DrumAuditVoice[];
  for (const voice of presentVoices) {
    const voiceHits = hits.filter((hit) => hit.voice === voice);
    const velocities = voiceHits.map((hit) => hit.note.velocity);
    const timing = voiceHits.map((hit) => hit.timingOffsetMs);
    voices[voice] = {
      count: voiceHits.length,
      velocityMin: Math.min(...velocities),
      velocityMax: Math.max(...velocities),
      velocityMean: mean(velocities),
      velocityStdDev: stdDev(velocities),
      uniqueVelocities: new Set(velocities).size,
      repeatedVelocityRatio: repeatedAdjacentRatio(velocities),
      timingOffsetMeanMs: mean(timing),
      timingOffsetStdDevMs: stdDev(timing),
      exactGridRatio: timing.filter((value) => Math.abs(value) <= 1).length / timing.length,
    };
  }

  const structuralSnare: number[] = [];
  const ghostSnare: number[] = [];
  for (const hit of hits.filter((candidate) => candidate.voice === 'snare')) {
    const score = scoreByBar.get(hit.absoluteBar);
    const contract = score ? contractBySection[score.sectionId] : undefined;
    (isStructuralSnare(hit, score, ppq, beatsPerBar, tempoBpm, contract) ? structuralSnare : ghostSnare)
      .push(hit.note.velocity);
  }

  return {
    noteCount: hits.length,
    barCount,
    voicedKitPieces: presentVoices,
    rhythmSignatureCount: new Set(rhythmByBar).size,
    performanceSignatureCount: new Set(performanceByBar).size,
    repeatedRhythmBarRatio: repeatRatio(rhythmByBar),
    repeatedPerformanceBarRatio: repeatRatio(performanceByBar),
    snareAccentGhostSeparation: structuralSnare.length > 0 && ghostSnare.length > 0
      ? mean(structuralSnare) - mean(ghostSnare)
      : null,
    voices,
  };
}
