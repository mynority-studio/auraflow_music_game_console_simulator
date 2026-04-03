import { PRNGManager } from "../../utils/PRNG";
import { NoteData, GeneratedChord, GenerationParams, SectionMetadata, Tonality } from "../types";
import { HarmonyCore } from "../composing/HarmonyCore";

/** S-2 合规：替代 GlobalContext 读取，由 Orchestrator 显式传入 */
export interface TextureRenderContext {
    bpm: number;
    keyOffset: number;
    tonality: Tonality;
    timeSignature: [number, number];
    activeSection: SectionMetadata | null;
}

// Drum MIDI pitches
const KICK = 36;
const SNARE = 38;
const CHH = 42;
const OHH = 46;
const CRASH = 49;
const RIDE = 51;
const TOM_HI = 50;
const TOM_LOW = 43;

export class TextureMapper {
  public static generateBassLine(
    chord: GeneratedChord,
    energyLevel: number,
    isSparseSection: boolean = false,
    isSectionEnd: boolean = false,
    params?: GenerationParams,
    melodyNotes: NoteData[] = [],
    isBassSolo: boolean = false,
    _unused?: unknown,
    nextChord?: GeneratedChord,
    nextEnergyLevel: number = 3,
    renderCtx?: TextureRenderContext,
  ): NoteData[] {
    // S-2 合规：从 renderCtx 参数读取（Orchestrator 始终提供 renderCtx）
    const keyOffset = chord.keyOffset !== undefined ? chord.keyOffset : (renderCtx?.keyOffset ?? 0);
    const tonality = renderCtx?.tonality ?? Tonality.Major;
    const activeSection = renderCtx?.activeSection ?? null;
    const bpm = renderCtx?.bpm ?? 120;

    // Fix Bass Range: Ensure final bass root (after keyOffset) is strictly between E1 (28) and Eb2 (39)
    let finalRoot = (chord.root + keyOffset) % 12;
    finalRoot += 24; // C1 to B1 (24 to 35)
    if (finalRoot < 28) finalRoot += 12; // E1 to Eb2 (28 to 39)

    // Calculate the target center relative to C (before keyOffset is added in Orchestrator)
    const targetCenterForChordTones = finalRoot - keyOffset;

    let nextTargetCenter = 36;
    if (nextChord) {
      const nextKeyOffset = nextChord.keyOffset !== undefined ? nextChord.keyOffset : keyOffset;
      let nextFinalRoot = (nextChord.root + nextKeyOffset) % 12;
      nextFinalRoot += 24;
      if (nextFinalRoot < 28) nextFinalRoot += 12;
      nextTargetCenter = nextFinalRoot - nextKeyOffset;
    }

    const bassTones = HarmonyCore.getChordTones(chord, targetCenterForChordTones);
    const rootMidi = bassTones[0];
    const fifthMidi = bassTones.length > 2 ? bassTones[2] : rootMidi + 7;
    const octaveMidi = rootMidi + 12;

    const safeScalePcs = HarmonyCore.getSafeScalePitches(chord, tonality);

    const isElectronic = params?.rhythm?.strictGrid === true;

    // EDM Pedal Point: in electronic high-energy sections, chance of sustained key root
    let targetBassPitch = rootMidi;
    if (isElectronic && energyLevel >= 5 && PRNGManager.next() < 0.1) {
      let finalKeyRoot = keyOffset % 12;
      finalKeyRoot += 24;
      if (finalKeyRoot < 28) finalKeyRoot += 12;
      targetBassPitch = finalKeyRoot - keyOffset;
    }

    // Smooth bass voice leading: allow inversions in sparse/melodic contexts
    const allowInversion = false;

    if (allowInversion && nextChord && PRNGManager.next() < 0.2) {
      const thirdMidi = bassTones.length > 1 ? bassTones[1] : rootMidi + 4;
      const nextBassTones = HarmonyCore.getChordTones(nextChord, nextTargetCenter);
      const nextRoot = nextBassTones[0];
      const distRoot = Math.abs(rootMidi - nextRoot);
      const distThird = Math.abs(thirdMidi - nextRoot);
      const distFifth = Math.abs(fifthMidi - nextRoot);
      if (distThird > 0 && distThird < distRoot && distThird <= 2) {
        targetBassPitch = thirdMidi;
      } else if (distFifth > 0 && distFifth < distRoot && distFifth <= 2) {
        targetBassPitch = fifthMidi;
      }
    }

    // --- Inline bass generation algorithm ---
    const notes: NoteData[] = [];
    const chordStart = chord.startBeat;
    const chordEnd = chord.endBeat;
    const chordLen = chordEnd - chordStart;

    // Determine step size based on energy
    // low energy (1-3): whole note / half note, mid (4-6): quarter, high (7-10): 8th notes
    let stepSize: number;
    if (energyLevel <= 3 || isSparseSection) {
      stepSize = Math.min(chordLen, 2.0); // half notes or whole chord
    } else if (energyLevel <= 6) {
      stepSize = 1.0; // quarter notes
    } else {
      stepSize = 0.5; // 8th notes
    }

    // max ~200 notes for a chord span (C-4 compliance)
    let beat = chordStart;
    let noteIndex = 0;
    while (beat < chordEnd - 1e-6) {
      const remaining = chordEnd - beat;
      const dur = Math.min(stepSize, remaining);

      let pitch = targetBassPitch;
      // Occasional 5th on off-beats for movement
      if (noteIndex > 0 && PRNGManager.next() < 0.2) {
        pitch = fifthMidi;
      }
      // At high energy, occasional octave jump
      if (energyLevel >= 7 && PRNGManager.next() < 0.15) {
        pitch = octaveMidi;
      }

      const baseVel = 0.5 + energyLevel * 0.04;
      // Accent beat 1 of each bar
      const timeSignature = renderCtx?.timeSignature ?? [4, 4] as [number, number] /* safe: literal tuple default */;
      const beatsPerBar = timeSignature[0] || 4;
      const beatInBar = beat % beatsPerBar;
      const accent = Math.abs(beatInBar) < 1e-6 ? 0.1 : 0;
      const velocity = Math.min(1.0, baseVel + accent + (PRNGManager.next() * 0.05 - 0.025));

      notes.push({
        pitch,
        onset: beat,
        duration: dur,
        velocity,
      });

      beat += stepSize;
      noteIndex++;
    }

    // Section-end: add approach note to next chord root (walking bass feel)
    if (isSectionEnd && nextChord && notes.length > 0) {
      const last = notes[notes.length - 1];
      const nextBassTones2 = HarmonyCore.getChordTones(nextChord, nextTargetCenter);
      const nextRoot = nextBassTones2[0];
      // Chromatic approach: one semitone below next root
      const approachPitch = nextRoot - 1;
      if (last.onset + last.duration < chordEnd - 1e-6) {
        notes.push({
          pitch: approachPitch,
          onset: chordEnd - 0.5,
          duration: 0.5,
          velocity: 0.7,
        });
      }
    }

    return this.deduplicateNotes(this.truncateToChordEnd(notes, chordEnd));
  }

  // Signature riff generator for Funk / Rock / EDM intros
  public static generateSignatureRiff(
    scale: number[],
    rootNote: number,
    lengthBeats: number,
    startBeat: number
  ): NoteData[] {
    const riff: NoteData[] = [];
    const rhythmMask = [1, 0, 1, 1, 0, 1, 0, 0]; // Syncopated mask
    let currentBeat = 0;

    while (currentBeat < lengthBeats) {
        for (let i = 0; i < rhythmMask.length; i++) {
            if (currentBeat >= lengthBeats) break;

            if (rhythmMask[i] === 1) {
                const pitch = rootNote + scale[Math.floor(PRNGManager.next() * scale.length)];
                riff.push({
                    pitch: pitch,
                    onset: startBeat + currentBeat,
                    duration: 0.25,
                    velocity: 100
                });
            }
            currentBeat += 0.5; // 1/8 note step
        }
    }
    return riff;
  }

  public static generateDrumGroove(
    startBeat: number,
    endBeat: number,
    energyLevel: number,
    isIntro: boolean = false,
    isOutro: boolean = false,
    params?: GenerationParams,
    swingRatio: number = 0.5,
    nextEnergyLevel: number = 3,
    hasFullGrooveStarted: boolean = false,
    grooveRatio?: { foundation: number; comping: number; color: number },
    drumStyle: string = "steady",
    melodyNotes: NoteData[] = [],
    renderCtx?: TextureRenderContext,
  ): NoteData[] {
    const timeSignature = renderCtx?.timeSignature ?? [4, 4] as [number, number] /* safe: literal tuple default */;
    const beatsPerBar = timeSignature[0] || 4;
    const bpm = renderCtx?.bpm ?? 120;
    const activeSection = renderCtx?.activeSection ?? null;
    const isSwing = swingRatio > 0.5;
    const isHalfTime = activeSection?.groove?.feel === "half-time";
    const grooveDensity = activeSection?.groove?.density ?? 0.5;

    const notes: NoteData[] = [];
    // max ~500 drum notes per section (C-4 compliance)

    const stepSize = 0.25; // 16th note resolution
    let beat = startBeat;

    while (beat < endBeat - 1e-6) {
      const beatInBar = ((beat - startBeat) % beatsPerBar);
      const isDownbeat = Math.abs(beatInBar) < 1e-6;
      const isBeat3 = Math.abs(beatInBar - 2.0) < 1e-6;
      const isBeat2 = Math.abs(beatInBar - 1.0) < 1e-6;
      const isBeat4 = Math.abs(beatInBar - 3.0) < 1e-6;
      const is8thNote = Math.abs(beatInBar % 0.5) < 1e-6;
      const is16thNote = Math.abs(beatInBar % 0.25) < 1e-6;

      const baseVel = 0.45 + energyLevel * 0.05;

      // --- Kick drum: beats 1 and 3 ---
      if (isDownbeat || isBeat3) {
        const vel = Math.min(1.0, baseVel + 0.15 + (PRNGManager.next() * 0.04 - 0.02));
        notes.push({ pitch: KICK, onset: beat, duration: 0.25, velocity: vel });
      }
      // Extra kicks at high energy on certain 8th positions
      if (energyLevel >= 7 && !isDownbeat && !isBeat3 && is8thNote && PRNGManager.next() < 0.2) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.25, velocity: baseVel * 0.8 });
      }

      // --- Snare: beats 2 and 4 ---
      if (isBeat2 || isBeat4) {
        const vel = Math.min(1.0, baseVel + 0.1 + (PRNGManager.next() * 0.04 - 0.02));
        if (!isHalfTime || isBeat4) {
          notes.push({ pitch: SNARE, onset: beat, duration: 0.25, velocity: vel });
        }
      }
      // Ghost notes on 16th note positions at higher energy
      if (energyLevel >= 5 && is16thNote && !is8thNote && PRNGManager.next() < 0.15 * grooveDensity) {
        notes.push({ pitch: SNARE, onset: beat, duration: 0.125, velocity: baseVel * 0.4 });
      }

      // --- Hi-hat: every 8th note ---
      if (is8thNote) {
        // Intro: lighter hi-hat
        if (isIntro && !hasFullGrooveStarted) {
          if (PRNGManager.next() < 0.5) {
            notes.push({ pitch: CHH, onset: beat, duration: 0.25, velocity: baseVel * 0.5 });
          }
        } else {
          const hhVel = isDownbeat ? baseVel * 0.9 : baseVel * 0.65;
          notes.push({ pitch: CHH, onset: beat, duration: 0.25, velocity: Math.min(1.0, hhVel + PRNGManager.next() * 0.03) });
        }
      }
      // 16th hi-hats at very high energy
      if (energyLevel >= 8 && is16thNote && !is8thNote && PRNGManager.next() < 0.4) {
        notes.push({ pitch: CHH, onset: beat, duration: 0.125, velocity: baseVel * 0.35 });
      }

      // --- Open hi-hat: occasional on off-beats at mid-high energy ---
      if (energyLevel >= 5 && is8thNote && !isDownbeat && !isBeat2 && !isBeat3 && !isBeat4 && PRNGManager.next() < 0.1) {
        notes.push({ pitch: OHH, onset: beat, duration: 0.5, velocity: baseVel * 0.6 });
      }

      // --- Crash: on downbeat of first bar, or section transitions ---
      if (isDownbeat && Math.abs(beat - startBeat) < 1e-6 && hasFullGrooveStarted) {
        notes.push({ pitch: CRASH, onset: beat, duration: 1.0, velocity: Math.min(1.0, baseVel + 0.2) });
      }

      // --- Ride: replace hi-hat in low-energy or swing contexts ---
      if (isSwing && is8thNote && energyLevel <= 5) {
        notes.push({ pitch: RIDE, onset: beat, duration: 0.5, velocity: baseVel * 0.55 });
      }

      // --- Tom fills near section end (last bar) ---
      if (isOutro && (endBeat - beat) < beatsPerBar && is8thNote && PRNGManager.next() < 0.25) {
        const tomPitch = PRNGManager.next() < 0.5 ? TOM_HI : TOM_LOW;
        notes.push({ pitch: tomPitch, onset: beat, duration: 0.25, velocity: baseVel * 0.7 });
      }

      beat += stepSize;
    }

    return notes;
  }

  public static generateCounterMelody(
    chord: GeneratedChord,
    energyLevel: number,
    melodyNotes: NoteData[],
    params?: GenerationParams,
    renderCtx?: TextureRenderContext,
  ): NoteData[] {
    // Simple sustained chord-tone counter melody
    const keyOffset = chord.keyOffset !== undefined ? chord.keyOffset : (renderCtx?.keyOffset ?? 0);
    const tonality = renderCtx?.tonality ?? Tonality.Major;

    // Use chord tones centered around C4 area (MIDI 60)
    const chordTones = HarmonyCore.getChordTones(chord, 60);
    // Pick 3rd or 5th of chord for the counter melody voice
    const targetPitch = chordTones.length > 2
      ? (PRNGManager.next() < 0.6 ? chordTones[1] : chordTones[2])  // 3rd (60%) or 5th (40%)
      : chordTones[0] + 7; // fallback to 5th interval

    const chordDur = chord.endBeat - chord.startBeat;
    const velocity = 0.35 + energyLevel * 0.03;

    const notes: NoteData[] = [];
    // One sustained note per chord
    notes.push({
      pitch: targetPitch,
      onset: chord.startBeat,
      duration: Math.max(chordDur - 0.125, 0.5), // slightly shorter than chord for breathing room
      velocity: Math.min(1.0, velocity),
    });

    return this.truncateToChordEnd(notes, chord.endBeat);
  }

  public static generateChordTexture(
    chord: GeneratedChord,
    energyLevel: number,
    textureType: string,
    isSparseSection: boolean = false,
    isSectionEnd: boolean = false,
    melodyNotes: NoteData[] = [],
    nextChord?: GeneratedChord,
    params?: GenerationParams,
    prevVoicing?: number[],
    nextEnergyLevel?: number,
    pianoStyle: string = "block-chord",
    renderCtx?: TextureRenderContext,
  ): NoteData[] {
    const activeSection = renderCtx?.activeSection ?? null;
    const bpm = renderCtx?.bpm ?? 120;
    const keyOffset = chord.keyOffset !== undefined ? chord.keyOffset : (renderCtx?.keyOffset ?? 0);

    // Get chord tones centered around C4 (MIDI 60) for piano/chord register
    const chordTones = HarmonyCore.getChordTones(chord, 60);
    const chordStart = chord.startBeat;
    const chordEnd = chord.endBeat;
    const chordLen = chordEnd - chordStart;
    const baseVelocity = 0.4 + energyLevel * 0.04;

    const notes: NoteData[] = [];
    // max ~100 chord notes per chord (C-4 compliance)

    // Normalize texture type for matching
    const texLower = textureType.toLowerCase ? textureType.toLowerCase() : textureType;
    const isArpeggio = texLower === 'arpeggio' || texLower === 'broken';
    const isPad = texLower === 'pad' || texLower === 'sustained';

    if (isArpeggio) {
      // --- Arpeggio: cycle through chord tones one at a time ---
      const step = energyLevel >= 6 ? 0.25 : 0.5; // 16th or 8th note arpeggios
      let beat = chordStart;
      let idx = 0;
      while (beat < chordEnd - 1e-6) {
        const toneIdx = idx % chordTones.length;
        const vel = Math.min(1.0, baseVelocity + (PRNGManager.next() * 0.06 - 0.03));
        notes.push({
          pitch: chordTones[toneIdx],
          onset: beat,
          duration: step,
          velocity: vel,
        });
        beat += step;
        idx++;
      }
    } else if (isPad) {
      // --- Pad: long sustained chord tones ---
      for (let i = 0; i < chordTones.length; i++) {
        notes.push({
          pitch: chordTones[i],
          onset: chordStart,
          duration: Math.max(chordLen - 0.0625, 0.5),
          velocity: Math.min(1.0, baseVelocity * 0.8 + PRNGManager.next() * 0.02),
        });
      }
    } else {
      // --- Block chord (default): all chord tones at once on each beat ---
      const step = energyLevel <= 3 ? 2.0 : (energyLevel <= 6 ? 1.0 : 0.5);
      let beat = chordStart;
      while (beat < chordEnd - 1e-6) {
        const remaining = chordEnd - beat;
        const dur = Math.min(step, remaining);
        const vel = Math.min(1.0, baseVelocity + (PRNGManager.next() * 0.06 - 0.03));
        for (let i = 0; i < chordTones.length; i++) {
          notes.push({
            pitch: chordTones[i],
            onset: beat,
            duration: dur,
            velocity: vel,
          });
        }
        beat += step;
      }
    }

    // Sparse section end: let the last chord ring out
    let generatedNotes = notes;
    if (isSparseSection && isSectionEnd && generatedNotes.length > 0) {
      generatedNotes.forEach((n) => {
        n.duration = Math.min(Math.max(n.duration, 2.0), 3.0);
      });
    } else {
      generatedNotes = this.truncateToChordEnd(generatedNotes, chordEnd);
    }
    return this.deduplicateNotes(generatedNotes);
  }

  private static truncateToChordEnd(notes: NoteData[], chordEndBeat: number): NoteData[] {
    return notes.map(n => {
      if (n.onset >= chordEndBeat) return null; // Note starts after chord ends
      if (n.onset + n.duration > chordEndBeat) {
        return { ...n, duration: chordEndBeat - n.onset };
      }
      return n;
    // safe: map returns NoteData | null; filter(n => n !== null) guarantees all elements are NoteData
    }).filter(n => n !== null) as NoteData[];
  }

  // P-1 合規：数组 + some() 替代 Set 去重
  private static deduplicateNotes(notes: NoteData[]): NoteData[] {
    const result: NoteData[] = [];
    for (const note of notes) {
      const isDuplicate = result.some(r => r.pitch === note.pitch && Math.abs(r.onset - note.onset) < 1e-6);
      if (!isDuplicate) {
        result.push(note);
      }
    }
    return result;
  }

  // Riff generator: simple root-based rhythmic pattern
  public static generateRiff(
    chord: GeneratedChord,
    energyLevel: number,
    params?: GenerationParams,
    renderCtx?: TextureRenderContext,
  ): NoteData[] {
    const keyOffset = chord.keyOffset !== undefined ? chord.keyOffset : (renderCtx?.keyOffset ?? 0);
    const tonality = renderCtx?.tonality ?? Tonality.Major;
    const chordTones = HarmonyCore.getChordTones(chord, 60);
    const root = chordTones[0];
    const fifth = chordTones.length > 2 ? chordTones[2] : root + 7;

    const notes: NoteData[] = [];
    const chordStart = chord.startBeat;
    const chordEnd = chord.endBeat;
    // max ~50 riff notes per chord (C-4 compliance)

    // Simple rhythmic riff pattern: root-root-5th-root with syncopation
    const pattern = [0, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0];
    const pitchPattern = [root, root, fifth, root, fifth, root, root, fifth];

    for (let i = 0; i < pattern.length; i++) {
      const onset = chordStart + pattern[i];
      if (onset >= chordEnd - 1e-6) break;
      // Skip some notes randomly for variation
      if (i > 0 && PRNGManager.next() < 0.2) continue;

      const vel = 0.6 + energyLevel * 0.03 + (PRNGManager.next() * 0.06 - 0.03);
      notes.push({
        pitch: pitchPattern[i],
        onset,
        duration: 0.25,
        velocity: Math.min(1.0, vel),
      });
    }

    return this.truncateToChordEnd(notes, chordEnd);
  }

  // Vocal harmony: add harmony a 3rd above melody notes (scale-aware)
  public static generateVocalHarmony(
    melodyNotes: NoteData[],
    chords: GeneratedChord[],
    params: GenerationParams | undefined,
    energyLevel: number,
    tonality: Tonality,
    keyOffset?: number,
  ): NoteData[] {
    const resolvedKeyOffset = keyOffset ?? 0;
    const notes: NoteData[] = [];
    // max ~300 harmony notes for a full song (C-4 compliance)

    for (let ni = 0; ni < melodyNotes.length; ni++) {
      const mel = melodyNotes[ni];
      // Only harmonize a portion of notes (more at higher energy)
      const harmonyProb = 0.3 + energyLevel * 0.06;
      if (PRNGManager.next() > harmonyProb) continue;

      // Find the chord active at this melody note's onset
      let activeChord: GeneratedChord | null = null;
      for (let ci = 0; ci < chords.length; ci++) {
        if (chords[ci].startBeat <= mel.onset + 1e-6 && chords[ci].endBeat > mel.onset + 1e-6) {
          activeChord = chords[ci];
          break;
        }
      }

      if (activeChord === null) continue;

      // Get scale pitches for the active chord
      const scalePcs = HarmonyCore.getSafeScalePitches(activeChord, tonality);
      const melPc = mel.pitch % 12;

      // Find the melody note's position in the scale, then go up 2 scale steps (a 3rd)
      // Build ascending scale from melody pitch
      let harmonyPitch = mel.pitch + 4; // default: major 3rd up
      // Try to find a scale-aware 3rd
      let foundInScale = false;
      for (let s = 0; s < scalePcs.length; s++) {
        if (Math.abs(scalePcs[s] - melPc) < 1e-6) {
          // Go up 2 scale degrees
          const targetPc = scalePcs[(s + 2) % scalePcs.length];
          let interval = targetPc - melPc;
          if (interval <= 0) interval += 12;
          harmonyPitch = mel.pitch + interval;
          foundInScale = true;
          break;
        }
      }

      notes.push({
        pitch: harmonyPitch,
        onset: mel.onset,
        duration: mel.duration,
        velocity: mel.velocity * 0.7, // softer than lead
      });
    }

    return notes;
  }
}
