import { NoteData } from "../../types";
import { IVocalHarmonyIdiom, VocalHarmonyContext } from "./IVocalHarmonyIdiom";
import { HarmonyCore } from "../../composing/HarmonyCore";
import { PRNGManager } from "../../../utils/PRNG";

export class DynamicChoirIdiom implements IVocalHarmonyIdiom {
  generate(ctx: VocalHarmonyContext): NoteData[] {
    const { melodyNotes, chords, energyLevel, tonality } = ctx;
    const harmonyNotes: NoteData[] = [];
    if (!melodyNotes || melodyNotes.length === 0) return harmonyNotes;

    const harmonyLayers = energyLevel >= 7 ? 3 : (energyLevel >= 4 ? 2 : 1);

    melodyNotes.forEach(note => {
      const isLongNote = note.duration >= 0.5;
      const isStrongBeat = note.onset % 1 === 0 || note.onset % 1 === 0.5;
      const shouldHarmonize = energyLevel < 5 ? isLongNote : (isLongNote || isStrongBeat);

      if (!shouldHarmonize) return;

      const currentChord = chords.find(c => note.onset >= c.startBeat && note.onset < c.endBeat) || chords[0];
      if (!currentChord) return;

      const scalePcs = HarmonyCore.getSafeScalePitches(currentChord, tonality);

      // Choir typically has wider voicings
      let harmonyPitch1 = HarmonyCore.shiftDiatonic(note.pitch, scalePcs, -2); // Third below
      
      harmonyNotes.push({
        pitch: harmonyPitch1,
        onset: note.onset,
        duration: note.duration,
        velocity: note.velocity * 0.85
      });

      if (harmonyLayers > 1) {
        let harmonyPitch2 = HarmonyCore.shiftDiatonic(note.pitch, scalePcs, -4); // Fifth below
        if (Math.abs(harmonyPitch2 - harmonyPitch1) < 3) {
            harmonyPitch2 -= 12;
        }
        harmonyNotes.push({
          pitch: harmonyPitch2,
          onset: note.onset,
          duration: note.duration,
          velocity: note.velocity * 0.8
        });
      }

      if (harmonyLayers > 2) {
        let harmonyPitch3 = HarmonyCore.shiftDiatonic(note.pitch, scalePcs, 2); // Third above
        harmonyNotes.push({
          pitch: harmonyPitch3,
          onset: note.onset,
          duration: note.duration,
          velocity: note.velocity * 0.75
        });
      }
    });

    return harmonyNotes;
  }
}
