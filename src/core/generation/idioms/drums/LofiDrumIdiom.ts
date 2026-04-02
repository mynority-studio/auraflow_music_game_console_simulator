import { NoteData } from "../../types";
import { DrumIdiomContext, IDrumIdiom } from "./IDrumIdiom";
import { PRNGManager } from "../../../utils/PRNG";

export class LofiDrumIdiom implements IDrumIdiom {
  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, isIntro, isOutro, nextEnergyLevel, beatsPerBar, is68, isHalfTime, KICK, SNARE, CHH, OHH, CRASH, CROSS_STICK, TOM_LOW, RIDE, grooveDensity, grooveSyncopation } = ctx;

    if (energyLevel <= 2) return notes;

    for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      const isDownbeat = beatInBar === 0;

      // Lo-fi: Syncopated, laid-back kick
      if (isDownbeat) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.8 });
      } else if (Math.abs(beatInBar - 1.5) < 1e-6 || Math.abs(beatInBar - 2.5) < 1e-6) {
        if (PRNGManager.next() < grooveSyncopation * 1.2) {
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.7 });
        }
      } else if (Math.abs(beatInBar - 3.75) < 1e-6 && PRNGManager.next() < grooveDensity * 0.8) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.6 });
      }

      // Lo-fi: Snare/Cross-stick on 2 and 4, often slightly delayed (layback)
      if (beatInBar === 1 || beatInBar === 3) {
        notes.push({ pitch: energyLevel > 5 ? SNARE : CROSS_STICK, onset: beat + ctx.laybackOffset, duration: 0.1, velocity: 0.85 });
      } else if (Math.abs(beatInBar - 1.25) < 1e-6 || Math.abs(beatInBar - 1.75) < 1e-6 || Math.abs(beatInBar - 2.25) < 1e-6 || Math.abs(beatInBar - 3.25) < 1e-6) {
        if (PRNGManager.next() < grooveDensity * 0.6) {
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.3 }); // Ghost note
        }
      }

      // Lo-fi: 8th or 16th note hi-hats, very dynamic, often swung
      if (Math.abs(beat % 0.25) < 1e-6) {
        let cymbalPitch = CHH;
        let cymbalVel = Math.abs(beat % 0.5) < 1e-6 ? 0.7 : 0.4;

        // Occasional open hi-hat
        if (Math.abs(beat % 1 - 0.5) < 1e-6 && PRNGManager.next() < grooveSyncopation * 0.5) {
          cymbalPitch = OHH;
          cymbalVel = 0.75;
        }

        if (PRNGManager.next() < grooveDensity * 1.5) { // Skip some hats for a looser feel
          notes.push({ pitch: cymbalPitch, onset: beat, duration: 0.1, velocity: cymbalVel });
        }
      }
    }

    return notes;
  }
}
