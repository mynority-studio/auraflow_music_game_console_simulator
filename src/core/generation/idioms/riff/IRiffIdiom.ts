import { NoteData, GeneratedChord } from "../../types";
import { StyleId } from "../../config/StyleFlags";

export interface RiffContext {
  chord: GeneratedChord;
  energyLevel: number;
  styleId: StyleId;
}

export interface IRiffIdiom {
  generate(ctx: RiffContext): NoteData[];
}
