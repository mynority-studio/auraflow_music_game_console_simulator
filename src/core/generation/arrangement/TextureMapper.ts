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

    const bassTones = HarmonyCore.getChordTones(chord, targetCenterForChordTones, false);
    const rootMidi = bassTones[0];
    const thirdMidi = bassTones.length > 1 ? bassTones[1] : rootMidi + 4;
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

    const notes: NoteData[] = [];
    const chordStart = chord.startBeat;
    const chordEnd = chord.endBeat;
    const chordLen = chordEnd - chordStart;
    const bassMode = params?.orchestration?.bassMode || 'root-based';
    const bassSyncopation = params?.rhythm?.syncopationWeight ?? 0.4;
    const bassRestProb = params?.rhythm?.restProbability ?? 0.15;
    const bassSwing = params?.rhythm?.swingRatio ?? 0;

    // ========== Groove-lock 模式（模拟底鼓吸附、留白、半音趋近） ==========
    if (bassMode === 'groove-lock') {
      // 模拟底鼓位置：正拍 + 概率切分
      const kickOnsets: number[] = [];
      kickOnsets.push(chordStart); // 正拍必有
      if (PRNGManager.next() < bassSyncopation && chordLen >= 2) {
        kickOnsets.push(chordStart + 1.5); // 弱拍切分
      }
      if (PRNGManager.next() < bassSyncopation * 0.6 && chordLen >= 3) {
        kickOnsets.push(chordStart + 2.5);
      }

      kickOnsets.forEach((kickOnset, idx) => {
        // 留白：偶尔跳过（呼吸感）
        if (idx > 0 && PRNGManager.next() < bassRestProb * 0.5) return;

        let pitch = targetBassPitch;
        // 第二下底鼓：40% 概率弹非根音（五度/三音/八度）
        if (idx > 0 && PRNGManager.next() < 0.4) {
          const altRoll = PRNGManager.next();
          if (altRoll < 0.45) {
            pitch = fifthMidi;
          } else if (altRoll < 0.75) {
            pitch = thirdMidi;
          } else {
            pitch = octaveMidi;
          }
        }

        // 时值动态：长音 vs 顿音
        const nextOnset = kickOnsets[idx + 1] || chordEnd;
        let dur = nextOnset - kickOnset;
        if (PRNGManager.next() > 0.6) {
          dur *= 0.25; // 变极短顿音
        } else {
          dur *= 0.9; // 留小缝隙
        }

        const vel = Math.min(1.0, 0.5 + PRNGManager.next() * 0.2);
        notes.push({ pitch, onset: kickOnset, duration: Math.max(0.1, dur), velocity: vel });
      });

      // 半音趋近：和弦末尾插入经过音
      if (nextChord && PRNGManager.next() < (params?.melody?.chromaticPassingProbability ?? 0.15)) {
        const nextBassTones2 = HarmonyCore.getChordTones(nextChord, nextTargetCenter);
        const nextRoot = nextBassTones2[0];
        const approachDir = PRNGManager.next() > 0.5 ? 1 : -1;
        notes.push({
          pitch: nextRoot + approachDir,
          onset: chordEnd - 0.25,
          duration: 0.25,
          velocity: 0.4,
        });
      }

      return this.deduplicateNotes(this.truncateToChordEnd(notes, chordEnd));
    }

    // ========== Standard root-based 模式（原有逻辑） ==========
    let stepSize: number;
    if (energyLevel <= 3 || isSparseSection) {
      stepSize = Math.min(chordLen, 2.0);
    } else if (energyLevel <= 6) {
      stepSize = 1.0;
    } else {
      stepSize = 0.5;
    }

    // max ~200 notes for a chord span (C-4 compliance)
    let beat = chordStart;
    let noteIndex = 0;
    while (beat < chordEnd - 1e-6) {
      const remaining = chordEnd - beat;
      const dur = Math.min(stepSize, remaining);

      let pitch = targetBassPitch;
      if (noteIndex > 0) {
        const bassAltRoll = PRNGManager.next();
        if (bassAltRoll < 0.15) {
          pitch = fifthMidi;
        } else if (bassAltRoll < 0.25) {
          pitch = thirdMidi;
        }
      }
      if (energyLevel >= 7 && PRNGManager.next() < 0.15) {
        pitch = octaveMidi;
      }

      const baseVel = 0.5 + energyLevel * 0.04;
      const timeSignature = renderCtx?.timeSignature ?? [4, 4] as [number, number] /* safe: literal tuple default */;
      const beatsPerBar = timeSignature[0] || 4;
      const beatInBar = beat % beatsPerBar;
      const accent = Math.abs(beatInBar) < 1e-6 ? 0.1 : 0;
      const velocity = Math.min(1.0, baseVel + accent + (PRNGManager.next() * 0.05 - 0.025));

      notes.push({ pitch, onset: beat, duration: dur, velocity });

      beat += stepSize;
      noteIndex++;
    }

    if (isSectionEnd && nextChord && notes.length > 0) {
      const nextBassTones2 = HarmonyCore.getChordTones(nextChord, nextTargetCenter);
      const nextRoot = nextBassTones2[0];
      const approachPitch = nextRoot - 1;
      if (notes[notes.length - 1].onset + notes[notes.length - 1].duration < chordEnd - 1e-6) {
        notes.push({ pitch: approachPitch, onset: chordEnd - 0.5, duration: 0.5, velocity: 0.7 });
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
    const drumMode = params?.orchestration?.drumMode || 'standard';
    const humanize = params?.rhythm?.humanize ?? 0.1;
    const syncopation = params?.rhythm?.syncopationWeight ?? 0.4;
    const restProb = params?.rhythm?.restProbability ?? 0.15;
    const RIMSHOT = 37;

    // ========== Laid-back 模式（后拖军鼓、LFO 踩镲、马尔可夫底鼓） ==========
    if (drumMode === 'laid-back') {
      const totalBars = Math.floor((endBeat - startBeat) / beatsPerBar);
      for (let bar = 0; bar < totalBars; bar++) {
        const barStart = startBeat + bar * beatsPerBar;
        const baseVel = 0.45 + energyLevel * 0.04;

        // --- 马尔可夫底鼓：正拍必有，弱拍看 syncopation ---
        notes.push({ pitch: KICK, onset: barStart, duration: 0.25, velocity: Math.min(1.0, baseVel + 0.1 + PRNGManager.next() * 0.05) });
        if (PRNGManager.next() < syncopation) {
          notes.push({ pitch: KICK, onset: barStart + 1.5, duration: 0.25, velocity: baseVel * 0.85 });
        }
        if (PRNGManager.next() < syncopation * 0.7) {
          notes.push({ pitch: KICK, onset: barStart + 2.5, duration: 0.25, velocity: baseVel * 0.8 });
        }
        // 乐句末变异（每 4 小节末尾）
        if (bar % 4 === 3 && PRNGManager.next() < 0.3) {
          notes.push({ pitch: KICK, onset: barStart + 3.25, duration: 0.25, velocity: baseVel * 0.7 });
          notes.push({ pitch: KICK, onset: barStart + 3.75, duration: 0.25, velocity: baseVel * 0.9 });
        }

        // --- 军鼓/Rimshot：2/4 拍 + laid-back 后拖 ---
        for (const snareBeat of [1, 3]) {
          const laidBackOffset = PRNGManager.next() * 0.05 * humanize;
          const usRimshot = PRNGManager.next() > 0.3; // 70% Rimshot, 30% Snare
          const vel = Math.min(1.0, baseVel + 0.05 + PRNGManager.next() * 0.04);
          notes.push({
            pitch: usRimshot ? RIMSHOT : SNARE,
            onset: barStart + snareBeat + laidBackOffset,
            duration: 0.25,
            velocity: vel
          });
        }

        // --- 踩镲：LFO 呼吸力度 + 随机漏拍 + 幽灵音 ---
        for (let sub = 0; sub < beatsPerBar; sub += 0.5) {
          // Swing 偏移
          let swingOffset = 0;
          if (Math.abs(sub % 1 - 0.5) < 1e-6) {
            swingOffset = (swingRatio - 0.5) * 0.5;
          }
          const onset = barStart + sub + swingOffset;
          // LFO 呼吸力度：重-轻-中-轻
          const lfoPhase = Math.sin(onset * Math.PI);
          const hhBaseVel = Math.abs(sub % 1) < 1e-6 ? 0.55 : 0.3;
          const hhVel = Math.min(1.0, Math.max(0.15, hhBaseVel + lfoPhase * 0.1 * humanize));

          // 随机漏拍
          if (PRNGManager.next() > restProb) {
            notes.push({ pitch: CHH, onset: onset, duration: 0.1, velocity: hhVel });
          }

          // 幽灵音 16 分音符（15% 概率）
          if (PRNGManager.next() < 0.15) {
            notes.push({
              pitch: CHH,
              onset: onset + 0.25 + swingOffset * 0.5,
              duration: 0.05,
              velocity: 0.15 + PRNGManager.next() * 0.1
            });
          }
        }

        // --- Crash on first bar ---
        if (bar === 0 && hasFullGrooveStarted) {
          notes.push({ pitch: CRASH, onset: barStart, duration: 1.0, velocity: Math.min(1.0, baseVel + 0.15) });
        }
      }
      return notes;
    }

    // ========== 6/8 复合拍（Compound Meter）==========
    if (beatsPerBar === 6) {
      // 6/8 拍：强-弱-弱-次强-弱-弱，三连音分组
      const totalBars = Math.floor((endBeat - startBeat) / beatsPerBar);
      for (let bar = 0; bar < totalBars; bar++) {
        const barStart = startBeat + bar * beatsPerBar;
        const baseVel = 0.45 + energyLevel * 0.04;

        // Kick: 拍 1（强拍）
        notes.push({ pitch: KICK, onset: barStart, duration: 0.25, velocity: Math.min(1.0, baseVel + 0.15) });
        // Kick: 拍 4（次强拍），80% 概率
        if (PRNGManager.next() < 0.8) {
          notes.push({ pitch: KICK, onset: barStart + 3, duration: 0.25, velocity: baseVel + 0.08 });
        }

        // Snare/Cross-stick: 拍 4（次强拍），或 6/8 可选拍 3 & 6
        if (energyLevel >= 5) {
          notes.push({ pitch: SNARE, onset: barStart + 3, duration: 0.25, velocity: baseVel + 0.05 });
        } else {
          // 低能量用 cross-stick
          notes.push({ pitch: 37, onset: barStart + 3, duration: 0.25, velocity: baseVel * 0.6 });
        }

        // Hi-hat: 每个八分音符位置（6 个），模拟 1-2-3-4-5-6
        for (let sub = 0; sub < 6; sub++) {
          const onset = barStart + sub;
          const isGroupStart = sub === 0 || sub === 3; // 三连音组头
          const hhVel = isGroupStart ? baseVel * 0.85 : baseVel * 0.5;
          if (PRNGManager.next() > restProb * 0.5) {
            notes.push({ pitch: CHH, onset: onset, duration: 0.5, velocity: Math.min(1.0, hhVel + PRNGManager.next() * 0.03) });
          }
        }

        // Crash on first bar
        if (bar === 0 && hasFullGrooveStarted) {
          notes.push({ pitch: CRASH, onset: barStart, duration: 1.0, velocity: Math.min(1.0, baseVel + 0.15) });
        }
      }
      return notes;
    }

    // ========== Standard 4/4 模式 ==========
    const stepSize = 0.25;
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

      // --- Kick: 1 拍必有，3 拍 80% 概率，弱拍切分根据 syncopation ---
      if (isDownbeat) {
        const vel = Math.min(1.0, baseVel + 0.15 + (PRNGManager.next() * 0.04 - 0.02));
        notes.push({ pitch: KICK, onset: beat, duration: 0.25, velocity: vel });
      } else if (isBeat3 && PRNGManager.next() < 0.8) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.25, velocity: baseVel + 0.1 });
      }
      // 弱拍切分底鼓（现代感核心）
      if (!isDownbeat && !isBeat3 && is8thNote && PRNGManager.next() < syncopation * 0.35) {
        notes.push({ pitch: KICK, onset: beat, duration: 0.25, velocity: baseVel * 0.8 });
      }

      // --- Snare: 支持 half-time（25% 概率段落级触发 via useHalfTime）---
      const useHalfTime = isHalfTime || (!isIntro && !isOutro && PRNGManager.next() < 0.02);
      if (isBeat2 || isBeat4) {
        const vel = Math.min(1.0, baseVel + 0.1 + (PRNGManager.next() * 0.04 - 0.02));
        if (!useHalfTime || isBeat4) {
          notes.push({ pitch: SNARE, onset: beat, duration: 0.25, velocity: vel });
        }
      }
      // Ghost notes
      if (energyLevel >= 5 && is16thNote && !is8thNote && PRNGManager.next() < 0.15 * grooveDensity) {
        notes.push({ pitch: SNARE, onset: beat, duration: 0.125, velocity: baseVel * 0.4 });
      }

      // --- Hi-hat: 8 分基底 + 16 分 + 32 分滚奏 ---
      if (is8thNote) {
        if (isIntro && !hasFullGrooveStarted) {
          if (PRNGManager.next() < 0.5) {
            notes.push({ pitch: CHH, onset: beat, duration: 0.25, velocity: baseVel * 0.5 });
          }
        } else {
          const hhVel = isDownbeat ? baseVel * 0.9 : baseVel * 0.65;
          notes.push({ pitch: CHH, onset: beat, duration: 0.25, velocity: Math.min(1.0, hhVel + PRNGManager.next() * 0.03) });
        }
      }
      // 16 分 hi-hat
      if (energyLevel >= 6 && is16thNote && !is8thNote && PRNGManager.next() < 0.35) {
        notes.push({ pitch: CHH, onset: beat, duration: 0.125, velocity: baseVel * 0.35 });
      }
      // 32 分滚奏（现代 hip-hop 灵动感）
      if (energyLevel >= 7 && is16thNote && !is8thNote && PRNGManager.next() < 0.15) {
        notes.push({ pitch: CHH, onset: beat + 0.125, duration: 0.0625, velocity: baseVel * 0.25 });
      }

      if (energyLevel >= 5 && is8thNote && !isDownbeat && !isBeat2 && !isBeat3 && !isBeat4 && PRNGManager.next() < 0.1) {
        notes.push({ pitch: OHH, onset: beat, duration: 0.5, velocity: baseVel * 0.6 });
      }

      if (isDownbeat && Math.abs(beat - startBeat) < 1e-6 && hasFullGrooveStarted) {
        notes.push({ pitch: CRASH, onset: beat, duration: 1.0, velocity: Math.min(1.0, baseVel + 0.2) });
      }

      if (isSwing && is8thNote && energyLevel <= 5) {
        notes.push({ pitch: RIDE, onset: beat, duration: 0.5, velocity: baseVel * 0.55 });
      }

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
    const tonality = renderCtx?.tonality ?? Tonality.Major;
    const chordTones = HarmonyCore.getChordTones(chord, 60);
    const chordDur = chord.endBeat - chord.startBeat;
    const baseVel = 0.35 + energyLevel * 0.03;
    const notes: NoteData[] = [];
    const mode = params?.orchestration?.counterMelodyMode || 'sustained';

    if (mode === 'melodic-response') {
      // 🌟 melodic-response: 基于主旋律的简化/倒影生成独立副旋律线
      // 找出与当前和弦时间重叠的主旋律音
      const overlapping = melodyNotes.filter(n => n.onset >= chord.startBeat && n.onset < chord.endBeat);

      if (overlapping.length >= 2) {
        // 策略：取主旋律的逆行（倒放），降八度或移到 3rd/5th
        const safeScalePcs = HarmonyCore.getSafeScalePitches(chord, tonality);
        const melodyEnd = overlapping[overlapping.length - 1];
        const melodyStart = overlapping[0];

        // 副旋律从主旋律结束的地方"回应"——延迟半小节进入
        const responseDelay = Math.min(chordDur * 0.3, 1.0);
        const responseStart = chord.startBeat + responseDelay;
        const available = chordDur - responseDelay;
        if (available < 0.5) {
          // 太短，退回 sustained
          notes.push({ pitch: chordTones.length > 1 ? chordTones[1] : chordTones[0], onset: chord.startBeat, duration: Math.max(chordDur - 0.125, 0.5), velocity: Math.min(1.0, baseVel) });
        } else {
          // 取 2-4 个主旋律音做简化倒影
          const sourceNotes = overlapping.slice(0, Math.min(4, overlapping.length));
          const count = sourceNotes.length;
          const step = available / count;

          for (let i = 0; i < count; i++) {
            // 倒影：主旋律上行副旋律下行，反之亦然
            const srcPitch = sourceNotes[count - 1 - i].pitch; // 逆序
            // 移到和弦音附近，向下一个八度
            let cmPitch = HarmonyCore.snapToScale(srcPitch - 12, safeScalePcs);
            // 确保在合理范围 (MIDI 48-72)
            while (cmPitch < 48) cmPitch += 12;
            while (cmPitch > 72) cmPitch -= 12;

            notes.push({
              pitch: cmPitch,
              onset: responseStart + i * step,
              duration: Math.max(step * 0.85, 0.25),
              velocity: Math.min(1.0, baseVel + (PRNGManager.next() * 0.05)),
            });
          }
        }
      } else {
        // 主旋律太少，退回 sustained — 从全部和弦音中随机选
        const toneIdx = Math.floor(PRNGManager.next() * chordTones.length);
        const targetPitch = chordTones[toneIdx];
        notes.push({ pitch: targetPitch, onset: chord.startBeat, duration: Math.max(chordDur - 0.125, 0.5), velocity: Math.min(1.0, baseVel) });
      }
    } else {
      // sustained: 从全部和弦音中随机选（不只是 3rd/5th）
      const toneIdx = Math.floor(PRNGManager.next() * chordTones.length);
      const targetPitch = chordTones[toneIdx];
      notes.push({ pitch: targetPitch, onset: chord.startBeat, duration: Math.max(chordDur - 0.125, 0.5), velocity: Math.min(1.0, baseVel) });
    }

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

    // Get chord tones — 音域随机微调避免固定在同一八度
    const centerOffset = Math.floor(PRNGManager.next() * 7) - 3; // ±3 半音
    const chordTones = HarmonyCore.getChordTones(chord, 53 + centerOffset);
    const chordStart = chord.startBeat;
    const chordEnd = chord.endBeat;

    // 内联 StandardBlock 逻辑（Block / Arpeggio / Pad）
    const chordLen = chordEnd - chordStart;
    const baseVelocity = 0.4 + energyLevel * 0.04;
    let generatedNotes: NoteData[] = [];

    const texLower = textureType.toLowerCase();
    const isArpeggio = texLower === 'arpeggio' || texLower === 'broken';
    const isPad = texLower === 'pad' || texLower === 'sustained';

    if (isArpeggio) {
      const step = energyLevel >= 6 ? 0.25 : 0.5;
      let beat = chordStart;
      let idx = 0;
      // 琶音方向随机化：上行/下行/来回
      const dirRoll = PRNGManager.next();
      const isDescending = dirRoll < 0.3;
      const isPingPong = dirRoll < 0.6 && dirRoll >= 0.3;
      const toneCount = chordTones.length;
      while (beat < chordEnd - 1e-6) {
        let toneIdx: number;
        if (isPingPong) {
          const cycle = toneCount > 1 ? (toneCount - 1) * 2 : 1;
          const pos = idx % cycle;
          toneIdx = pos < toneCount ? pos : cycle - pos;
        } else if (isDescending) {
          toneIdx = (toneCount - 1) - (idx % toneCount);
        } else {
          toneIdx = idx % toneCount;
        }
        // 偶尔跳过一个音（15%），制造呼吸感
        if (idx > 0 && PRNGManager.next() < 0.15) {
          beat += step;
          idx++;
          continue;
        }
        const vel = Math.min(1.0, baseVelocity + (PRNGManager.next() * 0.06 - 0.03));
        generatedNotes.push({ pitch: chordTones[toneIdx], onset: beat, duration: step, velocity: vel });
        beat += step;
        idx++;
      }
    } else if (isPad) {
      for (let i = 0; i < chordTones.length; i++) {
        generatedNotes.push({
          pitch: chordTones[i],
          onset: chordStart,
          duration: Math.max(chordLen - 0.0625, 0.5),
          velocity: Math.min(1.0, baseVelocity * 0.8 + PRNGManager.next() * 0.02),
        });
      }
    } else {
      // Block chord — 加入节奏变化和声部错开
      const baseStep = energyLevel <= 3 ? 2.0 : (energyLevel <= 6 ? 1.0 : 0.5);
      let beat = chordStart;
      while (beat < chordEnd - 1e-6) {
        // 微调 step 大小（±15%），打破严格网格
        const stepJitter = 1.0 + (PRNGManager.next() * 0.3 - 0.15);
        const step = baseStep * stepJitter;
        const remaining = chordEnd - beat;
        const dur = Math.min(step, remaining);
        const vel = Math.min(1.0, baseVelocity + (PRNGManager.next() * 0.06 - 0.03));
        // 20% 概率省略一个非根音（让声音更透气）
        const omitIdx = PRNGManager.next() < 0.2 && chordTones.length > 2
          ? 1 + Math.floor(PRNGManager.next() * (chordTones.length - 1)) // 跳过索引 0（低音）
          : -1;
        for (let i = 0; i < chordTones.length; i++) {
          if (i === omitIdx) continue;
          // 30% 概率错开 onset（模拟人手弹奏）
          const stagger = PRNGManager.next() < 0.3 ? PRNGManager.next() * 0.08 : 0;
          generatedNotes.push({ pitch: chordTones[i], onset: beat + stagger, duration: dur, velocity: vel });
        }
        beat += step;
      }
    }

    // Sparse section end: let the last chord ring out
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

    const third = chordTones.length > 1 ? chordTones[1] : root + 4;
    const octave = root + 12;

    const notes: NoteData[] = [];
    const chordStart = chord.startBeat;
    const chordEnd = chord.endBeat;
    // max ~50 riff notes per chord (C-4 compliance)

    // 多种节奏模板随机选择
    const rhythmTemplates = [
      [0, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0],
      [0, 0.25, 0.75, 1.0, 1.75, 2.0, 2.75, 3.5],
      [0, 0.5, 1.0, 1.5, 2.0, 3.0],
      [0, 0.75, 1.0, 1.5, 2.25, 3.0, 3.5],
    ];
    const pattern = rhythmTemplates[Math.floor(PRNGManager.next() * rhythmTemplates.length)];

    // 动态生成音高模式（不再固定 root-5th）
    const pitchPool = [root, root, third, fifth, octave];
    const pitchPattern: number[] = [];
    for (let p = 0; p < pattern.length; p++) {
      pitchPattern.push(pitchPool[Math.floor(PRNGManager.next() * pitchPool.length)]);
    }

    for (let i = 0; i < pattern.length; i++) {
      const onset = chordStart + pattern[i];
      if (onset >= chordEnd - 1e-6) break;
      // 25% 概率跳过
      if (i > 0 && PRNGManager.next() < 0.25) continue;

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
