import { NoteData, GeneratedChord } from "../../types";
import { StyleId } from "../../config/StyleFlags";

export interface PianoIdiomContext {
  chord: GeneratedChord;
  energyLevel: number;
  textureType: string;
  isSparseSection: boolean;
  isSectionEnd: boolean;
  melodyNotes: NoteData[];
  nextChord?: GeneratedChord;
  styleId: StyleId;
  prevVoicing?: number[];
  nextEnergyLevel?: number;
  pianoStyle: string;
  baseVelocity: number;
  beatsPerBar: number;
  grooveDensity: number;
  grooveSyncopation: number;
}

export interface IPianoIdiom {
  generate(ctx: PianoIdiomContext): NoteData[];
}
