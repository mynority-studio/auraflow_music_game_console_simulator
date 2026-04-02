import { NoteData } from "../../types";
import { IVocalHarmonyIdiom, VocalHarmonyContext } from "./IVocalHarmonyIdiom";
import { HarmonyCore } from "../../composing/HarmonyCore";
import { PRNGManager } from "../../../utils/PRNG";

export class GospelVocalHarmonyIdiom implements IVocalHarmonyIdiom {
  generate(ctx: VocalHarmonyContext): NoteData[] {
    const { melodyNotes, chords, energyLevel, tonality } = ctx;
    const harmonyNotes: NoteData[] = [];
    if (!melodyNotes || melodyNotes.length === 0) return harmonyNotes;

    const harmonyLayers = 2; // Gospel always uses 2 layers for 3-part harmony

    melodyNotes.forEach(note => {
      const isLongNote = note.duration >= 0.5;
      const isStrongBeat = note.onset % 1 === 0 || note.onset % 1 === 0.5;
      const shouldHarmonize = energyLevel < 5 ? isLongNote : (isLongNote || isStrongBeat);

      if (!shouldHarmonize) return;

      const currentChord = chords.find(c => note.onset >= c.startBeat && note.onset < c.endBeat) || chords[0];
      if (!currentChord) return;

      // S-2 合规：从 ctx.keyOffset 读取（由 TextureMapper 注入），回退到 chord.keyOffset
      const keyOffset = ctx.keyOffset ?? currentChord.keyOffset ?? 0;
      const chordTones = HarmonyCore.getChordTones(currentChord, 60 - keyOffset).map(p => p % 12);
      const scalePcs = HarmonyCore.getSafeScalePitches(currentChord, tonality);

      let harmonyPitch1 = HarmonyCore.shiftDiatonic(note.pitch, scalePcs, -2);
      if (!chordTones.includes(harmonyPitch1 % 12) && PRNGManager.next() > 0.5) {
          harmonyPitch1 = HarmonyCore.shiftDiatonic(harmonyPitch1, scalePcs, -1);
      }

      harmonyNotes.push({
        pitch: harmonyPitch1,
        onset: note.onset,
        duration: note.duration,
        velocity: note.velocity * 0.8
      });

      let harmonyPitch2 = HarmonyCore.shiftDiatonic(harmonyPitch1, scalePcs, -2);
      if (Math.abs(harmonyPitch2 - harmonyPitch1) < 3) {
          harmonyPitch2 -= 12;
      }
      harmonyNotes.push({
        pitch: harmonyPitch2,
        onset: note.onset,
        duration: note.duration,
        velocity: note.velocity * 0.7
      });
    });

    return harmonyNotes;
  }
}
