import { NoteData } from "../../types";
import { PianoIdiomContext } from "./IPianoIdiom";
import { BasePianoIdiom } from "./BasePianoIdiom";
import { PRNGManager } from "../../../utils/PRNG";

export class SparsePianoIdiom extends BasePianoIdiom {
  generate(ctx: PianoIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { chord, energyLevel, baseVelocity, beatsPerBar, grooveDensity, grooveSyncopation } = ctx;
    const voicedTones = this.getVoicedTones(ctx);

if (energyLevel <= 2) {
      this.addBlockChord(notes, chord.startBeat, chord.endBeat - chord.startBeat, baseVelocity * 0.8, voicedTones);
      return notes;
    }

    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      
      let maskAccent = 0;

      // Skank chords: Short, staccato hits on beats 2 and 4 (or off-beats)
      if (beatInBar === 1 || beatInBar === 3 || (maskAccent === 1 && Math.abs(beatInBar % 1) >= 1e-6)) {
        // Beats 2 and 4 (0-indexed 1 and 3)
        const duration = 0.15; // Very short
        const compVel = baseVelocity * 1.3 * (maskAccent === 1 ? 1.2 : 1.0); // Accent the skank
        // Play mostly the higher notes of the chord
        const tonesToPlay = voicedTones.slice(1);
        this.addBlockChord(notes, beat, duration, compVel, tonesToPlay);
      }

      // Occasional double skank (e.g., 2 and 2.5)
      if (
        (beatInBar === 1.5 || beatInBar === 3.5 || maskAccent === 1) &&
        (PRNGManager.next() < grooveSyncopation * 0.8 || maskAccent === 1)
      ) {
        this.addBlockChord(notes, beat, 0.15, baseVelocity * 0.9 * (maskAccent === 1 ? 1.3 : 1.0), voicedTones.slice(1));
      }
    }

    return notes;
  }

  private addBlockChord(
    notes: NoteData[],
    onset: number,
    duration: number,
    baseVel: number,
    tones: number[],
  ) {
    tones.forEach((p) => {
      if (p !== undefined && !isNaN(p)) {
        notes.push({
          pitch: p,
          onset: onset,
          duration: duration,
          velocity: baseVel,
        });
      }
    });
  }
}
