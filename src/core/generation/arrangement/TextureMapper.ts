import { PRNGManager } from "../../utils/PRNG";
import { NoteData, GeneratedChord, StyleConfig, Tonality } from "../types";
import { HarmonyCore } from "../composing/HarmonyCore";
// S-2: GlobalContext removed — context via explicit parameters

export class TextureMapper {
  // max ~100 bass notes per chord (C-4 compliance)
  public static generateBassLine(
    chord: GeneratedChord,
    energyLevel: number,
    isSparseSection: boolean = false,
    isSectionEnd: boolean = false,
    style?: StyleConfig,
    melodyNotes: NoteData[] = [],
    isBassSolo: boolean = false,
    idiomPreferences?: any,
    nextChord?: GeneratedChord,
    nextEnergyLevel: number = 3,
  ): NoteData[] {
    // 根音计算
    const keyOffset = chord.keyOffset !== undefined ? chord.keyOffset : 0;
    let rootMidi = (chord.root + keyOffset) % 12 + 36; // E2-Eb3 range
    if (rootMidi < 28) rootMidi += 12;
    if (rootMidi > 48) rootMidi -= 12;
    const fifthMidi = rootMidi + 7;
    const octaveMidi = rootMidi + 12;

    const notes: NoteData[] = [];
    const duration = chord.endBeat - chord.startBeat;
    const baseVel = 75;
    const syncopation = style?.rhythm?.syncopationWeight ?? 0.3;

    // ============================================================
    // 能量分层贝斯（从旧 Bass Idiom 移植）
    // ============================================================

    if (energyLevel <= 3 || isSparseSection) {
      // --- 低能量：长音铺底 ---
      notes.push({ pitch: rootMidi, onset: chord.startBeat, duration: Math.min(duration, 4.0), velocity: baseVel * 0.85 });
      // 偶尔在第三拍加五度
      if (duration >= 3.0 && PRNGManager.next() < 0.3) {
        notes.push({ pitch: fifthMidi, onset: chord.startBeat + 2.0, duration: Math.min(2.0, duration - 2.0), velocity: baseVel * 0.7 });
      }
    } else if (energyLevel <= 6) {
      // --- 中能量：Groove-lock（正拍根音 + 偶尔切分）---
      for (let beat = chord.startBeat; beat < chord.endBeat; beat += 1.0) {
        const beatInChord = beat - chord.startBeat;
        const isFirst = Math.abs(beatInChord) < 1e-6;

        // 正拍根音
        notes.push({ pitch: rootMidi, onset: beat, duration: 0.75, velocity: isFirst ? baseVel : baseVel * 0.9 });

        // 切分底音（"and of" 位置，用五度或八度）
        if (beat + 0.5 < chord.endBeat && PRNGManager.next() < syncopation * 0.8) {
          const syncPitch = PRNGManager.next() > 0.6 ? fifthMidi : octaveMidi;
          notes.push({ pitch: syncPitch, onset: beat + 0.5, duration: 0.25, velocity: baseVel * 0.7 });
        }
      }
      // 和弦末尾趋近音（Approach Note）
      if (nextChord && duration >= 2.0 && PRNGManager.next() < 0.4) {
        const nextRoot = (nextChord.root + (nextChord.keyOffset ?? keyOffset)) % 12 + 36;
        const approach = PRNGManager.next() > 0.5 ? nextRoot - 1 : nextRoot + 1; // 半音趋近
        const approachOnset = chord.endBeat - 0.5;
        if (approachOnset > chord.startBeat) {
          notes.push({ pitch: approach, onset: approachOnset, duration: 0.5, velocity: baseVel * 0.8 });
        }
      }
    } else {
      // --- 高能量：活跃切分 + 经过音 + 八度跳跃 ---
      for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.5) {
        const beatInChord = beat - chord.startBeat;
        const isFirst = Math.abs(beatInChord) < 1e-6;
        const isQuarter = Math.abs(beat % 1) < 1e-6;

        if (isFirst) {
          // 和弦起始：根音强奏
          notes.push({ pitch: rootMidi, onset: beat, duration: 0.5, velocity: baseVel * 1.1 });
        } else if (isQuarter) {
          // 正拍：根音或五度
          const pitch = PRNGManager.next() < 0.7 ? rootMidi : fifthMidi;
          notes.push({ pitch: pitch, onset: beat, duration: 0.4, velocity: baseVel * 0.95 });
        } else {
          // 反拍：切分选择
          const roll = PRNGManager.next();
          if (roll < syncopation * 1.2) {
            // 八度跳跃（Pop）
            notes.push({ pitch: octaveMidi, onset: beat, duration: 0.25, velocity: baseVel * 0.85 });
          } else if (roll < syncopation * 1.8) {
            // 五度经过
            notes.push({ pitch: fifthMidi, onset: beat, duration: 0.25, velocity: baseVel * 0.75 });
          }
          // 否则留白
        }
      }
      // 高能量趋近音
      if (nextChord && PRNGManager.next() < 0.5) {
        const nextRoot = (nextChord.root + (nextChord.keyOffset ?? keyOffset)) % 12 + 36;
        const approach = PRNGManager.next() > 0.5 ? nextRoot - 1 : nextRoot + 1;
        const approachOnset = chord.endBeat - 0.25;
        if (approachOnset > chord.startBeat) {
          // 替换最后的音符
          for (let i = notes.length - 1; i >= 0; i--) {
            if (notes[i].onset >= approachOnset) { notes.splice(i, 1); }
          }
          notes.push({ pitch: approach, onset: approachOnset, duration: 0.25, velocity: baseVel * 0.85 });
        }
      }
    }

    // 长音轻微渐弱（模拟真实贝斯衰减）
    for (const n of notes) {
      if (n.duration >= 1.5) n.velocity *= 0.92;
    }

    return this.truncateToChordEnd(notes, chord.endBeat);
  }

  public static generateSignatureRiff(
    scale: number[],
    rootNote: number,
    lengthBeats: number,
    startBeat: number
  ): NoteData[] {
    const riff: NoteData[] = [];
    const rhythmMask = [1, 0, 1, 1, 0, 1, 0, 0]; 
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

  // max ~800 drum notes per section (C-4 compliance)
  public static generateDrumGroove(
    startBeat: number,
    endBeat: number,
    energyLevel: number,
    isIntro: boolean = false,
    isOutro: boolean = false,
    style?: StyleConfig,
    swingRatio: number = 0.5,
    nextEnergyLevel: number = 3,
    hasFullGrooveStarted: boolean = false,
    grooveRatio?: { foundation: number; comping: number; color: number },
    drumStyle: string = "steady",
    melodyNotes: NoteData[] = [],
    moodId: number = 0 // MoodId enum
  ): NoteData[] {
    const notes: NoteData[] = [];

    const beatsPerBar = 4;
    const grooveDensity = grooveRatio?.foundation ?? 0.5;
    const grooveSyncopation = grooveRatio?.comping ?? 0.4;

    // ============================================================
    // Mood 驱动的鼓声色彩 (Drum Voice Palette)
    // GM Drum Map: 36=Kick, 37=SideStick, 38=Snare, 39=Clap,
    // 40=ElectricSnare, 42=CHH, 44=PedalHH, 46=OHH,
    // 49=Crash, 51=Ride, 53=RideBell, 54=Tambourine, 55=Splash
    // MoodId: 0=Neutral, 1=Chill, 2=Melancholic, 3=Energetic, 4=Aggressive, 5=Euphoric
    // ============================================================
    const isChill = moodId === 1;
    const isMelancholic = moodId === 2;
    const isEnergetic = moodId === 3;
    const isAggressive = moodId === 4;
    const isEuphoric = moodId === 5;

    // --- 鼓声调色板 (Mood-driven Drum Voice Palette) ---
    // Chill/Melancholic: 柔和音色（Side Stick 代替 Snare、Pedal HH 代替 CHH、Ride 代替 Crash）
    // Energetic/Aggressive: 硬音色（Electric Snare、Open HH、Crash 密集）
    let KICK = 36;
    let SNARE = isChill || (isMelancholic && energyLevel <= 4) ? 37 : // Side Stick（刷子感）
                isAggressive ? 40 : 38; // Electric Snare vs Acoustic Snare
    const SIDE_STICK = 37;
    let CHH = (isChill || isMelancholic) ? 44 : 42; // Pedal HH（柔和）vs Closed HH
    const OHH = 46;
    const CRASH = isAggressive ? 49 : (isEuphoric ? 55 : 49); // Splash for Euphoric variety
    const RIDE = 51;
    const RIDE_BELL = 53;
    const TAMBOURINE = 54;
    const TOM_LOW = 43;

    // Chill/Melancholic 底鼓力度上限（更柔和）
    const kickVelCap = (isChill || isMelancholic) ? 65 : (isAggressive ? 100 : 85);
    const snareVelCap = (isChill || isMelancholic) ? 60 : (isAggressive ? 100 : 85);

    // 技巧预算系数（0.0=纯基础, 1.0=全技巧）
    let techniqueBudget = 0.3; // 默认：30% 技巧，70% 基础
    if (isChill)        techniqueBudget = 0.1;  // 极简：几乎纯基础
    if (isMelancholic)  techniqueBudget = 0.15; // 克制：偶尔点缀
    if (isEnergetic)    techniqueBudget = 0.6;  // 活跃：较多变化
    if (isAggressive)   techniqueBudget = 0.7;  // 猛烈：大量技巧
    // 能量级别进一步调制：低能量段即使 Aggressive 也要收敛
    techniqueBudget *= Math.min(1.0, energyLevel / 6.0);

    // 极低能量：不出鼓（或极简模式）
    if (energyLevel <= 2 && !isIntro) {
      if (isMelancholic || isChill) return notes; // 彻底安静
      // 否则只出最基础的 Kick + Side Stick
      for (let beat = startBeat; beat < endBeat; beat += 1.0) {
        const beatInBar = (beat - startBeat) % beatsPerBar;
        if (Math.abs(beatInBar) < 1e-6) {
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 55 });
        }
        if (Math.abs(beatInBar - 2) < 1e-6) {
          notes.push({ pitch: SIDE_STICK, onset: beat, duration: 0.1, velocity: 50 });
        }
      }
      this.humanizeDrums(notes, swingRatio, energyLevel);
      return notes;
    }

    // Build-up 检测（只在过渡段使用高级技巧）
    const isBuildUp = nextEnergyLevel > energyLevel + 1;
    const isFillZone = (beat: number) => beat >= endBeat - 2.0;

    // 踩镲网格步长：Chill/Melancholic 用 8 分音符(0.5)，高能量用 16 分(0.25)
    const hihatStep = (isChill || isMelancholic || energyLevel <= 4) ? 0.5 : 0.25;

    // ============================================================
    // 主循环：16 分音符网格
    // ============================================================
    for (let beat = startBeat; beat < endBeat; beat += 0.25) {
      const beatInBar = (beat - startBeat) % beatsPerBar;
      const isDownbeat = Math.abs(beatInBar) < 1e-6;
      const isBackbeat = Math.abs(beatInBar - 1) < 1e-6 || Math.abs(beatInBar - 3) < 1e-6;
      const isEighth = Math.abs(beatInBar % 0.5) < 1e-6;
      const isSixteenth = !isEighth;

      // --- Build-up 区域（仅在过渡段激活）---
      if (isBuildUp && isFillZone(beat)) {
        const barsLeft = (endBeat - beat) / beatsPerBar;
        let buildUpStep = 0.5;
        if (barsLeft <= 1.0) buildUpStep = 0.25;
        if (barsLeft <= 0.5 && techniqueBudget > 0.3) buildUpStep = 0.125; // 只有高预算才上 32 分

        if (Math.abs(beat % buildUpStep) < 1e-6) {
          const buildVel = 60 + (1 - Math.min(barsLeft, 2) / 2) * 50;
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: buildVel });
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: buildVel * 0.85 });
        }
        continue;
      }

      // === 旋律贴合（仅中高能量 + 中高技巧预算）===
      let maskAccent = 0;
      if (techniqueBudget > 0.3 && energyLevel >= 5) {
        for (let m = 0; m < melodyNotes.length; m++) {
          if (Math.abs(melodyNotes[m].onset - beat) < 0.05) { maskAccent = 1; break; }
        }
      }

      // ============ KICK（基础层 — 始终存在）============
      if (isDownbeat) {
        // Chill: 偶尔跳过正拍底鼓（留白呼吸）
        if (isChill && PRNGManager.next() < 0.15) { PRNGManager.next(); } // skip + PRNG 对齐
        else notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: Math.min(kickVelCap, 85) });
      }
      // 切分底鼓 — 受技巧预算控制
      else if (Math.abs(beatInBar - 2.5) < 1e-6 && PRNGManager.next() < grooveSyncopation * techniqueBudget * 2.0) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: Math.min(kickVelCap, 75) });
      }
      else if (Math.abs(beatInBar - 1.5) < 1e-6 && PRNGManager.next() < grooveSyncopation * techniqueBudget * 1.5) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: Math.min(kickVelCap, 65) });
      }
      else if (Math.abs(beatInBar - 3.75) < 1e-6 && PRNGManager.next() < techniqueBudget * 0.4) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: Math.min(kickVelCap, 55) });
      }
      else if (maskAccent === 1 && isSixteenth && PRNGManager.next() < techniqueBudget) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: Math.min(kickVelCap, 70) });
      }

      // ============ SNARE（基础层 — 2/4 拍）============
      if (isBackbeat) {
        // Mood 驱动军鼓音色：Chill/Melancholic 自动使用调色板中的 SNARE（已在上方设为 SideStick/标准）
        notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: Math.min(snareVelCap, SNARE === SIDE_STICK ? 60 : 85) });
      }
      // Ghost Notes — 技巧预算门控
      else if (isSixteenth && !isDownbeat && PRNGManager.next() < techniqueBudget * 0.25) {
        // Ghost note 始终用标准 Snare（即使 palette 里 SNARE=SideStick，ghost 还是轻拍鼓面）
        notes.push({ pitch: 38, onset: beat, duration: 0.1, velocity: 22 + PRNGManager.next() * 12 });
      }

      // ============ HI-HAT / CYMBAL ============
      if (Math.abs(beat % hihatStep) < 1e-6) {
        let cymbalPitch = CHH; // 已按 mood 设为 Pedal HH(44) 或 Closed HH(42)
        let cymbalVel = Math.abs(beatInBar % 1) < 1e-6 ? 70 : 50;

        // Chill/Euphoric: 偶尔换成 Ride Bell 或 Tambourine 增加色彩
        if ((isChill || isEuphoric) && PRNGManager.next() < 0.12) {
          cymbalPitch = PRNGManager.next() > 0.5 ? RIDE_BELL : TAMBOURINE;
          cymbalVel = 45;
        }

        // Chill/Melancholic：更柔和，偶尔跳过
        if ((isChill || isMelancholic) && !isDownbeat && PRNGManager.next() < 0.25) {
          PRNGManager.next(); // 消耗 PRNG 保持序列
          continue;
        }

        // Open Hi-hat — 技巧预算门控
        const isOffbeatEighth = Math.abs(beatInBar % 1 - 0.5) < 1e-6;
        if (isOffbeatEighth && PRNGManager.next() < techniqueBudget * 0.4) {
          cymbalPitch = OHH;
          cymbalVel = Math.min(127, cymbalVel * 1.15);
        }

        // 能量 ≥ 8 且高预算：镲片升级
        if (energyLevel >= 8 && techniqueBudget > 0.5 && PRNGManager.next() < 0.25) {
          cymbalPitch = RIDE;
          cymbalVel = 75;
        }

        // 左右手力度差异
        if (isOffbeatEighth) cymbalVel *= 0.78;

        notes.push({ pitch: cymbalPitch, onset: beat, duration: cymbalPitch === OHH ? 0.3 : 0.1, velocity: cymbalVel });
      }
    }

    // ============================================================
    // 后处理：装饰音 + 人性化（受技巧预算控制）
    // ============================================================
    if (techniqueBudget > 0.4) {
      this.applyDrumFlams(notes, techniqueBudget);
    }
    this.humanizeDrums(notes, swingRatio, energyLevel);

    return notes;
  }

  // --- Flam & Drag：军鼓装饰音（受预算控制）---
  private static applyDrumFlams(notes: NoteData[], techniqueBudget: number): void {
    const SNARE = 38;
    const flamProb = 0.03 * techniqueBudget;  // 预算越低越少 flam
    const dragProb = 0.015 * techniqueBudget;
    const addedNotes: NoteData[] = [];
    for (const n of notes) {
      if (n.pitch !== SNARE || n.velocity < 60) continue;
      const rand = PRNGManager.next();
      if (rand < flamProb) {
        addedNotes.push({ pitch: SNARE, onset: Math.max(0, n.onset - 0.03), duration: 0.05, velocity: n.velocity * 0.45 });
      } else if (rand < flamProb + dragProb) {
        addedNotes.push({ pitch: SNARE, onset: Math.max(0, n.onset - 0.06), duration: 0.05, velocity: n.velocity * 0.35 });
        addedNotes.push({ pitch: SNARE, onset: Math.max(0, n.onset - 0.03), duration: 0.05, velocity: n.velocity * 0.45 });
      }
    }
    for (const a of addedNotes) notes.push(a);
  }

  // --- Humanize：时值微偏移 + 力度起伏 ---
  private static humanizeDrums(notes: NoteData[], swingRatio: number, energyLevel: number): void {
    const KICK = 36, SNARE = 38, CHH = 42, OHH = 46;
    for (const n of notes) {
      const beatFrac = n.onset % 1;
      if (Math.abs(beatFrac - 0.5) < 1e-6 && Math.abs(swingRatio - 0.5) > 0.01) {
        n.onset += (swingRatio - 0.5) * 0.15;
      }
      if (n.pitch === CHH || n.pitch === OHH) {
        n.onset += (PRNGManager.next() - 0.5) * 0.03;
      } else if (n.pitch === SNARE) {
        n.onset += PRNGManager.next() * 0.01;
      }
      const jitter = (PRNGManager.next() - 0.5) * 6;
      n.velocity = Math.max(1, Math.min(127, n.velocity + jitter));
      n.onset = Math.max(0, n.onset);
    }
  }

  // max ~30 counterMelody notes per chord (C-4 compliance)
  public static generateCounterMelody(
    chord: GeneratedChord,
    energyLevel: number,
    melodyNotes: NoteData[],
    style?: StyleConfig,
    tonality: Tonality = Tonality.Major,
    sectionName: string = 'Verse'
  ): NoteData[] {
    const notes: NoteData[] = [];
    const duration = chord.endBeat - chord.startBeat;
    const chordTones = HarmonyCore.getChordTones(chord, 60); // C4 附近
    const scalePcs = HarmonyCore.getSafeScalePitches(chord, tonality);
    const localMelody = melodyNotes.filter(n => n.onset >= chord.startBeat && n.onset < chord.endBeat);

    // ============================================================
    // 三种交互模式（从旧 CounterMelody Idiom 移植）
    // 根据段落类型选择模式
    // ============================================================
    const roll = PRNGManager.next();
    let mode: 'pad' | 'callResponse' | 'parallelHarmony' = 'callResponse';
    const isChorus = sectionName.includes('Chorus') || sectionName.includes('Drop');
    const isVerse = sectionName.includes('Verse');

    if (isChorus && energyLevel >= 6) {
      // Chorus 高能量：平行和声或八度加倍（加厚旋律）
      mode = roll < 0.5 ? 'parallelHarmony' : (roll < 0.8 ? 'pad' : 'callResponse');
    } else if (isVerse || energyLevel <= 4) {
      // Verse / 低能量：Pad 铺底或 Call-and-Response（对话）
      mode = roll < 0.6 ? 'pad' : 'callResponse';
    } else {
      mode = roll < 0.4 ? 'callResponse' : (roll < 0.7 ? 'parallelHarmony' : 'pad');
    }

    if (mode === 'parallelHarmony' && localMelody.length > 0) {
      // --- Parallel Harmony：三度/六度下方跟随旋律 ---
      for (const mNote of localMelody) {
        const mPc = mNote.pitch % 12;
        // 找到音阶中下方第 3 或第 5 个音阶音
        const interval = PRNGManager.next() > 0.5 ? 3 : 5;
        let scaleIdx = -1;
        let minDiff = 99;
        for (let i = 0; i < scalePcs.length; i++) {
          const diff = Math.min(Math.abs(scalePcs[i] - mPc), 12 - Math.abs(scalePcs[i] - mPc));
          if (diff < minDiff) { minDiff = diff; scaleIdx = i; }
        }
        if (scaleIdx === -1) continue;
        const targetIdx = (scaleIdx - interval + scalePcs.length * 2) % scalePcs.length;
        const targetPc = scalePcs[targetIdx];
        let diff = targetPc - mPc;
        if (diff > 0) diff -= 12; // 确保在下方
        let targetPitch = mNote.pitch + diff;
        // 钳制音域
        while (targetPitch < 48) targetPitch += 12;
        while (targetPitch > 72) targetPitch -= 12;

        notes.push({
          pitch: targetPitch,
          onset: mNote.onset,
          duration: mNote.duration,
          velocity: mNote.velocity * 0.65, // 比旋律弱
        });
      }
    } else if (mode === 'callResponse') {
      // --- Call and Response：旋律留白时填入应答 ---
      // 找到旋律的”真空期”
      let gapStart = chord.startBeat;
      if (localMelody.length > 0) {
        const lastNote = localMelody[localMelody.length - 1];
        gapStart = Math.max(gapStart, lastNote.onset + lastNote.duration);
      }
      const gapDuration = chord.endBeat - gapStart;

      if (gapDuration >= 1.0) {
        // 有足够的真空期：填入应答乐句
        const fillCount = gapDuration >= 2.0 ? 3 : 2;
        const step = gapDuration / fillCount;
        let lastPitch = chordTones[0] + 60;

        for (let i = 0; i < fillCount; i++) {
          // 音阶级进 + 和弦音吸引
          const useChordTone = PRNGManager.next() > 0.4;
          const pool = useChordTone ? chordTones : scalePcs;
          const pc = pool[Math.floor(PRNGManager.next() * pool.length)];
          let pitch = pc + 60; // C4 附近
          // 靠近上一个音（级进）
          while (Math.abs(pitch - lastPitch) > 7) {
            if (pitch > lastPitch) pitch -= 12;
            else pitch += 12;
          }
          while (pitch < 55) pitch += 12;
          while (pitch > 76) pitch -= 12;

          notes.push({
            pitch,
            onset: gapStart + i * step,
            duration: step * 0.8,
            velocity: 50 + energyLevel * 3,
          });
          lastPitch = pitch;
        }
      } else if (localMelody.length >= 3) {
        // 旋律密集时：只放一个长音衬托
        notes.push({
          pitch: chordTones[1] !== undefined ? chordTones[1] + 60 : chordTones[0] + 60,
          onset: chord.startBeat,
          duration: Math.min(duration, 3.0),
          velocity: 40,
        });
      }
    } else {
      // --- Pad：长音铺底 ---
      // 开放排列（根-五-三高八度）增加空间感
      const padTones = chordTones.length >= 3
        ? [chordTones[0] + 48, chordTones[2] + 48, chordTones[1] + 60]
        : chordTones.map(t => t + 48);
      const padVel = 35 + energyLevel * 2;
      for (const p of padTones) {
        let pitch = p;
        while (pitch < 48) pitch += 12;
        while (pitch > 72) pitch -= 12;
        notes.push({ pitch, onset: chord.startBeat, duration: Math.min(duration, 6.0), velocity: padVel });
      }
    }

    return notes;
  }

  // 🌟 Luis 的核心算法：平稳声部连接与 Top Note 寻路 (Smooth Voice Leading & Top Note Pathing)
  private static calculateSmoothVoicing(
    chordTones: number[], // Raw pitch classes (0-11) or relative intervals
    prevVoicing: number[] | undefined,
    playBass: boolean = false
  ): number[] {
    // 1. Normalize chord tones to pitch classes (0-11)
    const pcs = chordTones.map(p => p % 12);
    
    // 2. Generate candidate voicings (Closed position inversions)
    const candidates: number[][] = [];
    // 🌟 动态频段避让 (Dynamic Register Avoidance)
    // 如果有贝斯，钢琴底线整体上移，让出低频空间 (C3 -> G3/C4)
    const baseOctave = playBass ? 55 : 45; 
    
    for (let inversion = 0; inversion < pcs.length; inversion++) {
      const voicing: number[] = [];
      let currentPitch = baseOctave;
      
      for (let i = 0; i < pcs.length; i++) {
        const pcIndex = (inversion + i) % pcs.length;
        const targetPc = pcs[pcIndex];
        
        let pitch = currentPitch;
        while (pitch % 12 !== targetPc) {
          pitch++;
        }
        voicing.push(pitch);
        currentPitch = pitch + 1; 
      }
      
      candidates.push([...voicing]);
      // 允许向上扩展一个八度的 Voicing
      candidates.push(voicing.map(p => p + 12)); 
      // 如果没有贝斯，允许向下扩展一个八度来获得更厚实的低音
      if (!playBass) {
          candidates.push(voicing.map(p => p - 12));
      }
    }
    
    // 3. If no prevVoicing, return a default balanced voicing
    if (!prevVoicing || prevVoicing.length === 0) {
      let bestCandidate = candidates[0];
      let minDist = Infinity;
      const targetCenter = playBass ? 65 : 55; // 目标中心音高
      for (const c of candidates) {
        const avg = c.reduce((a, b) => a + b, 0) / c.length;
        const dist = Math.abs(avg - targetCenter); // Closest to targetCenter
        if (dist < minDist) {
          minDist = dist;
          bestCandidate = c;
        }
      }
      return bestCandidate;
    }
    
    // 4. Cost Function (The Core of Voice Leading)
    let bestVoicing = candidates[0];
    let minCost = Infinity;
    
    const prevTop = Math.max(...prevVoicing);
    const prevBottom = Math.min(...prevVoicing);
    
    for (const candidate of candidates) {
      let cost = 0;
      
      // A. Voice Distance Cost (声部移动距离惩罚)
      for (const note of candidate) {
        let minNoteDist = Infinity;
        for (const prevNote of prevVoicing) {
          const dist = Math.abs(note - prevNote);
          if (dist < minNoteDist) minNoteDist = dist;
        }
        cost += minNoteDist;
      }
      
      // B. Top Note Pathing Cost (Top Note 寻路惩罚)
      const candidateTop = Math.max(...candidate);
      const topDist = Math.abs(candidateTop - prevTop);
      if (topDist > 5) {
          // 惩罚大于纯四度的大跳，迫使 Top Note 形成平稳旋律线
          cost += topDist * 5.0; 
      } else {
          cost += topDist * 2.0;
      }
      
      // C. Common Tone Bonus (保持音奖励)
      let commonTones = 0;
      for (const note of candidate) {
        if (prevVoicing.includes(note)) {
          cost -= 3.0; 
          commonTones++;
        }
      }
      
      // D. Parallel Motion Penalty (同升同降惩罚)
      // 如果没有保持音，且所有声部同向移动，给予惩罚
      if (commonTones === 0) {
          const candBottom = Math.min(...candidate);
          if ((candidateTop > prevTop && candBottom > prevBottom) || 
              (candidateTop < prevTop && candBottom < prevBottom)) {
              cost += 15.0; // 强力惩罚平行移动
          }
      }
      
      // E. Bass Purity Constraint (低音纯净度约束)
      // C3 (48) 以下只允许根音或五音，防止低频浑浊
      const lowestNote = Math.min(...candidate);
      const lowestPc = lowestNote % 12;
      const rootPc = pcs[0];
      const fifthPc = pcs.length > 2 ? pcs[2] : -1;
      
      if (lowestNote < 48 && lowestPc !== rootPc && lowestPc !== fifthPc) {
        cost += 50.0; 
      }
      
      if (cost < minCost) {
        minCost = cost;
        bestVoicing = candidate;
      }
    }
    
    return bestVoicing;
  }

  public static generateChordTexture(
    chord: GeneratedChord,
    energyLevel: number,
    textureType: string,
    isSparseSection: boolean = false,
    isSectionEnd: boolean = false,
    melodyNotes: NoteData[] = [],
    nextChord?: GeneratedChord,
    style?: StyleConfig,
    prevVoicing?: number[],
    nextEnergyLevel?: number,
    pianoStyle: string = "block-chord",
    densityMultiplier: number = 1.0,
    playBass: boolean = false
  ): NoteData[] {
    const targetCenter = chord.root; 
    const rawChordTones = HarmonyCore.getChordTones(chord, targetCenter);
    
    // 🌟 应用平稳声部连接算法
    const chordTones = this.calculateSmoothVoicing(rawChordTones, prevVoicing, playBass);
    
    const notes: NoteData[] = [];
    const duration = chord.endBeat - chord.startBeat;

    // 旋律感知辅助函数：检测当前位置旋律是否在发声
    const isMelodySinging = (beat: number): boolean => {
      for (let m = 0; m < melodyNotes.length; m++) {
        const mn = melodyNotes[m];
        if ((mn.onset >= beat - 0.25 && mn.onset < beat + 1.0) ||
            (mn.onset < beat && mn.onset + mn.duration > beat)) return true;
      }
      return false;
    };
    // 旋律感知：基础力度因子（旋律在唱时压低伴奏）
    const melodyVelFactor = (beat: number): number => isMelodySinging(beat) ? 0.7 : 1.0;
    // 和弦分组：左手（最低音）vs 右手（其余音）
    const leftHandPitch = chordTones[0];
    const rightHandTones = chordTones.length > 1 ? chordTones.slice(1) : chordTones;

    // 过渡真空：段落末尾 + 下段能量暴增时，提前 0.5 小节停止
    const beatsPerBar = 4;
    const isTransitionVacuum = isSectionEnd && nextEnergyLevel !== undefined && nextEnergyLevel > energyLevel + 1;
    const vacuumStart = isTransitionVacuum ? chord.endBeat - beatsPerBar * 0.5 : chord.endBeat;

    if (textureType === "Rhythmic") {
      // Funk/Rhythmic 16分音符切分断奏
      for (let beat = chord.startBeat; beat < vacuumStart; beat += 0.25) {
        const beatInBar = (beat - chord.startBeat) % beatsPerBar;
        const mVel = melodyVelFactor(beat);

        // Funk hit 位置：0, 0.75, 1.5, 2.5, 3.75
        const isFunkHit =
          (Math.abs(beatInBar) < 1e-6 && PRNGManager.next() < 0.9) ||
          (Math.abs(beatInBar - 0.75) < 1e-6 && PRNGManager.next() < 0.5) ||
          (Math.abs(beatInBar - 1.5) < 1e-6 && PRNGManager.next() < 0.6) ||
          (Math.abs(beatInBar - 2.5) < 1e-6 && PRNGManager.next() < 0.7) ||
          (Math.abs(beatInBar - 3.75) < 1e-6 && PRNGManager.next() < 0.5);

        if (isFunkHit) {
          const vel = (Math.abs(beatInBar % 1) < 1e-6 ? 80 : 65) * mVel;
          // 短促断奏
          const tonesToPlay = PRNGManager.next() > 0.4 ? rightHandTones : chordTones;
          for (const p of tonesToPlay) {
            notes.push({ pitch: p, onset: beat, duration: 0.2, velocity: vel });
          }
        }
        // 16 分音符 muted ghost strum
        if (!isFunkHit && PRNGManager.next() < 0.15) {
          notes.push({ pitch: rightHandTones[0], onset: beat, duration: 0.1, velocity: 30 * mVel });
        }
      }
    } else if (textureType === "Arpeggio" || textureType === "Pulsing") {
      // 带方向感的琶音（非机械循环）
      const scalePcs = HarmonyCore.getSafeScalePitches(chord, Tonality.Major);
      let currentArpPitch = chordTones[PRNGManager.next() > 0.6 && chordTones.length > 1 ? 1 : 0];
      let arpDirection = 1;
      const step = textureType === "Pulsing" ? 0.5 : 0.5 / densityMultiplier;

      for (let beat = chord.startBeat; beat < vacuumStart; beat += step) {
        if (beat === chord.startBeat) {
          currentArpPitch = chordTones[0]; // 和弦起始回到根音
        } else {
          // 方向翻转控制
          if (currentArpPitch > 70) arpDirection = -1;
          if (currentArpPitch < 48) arpDirection = 1;
          if (PRNGManager.next() < 0.25) arpDirection *= -1;

          // 音阶级进
          const stepSize = PRNGManager.next() < 0.8 ? 1 : 2;
          currentArpPitch = HarmonyCore.shiftDiatonic(currentArpPitch, scalePcs, stepSize * arpDirection);

          // 正拍吸引到和弦音
          if (Math.abs(beat % 1) < 1e-6 && PRNGManager.next() < 0.7) {
            let closest = chordTones[0];
            let minDiff = 999;
            for (const ct of chordTones) {
              for (let oct = -1; oct <= 1; oct++) {
                const diff = Math.abs(currentArpPitch - (ct + oct * 12));
                if (diff < minDiff) { minDiff = diff; closest = ct + oct * 12; }
              }
            }
            currentArpPitch = closest;
          }
        }

        const mVel = melodyVelFactor(beat);
        const vel = (Math.abs(beat % 1) < 1e-6 ? 70 : 55) * mVel;
        const gateTime = densityMultiplier > 1.5 ? step * 0.8 : step * 0.95;

        // 旋律在唱时偶尔跳过（让出空间）
        if (isMelodySinging(beat) && PRNGManager.next() < 0.25) continue;

        notes.push({ pitch: currentArpPitch, onset: beat, duration: gateTime, velocity: vel });
      }
    } else if (textureType === "Pad") {
      // 长音铺底 + Open Voicing（三音展开到宽音程）
      let padTones = chordTones;
      if (chordTones.length >= 3 && PRNGManager.next() > 0.3) {
        padTones = [chordTones[0], chordTones[2], chordTones[1] + 12];
        if (chordTones.length > 3) {
          for (let k = 3; k < chordTones.length; k++) padTones.push(chordTones[k] + 12);
        }
      }
      const padVel = isMelodySinging(chord.startBeat) ? 40 : 60;
      for (const pitch of padTones) {
        notes.push({ pitch, onset: chord.startBeat, duration: Math.min(duration, 8), velocity: padVel });
      }
    } else {
      // Block chord — 能量分层行为（从 BlockChordPianoIdiom 移植）
      const baseVel = 65 * melodyVelFactor(chord.startBeat);

      if (energyLevel <= 4 || isSparseSection) {
        // --- 低能量：左右手分离，稀疏铺底 ---
        // 左手根音长音
        notes.push({ pitch: leftHandPitch, onset: chord.startBeat, duration: Math.min(duration, 4.0), velocity: baseVel });
        // 右手延迟进入（模拟呼吸）
        const rhDelay = PRNGManager.next() > 0.5 ? 0.5 : 1.0;
        if (chord.startBeat + rhDelay < chord.endBeat) {
          for (const p of rightHandTones) {
            notes.push({ pitch: p, onset: chord.startBeat + rhDelay, duration: Math.min(2.0, duration - rhDelay), velocity: baseVel * 0.85 });
          }
        }
        // 偶尔在和弦末尾加一个 top note 装饰
        if (!isMelodySinging(chord.endBeat - 1.0) && duration >= 2.0 && PRNGManager.next() < 0.35) {
          notes.push({ pitch: chordTones[chordTones.length - 1], onset: chord.endBeat - 1.0, duration: 1.0, velocity: baseVel * 0.75 });
        }
      } else if (energyLevel <= 7) {
        // --- 中能量：正拍 + 切分律动 ---
        // 正拍柱式和弦
        notes.push({ pitch: leftHandPitch, onset: chord.startBeat, duration: 2.0, velocity: baseVel });
        for (const p of rightHandTones) {
          notes.push({ pitch: p, onset: chord.startBeat, duration: 1.0, velocity: baseVel * 0.9 });
        }
        // 切分位置加和弦
        for (let beat = chord.startBeat + 0.25; beat < vacuumStart; beat += 0.25) {
          const beatInBar = (beat - chord.startBeat) % beatsPerBar;
          const isSyncopated = (Math.abs(beatInBar - 1.5) < 1e-6 || Math.abs(beatInBar - 2.5) < 1e-6 || Math.abs(beatInBar - 3.5) < 1e-6);
          if (isSyncopated && PRNGManager.next() < 0.45) {
            const mVel = melodyVelFactor(beat);
            const tonesToPlay = isMelodySinging(beat) ? rightHandTones.slice(0, 2) : rightHandTones;
            for (const p of tonesToPlay) {
              notes.push({ pitch: p, onset: beat, duration: 0.5, velocity: baseVel * 0.8 * mVel });
            }
          }
        }
        // 减七经过和弦（和弦末尾，接下一个和弦）
        if (nextChord && duration >= 2.0 && PRNGManager.next() < 0.2) {
          const nextRoot = HarmonyCore.getChordTones(nextChord, 55)[0];
          const approachRoot = PRNGManager.next() > 0.5 ? nextRoot - 1 : nextRoot + 1;
          const dim7 = [approachRoot, approachRoot + 3, approachRoot + 6, approachRoot + 9];
          const fillStart = chord.endBeat - 0.5;
          if (fillStart > chord.startBeat) {
            for (const p of dim7) {
              notes.push({ pitch: p, onset: fillStart, duration: 0.5, velocity: baseVel * 0.7 });
            }
          }
        }
      } else {
        // --- 高能量：左右手分离 + 幽灵音 + 动态加花 ---
        const leftGhost = leftHandPitch + 7; // 五度幽灵音

        for (let beat = chord.startBeat; beat < vacuumStart; beat += 0.25) {
          const beatInBar = (beat - chord.startBeat) % beatsPerBar;
          const mVel = melodyVelFactor(beat);
          const isChordStart = Math.abs(beat - chord.startBeat) < 1e-6;

          if (isChordStart) {
            // 正拍：左右手同时
            notes.push({ pitch: leftHandPitch, onset: beat, duration: 1.0, velocity: baseVel * 1.1 * mVel });
            for (const p of rightHandTones) {
              notes.push({ pitch: p, onset: beat, duration: 0.75, velocity: baseVel * mVel });
            }
          }

          // 左手幽灵音（1.5/2.5 拍位）
          if ((Math.abs(beatInBar - 1.5) < 1e-6 || Math.abs(beatInBar - 2.5) < 1e-6) && PRNGManager.next() < 0.5) {
            notes.push({ pitch: leftGhost, onset: beat, duration: 0.25, velocity: 30 * mVel });
          }

          // 切分右手和弦
          const isSyncopated = (Math.abs(beatInBar - 1.5) < 1e-6 || Math.abs(beatInBar - 2.5) < 1e-6 || Math.abs(beatInBar - 3.5) < 1e-6);
          const is16thPush = (Math.abs(beatInBar - 0.75) < 1e-6 || Math.abs(beatInBar - 2.75) < 1e-6 || Math.abs(beatInBar - 3.75) < 1e-6);

          if (isSyncopated && PRNGManager.next() < 0.6) {
            for (const p of (isMelodySinging(beat) ? rightHandTones.slice(0, 2) : rightHandTones)) {
              notes.push({ pitch: p, onset: beat, duration: 0.5, velocity: baseVel * 0.9 * mVel });
            }
          } else if (is16thPush && PRNGManager.next() < 0.35) {
            // 16 分抢拍
            if (Math.abs(beatInBar - 3.75) < 1e-6 && nextChord) {
              // 和弦末尾：用下一个和弦的音抢拍（Anticipation）
              const nextTones = HarmonyCore.getChordTones(nextChord, 55);
              for (const p of nextTones.slice(1, 3)) {
                notes.push({ pitch: p, onset: beat, duration: 0.25, velocity: baseVel * 0.75 * mVel });
              }
            } else {
              for (const p of rightHandTones.slice(0, 2)) {
                notes.push({ pitch: p, onset: beat, duration: 0.25, velocity: baseVel * 0.7 * mVel });
              }
            }
          }

          // 动态加花：旋律气口处的高音跳进
          if (!isMelodySinging(beat) && Math.abs(beatInBar - 2.0) < 1e-6 && PRNGManager.next() < 0.15) {
            const topNote = rightHandTones[rightHandTones.length - 1];
            notes.push({ pitch: topNote + 12, onset: beat, duration: 0.25, velocity: baseVel * 0.9 });
            notes.push({ pitch: topNote + 7, onset: beat + 0.25, duration: 0.25, velocity: baseVel * 0.8 });
            notes.push({ pitch: topNote + 12, onset: beat + 0.5, duration: 0.5, velocity: baseVel * 0.85 });
          }
        }
      }
    }

    // ============================================================
    // 后处理管线：从旧 PianoIdiom 移植的核心技法
    // ============================================================

    // P0: 低频密集音程拦截 — 48 以下两音间距 <7 半音则上移八度
    this.fixDenseIntervals(notes);

    // P0: Sakamoto 减法 — 张力和弦 70% 概率省略五音（减少臃肿）
    this.applySakamotoSubtraction(notes, chord, chordTones);

    // P1: Beat Hierarchy Velocity — 强弱拍力度分层（消除机械感）
    this.applyBeatHierarchy(notes, chord.startBeat);

    // P1: Jazz Grace Notes — 和弦最高音下方半音装饰（仅高能量段）
    if (energyLevel > 4 && !isSparseSection) {
      this.injectGraceNotes(notes, chord);
    }

    // P1: Ghost Chords — 反拍极弱重复和弦（仅非 Pad/Arpeggio）
    if (textureType !== "Pad" && textureType !== "Arpeggio" && energyLevel > 3 && !isSparseSection) {
      this.injectGhostChords(notes, chord, chordTones);
    }

    // P1: Pop 琶音过渡 Fill — 长间隔处右手琶音
    if (energyLevel > 4 && textureType !== "Arpeggio") {
      this.injectArpeggioFill(notes, chord, chordTones);
    }

    // P2: Smart Pedal — 按能量控制延音
    this.applySmartPedal(notes, energyLevel, chord.endBeat);

    return this.truncateToChordEnd(notes, chord.endBeat);
  }

  // --- P0: 低频密集音程拦截 ---
  // max ~20 notes 输入 (C-4 compliance)
  private static fixDenseIntervals(notes: NoteData[]): void {
    // 收集当前和弦中所有不同音高并排序
    const pitches: number[] = [];
    for (const n of notes) {
      if (pitches.indexOf(n.pitch) === -1) pitches.push(n.pitch);
    }
    pitches.sort((a, b) => a - b);

    // 检查 48 以下相邻音间距
    for (let i = 0; i < pitches.length - 1; i++) {
      if (pitches[i] < 48) {
        const interval = pitches[i + 1] - pitches[i];
        if (interval > 0 && interval < 7) {
          const oldPitch = pitches[i + 1];
          const newPitch = oldPitch + 12;
          // 更新所有使用该音高的音符
          for (const n of notes) {
            if (n.pitch === oldPitch) n.pitch = newPitch;
          }
          pitches[i + 1] = newPitch;
          pitches.sort((a, b) => a - b);
          i = -1; // 重新扫描
        }
      }
    }
  }

  // --- P0: Sakamoto 减法 ---
  private static applySakamotoSubtraction(notes: NoteData[], chord: GeneratedChord, chordTones: number[]): void {
    const highTensionQualities = ['Major7', 'Minor7', 'Dominant7', 'Add9', 'Minor9', 'Major9', 'Dominant9', 'Minor11', 'Dominant13', 'HalfDiminished'];
    if (!highTensionQualities.includes(chord.quality)) return;
    if (chordTones.length <= 3) return;
    if (PRNGManager.next() >= 0.7) return;

    // 找到五音的 pitch class
    const rootPc = chordTones[0] % 12;
    const fifthPc = (rootPc + 7) % 12;

    // 从 notes 中删除五音（保留至少 2 个不同音高）
    let uniquePitchCount = 0;
    const seenPc: number[] = [];
    for (const n of notes) {
      const pc = n.pitch % 12;
      if (seenPc.indexOf(pc) === -1) { seenPc.push(pc); uniquePitchCount++; }
    }
    if (uniquePitchCount <= 2) return;

    for (let i = notes.length - 1; i >= 0; i--) {
      if (notes[i].pitch % 12 === fifthPc) {
        notes.splice(i, 1);
      }
    }
  }

  // --- P1: Beat Hierarchy Velocity ---
  private static applyBeatHierarchy(notes: NoteData[], chordStartBeat: number): void {
    for (const n of notes) {
      const beatInBar = (n.onset - chordStartBeat) % 4; // 假设 4/4
      const isDownbeat = Math.abs(beatInBar) < 1e-6 || Math.abs(beatInBar - 2) < 1e-6;
      const isOffbeat = Math.abs(beatInBar % 1 - 0.5) < 1e-6;

      if (isDownbeat) {
        n.velocity = Math.min(127, n.velocity * 1.08);
      } else if (isOffbeat) {
        n.velocity = n.velocity * 0.85;
      }
      // 微小随机扰动
      n.velocity = Math.max(1, Math.min(127, n.velocity + (PRNGManager.next() - 0.5) * 6));
    }
  }

  // --- P1: Jazz Grace Notes ---
  // max ~5 grace notes per chord (C-4 compliance)
  private static injectGraceNotes(notes: NoteData[], chord: GeneratedChord): void {
    if (PRNGManager.next() >= 0.25) return; // 25% 概率

    // 找到和弦内最高的一组音符（同一 onset 的）
    let maxPitch = 0;
    let targetOnset = chord.startBeat;
    for (const n of notes) {
      if (n.pitch > maxPitch) {
        maxPitch = n.pitch;
        targetOnset = n.onset;
      }
    }
    if (maxPitch === 0) return;

    notes.push({
      pitch: maxPitch - 1, // 半音下方
      onset: targetOnset - 0.06, // 提前约 60ms
      duration: 0.06,
      velocity: Math.max(1, maxPitch > 127 ? 40 : 40) // 极弱
    });
  }

  // --- P1: Ghost Chords ---
  // max ~10 ghost notes per chord (C-4 compliance)
  private static injectGhostChords(notes: NoteData[], chord: GeneratedChord, chordTones: number[]): void {
    if (PRNGManager.next() >= 0.35) return; // 35% 概率

    const chordLen = chord.endBeat - chord.startBeat;
    if (chordLen < 1.0) return;

    // 在第一个反拍位置放一个极弱的幽灵和弦
    const ghostOnset = chord.startBeat + 0.5;
    if (ghostOnset >= chord.endBeat) return;

    for (const pitch of chordTones) {
      notes.push({
        pitch: pitch,
        onset: ghostOnset,
        duration: 0.15,
        velocity: 30 // 极弱
      });
    }
  }

  // --- P1: Pop 琶音过渡 Fill ---
  // max ~6 fill notes per chord (C-4 compliance)
  private static injectArpeggioFill(notes: NoteData[], chord: GeneratedChord, chordTones: number[]): void {
    if (PRNGManager.next() >= 0.3) return; // 30% 概率

    const chordLen = chord.endBeat - chord.startBeat;
    if (chordLen < 2.0) return; // 只在长和弦中

    // 取最高 3 个音做下行琶音
    const sortedTones = chordTones.slice().sort((a, b) => b - a).slice(0, 3);
    const fillStart = chord.startBeat + chordLen * 0.6; // 和弦后 60% 位置

    for (let i = 0; i < sortedTones.length; i++) {
      const fillOnset = fillStart + i * 0.25;
      if (fillOnset >= chord.endBeat - 0.1) break;
      notes.push({
        pitch: sortedTones[i],
        onset: fillOnset,
        duration: 0.25,
        velocity: 45 // 柔和
      });
    }
  }

  // --- P2: Smart Pedal (延音控制) ---
  private static applySmartPedal(notes: NoteData[], energyLevel: number, chordEndBeat: number): void {
    // 高能量段：音符较短（干脆）；低能量段：音符较长（延音）
    const durationScale = energyLevel <= 4 ? 1.2 : (energyLevel <= 6 ? 1.0 : 0.8);

    for (const n of notes) {
      const maxDur = chordEndBeat - n.onset - 0.05; // 留 0.05 拍缝隙防糊
      if (maxDur <= 0) continue;
      n.duration = Math.min(n.duration * durationScale, maxDur);
      n.duration = Math.max(n.duration, 0.05); // 最短 0.05 拍
    }
  }

  private static truncateToChordEnd(notes: NoteData[], chordEndBeat: number): NoteData[] {
    return notes.map(n => {
      if (n.onset >= chordEndBeat) return null;
      if (n.onset + n.duration > chordEndBeat) {
        return { ...n, duration: chordEndBeat - n.onset };
      }
      return n;
    }).filter(n => n !== null) as NoteData[];
  }

  private static deduplicateNotes(notes: NoteData[]): NoteData[] {
    // P-1: linear scan dedup without Set (pitch*10000+onset as numeric key)
    const seen: number[] = [];
    const result: NoteData[] = [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      // Encode pitch and onset into a single number for comparison
      // Use pitch * 100000 + onset * 100 to avoid collisions
      const key = n.pitch * 100000 + Math.round(n.onset * 100);
      if (seen.indexOf(key) === -1) {
        seen.push(key);
        result.push(n);
      }
    }
    return result;
  }

  public static generateRiff(
    chord: GeneratedChord,
    energyLevel: number,
    style?: StyleConfig,
  ): NoteData[] {
    return [];
  }

  public static generateVocalHarmony(
    melodyNotes: NoteData[],
    chords: GeneratedChord[],
    style: StyleConfig | undefined,
    energyLevel: number,
    tonality: Tonality
  ): NoteData[] {
    return [];
  }
}

