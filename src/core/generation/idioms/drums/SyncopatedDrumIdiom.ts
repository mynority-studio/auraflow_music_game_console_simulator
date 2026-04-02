import { NoteData } from "../../types";
import { DrumIdiomContext, IDrumIdiom } from "./IDrumIdiom";
import { PRNGManager } from "../../../utils/PRNG";

export class SyncopatedDrumIdiom implements IDrumIdiom {
  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, isIntro, isOutro, nextEnergyLevel, beatsPerBar, is68, isHalfTime, KICK, SNARE, CHH, OHH, CRASH, CROSS_STICK, TOM_LOW, RIDE, grooveDensity, grooveSyncopation } = ctx;

    if (energyLevel <= 2) return notes;

for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      const isDownbeat = beatInBar === 0;

      let maskAccent = 0;

      // Funk: Syncopated kick
      if (isDownbeat) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.9 * (maskAccent === 1 ? 1.1 : 1.0) });
      } else if (beatInBar === 1.5 || beatInBar === 2.5) {
        if (PRNGManager.next() < grooveSyncopation * 1.5 || maskAccent === 1) {
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.8 * (maskAccent === 1 ? 1.1 : 1.0) });
        }
      } else if (beatInBar === 3.75 && (PRNGManager.next() < grooveDensity || maskAccent === 1)) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.7 * (maskAccent === 1 ? 1.2 : 1.0) });
      }

      // Funk: Snare on 2 and 4, ghost notes elsewhere
      if (beatInBar === 1 || beatInBar === 3) {
        notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.95 * (maskAccent === 1 ? 1.05 : 1.0) });
      } else if (beatInBar === 1.25 || beatInBar === 1.75 || beatInBar === 2.25 || beatInBar === 3.25) {
        if (PRNGManager.next() < grooveDensity * 0.8 || maskAccent === 1) {
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.3 * (maskAccent === 1 ? 1.5 : 1.0) }); // Ghost note
        }
      } else if (maskAccent === 1 && !isDownbeat && beatInBar !== 1.5 && beatInBar !== 2.5 && beatInBar !== 3.75) {
          // 🌟 GrooveMask 强制重音，如果不是底鼓或军鼓的常规位置，则加一个轻军鼓或 Ghost Note
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.5 });
      }

      // Funk: 16th note hi-hats with accents
      if (beat % 0.25 === 0) {
        let cymbalPitch = CHH;
        let cymbalVel = beat % 0.5 === 0 ? 0.8 : 0.5;

        // Open hi-hat on the "and"
        if (beat % 1 === 0.5 && (PRNGManager.next() < grooveSyncopation * 0.8 || maskAccent === 1)) {
          cymbalPitch = OHH;
          cymbalVel = 0.85;
        }

        notes.push({ pitch: cymbalPitch, onset: beat, duration: 0.1, velocity: cymbalVel * (maskAccent === 1 ? 1.2 : 1.0) });
      }
    }

    return notes;
  }
}
