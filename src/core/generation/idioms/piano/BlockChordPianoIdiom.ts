import { NoteData, SectionType } from "../../types";
import { PianoIdiomContext } from "./IPianoIdiom";
import { BasePianoIdiom } from "./BasePianoIdiom";
import { PRNGManager } from "../../../utils/PRNG";
import { HarmonyCore } from "../../composing/HarmonyCore";

export class BlockChordPianoIdiom extends BasePianoIdiom {
  generate(ctx: PianoIdiomContext): NoteData[] {
    const notes: NoteData[] = [];
    const { chord, energyLevel, melodyNotes, beatsPerBar, isSparseSection, isSectionEnd, nextEnergyLevel, nextChord, pianoStyle, textureType, grooveDensity, grooveSyncopation } = ctx;
    const voicedTones = this.getVoicedTones(ctx);

    // S-2 合规：从 ctx.activeSection 读取（由 TextureMapper 注入）
    const activeSection = ctx.activeSection ?? null;
    const isJazz = pianoStyle === 'jazz';
    const isNeoSoulOrRnB = pianoStyle === 'neosoul';

    let effectiveTexture = textureType;
    if (activeSection?.name === 'Intro_A') {
        effectiveTexture = "Arpeggio"; // 🌟 前奏前半段强制使用分解和弦
    } else if (activeSection?.name === 'Intro_B') {
        effectiveTexture = "Block"; // 🌟 前奏后半段强制使用柱式和弦或混合织体
    }

    // 🌟 解决“听感太赶”：长音铺底 (Pad/Sustained) 或低能量段落，强制使用全音符
    if (effectiveTexture === "Pad" || effectiveTexture === "Sustained" || (energyLevel <= 3 && activeSection?.name !== 'Intro_A')) {
      const padDuration = Math.min((chord.endBeat - chord.startBeat) * 1.0, 8);
      const hasMelody = melodyNotes.some(m => m.onset >= chord.startBeat && m.onset < chord.endBeat);
      const padVelocity = hasMelody ? 0.35 : 0.6;
      // 🌟 开放排列 (Open Voicing)：增加空间感与电影感
      const openTones = voicedTones.length >= 3 && PRNGManager.next() > 0.3 
        ? [voicedTones[0], voicedTones[2], voicedTones[1] + 12, ...(voicedTones.slice(3).map(t => t + 12))] 
        : voicedTones;
      this.addBlockChord(notes, chord.startBeat, padDuration, padVelocity, openTones);
      return notes;
    }

    // 🌟 Generic Arpeggio for non-electronic styles
    if (effectiveTexture === "Arpeggio") {
      const scalePcs = HarmonyCore.getSafeScalePitches(
        chord,
        // S-2 合规：从 ctx.tonality 读取（由 TextureMapper 注入），回退为 'Major'
        ctx.tonality ?? 'Major'
      );
      // 🌟 打破根音起手：随机从三音、五音或七音开始
      const startIdx = PRNGManager.next() > 0.6 && voicedTones.length > 1 ? (PRNGManager.next() > 0.5 ? 1 : voicedTones.length - 1) : 0;
      let currentArpPitch = voicedTones[startIdx];
      let arpDirection = 1; // 1: 向上, -1: 向下

      for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.25) {
        if (Math.abs(beat % 0.5) >= 1e-6) continue;
        const isChordStart = beat === chord.startBeat;
        const beatInBar = beat % beatsPerBar;
        const melodySinging = melodyNotes.some(
          (m) =>
            (m.onset >= beat - 0.25 && m.onset < beat + 1.0) ||
            (m.onset < beat && m.onset + m.duration > beat),
        );

        let baseVelocity = melodySinging ? 0.45 : 0.6;
        if (isSparseSection) baseVelocity -= 0.1;

        // 🌟 跨界融合 (Cross-genre Fusion): 应用 GrooveMask
let maskAccent = 0;

        if (isChordStart) {
          currentArpPitch = voicedTones[0];
        } else {
          const isStrongBeat = Math.abs(beat % 1) < 1e-6;
          const stepSize = PRNGManager.next() < 0.8 ? 1 : 2;

          if (currentArpPitch > 70) arpDirection = -1;
          if (currentArpPitch < 50) arpDirection = 1;

          if (PRNGManager.next() < 0.3) arpDirection *= -1;

          currentArpPitch = HarmonyCore.shiftDiatonic(
            currentArpPitch,
            scalePcs,
            stepSize * arpDirection,
          );

          if (isStrongBeat && PRNGManager.next() < 0.7) {
            let closestChordTone = voicedTones[0];
            let minDiff = 1000;
            for (const ct of voicedTones) {
              for (let oct = -1; oct <= 1; oct++) {
                const testPitch = ct + oct * 12;
                const diff = Math.abs(currentArpPitch - testPitch);
                if (diff < minDiff) {
                  minDiff = diff;
                  closestChordTone = testPitch;
                }
              }
            }
            currentArpPitch = closestChordTone;
          }
        }

        let vel = baseVelocity * (Math.abs(beat % 1) < 1e-6 ? 1.0 : 0.8);
        if (melodySinging) vel *= 0.8;
        if (maskAccent === 1) vel *= 1.2; // 🌟 强调 GrooveMask 的重音

        // 🌟 结合 GrooveMask 决定是否发声
        const shouldPlay = maskAccent === 1 || PRNGManager.next() < grooveDensity;

        if (shouldPlay) {
            notes.push({
              pitch: currentArpPitch,
              onset: beat,
              duration: 0.5,
              velocity: vel,
            });
        }
      }
      return notes;
    }

    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.25) {
      const barsLeftTotal = (chord.endBeat - beat) / beatsPerBar;
      const isTransitionToHighEnergy = nextEnergyLevel && nextEnergyLevel > energyLevel + 1;
      if (isSectionEnd && barsLeftTotal <= 0.5 && isTransitionToHighEnergy && PRNGManager.next() > 0.3) {
        break; // 伴奏提前半小节停止，制造真空期
      }

      const isChordStart = beat === chord.startBeat;
      const beatInBar = beat % beatsPerBar;
      const melodySinging = melodyNotes.some(
        (m) =>
          (m.onset >= beat - 0.25 && m.onset < beat + 1.0) ||
          (m.onset < beat && m.onset + m.duration > beat),
      );

      let baseVelocity = melodySinging ? 0.45 : 0.6;
      if (isSparseSection) baseVelocity -= 0.1;

      // 🌟 跨界融合 (Cross-genre Fusion): 应用 GrooveMask
let maskAccent = 0;

      if (isNeoSoulOrRnB && melodySinging && (beatInBar === 0 || beatInBar === 2) && PRNGManager.next() < 0.4) {
        continue;
      }

      if (effectiveTexture === "Synth_Pulse") {
        const step = energyLevel >= 8 ? 0.5 : 1.0;
        if (Math.abs(beat % step) < 1e-6) {
          const pulseVel = baseVelocity * (Math.abs(beat % 1) < 1e-6 ? 1.0 : 0.8);
          this.addBlockChord(notes, beat, step * 0.9, pulseVel, voicedTones);
        } else if (energyLevel >= 7 && Math.abs(beat % 1 - 0.5) < 1e-6 && PRNGManager.next() > 0.5) {
          this.addBlockChord(notes, beat, 0.5, baseVelocity * 0.9, voicedTones);
        }
        continue;
      }

      const isFillZone = beat >= chord.endBeat - 1.0;
      const isBuildUp = activeSection?.type === SectionType.BuildUp || (isFillZone && nextEnergyLevel && nextEnergyLevel > energyLevel + 1);

      if (isBuildUp) {
        const barsLeft = (chord.endBeat - beat) / beatsPerBar;
        let buildUpStep = 0.5;
        if (barsLeft <= 1.0) buildUpStep = 0.25;

        if (beat % buildUpStep === 0) {
          const buildVel = baseVelocity * (0.6 + (1 - barsLeft / 2) * 0.6);
          this.addBlockChord(notes, beat, buildUpStep * 0.8, buildVel, voicedTones);
        }
        continue;
      }

      const mutationChance = energyLevel / 10;
      if (energyLevel > 5 && !melodySinging && chord.endBeat - beat >= 2.0 && Math.abs(beat % 1) < 1e-6 && PRNGManager.next() < mutationChance * 0.05) {
        this.addBlockChord(notes, beat, 0.5, baseVelocity * 1.1, voicedTones);
        this.addBlockChord(notes, beat + 0.5, 0.5, baseVelocity * 1.0, voicedTones);
        this.addBlockChord(notes, beat + 1.5, 0.5, baseVelocity * 0.9, voicedTones);
        beat += 1.75;
        continue;
      }

      if (isSparseSection || energyLevel <= 4) {
        if (isChordStart) {
          notes.push({ pitch: voicedTones[0], onset: beat, duration: 4.0, velocity: baseVelocity });
          const innerVoicePitch = voicedTones.find(p => p > voicedTones[0] && p < 60);
          if (innerVoicePitch !== undefined) {
            notes.push({ pitch: innerVoicePitch, onset: beat, duration: 4.0, velocity: baseVelocity * 0.9 });
          }

          const rightHandDelay = PRNGManager.next() > 0.5 ? 0.5 : 1.0;
          if (beat + rightHandDelay < chord.endBeat) {
            let tonesToPlay = voicedTones.filter(p => p >= 60);
            if (tonesToPlay.length === 0) tonesToPlay = voicedTones.slice(1);
            
            if (isJazz && PRNGManager.next() > 0.7 && tonesToPlay.length > 0) {
                const clashPitch = tonesToPlay[tonesToPlay.length - 1] - 1;
                if (!tonesToPlay.includes(clashPitch)) tonesToPlay.push(clashPitch);
            }

            this.addBlockChord(notes, beat + rightHandDelay, 2.0, baseVelocity * 0.85, tonesToPlay);
          }
        } else if (!melodySinging && beatInBar === 2.5) {
          let tonesToPlay = voicedTones.filter(p => p >= 60);
          if (tonesToPlay.length === 0) tonesToPlay = voicedTones.slice(1);
          this.addBlockChord(notes, beat, 1.5, baseVelocity * 0.9, tonesToPlay);
        } else if (!melodySinging && beat >= chord.endBeat - 1.0 && PRNGManager.next() > 0.4 && !(isSparseSection && isSectionEnd)) {
          const topNote = voicedTones[voicedTones.length - 1];
          notes.push({ pitch: topNote, onset: beat, duration: 1.0, velocity: baseVelocity * 0.9 });
          if (PRNGManager.next() > 0.5 && voicedTones.length > 1) {
            notes.push({ pitch: voicedTones[voicedTones.length - 2], onset: beat + 0.5, duration: 0.5, velocity: baseVelocity * 0.8 });
          }
          break;
        }
      } else if (energyLevel > 4 && energyLevel <= 7) {
        if (isChordStart) {
          notes.push({ pitch: voicedTones[0], onset: beat, duration: 2.0, velocity: baseVelocity });
        }

        const isSyncopatedHit = (beatInBar === 1.5 || beatInBar === 2.5 || beatInBar === 3.5) && PRNGManager.next() < grooveSyncopation * 1.5;

        if (isSyncopatedHit || maskAccent === 1) {
          if (melodySinging) {
            if (PRNGManager.next() > 0.3)
              this.addBlockChord(notes, beat, 0.5, baseVelocity * (maskAccent === 1 ? 0.9 : 0.75), [voicedTones[1], voicedTones[2]]);
          } else {
            this.addBlockChord(notes, beat, 0.75, baseVelocity * (maskAccent === 1 ? 1.1 : 0.95), voicedTones.slice(1));
          }
        } else if (!melodySinging && beatInBar >= 3.5 && PRNGManager.next() > 0.5) {
          if (nextChord) {
            // 🌟 减七和弦经过音 (Diminished 7th Passing Chord) 增加和声推动力
            const nextRoot = HarmonyCore.getChordTones(nextChord, 55)[0];
            const approachRoot = PRNGManager.next() > 0.5 ? nextRoot - 1 : nextRoot + 1;
            const dim7Tones = [approachRoot, approachRoot + 3, approachRoot + 6, approachRoot + 9];
            this.addBlockChord(notes, beat, chord.endBeat - beat, baseVelocity * 0.85, dim7Tones);
            break; // 填满当前小节剩余部分
          }
        }
      } else {
        // 🌟 方案 A: 左右手律动分离与幽灵音 (L/R Hand Split & Ghost Notes)
        const leftHandPitch = voicedTones[0];
        const leftHandGhostPitch = leftHandPitch + 7; // 5度幽灵音
        const rightHandTones = voicedTones.length > 1 ? voicedTones.slice(1) : voicedTones;
        
        const openTones = voicedTones.length >= 3 && PRNGManager.next() > 0.5 
          ? [voicedTones[0], voicedTones[2], voicedTones[1] + 12] 
          : voicedTones;

        // 🌟 方案 C: 动态加花 (Dynamic Fills) - 侦测主旋律气口
        let isMelodyGap = false;
        if (!melodySinging && beatInBar === 2.0) {
            const hasMelodySoon = melodyNotes.some(m => m.onset >= beat && m.onset < beat + 1.5);
            if (!hasMelodySoon) isMelodyGap = true;
        }

        if (isMelodyGap && PRNGManager.next() > 0.4) {
            // 触发加花：高音区跳进 (Leap)
            const fillVel = baseVelocity * 1.1;
            const topNote = rightHandTones[rightHandTones.length - 1];
            notes.push({ pitch: topNote + 12, onset: beat, duration: 0.25, velocity: fillVel });
            notes.push({ pitch: topNote + 7, onset: beat + 0.25, duration: 0.25, velocity: fillVel * 0.9 });
            notes.push({ pitch: topNote + 12, onset: beat + 0.5, duration: 0.5, velocity: fillVel });
            this.addBlockChord(notes, beat + 1.0, 1.0, baseVelocity, rightHandTones);
            beat += 1.75; // 跳过当前小节剩余的常规律动
            continue;
        }

        if (isChordStart) {
          // 正拍：左右手同时弹奏 (或者八分音符空拍起手)
          if (PRNGManager.next() > 0.8) {
            this.addBlockChord(notes, beat + 0.5, 0.5, baseVelocity * 1.1, openTones);
          } else {
            // 左手根音支撑
            notes.push({ pitch: leftHandPitch, onset: beat, duration: 1.0, velocity: baseVelocity * 1.1 });
            // 右手和弦
            this.addBlockChord(notes, beat, 1.0, baseVelocity * 1.0, rightHandTones);
          }
        }

        const isSyncopatedHit = (Math.abs(beatInBar - 1.5) < 1e-6 || Math.abs(beatInBar - 2.5) < 1e-6 || Math.abs(beatInBar - 3.5) < 1e-6) && PRNGManager.next() < grooveSyncopation * 1.5;
        const is16thPush = (Math.abs(beatInBar - 0.75) < 1e-6 || Math.abs(beatInBar - 1.75) < 1e-6 || Math.abs(beatInBar - 2.75) < 1e-6 || Math.abs(beatInBar - 3.75) < 1e-6) && PRNGManager.next() < grooveDensity;

        // 🌟 左手幽灵音 (Ghost Note) - 在弱拍加入极轻的五度音，增强律动滚动感
        if ((Math.abs(beatInBar - 1.5) < 1e-6 || Math.abs(beatInBar - 2.5) < 1e-6) && PRNGManager.next() > 0.5) {
            notes.push({ pitch: leftHandGhostPitch, onset: beat, duration: 0.25, velocity: baseVelocity * 0.4 }); 
        }

        if (isSyncopatedHit || maskAccent === 1) {
          if (melodySinging && PRNGManager.next() > 0.4) {
            this.addBlockChord(notes, beat, 0.5, baseVelocity * (maskAccent === 1 ? 0.95 : 0.85), rightHandTones.slice(0, 2));
          } else if (!melodySinging) {
            this.addBlockChord(notes, beat, 0.5, baseVelocity * (maskAccent === 1 ? 1.15 : 1.05), rightHandTones);
          }
        } else if (!melodySinging && is16thPush && PRNGManager.next() > 0.6) {
          if (beatInBar === 3.75 && nextChord) {
            const nextTones = HarmonyCore.getChordTones(nextChord, 55);
            this.addBlockChord(notes, beat, 0.25, baseVelocity * 0.9, nextTones.slice(1));
          } else {
            this.addBlockChord(notes, beat, 0.25, baseVelocity * 0.8, rightHandTones.slice(0, 2));
          }
        } else if (!melodySinging && Math.abs(beat % 1) < 1e-6 && beatInBar !== 0 && PRNGManager.next() > 0.7) {
          this.addBlockChord(notes, beat, 0.25, baseVelocity * 0.9, rightHandTones);
        }
      }
    }

    return notes;
  }

  private addBlockChord(
    notes: NoteData[],
    onset: number,
    duration: number,
    baseVel: number,
    tones: number[],
  ) {
    tones.forEach((p) => {
      if (p !== undefined && !isNaN(p)) {
        notes.push({
          pitch: p,
          onset: onset,
          duration: duration,
          velocity: baseVel,
        });
      }
    });
  }
}

