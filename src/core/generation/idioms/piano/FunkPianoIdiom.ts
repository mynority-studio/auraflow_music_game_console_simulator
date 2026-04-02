import { NoteData } from "../../types";
import { PianoIdiomContext } from "./IPianoIdiom";
import { BasePianoIdiom } from "./BasePianoIdiom";
import { PRNGManager } from "../../../utils/PRNG";
import { GlobalContext } from "../../GlobalContext";

export class FunkPianoIdiom extends BasePianoIdiom {
  generate(ctx: PianoIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { chord, energyLevel, melodyNotes, baseVelocity, beatsPerBar, grooveDensity, grooveSyncopation } = ctx;
    const voicedTones = this.getVoicedTones(ctx);

    if (energyLevel <= 2) {
      this.addBlockChord(notes, chord.startBeat, chord.endBeat - chord.startBeat, baseVelocity * 0.8, voicedTones);
      return notes;
    }

    const activeSection = GlobalContext.getActiveSection();
    const grooveMask = activeSection?.grooveMask;

    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;

      let maskAccent = 0;
      if (grooveMask) {
          const stepIndex = Math.floor((beatInBar / grooveMask.resolution) % grooveMask.accents.length);
          maskAccent = grooveMask.accents[stepIndex];
      }

      const melodySinging = melodyNotes.some(
        (m) =>
          (m.onset >= beat - 0.25 && m.onset < beat + 1.0) ||
          (m.onset < beat && m.onset + m.duration > beat),
      );

      // Funk Guitar/EP comping: short, staccato, syncopated 16th note hits
      // Often hits on 1.75, 2.5, 3.75, 4.0
      const isFunkHit =
        maskAccent === 1 ||
        (Math.abs(beatInBar) < 1e-6 && PRNGManager.next() < grooveDensity) ||
        (Math.abs(beatInBar - 0.75) < 1e-6 && PRNGManager.next() < grooveSyncopation * 1.5) ||
        (Math.abs(beatInBar - 1.5) < 1e-6 && PRNGManager.next() < grooveSyncopation * 1.2) ||
        (Math.abs(beatInBar - 2.5) < 1e-6 && PRNGManager.next() < grooveDensity) ||
        (Math.abs(beatInBar - 3.75) < 1e-6 && PRNGManager.next() < grooveSyncopation * 1.5);

      if (isFunkHit) {
        // Very short duration for staccato feel (0.15 to 0.25)
        const duration = 0.2;
        const compVel = baseVelocity * (melodySinging ? 0.9 : 1.2) * (maskAccent === 1 ? 1.2 : 1.0);

        // Sometimes play full chord, sometimes just top notes (the "chank")
        const tonesToPlay =
          PRNGManager.next() > 0.4
            ? [voicedTones[1], voicedTones[2], voicedTones[3]].filter(Boolean)
            : voicedTones;

        this.addBlockChord(notes, beat, duration, compVel, tonesToPlay);
      }

      // 16th note muted strums (ghost notes)
      if (
        !isFunkHit &&
        Math.abs(beat % 0.25) < 1e-6 &&
        (PRNGManager.next() < grooveSyncopation * 0.5 || maskAccent === 1) && // grooveSyncopation
        !melodySinging
      ) {
        this.addBlockChord(notes, beat, 0.1, baseVelocity * 0.4 * (maskAccent === 1 ? 1.5 : 1.0), [
          voicedTones[1] || voicedTones[0],
        ]);
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
