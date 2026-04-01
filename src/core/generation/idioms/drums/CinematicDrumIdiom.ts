import { NoteData } from "../../types";
import { DrumIdiomContext, IDrumIdiom } from "./IDrumIdiom";
import { PRNGManager } from "../../../utils/PRNG";

export class CinematicDrumIdiom implements IDrumIdiom {
  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, isIntro, isOutro, nextEnergyLevel, beatsPerBar, is68, isHalfTime, KICK, SNARE, CHH, OHH, CRASH, CROSS_STICK, TOM_LOW, RIDE, grooveDensity, grooveSyncopation } = ctx;

    if (energyLevel <= 3) return notes;

    for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      const isDownbeat = beatInBar === 0;

      // Cinematic: Big hits, sparse
      if (isDownbeat && PRNGManager.next() < grooveDensity * 1.5) {
        notes.push({ pitch: TOM_LOW, onset: beat, duration: 0.1, velocity: 0.9 }); // Big tom instead of kick
      } else if (beatInBar === 2 && PRNGManager.next() < grooveSyncopation * 1.5) {
        notes.push({ pitch: TOM_LOW, onset: beat, duration: 0.1, velocity: 0.8 });
      }

      // Cinematic: Orchestral snare or no snare
      if (beatInBar === 1 || beatInBar === 3) {
        if (PRNGManager.next() < grooveDensity * 0.5) {
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.85 });
        }
      }

      // Cinematic: Sparse cymbals, mostly crashes or swells
      if (beat % 1 === 0) {
        if (PRNGManager.next() < grooveDensity * 0.3) {
          notes.push({ pitch: CRASH, onset: beat, duration: 0.1, velocity: 0.7 });
        }
      }
    }

    return notes;
  }
}
