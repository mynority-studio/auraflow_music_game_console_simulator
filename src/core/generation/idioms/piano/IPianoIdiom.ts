import { NoteData, GeneratedChord, StyleConfig, SectionMetadata, Tonality } from "../../types";

export interface PianoIdiomContext {
  chord: GeneratedChord;
  energyLevel: number;
  textureType: string;
  isSparseSection: boolean;
  isSectionEnd: boolean;
  melodyNotes: NoteData[];
  nextChord?: GeneratedChord;
  style?: StyleConfig;
  prevVoicing?: number[];
  nextEnergyLevel?: number;
  pianoStyle: string;
  baseVelocity: number;
  beatsPerBar: number;
  grooveDensity: number;
  grooveSyncopation: number;
  /** S-2 合规：由 TextureMapper 从 renderCtx 注入，替代 GlobalContext 读取 */
  keyOffset?: number;
  tonality?: Tonality;
  activeSection?: SectionMetadata | null;
}

export interface IPianoIdiom {
  generate(ctx: PianoIdiomContext): NoteData[];
}
