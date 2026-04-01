import { NoteData } from "../../types";
import { DrumIdiomContext, IDrumIdiom } from "./IDrumIdiom";
import { PRNGManager } from "../../../utils/PRNG";

export class FolkDrumIdiom implements IDrumIdiom {
  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, isIntro, isOutro, nextEnergyLevel, beatsPerBar, is68, isHalfTime, KICK, SNARE, CHH, OHH, CRASH, CROSS_STICK, TOM_LOW, RIDE, grooveDensity, grooveSyncopation } = ctx;

    if (energyLevel <= 2) return notes;

    for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      const isDownbeat = beatInBar === 0;

      // Folk: Very sparse, often just kick on 1 and 3, or brush snare
      if (isDownbeat) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.7 });
      } else if (beatInBar === 2 && PRNGManager.next() < grooveDensity) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.6 });
      }

      // Folk: Cross-stick or brush snare on 2 and 4
      if (beatInBar === 1 || beatInBar === 3) {
        notes.push({ pitch: CROSS_STICK, onset: beat, duration: 0.1, velocity: 0.8 });
      }

      // Folk: Light hi-hats or shaker feel
      if (beat % 0.5 === 0) {
        let cymbalPitch = CHH;
        let cymbalVel = beat % 1 === 0 ? 0.6 : 0.4;

        if (PRNGManager.next() < grooveDensity * 1.5) {
          notes.push({ pitch: cymbalPitch, onset: beat, duration: 0.1, velocity: cymbalVel });
        }
      }
    }

    return notes;
  }
}
