// ============================================================
// leadTakeoverSandbox · types
// ------------------------------------------------------------
// Headless user-takeover sandbox contracts. This package deliberately
// avoids importing AudioEngine or React so it can be developed in parallel
// with the Q+N main-engine takeover.
// ============================================================

import type { TakeoverQuantizeGrid } from './rhythmQuantizer';

export type TakeoverRole = 'lead';

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
  grooveContract?: TakeoverGrooveContract;
  grooveContractBySection?: Record<string, TakeoverGrooveContract>;
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
  classRole: 'chord' | 'scale' | 'approach' | 'fallback';
}

export interface TakeoverPadMap {
  cells: TakeoverPadCell[];
  chord: TakeoverChordSource | null;
  nextChord: TakeoverChordSource | null;
  localScaleName: string;
  source: 'orthogonal' | 'fallback';
}

export type LeadTakeoverMode = 'idle' | 'pending-handoff' | 'takeover';

export interface LeadTakeoverState {
  mode: LeadTakeoverMode;
  inputCount: number;
  firstInputBeat: number | null;
  lastInputBeat: number | null;
  muteAtBeat: number | null;
  leadMuted: boolean;
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
  | { type: 'lead-mute'; channel: number; muted: boolean }
  | { type: 'panic'; channel: number };

export interface LeadTakeoverConfig {
  leadChannel: number;
  takeoverThreshold: number;
  silenceBarsToRelease: number;
  handoffBars: number;
  defaultVelocity: number;
  quantizeEnabled: boolean;
  quantizeGrid: TakeoverQuantizeGrid;
  fastInputGrid: TakeoverQuantizeGrid;
  fastInputBeatWindow: number;
  lateGraceMs: number;
  strongBeatLateGraceMs: number;
  noteOffTailMs: number;
}
