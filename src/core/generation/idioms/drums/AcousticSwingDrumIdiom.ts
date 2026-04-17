// AcousticSwingDrumIdiom — Acoustic Swing 鼓组 Idiom（Jazz/Lo-fi Swing 节拍）
// 适用场景：高 swing（>0.55）、中低能量（3-6）、低切分、Lo-fi 子风格

import { NoteData, SectionType } from '../../types';
import { DrumIdiomContext, IDrumIdiom } from './IDrumIdiom';
import { PRNGManager } from '../../../utils/PRNG';

export class AcousticSwingDrumIdiom implements IDrumIdiom {
  readonly name = 'AcousticSwing';

  score(ctx: DrumIdiomContext): number {
    const { energyLevel, grooveSyncopation, swing, subgenre, sectionType } = ctx;
    let s = 30;
    if (swing > 0.55) s += 25;
    if (energyLevel >= 3 && energyLevel <= 6) s += 20;
    if (grooveSyncopation < 0.3) s += 10;
    if (subgenre === 'Lo-fi') s += 15;
    if (sectionType === SectionType.Bridge || sectionType === SectionType.Solo_Bridge) s += 10;
    return Math.min(100, s);
  }

  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, beatsPerBar, KICK, SNARE, CHH, OHH, CRASH, CROSS_STICK, TOM_LOW, RIDE, grooveDensity, grooveSyncopation } = ctx;

    if (energyLevel <= 2) return notes;

    for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      const isDownbeat = Math.abs(beatInBar) < 1e-6;

      // Jazz: Light kick on 1, sometimes 3
      if (isDownbeat && PRNGManager.next() < grooveDensity * 1.5) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.5 });
      } else if (Math.abs(beatInBar - 2) < 1e-6 && PRNGManager.next() < grooveSyncopation * 0.8) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.4 });
      }

      // Jazz: Cross-stick or light snare comping
      if (Math.abs(beatInBar - 1) < 1e-6 || Math.abs(beatInBar - 3) < 1e-6) {
        if (PRNGManager.next() < grooveDensity) {
          notes.push({ pitch: energyLevel > 5 ? SNARE : CROSS_STICK, onset: beat, duration: 0.1, velocity: 0.5 });
        }
      } else if (Math.abs(beatInBar - 2.5) < 1e-6 || Math.abs(beatInBar - 3.5) < 1e-6) {
        if (PRNGManager.next() < grooveSyncopation * 0.5) {
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.4 });
        }
      }

      // Jazz: Ride cymbal pattern (ding-ding-da-ding)
      if (Math.abs(beat % 1) < 1e-6) {
        notes.push({ pitch: RIDE, onset: beat, duration: 0.1, velocity: 0.7 });
      } else if (Math.abs(beat % 1 - 0.75) < 1e-6) {
        if (PRNGManager.next() < grooveDensity * 1.5) {
          notes.push({ pitch: RIDE, onset: beat, duration: 0.1, velocity: 0.5 });
        }
      }

      // Jazz: Hi-hat pedal on 2 and 4
      if (Math.abs(beatInBar - 1) < 1e-6 || Math.abs(beatInBar - 3) < 1e-6) {
        notes.push({ pitch: 44, onset: beat, duration: 0.1, velocity: 0.6 }); // 44 = Pedal Hi-Hat (GM)
      }
    }

    return notes;
  }
}
