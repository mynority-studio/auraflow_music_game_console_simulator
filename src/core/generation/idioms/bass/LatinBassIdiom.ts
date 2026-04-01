import { NoteData } from "../../types";
import { BassIdiomContext } from "./IBassIdiom";
import { BaseBassIdiom } from "./BaseBassIdiom";
import { GlobalContext } from "../../GlobalContext";
import { PRNGManager } from "../../../utils/PRNG";

export class LatinBassIdiom extends BaseBassIdiom {
  generateBassPattern(ctx: BassIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { chord, targetBassPitch, fifthMidi, grooveDensity, grooveSyncopation } = ctx;
    const baseVel = 0.8;
    const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;

    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;

      // Latin (Non-Bossa): 经典的 1, 2.5, 3, 4.5 节奏 (Tresillo 变体)
      const latinBassVel = Math.min(1.0, baseVel * 1.3);
      if ((beatInBar === 0 || beatInBar === 2) && PRNGManager.next() < grooveDensity * 1.5) {
        notes.push({
          pitch: targetBassPitch,
          onset: beat,
          duration: 1.5,
          velocity: latinBassVel,
        });
      } else if ((beatInBar === 1.5 || beatInBar === 3.5) && PRNGManager.next() < grooveSyncopation * 1.5) {
        notes.push({
          pitch: fifthMidi,
          onset: beat,
          duration: 0.5,
          velocity: latinBassVel * 0.9,
        });
      }
    }

    return notes;
  }
}
