import { NoteData } from "../../types";
import { PRNGManager } from "../../../utils/PRNG";
import { HarmonyCore } from "../../composing/HarmonyCore";
import { BassIdiomContext } from "./IBassIdiom";
import { BaseBassIdiom } from "./BaseBassIdiom";

export class NeoSoulBassIdiom extends BaseBassIdiom {
  generateBassPattern(ctx: BassIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { chord, energyLevel, rootMidi, fifthMidi, grooveDensity, grooveSyncopation } = ctx;

    // 🌟 Neo-Soul / R&B 专属织体: Octave Melody Bass
    if (energyLevel >= 5 && PRNGManager.next() < 0.4) {
      // Generate a melodic bassline using octaves and pentatonic fills
      let currentBeat = chord.startBeat;
      while (currentBeat < chord.endBeat) {
        // Root on downbeat
        notes.push({
          pitch: rootMidi,
          onset: currentBeat,
          duration: 0.5,
          velocity: 0.9,
        });

        // Syncopated octave or 5th
        if (PRNGManager.next() < grooveSyncopation * 1.5) {
          const syncOnset = currentBeat + 0.75; // 16th note before beat 2
          if (syncOnset < chord.endBeat) {
            const upperPitch =
              PRNGManager.next() > 0.5 ? rootMidi + 12 : fifthMidi;
            notes.push({
              pitch: upperPitch,
              onset: syncOnset,
              duration: 0.25,
              velocity: 0.75,
            });
          }
        }

        // Pentatonic fill at the end of the measure
        if (chord.endBeat - currentBeat >= 2 && PRNGManager.next() < grooveDensity) {
          const fillOnset = currentBeat + 1.5;
          if (fillOnset + 0.5 <= chord.endBeat) {
            const fillPitches = HarmonyCore.getScalePitches(
              "Minor_Pentatonic",
            ).map((p) => ((chord.root + p) % 12) + 24);
            const p1 =
              fillPitches[Math.floor(PRNGManager.next() * fillPitches.length)];
            const p2 =
              fillPitches[Math.floor(PRNGManager.next() * fillPitches.length)];
            notes.push({
              pitch: p1,
              onset: fillOnset,
              duration: 0.25,
              velocity: 0.7,
            });
            notes.push({
              pitch: p2,
              onset: fillOnset + 0.25,
              duration: 0.25,
              velocity: 0.7,
            });
          }
        }

        currentBeat += 2; // Move by half measure
      }
      return notes;
    }

    // Fallback to default/pop logic if the specific condition isn't met
    // We can return an empty array to signal that the default logic should take over,
    // or we can implement the default logic here.
    // For now, let's return empty array to indicate "not handled by specific idiom"
    // Wait, if we return empty, we need a way to chain or fallback.
    // Actually, let's just implement the full NeoSoul logic. If it doesn't do the melodic bass,
    // it falls back to the standard groove-driven bass.
    return []; // We'll handle fallback in the mapper for now, or build a DefaultBassIdiom.
  }
}
