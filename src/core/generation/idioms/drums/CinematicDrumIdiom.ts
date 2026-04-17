// CinematicDrumIdiom — 电影感鼓组 Idiom（Epic/Cinematic 节拍）
// 适用场景：高能量（6+）、史诗段落（Chorus+高能量、Solo_Bridge）

import { NoteData, SectionType } from '../../types';
import { DrumIdiomContext, IDrumIdiom } from './IDrumIdiom';
import { PRNGManager } from '../../../utils/PRNG';

export class CinematicDrumIdiom implements IDrumIdiom {
  readonly name = 'Cinematic';

  score(ctx: DrumIdiomContext): number {
    const { energyLevel, sectionType } = ctx;
    let s = 25;
    if (energyLevel >= 9) s += 35;
    else if (energyLevel >= 7) s += 20;
    else if (energyLevel >= 5) s += 10;
    if (sectionType === SectionType.Chorus && energyLevel >= 9) s += 15;
    if (sectionType === SectionType.Solo_Bridge) s += 10;
    return Math.min(100, s);
  }

  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, beatsPerBar, KICK, SNARE, TOM_LOW, TOM_MID, TOM_HI, CRASH, CRASH2, RIDE, CROSS_STICK } = ctx;

    for (let beat = startBeat; beat < endBeat; beat += 0.5) {
      const beatInBar = beat % beatsPerBar;

      if (energyLevel <= 3) {
        if (Math.abs(beatInBar) < 1e-6) {
          notes.push({ pitch: KICK, onset: beat, duration: 0.25, velocity: 0.5 });
        }
        if (Math.abs(beatInBar - 2) < 1e-6 && PRNGManager.next() > 0.7) {
          notes.push({ pitch: CROSS_STICK, onset: beat, duration: 0.25, velocity: 0.6 });
        }
      }
      else if (energyLevel > 3 && energyLevel <= 6) {
        if (Math.abs(beatInBar) < 1e-6 || Math.abs(beatInBar - 2) < 1e-6) {
          notes.push({ pitch: KICK, onset: beat, duration: 0.25, velocity: 0.85 });
        }
        if (Math.abs(beatInBar - 1) < 1e-6 || Math.abs(beatInBar - 3) < 1e-6) {
          notes.push({ pitch: SNARE, onset: beat, duration: 0.25, velocity: 0.75 });
        }
        const drivePitch = PRNGManager.next() > 0.5 ? RIDE : TOM_LOW;
        notes.push({ pitch: drivePitch, onset: beat, duration: 0.25, velocity: 0.6 + PRNGManager.next() * 0.2 });
      }
      else {
        if (Math.abs(beatInBar) < 1e-6 || Math.abs(beatInBar - 1.5) < 1e-6 || Math.abs(beatInBar - 2.5) < 1e-6) {
          notes.push({ pitch: KICK, onset: beat, duration: 0.25, velocity: 1.0 });
        }
        if (Math.abs(beatInBar - 1) < 1e-6 || Math.abs(beatInBar - 3) < 1e-6) {
          notes.push({ pitch: SNARE, onset: beat, duration: 0.25, velocity: 1.0 });
          notes.push({ pitch: TOM_LOW, onset: beat, duration: 0.25, velocity: 0.9 });
        }
        notes.push({ pitch: RIDE, onset: beat, duration: 0.25, velocity: 0.8 + PRNGManager.next() * 0.2 });
        if (beatInBar >= 3.0 && PRNGManager.next() > 0.6) {
          notes.push({ pitch: TOM_HI, onset: beat, duration: 0.25, velocity: 0.9 });
          if (Math.abs(beatInBar - 3.5) < 1e-6) {
            notes.push({ pitch: TOM_MID, onset: beat, duration: 0.25, velocity: 0.95 });
          }
        }
      }

      if (Math.abs(beat - startBeat) < 1e-6 && Math.abs(beatInBar) < 1e-6 && energyLevel >= 5) {
        notes.push({ pitch: CRASH, onset: beat, duration: 1.0, velocity: 1.0 });
        if (energyLevel >= 8) {
          notes.push({ pitch: CRASH2, onset: beat, duration: 1.0, velocity: 0.9 });
        }
      }
    }

    return notes;
  }
}
