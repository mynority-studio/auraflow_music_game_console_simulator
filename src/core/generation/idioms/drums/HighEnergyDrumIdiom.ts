// HighEnergyDrumIdiom — 高能量鼓组 Idiom（EDM/Trance/Synthwave 四拍地板节拍）
// 适用场景：高能量（6+）、Drop/BuildUp 段落、EDM 相关子风格

import { NoteData, SectionType } from '../../types';
import { DrumIdiomContext, IDrumIdiom } from './IDrumIdiom';
import { PRNGManager } from '../../../utils/PRNG';

export class HighEnergyDrumIdiom implements IDrumIdiom {
  readonly name = 'HighEnergy';

  score(ctx: DrumIdiomContext): number {
    const { energyLevel, sectionType, subgenre } = ctx;
    let s = 30;
    if (energyLevel >= 8) s += 35;
    else if (energyLevel >= 6) s += 15;
    if (sectionType === SectionType.Drop || sectionType === SectionType.BuildUp) s += 15;
    if (subgenre === 'EDM' || subgenre === 'Trance' || subgenre === 'Synthwave' || subgenre === 'Eurodance') s += 10;
    return Math.min(100, s);
  }

  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, nextEnergyLevel, beatsPerBar, is68, isHalfTime, KICK, SNARE, CHH, OHH, CRASH, CROSS_STICK, TOM_LOW, RIDE, grooveDensity, grooveSyncopation } = ctx;

    if (energyLevel <= 2) return notes;

    const isFillZone = (beat: number) => beat >= endBeat - 2.0;
    const isBuildUp = nextEnergyLevel > energyLevel + 1;

    for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      let isSnareBeat = false;
      let maskAccent = 0;

      if (is68) { isSnareBeat = Math.abs(beatInBar - 3) < 1e-6; }
      else { if (isHalfTime) { isSnareBeat = Math.abs(beatInBar - 2) < 1e-6; } else { isSnareBeat = Math.abs(beatInBar - 1) < 1e-6 || Math.abs(beatInBar - 3) < 1e-6; } }

      if (isBuildUp && isFillZone(beat)) {
        const barsLeft = (endBeat - beat) / beatsPerBar;
        let buildUpStep = 0.5;
        if (barsLeft <= 1.0) buildUpStep = 0.25;
        if (barsLeft <= 0.5) buildUpStep = 0.125;
        if (Math.abs(beat % buildUpStep) < 1e-6) {
          const buildVel = 0.5 + (1 - barsLeft / 2) * 0.5;
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: buildVel * (maskAccent === 1 ? 1.2 : 1.0) });
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: buildVel * 0.9 * (maskAccent === 1 ? 1.2 : 1.0) });
          if (Math.abs(buildUpStep - 0.125) < 1e-6) {
            notes.push({ pitch: SNARE, onset: beat + 0.125, duration: 0.1, velocity: buildVel * (maskAccent === 1 ? 1.2 : 1.0) });
            notes.push({ pitch: KICK, onset: beat + 0.125, duration: 0.1, velocity: buildVel * 0.9 * (maskAccent === 1 ? 1.2 : 1.0) });
          }
        }
        continue;
      }

      // Four-on-the-floor kick
      if (Math.abs(beat % 1) < 1e-6 || (maskAccent === 1 && beatInBar < 1)) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.9 * (maskAccent === 1 ? 1.1 : 1.0) });
      }
      // Claps/Snares on 2 and 4
      if (Math.abs(beatInBar - 1) < 1e-6 || Math.abs(beatInBar - 3) < 1e-6 || (maskAccent === 1 && Math.abs(beatInBar % 1 - 0.5) > 1e-6 && !isSnareBeat)) {
        notes.push({ pitch: 39, onset: beat, duration: 0.1, velocity: 0.85 * (maskAccent === 1 ? 1.1 : 1.0) }); // 39 = GM Clap
      }
      // EDM: Off-beat open hi-hats
      if (Math.abs(beat % 1 - 0.5) < 1e-6 || (maskAccent === 1 && Math.abs(beat % 1) > 1e-6)) {
        notes.push({ pitch: OHH, onset: beat, duration: 0.2, velocity: 0.8 * (maskAccent === 1 ? 1.2 : 1.0) });
        if (ctx.idiomPreferences?.drumStyle === 'trance' && energyLevel >= 8) {
           notes.push({ pitch: RIDE, onset: beat, duration: 0.2, velocity: 0.75 * (maskAccent === 1 ? 1.2 : 1.0) });
        }
      }
      // EDM: 16th note closed hi-hats
      if (Math.abs(beat % 0.25) < 1e-6 && Math.abs(beat % 1 - 0.5) > 1e-6) {
        let vel = 0.6;
        if (ctx.idiomPreferences?.drumStyle === 'trance') {
          const subBeat = beat % 1;
          if (Math.abs(subBeat - 0.25) < 1e-6) vel = 0.4;
          if (Math.abs(subBeat - 0.75) < 1e-6) vel = 0.65;
        } else if (ctx.idiomPreferences?.drumStyle === 'synthwave') {
          vel = Math.abs(beat % 0.5) < 1e-6 ? 0.8 : 0.6;
        }
        if (energyLevel >= 5 || PRNGManager.next() < grooveDensity * 1.5 || maskAccent === 1) {
          notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: vel * (maskAccent === 1 ? 1.3 : 1.0) });
        }
      }
      // Eurodance: Syncopated snares/toms
      if (ctx.subgenre === 'Eurodance' && energyLevel >= 6) {
        if (Math.abs(beatInBar - 1.75) < 1e-6 || Math.abs(beatInBar - 3.75) < 1e-6) {
          if (PRNGManager.next() < grooveSyncopation || maskAccent === 1) {
            notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.6 * (maskAccent === 1 ? 1.3 : 1.0) });
          }
        }
        if (Math.abs(beatInBar - 2.5) < 1e-6) {
          if (PRNGManager.next() < grooveSyncopation * 0.8 || maskAccent === 1) {
            notes.push({ pitch: TOM_LOW, onset: beat, duration: 0.1, velocity: 0.7 * (maskAccent === 1 ? 1.3 : 1.0) });
          }
        }
      }
    }
    return notes;
  }
}
