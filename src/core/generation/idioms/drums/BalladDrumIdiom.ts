import { NoteData } from "../../types";
import { DrumIdiomContext, IDrumIdiom } from "./IDrumIdiom";
import { PRNGManager } from "../../../utils/PRNG";

export class BalladDrumIdiom implements IDrumIdiom {
  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, isIntro, isOutro, nextEnergyLevel, beatsPerBar, is68, isHalfTime, KICK, SNARE, CHH, OHH, CRASH, CROSS_STICK, TOM_LOW, RIDE, grooveDensity, grooveSyncopation } = ctx;

    if (energyLevel <= 2) return notes;

    const isFillZone = (beat: number) => beat >= endBeat - 2.0;
    const isBuildUp = nextEnergyLevel > energyLevel + 1;

    for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      const isDownbeat = beatInBar === 0;
      let isSnareBeat = false;
      if (is68) {
        isSnareBeat = beatInBar === 3;
      } else {
        if (isHalfTime) {
          isSnareBeat = beatInBar === 2;
        } else {
          isSnareBeat = beatInBar === 1 || beatInBar === 3;
        }
      }

      if (isBuildUp && isFillZone(beat)) {
        const barsLeft = (endBeat - beat) / beatsPerBar;
        let buildUpStep = 0.5;
        if (barsLeft <= 1.0) buildUpStep = 0.25;

        if (beat % buildUpStep === 0) {
          const buildVel = 0.5 + (1 - barsLeft / 2) * 0.4;
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: buildVel });
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: buildVel * 0.8 });
        }
        continue;
      }

      // Ballad: Soft, sparse kick
      if (isDownbeat) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.75 });
      } else if (beatInBar === 2.5 && PRNGManager.next() < grooveDensity) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.6 });
      }

      // Ballad: Cross-stick or soft snare on 2 and 4
      if (isSnareBeat) {
        notes.push({ pitch: energyLevel > 5 ? SNARE : CROSS_STICK, onset: beat, duration: 0.1, velocity: 0.8 });
      }

      // Ballad: Ride or hi-hats, often 8th notes, very gentle
      if (beat % 0.5 === 0) {
        let cymbalPitch = energyLevel > 6 ? RIDE : CHH;
        let cymbalVel = beat % 1 === 0 ? 0.6 : 0.4;

        if (PRNGManager.next() > 0.2) {
          notes.push({ pitch: cymbalPitch, onset: beat, duration: 0.1, velocity: cymbalVel });
        }
      }
    }

    return notes;
  }
}
