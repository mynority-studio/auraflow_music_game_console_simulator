import { NoteData, GeneratedChord } from "../../types";
import { StyleId } from "../../config/StyleFlags";

export interface CounterMelodyContext {
  chord: GeneratedChord;
  energyLevel: number;
  melodyNotes: NoteData[];
  styleId: StyleId;
}

export interface ICounterMelodyIdiom {
  generate(ctx: CounterMelodyContext): NoteData[];
}
