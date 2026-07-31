// ============================================================
// leadTakeoverSandbox · types
// ------------------------------------------------------------
// Headless user-takeover sandbox contracts. This package deliberately
// avoids importing AudioEngine or React so it can be developed in parallel
// with the Q+N main-engine takeover.
// ============================================================

import type { TakeoverQuantizeGrid } from './rhythmQuantizer';

export type TakeoverRole = 'lead';
export type TakeoverLayoutMode = 'chord-analysis' | 'measure-notes';
export type LeadTakeoverSourceMode = 'music-generation' | 'midi-score';
export const TAKEOVER_UPLOADED_BACKING_GAIN_SCALE = 0.9;

export interface TakeoverChordSource {
  rootPc: number;
  quality: string;
  chordType?: string;
  roman?: string;
  startBeat: number;
  durationBeats: number;
  sectionId?: string;
  forcedScale?: string;
  localTonalCenterPc?: number;
  borrowedFrom?: string | null;
  borrowedSource?: string;
  functionHint?: 'T' | 'S' | 'D';
}

export interface TakeoverMusicSnapshot {
  styleHint: string;
  key: string;
  tonality: string;
  bpm: number;
  timeSignature: [number, number];
  chords: TakeoverChordSource[];
  layoutMode?: TakeoverLayoutMode;
  source?: 'generated' | 'midi-analysis' | 'demo';
  measures?: TakeoverMeasureSource[];
  grooveContract?: TakeoverGrooveContract;
  grooveContractBySection?: Record<string, TakeoverGrooveContract>;
}

export interface TakeoverMeasureNote {
  id: string;
  sourceMidi: number;
  priority: number;
  /** Original analyzed layer. Kept through octave folding so Lead cannot be hidden by Comp/Bass collisions. */
  voiceKind?: 'melody' | 'bass' | 'accompaniment';
  structuralRole: 'backbone' | 'ambiguous' | 'ornament';
  metricLevel: 'downbeat' | 'strongBeat' | 'beat' | 'subdivision' | 'offbeat';
  melodicFunction: string;
}

export interface TakeoverMeasureSource {
  id: string;
  label: string;
  startBeat: number;
  durationBeats: number;
  notes: TakeoverMeasureNote[];
}

export interface TakeoverGrooveContract {
  id: string;
  name?: string;
  grid?: string;
  melodySwingRatio?: number;
  melodyStrongPocketMs?: readonly [number, number];
  melodyWeakPocketMs?: readonly [number, number];
  accentPattern?: readonly number[];
}

export interface LeadTakeoverTiming {
  sourceBeat: number;
  targetBeat: number;
  delayMs: number;
  grid: TakeoverQuantizeGrid;
  gridStepBeats: number;
  baseTargetBeat?: number;
  grooveOffsetMs?: number;
  grooveContractId?: string;
}

export interface TakeoverPadCell {
  index: number;
  col: number;
  row: number;
  midi: number;
  name: string;
  pc: number;
  degreeLabel: string;
  classRole:
    | 'chord'
    | 'scale'
    | 'approach'
    | 'fallback'
    | 'structural'
    | 'selected'
    | 'ornament';
}

export interface TakeoverPadMap {
  cells: TakeoverPadCell[];
  chord: TakeoverChordSource | null;
  nextChord: TakeoverChordSource | null;
  localScaleName: string;
  source: 'orthogonal' | 'midi-chord-analysis' | 'midi-measure-notes' | 'fallback';
  measure?: TakeoverMeasureSource | null;
}

export type LeadTakeoverMode = 'idle' | 'takeover';

export interface LeadTakeoverState {
  mode: LeadTakeoverMode;
  inputCount: number;
  firstInputBeat: number | null;
  lastInputBeat: number | null;
  leadMuted: boolean;
  backingDucked: boolean;
}

export type LeadTakeoverAction =
  | {
      type: 'lead-note-on';
      channel: number;
      noteId?: string;
      midi: number;
      velocity: number;
      timing?: LeadTakeoverTiming;
    }
  | {
      type: 'lead-note-off';
      channel: number;
      noteId?: string;
      midi: number;
      timing?: LeadTakeoverTiming;
    }
  | { type: 'backing-gain'; scale: number }
  | { type: 'lead-mute'; channel: number; muted: boolean }
  | { type: 'panic'; channel: number };

export interface LeadTakeoverConfig {
  leadChannel: number;
  nativeLeadMuteEnabled: boolean;
  defaultVelocity: number;
  quantizeEnabled: boolean;
  quantizeGrid: TakeoverQuantizeGrid;
  fastInputGrid: TakeoverQuantizeGrid;
  fastInputBeatWindow: number;
  simultaneousInputWindowMs: number;
  maxSnapDelayMs: number;
  noteOffTailMs: number;
}
