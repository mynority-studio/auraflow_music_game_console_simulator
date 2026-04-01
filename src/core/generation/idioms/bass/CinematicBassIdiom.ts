import { NoteData } from "../../types";
import { BassIdiomContext } from "./IBassIdiom";
import { BaseBassIdiom } from "./BaseBassIdiom";
import { PRNGManager } from "../../../utils/PRNG";
import { GlobalContext } from "../../GlobalContext";

export class CinematicBassIdiom extends BaseBassIdiom {
  generateBassPattern(ctx: BassIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { chord, targetBassPitch, fifthMidi, energyLevel, grooveDensity, grooveSyncopation } = ctx;
    const baseVel = 0.8;
    const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;

    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      const isChordStart = beat === chord.startBeat;

      // 抒情/电影/稀疏段落：长音铺底
      if (isChordStart) {
        notes.push({
          pitch: targetBassPitch,
          onset: beat,
          duration: Math.min(4.0, chord.endBeat - beat),
          velocity: baseVel,
        });
      } else if (
        beatInBar === 2 &&
        energyLevel > 2 &&
        PRNGManager.next() < grooveDensity * 1.5
      ) {
        // 偶尔在第三拍（4/4拍的beatInBar=2）加个五度或八度
        notes.push({
          pitch: fifthMidi,
          onset: beat,
          duration: 2.0,
          velocity: baseVel * 0.8,
        });
      }
    }

    return notes;
  }
}
