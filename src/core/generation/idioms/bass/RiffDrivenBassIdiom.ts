import { NoteData } from "../../types";
import { BassIdiomContext } from "./IBassIdiom";
import { BaseBassIdiom } from "./BaseBassIdiom";
import { PRNGManager } from "../../../utils/PRNG";
import { getRandomRhythmCell } from "../../melody/RhythmCells";

export class RiffDrivenBassIdiom extends BaseBassIdiom {
  generateBassPattern(ctx: BassIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { chord, energyLevel, styleId, rootMidi, fifthMidi, grooveDensity, grooveSyncopation } = ctx;
    
    const isFunk = ctx.idiomPreferences?.bassStyle === "funk";
    const isElectronic = ctx.idiomPreferences?.bassStyle === "electronic" || ctx.idiomPreferences?.bassStyle === "edm";

    let currentBeat = chord.startBeat;
    while (currentBeat < chord.endBeat) {
      const cell = getRandomRhythmCell(styleId, energyLevel);

      let advanced = false;
      for (const duration of cell) {
        if (currentBeat + duration > chord.endBeat) break; // Don't overflow chord boundary

        // Pick pitch: mostly root, sometimes 5th or octave, occasionally b7 for funk/house
        let pitch = rootMidi;
        const r = PRNGManager.next();
        if (r > 1.0 - (grooveSyncopation * 0.4))
          pitch = rootMidi + 12; // Octave pop
        else if (r > 1.0 - (grooveDensity * 0.6))
          pitch = fifthMidi; // 5th
        else if (r > 0.5 && (isFunk || isElectronic)) pitch = rootMidi + 10; // b7 (assuming minor/dominant vibe)

        // Velocity: accent the first note of the cell
        const velocity =
          currentBeat === chord.startBeat || PRNGManager.next() < grooveSyncopation
            ? 0.9
            : 0.7;

        notes.push({
          pitch,
          onset: currentBeat,
          duration: duration * 0.8,
          velocity,
        });
        currentBeat += duration;
        advanced = true;
      }
      if (!advanced) {
        // If we couldn't fit even the first note of the cell, just fill the remaining time with a single note or rest
        const remaining = chord.endBeat - currentBeat;
        if (remaining > 0.1) {
          notes.push({
            pitch: rootMidi,
            onset: currentBeat,
            duration: remaining * 0.8,
            velocity: 0.6,
          });
        }
        break;
      }
    }
    return notes;
  }
}
