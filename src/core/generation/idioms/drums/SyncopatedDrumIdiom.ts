// SyncopatedDrumIdiom — 切分鼓组 Idiom（Funk/Groove 向）
// 适用场景：高切分（>0.5）、中高能量（5-8）、Funk 向

import { NoteData, SectionType } from '../../types';
import { DrumIdiomContext, IDrumIdiom } from './IDrumIdiom';
import { PRNGManager } from '../../../utils/PRNG';

export class SyncopatedDrumIdiom implements IDrumIdiom {
  readonly name = 'Syncopated';

  score(ctx: DrumIdiomContext): number {
    const { grooveSyncopation, energyLevel, subgenre, sectionType } = ctx;
    let s = 40;
    if (grooveSyncopation > 0.5) s += 25;
    if (energyLevel >= 5 && energyLevel <= 8) s += 20;
    if (subgenre === 'Funk') s += 15;
    if (sectionType === SectionType.Chorus || sectionType === SectionType.Bridge) s += 5;
    return Math.min(100, s);
  }

  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, KICK, SNARE, CHH, OHH, grooveDensity, grooveSyncopation } = ctx;

    if (energyLevel <= 2) return notes;

    for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      const beatInBar = beat % ctx.beatsPerBar;
      const isDownbeat = beatInBar === 0;

      let maskAccent = 0;
      const hasMelodyAccent = ctx.melodyNotes?.some(n => Math.abs(n.onset - beat) < 0.05);
      if (hasMelodyAccent) {
          maskAccent = 1;
      }

      if (isDownbeat) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.9 * (maskAccent === 1 ? 1.1 : 1.0) });
      } else if (beatInBar === 1.5 || beatInBar === 2.5) {
        if (PRNGManager.next() < grooveSyncopation * 1.5 || maskAccent === 1) {
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.8 * (maskAccent === 1 ? 1.1 : 1.0) });
        }
      } else if (beatInBar === 3.75) {
        let kickProb = grooveDensity;
        const hasBassGhost = ctx.bassNotes?.some(n => Math.abs(n.onset - beat) < 0.05 && n.velocity < 0.6);
        if (hasBassGhost) {
            kickProb = 0.6;
        }
        if (PRNGManager.next() < kickProb || maskAccent === 1) {
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.7 * (maskAccent === 1 ? 1.2 : 1.0) });
        }
      }

      if (beatInBar === 1 || beatInBar === 3) {
        notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.95 * (maskAccent === 1 ? 1.05 : 1.0) });
      } else if (beatInBar === 1.25 || beatInBar === 1.75 || beatInBar === 2.25 || beatInBar === 3.25) {
        if (PRNGManager.next() < grooveDensity * 0.8 || maskAccent === 1) {
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.3 * (maskAccent === 1 ? 1.5 : 1.0) });
        }
      } else if (maskAccent === 1 && !isDownbeat && beatInBar !== 1.5 && beatInBar !== 2.5 && beatInBar !== 3.75) {
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.5 });
      }

      if (beat % 0.25 === 0) {
        let cymbalPitch = CHH;
        let cymbalVel = beat % 0.5 === 0 ? 0.8 : 0.5;
        if (beat % 1 === 0.5 && (PRNGManager.next() < grooveSyncopation * 0.8 || maskAccent === 1)) {
          cymbalPitch = OHH;
          cymbalVel = 0.85;
        }
        notes.push({ pitch: cymbalPitch, onset: beat, duration: 0.1, velocity: cymbalVel * (maskAccent === 1 ? 1.2 : 1.0) });
      }
    }

    return notes;
  }
}
