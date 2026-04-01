import { NoteData } from "../../types";
import { DrumIdiomContext, IDrumIdiom } from "./IDrumIdiom";
import { PRNGManager } from "../../../utils/PRNG";
import { GlobalContext } from "../../GlobalContext";

export class BossaDrumIdiom implements IDrumIdiom {
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

      // Bossa Nova: Kick on 1 and 3, often with a pickup on the "and" of 2 and 4
      if (beatInBar === 0 || beatInBar === 2 || (maskAccent === 1 && beatInBar % 1 === 0)) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.8 * (maskAccent === 1 ? 1.2 : 1.0) });
      } else if (beatInBar === 1.5 || beatInBar === 3.5 || (maskAccent === 1 && beatInBar % 1 !== 0)) {
        if (PRNGManager.next() < grooveSyncopation * 1.5 || maskAccent === 1) {
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.6 * (maskAccent === 1 ? 1.3 : 1.0) });
        }
      }

      // Bossa Nova: Cross-stick clave pattern (3-2 or 2-3)
      // Here we use a simplified 3-2 clave approximation
      if (beatInBar === 0 || beatInBar === 1.5 || beatInBar === 2.5 || (maskAccent === 1 && beatInBar % 1 !== 0.5)) {
        notes.push({ pitch: CROSS_STICK, onset: beat, duration: 0.1, velocity: 0.9 * (maskAccent === 1 ? 1.1 : 1.0) });
      }

      // Bossa Nova: Continuous 8th note hi-hats
      if (beat % 0.5 === 0 || maskAccent === 1) {
        let cymbalPitch = CHH;
        let cymbalVel = beat % 1 === 0 ? 0.7 : 0.5;

        // Occasional open hi-hat on the "and"
        if ((beat % 1 === 0.5 && PRNGManager.next() < grooveDensity * 0.5) || (maskAccent === 1 && beat % 1 !== 0)) {
          cymbalPitch = OHH;
          cymbalVel = 0.75;
        }

        notes.push({ pitch: cymbalPitch, onset: beat, duration: 0.1, velocity: cymbalVel * (maskAccent === 1 ? 1.2 : 1.0) });
      }
    }

    return notes;
  }
}
