import { NoteData, GeneratedChord, Tonality } from "../../types";
import { StyleId } from "../../config/StyleFlags";

export interface VocalHarmonyContext {
  melodyNotes: NoteData[];
  chords: GeneratedChord[];
  energyLevel: number;
  tonality: Tonality;
}

export interface IVocalHarmonyIdiom {
  generate(ctx: VocalHarmonyContext): NoteData[];
}
