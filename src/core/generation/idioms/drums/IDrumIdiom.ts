import { NoteData, SectionMetadata } from "../../types";
import { StyleConfig } from "../../types";

export interface DrumIdiomContext {
  startBeat: number;
  endBeat: number;
  energyLevel: number;
  isIntro: boolean;
  isOutro: boolean;
  style?: StyleConfig;
  swingRatio: number;
  nextEnergyLevel: number;
  hasFullGrooveStarted: boolean;
  grooveRatio?: { foundation: number; comping: number; color: number };
  idiomPreferences?: {
    drumStyle?: string;
    [key: string]: any;
  };
  
  // Pre-calculated helpers
  beatsPerBar: number;
  is68: boolean;
  isSwing: boolean;
  isHalfTime: boolean;
  grooveDensity: number;
  grooveSyncopation: number;
  laybackOffset: number;
  melodyNotes?: NoteData[];
  /** S-2 合规：由 TextureMapper 从 renderCtx 注入，替代 GlobalContext.getActiveSection() */
  activeSection?: SectionMetadata | null;
  
  // Drum MIDI Constants
  KICK: number;
  SNARE: number;
  CHH: number;
  PHH: number;
  OHH: number;
  CRASH: number;
  CROSS_STICK: number;
  TOM_HI: number;
  TOM_MID: number;
  TOM_LOW: number;
  RIDE: number;
  RIDE_BELL: number;
  CHINA: number;
  SPLASH: number;
  CRASH2: number;
}

export interface IDrumIdiom {
  generate(context: DrumIdiomContext): NoteData[];
}
