import { NoteData } from "../../types";
import { BassIdiomContext } from "./IBassIdiom";
import { BaseBassIdiom } from "./BaseBassIdiom";
import { GlobalContext } from "../../GlobalContext";
import { PRNGManager } from "../../../utils/PRNG";
import { HarmonyCore } from "../../composing/HarmonyCore";

export class BossaBassIdiom extends BaseBassIdiom {
  generateBassPattern(ctx: BassIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { chord, targetBassPitch, fifthMidi, nextChord, nextTargetCenter, safeScalePcs, bassTones, grooveDensity, grooveSyncopation } = ctx;
    const baseVel = 0.8;
    const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;

    const activeSection = GlobalContext.getActiveSection();
    const grooveMask = activeSection?.grooveMask;

    // Helper for chromatic approach
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

    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      
      let maskAccent = 0;
      if (grooveMask) {
          const stepIndex = Math.floor((beatInBar / grooveMask.resolution) % grooveMask.accents.length);
          maskAccent = grooveMask.accents[stepIndex];
      }

      // 🌴 Bossa Nova Bass Logic (Root on 1 and 3, Fifth on 2.5 and 4.5, or variations)
      const latinBassVel = Math.min(1.0, baseVel * 1.3);

      // Basic pattern: 1, 2.5, 3, 4.5 (in 4/4)
      if (Math.abs(beatInBar) < 1e-6 || (maskAccent === 1 && beatInBar < 1)) {
        notes.push({
          pitch: targetBassPitch,
          onset: beat,
          duration: 1.5,
          velocity: latinBassVel * (maskAccent === 1 ? 1.1 : 1.0),
        });
      } else if (Math.abs(beatInBar - 1.5) < 1e-6 && (PRNGManager.next() < grooveSyncopation * 1.5 || maskAccent === 1)) {
        // Often drops to the fifth below
        const fifthBelow =
          fifthMidi < targetBassPitch ? fifthMidi : fifthMidi - 12;
        notes.push({
          pitch: fifthBelow,
          onset: beat,
          duration: 0.5,
          velocity: latinBassVel * 0.9 * (maskAccent === 1 ? 1.2 : 1.0),
        });
      } else if (Math.abs(beatInBar - 2) < 1e-6 && (PRNGManager.next() < grooveDensity * 1.5 || maskAccent === 1)) {
        // Sometimes plays root again, sometimes fifth
        const pitch = PRNGManager.next() > 0.5 ? targetBassPitch : fifthMidi;
        notes.push({
          pitch: pitch,
          onset: beat,
          duration: 1.5,
          velocity: latinBassVel * (maskAccent === 1 ? 1.1 : 1.0),
        });
      } else if (Math.abs(beatInBar - 3.5) < 1e-6 && (PRNGManager.next() < grooveSyncopation * 1.5 || maskAccent === 1)) {
        // Approach note to next chord or fifth
        let pitch = fifthMidi;
        if (nextChord && (PRNGManager.next() < grooveDensity || maskAccent === 1)) {
          const targetRoot = HarmonyCore.getChordTones(
            nextChord,
            nextTargetCenter,
          )[0];
          pitch = getApproachNote(targetRoot, beat);
        } else {
          pitch = fifthMidi < targetBassPitch ? fifthMidi : fifthMidi - 12;
        }
        notes.push({
          pitch: pitch,
          onset: beat,
          duration: 0.5,
          velocity: latinBassVel * 0.9 * (maskAccent === 1 ? 1.2 : 1.0),
        });
      }
    }

    return notes;
  }
}
