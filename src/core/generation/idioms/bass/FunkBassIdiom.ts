import { NoteData } from "../../types";
import { BassIdiomContext } from "./IBassIdiom";
import { BaseBassIdiom } from "./BaseBassIdiom";
import { GlobalContext } from "../../GlobalContext";
import { PRNGManager } from "../../../utils/PRNG";

export class FunkBassIdiom extends BaseBassIdiom {
  generateBassPattern(ctx: BassIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { chord, energyLevel, targetBassPitch, octaveMidi, grooveDensity, grooveSyncopation } = ctx;
    const baseVel = 0.8;
    const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;

    const activeSection = GlobalContext.getActiveSection();
    const grooveMask = activeSection?.grooveMask;

    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      const isChordStart = beat === chord.startBeat;

      let maskAccent = 0;
      if (grooveMask) {
          const stepIndex = Math.floor((beatInBar / grooveMask.resolution) % grooveMask.accents.length);
          maskAccent = grooveMask.accents[stepIndex];
      }

      // Funk / 其他电子：高度贴合 GrooveDNA，带有八度跳跃和切分
      // 🌟 P1: 乐器惯用语引擎 (Instrument Idiom Engine) - Bass 演奏法 (Slap vs. Finger)
      const isSlap = energyLevel >= 7; // 高能量 Funk 引入 Slap

      if (isChordStart || GlobalContext.isLayeringHit(beat) || maskAccent === 1) {
        notes.push({
          pitch: targetBassPitch,
          onset: beat,
          duration: isSlap ? 0.25 : 0.5, // Slap 更短促
          velocity: baseVel * 1.1 * (maskAccent === 1 ? 1.1 : 1.0),
        });
      } else if (GlobalContext.isInterleavingHit(beat) || (maskAccent === 1 && PRNGManager.next() > 0.5)) {
        // 贴合 GrooveDNA
        // Slap 经常使用八度 Pop (高音) 和低音 Slap
        const useOctavePop = isSlap && (PRNGManager.next() < grooveSyncopation * 1.5 || maskAccent === 1);
        const pitch = useOctavePop
          ? octaveMidi
          : PRNGManager.next() < grooveDensity
          ? octaveMidi
          : targetBassPitch;
        const duration = isSlap
          ? 0.15
          : PRNGManager.next() < grooveDensity
          ? 0.25
          : 0.5; // 短促的跳音
        const vel = (useOctavePop ? baseVel * 1.2 : baseVel * 0.9) * (maskAccent === 1 ? 1.2 : 1.0); // Pop 力度更大
        notes.push({
          pitch: pitch,
          onset: beat,
          duration: duration,
          velocity: vel,
        });
      } else if (
        (Math.abs(beatInBar - 1.5) < 1e-6 || Math.abs(beatInBar - 3.5) < 1e-6) &&
        (PRNGManager.next() < grooveSyncopation || maskAccent === 1)
      ) {
        // 经典的 16 分音符反拍（Ghost notes），受 syncopationProb 控制
        notes.push({
          pitch: targetBassPitch,
          onset: beat,
          duration: 0.15, // Ghost note 更短
          velocity: baseVel * 0.5 * (maskAccent === 1 ? 1.5 : 1.0),
        });
      } else if (
        Math.abs(beat % 0.5 - 0.25) < 1e-6 &&
        (PRNGManager.next() < (grooveDensity - 0.5) * 0.8 || maskAccent === 1)
      ) {
        // 额外的 16 分音符，受 density 控制
        notes.push({
          pitch: isSlap && (PRNGManager.next() < grooveSyncopation || maskAccent === 1) ? octaveMidi : targetBassPitch,
          onset: beat,
          duration: 0.15,
          velocity: baseVel * 0.6 * (maskAccent === 1 ? 1.5 : 1.0),
        });
      }
    }

    return notes;
  }
}
