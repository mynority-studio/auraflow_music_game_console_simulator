import { NoteData } from "../../types";
import { IVocalHarmonyIdiom, VocalHarmonyContext } from "./IVocalHarmonyIdiom";
import { HarmonyCore } from "../../composing/HarmonyCore";
import { PRNGManager } from "../../../utils/PRNG";

export class PopVocalHarmonyIdiom implements IVocalHarmonyIdiom {
  generate(ctx: VocalHarmonyContext): NoteData[] {
    const { melodyNotes, chords, energyLevel, tonality } = ctx;
    const harmonyNotes: NoteData[] = [];
    if (!melodyNotes || melodyNotes.length === 0) return harmonyNotes;

    const harmonyLayers = energyLevel >= 7 ? 2 : 1;

    melodyNotes.forEach(note => {
      const isLongNote = note.duration >= 0.5;
      const isStrongBeat = Math.abs(note.onset % 1) < 1e-6 || Math.abs(note.onset % 1 - 0.5) < 1e-6;
      const shouldHarmonize = energyLevel < 5 ? isLongNote : (isLongNote || isStrongBeat);

      if (!shouldHarmonize) return;

      const currentChord = chords.find(c => note.onset >= c.startBeat && note.onset < c.endBeat) || chords[0];
      if (!currentChord) return;

      const scalePcs = HarmonyCore.getSafeScalePitches(currentChord, tonality);

      let harmonyPitch1 = HarmonyCore.shiftDiatonic(note.pitch, scalePcs, PRNGManager.next() > 0.5 ? 2 : -2);

      harmonyNotes.push({
        pitch: harmonyPitch1,
        onset: note.onset,
        duration: note.duration,
        velocity: note.velocity * 0.8
      });

      if (harmonyLayers > 1) {
        let harmonyPitch2 = HarmonyCore.shiftDiatonic(note.pitch, scalePcs, -4);
        if (Math.abs(harmonyPitch2 - harmonyPitch1) < 3) {
            harmonyPitch2 -= 12;
        }
        harmonyNotes.push({
          pitch: harmonyPitch2,
          onset: note.onset,
          duration: note.duration,
          velocity: note.velocity * 0.7
        });
      }
    });

    return harmonyNotes;
  }
}
