import { NoteData } from "../../types";
import { DrumIdiomContext, IDrumIdiom } from "./IDrumIdiom";
import { PRNGManager } from "../../../utils/PRNG";
import { GlobalContext } from "../../GlobalContext";

export class ReggaeDrumIdiom implements IDrumIdiom {
  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, isIntro, isOutro, nextEnergyLevel, beatsPerBar, is68, isHalfTime, KICK, SNARE, CHH, OHH, CRASH, CROSS_STICK, TOM_LOW, RIDE, grooveDensity, grooveSyncopation } = ctx;

    const activeSection = GlobalContext.getActiveSection();
    const grooveMask = activeSection?.grooveMask;

    if (energyLevel <= 2) return notes;

    for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;

      let maskAccent = 0;
      if (grooveMask) {
          const stepIndex = Math.floor((beatInBar / grooveMask.resolution) % grooveMask.accents.length);
          maskAccent = grooveMask.accents[stepIndex];
      }

      // Reggae: One drop (kick and snare/cross-stick on 3)
      if (beatInBar === 2 || (maskAccent === 1 && beatInBar % 1 === 0)) { // Assuming 4/4, beat 3 is index 2
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.9 * (maskAccent === 1 ? 1.1 : 1.0) });
        notes.push({ pitch: CROSS_STICK, onset: beat, duration: 0.1, velocity: 0.95 * (maskAccent === 1 ? 1.1 : 1.0) });
      }

      // Reggae: Hi-hats on 8th notes, open on off-beats
      if ((beat % 0.5 === 0 && PRNGManager.next() < grooveDensity * 1.5) || maskAccent === 1) {
        let cymbalPitch = CHH;
        let cymbalVel = 0.7 * (maskAccent === 1 ? 1.2 : 1.0);

        if ((beat % 1 === 0.5 && PRNGManager.next() < grooveSyncopation * 1.5) || (maskAccent === 1 && beat % 1 !== 0)) {
          cymbalPitch = OHH;
          cymbalVel = 0.85 * (maskAccent === 1 ? 1.2 : 1.0);
        }

        notes.push({ pitch: cymbalPitch, onset: beat, duration: 0.1, velocity: cymbalVel });
      }
    }

    return notes;
  }
}
