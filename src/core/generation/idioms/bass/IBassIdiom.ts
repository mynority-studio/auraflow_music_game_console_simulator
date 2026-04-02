import { GeneratedChord, NoteData, RuntimeIdiomPreferences, SectionMetadata, StyleConfig } from "../../types";

export interface BassIdiomContext {
  chord: GeneratedChord;
  energyLevel: number;
  isSparseSection: boolean;
  isSectionEnd: boolean;
  style?: StyleConfig;
  melodyNotes?: NoteData[];
  isBassSolo: boolean;
  idiomPreferences?: RuntimeIdiomPreferences;
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

  /** S-2 合规：由 TextureMapper 从 renderCtx 注入，替代 GlobalContext 读取 */
  beatsPerBar: number;
  /** S-2 合规：由 TextureMapper 从 renderCtx 注入，替代 GlobalContext.getActiveSection() */
  activeSection?: SectionMetadata | null;
  /** S-2 合规：由 TextureMapper 从 renderCtx 注入，替代 GlobalContext.currentKeyOffset */
  keyOffset?: number;
  /** S-2 合规：由 TextureMapper 从 renderCtx 注入，替代 GlobalContext.currentGrooveDNA */
  grooveDNA?: number[];
}

export interface IBassIdiom {
  generate(context: BassIdiomContext): NoteData[];
}
