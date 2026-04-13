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
      // 正常段落：每拍弹根音（跟随鼓组 groove）
      const step = energyLevel >= ENERGY.HIGH_MIN ? 1 : 2;
      let beat = chord.startBeat;
      while (beat < chord.endBeat - 1e-6) {
        const isLastStep = (beat + step >= chord.endBeat - 1e-6);
        const vel = Math.abs(beat % 2) < 1e-6 ? 0.75 : 0.6;

        // 🌟 Approach note：和弦最后一拍，如果有 nextChord 且根音跳跃 > 2 半音，
        // 注入半音趋近音（chromatic approach）指向下一和弦根音
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
            // 缩短当前音，腾出空间给 approach note
            const mainDur = Math.min(step, chord.endBeat - beat) * 0.5;
            const approachDur = Math.min(step, chord.endBeat - beat) - mainDur;
            notes.push({ pitch: rootMidi, onset: beat, duration: mainDur, velocity: vel });
            notes.push({ pitch: approachClamp, onset: beat + mainDur, duration: approachDur, velocity: vel * 0.7 });
          } else {
            notes.push({ pitch: rootMidi, onset: beat, duration: Math.min(step, chord.endBeat - beat), velocity: vel });
          }
        } else {
          notes.push({ pitch: rootMidi, onset: beat, duration: Math.min(step, chord.endBeat - beat), velocity: vel });
        }
        beat += step;
      }
    }

    // 更新 prevBassRootMidi 供下一个和弦使用
    this.prevBassRootMidi = rootMidi;

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
  // 🌟 鼓组模式预设（C 可移植：纯数组，无 Map）
  // kick/snare: 一个 bar 内的 beat 位置（四分音符单位）；hihatSubdiv: 细分步长
  private static readonly DRUM_PATTERNS: { kick: number[], snare: number[], hihatSubdiv: number }[] = [
    { kick: [0, 2],       snare: [1, 3],    hihatSubdiv: 0.5  }, // 0: Standard Rock（默认）
    { kick: [0, 1, 2, 3], snare: [1, 3],    hihatSubdiv: 0.5  }, // 1: Four-on-the-floor（EDM/House）
    { kick: [0, 2.5],     snare: [1],       hihatSubdiv: 0.5  }, // 2: Sparse Lo-fi
    { kick: [0],          snare: [2],       hihatSubdiv: 0.25 }, // 3: Trap（16th hi-hat）
  ];

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
    drumPatternIndex: number = 0,
  ): NoteData[] {
    const KICK = 36;
    const SNARE = 38;
    const CHH = 42; // Closed hi-hat
    const OHH = 46; // Open hi-hat
    const CRASH = 49;

    const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;
    const notes: NoteData[] = [];
    const pattern = this.DRUM_PATTERNS[drumPatternIndex] || this.DRUM_PATTERNS[0];

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
    let barBeat = 0;

    while (beat < endBeat - 1e-6) {
      barBeat = Math.round((beat - startBeat) * 4) % (beatsPerBar * 4); // 16th note units
      const beatInBar = barBeat / 4; // quarter note units

      // Kick: pattern-driven positions
      let isKickHit = false;
      for (let ki = 0; ki < pattern.kick.length; ki++) {
        if (Math.abs(beatInBar - pattern.kick[ki]) < 1e-6) { isKickHit = true; break; }
      }
      if (isKickHit) {
        notes.push({
          pitch: KICK, onset: beat, duration: 0.5,
          velocity: 0.85 + PRNGManager.next() * 0.1,
        });
      }

      // Snare: pattern-driven positions
      let isSnareHit = false;
      for (let si = 0; si < pattern.snare.length; si++) {
        if (Math.abs(beatInBar - pattern.snare[si]) < 1e-6) { isSnareHit = true; break; }
      }
      if (isSnareHit) {
        notes.push({
          pitch: SNARE, onset: beat, duration: 0.25,
          velocity: 0.8 + PRNGManager.next() * 0.1,
        });
      }

      // 🌟 PRNG 对齐：Standard 模式（index 0）下，kick/snare PRNG 消耗次数必须与旧代码一致
      // 旧代码：kick 在 beatInBar=0|2 消耗 1 次，snare 在 beatInBar=1|3 消耗 1 次
      // 新代码：pattern[0].kick=[0,2] + pattern[0].snare=[1,3] → 完全一致
      // 非 Standard 模式的 PRNG 消耗次数会不同，这是预期行为（新风格新基线）

      // Hi-hat: pattern-driven subdivision — 应用 swing 到 offbeat 位置
      if (Math.abs(beatInBar % pattern.hihatSubdiv) < 1e-6) {
        const isOffbeat8th = Math.abs(beatInBar % 1 - 0.5) < 1e-6;
        let hhOnset = beat;
        if (isOffbeat8th && Math.abs(swingRatio - 0.5) > 1e-6) {
          hhOnset = beat - 0.5 + swingRatio;
        }
        notes.push({
          pitch: CHH, onset: hhOnset, duration: 0.15,
          velocity: 0.5 + (Math.abs(beatInBar % 1) < 1e-6 ? 0.15 : 0) + PRNGManager.next() * 0.05,
        });
      }

      // High energy: add ghost notes on 16th notes
      if (energyLevel >= ENERGY.HIGH_MIN && PRNGManager.next() < 0.3) {
        const ghostBeat = beat + 0.25;
        if (ghostBeat < endBeat - 1e-6) {
          notes.push({ pitch: CHH, onset: ghostBeat, duration: 0.1, velocity: 0.35 });
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
   */
  private static getOverlappingMelodyNotes(
    melodyNotes: NoteData[],
    startBeat: number,
    endBeat: number
  ): NoteData[] {
    const result: NoteData[] = [];
    for (let i = 0; i < melodyNotes.length; i++) {
      const m = melodyNotes[i];
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
   */
  private static pickConsonantPitch(
    candidates: number[],
    overlappingMelody: NoteData[]
  ): number {
    for (let ci = 0; ci < candidates.length; ci++) {
      const p = candidates[ci];
      let ok = true;
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
      const overlapping = this.getOverlappingMelodyNotes(melodyNotes, holdStart, holdEnd);

      // 候选优先级：三音 → 五音 → 根音 → 七音（snap 到调内）
      const padCandidates: number[] = [];
      if (chordTones.length > 1) padCandidates.push(HarmonyCore.snapToScale(chordTones[1], safeScalePcs));
      if (chordTones.length > 2) padCandidates.push(HarmonyCore.snapToScale(chordTones[2], safeScalePcs));
      if (chordTones.length > 0) padCandidates.push(HarmonyCore.snapToScale(chordTones[0], safeScalePcs));
      if (chordTones.length > 3) padCandidates.push(HarmonyCore.snapToScale(chordTones[3], safeScalePcs));

      const padPitch = this.pickConsonantPitch(padCandidates, overlapping);
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
        const overlapping = this.getOverlappingMelodyNotes(
          melodyNotes,
          m.onset,
          m.onset + counterDuration
        );

        // 候选优先级：三度 → 六度 → 四度 → 和弦音兜底
        const candidates: number[] = [];
        candidates.push(HarmonyCore.snapToScale(m.pitch + 3, safeScalePcs));
        candidates.push(HarmonyCore.snapToScale(m.pitch + 8, safeScalePcs));
        candidates.push(HarmonyCore.snapToScale(m.pitch + 5, safeScalePcs));
        for (let ti = 0; ti < chordTones.length; ti++) {
          candidates.push(chordTones[ti]);
        }

        const counterPitch = this.pickConsonantPitch(candidates, overlapping);
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
          velocity: 0.6,
        });
      }
    }

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
