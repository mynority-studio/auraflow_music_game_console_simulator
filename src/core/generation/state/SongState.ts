export interface SongMeta {
  bpm: number;
  key: string;
  keyOffset: number;
  mode: string;
  timeSignature: [number, number];
}

export interface MacroStructure {
  structure: string[]; // e.g., ["Intro", "Verse1", "PreChorus", "Chorus", "Verse2", "Chorus", "Outro"]
  energyCurve: number[]; // e.g., [0.2, 0.4, 0.6, 0.9, 0.5, 1.0, 0.1]
}

export interface HarmonyState {
  baseProgression: string[];
  complexityProb: number;
  harmonicRhythm: number;
}

export interface GrooveState {
  density: number;
  syncopationProb: number;
  swing: number;
}

export interface TrackBehavior {
  [key: string]: number | boolean | string;
}

export interface TrackState {
  id: string;
  instrument: string;
  role: string;
  activeEnergyThreshold: number;
  behavior: TrackBehavior;
}

export interface SectionState {
  id: string;
  type: string;
  lengthBars: number;
  phraseTemplate: string; // e.g., "A-A-B-A'"
  energyLevel: number;
  harmony: HarmonyState;
  groove: GrooveState;
  tracks: TrackState[];
}

export interface SongState {
  meta: SongMeta;
  macro: MacroStructure;
  sections: SectionState[];
}
