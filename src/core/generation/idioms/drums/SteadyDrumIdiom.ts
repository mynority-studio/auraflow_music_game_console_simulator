import { NoteData } from "../../types";
import { DrumIdiomContext, IDrumIdiom } from "./IDrumIdiom";
import { PRNGManager } from "../../../utils/PRNG";

export class SteadyDrumIdiom implements IDrumIdiom {
  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, isIntro, isOutro, nextEnergyLevel, beatsPerBar, is68, isHalfTime, laybackOffset, KICK, SNARE, CHH, OHH, CRASH, CROSS_STICK, TOM_LOW, RIDE, grooveDensity, grooveSyncopation } = ctx;

    if (energyLevel <= 2) return notes; // Handled by generic fallback if needed, or just sparse

    const isFillZone = (beat: number) => beat >= endBeat - 2.0;
    const isBuildUp = nextEnergyLevel > energyLevel + 1;
for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      const isDownbeat = beatInBar === 0;
      let isSnareBeat = false;
      if (is68) {
        isSnareBeat = beatInBar === 3;
      } else {
        if (isHalfTime) {
          isSnareBeat = beatInBar === 2;
        } else {
          isSnareBeat = beatInBar === 1 || beatInBar === 3;
        }
      }

      let maskAccent = 0;
      
      // 🌟 倾听机制 (The Listening Mechanism): Check if melody has an onset here
      const hasMelodyAccent = ctx.melodyNotes?.some(n => Math.abs(n.onset - beat) < 0.05);
      // 🌟 如果主旋律在这里有发声，底鼓(Kick)有更高概率去“贴合 (Lock)” 这个重音
      if (hasMelodyAccent && !isSnareBeat) {
          maskAccent = 1;
      }

      if (isBuildUp && isFillZone(beat)) {
        const barsLeft = (endBeat - beat) / beatsPerBar;
        let buildUpStep = 0.5;
        if (barsLeft <= 1.0) buildUpStep = 0.25;

        if (beat % buildUpStep === 0) {
          const buildVel = 0.6 + (1 - barsLeft / 2) * 0.4;
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: buildVel });
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: buildVel * 0.9 });
          notes.push({ pitch: TOM_LOW, onset: beat, duration: 0.1, velocity: buildVel * 0.8 });
        }
        continue;
      }

      // Driving Kick - Strict on-beat for Pop/Rock
      if (isDownbeat) {
        if (PRNGManager.next() > 0.05) {
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.9 * (maskAccent === 1 ? 1.1 : 1.0) });
        }
      } else if (beatInBar === 2.5) {
        if (PRNGManager.next() < grooveSyncopation * 1.5 || maskAccent === 1) {
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.8 * (maskAccent === 1 ? 1.1 : 1.0) });
        }
      } else if (beatInBar === 1.5 && (PRNGManager.next() < grooveSyncopation || maskAccent === 1)) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.7 * (maskAccent === 1 ? 1.2 : 1.0) });
      } else if (beatInBar === 3.5 && (PRNGManager.next() < grooveSyncopation * 1.2 || maskAccent === 1)) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.75 * (maskAccent === 1 ? 1.2 : 1.0) });
      } else if (maskAccent === 1 && Math.abs(beatInBar % 0.5) >= 1e-6) {
        // 🌟 旋律在 16 分音符反拍上有重音，底鼓强制跟随贴合
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.85 });
      }

      // Heavy Snare on 2 and 4 - STRICT
      if (isSnareBeat) {
        notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.95 * (maskAccent === 1 ? 1.05 : 1.0) });
      } else if (maskAccent === 1 && !isDownbeat && beatInBar !== 2.5 && beatInBar !== 1.5 && beatInBar !== 3.5) {
          // 🌟 GrooveMask 强制重音，如果不是底鼓或军鼓的常规位置，则加一个轻军鼓或 Ghost Note
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.5 });
      }

      // Hi-hats / Ride / Crash riding
      if (Math.abs(beat % 0.5) < 1e-6) {
        let cymbalPitch = CHH;
        let cymbalVel = Math.abs(beat % 1) < 1e-6 ? 0.8 : 0.6;

        if (energyLevel >= 8) {
          cymbalPitch = PRNGManager.next() > 0.5 ? CRASH : RIDE;
          cymbalVel = 0.85;
        } else if (energyLevel >= 6) {
          cymbalPitch = OHH;
          cymbalVel = 0.75;
        }

        const dropHatProb = isSnareBeat ? 0.5 : 0.2;
        if (PRNGManager.next() > dropHatProb || maskAccent === 1) {
          notes.push({ pitch: cymbalPitch, onset: beat, duration: 0.1, velocity: cymbalVel * (maskAccent === 1 ? 1.2 : 1.0) });
        }
      }

      // Occasional 16th kick before snare
      if (beatInBar === 1.75 || beatInBar === 3.75) {
        if (PRNGManager.next() < grooveDensity * 0.5 || maskAccent === 1) {
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.6 * (maskAccent === 1 ? 1.2 : 1.0) });
        }
      }
    }

    return notes;
  }
}
