import { GeneratedChord, NoteData, IdiomPreferences } from "../../types";
import { StyleId } from "../../config/StyleFlags";

export interface BassIdiomContext {
  chord: GeneratedChord;
  energyLevel: number;
  isSparseSection: boolean;
  isSectionEnd: boolean;
  styleId: StyleId;
  melodyNotes: NoteData[];
  isBassSolo: boolean;
  idiomPreferences?: IdiomPreferences;
  nextChord?: GeneratedChord;
  nextEnergyLevel: number;
  
  // Pre-calculated helpers
  rootMidi: number;
  thirdMidi: number;
  fifthMidi: number;
  seventhMidi: number;
  safeScalePcs: number[];
  grooveDensity: number;
  grooveSyncopation: number;
  
  // For walking bass / inversions
  targetBassPitch: number;
  octaveMidi: number;
  nextTargetCenter: number;
  bassTones: number[];
  isCinematic: boolean;
  isBallad: boolean;
  bassSound?: string | null;
}

export interface IBassIdiom {
  generate(context: BassIdiomContext): NoteData[];
}
