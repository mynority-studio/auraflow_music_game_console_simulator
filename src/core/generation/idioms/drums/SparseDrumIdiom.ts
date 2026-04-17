// SparseDrumIdiom — 稀疏鼓组 Idiom（低能量段落、留白打击）
// 适用场景：低能量（1-3）、Intro/Outro/Break/PreOutro 段落

import { NoteData, SectionType } from '../../types';
import { DrumIdiomContext, IDrumIdiom } from './IDrumIdiom';
import { PRNGManager } from '../../../utils/PRNG';

export class SparseDrumIdiom implements IDrumIdiom {
  readonly name = 'Sparse';

  score(ctx: DrumIdiomContext): number {
    const { energyLevel, sectionType } = ctx;
    let s = 30;
    if (energyLevel <= 3) s += 40;
    else if (energyLevel <= 5) s += 15;
    if (sectionType === SectionType.Intro || sectionType === SectionType.Outro || sectionType === SectionType.Break || sectionType === SectionType.PreOutro) s += 15;
    return Math.min(100, s);
  }

  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, beatsPerBar, KICK, SNARE, CHH, OHH, CRASH, CROSS_STICK, TOM_LOW, RIDE, grooveDensity, grooveSyncopation } = ctx;

    if (energyLevel <= 3) return notes;

    for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      const beatInBar = beat % beatsPerBar;
      const isDownbeat = Math.abs(beatInBar) < 1e-6;

      if (isDownbeat && PRNGManager.next() < grooveDensity * 1.5) {
        notes.push({ pitch: TOM_LOW, onset: beat, duration: 0.1, velocity: 0.9 });
      } else if (Math.abs(beatInBar - 2) < 1e-6 && PRNGManager.next() < grooveSyncopation * 1.5) {
        notes.push({ pitch: TOM_LOW, onset: beat, duration: 0.1, velocity: 0.8 });
      }

      if (Math.abs(beatInBar - 1) < 1e-6 || Math.abs(beatInBar - 3) < 1e-6) {
        if (PRNGManager.next() < grooveDensity * 0.5) {
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.85 });
        }
      }

      if (Math.abs(beat % 1) < 1e-6) {
        if (PRNGManager.next() < grooveDensity * 0.3) {
          notes.push({ pitch: CRASH, onset: beat, duration: 0.1, velocity: 0.7 });
        }
      }
    }
    return notes;
  }
}
