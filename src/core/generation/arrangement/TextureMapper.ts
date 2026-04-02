import { PRNGManager } from "../../utils/PRNG";
import { NoteData, GeneratedChord, Tonality, IdiomPreferences } from "../types";
import { HarmonyCore } from "../composing/HarmonyCore";
import { GlobalContext } from "../GlobalContext";
import { StyleId } from "../config/StyleFlags";
import { StyleRegistry } from "../config/styles/StyleRegistry";

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
import { RiffIdiomRegistry } from "../idioms/riff/RiffIdiomRegistry";
import { VocalHarmonyIdiomRegistry } from "../idioms/vocal/VocalHarmonyIdiomRegistry";
import { CounterMelodyContext } from "../idioms/counterMelody/ICounterMelodyIdiom";
import { RiffContext } from "../idioms/riff/IRiffIdiom";
import { VocalHarmonyContext } from "../idioms/vocal/IVocalHarmonyIdiom";

export class TextureMapper {
  public static generateBassLine(
    chord: GeneratedChord,
    energyLevel: number,
    isSparseSection: boolean = false,
    isSectionEnd: boolean = false,
    styleId: StyleId = StyleId.ModernPop,
    melodyNotes: NoteData[] = [],
    isBassSolo: boolean = false,
    idiomPreferences?: IdiomPreferences,
    nextChord?: GeneratedChord,
    nextEnergyLevel: number = 3,
  ): NoteData[] {
    // 🌟 Fix Bass Range: Ensure final bass root (after keyOffset) is strictly between E1 (28) and Eb2 (39)
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
    const thirdMidi = bassTones[1];
    const fifthMidi = bassTones[2];
    const seventhMidi = bassTones.length > 3 ? bassTones[3] : rootMidi + 12; // Default to octave if no 7th present to avoid dissonance

    const safeScalePcs = HarmonyCore.getSafeScalePitches(
      chord,
      GlobalContext.currentTonality,
    );

    const activeSection = GlobalContext.getActiveSection();
    const textureAllocation = GlobalContext.getTextureAllocation();
    const grooveDensity = textureAllocation?.bassDensity ?? activeSection?.groove?.density ?? 0.5;
    const grooveSyncopation = activeSection?.groove?.syncopationProb ?? 0.2;

    let bassStyle = idiomPreferences?.bassStyle || "pop";
    
    // 🌟 跨界融合 (Cross-genre Fusion)
    const fusionProfile = activeSection?.fusionProfile;
    
    if (fusionProfile && fusionProfile.applyToBass) {
      bassStyle = StyleRegistry[fusionProfile.fusionStyle]?.orchestration?.idiomPreferences?.bassStyle || bassStyle;
    }

    let idiomName: string = bassStyle;
    
    if (isBassSolo && bassStyle !== "eurodance" && bassStyle !== "trance" && bassStyle !== "synthwave") {
      idiomName = "solo";
    } else if (activeSection?.isRiffDriven && bassStyle !== "eurodance" && bassStyle !== "synthwave" && bassStyle !== "trance") {
      idiomName = "riff";
    }

    const idiom = BassIdiomRegistry.getIdiom(idiomName) || BassIdiomRegistry.getIdiom("pop")!;

    // 🌟 爵士/现代流行技巧：平滑的贝斯线条 (Stepwise Bassline / Inversions)
    // 如果知道下一个和弦，尝试使用转位让贝斯线条更平滑 (例如 4级->5级->1级 变成 4->5->7(转位)->1)
    let targetBassPitch = rootMidi;
    let octaveMidi = rootMidi + 12;

    // 🌟 EDM 专属技巧：持续低音 (Pedal Point)
    // 在 Build-Up 或 Drop 中，有概率让贝斯一直保持在主音 (Key Root) 上，制造巨大张力
    // 修复：随机的 Pedal Point 会导致贝斯在和弦根音和主音之间乱跳，破坏律动。
    // 对于 Eurodance 等需要极强根音稳定性的曲风，禁用此功能。
    const isElectronic = bassStyle === "electronic" || bassStyle === "edm" || bassStyle === "eurodance" || bassStyle === "trance" || bassStyle === "synthwave";
    const isEDM = isElectronic;
    const isEurodance = bassStyle === "eurodance";
    if (isEDM && !isEurodance && energyLevel >= 5 && PRNGManager.next() < 0.1) {
      // 使用当前调的主音作为持续低音，并确保在 28-39 的安全贝斯音域内
      let finalKeyRoot = keyOffset % 12;
      finalKeyRoot += 24;
      if (finalKeyRoot < 28) finalKeyRoot += 12;
      const keyRootMidi = finalKeyRoot - keyOffset;
      targetBassPitch = keyRootMidi;
      octaveMidi = keyRootMidi + 12;
    }

    // 只有在非律动型曲风（抒情、电影、爵士）中，才允许使用和弦转位作为贝斯根音
    const isBallad = bassStyle === "ballad" || bassStyle === "folk";
    const isCinematic = bassStyle === "cinematic";
    const isWalkingBass = bassStyle === "jazz";
    const allowInversion = isBallad || isCinematic || isWalkingBass;

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

    const context = {
      chord,
      energyLevel,
      isSparseSection,
      isSectionEnd,
      styleId,
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
      isBallad
    };

    let notes = idiom.generate(context);

    // Fallback if NeoSoul returns empty (it only handles melodic bass conditionally)
    if (notes.length === 0 && idiomName === "neosoul") {
      notes = BassIdiomRegistry.getIdiom("pop")!.generate(context);
    }

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
    styleId: StyleId = StyleId.ModernPop,
    swingRatio: number = 0.5,
    nextEnergyLevel: number = 3,
    hasFullGrooveStarted: boolean = false,
    grooveRatio?: { foundation: number; comping: number; color: number },
    drumStyle: string = "pop"
  ): NoteData[] {
    // 🌟 跨界融合 (Cross-genre Fusion)
    const activeSection = GlobalContext.getActiveSection();
    const fusionProfile = activeSection?.fusionProfile;
    
    if (fusionProfile && fusionProfile.applyToDrums) {
        drumStyle = StyleRegistry[fusionProfile.fusionStyle]?.orchestration?.idiomPreferences?.drumStyle || drumStyle;
    }
    const is68 = GlobalContext.currentTimeSignature[0] === 6 && GlobalContext.currentTimeSignature[1] === 8;
    const isSwing = swingRatio > 0.5;
    const isHalfTime = activeSection?.groove?.feel === "half-time";
    const textureAllocation = GlobalContext.getTextureAllocation();
    const grooveDensity = textureAllocation?.drumDensity ?? activeSection?.groove?.density ?? 0.5;
    const grooveSyncopation = activeSection?.groove?.syncopationProb ?? 0.2;
    const laybackOffset = isSwing ? 0.05 : 0;

    const context: DrumIdiomContext = {
      startBeat,
      endBeat,
      energyLevel,
      isIntro,
      isOutro,
      styleId,
      swingRatio,
      nextEnergyLevel,
      hasFullGrooveStarted,
      grooveRatio,
      beatsPerBar: GlobalContext.currentTimeSignature[0] || 4,
      is68,
      isSwing,
      isHalfTime,
      grooveDensity,
      grooveSyncopation,
      laybackOffset,
      idiomPreferences: { drumStyle: drumStyle as IdiomPreferences['drumStyle'] },
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

    const idiom = DrumIdiomRegistry.getIdiom(drumStyle);
    return idiom.generate(context);
  }

  public static generateCounterMelody(
    chord: GeneratedChord,
    energyLevel: number,
    melodyNotes: NoteData[],
    styleId: StyleId = StyleId.ModernPop,
  ): NoteData[] {
    const style = StyleRegistry[styleId];
    const stringStyle = style?.orchestration?.idiomPreferences?.stringStyle || "pop";
    const context: CounterMelodyContext = { chord, energyLevel, melodyNotes, styleId };
    return CounterMelodyIdiomRegistry.getIdiom(stringStyle).generate(context);
  }

  public static generateChordTexture(
    chord: GeneratedChord,
    energyLevel: number,
    textureType: string,
    isSparseSection: boolean = false,
    isSectionEnd: boolean = false,
    melodyNotes: NoteData[] = [],
    nextChord?: GeneratedChord,
    styleId: StyleId = StyleId.ModernPop,
    prevVoicing?: number[],
    nextEnergyLevel?: number,
    pianoStyle: string = "pop"
  ): NoteData[] {
    // 🌟 跨界融合 (Cross-genre Fusion)
    const activeSection = GlobalContext.getActiveSection();
    const fusionProfile = activeSection?.fusionProfile;

    if (fusionProfile && fusionProfile.applyToChords) {
        pianoStyle = StyleRegistry[fusionProfile.fusionStyle]?.orchestration?.idiomPreferences?.pianoStyle || pianoStyle;
    }
    const notes: NoteData[] = [];

    const textureAllocation = GlobalContext.getTextureAllocation();
    const grooveDensity = textureAllocation?.chordDensity ?? activeSection?.groove?.density ?? 0.5;
    const grooveSyncopation = activeSection?.groove?.syncopationProb ?? 0.2;
    const isJazz = pianoStyle === 'jazz' || pianoStyle === 'bossa';

    const context: PianoIdiomContext = {
      chord,
      energyLevel,
      textureType,
      isSparseSection,
      isSectionEnd,
      melodyNotes,
      nextChord,
      styleId,
      prevVoicing,
      nextEnergyLevel,
      pianoStyle,
      baseVelocity: 0.6,
      beatsPerBar: GlobalContext.currentTimeSignature[0] || 4,
      grooveDensity,
      grooveSyncopation,
    };

    const idiom = PianoIdiomRegistry.getIdiom(pianoStyle);
    let generatedNotes = idiom.generate(context);

    // 移除导致尾音短促的逻辑，改为让最后一个和弦自然延音
    if (isSparseSection && isSectionEnd && generatedNotes.length > 0) {
      // 如果是稀疏段落的最后一个和弦（比如 Outro 结尾），让它自然延长，但限制最大长度防止采样截断
      generatedNotes.forEach((n) => {
        n.duration = Math.min(Math.max(n.duration, 2.0), 3.0);
      });
    }
    return this.deduplicateNotes(generatedNotes);
  }

  private static deduplicateNotes(notes: NoteData[]): NoteData[] {
    const seen = new Set();
    return notes.filter((n) => {
      const key = `${n.pitch}-${n.onset}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // 🌟 优先级5：引入固定音型 (Riff Generator)
  public static generateRiff(
    chord: GeneratedChord,
    energyLevel: number,
    styleId: StyleId,
  ): NoteData[] {
    const style = StyleRegistry[styleId];
    const riffStyle = style?.orchestration?.idiomPreferences?.riffStyle || "default";
    const context: RiffContext = { chord, energyLevel, styleId };
    return RiffIdiomRegistry.getIdiom(riffStyle).generate(context);
  }

  // 🌟 P2: 智能人声和声生成模块 (Vocal Harmony Module)
  public static generateVocalHarmony(
    melodyNotes: NoteData[],
    chords: GeneratedChord[],
    styleId: StyleId,
    energyLevel: number,
    tonality: Tonality
  ): NoteData[] {
    const style = StyleRegistry[styleId];
    const stringStyle = style?.orchestration?.idiomPreferences?.stringStyle || "pop";
    const context: VocalHarmonyContext = { melodyNotes, chords, energyLevel, tonality };
    return VocalHarmonyIdiomRegistry.getIdiom(stringStyle).generate(context);
  }
}
