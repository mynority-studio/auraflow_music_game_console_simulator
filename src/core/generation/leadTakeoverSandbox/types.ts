// ============================================================
// leadTakeoverSandbox · types
// ------------------------------------------------------------
// Headless user-takeover sandbox contracts. This package deliberately
// avoids importing AudioEngine or React so it can be developed in parallel
// with the Q+N main-engine takeover.
// ============================================================

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
}

export interface TakeoverPadCell {
  index: number;
  col: number;
  row: number;
  midi: number;
  name: string;
  pc: number;
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
  lastInputBeat: number | null;
  muteAtBeat: number | null;
  leadMuted: boolean;
}

export type LeadTakeoverAction =
  | { type: 'lead-note-on'; channel: number; midi: number; velocity: number }
  | { type: 'lead-note-off'; channel: number; midi: number }
  | { type: 'lead-mute'; channel: number; muted: boolean }
  | { type: 'panic'; channel: number };

export interface LeadTakeoverConfig {
  leadChannel: number;
  takeoverThreshold: number;
  silenceBarsToRelease: number;
  handoffBars: number;
  defaultVelocity: number;
}
