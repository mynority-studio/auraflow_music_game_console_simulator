import { NoteData, GeneratedChord } from "../../types";
import { StyleConfig } from "../../types";

export interface RiffContext {
  chord: GeneratedChord;
  energyLevel: number;
  style?: StyleConfig;
  /** S-2 合规：由 TextureMapper 从 renderCtx 注入，替代 GlobalContext.currentKeyOffset */
  keyOffset?: number;
  /** S-2 合规：由 TextureMapper 从 renderCtx 注入，替代 GlobalContext.currentTonality */
  tonality?: string;
}

export interface IRiffIdiom {
  generate(ctx: RiffContext): NoteData[];
}
