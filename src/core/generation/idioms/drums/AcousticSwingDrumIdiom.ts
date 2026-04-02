import { NoteData } from "../../types";
import { DrumIdiomContext, IDrumIdiom } from "./IDrumIdiom";
import { PRNGManager } from "../../../utils/PRNG";

export class AcousticSwingDrumIdiom implements IDrumIdiom {
  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, isIntro, isOutro, nextEnergyLevel, beatsPerBar, is68, isHalfTime, KICK, SNARE, CHH, OHH, CRASH, CROSS_STICK, TOM_LOW, RIDE, grooveDensity, grooveSyncopation } = ctx;

if (energyLevel <= 2) return notes;

    for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      const isDownbeat = beatInBar === 0;

      let maskAccent = 0;

      // Jazz: Light kick on 1, sometimes 3
      if (isDownbeat && (PRNGManager.next() < grooveDensity * 1.5 || maskAccent === 1)) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.5 * (maskAccent === 1 ? 1.3 : 1.0) });
      } else if (beatInBar === 2 && (PRNGManager.next() < grooveSyncopation * 0.8 || maskAccent === 1)) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.4 * (maskAccent === 1 ? 1.3 : 1.0) });
      }

      // Jazz: Cross-stick or light snare comping
      if (beatInBar === 1 || beatInBar === 3 || (maskAccent === 1 && beatInBar % 1 !== 0)) {
        if (PRNGManager.next() < grooveDensity || maskAccent === 1) {
          notes.push({ pitch: energyLevel > 5 ? SNARE : CROSS_STICK, onset: beat, duration: 0.1, velocity: 0.5 * (maskAccent === 1 ? 1.3 : 1.0) });
        }
      } else if (beatInBar === 2.5 || beatInBar === 3.5 || maskAccent === 1) { // Syncopated comping
        if (PRNGManager.next() < grooveSyncopation * 0.5 || maskAccent === 1) {
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.4 * (maskAccent === 1 ? 1.3 : 1.0) });
        }
      }

      // Jazz: Ride cymbal pattern (ding-ding-da-ding)
      if (Math.abs(beat % 1) < 1e-6 || maskAccent === 1) {
        notes.push({ pitch: RIDE, onset: beat, duration: 0.1, velocity: 0.7 * (maskAccent === 1 ? 1.2 : 1.0) });
      } else if (Math.abs(beat % 1 - 0.66) < 1e-6 || Math.abs(beat % 1 - 0.75) < 1e-6) { // Swing feel approximation
        if (PRNGManager.next() < grooveDensity * 1.5 || maskAccent === 1) {
          notes.push({ pitch: RIDE, onset: beat, duration: 0.1, velocity: 0.5 * (maskAccent === 1 ? 1.2 : 1.0) });
        }
      }

      // Jazz: Hi-hat pedal on 2 and 4
      if (beatInBar === 1 || beatInBar === 3) {
        notes.push({ pitch: 44, onset: beat, duration: 0.1, velocity: 0.6 }); // 44 is Pedal Hi-Hat
      }
    }

    return notes;
  }
}
