import { NoteData } from "../../types";
import { BassIdiomContext } from "./IBassIdiom";
import { BaseBassIdiom } from "./BaseBassIdiom";
import { GlobalContext } from "../../GlobalContext";
import { PRNGManager } from "../../../utils/PRNG";

export class ReggaeBassIdiom extends BaseBassIdiom {
  generateBassPattern(ctx: BassIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { chord, targetBassPitch, fifthMidi, octaveMidi, grooveDensity, grooveSyncopation } = ctx;
    const baseVel = 0.8;
    const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;

    const activeSection = GlobalContext.getActiveSection();
    const grooveMask = activeSection?.grooveMask;

    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;

      let maskAccent = 0;
      if (grooveMask) {
          const stepIndex = Math.floor((beatInBar / grooveMask.resolution) % grooveMask.accents.length);
          maskAccent = grooveMask.accents[stepIndex];
      }

      // Reggae Bass: Syncopated, rests on beat 1 often, emphasizes beat 3 and off-beats
      if ((beatInBar === 0.5 || beatInBar === 1.5 || maskAccent === 1) && (PRNGManager.next() < grooveSyncopation * 1.5 || maskAccent === 1)) {
        notes.push({
          pitch: targetBassPitch,
          onset: beat,
          duration: 0.5,
          velocity: baseVel * 1.1 * (maskAccent === 1 ? 1.2 : 1.0),
        });
      } else if (beatInBar === 2 && (PRNGManager.next() < grooveDensity * 1.5 || maskAccent === 1)) {
        // Beat 3 (0-indexed 2)
        notes.push({
          pitch: fifthMidi,
          onset: beat,
          duration: 1.0,
          velocity: baseVel * 1.2 * (maskAccent === 1 ? 1.2 : 1.0),
        });
      } else if (beatInBar === 3.5 && (PRNGManager.next() < grooveSyncopation * 1.5 || maskAccent === 1)) {
        notes.push({
          pitch: octaveMidi,
          onset: beat,
          duration: 0.5,
          velocity: baseVel * 0.9 * (maskAccent === 1 ? 1.2 : 1.0),
        });
      }
    }

    return notes;
  }
}
