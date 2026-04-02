import { NoteData } from "../../types";
import { IRiffIdiom, RiffContext } from "./IRiffIdiom";
import { HarmonyCore } from "../../composing/HarmonyCore";
import { PRNGManager } from "../../../utils/PRNG";
import { getRandomRhythmCell } from "../../melody/RhythmCells";

export class DefaultRiffIdiom implements IRiffIdiom {
  generate(ctx: RiffContext): NoteData[] {
    const { chord, energyLevel, style } = ctx;
    const notes: NoteData[] = [];
    const keyOffset = ctx.keyOffset ?? chord.keyOffset ?? 0;
    const chordTones = HarmonyCore.getChordTones(chord, 60 - keyOffset); // C4 range
    const scalePcs = HarmonyCore.getSafeScalePitches(
      chord,
      ctx.tonality ?? 'Major'
    );
    const rootMidi = chordTones[0];
    const baseVel = 0.6 + (energyLevel / 10) * 0.3;

    let currentBeat = chord.startBeat;
    let currentPitch = rootMidi;

    while (currentBeat < chord.endBeat) {
      const cell = getRandomRhythmCell(style?.rhythm?.grooveTemplate, energyLevel);

      let advanced = false;
      for (const duration of cell) {
        if (currentBeat + duration > chord.endBeat) break;

        if (PRNGManager.next() > 0.3) {
          currentPitch = chordTones[Math.floor(PRNGManager.next() * chordTones.length)];
          if (PRNGManager.next() > 0.5) currentPitch += 12;
        } else {
          const direction = PRNGManager.next() > 0.5 ? 1 : -1;
          currentPitch = HarmonyCore.shiftDiatonic(
            currentPitch,
            scalePcs,
            direction,
          );
        }

        if (currentPitch < 48) currentPitch += 12;
        if (currentPitch > 72) currentPitch -= 12;

        const velocity = Math.abs(currentBeat % 1) < 1e-6 ? baseVel * 1.1 : baseVel * 0.8;

        notes.push({
          pitch: currentPitch,
          onset: currentBeat,
          duration: duration * 0.8,
          velocity,
        });
        currentBeat += duration;
        advanced = true;
      }
      if (!advanced) {
        const remaining = chord.endBeat - currentBeat;
        if (remaining > 0.1) {
          notes.push({
            pitch: rootMidi,
            onset: currentBeat,
            duration: remaining * 0.8,
            velocity: baseVel,
          });
        }
        break;
      }
    }
    return notes;
  }
}
