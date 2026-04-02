import { NoteData } from "../../types";
import { PianoIdiomContext } from "./IPianoIdiom";
import { BasePianoIdiom } from "./BasePianoIdiom";
import { PRNGManager } from "../../../utils/PRNG";

export class ArpeggiatedPianoIdiom extends BasePianoIdiom {
  generate(ctx: PianoIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { chord, energyLevel, melodyNotes, baseVelocity, beatsPerBar, grooveDensity, grooveSyncopation } = ctx;
    const voicedTones = this.getVoicedTones(ctx);

if (energyLevel <= 2) {
      // Very low energy, just block chord
      this.addBlockChord(notes, chord.startBeat, chord.endBeat - chord.startBeat, baseVelocity * 0.8, voicedTones);
      return notes;
    }

    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      const twoBarBeat = beat % (beatsPerBar * 2);
      
      let maskAccent = 0;

      const melodySinging = melodyNotes.some(
        (m) =>
          (m.onset >= beat - 0.25 && m.onset < beat + 1.0) ||
          (m.onset < beat && m.onset + m.duration > beat),
      );

      // Bossa Comping Rhythm (similar to clave but slightly varied)
      // Bar 1: 1, 2.5, 4
      // Bar 2: 1.5, 3, 4
      const isCompHit =
        (twoBarBeat === 0 && (PRNGManager.next() < grooveDensity * 1.5 || maskAccent === 1)) ||
        (twoBarBeat === 1.5 && (PRNGManager.next() < grooveSyncopation * 1.5 || maskAccent === 1)) ||
        (twoBarBeat === 3 && (PRNGManager.next() < grooveDensity || maskAccent === 1)) || // Bar 1
        (twoBarBeat === 5.5 && (PRNGManager.next() < grooveSyncopation * 1.5 || maskAccent === 1)) ||
        (twoBarBeat === 6 && (PRNGManager.next() < grooveDensity || maskAccent === 1)) ||
        (twoBarBeat === 7 && (PRNGManager.next() < grooveDensity || maskAccent === 1)); // Bar 2

      if (isCompHit) {
        // 🌟 Cooperative Comping:
        // If melody is singing, play fewer notes (just 3rd and 7th/5th) and softer.
        // If bass is hitting a strong downbeat (beat 0), maybe delay the chord slightly or play it softer to avoid mud.
        let tonesToPlay = voicedTones;
        let compVel = baseVelocity * 1.1 * (maskAccent === 1 ? 1.2 : 1.0);

        if (melodySinging) {
          // Simplify voicing to avoid clashing with melody
          tonesToPlay = voicedTones.filter((t) => t !== voicedTones[0]); // Drop root, bass has it
          if (tonesToPlay.length > 2)
            tonesToPlay = [tonesToPlay[0], tonesToPlay[1]]; // Keep it sparse
          compVel *= 0.8; // Softer when melody is active
        } else {
          compVel *= 1.3; // Louder when filling gaps
        }

        // Slightly softer on beat 1 to let the bass root ring clear
        if (beatInBar === 0) {
          compVel *= 0.8;
        }

        // Bossa chords are typically short and staccato
        const duration = melodySinging ? 0.5 : 0.75;

        // Only play if we have tones left after filtering
        if (tonesToPlay.length > 0) {
          this.addBlockChord(notes, beat, duration, Math.min(1.0, compVel), tonesToPlay);
        }
      }

      // Add occasional ghost strums on offbeats for groove
      if (!melodySinging && Math.abs(beat % 0.5 - 0.25) < 1e-6 && (PRNGManager.next() > 0.7 || maskAccent === 1)) {
        this.addBlockChord(notes, beat, 0.15, baseVelocity * 0.4 * (maskAccent === 1 ? 1.5 : 1.0), [
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
