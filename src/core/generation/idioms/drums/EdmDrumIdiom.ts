import { NoteData } from "../../types";
import { DrumIdiomContext, IDrumIdiom } from "./IDrumIdiom";
import { PRNGManager } from "../../../utils/PRNG";
import { GlobalContext } from "../../GlobalContext";

export class EdmDrumIdiom implements IDrumIdiom {
  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, isIntro, isOutro, nextEnergyLevel, beatsPerBar, is68, isHalfTime, KICK, SNARE, CHH, OHH, CRASH, CROSS_STICK, TOM_LOW, RIDE, grooveDensity, grooveSyncopation } = ctx;

    const activeSection = GlobalContext.getActiveSection();
    const grooveMask = activeSection?.grooveMask;

    if (energyLevel <= 2) return notes;

    const isFillZone = (beat: number) => beat >= endBeat - 2.0;
    const isBuildUp = nextEnergyLevel > energyLevel + 1;

    for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      let isSnareBeat = false;
      
      let maskAccent = 0;
      if (grooveMask) {
          const stepIndex = Math.floor((beatInBar / grooveMask.resolution) % grooveMask.accents.length);
          maskAccent = grooveMask.accents[stepIndex];
      }

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
        if (barsLeft <= 0.5) buildUpStep = 0.125;

        if (beat % buildUpStep === 0) {
          const buildVel = 0.5 + (1 - barsLeft / 2) * 0.5;
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: buildVel * (maskAccent === 1 ? 1.2 : 1.0) });
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: buildVel * 0.9 * (maskAccent === 1 ? 1.2 : 1.0) });
          
          if (buildUpStep === 0.125) {
            notes.push({ pitch: SNARE, onset: beat + 0.125, duration: 0.1, velocity: buildVel * (maskAccent === 1 ? 1.2 : 1.0) });
            notes.push({ pitch: KICK, onset: beat + 0.125, duration: 0.1, velocity: buildVel * 0.9 * (maskAccent === 1 ? 1.2 : 1.0) });
          }
        }
        continue;
      }

      // Four-on-the-floor kick
      if (beat % 1 === 0 || (maskAccent === 1 && beatInBar < 1)) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.9 * (maskAccent === 1 ? 1.1 : 1.0) });
      }

      // Claps/Snares on 2 and 4
      if (beatInBar === 1 || beatInBar === 3 || (maskAccent === 1 && beatInBar % 1 !== 0.5 && !isSnareBeat)) {
        notes.push({ pitch: 39, onset: beat, duration: 0.1, velocity: 0.85 * (maskAccent === 1 ? 1.1 : 1.0) }); // 39 is Clap
      }

      // EDM: Off-beat open hi-hats
      if (beat % 1 === 0.5 || (maskAccent === 1 && beat % 1 !== 0)) {
        notes.push({ pitch: OHH, onset: beat, duration: 0.2, velocity: 0.8 * (maskAccent === 1 ? 1.2 : 1.0) });
        
        // Trance: Add Ride cymbal on off-beats during very high energy
        if (ctx.idiomPreferences?.drumStyle === 'trance' && energyLevel >= 8) {
           notes.push({ pitch: RIDE, onset: beat, duration: 0.2, velocity: 0.75 * (maskAccent === 1 ? 1.2 : 1.0) });
        }
      }

      // EDM: 16th note closed hi-hats
      if (beat % 0.25 === 0 && beat % 1 !== 0.5) {
        let vel = 0.6;
        if (ctx.idiomPreferences?.drumStyle === 'trance') {
          const subBeat = beat % 1;
          if (subBeat === 0.25) vel = 0.4;
          if (subBeat === 0.75) vel = 0.65;
        } else if (ctx.idiomPreferences?.drumStyle === 'synthwave') {
          vel = beat % 0.5 === 0 ? 0.8 : 0.6;
        }
        
        if (energyLevel >= 5 || PRNGManager.next() < grooveDensity * 1.5 || maskAccent === 1) {
          notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: vel * (maskAccent === 1 ? 1.3 : 1.0) });
        }
      }

      // Eurodance: Syncopated snares/toms for groove
      if (ctx.idiomPreferences?.drumStyle === 'eurodance' && energyLevel >= 6) {
        if (beatInBar === 1.75 || beatInBar === 3.75) {
          if (PRNGManager.next() < grooveSyncopation || maskAccent === 1) {
            notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.6 * (maskAccent === 1 ? 1.3 : 1.0) });
          }
        }
        if (beatInBar === 2.5) {
          if (PRNGManager.next() < grooveSyncopation * 0.8 || maskAccent === 1) {
            notes.push({ pitch: TOM_LOW, onset: beat, duration: 0.1, velocity: 0.7 * (maskAccent === 1 ? 1.3 : 1.0) });
          }
        }
      }
    }

    return notes;
  }
}
