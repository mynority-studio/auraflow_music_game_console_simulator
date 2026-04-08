import { PRNGManager } from "../../utils/PRNG";
import { NoteData, GeneratedChord, Tonality } from "../types";
import { HarmonyCore } from "../composing/HarmonyCore";
import { GlobalContext } from "../GlobalContext";

export class TextureMapper {
  // 🌟 绝对音区隔离：强制 clamp 到安全音域
  private static clampToRange(notes: NoteData[], minPitch: number, maxPitch: number): void {
    for (let i = 0; i < notes.length; i++) {
      while (notes[i].pitch < minPitch) notes[i].pitch += 12;
      while (notes[i].pitch > maxPitch) notes[i].pitch -= 12;
    }
  }
  /**
   * 生成贝斯线：每个和弦上放根音（强拍）+ 五音（弱拍）
   * max ~8 notes per chord (4/4 time)
   */
  public static generateBassLine(
    chord: GeneratedChord,
    energyLevel: number,
    isSparseSection: boolean = false,
    isSectionEnd: boolean = false,
    melodyNotes: NoteData[] = [],
    isBassSolo: boolean = false,
    nextChord?: GeneratedChord,
    nextEnergyLevel: number = 3,
  ): NoteData[] {
    // Bass Range: Ensure final bass root (after keyOffset) is strictly between E1 (28) and Eb2 (39)
    const keyOffset = chord.keyOffset !== undefined ? chord.keyOffset : (GlobalContext.currentKeyOffset || 0);
    let finalRoot = (chord.root + keyOffset) % 12;
    finalRoot += 24; // C1 to B1 (24 to 35)
    if (finalRoot < 28) finalRoot += 12; // E1 to Eb2 (28 to 39)

    // Calculate the target center relative to C (before keyOffset is added in Orchestrator)
    const targetCenterForChordTones = finalRoot - keyOffset;

    let nextTargetCenter = 36;
    if (nextChord) {
      const nextKeyOffset = nextChord.keyOffset !== undefined ? nextChord.keyOffset : (GlobalContext.currentKeyOffset || 0);
      let nextFinalRoot = (nextChord.root + nextKeyOffset) % 12;
      nextFinalRoot += 24;
      if (nextFinalRoot < 28) nextFinalRoot += 12;
      nextTargetCenter = nextFinalRoot - nextKeyOffset;
    }

    const bassTones = HarmonyCore.getChordTones(
      chord,
      targetCenterForChordTones,
    );
    const rootMidi = bassTones[0];
    const fifthMidi = bassTones.length > 2 ? bassTones[2] : rootMidi + 7;

    const safeScalePcs = HarmonyCore.getSafeScalePitches(
      chord,
      GlobalContext.currentTonality
    );

    const chordLen = chord.endBeat - chord.startBeat;
    const notes: NoteData[] = [];

    // Smooth bass line: check if inversion closer to next chord root
    let targetBassPitch = rootMidi;
    if (nextChord && PRNGManager.next() < 0.2 && (energyLevel <= 4)) {
      const nextBassTones = HarmonyCore.getChordTones(nextChord, nextTargetCenter);
      const nextRoot = nextBassTones[0];
      const thirdMidi = bassTones.length > 1 ? bassTones[1] : rootMidi + 4;
      const distRoot = Math.abs(rootMidi - nextRoot);
      const distThird = Math.abs(thirdMidi - nextRoot);
      const distFifth = Math.abs(fifthMidi - nextRoot);

      if (distThird > 0 && distThird < distRoot && distThird <= 2) {
        targetBassPitch = thirdMidi;
      } else if (distFifth > 0 && distFifth < distRoot && distFifth <= 2) {
        targetBassPitch = fifthMidi;
      }
    } else {
      // consume PRNG to keep sequence aligned regardless of branch
      PRNGManager.next();
    }

    if (isSparseSection || energyLevel <= 2) {
      // Sparse: just root on downbeat, half-note duration
      notes.push({
        pitch: targetBassPitch,
        onset: chord.startBeat,
        duration: Math.min(chordLen, 2),
        velocity: 0.7,
      });
    } else if (energyLevel <= 5) {
      // Medium: root on beat 1, fifth on beat 3 (or halfway)
      const halfLen = chordLen / 2;
      notes.push({
        pitch: targetBassPitch,
        onset: chord.startBeat,
        duration: Math.min(halfLen, 1),
        velocity: 0.8,
      });
      if (chordLen >= 2) {
        notes.push({
          pitch: fifthMidi,
          onset: chord.startBeat + halfLen,
          duration: Math.min(halfLen, 1),
          velocity: 0.65,
        });
      }
    } else {
      // High energy: root-fifth-root(octave)-fifth pattern, quarter notes
      const step = 1; // quarter note
      let beat = chord.startBeat;
      const pattern = [targetBassPitch, fifthMidi, targetBassPitch + 12, fifthMidi];
      let pi = 0;
      while (beat < chord.endBeat - 1e-6) {
        const pitch = pattern[pi % pattern.length];
        // Clamp to bass range
        const clampedPitch = pitch > 47 ? pitch - 12 : pitch;
        notes.push({
          pitch: clampedPitch,
          onset: beat,
          duration: Math.min(step, chord.endBeat - beat),
          velocity: 0.75 + (pi % 2 === 0 ? 0.1 : 0),
        });
        beat += step;
        pi++;
      }
    }

    // Approach note to next chord on section end
    if (isSectionEnd && nextChord && notes.length > 0) {
      const lastNote = notes[notes.length - 1];
      const approachBeat = chord.endBeat - 0.5;
      if (approachBeat > lastNote.onset + lastNote.duration - 1e-6) {
        const nextBassTones = HarmonyCore.getChordTones(nextChord, nextTargetCenter);
        const nextRoot = nextBassTones[0];
        // chromatic approach from below or above
        const approach = nextRoot - 1;
        const snapped = HarmonyCore.snapToScale(approach, safeScalePcs);
        notes.push({
          pitch: snapped,
          onset: approachBeat,
          duration: 0.5,
          velocity: 0.6,
        });
      }
    }

    const truncated = this.truncateToChordEnd(notes, chord.endBeat);
    this.clampToRange(truncated, 28, 47); // Bass: E1 ~ B2
    return this.deduplicateNotes(truncated);
  }

  /**
   * 前奏 Riff 生成器 — 纯内联计算，不依赖 idiom
   * max ~32 notes for 4-bar riff
   */
  public static generateSignatureRiff(
    scale: number[],
    rootNote: number,
    lengthBeats: number,
    startBeat: number
  ): NoteData[] {
    const riff: NoteData[] = [];
    const rhythmMask = [1, 0, 1, 1, 0, 1, 0, 0]; // 经典的切分节奏型
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
        currentBeat += 0.5;
      }
    }
    return riff;
  }

  /**
   * 鼓组生成：Kick 在 1/3 拍，Snare 在 2/4 拍，Hi-hat 每 0.5 拍
   * max ~200 notes for 8-bar section
   */
  public static generateDrumGroove(
    startBeat: number,
    endBeat: number,
    energyLevel: number,
    isIntro: boolean = false,
    isOutro: boolean = false,
    swingRatio: number = 0.5,
    nextEnergyLevel: number = 3,
    hasFullGrooveStarted: boolean = false,
    melodyNotes: NoteData[] = []
  ): NoteData[] {
    const KICK = 36;
    const SNARE = 38;
    const CHH = 42; // Closed hi-hat
    const OHH = 46; // Open hi-hat
    const CRASH = 49;

    const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;
    const notes: NoteData[] = [];

    // Intro: hi-hat only with optional crash on beat 1
    if (isIntro && !hasFullGrooveStarted) {
      let beat = startBeat;
      let isFirstBeat = true;
      while (beat < endBeat - 1e-6) {
        if (isFirstBeat) {
          notes.push({ pitch: CRASH, onset: beat, duration: 1, velocity: 0.7 });
          isFirstBeat = false;
        }
        notes.push({ pitch: CHH, onset: beat, duration: 0.25, velocity: 0.5 });
        beat += 0.5;
      }
      return notes;
    }

    let beat = startBeat;
    let barBeat = 0; // position within current bar (0-based)

    while (beat < endBeat - 1e-6) {
      barBeat = Math.round((beat - startBeat) * 4) % (beatsPerBar * 4); // in 16th note units
      const beatInBar = barBeat / 4; // in quarter note units

      // Kick: beats 1 and 3 (0-indexed: 0 and 2)
      if (Math.abs(beatInBar - 0) < 1e-6 || Math.abs(beatInBar - 2) < 1e-6) {
        notes.push({
          pitch: KICK,
          onset: beat,
          duration: 0.5,
          velocity: 0.85 + PRNGManager.next() * 0.1,
        });
      }

      // Snare: beats 2 and 4 (0-indexed: 1 and 3)
      if (Math.abs(beatInBar - 1) < 1e-6 || Math.abs(beatInBar - 3) < 1e-6) {
        notes.push({
          pitch: SNARE,
          onset: beat,
          duration: 0.25,
          velocity: 0.8 + PRNGManager.next() * 0.1,
        });
      }

      // Hi-hat: every 0.5 beat (8th notes)
      notes.push({
        pitch: CHH,
        onset: beat,
        duration: 0.15,
        velocity: 0.5 + (Math.abs(beatInBar % 1) < 1e-6 ? 0.15 : 0) + PRNGManager.next() * 0.05,
      });

      // High energy: add ghost notes on 16th notes
      if (energyLevel >= 7 && PRNGManager.next() < 0.3) {
        const ghostBeat = beat + 0.25;
        if (ghostBeat < endBeat - 1e-6) {
          notes.push({
            pitch: CHH,
            onset: ghostBeat,
            duration: 0.1,
            velocity: 0.35,
          });
        }
      }

      beat += 0.5;
    }

    // Outro fade: reduce velocity for last 2 bars
    if (isOutro) {
      const fadeStart = endBeat - beatsPerBar * 2;
      for (let i = 0; i < notes.length; i++) {
        if (notes[i].onset >= fadeStart) {
          const progress = (notes[i].onset - fadeStart) / (endBeat - fadeStart);
          notes[i] = { ...notes[i], velocity: notes[i].velocity * (1 - progress * 0.6) };
        }
      }
    }

    // Crash on first beat of section
    if (notes.length > 0 && energyLevel >= 5) {
      notes.push({ pitch: CRASH, onset: startBeat, duration: 1.5, velocity: 0.85 });
    }

    return notes;
  }

  /**
   * 副旋律生成：简单的三度平行
   * max ~50 notes per chord
   */
  public static generateCounterMelody(
    chord: GeneratedChord,
    energyLevel: number,
    melodyNotes: NoteData[],
  ): NoteData[] {
    const notes: NoteData[] = [];
    const safeScalePcs = HarmonyCore.getSafeScalePitches(chord, GlobalContext.currentTonality);

    // Filter melody notes in this chord's span
    const chordMelody = melodyNotes.filter(
      n => n.onset >= chord.startBeat - 1e-6 && n.onset < chord.endBeat - 1e-6
    );

    if (chordMelody.length === 0) return notes;

    // 🌟 节奏互锁：检测主旋律密度
    // 连续短音（<=0.5拍）超过 3 个 = 密集段，副旋律只放长音
    let consecutiveShort = 0;
    let isMelodyDense = false;
    for (let i = 0; i < chordMelody.length; i++) {
      if (chordMelody[i].duration <= 0.5) {
        consecutiveShort++;
        if (consecutiveShort >= 3) { isMelodyDense = true; break; }
      } else {
        consecutiveShort = 0;
      }
    }

    if (isMelodyDense) {
      // 密集段：副旋律只在和弦起始放一个长音（三度上方）
      const chordTones = HarmonyCore.getChordTones(chord, 72); // C5 附近
      let holdPitch = chordTones.length > 1 ? chordTones[1] : chordTones[0]; // 三音
      holdPitch = HarmonyCore.snapToScale(holdPitch, safeScalePcs);
      notes.push({
        pitch: holdPitch,
        onset: chord.startBeat,
        duration: Math.min(chord.endBeat - chord.startBeat, 4),
        velocity: 0.45,
      });
    } else {
      // 稀疏段：三度上方平行（高音区 C5-C6）
      for (let i = 0; i < chordMelody.length; i++) {
        const m = chordMelody[i];
        // 三度上方，推到 C5-C6 音域
        let counterPitch = m.pitch + 3;
        counterPitch = HarmonyCore.snapToScale(counterPitch, safeScalePcs);

        // 跳过同度/半音
        if (Math.abs(counterPitch - m.pitch) < 2) continue;

        notes.push({
          pitch: counterPitch,
          onset: m.onset,
          duration: m.duration,
          velocity: Math.min(m.velocity * 0.55, 0.65),
        });
      }
    }

    const truncated = this.truncateToChordEnd(notes, chord.endBeat);
    this.clampToRange(truncated, 72, 84); // Counter Melody: C5 ~ C6
    return truncated;
  }

  /**
   * 和弦织体生成：在和弦起始拍放 block chord
   * max ~20 notes per chord
   */
  public static generateChordTexture(
    chord: GeneratedChord,
    energyLevel: number,
    textureType: string,
    isSparseSection: boolean = false,
    isSectionEnd: boolean = false,
    melodyNotes: NoteData[] = [],
    nextChord?: GeneratedChord,
    prevVoicing?: number[],
    nextEnergyLevel?: number,
  ): NoteData[] {
    const notes: NoteData[] = [];
    const chordLen = chord.endBeat - chord.startBeat;
    const baseVelocity = 0.6;

    // Get chord tones centered around C4 (MIDI 60)
    let voicing: number[];
    if (prevVoicing && prevVoicing.length > 0) {
      voicing = HarmonyCore.getSmoothVoicing(chord, prevVoicing, 60);
    } else {
      voicing = HarmonyCore.getChordTones(chord, 60);
    }

    // Ensure all chord tones are >= C3 (48) to avoid clashing with bass
    voicing = voicing.map(p => p < 48 ? p + 12 : p);

    if (textureType === 'Pad' || isSparseSection) {
      // Pad: long sustained chord
      for (let i = 0; i < voicing.length; i++) {
        notes.push({
          pitch: voicing[i],
          onset: chord.startBeat,
          duration: Math.min(chordLen, 4),
          velocity: baseVelocity * 0.7,
        });
      }
    } else if (textureType === 'Arpeggio' || energyLevel >= 7) {
      // Arpeggio: spread chord tones across beats
      const step = chordLen / Math.max(voicing.length, 1);
      for (let i = 0; i < voicing.length; i++) {
        notes.push({
          pitch: voicing[i],
          onset: chord.startBeat + i * step,
          duration: Math.min(step * 1.5, chordLen - i * step),
          velocity: baseVelocity + PRNGManager.next() * 0.1,
        });
      }
    } else {
      // Block chord: all tones on downbeat, rhythmic re-attacks for higher energy
      const attackPoints: number[] = [chord.startBeat];

      if (energyLevel >= 5 && chordLen >= 2) {
        // Add re-attack on beat 3 (or halfway)
        attackPoints.push(chord.startBeat + chordLen / 2);
      }
      if (energyLevel >= 6 && chordLen >= 4) {
        // Add re-attacks on weak beats
        attackPoints.push(chord.startBeat + 1);
        attackPoints.push(chord.startBeat + 3);
      }

      // Sort and remove duplicates
      attackPoints.sort((a, b) => a - b);

      for (let ai = 0; ai < attackPoints.length; ai++) {
        const attackBeat = attackPoints[ai];
        if (attackBeat >= chord.endBeat - 1e-6) continue;
        const nextAttack = ai < attackPoints.length - 1 ? attackPoints[ai + 1] : chord.endBeat;
        const dur = Math.min(nextAttack - attackBeat, 2);

        for (let vi = 0; vi < voicing.length; vi++) {
          notes.push({
            pitch: voicing[vi],
            onset: attackBeat,
            duration: dur,
            velocity: baseVelocity * (ai === 0 ? 1.0 : 0.8),
          });
        }
      }
    }

    // Section end: let last chord ring out
    if (isSparseSection && isSectionEnd && notes.length > 0) {
      for (let i = 0; i < notes.length; i++) {
        notes[i] = { ...notes[i], duration: Math.min(Math.max(notes[i].duration, 2.0), 3.0) };
      }
    } else {
      const t = this.truncateToChordEnd(notes, chord.endBeat);
      this.clampToRange(t, 48, 60); // Chord: C3 ~ C4
      return this.deduplicateNotes(t);
    }

    this.clampToRange(notes, 48, 60); // Chord: C3 ~ C4
    return this.deduplicateNotes(notes);
  }

  /**
   * Riff 生成：基于和弦音的简单节奏型
   * max ~16 notes per chord
   */
  public static generateRiff(
    chord: GeneratedChord,
    energyLevel: number,
  ): NoteData[] {
    const chordTones = HarmonyCore.getChordTones(chord, 60);
    const safeScalePcs = HarmonyCore.getSafeScalePitches(chord, GlobalContext.currentTonality);
    const notes: NoteData[] = [];
    const chordLen = chord.endBeat - chord.startBeat;

    // Simple rhythmic riff using chord tones
    let beat = chord.startBeat;
    while (beat < chord.endBeat - 1e-6) {
      const toneIdx = Math.floor(PRNGManager.next() * chordTones.length);
      const pitch = chordTones[toneIdx];
      const dur = PRNGManager.next() < 0.5 ? 0.25 : 0.5;

      notes.push({
        pitch,
        onset: beat,
        duration: Math.min(dur, chord.endBeat - beat),
        velocity: 0.7 + PRNGManager.next() * 0.2,
      });

      beat += dur;
    }

    return this.truncateToChordEnd(notes, chord.endBeat);
  }

  /**
   * 人声和声：三度平行 (simplified from idiom-based system)
   * max ~100 notes per section
   */
  public static generateVocalHarmony(
    melodyNotes: NoteData[],
    chords: GeneratedChord[],
    energyLevel: number,
    tonality: Tonality
  ): NoteData[] {
    const notes: NoteData[] = [];

    for (let i = 0; i < melodyNotes.length; i++) {
      const m = melodyNotes[i];
      // Find the chord active at this melody note's onset
      let activeChord: GeneratedChord | null = null;
      for (let ci = 0; ci < chords.length; ci++) {
        if (m.onset >= chords[ci].startBeat - 1e-6 && m.onset < chords[ci].endBeat - 1e-6) {
          activeChord = chords[ci];
          break;
        }
      }
      if (!activeChord) continue;

      const safeScalePcs = HarmonyCore.getSafeScalePitches(activeChord, tonality);

      // Parallel third below
      let harmonyPitch = m.pitch - 4;
      harmonyPitch = HarmonyCore.snapToScale(harmonyPitch, safeScalePcs);

      // Skip unisons / semitones
      if (Math.abs(harmonyPitch - m.pitch) < 2) continue;

      // Only harmonize ~60% of notes to keep it musical
      if (PRNGManager.next() > 0.6) continue;

      notes.push({
        pitch: harmonyPitch,
        onset: m.onset,
        duration: m.duration,
        velocity: m.velocity * 0.55,
      });
    }

    return notes;
  }

  private static truncateToChordEnd(notes: NoteData[], chordEndBeat: number): NoteData[] {
    const result: NoteData[] = [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.onset >= chordEndBeat) continue;
      if (n.onset + n.duration > chordEndBeat) {
        result.push({ ...n, duration: chordEndBeat - n.onset });
      } else {
        result.push(n);
      }
    }
    return result;
  }

  private static deduplicateNotes(notes: NoteData[]): NoteData[] {
    // Sort by onset then pitch for deterministic dedup (D-3 compliant)
    const sorted = notes.slice().sort((a, b) => {
      const onsetDiff = a.onset - b.onset;
      if (Math.abs(onsetDiff) > 1e-6) return onsetDiff;
      return a.pitch - b.pitch;
    });

    const result: NoteData[] = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i === 0) {
        result.push(sorted[i]);
        continue;
      }
      const prev = sorted[i - 1];
      if (sorted[i].pitch === prev.pitch && Math.abs(sorted[i].onset - prev.onset) < 1e-6) {
        continue; // duplicate
      }
      result.push(sorted[i]);
    }
    return result;
  }
}
