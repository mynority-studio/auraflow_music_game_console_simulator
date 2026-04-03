import { NoteData, Tonality } from "../../types";
import { ICounterMelodyIdiom, CounterMelodyContext } from "./ICounterMelodyIdiom";
import { HarmonyCore } from "../../composing/HarmonyCore";
import { PRNGManager } from "../../../utils/PRNG";

export abstract class BaseCounterMelodyIdiom implements ICounterMelodyIdiom {
  protected abstract getPitchOptions(isDownbeat: boolean, chordTones: number[], scalePcs: number[], tonality?: Tonality): number[];

  generate(ctx: CounterMelodyContext): NoteData[] {
    const { chord, energyLevel, melodyNotes } = ctx;
    const notes: NoteData[] = [];
    // S-2 合规：从 ctx 参数读取，替代 GlobalContext 读取
    const keyOffset = ctx.keyOffset ?? chord.keyOffset ?? 0;
    const chordTones = HarmonyCore.getChordTones(chord, 72 - keyOffset);
    const scalePcs = HarmonyCore.getSafeScalePitches(chord, ctx.tonality ?? Tonality.Major);

    // 🌟 Determine Interplay Mode based on Section ID and Type for methodology
    const sectionId = ctx.activeSection?.name || "default";
    const sectionName = ctx.activeSection?.name || "Verse";
    let hash = 0;
    for (let i = 0; i < sectionId.length; i++) {
      hash = (hash << 5) - hash + sectionId.charCodeAt(i);
      hash |= 0;
    }
    
    let interplayMode = 'CallAndResponse';
    if (sectionName === 'Chorus' || sectionName === 'Outro') {
        // High energy: Thicken the lead (Parallel Harmony or Octave Doubling)
        const modes = ['ParallelHarmony', 'OctaveDoubling', 'CallAndResponse'];
        interplayMode = modes[Math.abs(hash) % 3];
    } else if (sectionName === 'PreChorus') {
        // Building tension: Mix of dialogue and thickening
        const modes = ['ParallelHarmony', 'CallAndResponse'];
        interplayMode = modes[Math.abs(hash) % 2];
    } else {
        // Verse, Intro, Interlude: Mostly dialogue
        const modes = ['CallAndResponse', 'CallAndResponse', 'ParallelHarmony'];
        interplayMode = modes[Math.abs(hash) % 3];
    }

    if (interplayMode === 'ParallelHarmony' || interplayMode === 'OctaveDoubling') {
      // 🌟 Parallel Harmony or Octave Doubling Mode
      const localMelody = melodyNotes.filter(m => m.onset >= chord.startBeat && m.onset < chord.endBeat);
      for (const mNote of localMelody) {
        let targetPitch = mNote.pitch;
        if (interplayMode === 'OctaveDoubling') {
          targetPitch = mNote.pitch > 72 ? mNote.pitch - 12 : mNote.pitch + 12;
        } else {
          // Parallel Harmony: 3rd or 6th below
          const interval = PRNGManager.next() > 0.5 ? 3 : 5; // 3 or 5 scale steps below (approx 3rd or 6th)
          const mPc = mNote.pitch % 12;
          let scaleIndex = scalePcs.indexOf(mPc);
          if (scaleIndex === -1) {
            // Not in scale, find nearest
            let minDiff = 99;
            for (let i = 0; i < scalePcs.length; i++) {
              const diff = Math.min(Math.abs(scalePcs[i] - mPc), 12 - Math.abs(scalePcs[i] - mPc));
              if (diff < minDiff) {
                minDiff = diff;
                scaleIndex = i;
              }
            }
          }
          const targetScaleIndex = (scaleIndex - interval + scalePcs.length * 2) % scalePcs.length;
          const targetPc = scalePcs[targetScaleIndex];
          let diff = targetPc - mPc;
          if (diff > 0) diff -= 12; // Ensure it's below
          targetPitch = mNote.pitch + diff;
          
          // Ensure it's a chord tone if possible, or at least safe
          if (!chordTones.map(ct => ct % 12).includes(targetPitch % 12) && PRNGManager.next() > 0.5) {
             // Snap to nearest chord tone below
             let nearestCtDiff = -12; // default to octave below if nothing found
             for (const ct of chordTones) {
                 const ctDiff = (ct % 12) - mPc > 0 ? (ct % 12) - mPc - 12 : (ct % 12) - mPc;
                 if (ctDiff < 0 && ctDiff > nearestCtDiff) {
                     nearestCtDiff = ctDiff;
                 }
             }
             targetPitch = mNote.pitch + nearestCtDiff;
          }
        }

        notes.push({
          pitch: targetPitch,
          onset: mNote.onset,
          duration: mNote.duration,
          velocity: mNote.velocity * 0.8,
        });
      }
      return this.deduplicateNotes(notes);
    }

    // 🌟 Call and Response Mode (Original Logic)
    let lastPitch = chordTones[0];
    let isActive = false;
    let phraseEndBeat = 0;

    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.5) {
      const localMelody = melodyNotes.filter(m => m.onset >= beat - 0.5 && m.onset < beat + 1.5);
      const isMelodyDense = localMelody.length > 2;
      const melodyActive = localMelody.length > 0;
      
      let avgMelodyPitch = 72;
      let melodyDirection = 0; // 1 for up, -1 for down, 0 for flat
      if (melodyActive) {
          avgMelodyPitch = localMelody.reduce((sum, m) => sum + m.pitch, 0) / localMelody.length;
          if (localMelody.length >= 2) {
              const firstPitch = localMelody[0].pitch;
              const lastPitch = localMelody[localMelody.length - 1].pitch;
              if (lastPitch > firstPitch) melodyDirection = 1;
              else if (lastPitch < firstPitch) melodyDirection = -1;
          }
      }

      if (isMelodyDense) {
        isActive = false;
        if (PRNGManager.next() > 0.5 && notes.length === 0) {
          let targetPitch = chordTones[1];
          // 🌟 Counter-melody contrast: Contrary motion and register separation
          if (avgMelodyPitch > 66 && avgMelodyPitch < 78) {
              targetPitch = PRNGManager.next() > 0.5 ? chordTones[1] - 12 : chordTones[1] + 12;
          } else if (avgMelodyPitch >= 78) {
              targetPitch = chordTones[1] - 12; // Melody is high, counter goes low
          } else {
              targetPitch = chordTones[1] + 12; // Melody is low, counter goes high
          }
          notes.push({
            pitch: targetPitch,
            onset: beat,
            duration: Math.min(2.0, chord.endBeat - beat),
            velocity: 0.5,
          });
        }
        continue;
      }

      if (isActive && beat >= phraseEndBeat) {
        isActive = false;
      }

      if (!isActive && beat >= phraseEndBeat) {
        if (PRNGManager.next() > 0.3) {
          isActive = true;
          let maxDuration = 2.0;
          const nextMelody = melodyNotes.find((m) => m.onset > beat);
          if (nextMelody) {
            maxDuration = Math.min(maxDuration, Math.max(0, nextMelody.onset - beat - 0.25));
          }
          phraseEndBeat = beat + maxDuration;

          const previousMelodyPhrase = melodyNotes.filter(m => m.onset >= beat - 4 && m.onset < beat);
          if (previousMelodyPhrase.length >= 3 && previousMelodyPhrase.length <= 8 && PRNGManager.next() > 0.4) {
              const firstOnset = previousMelodyPhrase[0].onset;
              for (const mNote of previousMelodyPhrase) {
                  const relativeOnset = mNote.onset - firstOnset;
                  const newOnset = beat + relativeOnset;
                  if (newOnset >= phraseEndBeat) break;
                  
                  const pitchPc = mNote.pitch % 12;
                  let targetPc = chordTones[0] % 12;
                  let minDiff = 99;
                  for (const ct of chordTones) {
                      const diff = Math.min(Math.abs((ct % 12) - pitchPc), 12 - Math.abs((ct % 12) - pitchPc));
                      if (diff < minDiff) {
                          minDiff = diff;
                          targetPc = ct % 12;
                      }
                  }
                  
                  let finalPitch = targetPc + 72;
                  if (mNote.pitch > previousMelodyPhrase[0].pitch) finalPitch += 12;
                  if (finalPitch > 84) finalPitch -= 12;
                  if (finalPitch < 60) finalPitch += 12;
                  
                  notes.push({
                      pitch: finalPitch,
                      onset: newOnset,
                      duration: Math.min(mNote.duration, phraseEndBeat - newOnset),
                      velocity: mNote.velocity * 0.85
                  });
              }
              beat += Math.max(0, maxDuration - 0.5);
              continue;
          }
        }
      }

      if (isActive && beat < phraseEndBeat) {
        const isDownbeat = Math.abs(beat % 1) < 1e-6;
        
        const pitchOptions = this.getPitchOptions(isDownbeat, chordTones, scalePcs, ctx.tonality ?? Tonality.Major);

        let duration = 0.5;
        if (PRNGManager.next() > 0.6) {
          duration = 1.0;
        } else if (PRNGManager.next() > 0.8) {
          duration = 2.0;
        }

        duration = Math.min(duration, phraseEndBeat - beat);

        const getNearestOctave = (pc: number, target: number) => {
          const tPc = ((pc % 12) + 12) % 12;
          const refPc = ((target % 12) + 12) % 12;
          let diff = tPc - refPc;
          if (diff > 6) diff -= 12;
          if (diff < -6) diff += 12;
          return target + diff;
        };

        const pitch = pitchOptions.reduce((prev, curr) => {
          const prevNearest = getNearestOctave(prev, lastPitch);
          const currNearest = getNearestOctave(curr, lastPitch);
          return Math.abs(currNearest - lastPitch) < Math.abs(prevNearest - lastPitch) ? curr : prev;
        });

        let finalPitch = getNearestOctave(pitch, lastPitch);
        
        // 🌟 Counter-melody contrast: Contrary motion
        if (melodyDirection === 1 && finalPitch > lastPitch) {
            // Melody went up, but we are going up too. Try to go down instead.
            finalPitch -= 12;
        } else if (melodyDirection === -1 && finalPitch < lastPitch) {
            // Melody went down, but we are going down too. Try to go up instead.
            finalPitch += 12;
        }

        if (finalPitch < 60) finalPitch += 12;
        if (finalPitch > 84) finalPitch -= 12;

        if (duration > 0) {
          notes.push({
            pitch: finalPitch,
            onset: beat,
            duration,
            velocity: 0.6 + (energyLevel / 10) * 0.2,
          });
          lastPitch = finalPitch;
        }

        beat += Math.max(0, duration - 0.5);
      }
    }

    return this.deduplicateNotes(notes);
  }

  // P-1 合规：数组 + some() 替代 Set 去重，同时避免字符串拼接 (M-2)
  private deduplicateNotes(notes: NoteData[]): NoteData[] {
    const result: NoteData[] = [];
    for (const note of notes) {
      const isDuplicate = result.some(r => r.pitch === note.pitch && Math.abs(r.onset - note.onset) < 1e-6);
      if (!isDuplicate) {
        result.push(note);
      }
    }
    return result;
  }
}
