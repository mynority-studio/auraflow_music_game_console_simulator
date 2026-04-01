import { NoteData, GeneratedChord } from "../../types";
import { StyleId } from "../../config/StyleFlags";

export interface VocalHarmonyContext {
  melodyNotes: NoteData[];
  chords: GeneratedChord[];
  energyLevel: number;
  tonality: string;
}

export interface IVocalHarmonyIdiom {
  generate(ctx: VocalHarmonyContext): NoteData[];
}
