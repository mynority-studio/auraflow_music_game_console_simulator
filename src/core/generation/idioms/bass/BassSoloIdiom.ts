import { NoteData } from "../../types";
import { BassIdiomContext } from "./IBassIdiom";
import { BaseBassIdiom } from "./BaseBassIdiom";
import { GlobalContext } from "../../GlobalContext";
import { PRNGManager } from "../../../utils/PRNG";

export class BassSoloIdiom extends BaseBassIdiom {
  generateBassPattern(ctx: BassIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { chord, rootMidi, octaveMidi, thirdMidi, fifthMidi, grooveDensity, grooveSyncopation } = ctx;
    const baseVel = 0.8;
    const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;

    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      const isChordStart = beat === chord.startBeat;

      // 🌟 贝斯 Solo 模式：更具律动感和旋律性
      const isLayeringHit = GlobalContext.isLayeringHit(beat);
      const isInterleavingHit = GlobalContext.isInterleavingHit(beat);
      
      if (isChordStart || isLayeringHit) {
        notes.push({
          pitch: rootMidi,
          onset: beat,
          duration: 0.5,
          velocity: baseVel * 1.2,
        });
      } else if (isInterleavingHit && PRNGManager.next() < grooveSyncopation * 1.5) {
        const pitch = PRNGManager.next() > 0.5 ? rootMidi : octaveMidi;
        notes.push({
          pitch: pitch,
          onset: beat,
          duration: 0.25,
          velocity: baseVel * 1.1,
        });
      } else if ((beatInBar === 2.5 || beatInBar === 3.5) && PRNGManager.next() < grooveDensity * 1.5) {
        // 经过音
        const passingPitch = PRNGManager.next() > 0.5 ? fifthMidi : thirdMidi;
        notes.push({
          pitch: passingPitch,
          onset: beat,
          duration: 0.25,
          velocity: baseVel * 0.9,
        });
      }
    }

    return notes;
  }
}
