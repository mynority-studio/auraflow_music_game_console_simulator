import { NoteData, GeneratedChord } from "../../types";
import { StyleConfig } from "../../types";

export interface RiffContext {
  chord: GeneratedChord;
  energyLevel: number;
  style?: StyleConfig;
}

export interface IRiffIdiom {
  generate(ctx: RiffContext): NoteData[];
}
