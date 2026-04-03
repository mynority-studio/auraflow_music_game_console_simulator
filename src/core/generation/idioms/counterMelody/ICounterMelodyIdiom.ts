import { NoteData, GeneratedChord, StyleConfig, SectionMetadata, Tonality } from "../../types";

export interface CounterMelodyContext {
  chord: GeneratedChord;
  energyLevel: number;
  melodyNotes: NoteData[];
  style?: StyleConfig;
  /** S-2 合规：由 TextureMapper 从 renderCtx 注入，替代 GlobalContext 读取 */
  keyOffset?: number;
  tonality?: Tonality;
  activeSection?: SectionMetadata | null;
}

export interface ICounterMelodyIdiom {
  generate(ctx: CounterMelodyContext): NoteData[];
}
