import { PRNGManager } from "../../utils/PRNG";
import { NoteData, GeneratedChord, StyleConfig, SectionMetadata, IdiomPreferences, Tonality } from "../types";
import { HarmonyCore } from "../composing/HarmonyCore";

/** S-2 合规：替代 GlobalContext 读取，由 Orchestrator 显式传入 */
export interface TextureRenderContext {
    bpm: number;
    keyOffset: number;
    tonality: Tonality;
    timeSignature: [number, number];
    activeSection: SectionMetadata | null;
}
import { StyleId } from "../config/StyleFlags";

import { BassIdiomRegistry } from "../idioms/bass/BassIdiomRegistry";
import { registerAllBassIdioms } from "../idioms/bass";
import { DrumIdiomRegistry } from "../idioms/drums/DrumIdiomRegistry";
import { registerAllDrumIdioms } from "../idioms/drums";
import { DrumIdiomContext } from "../idioms/drums/IDrumIdiom";
import { PianoIdiomRegistry } from "../idioms/piano/PianoIdiomRegistry";
import { PianoIdiomContext } from "../idioms/piano/IPianoIdiom";
import { registerAllPianoIdioms } from "../idioms/piano";

registerAllBassIdioms();
registerAllDrumIdioms();
registerAllPianoIdioms();

import { CounterMelodyIdiomRegistry } from "../idioms/counterMelody/CounterMelodyIdiomRegistry";
import { registerAllCounterMelodyIdioms } from "../idioms/counterMelody";
import { RiffIdiomRegistry } from "../idioms/riff/RiffIdiomRegistry";
import { VocalHarmonyIdiomRegistry } from "../idioms/vocal/VocalHarmonyIdiomRegistry";
import { CounterMelodyContext } from "../idioms/counterMelody/ICounterMelodyIdiom";
import { RiffContext } from "../idioms/riff/IRiffIdiom";
import { VocalHarmonyContext } from "../idioms/vocal/IVocalHarmonyIdiom";

registerAllCounterMelodyIdioms();

export class TextureMapper {
  public static generateBassLine(
    chord: GeneratedChord,
    energyLevel: number,
    isSparseSection: boolean = false,
    isSectionEnd: boolean = false,
    style?: StyleConfig,
    melodyNotes: NoteData[] = [],
    isBassSolo: boolean = false,
    idiomPreferences?: IdiomPreferences,
    nextChord?: GeneratedChord,
    nextEnergyLevel: number = 3,
    renderCtx?: TextureRenderContext,
  ): NoteData[] {
    // S-2 合规：从 renderCtx 参数读取（Orchestrator 始终提供 renderCtx）
    const keyOffset = chord.keyOffset !== undefined ? chord.keyOffset : (renderCtx?.keyOffset ?? 0);
    const tonality = renderCtx?.tonality ?? Tonality.Major;
    const activeSection = renderCtx?.activeSection ?? null;
    const bpm = renderCtx?.bpm ?? 120;

    // 🌟 Fix Bass Range: Ensure final bass root (after keyOffset) is strictly between E1 (28) and Eb2 (39)
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
    const thirdMidi = bassTones[1];
    const fifthMidi = bassTones[2];
    const seventhMidi = bassTones.length > 3 ? bassTones[3] : rootMidi + 12; // Default to octave if no 7th present to avoid dissonance

    const safeScalePcs = HarmonyCore.getSafeScalePitches(chord, tonality);

    const grooveDensity = activeSection?.groove?.density ?? 0.5;
    const grooveSyncopation = activeSection?.groove?.syncopationProb ?? 0.2;

    // safe: bassStyle is a string idiom name stored in idiomPreferences; unknown cast is safe here
    let bassStyle = idiomPreferences?.bassStyle || "steady";
    
    // 🌟 跨界融合与情绪自适应 (Cross-genre Fusion & Mood Adaptation)
    // 根据实际的 BPM 和 Energy 动态决定 Idiom，打破刻板印象
    if (bpm > 130 && energyLevel >= 6) {
        bassStyle = "syncopated"; // 高能量快歌倾向于切分或高密度
    } else if (bpm < 90 || energyLevel <= 3) {
        bassStyle = "sparse"; // 慢歌或低能量倾向于稀疏
    }

    let idiomName = bassStyle;
    
    const isEurodance = style?.id === StyleId.Eurodance;
    const isTrance = style?.id === StyleId.Trance;
    const isSynthwave = style?.id === StyleId.Synthwave;
    const isElectronic = isEurodance || isTrance || isSynthwave;

    if (isBassSolo && !isElectronic) {
      idiomName = "solo";
    } else if (activeSection?.isRiffDriven && !isElectronic) {
      idiomName = "riff-driven";
    }

    const idiom = BassIdiomRegistry.getIdiom(idiomName) || BassIdiomRegistry.getIdiom("steady")!;

    // 🌟 爵士/现代流行技巧：平滑的贝斯线条 (Stepwise Bassline / Inversions)
    // 如果知道下一个和弦，尝试使用转位让贝斯线条更平滑 (例如 4级->5级->1级 变成 4->5->7(转位)->1)
    let targetBassPitch = rootMidi;
    let octaveMidi = rootMidi + 12;

    // 🌟 EDM 专属技巧：持续低音 (Pedal Point)
    // 在 Build-Up 或 Drop 中，有概率让贝斯一直保持在主音 (Key Root) 上，制造巨大张力
    // 修复：随机的 Pedal Point 会导致贝斯在和弦根音和主音之间乱跳，破坏律动。
    // 对于 Eurodance 等需要极强根音稳定性的曲风，禁用此功能。
    if (isElectronic && !isEurodance && energyLevel >= 5 && PRNGManager.next() < 0.1) {
      // 使用当前调的主音作为持续低音，并确保在 28-39 的安全贝斯音域内
      let finalKeyRoot = keyOffset % 12;
      finalKeyRoot += 24;
      if (finalKeyRoot < 28) finalKeyRoot += 12;
      const keyRootMidi = finalKeyRoot - keyOffset;
      targetBassPitch = keyRootMidi;
      octaveMidi = keyRootMidi + 12;
    }

    // 只有在非律动型曲风（抒情、电影、爵士）中，才允许使用和弦转位作为贝斯根音
    const allowInversion = bassStyle === "sparse" || bassStyle === "melodic";

    if (allowInversion && nextChord && PRNGManager.next() < 0.2) {
      // 降低概率到 20%，避免过度使用转位导致根音缺失
      const nextBassTones = HarmonyCore.getChordTones(
        nextChord,
        nextTargetCenter,
      );
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

    const isCinematic = style?.id === StyleId.GhibliOrchestral;
    const isBallad = style?.id === StyleId.PowerBallad || style?.id === StyleId.RussianFolkBallad;

    // S-2 合规：注入 beatsPerBar/activeSection/keyOffset/grooveDNA，替代 GlobalContext 读取
    const timeSignature = renderCtx?.timeSignature ?? [4, 4] as [number, number] /* safe: literal tuple default */;
    const beatsPerBar = timeSignature[0] || 4;
    const grooveDNA = activeSection?.grooveDNA || [];

    const context: import('../idioms/bass/IBassIdiom').BassIdiomContext = {
      chord,
      energyLevel,
      isSparseSection,
      isSectionEnd,
      style,
      melodyNotes,
      isBassSolo,
      idiomPreferences,
      nextChord,
      nextEnergyLevel,
      rootMidi,
      thirdMidi,
      fifthMidi,
      seventhMidi,
      safeScalePcs,
      grooveDensity,
      grooveSyncopation,
      targetBassPitch,
      octaveMidi,
      nextTargetCenter,
      bassTones,
      isCinematic,
      isBallad,
      // S-2 合规：由 renderCtx 注入，替代 Bass Idiom 内部的 GlobalContext 读取
      beatsPerBar,
      activeSection,
      keyOffset,
      grooveDNA,
    };

    let notes = idiom.generate(context);

    // Fallback if NeoSoul returns empty (it only handles melodic bass conditionally)
    if (notes.length === 0 && idiomName === "neosoul") {
      notes = BassIdiomRegistry.getIdiom("pop")!.generate(context);
    }

    notes = this.truncateToChordEnd(notes, chord.endBeat);
    return this.deduplicateNotes(notes);
  }

  // 🌟 针对 Funk / Rock / EDM 等风格的前奏 Riff 生成器
  public static generateSignatureRiff(
    scale: number[],
    rootNote: number,
    lengthBeats: number,
    startBeat: number
  ): NoteData[] {
    const riff: NoteData[] = [];
    const rhythmMask = [1, 0, 1, 1, 0, 1, 0, 0]; // 经典的切分节奏型 (Syncopated Mask)
    let currentBeat = 0;
    
    while (currentBeat < lengthBeats) {
        for (let i = 0; i < rhythmMask.length; i++) {
            if (currentBeat >= lengthBeats) break;
            
            if (rhythmMask[i] === 1) {
                // 仅使用五声音阶，确保 Riff 极度洗脑且不会跑调
                const pitch = rootNote + scale[Math.floor(PRNGManager.next() * scale.length)];
                riff.push({
                    pitch: pitch,
                    onset: startBeat + currentBeat,
                    duration: 0.25, // 短促有力的音符
                    velocity: 100   // 强调力度
                });
            }
            currentBeat += 0.5; // 1/8 音符步进
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
    style?: StyleConfig,
    swingRatio: number = 0.5,
    nextEnergyLevel: number = 3,
    hasFullGrooveStarted: boolean = false,
    grooveRatio?: { foundation: number; comping: number; color: number },
    drumStyle: string = "steady",
    melodyNotes: NoteData[] = [],
    renderCtx?: TextureRenderContext,
  ): NoteData[] {
    // S-2 合规：优先从 renderCtx 参数读取，回退到 GlobalContext（兼容旧调用方）
    const timeSignature = renderCtx?.timeSignature ?? [4, 4] as [number, number] /* safe: literal tuple default */;
    const activeSection = renderCtx?.activeSection ?? null;
    const bpm = renderCtx?.bpm ?? 120;

    // 🌟 跨界融合与情绪自适应 (Cross-genre Fusion & Mood Adaptation)
    const is68 = timeSignature[0] === 6 && timeSignature[1] === 8;
    const isSwing = swingRatio > 0.5;
    const isHalfTime = activeSection?.groove?.feel === "half-time";
    const grooveDensity = activeSection?.groove?.density ?? 0.5;
    const grooveSyncopation = activeSection?.groove?.syncopationProb ?? 0.2;
    const laybackOffset = isSwing ? 0.05 : 0;

    // 动态调整 Drum Style
    let finalDrumStyle = drumStyle;
    if (bpm > 130 && energyLevel >= 6) {
        finalDrumStyle = "high-energy";
    } else if (bpm < 90 || energyLevel <= 3) {
        finalDrumStyle = "sparse";
    } else if (bpm >= 90 && bpm <= 110 && energyLevel >= 5 && style?.id === StyleId.Lofi) {
        finalDrumStyle = "syncopated";
    }

    const context: DrumIdiomContext = {
      startBeat,
      endBeat,
      energyLevel,
      isIntro,
      isOutro,
      style,
      swingRatio,
      nextEnergyLevel,
      hasFullGrooveStarted,
      grooveRatio,
      beatsPerBar: timeSignature[0] || 4,
      is68,
      isSwing,
      isHalfTime,
      grooveDensity,
      grooveSyncopation,
      laybackOffset,
      melodyNotes,
      activeSection,  // S-2 合规：注入 activeSection，替代 null
      idiomPreferences: { drumStyle: finalDrumStyle },
      KICK: 36,
      SNARE: 38,
      CHH: 42,
      PHH: 44,
      OHH: 46,
      CRASH: 49,
      CROSS_STICK: 37,
      TOM_HI: 50,
      TOM_MID: 47,
      TOM_LOW: 43,
      RIDE: 51,
      RIDE_BELL: 53,
      CHINA: 52,
      SPLASH: 55,
      CRASH2: 57,
    };

    const idiom = DrumIdiomRegistry.getIdiom(finalDrumStyle) || DrumIdiomRegistry.getIdiom("steady")!;
    return idiom.generate(context);
  }

  public static generateCounterMelody(
    chord: GeneratedChord,
    energyLevel: number,
    melodyNotes: NoteData[],
    style?: StyleConfig,
    renderCtx?: TextureRenderContext,
  ): NoteData[] {
    let counterMelodyStyle = style?.orchestration?.idiomPreferences?.counterMelodyStyle || "sustained";
    // S-2 合规：优先从 renderCtx 参数读取，回退到 GlobalContext（兼容旧调用方）
    const bpm = renderCtx?.bpm ?? 120;

    // 动态调整 CounterMelody Style
    if (bpm > 130 && energyLevel >= 6) {
        counterMelodyStyle = "rhythmic";
    } else if (bpm < 90 || energyLevel <= 3) {
        counterMelodyStyle = "sustained";
    }

    // S-2 合规：注入 keyOffset/tonality/activeSection，替代 GlobalContext 读取
    const cmKeyOffset = chord.keyOffset !== undefined ? chord.keyOffset : (renderCtx?.keyOffset ?? 0);
    const cmTonality = renderCtx?.tonality ?? Tonality.Major;
    const cmActiveSection = renderCtx?.activeSection ?? null;
    const context: CounterMelodyContext = { chord, energyLevel, melodyNotes, style, keyOffset: cmKeyOffset, tonality: cmTonality, activeSection: cmActiveSection };
    const idiom = CounterMelodyIdiomRegistry.getIdiom(counterMelodyStyle) || CounterMelodyIdiomRegistry.getIdiom("sustained")!;
    let notes = idiom.generate(context);
    notes = this.truncateToChordEnd(notes, chord.endBeat);
    return notes;
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
    renderCtx?: TextureRenderContext,
  ): NoteData[] {
    // 🌟 跨界融合与情绪自适应 (Cross-genre Fusion & Mood Adaptation)
    // S-2 合规：优先从 renderCtx 参数读取，回退到 GlobalContext（兼容旧调用方）
    const activeSection = renderCtx?.activeSection ?? null;
    const notes: NoteData[] = [];
    const grooveDensity = activeSection?.groove?.density ?? 0.5;
    const grooveSyncopation = activeSection?.groove?.syncopationProb ?? 0.2;
    const bpm = renderCtx?.bpm ?? 120;

    let finalPianoStyle = pianoStyle;
    if (bpm > 130 && energyLevel >= 6) {
        finalPianoStyle = "rhythmic";
    } else if (bpm < 90 || energyLevel <= 3) {
        finalPianoStyle = "sparse";
    }

    const isJazz = finalPianoStyle === 'jazz' || finalPianoStyle === 'bossa';

    const context: PianoIdiomContext = {
      chord,
      energyLevel,
      textureType,
      isSparseSection,
      isSectionEnd,
      melodyNotes,
      nextChord,
      style,
      prevVoicing,
      nextEnergyLevel,
      pianoStyle: finalPianoStyle,
      baseVelocity: 0.6,
      beatsPerBar: (renderCtx?.timeSignature ?? [4, 4] as [number, number] /* safe: literal tuple default */)[0] || 4,
      grooveDensity,
      grooveSyncopation,
      // S-2 合规：注入 keyOffset/tonality/activeSection，替代 GlobalContext 读取
      keyOffset: chord.keyOffset !== undefined ? chord.keyOffset : (renderCtx?.keyOffset ?? 0),
      tonality: renderCtx?.tonality ?? Tonality.Major,
      activeSection: renderCtx?.activeSection ?? null,
    };

    const idiom = PianoIdiomRegistry.getIdiom(finalPianoStyle) || PianoIdiomRegistry.getIdiom("block-chord")!;
    let generatedNotes = idiom.generate(context);

    // 移除导致尾音短促的逻辑，改为让最后一个和弦自然延音
    if (isSparseSection && isSectionEnd && generatedNotes.length > 0) {
      // 如果是稀疏段落的最后一个和弦（比如 Outro 结尾），让它自然延长，但限制最大长度防止采样截断
      generatedNotes.forEach((n) => {
        n.duration = Math.min(Math.max(n.duration, 2.0), 3.0);
      });
    } else {
      generatedNotes = this.truncateToChordEnd(generatedNotes, chord.endBeat);
    }
    return this.deduplicateNotes(generatedNotes);
  }

  private static truncateToChordEnd(notes: NoteData[], chordEndBeat: number): NoteData[] {
    return notes.map(n => {
      if (n.onset >= chordEndBeat) return null; // Note starts after chord ends (shouldn't happen, but just in case)
      if (n.onset + n.duration > chordEndBeat) {
        return { ...n, duration: chordEndBeat - n.onset };
      }
      return n;
    // safe: map returns NoteData | null; filter(n => n !== null) guarantees all elements are NoteData
    }).filter(n => n !== null) as NoteData[];
  }

  // P-1 合规：数组 + some() 替代 Set 去重，同时避免字符串拼接 (M-2)
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

  // 🌟 优先级5：引入固定音型 (Riff Generator)
  public static generateRiff(
    chord: GeneratedChord,
    energyLevel: number,
    style?: StyleConfig,
    renderCtx?: TextureRenderContext,
  ): NoteData[] {
    const riffStyle = style?.orchestration?.idiomPreferences?.riffStyle || "default";
    // S-2 合规：注入 keyOffset/tonality，替代 Riff Idiom 内部的 GlobalContext 读取
    const keyOffset = chord.keyOffset !== undefined ? chord.keyOffset : (renderCtx?.keyOffset ?? 0);
    const tonality = renderCtx?.tonality ?? Tonality.Major;
    const context: RiffContext = { chord, energyLevel, style, keyOffset, tonality };
    return RiffIdiomRegistry.getIdiom(riffStyle).generate(context);
  }

  // 🌟 P2: 智能人声和声生成模块 (Vocal Harmony Module)
  public static generateVocalHarmony(
    melodyNotes: NoteData[],
    chords: GeneratedChord[],
    style: StyleConfig | undefined,
    energyLevel: number,
    tonality: Tonality,
    keyOffset?: number,
  ): NoteData[] {
    const vocalStyle = style?.orchestration?.idiomPreferences?.vocalStyle || "pop";
    // S-2 合规：keyOffset 显式传入，替代 GlobalContext.currentKeyOffset
    const resolvedKeyOffset = keyOffset ?? 0;
    const context: VocalHarmonyContext = { melodyNotes, chords, energyLevel, tonality, keyOffset: resolvedKeyOffset };
    return VocalHarmonyIdiomRegistry.getIdiom(vocalStyle).generate(context);
  }
}
