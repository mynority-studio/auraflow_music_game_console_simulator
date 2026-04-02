import { NoteData } from "../../types";
import { BassIdiomContext } from "./IBassIdiom";
import { BaseBassIdiom } from "./BaseBassIdiom";
import { GlobalContext } from "../../GlobalContext";
import { PRNGManager } from "../../../utils/PRNG";
import { HarmonyCore } from "../../composing/HarmonyCore";

export class MelodicBassIdiom extends BaseBassIdiom {
  generateBassPattern(ctx: BassIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { chord, rootMidi, nextChord, nextTargetCenter, safeScalePcs, bassTones, grooveDensity, grooveSyncopation } = ctx;
    const baseVel = 0.8;
    const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;

    const activeSection = GlobalContext.getActiveSection();
// Helper for walking bass chromatic approach
    const getApproachNote = (
      targetPitch: number,
      currentBeat: number,
      forceChromatic: boolean = false,
    ) => {
      const direction = PRNGManager.next() > 0.5 ? 1 : -1;
      if (forceChromatic) return targetPitch + direction;

      let approachPitch = HarmonyCore.shiftDiatonic(
        targetPitch,
        safeScalePcs,
        direction,
      );

      let targetChordTones = bassTones;
      if (nextChord) {
        const nextKeyOffset = nextChord.keyOffset !== undefined ? nextChord.keyOffset : (GlobalContext.currentKeyOffset || 0);
        let nextFinalRoot = (nextChord.root + nextKeyOffset) % 12;
        nextFinalRoot += 24;
        if (nextFinalRoot < 28) nextFinalRoot += 12;
        const nextTargetCenter = nextFinalRoot - nextKeyOffset;
        targetChordTones = HarmonyCore.getChordTones(nextChord, nextTargetCenter);
      }
      const targetRoot = targetChordTones[0];
      const targetThird = targetChordTones.length > 1 ? targetChordTones[1] : targetRoot + 4;

      const diffRoot = Math.abs(approachPitch - targetRoot) % 12;
      const diffThird = Math.abs(approachPitch - targetThird) % 12;

      if (diffRoot === 1 || diffRoot === 11 || diffThird === 1 || diffThird === 11) {
        approachPitch = PRNGManager.next() > 0.5 ? targetRoot : (targetChordTones.length > 2 ? targetChordTones[2] : targetRoot + 7);
      }
      return approachPitch;
    };

    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 1) {
      const beatInBar = beat % beatsPerBar;
      
      let maskAccent = 0;

      // On every quarter note
      let pitch = rootMidi;
      const beatsRemaining = chord.endBeat - beat;
      const isChordStart = beat === chord.startBeat;

      if (isChordStart) {
        pitch = rootMidi; // First beat of chord: Root
      } else if (beatsRemaining === 1) {
        // Last beat of chord: Approach note to the next chord's root (or current if no next chord)
        const targetRoot = nextChord
          ? HarmonyCore.getChordTones(nextChord, nextTargetCenter)[0]
          : rootMidi;
        pitch = getApproachNote(targetRoot, beat, PRNGManager.next() > 0.5); // 50% chance of chromatic approach
      } else {
        // Middle beats: Arpeggiate chord tones or use passing diatonic notes
        if (PRNGManager.next() > 0.3) {
          // Pick a chord tone different from the previous one if possible
          const availableTones = bassTones.filter(t => Math.abs(t - rootMidi) <= 12);
          pitch = availableTones[Math.floor(PRNGManager.next() * availableTones.length)];
        } else {
          // Diatonic passing tone
          const direction = PRNGManager.next() > 0.5 ? 1 : -1;
          pitch = HarmonyCore.shiftDiatonic(
            rootMidi,
            safeScalePcs,
            direction * Math.floor(PRNGManager.next() * 3 + 1)
          );
        }
      }

      // Add some rhythmic variation (skip a beat occasionally or add an 8th note)
      if (PRNGManager.next() < grooveDensity * 1.5 || maskAccent === 1) { // 95% chance to play the quarter note
        notes.push({
          pitch: pitch,
          onset: beat,
          duration: 1.0,
          velocity: baseVel * (isChordStart ? 1.1 : 0.9) * (maskAccent === 1 ? 1.2 : 1.0),
        });
      }

      // Swing 8th note passing tone (skip if it's the last beat of the chord to avoid muddying the approach)
      if ((PRNGManager.next() < grooveSyncopation * 0.5 || maskAccent === 1) && beatsRemaining > 1) {
        const direction = PRNGManager.next() > 0.5 ? 1 : -1;
        const passing = HarmonyCore.shiftDiatonic(
          pitch,
          safeScalePcs,
          direction,
        );
        notes.push({
          pitch: passing,
          onset: beat + 0.66,
          duration: 0.34,
          velocity: baseVel * 0.7 * (maskAccent === 1 ? 1.3 : 1.0),
        });
      }
    }

    return notes;
  }
}
