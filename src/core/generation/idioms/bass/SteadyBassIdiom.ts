import { NoteData } from "../../types";
import { PRNGManager } from "../../../utils/PRNG";
import { BassIdiomContext } from "./IBassIdiom";
import { BaseBassIdiom } from "./BaseBassIdiom";
import { HarmonyCore } from "../../composing/HarmonyCore";
import { StyleId } from "../../config/StyleFlags";

export class SteadyBassIdiom extends BaseBassIdiom {
  generateBassPattern(ctx: BassIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const {
      chord,
      energyLevel,
      isSparseSection,
      isSectionEnd,
      nextEnergyLevel,
      targetBassPitch,
      octaveMidi,
      nextChord,
      nextTargetCenter,
      safeScalePcs,
      grooveDensity,
      grooveSyncopation
    } = ctx;

    const baseVel = 0.8;
    const willChoke = PRNGManager.next() < 0.2;

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

      let targetChordTones = ctx.bassTones;
      if (nextChord) {
        const nextKeyOffset = nextChord.keyOffset !== undefined ? nextChord.keyOffset : (ctx.keyOffset ?? 0);
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

    const beatsPerBar = ctx.beatsPerBar;
    const grooveDNA = ctx.grooveDNA || [];
    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.25) {
      const isChordStart = beat === chord.startBeat;
      const beatInBar = beat % beatsPerBar;

      let maskAccent = 0;

      const isEDM = ctx.style?.id === StyleId.Eurodance || ctx.style?.id === StyleId.Trance || ctx.style?.id === StyleId.Synthwave;

      // 🌟 倾听机制 (The Listening Mechanism): Check if melody has an onset here
      const hasMelodyAccent = ctx.melodyNotes.some(n => Math.abs(n.onset - beat) < 0.05);
      // 🌟 如果主旋律在这里有发声，贝斯有更高概率去“贴合 (Lock)” 这个重音
      if (hasMelodyAccent) {
          maskAccent = 1;
      }

      if (isEDM && energyLevel >= 5) {
        // EDM Bass Logic: Off-beat or Syncopated, NOT 16th note spam
        const subBeat = beatInBar % 1;
        if (Math.abs(subBeat - 0.5) < 1e-6 || maskAccent === 1) {
          notes.push({
            pitch: targetBassPitch,
            onset: beat,
            duration: 0.25,
            velocity: baseVel * 1.2 * (maskAccent === 1 ? 1.1 : 1.0),
          });
        } else if (energyLevel >= 7 && (beatInBar === 1.25 || beatInBar === 3.25) && (PRNGManager.next() < grooveSyncopation || maskAccent === 1)) {
           notes.push({
            pitch: targetBassPitch,
            onset: beat,
            duration: 0.25,
            velocity: baseVel * 1.0 * (maskAccent === 1 ? 1.2 : 1.0),
          });
        } else if (isChordStart && (PRNGManager.next() < grooveDensity * 1.2 || maskAccent === 1)) {
           notes.push({
            pitch: targetBassPitch,
            onset: beat,
            duration: 0.25,
            velocity: baseVel * 0.9 * (maskAccent === 1 ? 1.2 : 1.0),
          });
        }
        continue; // Skip the rest of the generic pop logic
      }

      // Pop/Rock logic
      const isGrooveHit = BaseBassIdiom.isGrooveHit(beat, grooveDNA, beatsPerBar);
      
      // 🌟 贝斯转位 (Bass Inversion) - 偶尔使用三音作为低音，使线条更平滑
      let actualBassPitch = targetBassPitch;
      if (isChordStart && PRNGManager.next() > 0.85 && ctx.bassTones.length > 1) {
        actualBassPitch = ctx.bassTones[1] - 12; // 1st inversion
      }

      // 🌟 律动咬合 (Groove Lock): 如果主旋律有切分音，贝斯强制跟随
      if (isChordStart || isGrooveHit || maskAccent === 1) {
        notes.push({
          pitch: actualBassPitch,
          onset: beat,
          duration: hasMelodyAccent ? 0.25 : 0.5, // 贴合主旋律时，贝斯更短促有力
          velocity: baseVel * 1.1 * (maskAccent === 1 ? 1.1 : 1.0),
        });
      } else if (nextChord && beat === chord.endBeat - 0.5 && (PRNGManager.next() < grooveSyncopation * 1.5 || maskAccent === 1)) {
        // 🌟 线性连接 (Walkdown/Walkup) - 趋近下一个和弦的根音
        const approachPitch = getApproachNote(nextTargetCenter || targetBassPitch, beat, PRNGManager.next() > 0.5);
        notes.push({
          pitch: approachPitch,
          onset: beat,
          duration: 0.5,
          velocity: baseVel * 0.9 * (maskAccent === 1 ? 1.2 : 1.0),
        });
      } else if (BaseBassIdiom.isInterleavingHit(beat, grooveDNA, beatsPerBar) && (PRNGManager.next() < 0.6 || maskAccent === 1)) { // Reduced probability to prevent spam
        const pitch = PRNGManager.next() > 0.7 ? octaveMidi : targetBassPitch;
        notes.push({
          pitch: pitch,
          onset: beat,
          duration: 0.25,
          velocity: baseVel * 0.9 * (maskAccent === 1 ? 1.2 : 1.0),
        });
      } else if ((beatInBar === 1.5 || beatInBar === 3.5) && (PRNGManager.next() < grooveSyncopation * 0.8 || maskAccent === 1)) {
        notes.push({
          pitch: targetBassPitch,
          onset: beat,
          duration: 0.25,
          velocity: baseVel * 0.7 * (maskAccent === 1 ? 1.2 : 1.0),
        });
      } else if (Math.abs(beat % 0.5 - 0.25) < 1e-6 && (PRNGManager.next() < (grooveDensity - 0.5) * 0.4 || maskAccent === 1)) { // Significantly reduced 16th note spam
        notes.push({
          pitch: targetBassPitch,
          onset: beat,
          duration: 0.25,
          velocity: baseVel * 0.8 * (maskAccent === 1 ? 1.2 : 1.0),
        });
      }
    }

    return notes;
  }
}
