import { NoteData } from "../../types";
import { DrumIdiomContext, IDrumIdiom } from "./IDrumIdiom";
import { PRNGManager } from "../../../utils/PRNG";

export class SparseDrumIdiom implements IDrumIdiom {
  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, isIntro, isOutro, nextEnergyLevel, beatsPerBar, is68, isHalfTime, KICK, SNARE, CHH, OHH, CRASH, CROSS_STICK, TOM_LOW, RIDE, grooveDensity, grooveSyncopation } = ctx;

    if (energyLevel <= 3) return notes;

    for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      const isDownbeat = Math.abs(beatInBar) < 1e-6;

      // Cinematic: Big hits, sparse
      if (isDownbeat && PRNGManager.next() < grooveDensity * 1.5) {
        notes.push({ pitch: TOM_LOW, onset: beat, duration: 0.1, velocity: 0.9 }); // Big tom instead of kick
      } else if (Math.abs(beatInBar - 2) < 1e-6 && PRNGManager.next() < grooveSyncopation * 1.5) {
        notes.push({ pitch: TOM_LOW, onset: beat, duration: 0.1, velocity: 0.8 });
      }

      // Cinematic: Orchestral snare or no snare
      if (Math.abs(beatInBar - 1) < 1e-6 || Math.abs(beatInBar - 3) < 1e-6) {
        if (PRNGManager.next() < grooveDensity * 0.5) {
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.85 });
        }
      }

      // Cinematic: Sparse cymbals, mostly crashes or swells
      if (Math.abs(beat % 1) < 1e-6) {
        if (PRNGManager.next() < grooveDensity * 0.3) {
          notes.push({ pitch: CRASH, onset: beat, duration: 0.1, velocity: 0.7 });
        }
      }
    }

    return notes;
  }
}
