// SteadyDrumIdiom — 稳拍鼓组 Idiom（Pop/Rock 常规节拍）
// 适用场景：中等能量（4-7）、低切分、直拍感、Pop 向

import { NoteData, SectionType } from '../../types';
import { DrumIdiomContext, IDrumIdiom } from './IDrumIdiom';
import { PRNGManager } from '../../../utils/PRNG';

export class SteadyDrumIdiom implements IDrumIdiom {
  readonly name = 'Steady';

  score(ctx: DrumIdiomContext): number {
    const { energyLevel, grooveSyncopation, swing, subgenre, sectionType } = ctx;
    let s = 50;
    if (energyLevel >= 4 && energyLevel <= 7) s += 25;
    if (grooveSyncopation < 0.4) s += 15;
    if (swing < 0.55) s += 10;
    if (subgenre === 'Pop') s += 15;
    if (sectionType === SectionType.Verse || sectionType === SectionType.Chorus) s += 5;
    return Math.min(100, s);
  }

  generate(ctx: DrumIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { startBeat, endBeat, energyLevel, nextEnergyLevel, beatsPerBar, is68, isHalfTime, laybackOffset, KICK, SNARE, CHH, OHH, CRASH, CROSS_STICK, TOM_LOW, RIDE, grooveDensity, grooveSyncopation } = ctx;

    if (energyLevel <= 2) return notes;

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
      const hasMelodyAccent = ctx.melodyNotes?.some(n => Math.abs(n.onset - beat) < 0.05);
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
      } else if (maskAccent === 1 && beatInBar % 0.5 !== 0) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.85 });
      }

      if (isSnareBeat) {
        notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.95 * (maskAccent === 1 ? 1.05 : 1.0) });
      } else if (maskAccent === 1 && !isDownbeat && beatInBar !== 2.5 && beatInBar !== 1.5 && beatInBar !== 3.5) {
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.5 });
      }

      if (beat % 0.5 === 0) {
        let cymbalPitch = CHH;
        let cymbalVel = beat % 1 === 0 ? 0.8 : 0.6;
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

      if (beatInBar === 1.75 || beatInBar === 3.75) {
        let kickProb = grooveDensity * 0.5;
        const hasBassGhost = ctx.bassNotes?.some(n => Math.abs(n.onset - beat) < 0.05 && n.velocity < 0.6);
        if (hasBassGhost) {
            kickProb = 0.6;
        }
        if (PRNGManager.next() < kickProb || maskAccent === 1) {
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.6 * (maskAccent === 1 ? 1.2 : 1.0) });
        }
      }
    }

    return notes;
  }
}
