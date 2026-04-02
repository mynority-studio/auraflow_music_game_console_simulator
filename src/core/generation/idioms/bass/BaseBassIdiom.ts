import { NoteData, SectionType } from "../../types";
import { BassIdiomContext, IBassIdiom } from "./IBassIdiom";
import { PRNGManager } from "../../../utils/PRNG";
import { GlobalContext } from "../../GlobalContext";

export abstract class BaseBassIdiom implements IBassIdiom {
  abstract generateBassPattern(ctx: BassIdiomContext): NoteData[];

  generate(ctx: BassIdiomContext): NoteData[] {
    const { chord, energyLevel, isCinematic, isBallad, bassSound } = ctx;
    
    const isBowedString = bassSound === 'Cello' || bassSound === 'Contrabass' || bassSound?.includes('String');

    // 🌟 解决“听感太赶”：低能量段落、弓弦乐器强制全音符贝斯
    if (energyLevel <= 3 || isCinematic || isBallad || isBowedString) {
      return [{
        pitch: ctx.targetBassPitch,
        onset: chord.startBeat,
        duration: chord.endBeat - chord.startBeat,
        velocity: isBowedString ? 0.6 : 0.7,
      }];
    }

    let notes = this.generateBassPattern(ctx);

    // 🌟 动态节奏突变 (Rhythmic Mutation): 贝斯加花 (Bass Fills) & Build-ups
    const isFillZone = (beat: number) => beat >= chord.endBeat - 1.0;
    const activeSection = GlobalContext.getActiveSection();
    const isBuildUp =
      activeSection?.type === SectionType.BuildUp ||
      (ctx.nextEnergyLevel > energyLevel + 1);
    
    const bassStyle = ctx.idiomPreferences?.bassStyle || "pop";
    const isEurodance = bassStyle === "eurodance";
    const isWalkingBass = bassStyle === "jazz";

    if (isBuildUp && !isEurodance && !isWalkingBass) {
      // Build-up 贝斯逻辑：通常是连续的 8 分或 16 分音符根音连击，力度渐强
      const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;
      const buildUpNotes: NoteData[] = [];
      const baseVel = 0.8;
      for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.25) {
        const barsLeft = (chord.endBeat - beat) / beatsPerBar;
        let buildUpStep = 0.5; // 8th notes
        if (barsLeft <= 1.0) buildUpStep = 0.25; // 16th notes

        if (Math.abs(beat % buildUpStep) < 1e-6) {
          const buildVel = baseVel * (0.6 + (1 - barsLeft / 2) * 0.6); // 渐强
          buildUpNotes.push({
            pitch: ctx.targetBassPitch,
            onset: beat,
            duration: buildUpStep * 0.8,
            velocity: buildVel,
          });
        }
      }
      notes = buildUpNotes;
    } else {
      // Rhythmic mutation (Fills)
      const mutationChance = energyLevel / 10;
      for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.25) {
        const isValidTriggerPoint = Math.abs(beat % 1) < 1e-6 || GlobalContext.isGrooveHit(beat);
        // Remove melodyActive logic
        const melodyActive = false;
        if (
          isFillZone(beat) &&
          isValidTriggerPoint &&
          !melodyActive &&
          PRNGManager.next() < mutationChance * 0.05
        ) {
          // Remove existing notes in this zone
          notes = notes.filter(n => n.onset < beat);
          const step = 0.5;
          for (let i = 0; i < 2; i++) {
            const runPitch = i === 0 ? ctx.octaveMidi : ctx.fifthMidi; // 八度或五度，使用和弦内音避免不和谐
            notes.push({
              pitch: runPitch,
              onset: beat + i * step,
              duration: step * 1.2,
              velocity: 0.8 * 0.9,
            });
          }
          break; // 结束当前和弦的贝斯生成
        }
      }
    }

    // Quantize bass note durations to multiples of 0.25
    notes.forEach((n) => {
      n.duration = Math.max(0.25, Math.round(n.duration * 4) / 4);
    });

    return this.deduplicateNotes(notes);
  }

  private deduplicateNotes(notes: NoteData[]): NoteData[] {
    const uniqueNotes: NoteData[] = [];
    const seen = new Set<string>();
    for (const note of notes) {
      const key = `${note.pitch}-${note.onset}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueNotes.push(note);
      }
    }
    return uniqueNotes;
  }
}
