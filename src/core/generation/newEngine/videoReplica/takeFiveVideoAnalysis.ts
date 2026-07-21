// ============================================================
// Take Five video · provisional analytical sidecar
// ------------------------------------------------------------
// This may describe sections, harmony and nominal metre, but the replica
// compiler never imports or receives it. Analysis cannot rewrite the score.
// ============================================================

import { deepFreeze, type DeepReadonly } from '../foundation';
import type { VideoReplicaRole } from './VideoReplicaScore';

export interface VideoReplicaSectionAnnotation {
  id: string;
  startTick: number;
  endTick: number;
  activeRoles: readonly VideoReplicaRole[];
}

export interface VideoReplicaHarmonyAnnotation {
  id: string;
  label: string;
  romanLabel: string;
  startTick: number;
  rootPc: number;
  quality: string;
}

export interface VideoReplicaAnalysisData {
  scoreId: string;
  analysisRevision: string;
  status: 'provisional' | 'confirmed';
  key: { tonic: 'E'; mode: 'minor' };
  metric: {
    meter: readonly [5, 4];
    beatGrouping: readonly [3, 2];
    nominalSubdivisionTicks: 120;
    barOriginTick: 0;
    barOriginEvidence: 'cross-boundary-anticipations-sustain-through-nominal-barlines';
  };
  audioAlignment: {
    evidenceTickZeroAtVideoSeconds: 1.547;
    fittedTickZeroAtVideoSeconds: 1.536858;
    equivalentBpm: 199.887;
    residualAtPerformed15SecondsMs: -1.66;
    status: 'provisional-waveform-audit';
  };
  observedHandoff: {
    boundaryTick: 24_000;
    lastBassAttackTick: 23_924;
    firstCompAttackTick: 24_722;
    policy: 'onset-owned-sections-with-cross-boundary-tails';
  };
  vampHarmony: {
    startTick: 0;
    endTick: 36_000;
    status: 'needs-event-level-curation';
    hypotheses: readonly ['Em9', 'Bm7'];
  };
  sections: readonly VideoReplicaSectionAnnotation[];
  harmony: readonly VideoReplicaHarmonyAnnotation[];
}

export type VideoReplicaAnalysis = DeepReadonly<VideoReplicaAnalysisData>;

export const TAKE_FIVE_VIDEO_ANALYSIS: VideoReplicaAnalysis = deepFreeze({
  scoreId: 'take-five-video-piano-v1',
  analysisRevision: 'v1-provisional-from-video-labels-and-first-raw-events',
  status: 'provisional' as const,
  key: { tonic: 'E' as const, mode: 'minor' as const },
  metric: {
    meter: [5, 4] as const,
    beatGrouping: [3, 2] as const,
    nominalSubdivisionTicks: 120 as const,
    barOriginTick: 0 as const,
    barOriginEvidence: 'cross-boundary-anticipations-sustain-through-nominal-barlines' as const,
  },
  // A/B transport alignment only; it never shifts performed score ticks.
  audioAlignment: {
    evidenceTickZeroAtVideoSeconds: 1.547 as const,
    fittedTickZeroAtVideoSeconds: 1.536858 as const,
    equivalentBpm: 199.887 as const,
    residualAtPerformed15SecondsMs: -1.66 as const,
    status: 'provisional-waveform-audit' as const,
  },
  observedHandoff: {
    boundaryTick: 24_000 as const,
    lastBassAttackTick: 23_924 as const,
    firstCompAttackTick: 24_722 as const,
    policy: 'onset-owned-sections-with-cross-boundary-tails' as const,
  },
  // Do not repeat the old error of presenting bars 1-15 as one static Em9.
  // The candidate Em9/Bm7 motion must be curated from the performed events.
  vampHarmony: {
    startTick: 0 as const,
    endTick: 36_000 as const,
    status: 'needs-event-level-curation' as const,
    hypotheses: ['Em9', 'Bm7'] as const,
  },
  sections: [
    { id: 'statement_bass_lead', startTick: 0, endTick: 24_000, activeRoles: ['bass', 'lead'] },
    { id: 'statement_comp_lead', startTick: 24_000, endTick: 36_000, activeRoles: ['comp', 'lead'] },
    { id: 'reharm_comp_lead', startTick: 36_000, endTick: 85_860, activeRoles: ['comp', 'lead'] },
  ],
  harmony: [
    { id: 'h01', label: 'Bb7#11', romanLabel: 'bV7#11', startTick: 36_000, rootPc: 10, quality: '7' },
    { id: 'h02', label: 'Cmaj7', romanLabel: 'VImaj7', startTick: 38_400, rootPc: 0, quality: 'maj7' },
    { id: 'h03', label: 'Am7', romanLabel: 'iv7', startTick: 40_320, rootPc: 9, quality: 'm7' },
    { id: 'h04', label: 'Bm7', romanLabel: 'v7', startTick: 41_280, rootPc: 11, quality: 'm7' },
    { id: 'h05', label: 'E7', romanLabel: 'I7', startTick: 42_240, rootPc: 4, quality: '7' },
    { id: 'h06', label: 'Am7', romanLabel: 'iv7', startTick: 43_200, rootPc: 9, quality: 'm7' },
    { id: 'h07', label: 'D7', romanLabel: 'VII7', startTick: 45_120, rootPc: 2, quality: '7' },
    { id: 'h08', label: 'Gmaj7', romanLabel: 'IIImaj7', startTick: 46_080, rootPc: 7, quality: 'maj7' },
    { id: 'h09', label: 'Ab7', romanLabel: '#III7', startTick: 47_040, rootPc: 8, quality: '7' },
    { id: 'h10', label: 'Cmaj7', romanLabel: 'VImaj7', startTick: 48_000, rootPc: 0, quality: 'maj7' },
    { id: 'h11', label: 'Am7', romanLabel: 'iv7', startTick: 49_440, rootPc: 9, quality: 'm7' },
    { id: 'h12', label: 'Bm7', romanLabel: 'v7', startTick: 50_400, rootPc: 11, quality: 'm7' },
    { id: 'h13', label: 'E7', romanLabel: 'I7', startTick: 51_840, rootPc: 4, quality: '7' },
    { id: 'h14', label: 'Am7', romanLabel: 'iv7', startTick: 52_800, rootPc: 9, quality: 'm7' },
    { id: 'h15', label: 'D7', romanLabel: 'VII7', startTick: 54_240, rootPc: 2, quality: '7' },
    { id: 'h16', label: 'F#m7b5', romanLabel: 'iiø7', startTick: 55_200, rootPc: 6, quality: 'm7b5' },
    { id: 'h17', label: 'B7#11', romanLabel: 'V7#11', startTick: 56_640, rootPc: 11, quality: '7' },
    { id: 'h18', label: 'Em', romanLabel: 'i', startTick: 58_080, rootPc: 4, quality: 'min' },
    { id: 'h19', label: 'Em/D#', romanLabel: 'i/D#', startTick: 59_040, rootPc: 4, quality: 'min' },
    { id: 'h20', label: 'Dm9', romanLabel: 'vii9', startTick: 60_000, rootPc: 2, quality: 'm7' },
    { id: 'h21', label: 'D/C#', romanLabel: 'VII/C#', startTick: 61_440, rootPc: 2, quality: 'maj' },
    { id: 'h22', label: 'Am7', romanLabel: 'iv7', startTick: 62_400, rootPc: 9, quality: 'm7' },
    { id: 'h23', label: 'G/B', romanLabel: 'III/B', startTick: 63_840, rootPc: 7, quality: 'maj' },
    { id: 'h24', label: 'C#m7', romanLabel: '#vi7', startTick: 64_800, rootPc: 1, quality: 'm7' },
    { id: 'h25', label: 'Em', romanLabel: 'i', startTick: 67_200, rootPc: 4, quality: 'min' },
    { id: 'h26', label: 'Em/D#', romanLabel: 'i/D#', startTick: 68_160, rootPc: 4, quality: 'min' },
    { id: 'h27', label: 'Aadd2/C#', romanLabel: 'IVadd2/C#', startTick: 69_600, rootPc: 9, quality: 'maj' },
    { id: 'h28', label: 'C6', romanLabel: 'VI6', startTick: 70_560, rootPc: 0, quality: 'maj' },
    { id: 'h29', label: 'Am7', romanLabel: 'iv7', startTick: 72_000, rootPc: 9, quality: 'm7' },
    { id: 'h30', label: 'Bm7', romanLabel: 'v7', startTick: 72_960, rootPc: 11, quality: 'm7' },
    { id: 'h31', label: 'Fmaj9', romanLabel: 'bIImaj9', startTick: 73_920, rootPc: 5, quality: 'maj7' },
  ],
});
