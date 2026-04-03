import { NoteData, GeneratedChord, Tonality } from "../../types";
import { StyleId } from "../../config/StyleFlags";

export interface VocalHarmonyContext {
  melodyNotes: NoteData[];
  chords: GeneratedChord[];
  energyLevel: number;
  tonality: Tonality;
  /** S-2 合规：由 TextureMapper 从 renderCtx 注入，替代 GlobalContext.currentKeyOffset */
  keyOffset?: number;
}

export interface IVocalHarmonyIdiom {
  generate(ctx: VocalHarmonyContext): NoteData[];
}
