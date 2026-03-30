import { globalPRNG } from '../../utils/PRNG';
import { NoteData, GeneratedChord } from "../types";
import { HarmonyCore } from "../composing/HarmonyCore";
import { GlobalContext } from "../GlobalContext";
import { getRandomRhythmCell } from "../melody/RhythmCells"; // 🌟 Import RhythmCells

export class TextureMapper {
  public static generateBassLine(chord: GeneratedChord, energyLevel: number, isSparseSection: boolean = false, isSectionEnd: boolean = false, styleId: string = "pop", melodyNotes: NoteData[] = [], isBassSolo: boolean = false, idiomPreferences?: any, nextChord?: GeneratedChord, nextEnergyLevel: number = 3): NoteData[] {
    const notes: NoteData[] =[];
    
    // 🌟 Fix Bass Range: Ensure final bass root (after keyOffset) is strictly between E1 (28) and Eb2 (39)
    const keyOffset = GlobalContext.currentKeyOffset || 0;
    let finalRoot = (chord.root + keyOffset) % 12;
    finalRoot += 24; // C1 to B1 (24 to 35)
    if (finalRoot < 28) finalRoot += 12; // E1 to Eb2 (28 to 39)
    
    // Calculate the target center relative to C (before keyOffset is added in Orchestrator)
    const targetCenterForChordTones = finalRoot - keyOffset;
    
    let nextTargetCenter = 36;
    if (nextChord) {
        let nextFinalRoot = (nextChord.root + keyOffset) % 12;
        nextFinalRoot += 24;
        if (nextFinalRoot < 28) nextFinalRoot += 12;
        nextTargetCenter = nextFinalRoot - keyOffset;
    }

    const bassTones = HarmonyCore.getChordTones(chord, targetCenterForChordTones);
    const rootMidi = bassTones[0]; 
    const thirdMidi = bassTones[1];
    const fifthMidi = bassTones[2];
    const seventhMidi = bassTones.length > 3 ? bassTones[3] : rootMidi + 12; // Default to octave if no 7th present to avoid dissonance

    
    const safeScalePcs = HarmonyCore.getSafeScalePitches(chord, GlobalContext.currentTonality);
    const willChoke = globalPRNG.next() < 0.2; 
    
    const isSlow = energyLevel <= 4;
    const isMid = energyLevel > 4 && energyLevel <= 7;
    const isFast = energyLevel > 7;

    const bassStyle = idiomPreferences?.bassStyle || 'pop';
    const isWalkingBass = bassStyle === 'jazz' || styleId.toLowerCase().includes('jazz') || styleId.toLowerCase().includes('swing');

    const isCinematic = styleId.toLowerCase().includes('cinematic') || styleId.toLowerCase().includes('ambient');
    const isBallad = styleId.toLowerCase().includes('ballad') || styleId.toLowerCase().includes('acoustic');
    const isFunk = styleId.toLowerCase().includes('funk') || styleId.toLowerCase().includes('disco');
    const isPopRock = styleId.toLowerCase().includes('pop') || styleId.toLowerCase().includes('rock');
    const isElectronic = styleId.toLowerCase().includes('electronic') || styleId.toLowerCase().includes('dance') || styleId.toLowerCase().includes('edm') || styleId.toLowerCase().includes('house');
    const isLatin = styleId.toLowerCase().includes('latin') || styleId.toLowerCase().includes('bossa');
    const isReggae = styleId.toLowerCase().includes('reggae');

    const activeSection = GlobalContext.getActiveSection();
    const grooveDensity = activeSection?.groove?.density ?? 0.5;
    const grooveSyncopation = activeSection?.groove?.syncopationProb ?? 0.2;

    // --- Phase 3 & 4: Riff-Driven Bassline Logic (Option A) ---
    if (activeSection?.isRiffDriven) {
        // Use RhythmCells to construct a highly rhythmic, repeating bass riff
        let currentBeat = chord.startBeat;
        while (currentBeat < chord.endBeat) {
            const cell = getRandomRhythmCell(styleId, energyLevel);
            
            let advanced = false;
            for (const duration of cell) {
                if (currentBeat + duration > chord.endBeat) break; // Don't overflow chord boundary
                
                // Pick pitch: mostly root, sometimes 5th or octave, occasionally b7 for funk/house
                let pitch = rootMidi;
                const r = globalPRNG.next();
                if (r > 0.8) pitch = rootMidi + 12; // Octave pop
                else if (r > 0.6) pitch = fifthMidi; // 5th
                else if (r > 0.5 && (isFunk || isElectronic)) pitch = rootMidi + 10; // b7 (assuming minor/dominant vibe)

                // Velocity: accent the first note of the cell
                const velocity = currentBeat === chord.startBeat || globalPRNG.next() > 0.7 ? 0.9 : 0.7;

                notes.push({ pitch, onset: currentBeat, duration: duration * 0.8, velocity });
                currentBeat += duration;
                advanced = true;
            }
            if (!advanced) {
                // If we couldn't fit even the first note of the cell, just fill the remaining time with a single note or rest
                const remaining = chord.endBeat - currentBeat;
                if (remaining > 0.1) {
                    notes.push({ pitch: rootMidi, onset: currentBeat, duration: remaining * 0.8, velocity: 0.6 });
                }
                break;
            }
        }
        return notes; // Return immediately, bypassing standard bass logic
    }

    // 🌟 爵士/现代流行技巧：平滑的贝斯线条 (Stepwise Bassline / Inversions)
    // 如果知道下一个和弦，尝试使用转位让贝斯线条更平滑 (例如 4级->5级->1级 变成 4->5->7(转位)->1)
    let targetBassPitch = rootMidi;
    let octaveMidi = rootMidi + 12;
    
    // 🌟 EDM 专属技巧：持续低音 (Pedal Point)
    // 在 Build-Up 或 Drop 中，有概率让贝斯一直保持在主音 (Key Root) 上，制造巨大张力
    const isEDM = styleId.toLowerCase().includes('electronic') || styleId.toLowerCase().includes('dance') || styleId.toLowerCase().includes('edm') || styleId.toLowerCase().includes('house');
    if (isEDM && energyLevel >= 5 && globalPRNG.next() < 0.3) {
        // 使用当前调的主音作为持续低音，并确保在 28-39 的安全贝斯音域内
        let finalKeyRoot = keyOffset % 12;
        finalKeyRoot += 24;
        if (finalKeyRoot < 28) finalKeyRoot += 12;
        const keyRootMidi = finalKeyRoot - keyOffset;
        targetBassPitch = keyRootMidi;
        octaveMidi = keyRootMidi + 12;
    }
    
    // 只有在非律动型曲风（抒情、电影、爵士）中，才允许使用和弦转位作为贝斯根音
    const allowInversion = isBallad || isCinematic || isWalkingBass;
    
    if (allowInversion && nextChord && globalPRNG.next() < 0.2) { // 降低概率到 20%，避免过度使用转位导致根音缺失
        const nextBassTones = HarmonyCore.getChordTones(nextChord, nextTargetCenter);
        const nextRoot = nextBassTones[0];
        
        // 检查是否可以通过三音或五音平滑过渡到下一个和弦的根音
        const distRoot = Math.abs(rootMidi - nextRoot);
        const distThird = Math.abs(thirdMidi - nextRoot);
        const distFifth = Math.abs(fifthMidi - nextRoot);
        
        // 如果转位音离下一个和弦的根音更近（半音或全音），则使用转位
        if (distThird > 0 && distThird < distRoot && distThird <= 2) {
            targetBassPitch = thirdMidi; // 使用三音转位
            octaveMidi = targetBassPitch + 12;
        } else if (distFifth > 0 && distFifth < distRoot && distFifth <= 2) {
            targetBassPitch = fifthMidi; // 使用五音转位
            octaveMidi = targetBassPitch + 12;
        }
    }
    
    // 🌟 解决“听感太赶”：低能量段落强制全音符贝斯
    if (energyLevel <= 3 || isCinematic || isBallad) {
        notes.push({ pitch: targetBassPitch, onset: chord.startBeat, duration: chord.endBeat - chord.startBeat, velocity: 0.7 });
        return notes;
    }

    // Helper for walking bass chromatic approach
    const getApproachNote = (targetPitch: number, currentBeat: number, forceChromatic: boolean = false) => {
        const direction = globalPRNG.next() > 0.5 ? 1 : -1;
        
        if (forceChromatic) {
            return targetPitch + direction; // 🌟 半音阶逼近 (Chromatic Approach)
        }

        // 🌟 严格调内优先 (Diatonic Strictness) & 防碰撞
        // 优先使用调内音阶步进，而不是半音步进，避免小二度冲突
        
        // 尝试从当前和弦安全音阶中找上/下一个音
        let approachPitch = HarmonyCore.shiftDiatonic(targetPitch, safeScalePcs, direction);
        
        // 🌟 硬性防碰撞检测 (Collision Filter)
        // 检查这个经过音是否与目标和弦的根音或三音形成小二度(1)或大七度(11)
        let targetChordTones = bassTones;
        if (nextChord) {
            let nextFinalRoot = (nextChord.root + keyOffset) % 12;
            nextFinalRoot += 24;
            if (nextFinalRoot < 28) nextFinalRoot += 12;
            const nextTargetCenter = nextFinalRoot - keyOffset;
            targetChordTones = HarmonyCore.getChordTones(nextChord, nextTargetCenter);
        }
        const targetRoot = targetChordTones[0];
        const targetThird = targetChordTones[1];
        
        const diffRoot = Math.abs(approachPitch - targetRoot) % 12;
        const diffThird = Math.abs(approachPitch - targetThird) % 12;
        
        if (diffRoot === 1 || diffRoot === 11 || diffThird === 1 || diffThird === 11) {
            // 如果发生严重冲突，退回到目标和弦的五音或根音
            approachPitch = globalPRNG.next() > 0.5 ? targetRoot : targetChordTones[2];
        }
        
        return approachPitch;
    };

    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.5) {
      if (isSparseSection && isSectionEnd && willChoke && beat >= chord.endBeat - 1.0) {
          continue; 
      }

      // 🌟 优先级1：急停/半急停 (Dynamic Dropouts)
      const barsLeftTotal = (chord.endBeat - beat) / (GlobalContext.currentTimeSignature[0] || 4);
      const isTransitionToHighEnergy = nextEnergyLevel > energyLevel + 1;
      if (isSectionEnd && barsLeftTotal <= 0.5 && isTransitionToHighEnergy && globalPRNG.next() > 0.3) {
          break; // 贝斯提前半小节停止，制造真空期
      }

      const isChordStart = beat === chord.startBeat;
      const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;
      const is68 = beatsPerBar === 6;
      const beatInBar = beat % beatsPerBar;
      
      const melodyActive = melodyNotes.some(m => m.onset >= beat - 0.25 && m.onset <= beat + 0.25);
      
      const baseVel = 0.8;

      const isBossaBass = bassStyle === 'bossa' || styleId.toLowerCase().includes('bossa');

      // 🌟 优先级2：半音阶贝斯逼近 (Chromatic Bass Approach)
      // 在和弦交接处（最后一拍的后半拍），有概率加入半音阶经过音，平滑过渡到下一个和弦
      if (nextChord && beat === chord.endBeat - 0.5 && energyLevel > 4 && !isWalkingBass && !isBossaBass) {
          if (globalPRNG.next() < 0.4) { // 40% 概率触发半音阶逼近
              const targetRoot = HarmonyCore.getChordTones(nextChord, nextTargetCenter)[0];
              const approachPitch = getApproachNote(targetRoot, beat, true); // forceChromatic = true
              notes.push({ pitch: approachPitch, onset: beat, duration: 0.5, velocity: baseVel * 0.9 });
              continue; // 跳过常规生成逻辑
          }
      }

      if (isBossaBass) {
          // 🌴 Bossa Nova Bass Logic (Root on 1 and 3, Fifth on 2.5 and 4.5, or variations)
          const twoBarBeat = beat % (beatsPerBar * 2);
          const latinBassVel = Math.min(1.0, baseVel * 1.3); 
          
          // Basic pattern: 1, 2.5, 3, 4.5 (in 4/4)
          if (beatInBar === 0) {
              notes.push({ pitch: targetBassPitch, onset: beat, duration: 1.5, velocity: latinBassVel });
          } else if (beatInBar === 1.5) {
              // Often drops to the fifth below
              const fifthBelow = fifthMidi < targetBassPitch ? fifthMidi : fifthMidi - 12;
              notes.push({ pitch: fifthBelow, onset: beat, duration: 0.5, velocity: latinBassVel * 0.9 });
          } else if (beatInBar === 2) {
              // Sometimes plays root again, sometimes fifth
              const pitch = globalPRNG.next() > 0.5 ? targetBassPitch : fifthMidi;
              notes.push({ pitch: pitch, onset: beat, duration: 1.5, velocity: latinBassVel });
          } else if (beatInBar === 3.5) {
              // Approach note to next chord or fifth
              let pitch = fifthMidi;
              if (nextChord && globalPRNG.next() > 0.5) {
                  const targetRoot = HarmonyCore.getChordTones(nextChord, nextTargetCenter)[0];
                  pitch = getApproachNote(targetRoot, beat);
              } else {
                  pitch = fifthMidi < targetBassPitch ? fifthMidi : fifthMidi - 12;
              }
              notes.push({ pitch: pitch, onset: beat, duration: 0.5, velocity: latinBassVel * 0.9 });
          }
      } else if (isWalkingBass) {
          // 🚶‍♂️ Walking Bass Logic (Quarter notes mostly, outlining chords and passing tones)
          if (beat % 1 === 0) { // On every quarter note
              let pitch = rootMidi;
              if (isChordStart) {
                  pitch = rootMidi; // Beat 1: Root
              } else if (beatInBar === 1) {
                  pitch = globalPRNG.next() > 0.5 ? thirdMidi : fifthMidi; // Beat 2: Chord tone
              } else if (beatInBar === 2) {
                  pitch = globalPRNG.next() > 0.5 ? fifthMidi : seventhMidi; // Beat 3: Chord tone or 7th
              } else if (beatInBar === 3) {
                  // Beat 4: Approach note to the next chord's root (or current if no next chord)
                  const targetRoot = nextChord ? HarmonyCore.getChordTones(nextChord, nextTargetCenter)[0] : rootMidi;
                  pitch = getApproachNote(targetRoot, beat);
              } else {
                  pitch = bassTones[Math.floor(globalPRNG.next() * bassTones.length)];
              }
              
              // Add some rhythmic variation (skip a beat occasionally or add an 8th note)
              if (globalPRNG.next() > 0.1) {
                  notes.push({ pitch: pitch, onset: beat, duration: 1.0, velocity: baseVel });
              }
              
              // Swing 8th note passing tone
              if (globalPRNG.next() > 0.7 && beatInBar !== 3) {
                  // 🌟 同样使用调内步进，避免刺耳的半音
                  const direction = globalPRNG.next() > 0.5 ? 1 : -1;
                  const passing = HarmonyCore.shiftDiatonic(pitch, safeScalePcs, direction);
                  notes.push({ pitch: passing, onset: beat + 0.66, duration: 0.34, velocity: baseVel * 0.7 });
              }
          }
      } else if (isBassSolo) {
        // 🌟 贝斯 Solo 模式：更具律动感和旋律性
        const isGrooveHit = GlobalContext.isGrooveHit(beat);
        if (isChordStart) {
            notes.push({ pitch: rootMidi, onset: beat, duration: 0.5, velocity: baseVel * 1.2 });
        } else if (isGrooveHit) {
            const pitch = globalPRNG.next() > 0.5 ? rootMidi : octaveMidi;
            notes.push({ pitch: pitch, onset: beat, duration: 0.25, velocity: baseVel * 1.1 });
        } else if (beatInBar === 2.5 || beatInBar === 3.5) {
            // 经过音
            const passingPitch = globalPRNG.next() > 0.5 ? fifthMidi : thirdMidi;
            notes.push({ pitch: passingPitch, onset: beat, duration: 0.25, velocity: baseVel * 0.9 });
        }
      } else {
        // 🌟 动态 Groove-Driven 贝斯生成 (Dynamic Groove-Driven Bass)
        const isGrooveHit = GlobalContext.isGrooveHit(beat);
        
        if (isSparseSection || isCinematic || isBallad || energyLevel <= 3) {
            // 抒情/电影/稀疏段落：长音铺底
            if (isChordStart) {
                notes.push({ pitch: targetBassPitch, onset: beat, duration: Math.min(4.0, chord.endBeat - beat), velocity: baseVel });
            } else if (beatInBar === 2 && energyLevel > 2 && globalPRNG.next() > 0.5) {
                // 偶尔在第三拍（4/4拍的beatInBar=2）加个五度或八度
                notes.push({ pitch: fifthMidi, onset: beat, duration: 2.0, velocity: baseVel * 0.8 });
            }
        } else if (isFunk || isElectronic) {
            // 🌟 Progressive House / EDM 专属 Bassline
            if (styleId === 'progressive_house') {
                if (energyLevel >= 7) {
                    // Drop / 高潮：16分音符滚动 (Rolling Bass)
                    // 避开正拍 (Kick的位置)，在 16分音符的反拍上发力，形成伪侧链效果
                    const subBeat = beatInBar % 1;
                    if (subBeat === 0.25 || subBeat === 0.5 || subBeat === 0.75) {
                        const pitch = (subBeat === 0.5 && globalPRNG.next() > 0.7) ? octaveMidi : targetBassPitch;
                        const vel = subBeat === 0.5 ? baseVel * 1.1 : baseVel * 0.9;
                        notes.push({ pitch: pitch, onset: beat, duration: 0.25, velocity: vel });
                    }
                } else if (energyLevel >= 4) {
                    // Verse / BuildUp：经典的 Off-beat Bass (反拍贝斯)
                    if (beatInBar % 1 === 0.5) {
                        notes.push({ pitch: targetBassPitch, onset: beat, duration: 0.5, velocity: baseVel * 1.1 });
                    }
                } else {
                    // Breakdown：极简长音或静音
                    if (isChordStart) {
                        notes.push({ pitch: targetBassPitch, onset: beat, duration: 4.0, velocity: baseVel * 0.7 });
                    }
                }
            } else {
                // Funk / 其他电子：高度贴合 GrooveDNA，带有八度跳跃和切分
                if (isChordStart) {
                    notes.push({ pitch: targetBassPitch, onset: beat, duration: 0.5, velocity: baseVel * 1.1 });
                } else if (isGrooveHit) {
                    // 贴合 GrooveDNA
                    const pitch = globalPRNG.next() > 0.6 ? octaveMidi : targetBassPitch;
                    const duration = globalPRNG.next() > 0.5 ? 0.25 : 0.5; // 短促的跳音
                    notes.push({ pitch: pitch, onset: beat, duration: duration, velocity: baseVel * 0.9 });
                } else if ((beatInBar === 1.5 || beatInBar === 3.5) && globalPRNG.next() < grooveSyncopation) {
                    // 经典的 16 分音符反拍（Ghost notes），受 syncopationProb 控制
                    notes.push({ pitch: targetBassPitch, onset: beat, duration: 0.25, velocity: baseVel * 0.6 });
                } else if (beat % 0.5 === 0.25 && globalPRNG.next() < (grooveDensity - 0.5)) {
                    // 额外的 16 分音符，受 density 控制
                    notes.push({ pitch: targetBassPitch, onset: beat, duration: 0.25, velocity: baseVel * 0.5 });
                }
            }
        } else if (isReggae) {
            // Reggae Bass: Syncopated, rests on beat 1 often, emphasizes beat 3 and off-beats
            if (beatInBar === 0.5 || beatInBar === 1.5) {
                notes.push({ pitch: targetBassPitch, onset: beat, duration: 0.5, velocity: baseVel * 1.1 });
            } else if (beatInBar === 2) { // Beat 3 (0-indexed 2)
                notes.push({ pitch: fifthMidi, onset: beat, duration: 1.0, velocity: baseVel * 1.2 });
            } else if (beatInBar === 3.5) {
                notes.push({ pitch: octaveMidi, onset: beat, duration: 0.5, velocity: baseVel * 0.9 });
            }
        } else if (isLatin) {
            // Latin (Non-Bossa): 经典的 1, 2.5, 3, 4.5 节奏 (Tresillo 变体)
            const latinBassVel = Math.min(1.0, baseVel * 1.3); 
            if (beatInBar === 0 || beatInBar === 2) {
                notes.push({ pitch: targetBassPitch, onset: beat, duration: 1.5, velocity: latinBassVel });
            } else if (beatInBar === 1.5 || beatInBar === 3.5) {
                notes.push({ pitch: fifthMidi, onset: beat, duration: 0.5, velocity: latinBassVel * 0.9 });
            }
        } else {
            // 默认流行/摇滚：根据能量决定是 8 分音符泵动还是跟随 Groove
            if (energyLevel > 7 && isPopRock) {
                // 高能量泵动 (Pumping 8th notes)
                const pitch = (beatInBar % 1 === 0) ? targetBassPitch : (globalPRNG.next() > 0.8 ? octaveMidi : targetBassPitch);
                notes.push({ pitch: pitch, onset: beat, duration: 0.5, velocity: baseVel * (beat % 1 === 0 ? 1.0 : 0.8) });
            } else {
                // 中等能量：结合正拍和 GrooveDNA
                if (beat % 1 === 0) { // 正拍必弹
                    // 现代流行乐主要保持在根音，偶尔在弱拍使用五度或八度
                    const pitch = (beatInBar % 2 !== 0 && globalPRNG.next() > 0.7) ? fifthMidi : targetBassPitch;
                    notes.push({ pitch: pitch, onset: beat, duration: 0.5, velocity: baseVel });
                } else if (isGrooveHit && !melodyActive) { // Groove 补充
                    const pitch = globalPRNG.next() > 0.8 ? octaveMidi : targetBassPitch;
                    notes.push({ pitch: pitch, onset: beat, duration: 0.25, velocity: baseVel * 0.8 });
                }
            }
        }
      }

      // 🌟 动态节奏突变 (Rhythmic Mutation): 贝斯加花 (Bass Fills) & Build-ups
      const isFillZone = beat >= chord.endBeat - 1.0;
      const isBuildUp = activeSection?.type === 'BuildUp' || (isFillZone && nextEnergyLevel > energyLevel + 1);
      const isValidTriggerPoint = beat % 1 === 0 || GlobalContext.isGrooveHit(beat);
      
      if (isBuildUp) {
          // Build-up 贝斯逻辑：通常是连续的 8 分或 16 分音符根音连击，力度渐强
          const barsLeft = (chord.endBeat - beat) / beatsPerBar;
          let buildUpStep = 0.5; // 8th notes
          if (barsLeft <= 1.0) buildUpStep = 0.25; // 16th notes
          
          if (beat % buildUpStep === 0) {
              const buildVel = baseVel * (0.6 + (1 - barsLeft / 2) * 0.6); // 渐强
              notes.push({ pitch: targetBassPitch, onset: beat, duration: buildUpStep * 0.8, velocity: buildVel });
          }
      } else {
          const mutationChance = (energyLevel / 10);
          if (isFillZone && isValidTriggerPoint && !melodyActive && globalPRNG.next() < mutationChance * 0.05) {
              const step = 0.5;
              for (let i = 0; i < 2; i++) {
                  const runPitch = i === 0 ? octaveMidi : fifthMidi; // 八度或五度，使用和弦内音避免不和谐
                  notes.push({ pitch: runPitch, onset: beat + i * step, duration: step * 1.2, velocity: baseVel * 0.9 });
              }
              break; // 结束当前和弦的贝斯生成
          }
      }
    }

    // 增加贝斯/左手钢琴的延音踏板感，避免断得太快 (更深的踏板)
    // This is now largely handled by BassIdiom, but we keep a baseline duration
    notes.forEach(n => {
        n.duration = n.duration * 1.2 + 0.2;
    });

    return this.deduplicateNotes(notes);
  }

  public static generateDrumGroove(startBeat: number, endBeat: number, energyLevel: number, isIntro: boolean = false, isOutro: boolean = false, styleId: string = "pop", swingRatio: number = 0.5, nextEnergyLevel: number = 3, hasFullGrooveStarted: boolean = false): NoteData[] {
    const notes: NoteData[] =[];
    const KICK = 36, SNARE = 38, CHH = 42, OHH = 46, CRASH = 49, CROSS_STICK = 37, TOM_HI = 50, TOM_MID = 47, TOM_LOW = 43;
    const RIDE = 51, RIDE_BELL = 53, CHINA = 52, SPLASH = 55, CRASH2 = 57;
    const beatsPerBar = GlobalContext.currentTimeSignature[0] === 6 ? 6 : (GlobalContext.currentTimeSignature[0] || 4);
    const is68 = beatsPerBar === 6;

    const isTrap = styleId.toLowerCase().includes('trap');
    const isSwing = swingRatio > 0.5;
    const isElectronic = styleId.toLowerCase().includes('electronic') || styleId.toLowerCase().includes('dance') || styleId.toLowerCase().includes('edm') || styleId.toLowerCase().includes('house');
    const isReggae = styleId.toLowerCase().includes('reggae');
    const isRock = styleId.toLowerCase().includes('rock');
    const isAcousticBallad = styleId.toLowerCase().includes('ballad') || styleId.toLowerCase().includes('acoustic');
    
    const activeSection = GlobalContext.getActiveSection();
    const grooveDensity = activeSection?.groove?.density ?? 0.5;
    const grooveSyncopation = activeSection?.groove?.syncopationProb ?? 0.2;

    // 🌟 核心：如果是有 Swing/Groove 感的曲风（且不是 Trap），有概率进入 Half-time (拉长一倍时值) 模式
    // 能量低的段落更容易进入 Half-time，能量高的段落概率降低
    const halfTimeProb = energyLevel > 5 ? 0.3 : 0.7;
    const isHalfTime = !is68 && !isTrap && isSwing && globalPRNG.next() < halfTimeProb;

    let guaranteedKickTime = -1; // 🌟 新增：保证底鼓的触发时间

    for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      // 🌟 优先级1：急停/半急停 (Dynamic Dropouts)
      const barsLeftTotal = (endBeat - beat) / beatsPerBar;
      const isTransitionToHighEnergy = nextEnergyLevel > energyLevel + 1;
      if (barsLeftTotal <= 0.5 && isTransitionToHighEnergy && globalPRNG.next() > 0.3) {
          // 在段落最后半小节，如果是向高能量段落过渡，有 70% 概率触发急停 (Dropout)
          if (beat % beatsPerBar === beatsPerBar - 0.5 && globalPRNG.next() > 0.5) {
              notes.push({ pitch: OHH, onset: beat, duration: 0.1, velocity: 0.7 });
          }
          continue; // 跳过常规鼓组生成
      }

      const beatInBar = beat % beatsPerBar;
      const isDownbeat = beatInBar === 0;
      
      let isSnareBeat = false;
      if (is68) {
          isSnareBeat = beatInBar === 3;
      } else {
          if (isHalfTime) {
              isSnareBeat = beatInBar === 2; // Half-time: Snare on beat 3 (0-indexed 2)
          } else {
              isSnareBeat = beatInBar === 1 || beatInBar === 3; // Normal: Snare on 2 and 4
          }
      }

      // 🌟 核心约定：第一拍和第三拍（非反拍曲风）必须有底鼓，位置可以在正拍、8分或16分切分
      if (!isSnareBeat && (beatInBar === 0 || (!is68 && beatInBar === 2))) {
          const r = globalPRNG.next();
          if (r < 0.7) {
              guaranteedKickTime = beat; // 70% 概率在正拍
          } else if (r < 0.9) {
              guaranteedKickTime = beat + 0.5; // 20% 概率在 8 分音符反拍
          } else {
              guaranteedKickTime = beat + (globalPRNG.next() > 0.5 ? 0.25 : 0.75); // 10% 概率在 16 分音符切分
          }
      }

      // 🌟 强制触发约定的底鼓
      if (beat === guaranteedKickTime) {
          const kickVel = energyLevel > 4 ? 0.85 : (energyLevel > 2 ? 0.7 : 0.5);
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: kickVel });
      }

      // 🌟 解决“听感太赶”：低能量段落极简鼓组
      if (energyLevel <= 3 && !isIntro && !isOutro) {
          if (isDownbeat) {
              notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.6 });
          } else if (isSnareBeat) {
              notes.push({ pitch: CROSS_STICK, onset: beat, duration: 0.1, velocity: 0.7 }); // 使用边击代替军鼓
          }
          // 极简踩镲，只在正拍，甚至有概率不打
          if (beat % 1 === 0 && globalPRNG.next() > 0.5) {
              notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: 0.4 });
          }
          continue;
      }

      // 🌟 Layback 效果：让军鼓稍微拖后一点点，增加 Groove 感
      let laybackOffset = 0;
      if (!isTrap && isSwing && isSnareBeat) {
          laybackOffset = globalPRNG.next() * 0.06 + 0.02; // 20ms - 80ms layback
      }

      const isGrooveHit = GlobalContext.isGrooveHit(beat);
      
      // 🌟 尾奏专属鼓组逻辑 (Outro-specific drum logic)
      if (isOutro) {
          const barsLeft = (endBeat - beat) / beatsPerBar;
          // 最后一小节的最后一拍，只留一个长音，鼓组停掉
          if (barsLeft <= 1 && beatInBar >= beatsPerBar - 1) {
              continue; // 鼓组彻底停止
          }
          
          if (energyLevel >= 8) {
              // 高能量尾奏（节奏骤停）
              if (barsLeft <= 1 && beatInBar >= 1) continue; // 最后一小节第2拍开始全停
              if (isDownbeat) notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.8 });
              if (isSnareBeat) notes.push({ pitch: SNARE, onset: beat + laybackOffset, duration: 0.1, velocity: 0.8 });
              if (beat % 0.5 === 0) notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: 0.6 });
          } else {
              // 渐弱尾奏
              if (isDownbeat) {
                  notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.4 * (barsLeft / 4) });
              }
              if (isSnareBeat && globalPRNG.next() > 0.3) {
                  notes.push({ pitch: CROSS_STICK, onset: beat + laybackOffset, duration: 0.1, velocity: 0.5 * (barsLeft / 4) });
              }
              if (beat % 1.0 === 0 && globalPRNG.next() > 0.5) {
                  notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: 0.3 * (barsLeft / 4) });
              }
          }
          continue;
      }
      
      // 🌟 前奏专属鼓组逻辑 (Intro-specific drum logic)
      if (isIntro) {
          const barsLeft = (endBeat - beat) / beatsPerBar;
          
          // 前奏主体：只能有轻巧的 Hi-hat，绝对不允许出现 Kick 和 Snare
          if (barsLeft > 1.0) {
              const hatInterval = isHalfTime ? 1.0 : 0.5;
              if (beat % hatInterval === 0) {
                  const vel = beat % (hatInterval * 2) === 0 ? 0.3 : 0.15;
                  notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: vel });
              }
          } else {
              // 最后一小节：过渡 Fill
              // 根据下一个段落的能量决定 Fill 的激烈程度和使用的乐器
              // 如果下一个段落能量 <= 2，说明目标段落没有 Kick/Snare，前奏加花也不能有
              const targetHasKickSnare = nextEnergyLevel > 2; 
              
              if (!targetHasKickSnare) {
                  // 目标段落没有 Kick/Snare，只能用 Hi-hat 做顺滑过渡
                  if (beat % 0.25 === 0 && globalPRNG.next() > 0.4) {
                      // 16分音符碎镲加花，力度随拍子渐强
                      const vel = 0.15 + (beatInBar / beatsPerBar) * 0.25; 
                      notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: vel });
                  } else if (beat % 0.5 === 0) {
                      notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: 0.3 });
                  }
              } else {
                  // 目标段落有 Kick/Snare，可以加入轻微的 Kick/Snare/Tom 加花，顺滑过渡
                  if (beatInBar === 0) {
                      // 最后一小节第一拍给个轻微的底鼓提示
                      notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.4 });
                  }
                  
                  if (beatInBar >= beatsPerBar - 1) {
                      // 最后一拍密集加花 (16分音符)
                      if (beat % 0.25 === 0) {
                          const fillPitch = globalPRNG.next() > 0.6 ? SNARE : (globalPRNG.next() > 0.5 ? TOM_HI : TOM_MID);
                          const vel = 0.3 + (beat % 1.0) * 0.4; // 渐强
                          notes.push({ pitch: fillPitch, onset: beat, duration: 0.1, velocity: vel });
                      }
                  } else if (beatInBar >= beatsPerBar - 2) {
                      // 倒数第二拍开始铺垫 (8分音符)
                      if (beat % 0.5 === 0 && globalPRNG.next() > 0.5) {
                          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.35 });
                      }
                  }
                  
                  // 维持 Hi-hat 律动
                  if (beat % 0.5 === 0) {
                      notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: 0.3 });
                  }
              }
          }
          continue;
      }

      // 🌟 Bossa Nova 专属鼓组逻辑 (Bossa Nova specific drum logic)
      const isBossa = styleId.toLowerCase().includes('bossa');
      if (isBossa && energyLevel > 2) {
          const twoBarBeat = beat % (beatsPerBar * 2);
          
          // Bossa Kick: 1, 2.5, 3, 4.5 (in 4/4)
          if (beatInBar === 0 || beatInBar === 1.5 || beatInBar === 2 || beatInBar === 3.5) {
              notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.55 }); // Softer kick
          }
          
          // Bossa Clave (Cross-stick): 
          // Bar 1: 1, 2.5, 4
          // Bar 2: 1.5, 3, 4
          const isClaveHit = 
              (twoBarBeat === 0 || twoBarBeat === 1.5 || twoBarBeat === 3) || // Bar 1
              (twoBarBeat === 5.5 || twoBarBeat === 6 || twoBarBeat === 7);   // Bar 2 (offset by 4: 1.5+4=5.5, 2+4=6, 3+4=7)
              
          if (isClaveHit) {
              notes.push({ pitch: CROSS_STICK, onset: beat, duration: 0.1, velocity: 0.65 }); // Softer clave
          }
          
          // Bossa Hi-hat: continuous 8th notes
          if (beat % 0.5 === 0) {
              notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: beat % 1 === 0 ? 0.35 : 0.2 }); // Softer hi-hat
          }
          
          continue;
      }

      // 🌟 Funk 专属鼓组逻辑 (Funk specific drum logic)
      const isFunk = styleId.toLowerCase().includes('funk');
      if (isFunk && energyLevel > 2) {
          // Funk Groove: syncopated kicks, ghost snares, constant 16th hi-hats
          if (isDownbeat) {
              notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.85 });
          } else if (beatInBar === 1.5 || beatInBar === 2.5 || beatInBar === 3.75) {
              if (globalPRNG.next() > 0.3) notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.7 });
          }
          
          if (isSnareBeat) {
              notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.9 });
          } else if (beat % 0.25 === 0 && beat % 0.5 !== 0) { // 16th note offbeats
              if (globalPRNG.next() > 0.7) notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.3 }); // Ghost snare
          }

          // 16th note hi-hats
          if (beat % 0.25 === 0) {
              const hatVel = beat % 0.5 === 0 ? 0.6 : 0.35; // Accent 8th notes
              // Open hi-hat occasionally on the "and" (0.5)
              const isOpenHat = beat % 1 === 0.5 && globalPRNG.next() > 0.8;
              notes.push({ pitch: CHH, onset: beat, duration: isOpenHat ? 0.2 : 0.1, velocity: isOpenHat ? hatVel * 1.2 : hatVel });
          }
          continue;
      }

      // 🌟 Rock 专属鼓组逻辑 (Rock specific drum logic)
      if (isRock && energyLevel > 2) {
          const isFillZone = beat >= endBeat - 2.0;
          const isBuildUp = activeSection?.type === 'BuildUp' || (isFillZone && nextEnergyLevel > energyLevel + 1);
          
          if (isBuildUp) {
              const barsLeft = (endBeat - beat) / beatsPerBar;
              let buildUpStep = 0.5;
              if (barsLeft <= 1.0) buildUpStep = 0.25;
              
              if (beat % buildUpStep === 0) {
                  const buildVel = 0.6 + (1 - barsLeft / 2) * 0.4;
                  notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: buildVel });
                  notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: buildVel * 0.9 });
                  notes.push({ pitch: TOM_LOW, onset: beat, duration: 0.1, velocity: buildVel * 0.8 }); // Heavy floor tom build
              }
              continue;
          }

          // Driving Kick
          if (isDownbeat) {
              if (globalPRNG.next() > 0.05) { // 保证正拍底鼓的稳定性 (95% 触发)
                  notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.9 });
              }
          } else if (beatInBar === 2.5) { // Classic rock syncopated kick
              if (globalPRNG.next() > 0.1) {
                  notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.8 });
              }
          } else if (beatInBar === 1.5 && globalPRNG.next() > 0.4) { // 8th note push
              notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.7 });
          } else if (beatInBar === 3.5 && globalPRNG.next() > 0.5) { // Syncopated kick before beat 4
              notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.75 });
          }

          // Heavy Snare on 2 and 4
          if (isSnareBeat) {
              if (globalPRNG.next() > 0.1) { // 10% chance to drop snare for breathability
                  notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.95 });
              }
          }

          // Hi-hats / Ride / Crash riding
          if (beat % 0.5 === 0) {
              let cymbalPitch = CHH;
              let cymbalVel = beat % 1 === 0 ? 0.8 : 0.6; // Strong 8th note pulse

              if (energyLevel >= 8) {
                  // Chorus/High energy: Ride or Crash riding
                  cymbalPitch = globalPRNG.next() > 0.5 ? CRASH : RIDE;
                  cymbalVel = 0.85;
              } else if (energyLevel >= 6) {
                  // Pre-chorus/Verse 2: Open hi-hats
                  cymbalPitch = OHH;
                  cymbalVel = 0.75;
              }

              const dropHatProb = isSnareBeat ? 0.5 : 0.2; // Higher chance to drop hat on snare beat
              if (globalPRNG.next() > dropHatProb) {
                  notes.push({ pitch: cymbalPitch, onset: beat, duration: 0.1, velocity: cymbalVel });
              }
          }
          
          // Occasional 16th kick before snare
          if (beatInBar === 1.75 || beatInBar === 3.75) {
              if (globalPRNG.next() > 0.8) { // Reduced probability for less clutter
                  notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.6 });
              }
          }

          continue;
      }

      // 🌟 EDM 专属鼓组逻辑 (EDM specific drum logic)
      if (isElectronic && energyLevel > 2) {
          const isFillZone = beat >= endBeat - 2.0;
          const isBuildUp = activeSection?.type === 'BuildUp' || (isFillZone && nextEnergyLevel > energyLevel + 1);
          
          if (isBuildUp) {
              // EDM Build-up: Snare rolls, accelerating
              const barsLeft = (endBeat - beat) / beatsPerBar;
              let buildUpStep = 0.5; // 8th notes
              if (barsLeft <= 1.0) buildUpStep = 0.25; // 16th notes
              if (barsLeft <= 0.5) buildUpStep = 0.125; // 32nd notes
              
              if (beat % buildUpStep === 0) {
                  const buildVel = 0.5 + (1 - barsLeft / 2) * 0.5; // 0.5 to 1.0
                  notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: buildVel });
                  notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: buildVel * 0.9 });
              }
              continue;
          }

          // Four-on-the-floor kick
          if (beat % 1 === 0) {
              notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.9 });
          } else if (beat % 0.5 === 0.25 && globalPRNG.next() < grooveSyncopation * 0.5) {
              // 偶尔在 16 分音符反拍加 Kick，受 syncopationProb 控制
              notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.6 });
          }
          // Claps/Snares on 2 and 4
          if (beatInBar === 1 || beatInBar === 3) {
              notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.85 });
          }
          // Off-beat hi-hats
          if (beat % 1 === 0.5) {
              notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: 0.7 });
          }
          // Occasional 16th note hi-hats for energy, controlled by density
          if (energyLevel > 4 && beat % 0.25 === 0 && beat % 0.5 !== 0 && globalPRNG.next() < grooveDensity) {
              notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: 0.4 });
          }
          continue;
      }

      // 🌟 Reggae 专属鼓组逻辑 (Reggae specific drum logic)
      if (isReggae && energyLevel > 2) {
          // Steppers/Rockers feel: Kick on beat 1 and 3 (or all 4 beats)
          if (beatInBar === 0 || beatInBar === 2) {
              notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.8 });
          }
          if (beatInBar === 2) { // Snare/Cross-stick on beat 3
              notes.push({ pitch: energyLevel > 5 ? SNARE : CROSS_STICK, onset: beat + laybackOffset, duration: 0.1, velocity: 0.85 });
          }
          
          // Occasional syncopated kick
          if (beatInBar === 3.5 && globalPRNG.next() > 0.6) {
              notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.6 });
          }

          // Hi-hats: Straight or swung 8ths
          if (beat % 0.5 === 0) {
              const isOffbeat = beat % 1 === 0.5;
              const hatVel = isOffbeat ? 0.6 : 0.4; // Accent the off-beat
              // Apply swing to the off-beat
              const swingOffset = isOffbeat ? (swingRatio - 0.5) * 0.5 : 0;
              notes.push({ pitch: CHH, onset: beat + swingOffset, duration: 0.1, velocity: hatVel });
          }
          continue;
      }
      
      // Energy Level 1-2: Very sparse, maybe just cross-stick or no drums at all.
      if (energyLevel <= 2) {
         if (hasFullGrooveStarted) {
             // 强制保持 groove，不能停
             if (isDownbeat || (beatInBar === 2.5 && globalPRNG.next() > 0.7)) {
                 notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.4 });
             }
             if (isSnareBeat) {
                 notes.push({ pitch: CROSS_STICK, onset: beat + laybackOffset, duration: 0.1, velocity: 0.5 });
             }
             if (beat % 1.0 === 0) {
                 notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: 0.3 });
             }
         } else {
             if (isDownbeat && globalPRNG.next() > 0.5) { // 提高低能量段落正拍底鼓的概率
                 notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.35 });
             }
             if (beatInBar === 3 && globalPRNG.next() > 0.5) {
                 notes.push({ pitch: CROSS_STICK, onset: beat, duration: 0.1, velocity: 0.45 });
             }
         }
         continue;
      }

      // Energy Level 3: Light groove, more syncopated, less square
      if (energyLevel === 3) {
          // Kick on downbeat or syncopated off-beats (e.g., 2.5)
          if (isDownbeat || (beatInBar === 2.5 && globalPRNG.next() > 0.4) || (isGrooveHit && !isSnareBeat && globalPRNG.next() > 0.7)) {
              notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.5 });
          }
          // Cross-stick on snare beat, but sometimes omit or delay
          if (isSnareBeat && (hasFullGrooveStarted || globalPRNG.next() > 0.2)) {
              notes.push({ pitch: CROSS_STICK, onset: beat, duration: 0.1, velocity: 0.5 });
          }
          // Hi-hats: 8ths or 16ths depending on style
          if (beat % 0.5 === 0) {
              const hatVel = (beat % 1 === 0) ? 0.5 : 0.3;
              notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: hatVel });
          }
          continue;
      }

      const isFillZone = beat >= endBeat - 1.0;
      const isBuildUp = activeSection?.type === 'BuildUp' || (isFillZone && nextEnergyLevel > energyLevel + 1);
      const isValidTriggerPoint = beat % 1 === 0 || beat % 1 === 0.5;

      // 🌟 移除硬编码的旧版加花逻辑，统一交由 TransitionEngine 处理
      // 这里只保留极简的日常律动微调 (Micro-syncopation)
      
      // 🌟 日常线性加花与幽灵音 (大幅削减，避免多动症)
      if (!isFillZone && beat % 0.5 !== 0) { // 在 16 分音符的弱拍 (0.25, 0.75)
          let linearChance = energyLevel > 6 ? 0.05 : 0.02;
          if (isAcousticBallad) linearChance *= 0.2; // 极大地减少抒情歌的日常16分碎拍
          
          if (globalPRNG.next() < linearChance) {
              // 决定是单音幽灵音，还是短促的连击 (比如 32分音符的 2连击)
              const isRun = globalPRNG.next() > 0.7 && !isAcousticBallad; // 抒情歌不使用32分连击
              if (isRun) {
                  // 日常节奏中的短促连击 (Short run in daily groove)
                  const runLength = 2;
                  const runStep = 0.25 / runLength;
                  let accentIndex = globalPRNG.next() > 0.5 ? 0 : 1; // 重音移位
                  
                  // 🌟 引入 Tom 鼓的日常小加花
                  const useTom = globalPRNG.next() > 0.7;
                  const runPath = useTom ? [TOM_HI, TOM_MID] : [SNARE, KICK];
                  if (!useTom && globalPRNG.next() > 0.5) { runPath[0] = KICK; runPath[1] = SNARE; }
                  
                  for (let i = 0; i < runLength; i++) {
                          let ghostPitch = runPath[i];
                          let ghostVel = (i === accentIndex) ? (0.5 + globalPRNG.next() * 0.2) : (0.25 + globalPRNG.next() * 0.15);
                          notes.push({ pitch: ghostPitch, onset: beat + i * runStep, duration: 0.1, velocity: ghostVel });
                      }
                  } else {
                      // 线性分配：轻军鼓、底鼓或踩镲
                      const rand = globalPRNG.next();
                      let ghostPitch = SNARE;
                      if (rand > 0.6) ghostPitch = KICK;
                      else if (rand > 0.3) ghostPitch = CHH;
                      
                      const ghostVel = 0.25 + globalPRNG.next() * 0.15; // 0.25 - 0.4 幽灵音力度
                      notes.push({ pitch: ghostPitch, onset: beat, duration: 0.1, velocity: ghostVel * (isAcousticBallad ? 0.6 : 1.0) });
                  }
              }
          }

          if (isSnareBeat) {
              // 🌟 偶尔空掉军鼓，增加呼吸感和切分感
              if (globalPRNG.next() > 0.15) {
                  notes.push({ pitch: SNARE, onset: beat + laybackOffset, duration: 0.1, velocity: energyLevel > 4 ? 0.8 : 0.7 });
              }
          } else if (beatInBar === (is68 ? 2.75 : 1.75) || beatInBar === (is68 ? 5.75 : 3.75)) {
              // Ghost snare notes before the kick or downbeat (进一步降低概率)
              if (globalPRNG.next() > (isAcousticBallad ? 0.98 : 0.9)) {
                  notes.push({ pitch: SNARE, onset: beat + laybackOffset, duration: 0.1, velocity: 0.3 });
              }
          }

          if (!isSnareBeat) {
              // Kick logic: Downbeat is strong, groove hits are syncopated
              if (isDownbeat) {
                  // 🌟 保证正拍底鼓的稳定性，极小概率空拍 (95% 触发)
                  if (globalPRNG.next() > 0.05) {
                      notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: energyLevel > 4 ? 0.85 : 0.7 });
                  }
              } else if (!isHalfTime && beatInBar === (is68 ? 4.5 : 2.5)) {
                  // Classic syncopated kick
                  if (globalPRNG.next() > (isAcousticBallad ? 0.7 : 0.3)) notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.7 });
              } else if (!isHalfTime && beatInBar === 1.5 && globalPRNG.next() > 0.5) {
                  // 🌟 增加 1.5 拍的切分底鼓
                  notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.65 });
              } else if (isHalfTime && (beatInBar === 1.5 || beatInBar === 3.5)) {
                  // Half-time syncopated kick
                  if (globalPRNG.next() > (isAcousticBallad ? 0.7 : 0.3)) notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.7 });
              } else if (isGrooveHit && globalPRNG.next() > (isAcousticBallad ? 0.85 : 0.5)) {
                  notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.65 });
              }
          }

          // Hi-hats: Dynamic 8th notes, with 16th note variations
          const hatInterval = isHalfTime ? 1.0 : 0.5;
          if (beat % hatInterval === 0) {
              // Accent the on-beats slightly more, but keep overall velocity moderate
              let hatVel = beat % (hatInterval * 2) === 0 ? (energyLevel > 4 ? 0.6 : 0.5) : (energyLevel > 4 ? 0.4 : 0.3);
              if (isAcousticBallad) hatVel *= 0.6; // 极大地降低抒情歌的踩镲力度，避免刺耳
              
              // 🌟 动态镲片选择 (Dynamic Cymbal Selection)
              let cymbalPitch = CHH;
              if (energyLevel >= 7 && !isAcousticBallad) {
                  // 高能量段落（如副歌），使用 Ride 或 Ride Bell 替代 Hi-hat
                  if (globalPRNG.next() > 0.8) {
                      cymbalPitch = RIDE_BELL;
                      hatVel *= 1.1; // Bell 穿透力强
                  } else {
                      cymbalPitch = RIDE;
                  }
              }

              // 🌟 增加踩镲的空拍概率，让律动更透气 (Create "air" in the groove)
              const dropHatProb = isSnareBeat ? 0.6 : 0.2; // 军鼓拍更容易空掉踩镲
              if (globalPRNG.next() > dropHatProb) {
                  notes.push({ pitch: cymbalPitch, onset: beat, duration: 0.1, velocity: hatVel });
              }
          } else if (energyLevel > 4 && globalPRNG.next() > (isHalfTime ? 0.9 : (isAcousticBallad ? 0.95 : 0.8))) {
              // 16th note ghost hats (进一步降低碎镲概率)
              notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: 0.2 * (isAcousticBallad ? 0.5 : 1.0) });
          }
          
          // Crash on section start, but not always
          // 🌟 强化 Crash 逻辑：如果前一个段落能量较低，或者当前是高潮段落的开始，必定打 Crash
          // We don't have previous energy level here easily, so we rely on the fact that if it's a high energy section, we crash.
          // If it's a build up, we might crash at the end of it (handled by fill logic usually, but let's ensure section starts have crashes).
          const isSignificantTransition = beat === startBeat && energyLevel >= 7; 
          
          if (beat === startBeat && energyLevel > 4 && (isSignificantTransition || globalPRNG.next() > (isAcousticBallad ? 0.6 : 0.3))) {
              // 随机选择 Crash 1 或 Crash 2
              const crashPitch = globalPRNG.next() > 0.5 ? CRASH : CRASH2;
              notes.push({ pitch: crashPitch, onset: beat, duration: 1.0, velocity: 0.85 * (isAcousticBallad ? 0.6 : 1.0) });
              
              // 🌟 如果是极其炸裂的段落开始，加一个底鼓支撑 Crash
              if (energyLevel >= 8) {
                  notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.9 });
              }
          }
    }

    // 🌟 全局拟人化处理 (Global Humanization Pass) 已移至 DrumIdiom.ts

    return this.deduplicateNotes(notes);
  }

  public static generateCounterMelody(chord: GeneratedChord, energyLevel: number, melodyNotes: NoteData[], styleId: string = "pop"): NoteData[] {
    const notes: NoteData[] = [];
    const chordTones = HarmonyCore.getChordTones(chord, 72); // Higher register (C5)
    const scalePcs = HarmonyCore.getSafeScalePitches(chord, GlobalContext.currentTonality);
    
    const activeSection = GlobalContext.getActiveSection();
    const grooveDensity = activeSection?.groove?.density ?? 0.5;
    const grooveSyncopation = activeSection?.groove?.syncopationProb ?? 0.2;

    const isJazz = styleId.toLowerCase().includes('jazz') || styleId.toLowerCase().includes('swing');
    const isPop = styleId.toLowerCase().includes('pop') || styleId.toLowerCase().includes('ballad');
    
    // 🌟 核心约束：最高同时只能发出4个乐器的声音
    // 🌟 优先级3：主副旋律互补 (Smart Counter Melody)
    
    let lastPitch = chordTones[0];
    let isActive = false;
    let phraseEndBeat = 0;

    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.5) {
        // 检查当前拍子及附近是否有主旋律
        const localMelody = melodyNotes.filter(m => m.onset >= beat - 0.5 && m.onset < beat + 1.5);
        const isMelodyDense = localMelody.length > 1; // 主旋律密集
        const melodyActive = localMelody.length > 0;
        
        if (isMelodyDense) {
            isActive = false; // 主旋律密集，副旋律立刻让路或只走长音
            if (globalPRNG.next() > 0.7 && notes.length === 0) {
                // 偶尔铺一个长音 (Pad 态)
                notes.push({ pitch: chordTones[1], onset: beat, duration: 2.0, velocity: 0.5 });
            }
            continue;
        }

        if (isActive && beat >= phraseEndBeat) {
            isActive = false;
        }

        // 只有在主旋律休息或稀疏时，才插入副旋律 (Fill)
        if (!isActive && beat >= phraseEndBeat) {
            // Decide to start a counter-melody phrase
            if (globalPRNG.next() > 0.3) {
                isActive = true;
                // Determine phrase length based on next melody note
                let maxDuration = 2.0;
                const nextMelody = melodyNotes.find(m => m.onset > beat);
                if (nextMelody) {
                    maxDuration = Math.min(maxDuration, Math.max(0, nextMelody.onset - beat - 0.25)); // Leave a small gap
                }
                phraseEndBeat = beat + maxDuration;
            }
        }

        if (isActive && beat < phraseEndBeat) {
            // Generate counter-melody notes
            const isDownbeat = beat % 1 === 0;
            const isSyncopated = beat % 0.5 !== 0;
            
            // 🌟 解决“奇怪的音”：严格控制非和弦音的使用 (Tension Tolerance)
            let pitchOptions: number[];
            if (isDownbeat || (isPop && globalPRNG.next() > 0.7)) {
                // 强拍，或流行风格的较大概率，使用和弦内音，保证和谐
                pitchOptions = chordTones;
            } else {
                // 弱拍或非流行风格，允许使用音阶内音作为经过音
                // 🌟 五声音阶兜底 (Pentatonic Priority)
                // 提取全局五声音阶并根据当前调偏移
                const root = 0; // 🌟 保持在 C 调相对位置，Orchestrator 会统一移调
                const pentatonicPcs = (GlobalContext.currentTonality === 'Minor' ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9]).map(i => (root + i) % 12);
                // 结合当前和弦音，确保不会跑调
                const safePentatonic = scalePcs.filter(pc => pentatonicPcs.includes(pc % 12) || chordTones.map(c => c % 12).includes(pc % 12));
                pitchOptions = safePentatonic.length > 0 ? safePentatonic : scalePcs;
            }

            // 🌟 解决“听感太赶”：副旋律倾向于长音
            let duration = 0.5;
            if (globalPRNG.next() > 0.6) {
                duration = 1.0; // 40% 概率使用四分音符
            } else if (globalPRNG.next() > 0.8) {
                duration = 2.0; // 20% 概率使用二分音符
            }

            // Limit duration by phrase end
            duration = Math.min(duration, phraseEndBeat - beat);

            // Select pitch close to last pitch for smooth voice leading
            const getNearestOctave = (pc: number, target: number) => {
                let p = pc % 12;
                while (p < target - 6) p += 12;
                return p;
            };

            const pitch = pitchOptions.reduce((prev, curr) => {
                const prevNearest = getNearestOctave(prev, lastPitch);
                const currNearest = getNearestOctave(curr, lastPitch);
                return Math.abs(currNearest - lastPitch) < Math.abs(prevNearest - lastPitch) ? curr : prev;
            });
            
            // Keep it in a reasonable range (C5 - G5)
            let finalPitch = getNearestOctave(pitch, lastPitch);
            if (finalPitch < 60) finalPitch += 12;
            if (finalPitch > 84) finalPitch -= 12;

            if (duration > 0) {
                notes.push({ pitch: finalPitch, onset: beat, duration, velocity: 0.6 + (energyLevel / 10) * 0.2 });
                lastPitch = finalPitch;
            }
            
            // Skip the next beat(s) based on duration
            beat += Math.max(0, duration - 0.5); // -0.5 because the loop will add 0.5
        }
    }

    return this.deduplicateNotes(notes);
  }

  public static generateChordTexture(chord: GeneratedChord, energyLevel: number, textureType: string, isSparseSection: boolean = false, isSectionEnd: boolean = false, melodyNotes: NoteData[] = [], nextChord?: GeneratedChord, styleId: string = "pop", prevVoicing?: number[], nextEnergyLevel?: number): NoteData[] {
    const notes: NoteData[] =[];
    
    const activeSection = GlobalContext.getActiveSection();
    const grooveDensity = activeSection?.groove?.density ?? 0.5;
    const grooveSyncopation = activeSection?.groove?.syncopationProb ?? 0.2;
    const isJazz = styleId.toLowerCase().includes('jazz') || styleId.toLowerCase().includes('bossa');

    let voicedTones: number[];
    
    // 🌟 平滑声部连接 (Voice Leading) & 现代 Voicing 理论
    if (prevVoicing && prevVoicing.length > 0) {
        voicedTones = HarmonyCore.getSmoothVoicing(chord, prevVoicing, 55, isJazz);
    } else {
        const rawTones = HarmonyCore.getChordTones(chord, 55);
        // 🌟 核心优化 3：底部发散，顶部密集 (Open Bottom, Dense Top)
        const isOpenVoicing = globalPRNG.next() < 0.7; // 大幅提高开放排列概率，避免浑浊
        if (isOpenVoicing) {
            // Open voicing: Root, 5th, 10th (3rd an octave up), and maybe 7th
            voicedTones = [rawTones[0]];
            if (rawTones[2]) voicedTones.push(rawTones[2]); // 5th
            if (rawTones[1]) voicedTones.push(rawTones[1] + 12); // 3rd up an octave
            if (rawTones[3]) voicedTones.push(rawTones[3] + 12); // 7th up an octave
        } else {
            // 包含根音、三音、五音，如果有七音则包含七音，否则重复根音或五音
            voicedTones = [rawTones[0], rawTones[1], rawTones[2] || rawTones[0]+7, rawTones[3] || rawTones[0]+12];
        }
        voicedTones = voicedTones.map(p => p > 65 ? p - 12 : p); 
        voicedTones.sort((a,b)=>a-b); // 再次排序确保从低到高
    }
    
    // 🌟 核心优化 4：低频避让 (Low-Frequency Clarity) & 完美五度底盘
    // 确保和声铺底的最低音与贝斯保持距离，且低音区只能是根音或五音
    const rootPc = chord.root % 12;
    const fifthPc = (chord.root + 7) % 12;
    
    voicedTones = voicedTones.map(p => {
        let safePitch = p;
        const pc = safePitch % 12;
        // 如果是三音或七音等色彩音，绝对不允许出现在 MIDI 53 (F3) 以下，防止低频打架
        if (pc !== rootPc && pc !== fifthPc) {
            while (safePitch < 53) safePitch += 12;
        } else {
            // 根音和五音可以下潜到 45 左右，形成厚实的完美五度底盘
            while (safePitch < 45) safePitch += 12;
        }
        return safePitch;
    }).sort((a, b) => a - b);

    // 🌟 核心优化 5：智能旋律避让 (Smart Melody Avoidance)
    // 如果主旋律正在唱三音，伴奏考虑省略三音，让出频段，避免打架
    const thirdPc = HarmonyCore.getChordTones(chord, 60)[1] % 12;
    const isMelodySingingThird = melodyNotes.some(m => 
        (m.onset >= chord.startBeat && m.onset < chord.endBeat) && 
        (m.pitch % 12 === thirdPc)
    );
    
    if (isMelodySingingThird && voicedTones.length > 2 && globalPRNG.next() < 0.6) {
        // 剔除伴奏中的三音
        voicedTones = voicedTones.filter(p => p % 12 !== thirdPc);
    }
    
    const willChoke = globalPRNG.next() < 0.2; 
    
    // 辅助函数：添加柱式和弦（拟人化处理已移至 PianoIdiom.ts）
    const addBlockChord = (onset: number, duration: number, baseVel: number, tones: number[] = voicedTones) => {
        tones.forEach((p) => {
            if (p !== undefined && !isNaN(p)) {
                notes.push({ pitch: p, onset: onset, duration: duration, velocity: baseVel });
            }
        });
    };

    // 🌟 解决“听感太赶”：长音铺底 (Pad) 或低能量段落，强制使用全音符
    if (textureType === 'Pad' || energyLevel <= 3) {
        // 使用 1.0 比例，让音符完全连贯，配合合成器的 release 形成滑音/连音效果
        const padDuration = Math.min((chord.endBeat - chord.startBeat) * 1.0, 8);
        addBlockChord(chord.startBeat, padDuration, 0.6, voicedTones);
        return this.deduplicateNotes(notes);
    }

    // 🌟 准备音阶数据，用于生成旋律化的分解和弦 (Arpeggio)
    const scalePcs = HarmonyCore.getSafeScalePitches(chord, GlobalContext.currentTonality);
    let currentArpPitch = voicedTones[0]; // 从根音开始
    let arpDirection = 1; // 1: 向上, -1: 向下

    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.5) {
      // 🌟 优先级1：急停/半急停 (Dynamic Dropouts)
      const barsLeftTotal = (chord.endBeat - beat) / (GlobalContext.currentTimeSignature[0] || 4);
      const isTransitionToHighEnergy = nextEnergyLevel && nextEnergyLevel > energyLevel + 1;
      if (isSectionEnd && barsLeftTotal <= 0.5 && isTransitionToHighEnergy && globalPRNG.next() > 0.3) {
          break; // 伴奏提前半小节停止，制造真空期
      }

      if (isSparseSection && isSectionEnd && willChoke && beat >= chord.endBeat - 1.0) continue;

      const isChordStart = beat === chord.startBeat;
      const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;
      const is68 = beatsPerBar === 6;
      const beatInBar = beat % beatsPerBar;
      
      // 判断当前拍子主旋律是否在发声
      const melodySinging = melodyNotes.some(m => (m.onset >= beat - 0.25 && m.onset < beat + 1.0) || (m.onset < beat && m.onset + m.duration > beat));

      // 基础力度：如果主旋律在唱，伴奏让道，力度降低 10-20 (0.1 - 0.2)
      // 用户要求：伴奏钢琴声音稍微小一点点，突出主奏
      let baseVelocity = melodySinging ? 0.45 : 0.6; // 整体提高基础力度，之前 0.35 太小了
      if (isSparseSection) baseVelocity -= 0.1;

      // 🌟 合成器专属简单脉冲织体 (Synth Pulse) - 避免古典钢琴的复杂加花
      if (textureType === "Synth_Pulse") {
          // 连续八分音符或四分音符，偶尔切分，极其直给
          const step = energyLevel >= 8 ? 0.5 : 1.0; // 高潮八分，平时四分
          if (beat % step === 0) {
              const pulseVel = baseVelocity * (beat % 1 === 0 ? 1.0 : 0.8); // 强弱分明
              addBlockChord(beat, step * 0.9, pulseVel, voicedTones);
          } else if (energyLevel >= 7 && beat % 1 === 0.5 && globalPRNG.next() > 0.5) {
              // 偶尔在反拍加一个切分
              addBlockChord(beat, 0.5, baseVelocity * 0.9, voicedTones);
          }
          continue;
      }

      // 🌟 动态节奏突变 (Rhythmic Mutation): 伴奏重音移位 (Accent Shifts / Polyrhythm) & Build-ups
      const isFillZone = beat >= chord.endBeat - 1.0;
      const isBuildUp = activeSection?.type === 'BuildUp' || (isFillZone && nextEnergyLevel && nextEnergyLevel > energyLevel + 1);
      
      if (isBuildUp) {
          // Build-up 和弦逻辑：连续的 8 分或 16 分音符柱式和弦，力度渐强
          const barsLeft = (chord.endBeat - beat) / beatsPerBar;
          let buildUpStep = 0.5; // 8th notes
          if (barsLeft <= 1.0) buildUpStep = 0.25; // 16th notes
          
          if (beat % buildUpStep === 0) {
              const buildVel = baseVelocity * (0.6 + (1 - barsLeft / 2) * 0.6); // 渐强
              addBlockChord(beat, buildUpStep * 0.8, buildVel, voicedTones);
          }
          continue;
      }

      // 在高能量段落，偶尔触发 3对4 的切分节奏 (每 0.75 拍弹一次)
      // 修复：仅在正拍 (beat % 1 === 0) 触发，且降低概率，避免听起来像乱弹
      // 再次修复：将 0.75 改为 0.5，避免产生 16 分音符的小碎音
      const mutationChance = (energyLevel / 10);
      if (energyLevel > 5 && !melodySinging && (chord.endBeat - beat) >= 2.0 && (beat % 1 === 0) && globalPRNG.next() < mutationChance * 0.05) {
          addBlockChord(beat, 0.5, baseVelocity * 1.1, voicedTones);
          addBlockChord(beat + 0.5, 0.5, baseVelocity * 1.0, voicedTones);
          addBlockChord(beat + 1.5, 0.5, baseVelocity * 0.9, voicedTones);
          beat += 1.5; // 跳过这些拍子
          continue;
      }

      // 🌟 EDM 专属 Pulsing 织体 (16分音符或8分音符脉冲)
      if (textureType === "Pulsing" && styleId === 'progressive_house') {
          // 决定脉冲密度：高潮用 16 分音符，铺垫用 8 分音符
          const step = energyLevel >= 7 ? 0.25 : 0.5;
          
          // 只有在当前 beat 匹配 step 时才生成
          if (beat % step === 0) {
              const subBeat = beatInBar % 1;
              // 伪侧链：避开正拍，或者正拍力度极小
              let pulseVel = baseVelocity;
              if (subBeat === 0) pulseVel *= 0.3; // 正拍被 Kick 压制
              else if (subBeat === 0.5) pulseVel *= 1.2; // 反拍释放
              else pulseVel *= 0.8; // 16分音符弱拍
              
              addBlockChord(beat, step * 0.8, pulseVel, voicedTones);
          }
          continue;
      }

      // 🌟 Bossa Nova 专属伴奏逻辑 (Bossa Nova Comping)
      const isBossa = styleId.toLowerCase().includes('bossa');
      if (isBossa && energyLevel > 2) {
          const twoBarBeat = beat % (beatsPerBar * 2);
          
          // Bossa Comping Rhythm (similar to clave but slightly varied)
          // Bar 1: 1, 2.5, 4
          // Bar 2: 1.5, 3, 4
          const isCompHit = 
              (twoBarBeat === 0 || twoBarBeat === 1.5 || twoBarBeat === 3) || // Bar 1
              (twoBarBeat === 5.5 || twoBarBeat === 6 || twoBarBeat === 7);   // Bar 2
              
          if (isCompHit) {
              // 🌟 Cooperative Comping:
              // If melody is singing, play fewer notes (just 3rd and 7th/5th) and softer.
              // If bass is hitting a strong downbeat (beat 0), maybe delay the chord slightly or play it softer to avoid mud.
              let tonesToPlay = voicedTones;
              let compVel = baseVelocity * 1.1;

              if (melodySinging) {
                  // Simplify voicing to avoid clashing with melody
                  tonesToPlay = voicedTones.filter(t => t !== voicedTones[0]); // Drop root, bass has it
                  if (tonesToPlay.length > 2) tonesToPlay = [tonesToPlay[0], tonesToPlay[1]]; // Keep it sparse
                  compVel *= 0.8; // Softer when melody is active
              } else {
                  compVel *= 1.3; // Louder when filling gaps
              }

              // Slightly softer on beat 1 to let the bass root ring clear
              if (beatInBar === 0) {
                  compVel *= 0.8;
              }

              // Bossa chords are typically short and staccato
              const duration = melodySinging ? 0.5 : 0.75;
              
              // Only play if we have tones left after filtering
              if (tonesToPlay.length > 0) {
                  addBlockChord(beat, duration, Math.min(1.0, compVel), tonesToPlay);
              }
          }
          
          // Add occasional ghost strums on offbeats for groove
          if (!melodySinging && beat % 0.5 === 0.25 && globalPRNG.next() > 0.7) {
              addBlockChord(beat, 0.15, baseVelocity * 0.4, [voicedTones[1] || voicedTones[0]]);
          }

          continue;
      }

      // 🌟 Funk 专属伴奏逻辑 (Funk Comping)
      const isFunk = styleId.toLowerCase().includes('funk');
      if (isFunk && energyLevel > 2) {
          // Funk Guitar/EP comping: short, staccato, syncopated 16th note hits
          // Often hits on 1.75, 2.5, 3.75, 4.0
          const isFunkHit = 
              (beatInBar === 0 && globalPRNG.next() > 0.6) ||
              (beatInBar === 0.75) ||
              (beatInBar === 1.5 && globalPRNG.next() > 0.3) ||
              (beatInBar === 2.5) ||
              (beatInBar === 3.75);

          if (isFunkHit) {
              // Very short duration for staccato feel (0.15 to 0.25)
              const duration = 0.2;
              const compVel = baseVelocity * (melodySinging ? 0.9 : 1.2);
              
              // Sometimes play full chord, sometimes just top notes (the "chank")
              const tonesToPlay = globalPRNG.next() > 0.4 ? [voicedTones[1], voicedTones[2], voicedTones[3]].filter(Boolean) : voicedTones;
              
              addBlockChord(beat, duration, compVel, tonesToPlay);
          }
          
          // 16th note muted strums (ghost notes)
          if (!isFunkHit && beat % 0.25 === 0 && globalPRNG.next() < grooveSyncopation && !melodySinging) {
              addBlockChord(beat, 0.1, baseVelocity * 0.4, [voicedTones[1] || voicedTones[0]]);
          }
          continue;
      }

      // 🌟 EDM 专属伴奏逻辑 (EDM Comping)
      const isElectronic = styleId.toLowerCase().includes('electronic') || styleId.toLowerCase().includes('dance') || styleId.toLowerCase().includes('edm') || styleId.toLowerCase().includes('house');
      if (isElectronic) {
          if (energyLevel <= 3) {
              // Intro / Break: Long Pad
              if (isChordStart) {
                  addBlockChord(beat, chord.endBeat - chord.startBeat, baseVelocity * 0.8, voicedTones);
              }
          } else if (energyLevel > 3 && energyLevel <= 6) {
              // Build-Up: Arpeggiator (8th or 16th notes) or Rhythmic Chords, increasing velocity
              const isBuildUpSection = activeSection?.type === 'BuildUp';
              const barsLeft = (chord.endBeat - beat) / beatsPerBar;
              
              if (isBuildUpSection) {
                  // 专属 Build-Up 织体：越来越密集的和弦连击
                  let buildUpStep = 0.5; // 8th notes
                  if (barsLeft <= 1.0) buildUpStep = 0.25; // 16th notes
                  
                  if (beat % buildUpStep === 0) {
                      const buildVel = baseVelocity * (0.6 + (1 - barsLeft / 2) * 0.6); // 渐强
                      addBlockChord(beat, buildUpStep * 0.8, buildVel, voicedTones);
                  }
              } else {
                  // 普通中等能量段落的 Arpeggiator
                  const is16th = energyLevel >= 5;
                  const steps = is16th ? 2 : 1;
                  const stepSize = is16th ? 0.25 : 0.5;
                  
                  for (let i = 0; i < steps; i++) {
                      const subBeat = beat + i * stepSize;
                      if (subBeat < chord.endBeat) {
                          const buildUpFactor = 1.0 + (beatInBar / beatsPerBar) * 0.3; 
                          const noteIndex = Math.floor((subBeat % 1) * (is16th ? 4 : 2)) % voicedTones.length;
                          notes.push({ pitch: voicedTones[noteIndex], onset: subBeat, duration: stepSize * 0.8, velocity: baseVelocity * 0.8 * buildUpFactor });
                      }
                  }
              }
          } else {
              // Drop (Energy 7-10): Staccato Plucks / Chords with Sidechain simulation
              // Sidechain: Weaker on downbeats, stronger on offbeats
              const subBeat = beat % 1;
              let pulseVel = baseVelocity * 1.2;
              
              if (subBeat === 0) pulseVel *= 0.3; // Ducking on the kick
              else if (subBeat === 0.5) pulseVel *= 1.1; // Off-beat release
              
              // Syncopated rhythm pattern
              if (subBeat === 0.5 || (beatInBar === 2.5) || (beatInBar === 3.5 && globalPRNG.next() > 0.5)) {
                  addBlockChord(beat, 0.25, pulseVel, voicedTones);
              } else if (subBeat === 0 && globalPRNG.next() > 0.7) {
                  // Occasional downbeat hit (ducked)
                  addBlockChord(beat, 0.25, pulseVel, voicedTones);
              }
          }
          continue;
      }

      // 🌟 Reggae 专属伴奏逻辑 (Reggae Skank)
      const isReggae = styleId.toLowerCase().includes('reggae');
      if (isReggae && energyLevel > 2) {
          // Skank chords: Short, staccato hits on beats 2 and 4 (or off-beats)
          if (beatInBar === 1 || beatInBar === 3) { // Beats 2 and 4 (0-indexed 1 and 3)
              const duration = 0.15; // Very short
              const compVel = baseVelocity * 1.3; // Accent the skank
              // Play mostly the higher notes of the chord
              const tonesToPlay = voicedTones.slice(1);
              addBlockChord(beat, duration, compVel, tonesToPlay);
          }
          
          // Occasional double skank (e.g., 2 and 2.5)
          if ((beatInBar === 1.5 || beatInBar === 3.5) && globalPRNG.next() > 0.7) {
              addBlockChord(beat, 0.15, baseVelocity * 0.9, voicedTones.slice(1));
          }
          continue;
      }

      // 🌟 Generic Arpeggio for non-electronic styles
      if (textureType === 'Arpeggio' && !isElectronic) {
          // 🌟 核心优化：基于音阶的副旋律化分解和弦 (Scale-based Melodic Arpeggio)
          // 不再死板地按顺序弹奏和弦音，而是在当前和弦的可用音阶内游走
          
          if (isChordStart) {
              // 强拍尽量落在和弦内音上，提供支撑
              currentArpPitch = voicedTones[0]; // 根音打底
          } else {
              // 弱拍可以在音阶内游走 (级进为主，偶尔跳进)
              const isStrongBeat = (beat % 1 === 0);
              const stepSize = globalPRNG.next() < 0.8 ? 1 : 2; // 80% 级进，20% 三度跳进
              
              // 遇到边界反弹 (保持在 C3 到 C5 之间，即 48 到 72)
              if (currentArpPitch > 70) arpDirection = -1;
              if (currentArpPitch < 50) arpDirection = 1;
              
              // 偶尔随机改变方向，增加灵动性
              if (globalPRNG.next() < 0.3) arpDirection *= -1;
              
              // 在音阶内移动
              currentArpPitch = HarmonyCore.shiftDiatonic(currentArpPitch, scalePcs, stepSize * arpDirection);
              
              // 如果是强拍，尽量吸附到最近的和弦内音
              if (isStrongBeat && globalPRNG.next() < 0.7) {
                  let closestChordTone = voicedTones[0];
                  let minDiff = 1000;
                  for (const ct of voicedTones) {
                      // 检查各个八度的和弦音
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
          
          // 动态力度：强拍重，弱拍轻，主旋律发声时整体变轻
          let vel = baseVelocity * (beat % 1 === 0 ? 1.0 : 0.8);
          if (melodySinging) vel *= 0.8;
          
          notes.push({ pitch: currentArpPitch, onset: beat, duration: 0.5, velocity: vel });
          continue;
      }

      if (isSparseSection || energyLevel <= 4) {
        // 🌟 现代抒情流行钢琴 (Modern Pop Ballad Comping)
        // 放弃死板的柱式和弦，改用带切分的分解与和弦交替，并避让人声
        if (isChordStart) {
            // 强拍给一个深沉的根音和五音支撑 (左手)
            notes.push({ pitch: voicedTones[0], onset: beat, duration: 4.0, velocity: baseVelocity });
            if (voicedTones.length > 2 && voicedTones[2] !== undefined) {
                notes.push({ pitch: voicedTones[2], onset: beat, duration: 4.0, velocity: baseVelocity * 0.9 });
            }
            // 右手和弦延迟进入 (延后半拍或一拍)，避开正拍的拥挤
            const rightHandDelay = globalPRNG.next() > 0.5 ? 0.5 : 1.0;
            if (beat + rightHandDelay < chord.endBeat) {
                const tonesToPlay = voicedTones.slice(1); // 弹三音、五音、七音
                addBlockChord(beat + rightHandDelay, 2.0, baseVelocity * 0.85, tonesToPlay);
            }
        } else if (!melodySinging && beatInBar === 2.5) {
            // 主奏空拍时，在弱拍后半拍 (2.5) 插入一个切分和弦，推动律动
            addBlockChord(beat, 1.5, baseVelocity * 0.9, voicedTones.slice(1));
        } else if (!melodySinging && beat >= chord.endBeat - 1.0 && globalPRNG.next() > 0.4 && !(isSparseSection && isSectionEnd)) {
            // 乐句末尾的旋律化加花 (Melodic Fill-in)
            // 弹奏和弦的最高音（通常是七音或九音）作为过渡
            const topNote = voicedTones[voicedTones.length - 1];
            notes.push({ pitch: topNote, onset: beat, duration: 1.0, velocity: baseVelocity * 0.9 });
            if (globalPRNG.next() > 0.5 && voicedTones[1] !== undefined) {
                notes.push({ pitch: voicedTones[1], onset: beat + 0.5, duration: 0.5, velocity: baseVelocity * 0.8 });
            }
            break;
        }
      } else if (energyLevel > 4 && energyLevel <= 7) {
        // 🌟 现代中速流行律动 (Modern Mid-tempo Pop Comping)
        const isBuildUp = activeSection?.type === 'BuildUp';
        if (isBuildUp) {
            // Build-up 伴奏逻辑
            const barsLeft = (chord.endBeat - beat) / beatsPerBar;
            let buildUpStep = 0.5; // 8th notes
            if (barsLeft <= 1.0) buildUpStep = 0.25; // 16th notes
            
            if (beat % buildUpStep === 0) {
                const buildVel = baseVelocity * (0.6 + (1 - barsLeft / 2) * 0.6); // 渐强
                addBlockChord(beat, buildUpStep * 0.8, buildVel, voicedTones);
            }
        } else {
            if (isChordStart) {
                // 强拍左手低音
                notes.push({ pitch: voicedTones[0], onset: beat, duration: 2.0, velocity: baseVelocity });
            } 
            
            // 🌟 流行切分律动 (Pop Syncopation)
            // 放弃死板的正拍，多用 1.5, 2.5, 3.5 这样的反拍
            const isSyncopatedHit = (beatInBar === 1.5 || beatInBar === 2.5 || beatInBar === 3.5);
            
            if (isSyncopatedHit) {
                if (melodySinging) {
                    // 主奏在时，力度放轻，只弹两个音
                    if (globalPRNG.next() > 0.3) addBlockChord(beat, 0.5, baseVelocity * 0.75, [voicedTones[1], voicedTones[2]]);
                } else {
                    // 主奏空拍时，力度加大，弹完整和弦
                    addBlockChord(beat, 0.75, baseVelocity * 0.95, voicedTones.slice(1));
                }
            } else if (!melodySinging && beatInBar === 3.75 && globalPRNG.next() > 0.6) {
                // 🌟 16分音符抢拍 (16th note push) 预示下一个和弦
                if (nextChord) {
                    const nextTones = HarmonyCore.getChordTones(nextChord, 55);
                    addBlockChord(beat, 0.25, baseVelocity * 0.85, nextTones.slice(1));
                }
            }
        }
      } else {
        // 🌟 现代高能量流行律动 (Modern High-Energy Pop Comping)
        const isBuildUp = activeSection?.type === 'BuildUp';
        if (isBuildUp) {
            // Build-up 伴奏逻辑
            const barsLeft = (chord.endBeat - beat) / beatsPerBar;
            let buildUpStep = 0.5; // 8th notes
            if (barsLeft <= 1.0) buildUpStep = 0.25; // 16th notes
            
            if (beat % buildUpStep === 0) {
                const buildVel = baseVelocity * (0.6 + (1 - barsLeft / 2) * 0.6); // 渐强
                addBlockChord(beat, buildUpStep * 0.8, buildVel, voicedTones);
            }
        } else {
            if (isChordStart) {
                // 强拍给重音
                addBlockChord(beat, 0.5, baseVelocity * 1.1, voicedTones);
            } 
            
            // 🌟 复杂的切分与反拍 (Complex Syncopation & Off-beats)
            const isSyncopatedHit = (beatInBar === 1.5 || beatInBar === 2.5 || beatInBar === 3.5);
            const is16thPush = (beatInBar === 0.75 || beatInBar === 1.75 || beatInBar === 2.75 || beatInBar === 3.75);
            
            if (isSyncopatedHit) {
                if (melodySinging && globalPRNG.next() > 0.4) {
                    addBlockChord(beat, 0.5, baseVelocity * 0.85, [voicedTones[1], voicedTones[2]]);
                } else if (!melodySinging) {
                    addBlockChord(beat, 0.5, baseVelocity * 1.05, voicedTones.slice(1));
                }
            } else if (!melodySinging && is16thPush && globalPRNG.next() > 0.6) {
                // 🌟 16分音符抢拍点缀 (16th note push comping)
                // 如果是 3.75，尝试使用经过和弦预示下一个和弦
                if (beatInBar === 3.75 && nextChord) {
                    const nextTones = HarmonyCore.getChordTones(nextChord, 55);
                    addBlockChord(beat, 0.25, baseVelocity * 0.9, nextTones.slice(1));
                } else {
                    addBlockChord(beat, 0.25, baseVelocity * 0.8, [voicedTones[1], voicedTones[2]]);
                }
            } else if (!melodySinging && beat % 1 === 0 && beatInBar !== 0 && globalPRNG.next() > 0.7) {
                // 偶尔在正拍给一个短促的柱式和弦，增加律动稳定性
                addBlockChord(beat, 0.25, baseVelocity * 0.9, voicedTones);
            }
        }
      }
    }

    // 移除导致尾音短促的逻辑，改为让最后一个和弦自然延音
    if (isSparseSection && isSectionEnd && notes.length > 0) {
       // 如果是稀疏段落的最后一个和弦（比如 Outro 结尾），让它自然延长，但限制最大长度防止采样截断
       notes.forEach(n => { n.duration = Math.min(Math.max(n.duration, 2.0), 3.0); });
    }
    return this.deduplicateNotes(notes);
  }

  private static deduplicateNotes(notes: NoteData[]): NoteData[] {
    const seen = new Set();
    return notes.filter(n => {
      const key = `${n.pitch}-${n.onset}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  // 🌟 优先级5：引入固定音型 (Riff Generator)
  public static generateRiff(chord: GeneratedChord, energyLevel: number, styleId: string): NoteData[] {
      const notes: NoteData[] = [];
      const chordTones = HarmonyCore.getChordTones(chord, 60); // C4 range
      const scalePcs = HarmonyCore.getSafeScalePitches(chord, GlobalContext.currentTonality);
      const rootMidi = chordTones[0];
      const baseVel = 0.6 + (energyLevel / 10) * 0.3;

      // 🌟 动态 Riff 生成：结合节奏细胞和音阶游走
      let currentBeat = chord.startBeat;
      let currentPitch = rootMidi;

      while (currentBeat < chord.endBeat) {
          const cell = getRandomRhythmCell(styleId, energyLevel);
          
          let advanced = false;
          for (const duration of cell) {
              if (currentBeat + duration > chord.endBeat) break; // Don't overflow chord boundary
              
              // 决定音高：70% 概率在和弦音内跳跃，30% 概率在音阶内级进
              if (globalPRNG.next() > 0.3) {
                  currentPitch = chordTones[Math.floor(globalPRNG.next() * chordTones.length)];
                  if (globalPRNG.next() > 0.5) currentPitch += 12; // 偶尔高八度
              } else {
                  const direction = globalPRNG.next() > 0.5 ? 1 : -1;
                  currentPitch = HarmonyCore.shiftDiatonic(currentPitch, scalePcs, direction);
              }

              // 限制音域在 C3 到 C5 (48 - 72)
              if (currentPitch < 48) currentPitch += 12;
              if (currentPitch > 72) currentPitch -= 12;

              // 力度：强拍重，弱拍轻
              const velocity = (currentBeat % 1 === 0) ? baseVel * 1.1 : baseVel * 0.8;

              notes.push({ pitch: currentPitch, onset: currentBeat, duration: duration * 0.8, velocity });
              currentBeat += duration;
              advanced = true;
          }
          if (!advanced) {
              // 填补剩余时间
              const remaining = chord.endBeat - currentBeat;
              if (remaining > 0.1) {
                  notes.push({ pitch: rootMidi, onset: currentBeat, duration: remaining * 0.8, velocity: baseVel });
              }
              break;
          }
      }
      return notes;
  }
}