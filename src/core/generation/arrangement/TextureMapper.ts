import { PRNGManager } from "../../utils/PRNG";
import { NoteData, GeneratedChord, Tonality } from "../types";
import { HarmonyCore } from "../composing/HarmonyCore";
import { GlobalContext } from "../GlobalContext";
import { ENERGY } from "../config/EnergyThresholds";

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
  // 🌟 跨和弦 bass 状态：上一个和弦最后一个 bass 音高，用于跳跃限制
  private static prevBassRootMidi: number = -1;

  public static generateBassLine(
    chord: GeneratedChord,
    energyLevel: number,
    isSparseSection: boolean = false,
    isSectionEnd: boolean = false,
    melodyNotes: NoteData[] = [],
    isBassSolo: boolean = false,
    nextChord?: GeneratedChord,
    nextEnergyLevel: number = 3,
    kickAnchors: number[] = [],
    subgenre: string = 'Pop',  // 🌟 F-Bass-Subgenre: 子风格选择 bass pattern
  ): NoteData[] {
    const bassTones = HarmonyCore.getChordTones(chord, 36);
    let rootMidi = bassTones[0];
    const fifthMidi = bassTones.length > 2 ? bassTones[2] : rootMidi; // 五音
    const chordLen = chord.endBeat - chord.startBeat;
    const notes: NoteData[] = [];

    // 消耗 1 次 PRNG 保持序列对齐（原有分支消耗）
    PRNGManager.next();

    // 🌟 跳跃限制：如果与上一个 bass 音跳跃 > 5 半音，就近转位
    if (this.prevBassRootMidi > 0) {
      const jump = Math.abs(rootMidi - this.prevBassRootMidi);
      if (jump > 5) {
        // 尝试上/下八度，选择距离上一个音最近的
        const candidates = [rootMidi, rootMidi + 12, rootMidi - 12];
        let bestPitch = rootMidi;
        let bestDist = jump;
        for (let ci = 0; ci < candidates.length; ci++) {
          const d = Math.abs(candidates[ci] - this.prevBassRootMidi);
          if (d < bestDist && candidates[ci] >= 28 && candidates[ci] <= 43) {
            bestDist = d;
            bestPitch = candidates[ci];
          }
        }
        rootMidi = bestPitch;
      }
    }

    if (isSparseSection || energyLevel <= ENERGY.SILENT_MAX) {
      // 稀疏段落：半音符根音
      notes.push({ pitch: rootMidi, onset: chord.startBeat, duration: Math.min(chordLen, 2), velocity: 0.7 });
    } else {
      // 🌟 F-Bass-Subgenre + F-Bass-Groove: 4 种 bass pattern（与鼓组 subgenre 同步）
      // hits[i] 是相对 chord.startBeat 的拍位（从 0 开始）；hitDurations 是各 hit 的时值
      // 全部确定性，不消耗 PRNG
      let bassPattern: { hits: number[], duration: number }[];
      if (subgenre === 'Funk') {
        // Funk: 反拍切分 + 16 分 ghost（对齐 Funk kick 的 1 / 1.75 / 3 / 3.75 拍位）
        bassPattern = [
          { hits: [0, 1.75, 2, 3.75], duration: 0.5 },        // 4 hits per 4 beats
        ];
      } else if (subgenre === 'Lo-fi') {
        // Lo-fi: walking bass，半音符 + 偶尔 walk
        bassPattern = [
          { hits: [0, 2, 3], duration: 0.75 },
        ];
      } else if (subgenre === 'Latin') {
        // Latin: 切分根音（对齐 Latin kick 的 1 / 2.75 / 3.5）
        bassPattern = [
          { hits: [0, 2.5, 3.5], duration: 0.5 },
        ];
      } else {
        // Pop（默认）: 每拍弹根音
        bassPattern = [
          { hits: energyLevel >= ENERGY.HIGH_MIN ? [0, 1, 2, 3] : [0, 2], duration: energyLevel >= ENERGY.HIGH_MIN ? 1 : 2 },
        ];
      }

      const subPat = bassPattern[0];
      const subHits = subPat.hits;
      const subStep = subPat.duration;

      // 用 hits 数组生成贝斯（对 chord 长度做 wrap）
      let beat = chord.startBeat;
      while (beat < chord.endBeat - 1e-6) {
        // 找当前 beat 在 chord 内的相对位置（mod 4 拍 - 一个 bar 的 hits cycle）
        const relInBar = (beat - chord.startBeat) % 4;
        // 当前 beat 是否落在 hits 上（容差 0.05 拍）
        let isHit = false;
        for (let h = 0; h < subHits.length; h++) {
          if (Math.abs(relInBar - subHits[h]) < 0.05) { isHit = true; break; }
        }
        if (!isHit) {
          // 不是 hit 位，前进 0.25 拍找下个机会
          beat += 0.25;
          continue;
        }

        const step = subStep;
        const isLastStep = (beat + step >= chord.endBeat - 1e-6);
        const vel = Math.abs(beat % 2) < 1e-6 ? 0.75 : 0.6;

        // 🌟 PR#10-A: Root-Fifth Bass Pattern (deterministic, 高能量段落才生效)
        // step=1 的高能量段:弱拍(beat 1/3)按 hash 决策用 fifth 替代 root,打破单调
        // 不消耗 PRNG,选就近八度保持音域
        let rootPitchForThisStep = rootMidi;
        if (step === 1 && !isLastStep && energyLevel >= ENERGY.HIGH_MIN) {
          const beatInChord = beat - chord.startBeat;
          const isKickBeat = Math.abs((beatInChord % 2)) < 1e-6; // 0, 2 是 Kick 拍
          if (!isKickBeat) {
            // 弱拍(1, 3):hash 决策 40% 用 fifth
            const hash = Math.floor(Math.abs(beat * 7 + rootMidi)) % 5;
            if (hash < 2) {
              let fifth = fifthMidi;
              while (fifth > 43) fifth -= 12;
              while (fifth < 28) fifth += 12;
              // 跳跃保护:如果 fifth 距离 rootMidi 过远就放弃
              if (Math.abs(fifth - rootMidi) <= 7) rootPitchForThisStep = fifth;
            }
          }
        }

        // 🌟 Approach note：和弦最后一拍，如果有 nextChord 且根音跳跃 > 2 半音，
        // 注入半音趋近音（chromatic approach）指向下一和弦根音
        //
        // 🌟 PR #4 修复：
        // 1. approach note 时值固定 0.25 拍（16 分音符）—— 旧版 step=2 时
        //    approachDur=1 拍，听起来像主音不像 leading tone，且与当前 chord 冲突
        // 2. chord-out 检查：如果 approachPitch 不在当前 chord 内，必须保持短时值
        //    避免在 Iadd9 上听到一个长 C# 这种调外冲突
        if (isLastStep && nextChord && !isSectionEnd) {
          const nextBassTones = HarmonyCore.getChordTones(nextChord, 36);
          let nextRoot = nextBassTones[0];
          // 就近选择八度
          const nextCandidates = [nextRoot, nextRoot + 12, nextRoot - 12];
          let bestNext = nextRoot;
          let bestNextDist = 999;
          for (let ni = 0; ni < nextCandidates.length; ni++) {
            const d = Math.abs(nextCandidates[ni] - rootMidi);
            if (d < bestNextDist && nextCandidates[ni] >= 28 && nextCandidates[ni] <= 43) {
              bestNextDist = d;
              bestNext = nextCandidates[ni];
            }
          }

          const approachInterval = bestNext - rootMidi;
          if (Math.abs(approachInterval) > 2) {
            // 半音趋近：从当前根音向下一根音方向走一个半音
            const approachPitch = bestNext + (approachInterval > 0 ? -1 : 1);
            const approachClamp = Math.max(28, Math.min(43, approachPitch));

            // 🌟 PR #4: chord-out 检查
            // 当前 chord 的所有 pitch class（注意 bassTones 是绝对 MIDI，要 % 12）
            const chordPcs = bassTones.map(p => ((p % 12) + 12) % 12);
            const approachPc = ((approachClamp % 12) + 12) % 12;
            const isChordOut = !chordPcs.includes(approachPc);

            const totalDur = Math.min(step, chord.endBeat - beat);
            // 🌟 PR #4: chord-out 的 leading tone 必须 ≤ 0.25 拍（16 分音符）
            // chord-in 的 approach 可以稍微长一点（≤ 0.5）但仍受限
            const approachDur = isChordOut
              ? Math.min(0.25, totalDur * 0.25)
              : Math.min(0.5, totalDur * 0.5);
            const mainDur = Math.max(0.25, totalDur - approachDur);

            notes.push({ pitch: rootPitchForThisStep, onset: beat, duration: mainDur, velocity: vel });
            notes.push({ pitch: approachClamp, onset: beat + mainDur, duration: approachDur, velocity: vel * 0.7 });
          } else {
            notes.push({ pitch: rootPitchForThisStep, onset: beat, duration: Math.min(step, chord.endBeat - beat), velocity: vel });
          }
        } else {
          notes.push({ pitch: rootPitchForThisStep, onset: beat, duration: Math.min(step, chord.endBeat - beat), velocity: vel });
        }
        beat += 0.25;  // 🌟 F-Bass-Subgenre: 每 0.25 拍推进找下一 hit（替代固定 step 推进）
      }
    }

    // 更新 prevBassRootMidi 供下一个和弦使用
    this.prevBassRootMidi = rootMidi;

    // 🌟 PR#9 §4.1: Kick 锚点 velocity 重心
    // Bass 发声若对齐 Kick 触发点 → velocity +0.1(地基感)
    // 未对齐 → velocity -0.05(弱拍感)
    // 不消耗 PRNG,ACVE 兼容;不改变节奏,仅 velocity 加权
    if (kickAnchors.length > 0) {
      for (let i = 0; i < notes.length; i++) {
        let onKick = false;
        for (let k = 0; k < kickAnchors.length; k++) {
          if (Math.abs(notes[i].onset - kickAnchors[k]) < 1e-6) {
            onKick = true;
            break;
          }
        }
        if (onKick) {
          notes[i].velocity = Math.min(1.0, notes[i].velocity + 0.1);
        } else {
          notes[i].velocity = Math.max(0.3, notes[i].velocity - 0.05);
        }
      }
    }

    const truncated = this.truncateToChordEnd(notes, chord.endBeat);
    this.clampToRange(truncated, 28, 43); // Bass: E1 ~ G2
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
    melodyNotes: NoteData[] = [],
    subgenre: string = 'Pop',  // 🌟 F-Drum: 子风格控制鼓 pattern
  ): NoteData[] {
    const KICK = 36;
    const SNARE = 38;
    const CHH = 42; // Closed hi-hat
    const OHH = 46; // Open hi-hat
    const CRASH = 49;
    // 🌟 F-Drum-Tom: tom 鼓（GM 标准）
    const TOM_LOW = 41;   // Low Floor Tom
    const TOM_MID = 47;   // Low-Mid Tom
    const TOM_HIGH = 50;  // High Tom
    const RIDE = 51;

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

    // 🌟 F-Drum: 4 种子风格 pattern（kick/snare/hihat 网格步进，16th 颗粒度）
    // 每个 step = 0.25 拍，1 小节 = 16 step（4/4 拍）
    // 数组定义：每 step 是否触发（true/false），velocity hint，swing 偏移可选
    type DrumStep = { kick?: boolean; snare?: boolean; hihat?: boolean; openHat?: boolean; ghost?: boolean };
    let pattern: DrumStep[] = [];

    if (subgenre === 'Funk') {
      // Funk: 反拍 kick + 16 分 hi-hat + 偶尔 syncopated snare
      // 经典 James Brown / Funky drummer 简化版
      pattern = [
        { kick: true, hihat: true },              // step 0: 1 拍 kick + hh
        { hihat: true, ghost: true },             // 0.5 + e
        { kick: true, hihat: true },              // 0.75 + a (kick 反拍)
        { hihat: true },                          // 1
        { snare: true, hihat: true },             // 1 拍 snare
        { hihat: true, ghost: true },             // e
        { kick: true, hihat: true, openHat: true },// kick + open hh (funk groove)
        { hihat: true },                          // a
        { kick: true, hihat: true },              // 3 拍 kick
        { hihat: true },                          // e
        { hihat: true, ghost: true },             // and
        { kick: true, hihat: true },              // a (kick 反拍切分)
        { snare: true, hihat: true },             // 4 拍 snare
        { hihat: true, ghost: true },             // e
        { hihat: true },                          // and
        { hihat: true },                          // a
      ];
    } else if (subgenre === 'Lo-fi') {
      // Lo-fi: kick 1+3, snare 2+4, hi-hat 8 分但 swing
      pattern = [
        { kick: true, hihat: true },              // 1
        {},                                       // e
        { hihat: true },                          // and
        {},                                       // a
        { snare: true, hihat: true },             // 2
        {},                                       // e
        { hihat: true, ghost: true },             // and
        {},                                       // a
        { kick: true, hihat: true },              // 3
        {},                                       // e
        { hihat: true },                          // and
        { ghost: true },                          // a (lazy ghost)
        { snare: true, hihat: true },             // 4
        {},                                       // e
        { hihat: true },                          // and
        {},                                       // a
      ];
    } else if (subgenre === 'Latin') {
      // Latin: 切分 kick (1+3.5) + snare 2+4 + 三角铁式 hi-hat
      pattern = [
        { kick: true, hihat: true },              // 1
        { hihat: true },                          // e
        { hihat: true },                          // and
        { hihat: true },                          // a
        { snare: true, hihat: true },             // 2
        { hihat: true },                          // e
        { hihat: true },                          // and
        { kick: true, hihat: true },              // a (kick syncopated 切分)
        { hihat: true },                          // 3
        { hihat: true },                          // e
        { kick: true, hihat: true },              // and (kick on 3.5)
        { hihat: true },                          // a
        { snare: true, hihat: true },             // 4
        { hihat: true },                          // e
        { hihat: true },                          // and
        { hihat: true },                          // a
      ];
    } else {
      // Pop（默认）: 经典 kick 1+3, snare 2+4, hi-hat 8 分
      pattern = [
        { kick: true, hihat: true },              // 1
        {},                                       // e
        { hihat: true },                          // and
        {},                                       // a
        { snare: true, hihat: true },             // 2
        {},                                       // e
        { hihat: true },                          // and
        {},                                       // a
        { kick: true, hihat: true },              // 3
        {},                                       // e
        { hihat: true },                          // and
        {},                                       // a
        { snare: true, hihat: true },             // 4
        {},                                       // e
        { hihat: true },                          // and
        {},                                       // a
      ];
    }

    // 应用 pattern：扫描每 16th step
    let beat = startBeat;
    while (beat < endBeat - 1e-6) {
      const stepInBar = Math.round((beat - startBeat) * 4) % 16;
      const step = pattern[stepInBar];
      if (step.kick) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.5, velocity: 0.85 + PRNGManager.next() * 0.1 });
      }
      if (step.snare) {
        notes.push({ pitch: SNARE, onset: beat, duration: 0.25, velocity: 0.8 + PRNGManager.next() * 0.1 });
      }
      if (step.hihat) {
        const isStrong = stepInBar % 4 === 0;
        notes.push({ pitch: CHH, onset: beat, duration: 0.15, velocity: 0.5 + (isStrong ? 0.15 : 0) + PRNGManager.next() * 0.05 });
      }
      if (step.openHat) {
        notes.push({ pitch: OHH, onset: beat, duration: 0.25, velocity: 0.55 + PRNGManager.next() * 0.05 });
      }
      if (step.ghost) {
        // 鬼音：极轻的 hi-hat（不与 step.hihat 冲突，独立判定）
        notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: 0.3 + PRNGManager.next() * 0.05 });
      }
      // High energy: 在 16 分弱拍随机加 ghost hi-hat
      if (energyLevel >= ENERGY.HIGH_MIN && !step.hihat && PRNGManager.next() < 0.3) {
        notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: 0.35 });
      }
      beat += 0.25;  // 16th note step
    }

    // 🌟 F-Drum-Tom + F-Drum-Variation: tom fill 注入
    // 触发频率：8 小节末 100%；4 小节末（非 8 倍数）60% 概率（hash 决策，避免 PRNG）
    // 替换该拍的 snare/hihat，插入 4 个 16 分 tom 音（high → mid → low → 重 snare/crash）
    if (!isIntro && !isOutro) {
      const totalBars = Math.round((endBeat - startBeat) / beatsPerBar);
      const collectedBarsForFill: number[] = [];
      // 收集所有 fill 触发位置：8 小节末必有，4 小节末按 hash 60%
      for (let barIdx = 3; barIdx < totalBars; barIdx += 4) {
        if ((barIdx + 1) % 8 === 0) {
          // 8 小节末（barIdx=7, 15, 23...）100%
          collectedBarsForFill.push(barIdx);
        } else {
          // 4 小节末非 8 倍数：用 hash(startBeat + barIdx) % 5 < 3 → 60% 概率
          const hash = (Math.floor(startBeat * 7) + barIdx * 13) % 5;
          if (hash < 3) collectedBarsForFill.push(barIdx);
        }
      }
      for (const barIdx of collectedBarsForFill) {
        const fillBarStart = startBeat + barIdx * beatsPerBar;
        const fillBeat = fillBarStart + beatsPerBar - 1; // 末小节最后一拍
        // 删除 fill 区间的 snare/hihat（保留 kick）
        for (let ni = notes.length - 1; ni >= 0; ni--) {
          if (notes[ni].onset >= fillBeat - 1e-6 && notes[ni].onset < fillBeat + 1.0 - 1e-6) {
            if (notes[ni].pitch === SNARE || notes[ni].pitch === CHH || notes[ni].pitch === OHH) {
              notes.splice(ni, 1);
            }
          }
        }
        // 插入 tom fill（4 个 16 分音：high → mid → mid → low + crash 在下小节首拍）
        const fillVel = 0.7 + PRNGManager.next() * 0.15;
        if (subgenre === 'Funk') {
          // Funk: busy 16th fill (snare-tom-tom-tom)
          notes.push({ pitch: SNARE, onset: fillBeat, duration: 0.2, velocity: fillVel });
          notes.push({ pitch: TOM_HIGH, onset: fillBeat + 0.25, duration: 0.2, velocity: fillVel });
          notes.push({ pitch: TOM_MID, onset: fillBeat + 0.5, duration: 0.2, velocity: fillVel + 0.05 });
          notes.push({ pitch: TOM_LOW, onset: fillBeat + 0.75, duration: 0.2, velocity: fillVel + 0.1 });
        } else if (subgenre === 'Latin') {
          // Latin: 双 tom 切分 (tom_high - tom_mid - kick - tom_low)
          notes.push({ pitch: TOM_HIGH, onset: fillBeat, duration: 0.2, velocity: fillVel });
          notes.push({ pitch: TOM_MID, onset: fillBeat + 0.25, duration: 0.2, velocity: fillVel });
          notes.push({ pitch: KICK, onset: fillBeat + 0.5, duration: 0.3, velocity: fillVel + 0.1 });
          notes.push({ pitch: TOM_LOW, onset: fillBeat + 0.75, duration: 0.2, velocity: fillVel });
        } else {
          // Pop / Lo-fi: gentle 下行 fill (tom_high - tom_mid - tom_low - snare)
          notes.push({ pitch: TOM_HIGH, onset: fillBeat, duration: 0.2, velocity: fillVel });
          notes.push({ pitch: TOM_HIGH, onset: fillBeat + 0.25, duration: 0.2, velocity: fillVel });
          notes.push({ pitch: TOM_MID, onset: fillBeat + 0.5, duration: 0.2, velocity: fillVel + 0.05 });
          notes.push({ pitch: TOM_LOW, onset: fillBeat + 0.75, duration: 0.2, velocity: fillVel + 0.1 });
        }
        // 下小节首拍加 crash 强调（如果在 endBeat 内）
        const nextBarStart = fillBarStart + beatsPerBar;
        if (nextBarStart < endBeat - 1e-6) {
          notes.push({ pitch: CRASH, onset: nextBarStart, duration: 1.5, velocity: 0.8 });
        }
      }

      // 🌟 段落末额外加 ride cymbal（替换最后 4 拍部分 hi-hat）—— Funk/Latin 才用
      if (subgenre === 'Funk' || subgenre === 'Latin') {
        const rideStart = endBeat - 4;
        if (rideStart > startBeat + 1e-6) {
          for (let ni = 0; ni < notes.length; ni++) {
            if (notes[ni].onset >= rideStart - 1e-6 && notes[ni].pitch === CHH && PRNGManager.next() < 0.3) {
              notes[ni].pitch = RIDE; // 30% hi-hat → ride
            }
          }
        }
      }
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
    if (notes.length > 0 && energyLevel >= ENERGY.MEDIUM_MIN) {
      notes.push({ pitch: CRASH, onset: startBeat, duration: 1.5, velocity: 0.85 });
    }

    return notes;
  }

  /**
   * 找出在 [startBeat, endBeat) 区间内有声音的主旋律音符。
   * 包括起始时间在区间外但仍在持续（sustain 跨过区间）的音符 —
   * 因为这些音符的发声仍会与副旋律产生纵向冲突。
   * max ~melodyNotes.length 元素
   *
   * @param anchorOnly 若 true，仅返回 isAnchor === true 的骨架音（P0 副旋律避让口径）。
   *                   教程：副旋律只给主旋律的关键音让路，不给装饰/过渡音让路。
   *                   未经 AnchorDecisionStage 标注的旧数据（isAnchor === undefined）被过滤。
   */
  private static getOverlappingMelodyNotes(
    melodyNotes: NoteData[],
    startBeat: number,
    endBeat: number,
    anchorOnly: boolean = false
  ): NoteData[] {
    const result: NoteData[] = [];
    for (let i = 0; i < melodyNotes.length; i++) {
      const m = melodyNotes[i];
      if (anchorOnly && m.isAnchor !== true) continue;
      const mEnd = m.onset + m.duration;
      // 区间重叠测试（半开区间，使用 epsilon 容差）
      if (m.onset < endBeat - 1e-6 && mEnd > startBeat + 1e-6) {
        result.push(m);
      }
    }
    return result;
  }

  /**
   * 在候选音高列表中按优先级选出第一个与所有重叠主旋律音符不冲突的音高。
   * 冲突定义（mod 12）：
   *   0 = 同度（两声部同音听感单薄）
   *   1 = 小二度 / 小九度
   *   6 = 三全音
   *  11 = 大七度
   * 八度（mod 12 后为 0）也会被判为同度并跳过。
   * 返回 -1 表示无可用候选 — 调用方应跳过该副旋律事件。
   *
   * 🌟 P0 延伸音避让（chord 参数非 undefined 时启用）：
   * 若某个重叠主旋律音符是 anchor 且落在和弦的 b7/maj7/9/11/13 延伸音位置，
   * 副旋律候选必须**额外排除**该延伸音 pc —— 教程："关键音是和弦 7 度及以上延伸音，
   * 伴奏中尽量不演奏该音，避免抢主旋律风头"。
   */
  private static pickConsonantPitch(
    candidates: number[],
    overlappingMelody: NoteData[],
    chord?: GeneratedChord
  ): number {
    // 计算需要额外 veto 的延伸音 pc（仅当主旋律 anchor 是和弦延伸音时）
    const extensionVetoPcs: number[] = [];
    if (chord !== undefined) {
      const chordRootPc = ((chord.root % 12) + 12) % 12;
      // 延伸音相对根音的半音偏移：b7=10, maj7=11, 9=2, 11=5, 13=9
      const extensionOffsets = [10, 11, 2, 5, 9];
      for (let mi = 0; mi < overlappingMelody.length; mi++) {
        const m = overlappingMelody[mi];
        if (m.isAnchor !== true) continue;
        const mPc = ((m.pitch % 12) + 12) % 12;
        const relToRoot = ((mPc - chordRootPc) + 12) % 12;
        for (let ei = 0; ei < extensionOffsets.length; ei++) {
          if (relToRoot === extensionOffsets[ei]) {
            // anchor 落在延伸音上 → 伴奏必须避开这个 pc
            let alreadyListed = false;
            for (let vi = 0; vi < extensionVetoPcs.length; vi++) {
              if (extensionVetoPcs[vi] === mPc) { alreadyListed = true; break; }
            }
            if (!alreadyListed) extensionVetoPcs.push(mPc);
            break;
          }
        }
      }
    }

    for (let ci = 0; ci < candidates.length; ci++) {
      const p = candidates[ci];
      let ok = true;

      // 延伸音 veto
      const pPc = ((p % 12) + 12) % 12;
      for (let vi = 0; vi < extensionVetoPcs.length; vi++) {
        if (extensionVetoPcs[vi] === pPc) { ok = false; break; }
      }
      if (!ok) continue;

      for (let mi = 0; mi < overlappingMelody.length; mi++) {
        const interval = Math.abs(p - overlappingMelody[mi].pitch) % 12;
        if (interval === 0 || interval === 1 || interval === 6 || interval === 11) {
          ok = false;
          break;
        }
      }
      if (ok) return p;
    }
    return -1;
  }

  /**
   * 副旋律生成：三度平行 / Pad 模式，全程做纵向冲突检测
   * 关键约束：
   *   - 副旋律 duration 强制截断在 chord.endBeat 之内
   *   - 候选音高与所有重叠主旋律音符进行不协和音程检测（小二度/三全音/大七度/同度）
   *   - 冲突时按候选优先级回退到下一个安全音
   * max ~50 notes per chord
   */
  public static generateCounterMelody(
    chord: GeneratedChord,
    energyLevel: number,
    melodyNotes: NoteData[],
    tonality: Tonality,
  ): NoteData[] {
    const notes: NoteData[] = [];
    const safeScalePcs = HarmonyCore.getSafeScalePitches(chord, tonality);
    const chordTones = HarmonyCore.getChordTones(chord, 72); // C5 附近

    // 节奏决策仍按"和弦区间起始的主旋律音符"判断密度（保持原行为）
    const chordMelody = melodyNotes.filter(
      n => n.onset >= chord.startBeat - 1e-6 && n.onset < chord.endBeat - 1e-6
    );

    if (chordMelody.length === 0) return notes;

    // 🌟 节奏互锁：检测主旋律密度
    // 连续短音（<=0.5拍）超过 3 个 = 密集段，副旋律只放长音 Pad
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
      // Pad 模式：长音持续整个和弦区间（最多 4 拍）
      // 必须检查整段持续期间所有重叠主旋律音符，不能只看起始点
      const holdStart = chord.startBeat;
      const holdEnd = Math.min(chord.endBeat, holdStart + 4);
      // 🌟 P0 anchorOnly：Pad 只避让主旋律的关键音，让过渡音自由穿行
      const overlapping = this.getOverlappingMelodyNotes(melodyNotes, holdStart, holdEnd, true);

      // 候选优先级：三音 → 五音 → 根音 → 七音（snap 到调内）
      const padCandidates: number[] = [];
      if (chordTones.length > 1) padCandidates.push(HarmonyCore.snapToScale(chordTones[1], safeScalePcs));
      if (chordTones.length > 2) padCandidates.push(HarmonyCore.snapToScale(chordTones[2], safeScalePcs));
      if (chordTones.length > 0) padCandidates.push(HarmonyCore.snapToScale(chordTones[0], safeScalePcs));
      if (chordTones.length > 3) padCandidates.push(HarmonyCore.snapToScale(chordTones[3], safeScalePcs));

      const padPitch = this.pickConsonantPitch(padCandidates, overlapping, chord);
      if (padPitch >= 0) {
        notes.push({
          pitch: padPitch,
          onset: holdStart,
          duration: holdEnd - holdStart,
          velocity: 0.45,
        });
      }
      // padPitch < 0 时静默跳过 — Pad 找不到非冲突音高时宁可空白也不要碰撞
    } else {
      // 稀疏段：三度上方平行
      for (let i = 0; i < chordMelody.length; i++) {
        const m = chordMelody[i];

        // 防御性截断：副旋律 duration 不能跨过 chord.endBeat
        // （truncateToChordEnd 也会处理，这里提前算便于做重叠检查）
        const counterDuration = Math.min(m.duration, chord.endBeat - m.onset);
        if (counterDuration <= 1e-6) continue;

        // 副旋律发声区间 [m.onset, m.onset + counterDuration)
        // 与该区间内所有重叠主旋律音符做冲突检测（不仅仅是同 onset 的 m 自身）
        // 🌟 P0 anchorOnly：平行和声只避让主旋律的关键音
        const overlapping = this.getOverlappingMelodyNotes(
          melodyNotes,
          m.onset,
          m.onset + counterDuration,
          true
        );

        // 候选优先级：三度 → 六度 → 四度 → 和弦音兜底
        const candidates: number[] = [];
        candidates.push(HarmonyCore.snapToScale(m.pitch + 3, safeScalePcs));
        candidates.push(HarmonyCore.snapToScale(m.pitch + 8, safeScalePcs));
        candidates.push(HarmonyCore.snapToScale(m.pitch + 5, safeScalePcs));
        for (let ti = 0; ti < chordTones.length; ti++) {
          candidates.push(chordTones[ti]);
        }

        const counterPitch = this.pickConsonantPitch(candidates, overlapping, chord);
        if (counterPitch < 0) continue;

        // 🌟 微错位 (Micro-shift)：副旋律在 ±0.05 拍内随机偏移，
        // 打破与主旋律的完全节奏同步，制造演奏不一致的人性化听感。
        // 0.05 拍 ≈ 50ms @ 120 BPM，足够小不会抢拍但能产生微差别。
        const microShift = (PRNGManager.next() - 0.5) * 0.1;
        let shiftedOnset = m.onset + microShift;
        // 边界保护：不能突破当前和弦区间，给副旋律 duration 留出空间
        const minOnset = chord.startBeat;
        const maxOnset = chord.endBeat - counterDuration;
        if (shiftedOnset < minOnset) shiftedOnset = minOnset;
        if (shiftedOnset > maxOnset) shiftedOnset = maxOnset;

        notes.push({
          pitch: counterPitch,
          onset: shiftedOnset,
          duration: counterDuration,
          velocity: Math.min(m.velocity * 0.55, 0.65),
        });
      }
    }

    const truncated = this.truncateToChordEnd(notes, chord.endBeat);
    this.clampToRange(truncated, 72, 84); // Counter Melody: C5 ~ C6
    return truncated;
  }

  /**
   * 真正的副旋律：Call-and-Response 填补线
   *
   * 在主旋律的休止窗口（gap ≥ 1 拍）中生成填补音符，构成"呼应"对位关系。
   * 与主旋律不会发生纵向冲突 —— 因为主旋律此时静音。这是与 generateCounterMelody
   * （平行和声 / Pad，与主旋律同时发声）截然不同的对位策略。
   *
   * 算法（确定性，不消耗 PRNG）：
   *   1. 扫描主旋律相邻音符的休止间隙
   *   2. 当 gap ≥ MIN_GAP 时，在 gap 中点所在的和弦上生成 1~3 个和弦音填补
   *   3. 填补方向（上行/下行）和起始音由 gap.startBeat 哈希决定，保证不同 gap 有
   *      不同走向，但同种子下输出完全可复现
   *
   * 注意：本方法跨和弦扫描整曲主旋律，不能放在 chord 循环内调用，应一次性生成。
   * max ~80 fill notes per song
   */
  public static generateSecondaryFillLine(
    melodyNotes: NoteData[],
    chords: GeneratedChord[],
    tonality: Tonality
  ): NoteData[] {
    if (melodyNotes.length === 0 || chords.length === 0) return [];

    // 排序确保 onset 升序，相同 onset 时按 pitch 排序消除 tie（D-3）
    const sorted = melodyNotes.slice().sort((a, b) => {
      const d = a.onset - b.onset;
      if (Math.abs(d) > 1e-6) return d;
      return a.pitch - b.pitch;
    });

    const fills: NoteData[] = [];
    const MIN_GAP = 1.0;       // 至少 1 拍休止才填补
    const FILL_BREATH = 0.25;  // 填补前后各预留 0.25 拍呼吸，避免抢拍
    const MAX_FILL_LEN = 2.0;  // 单次填补最长 2 拍

    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i];
      const next = sorted[i + 1];
      const gapStart = cur.onset + cur.duration;
      const gapEnd = next.onset;
      const gapLen = gapEnd - gapStart;

      if (gapLen < MIN_GAP - 1e-6) continue;

      // 找到 gap 中点所在的 chord
      const fillCenter = (gapStart + gapEnd) / 2;
      let activeChord: GeneratedChord | null = null;
      for (let ci = 0; ci < chords.length; ci++) {
        if (
          fillCenter >= chords[ci].startBeat - 1e-6 &&
          fillCenter < chords[ci].endBeat - 1e-6
        ) {
          activeChord = chords[ci];
          break;
        }
      }
      if (!activeChord) continue;

      // 填补区间：预留呼吸 + 限制在 chord 内 + 限制最大长度
      const fillStart = Math.max(gapStart + FILL_BREATH, activeChord.startBeat);
      const fillEnd = Math.min(
        gapEnd - FILL_BREATH,
        activeChord.endBeat,
        fillStart + MAX_FILL_LEN
      );
      const fillLen = fillEnd - fillStart;
      if (fillLen < 0.5 - 1e-6) continue;

      // 候选音池：以和弦音为主干，snap 到调内
      const chordTones = HarmonyCore.getChordTones(activeChord, 67); // G4 附近，副旋律音区
      if (chordTones.length === 0) continue;
      const safeScalePcs = HarmonyCore.getSafeScalePitches(activeChord, tonality);

      // 决定填补音数：长 gap 用 3 音琶音，短 gap 用 2 音呼应
      const noteCount = fillLen >= 1.5 ? 3 : (fillLen >= 1.0 ? 2 : 1);
      const stepDur = fillLen / noteCount;

      // 确定性变化：由 gapStart 的整数化哈希决定方向和起始音
      // 同一首歌每次生成完全相同；不同 gap 自然产生不同走向
      const variation = (Math.floor(gapStart * 4) | 0) >>> 0;
      const direction = (variation % 2 === 0) ? 1 : -1;
      const startToneIdx = variation % chordTones.length;

      for (let n = 0; n < noteCount; n++) {
        const onset = fillStart + n * stepDur;
        // 索引可能为负，加 chordTones.length * 2 后取模保证非负
        const toneIdx = ((startToneIdx + direction * n) % chordTones.length + chordTones.length) % chordTones.length;
        let pitch = chordTones[toneIdx];
        pitch = HarmonyCore.snapToScale(pitch, safeScalePcs);

        fills.push({
          pitch,
          onset,
          duration: stepDur * 0.85, // 留一点 staccato 呼吸
          velocity: 0.42, // F2: 背景化 — 从 0.6 降到 0.42，避免"独奏 spotlight"感
        });
      }
    }

    // F1: 压到 C4-E5 中音区 — fill line 100% 孤立出现（主旋律休止窗口里），
    // 高音区（G5-B5）用 Vibraphone/Glockenspiel 等金属音色会金属尖叫。
    // 中音区让同样的音色变温暖，fill 作为"装饰"而非"独奏"。
    this.clampToRange(fills, 60, 76); // C4 ~ E5

    return fills;
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
    // 🌟 energy 缩放 baseVelocity：各声部力度随 energy 呼吸
    const baseVelocity = 0.35 + Math.min(energyLevel, 10) * 0.045;

    let voicing: number[];
    if (prevVoicing && prevVoicing.length > 0) {
      voicing = HarmonyCore.getSmoothVoicing(chord, prevVoicing, 60);
    } else {
      // 🌟 段落首个和弦：生成紧凑排列（close voicing），确保后续 voice leading 有合理起点
      // 将所有音压缩到 C4(60) 附近的 1 个八度内，避免散乱的 block transpose
      const raw = HarmonyCore.getChordTones(chord, 60);
      voicing = raw.map(p => {
        let v = p;
        while (v < 55) v += 12;  // 不低于 G3
        while (v > 72) v -= 12;  // 不高于 C5
        return v;
      });
    }

    voicing = voicing.map(p => p < 48 ? p + 12 : p);

    // 🌟 Pad 和弦降维：复杂和弦（4+ 音）只保留根音+三音+七音
    if ((textureType === 'Pad' || isSparseSection) && voicing.length >= 4) {
      const simplified: number[] = [voicing[0], voicing[1]];
      if (voicing.length > 3) simplified.push(voicing[3]);
      voicing = simplified;
    }

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
    } else if (textureType === 'Arpeggio' || energyLevel >= ENERGY.HIGH_MIN) {
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

      if (energyLevel >= ENERGY.MEDIUM_MIN && chordLen >= 2) {
        // Add re-attack on beat 3 (or halfway)
        attackPoints.push(chord.startBeat + chordLen / 2);
      }
      if (energyLevel >= ENERGY.BUILD_MIN && chordLen >= 4) {
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
    tonality: Tonality,
  ): NoteData[] {
    const chordTones = HarmonyCore.getChordTones(chord, 60);
    const safeScalePcs = HarmonyCore.getSafeScalePitches(chord, tonality);
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
