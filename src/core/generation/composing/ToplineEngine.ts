import { PRNGManager } from "../../utils/PRNG";
import {
  NoteData,
  GeneratedChord,
  SectionMetadata,
  StyleConfig,
  MusicContext,
  Tonality,
} from "../types";
import { HarmonyCore } from "./HarmonyCore";
import { GrooveEngine } from "./GrooveEngine";
// removed
// GlobalContext removed — S-2 compliance: all context passed via MusicContext parameter
// Removed unused import
// removed

type Contour =
  | "Ascending"
  | "Descending"
  | "Arch"
  | "Bowl"
  | "Static"
  | "Wandering";
type PhraseForm = string[]; // e.g., ['A', 'A', 'B', 'A']

interface MotifTemplate {
  rhythm?: { pickup: number[]; body: number[]; tail: number[] };
  anchors?: { bodyStartPitch?: number; bodyEndPitch?: number };
  isMutated?: boolean;
  rhythmOffsets: number[];
  contour: Contour;
  recipe?: { pickup: number[]; body: number[]; tail: number[] };
  noteCount: number;
  phraseLengthBeats: number;
}

import { StyleId } from "../config/StyleFlags";
import { MoodId, MoodRegistry } from "../config/MoodFlags";

export class ToplineEngine {
  // 🌟 提取并简化副歌 Hook 作为前奏旋律 (Thematic Foreshadowing)
  public static extractForeshadowingIntro(
    chorusMotif: NoteData[],
    targetInstrument: number = 10 /* 10: Music Box */,
    introStartBeat: number = 0,
    chorusStartBeat: number = 0,
  ): NoteData[] {
    const introMelody: NoteData[] = [];

    // Find the start beat of the chorus to calculate relative positions
    if (chorusMotif.length === 0) return introMelody;
    const referenceBeat =
      chorusStartBeat > 0 ? chorusStartBeat : chorusMotif[0].onset;

    for (let note of chorusMotif) {
      // 规则 1：过滤掉短于 1/8 音符的装饰音 (去除油腻感)
      if (note.duration < 0.5) continue;

      // 规则 2：只保留落在强拍或次强拍上的音 (例如 4/4 拍的 1, 1.5, 2, 2.5, 3, 3.5 拍)
      const relativeBeat = note.onset - referenceBeat;
      if (relativeBeat < 0) continue; // Prevent pickup notes from playing over wrong chords

      const isOnBeat = Math.abs(relativeBeat % 0.5) < 1e-6;

      if (isOnBeat) {
        introMelody.push({
          pitch: note.pitch, // 保持原音高
          onset: introStartBeat + relativeBeat,
          duration: note.duration * 1.5, // 延长时值，增加连音(Legato)和空灵感
          velocity: 60, // 降低力度，表现克制
        });
      }
    }
    return introMelody;
  }

  // 🌟 动机碎裂引擎：让副歌旋律在 Outro 中如记忆般消散
  public static generateFadingEchoOutro(
    chorusHook: NoteData[],
    outroStartBeat: number,
    outroBars: number,
    beatsPerBar: number,
  ): NoteData[] {
    const fragmentedNotes: NoteData[] = [];
    if (chorusHook.length === 0) return fragmentedNotes;

    const chorusStartBeat = chorusHook[0].onset;

    // 1. 只截取 Hook 的前 2 小节（最核心的动机），丢弃后面的复杂发展
    const coreMotif = chorusHook.filter(
      (note) => note.onset - chorusStartBeat < beatsPerBar * 2,
    );

    // 2. 碎裂化处理 (Fragmentation Loop)
    let currentVelocity = 70; // 初始偏弱

    coreMotif.forEach((note, index) => {
      const relativeBeat = note.onset - chorusStartBeat;
      // 规则 A：随机“遗忘”某些音符（概率随时间递增），保留强拍音符
      const isOnBeat = relativeBeat % 1.0 === 0;
      const forgetProbability = isOnBeat ? 0.1 : 0.6; // 弱拍更容易被“遗忘”

      if (PRNGManager.next() > forgetProbability) {
        fragmentedNotes.push({
          pitch: note.pitch,
          // 规则 B：时间拉伸（Rubato 错觉），让音符稍微滞后，制造慵懒/留恋感
          onset: outroStartBeat + relativeBeat + PRNGManager.next() * 0.1,
          // 规则 C：时值延长（Fermata），配合更大的 Reverb 显得空灵
          duration: note.duration * 1.5,
          // 规则 D：力度线性衰减（越来越轻）
          velocity: Math.max(10, currentVelocity - index * 5),
        });
      }
    });

    return fragmentedNotes;
  }

  public static generateTrackMelody(
        sections: SectionMetadata[],
        chords: GeneratedChord[],
        tonality: Tonality,
        userMotif?: NoteData[],
        context?: MusicContext
    ): NoteData[] {
    const fullMelody: NoteData[] = [];
    const beatsPerBar = context?.timeSignature?.[0] || 4;

    // 🌟 Phase 1: Global Groove Strategy (Now decoupled per section)
    

    sections.forEach((section) => {
      // Use decoupled groove parameters from section
      const density = section.groove?.density ?? 0.5;
      const syncopationProb = section.groove?.syncopationProb ?? 0.2;

      section.grooveDNA = GrooveEngine.generateRhythmFingerprint(
        density,
        syncopationProb,
        beatsPerBar,
        userMotif,
      );
    });

    // 🌟 Phase 2: Chorus Skeleton + Motif Extraction
    const chorusMotifs: Record<string, MotifTemplate> = {};
    let chorusSkeleton: number[] = [];
    let chorusSkeletonIntervals: number[] = [];
    const firstChorus = sections.find((s) => s.name.includes("Chorus"));
    if (firstChorus) {
      const chorusChords = chords.filter(
        (c) =>
          c.startBeat >= firstChorus.startBeat &&
          c.startBeat < firstChorus.endBeat,
      );
      if (chorusChords.length === 0) chorusChords.push(chords[0]);
      // Generate motifs only, don't realize notes yet
      const result = this.generateSectionMelody(
        firstChorus,
        chorusChords,
        tonality,
        beatsPerBar,
        userMotif,
        undefined,
        null,
        true,
        0,
        0,
        context,
        67 // 副歌默认较高音区
      );
      const resultMotifs = result.motifs;
      for (const key in resultMotifs) {
        chorusMotifs[key] = resultMotifs[key];
      }

      // 🌟 骨架音生成：为 Chorus 规划每个 Sentence 的目标落音
      const chorusBeats = firstChorus.endBeat - firstChorus.startBeat;
      const chorusSentences = Math.max(1, Math.floor(chorusBeats / (beatsPerBar * 4)));
      const chorusChords2 = chords.filter(c => c.startBeat >= firstChorus.startBeat && c.startBeat < firstChorus.endBeat);
      // 张力弧线模板（PRNG 选择）
      const arcRoll = PRNGManager.next();
      const tensionArc: 'frontLoose' | 'frontTight' | 'symmetric' = arcRoll < 0.5 ? 'frontLoose' : (arcRoll < 0.8 ? 'symmetric' : 'frontTight');
      chorusSkeleton = this.generateChorusSkeleton(
        chorusChords2.length > 0 ? chorusChords2 : [chords[0]],
        chorusSentences,
        55, // Chorus basePitch
        tensionArc
      );
      chorusSkeletonIntervals = this.extractSkeletonIntervals(chorusSkeleton);
    }

    // 🌟 Phase 3: Chronological Generation with Pitch Continuity
    const sectionMelodies: Record<number, NoteData[]> = {};
    let currentPreviousPitch: number | null = null;
    let globalUnresolvedCount = 0; // 🌟 新增：跨段落追踪未解决的乐句数量
    let maxPitchBeforeChorus = 0; // 🌟 新增：追踪副歌前的最高音，用于制造 Detonator 爆发
    let currentBasePitch = 52; // 初始音区 (E3) — 偏低起步，给 Catapult 留空间

    sections.forEach((section, index) => {
      // 🌟 Tessitura Catapult (音区弹射机制) & Octave Register Shift
      let isOctaveShiftTriggered = false;
      if (index > 0) {
        const prevSection = sections[index - 1];
        const energyDelta = section.energyLevel - prevSection.energyLevel;
        
        // 🚀 The Octave Register Shift (八度音区跃迁)
        const isPrevVerseOrPre = prevSection.name.includes("Verse") || prevSection.name.includes("PreChorus") || prevSection.name.includes("Pre-Chorus");
        const isCurrentChorusOrDrop = section.name.includes("Chorus") || section.name.includes("Drop");
        
        if (isPrevVerseOrPre && isCurrentChorusOrDrop) {
            // Verse→Chorus 音区提升 3~7 半音（温和跃迁，避免飙高音）
            currentBasePitch += 3 + Math.floor(PRNGManager.next() * 5);
            isOctaveShiftTriggered = true;
        } else if (energyDelta >= 3) {
            currentBasePitch += 5; // 能量暴增，音区跃升纯四度
        } else if (energyDelta >= 1) {
            currentBasePitch += 2; // 能量微增，音区上移大二度
        } else if (energyDelta <= -3) {
            currentBasePitch -= 5; // 能量暴降，音区跌落纯四度
        } else if (energyDelta <= -1) {
            currentBasePitch -= 2; // 能量微降，音区下移大二度
        }
        
        // 🌟 Sectional Register Profiling (基于风格配置的音区轮廓)
        const registerProfile = context?.style?.melody?.sectionalRegisterProfile;
        if (registerProfile) {
            if (section.name.includes("Verse") && registerProfile.verse) {
                currentBasePitch = Math.max(registerProfile.verse[0], Math.min(registerProfile.verse[1], currentBasePitch));
            } else if ((section.name.includes("PreChorus") || section.name.includes("Pre-Chorus")) && registerProfile.preChorus) {
                currentBasePitch = Math.max(registerProfile.preChorus[0], Math.min(registerProfile.preChorus[1], currentBasePitch));
            } else if ((section.name.includes("Chorus") || section.name.includes("Drop")) && registerProfile.chorus) {
                currentBasePitch = Math.max(registerProfile.chorus[0], Math.min(registerProfile.chorus[1], currentBasePitch));
            } else if (section.name.includes("Solo") && registerProfile.solo) {
                currentBasePitch = Math.max(registerProfile.solo[0], Math.min(registerProfile.solo[1], currentBasePitch));
            }
        } else {
            // Semantic Overrides (Fallback 确保特定段落的物理底线)
            if (section.name.includes("Chorus") && currentBasePitch < 55) {
                currentBasePitch = 55; // 副歌至少在 G3
            } else if (section.name.includes("Verse") && currentBasePitch > 55) {
                currentBasePitch = 50; // 主歌回归 D3 附近
            } else if (section.name.includes("Solo")) {
                currentBasePitch = 60; // Solo (C4)
            }
        }
        
        // 限制在合理的主音范围内 (C3 到 G4)
        currentBasePitch = Math.max(48, Math.min(67, currentBasePitch));
      } else {
        const registerProfile = context?.style?.melody?.sectionalRegisterProfile;
        if (registerProfile) {
            if (section.name.includes("Chorus") && registerProfile.chorus) currentBasePitch = registerProfile.chorus[0];
            else if (section.name.includes("Intro") && registerProfile.verse) currentBasePitch = registerProfile.verse[1];
        } else {
            if (section.name.includes("Chorus")) currentBasePitch = 55;
            else if (section.name.includes("Intro")) currentBasePitch = 55;
        }
      }

      let providedMotifs: Record<string, MotifTemplate> | undefined = undefined;

      if (section.name.includes("Chorus")) {
        // Reuse the motifs we extracted
        providedMotifs = chorusMotifs;
      } else if (
        Object.keys(chorusMotifs).length > 0 &&
        (section.name.includes("Verse") || section.name.includes("PreChorus"))
      ) {
        // 🌟 动机预示 (Motivic Prediction)：80% 继承 Chorus A 动机
        // + 骨架音程注入（让 Verse 旋律走向有 Chorus 的"味道"）
        if (PRNGManager.next() < 0.8) {
          providedMotifs = {};
          const motifA = chorusMotifs["A"];
          if (motifA) {
            const sectionDensity = section.groove?.density ?? 0.5;
            const inherited = this.downgradeMotif(motifA, section.name, sectionDensity);
            // 注入骨架音程作为 recipe body（如果有骨架）
            if (chorusSkeletonIntervals.length > 0 && inherited.recipe) {
              inherited.recipe.body = chorusSkeletonIntervals;
            }
            providedMotifs["A"] = inherited;
          }
        }
      }

      const sectionChords = chords.filter(
        (c) =>
          c.startBeat >= section.startBeat && c.startBeat < section.endBeat,
      );
      if (sectionChords.length === 0) sectionChords.push(chords[0]);

      // 🌟 提案一：主题回响 (Motif Fragmentation)
      // 如果是 Outro，且不是 hard_stop，尝试使用副歌动机进行碎裂化处理
      if (
        section.name.includes("Outro") &&
        section.endingType !== "hard_stop"
      ) {
        const chorusIndex = sections.findIndex((s) =>
          s.name.includes("Chorus"),
        );
        if (chorusIndex !== -1 && sectionMelodies[chorusIndex] !== undefined) {
          const chorusNotes = sectionMelodies[chorusIndex];
          if (chorusNotes.length > 0) {
            const outroBars =
              (section.endBeat - section.startBeat) / beatsPerBar;
            const outroNotes = this.generateFadingEchoOutro(
              chorusNotes,
              section.startBeat,
              outroBars,
              beatsPerBar,
            );

            sectionMelodies[index] = outroNotes;
            if (outroNotes.length > 0) {
              currentPreviousPitch = outroNotes[outroNotes.length - 1].pitch;
            }
            globalUnresolvedCount = 0;
            return; // 跳过常规的 generateSectionMelody
          }
        }
      }

      // 为 Chorus 传入骨架音，为 Verse/PreChorus 传入骨架音程（动机预示）
      const sectionSkeleton = section.name.includes('Chorus') ? chorusSkeleton : undefined;

      const result = this.generateSectionMelody(
        section,
        sectionChords,
        tonality,
        beatsPerBar,
        userMotif,
        providedMotifs,
        currentPreviousPitch,
        false,
        globalUnresolvedCount,
        maxPitchBeforeChorus,
        context,
        currentBasePitch,
        isOctaveShiftTriggered,
        sectionSkeleton
      );

      sectionMelodies[index] = result.notes;
      currentPreviousPitch = result.lastPitch; // Pass the last pitch to the next section!
      globalUnresolvedCount = result.unresolvedCount; // 更新未解决计数

      // 🌟 记录副歌前的最高音
      if (!section.name.includes("Chorus") && result.notes.length > 0) {
        const sectionMax = Math.max(...result.notes.map((n) => n.pitch));
        if (sectionMax > maxPitchBeforeChorus) {
          maxPitchBeforeChorus = sectionMax;
        }
      }
    });

    // Assemble full melody in order
    sections.forEach((section, index) => {
      const notes = sectionMelodies[index];
      if (notes) {
        fullMelody.push(...notes);
      }
    });

    return fullMelody;
  }

  private static transformMotif(
    motif: MotifTemplate,
    transform: {
      isInv?: boolean;
      isRet?: boolean;
      isAug?: boolean;
      isSwitcheroo?: boolean;
      isSplit?: boolean;
      isMerge?: boolean;
      isShift?: boolean;
    },
  ): MotifTemplate {
    let { rhythmOffsets, contour, noteCount, phraseLengthBeats } = motif;

    if (transform.isInv) {
      const invMap: Record<Contour, Contour> = {
        Ascending: "Descending",
        Descending: "Ascending",
        Arch: "Bowl",
        Bowl: "Arch",
        Static: "Static",
        Wandering: "Wandering",
      };
      contour = invMap[contour];
    }

    if (transform.isRet) {
      if (rhythmOffsets.length > 0) {
        const lastOffset = rhythmOffsets[rhythmOffsets.length - 1];
        rhythmOffsets = rhythmOffsets.map((r) => lastOffset - r).reverse();
      }
      const retMap: Record<Contour, Contour> = {
        Ascending: "Descending",
        Descending: "Ascending",
        Arch: "Arch",
        Bowl: "Bowl",
        Static: "Static",
        Wandering: "Wandering",
      };
      contour = retMap[contour];
    }

    if (transform.isAug) {
      // 节奏放大 (Rhythmic Augmentation)
      rhythmOffsets = rhythmOffsets
        .map((r) => r * 2.0)
        .filter((r) => r < phraseLengthBeats);

      // 如果放大后音符太少（比如只有一个），尝试在中间插入一个音
      if (rhythmOffsets.length === 1 && phraseLengthBeats > 2) {
        rhythmOffsets.push(rhythmOffsets[0] + 1.0);
      }

      noteCount = rhythmOffsets.length;
    }

    if (transform.isSwitcheroo && rhythmOffsets.length > 1) {
      // 🌟 Switcheroo (移位/镜像技巧)
      // 保持第一个音（重拍锚点）不变，将其余音符的旋律线反向，或者把最后一个音移到最前面
      const switchMap: Record<Contour, Contour> = {
        Ascending: "Arch",
        Descending: "Bowl",
        Arch: "Ascending",
        Bowl: "Descending",
        Static: "Wandering",
        Wandering: "Static",
      };
      contour = switchMap[contour];

      // 节奏上，把最后一个音符提前到第一个音符之前（切分预期）
      const lastOffset = rhythmOffsets.pop()!;
      rhythmOffsets.unshift(rhythmOffsets[0] - 0.5);

      // 归一化，确保不出现负数时间
      const minOffset = Math.min(...rhythmOffsets);
      if (minOffset < 0) {
        rhythmOffsets = rhythmOffsets.map((r) => r - minOffset);
      }
    }

    if (transform.isSplit && rhythmOffsets.length > 0) {
      // 🌟 Split (分裂): 随机选择一个音符，将其分裂为两个
      const splitIdx = Math.floor(PRNGManager.next() * rhythmOffsets.length);
      const onset = rhythmOffsets[splitIdx];
      const nextOnset =
        splitIdx < rhythmOffsets.length - 1
          ? rhythmOffsets[splitIdx + 1]
          : phraseLengthBeats;
      const duration = nextOnset - onset;
      if (duration >= 1.0) {
        // 如果音符足够长，在中间插入一个音符
        rhythmOffsets.splice(splitIdx + 1, 0, onset + duration / 2);
        noteCount++;
      }
    }

    if (transform.isMerge && rhythmOffsets.length > 1) {
      // 🌟 Merge (合并): 随机选择两个相邻的音符，合并为一个
      const mergeIdx = Math.floor(
        PRNGManager.next() * (rhythmOffsets.length - 1),
      );
      rhythmOffsets.splice(mergeIdx + 1, 1);
      noteCount--;
    }

    if (transform.isShift && rhythmOffsets.length > 0) {
      // 🌟 Shift (移位): 整体平移或局部平移
      const shiftAmount = PRNGManager.next() > 0.5 ? 0.5 : -0.5;
      rhythmOffsets = rhythmOffsets.map((r) => r + shiftAmount);
      // 确保不越界
      rhythmOffsets = rhythmOffsets.filter(
        (r) => r >= 0 && r < phraseLengthBeats,
      );
      if (rhythmOffsets.length === 0) rhythmOffsets.push(0); // 兜底
      noteCount = rhythmOffsets.length;
    }

    return {
      rhythm: motif.rhythm,
      anchors: motif.anchors,
      isMutated: true,
      rhythmOffsets,
      contour,
      noteCount,
      phraseLengthBeats,
    };
  }

  private static downgradeMotif(
    motif: MotifTemplate,
    sectionName: string,
    density: number,
  ): MotifTemplate {
    let newRhythm = [...motif.rhythmOffsets];
    let newContour = motif.contour;

    if (sectionName.includes("Verse")) {
      // Sparser rhythm: drop some off-beats
      newRhythm = newRhythm.filter((r) => {
        if (Math.abs(r % 1) < 1e-6) return true; // keep downbeats
        return PRNGManager.next() < density; // drop some off-beats based on density
      });
      if (newRhythm.length === 0) newRhythm.push(0);

      // Keep the same contour to maintain melodic identity,
      // but the sparser rhythm will naturally make it feel calmer.
    } else if (sectionName.includes("PreChorus")) {
      // Build-up contour
      newContour = "Ascending";
    }

    return {
      rhythm: motif.rhythm,
      anchors: motif.anchors,
      isMutated: true,
      rhythmOffsets: newRhythm,
      contour: newContour,
      noteCount: newRhythm.length,
      phraseLengthBeats: motif.phraseLengthBeats,
      recipe: motif.recipe,
    };
  }

  private static generateSectionMelody(
    section: SectionMetadata,
    chords: GeneratedChord[],
    tonality: Tonality,
    beatsPerBar: number,
    userMotif?: NoteData[],
    providedMotifs?: Record<string, MotifTemplate>,
    incomingPreviousPitch: number | null = null,
    generateMotifsOnly: boolean = false,
    incomingUnresolvedCount: number = 0,
    maxPitchBeforeChorus: number = 0,
    context?: MusicContext,
    basePitch: number = 60,
    isOctaveShiftTriggered: boolean = false,
    skeleton?: number[] // 骨架音数组（每个 sentence 一个目标音）
  ): {
    notes: NoteData[];
    motifs: Record<string, MotifTemplate>;
    lastPitch: number | null;
    unresolvedCount: number;
  } {
    const sectionDensity = section.groove?.density ?? 0.5;
    const sectionSyncopation = section.groove?.syncopationProb ?? 0.2;

    // 🌟 修复：如果主奏乐器不是人声，说明这是一首纯器乐曲，主旋律应该具有 Solo 的表现力
    // isVocal is passed as param
    
    
    

    let isIntro = section.name.includes("Intro");
    let isOutro = section.name.includes("Outro");

    if (isIntro) {
      return {
        notes: [],
        motifs: {},
        lastPitch: null,
        unresolvedCount: incomingUnresolvedCount,
      };
    }
    if (isOutro) {
      return {
        notes: [],
        motifs: {},
        lastPitch: null,
        unresolvedCount: incomingUnresolvedCount,
      };
    }

    const sectionGroove =
      section.grooveDNA ||
      GrooveEngine.generateRhythmFingerprint(
        sectionDensity,
        sectionSyncopation,
        beatsPerBar,
        userMotif,
      );
    // 🌟 修复：将生成的 groove 保存回 section，确保 Orchestrator 生成伴奏时使用完全相同的律动骨架！
    section.grooveDNA = sectionGroove;
    // GlobalContext.updateCurrentSlice removed — S-2: generation pipeline must not write to global state

    const melodyGroove = GrooveEngine.generateInverseGroove(
      sectionGroove,
      beatsPerBar,
      sectionDensity,
    );

    const secStart = section.startBeat;
    const sectionMelody: NoteData[] = [];
    let currentPreviousPitch = incomingPreviousPitch;

    // 🌟 戛然而止 (Hard Stop) 逻辑：只在第一拍弹奏一个强有力的主音，然后结束
    if (section.endingType === "hard_stop") {
      const firstChord = chords[0];
      const rootPitch = HarmonyCore.getChordTones(firstChord, basePitch)[0];
      const pitch = rootPitch;
      sectionMelody.push({
        pitch: pitch,
        onset: secStart,
        duration: beatsPerBar * 2, // 延音两小节
        velocity: 1.0, // 强力度
      });
      return {
        notes: sectionMelody,
        motifs: {},
        lastPitch: pitch,
        unresolvedCount: 0,
      };
    }

    let motifUsage: "None" | "LiteralRiff" | "RhythmOnly" | "BrokenDown" =
      "None";
    if (userMotif && userMotif.length > 0) {
      if (section.name.includes("Intro")) {
        motifUsage = "LiteralRiff";
      } else if (section.name.includes("Chorus")) {
        motifUsage = "LiteralRiff";
      } else if (section.name.includes("Verse")) {
        motifUsage = PRNGManager.next() > 0.5 ? "BrokenDown" : "RhythmOnly";
      } else {
        motifUsage = "None";
      }
    }

    if (motifUsage === "LiteralRiff" && userMotif) {
      if (generateMotifsOnly) {
        return {
          notes: [],
          motifs: {},
          lastPitch: null,
          unresolvedCount: incomingUnresolvedCount,
        };
      }

      let maxMotifOnset = 0;
      userMotif.forEach((n) => {
        if (n.onset > maxMotifOnset) maxMotifOnset = n.onset;
      });
      const motifLengthBeats =
        Math.ceil((maxMotifOnset + 1) / beatsPerBar) * beatsPerBar;
      let currentBeat = secStart;

      const octaveOffset = Math.round((basePitch - 60) / 12) * 12;

      while (currentBeat + motifLengthBeats <= section.endBeat) {
        userMotif.forEach((n) => {
          const onset = currentBeat + n.onset;
          const activeChord =
            chords.find((c) => onset >= c.startBeat && onset < c.endBeat) ||
            chords[0];

          let pitch = n.pitch + octaveOffset;

          // 🌟 优化方向 2：和声宽容度 (Dissonance Tolerance)
          // 判断是否在强拍 (距离 0.5 拍的网格点很近，例如 0, 0.5, 1.0, 1.5...)
          const beatOffset = onset % 0.5;
          const isStrongBeat = beatOffset < 0.1 || beatOffset > 0.4;

          // Skip snapToScale to preserve the exact user motif

          sectionMelody.push({
            ...n,
            onset: onset,
            pitch: pitch,
            isUserMotif: true,
          });
        });
        currentBeat += motifLengthBeats;
      }
      const humanizedMelody = sectionMelody;

      let lastPitch = currentPreviousPitch;
      if (humanizedMelody.length > 0) {
        lastPitch = humanizedMelody[humanizedMelody.length - 1].pitch;
      }

      return {
        notes: humanizedMelody,
        motifs: {},
        lastPitch,
        unresolvedCount: 0,
      };
    }

    const FORMS: PhraseForm[] = [
      ["A", "A_prime", "B", "A_prime"],
      ["A", "B", "A", "C"],
      ["A", "A_prime", "B", "C"],
      ["A", "B", "A_prime", "B_prime"],
      // 🌟 Advanced Motif Development Forms
      ["A", "A_seq", "B", "A_prime"],
      ["A", "A_inv", "B", "A_prime"],
      ["A", "A_switch", "B", "A_prime"],
      ["A", "B", "A_ret", "C"],
      ["A", "A_prime", "B", "B_aug"],
    ];
    // 只有真正的 Solo 段落才使用完全不重复的自由发展形式，器乐主歌/副歌依然需要结构感
    const isActualSoloSection = section.name.includes("Solo");
    // 🌟 Bottom-Up Generative Grammar: Dynamic Phrase State Machine
    // 优先使用段落级 moodOverride（叙事弧线），回退到全曲 mood
    const moodId = section.moodOverride ?? context?.moodId ?? MoodId.Neutral;
    const mood = MoodRegistry[moodId] || MoodRegistry[MoodId.Neutral];
    const actionBias = mood.phraseActionBias || [0.4, 0.3, 0.3]; // Repeat, Vary, Contrast

    // 🌟 修复：强制使用 4 小节乐句结构 (Sentence Structure)
    const sentenceLengthBeats = beatsPerBar * 4;
    const totalSentences = Math.max(
      1,
      Math.floor((section.endBeat - section.startBeat) / sentenceLengthBeats),
    );

    const motifs: Record<string, MotifTemplate> = {};
    if (providedMotifs) {
      for (const key in providedMotifs) {
        motifs[key] = providedMotifs[key];
      }
    }

    let consecutiveUnresolved = incomingUnresolvedCount;
    let currentLabelCode = 65; // 'A'

    // 🌟 Schenkerian Macro-Targets
    let macroTargetDegree: number | undefined;
    if (section.name.includes("Chorus")) {
      macroTargetDegree = PRNGManager.next() > 0.5 ? 1 : 3;
    } else if (section.name.includes("Verse")) {
      macroTargetDegree = PRNGManager.next() > 0.5 ? 5 : 3;
    } else if (section.name.includes("PreChorus")) {
      macroTargetDegree = PRNGManager.next() > 0.5 ? 5 : 2;
    }

    for (let sentenceIdx = 0; sentenceIdx < totalSentences; sentenceIdx++) {
      const sentenceStart = secStart + sentenceIdx * sentenceLengthBeats;

      // 决定这个 Sentence 的内部结构
      // 结构 1: [1 bar (A), 1 bar (A_seq/A_prime), 2 bars (B)] - 经典的流行乐句
      // 结构 2: [2 bars (A), 2 bars (B)] - 舒缓的乐句
      const isClassicSentence = PRNGManager.next() > 0.3; // 70% 概率使用 1+1+2 结构

      const subPhrases: {
        label: string;
        lengthBeats: number;
        isAnswer: boolean;
        isSeq: boolean;
        isPrime?: boolean;
      }[] = [];

      if (isActualSoloSection) {
        subPhrases.push({
          label: String.fromCharCode(currentLabelCode++),
          lengthBeats: beatsPerBar * 2,
          isAnswer: false,
          isSeq: false,
        });
        subPhrases.push({
          label: String.fromCharCode(currentLabelCode++),
          lengthBeats: beatsPerBar * 2,
          isAnswer: true,
          isSeq: false,
        });
      } else {
        if (isClassicSentence) {
          const baseLabel =
            sentenceIdx === 0 ? "A" : PRNGManager.next() > 0.5 ? "A" : "C";
          subPhrases.push({
            label: baseLabel,
            lengthBeats: beatsPerBar,
            isAnswer: false,
            isSeq: false,
          });
          
          // 🌟 Hook Engineering: Decide between Sequence or Prime (Development)
          const isPrime = PRNGManager.next() > 0.5;
          subPhrases.push({
            label: baseLabel + (isPrime ? "_prime" : "_seq"),
            lengthBeats: beatsPerBar,
            isAnswer: false,
            isSeq: !isPrime,
            isPrime: isPrime
          });

          const answerLabel = sentenceIdx === totalSentences - 1 ? "Z" : "B"; // Z for final resolution
          subPhrases.push({
            label: answerLabel,
            lengthBeats: beatsPerBar * 2,
            isAnswer: true,
            isSeq: false,
          });
        } else {
          const baseLabel =
            sentenceIdx === 0 ? "A" : PRNGManager.next() > 0.5 ? "A" : "C";
          subPhrases.push({
            label: baseLabel,
            lengthBeats: beatsPerBar * 2,
            isAnswer: false,
            isSeq: false,
          });

          const answerLabel = sentenceIdx === totalSentences - 1 ? "Z" : "B";
          subPhrases.push({
            label: answerLabel,
            lengthBeats: beatsPerBar * 2,
            isAnswer: true,
            isSeq: false,
          });
        }
      }

      let currentPhraseStart = sentenceStart;

      for (let i = 0; i < subPhrases.length; i++) {
        const sub = subPhrases[i];
        const baseLabel = sub.label.split("_")[0];

        let forceStrongResolution = false;
        if (sub.isAnswer && sentenceIdx === totalSentences - 1) {
          forceStrongResolution = true;
        }

        if (motifs[baseLabel] === undefined) {
          // Mood 调制旋律密度
          const melodyDensity = mood.melodyDensityMultiplier ?? mood.densityMultiplier;
          let sectionTypeFactor = isActualSoloSection ? 1.8 : section.name.includes("Chorus") ? 1.2 : 1.0;

          // 🌟 Chorus 内部张力弧线：不同 sentence 密度不同
          // frontLoose: [0.75, 0.9, 1.1, 1.25] → 前松后紧
          // symmetric:  [0.8, 1.15, 1.15, 0.8] → 拱形
          // frontTight: [1.25, 1.1, 0.9, 0.75] → 前紧后松
          if (skeleton && skeleton.length > 0 && section.name.includes("Chorus")) {
            const sentProgress = totalSentences > 1 ? sentenceIdx / (totalSentences - 1) : 0.5;
            // 生成弧线因子（前松后紧为最常见）
            const arcFactor = 0.75 + sentProgress * 0.5; // 0.75 → 1.25
            sectionTypeFactor *= arcFactor;
          }

          const densityMultiplier = sectionTypeFactor * melodyDensity;
          const avgNotesPerBeat = densityMultiplier * sectionDensity;
          let minNotes = Math.max(
            isOutro ? 1 : 3,
            Math.floor(sub.lengthBeats * avgNotesPerBeat * 0.6),
          );
          let maxNotes = Math.max(
            minNotes + 1,
            Math.floor(sub.lengthBeats * avgNotesPerBeat * 1.5),
          );

          if (isIntro) {
            minNotes = Math.max(3, Math.floor(minNotes * 0.8));
            maxNotes = Math.max(minNotes + 1, Math.floor(maxNotes * 0.8));
          }

          const noteCount =
            Math.floor(PRNGManager.next() * (maxNotes - minNotes + 1)) +
            minNotes;

          let contours = [
            "Ascending",
            "Descending",
            "Arch",
            "Bowl",
            "Static",
            "Wandering",
          ];
          if (isOutro) {
            contours =
              PRNGManager.next() > 0.5
                ? ["Ascending", "Arch"]
                : ["Descending", "Bowl", "Static"];
          }
          const contour = contours[
            Math.floor(PRNGManager.next() * contours.length)
          ] as any;

          let rhythm3D = this.generateMotifRhythm(
            melodyGroove,
            noteCount,
            sub.lengthBeats,
            sectionDensity,
            (isIntro || isOutro) && sentenceIdx === 0 && i === 0,
            context,
            section,
          );
          
          let rhythmOffsets: number[] = [];
          if (rhythm3D) {
            rhythmOffsets = [
              ...(rhythm3D.pickup || []),
              ...(rhythm3D.body || []),
              ...(rhythm3D.tail || []),
            ];
          }

          if (
            userMotif &&
            (motifUsage === "RhythmOnly" || motifUsage === "BrokenDown") &&
            baseLabel === "A"
          ) {
            let motifRhythm = userMotif.map((n) => n.onset);
            if (motifUsage === "BrokenDown") {
              const halfLength = Math.ceil(motifRhythm.length / 2);
              motifRhythm = motifRhythm.slice(0, halfLength);
            }
            motifRhythm = motifRhythm.filter(
              (onset) => onset < sub.lengthBeats,
            );
            if (motifRhythm.length > 0) {
              rhythmOffsets = motifRhythm;
            }
          }

          const defaultPickupRecipes = [[0], [0, 1], [-1, 0], [1, 0]];
          const defaultBodyRecipes = [
            [0, 1, 2, 4, 3],
            [0, -1, -2, -3],
            [0, 2, 1, 0],
            [0, 0, 1, 0],
            [0, 2, 4, 2, 0],
            [0, -2, -4, -2, 0],
            [0, 3, 2, 1, 0],
            [0, 1, 0, -1, 0],
          ];
          const defaultTailRecipes = [[0], [-1], [1], [-2, 0]];

          const pickupRecipes = defaultPickupRecipes;
          const bodyRecipes = defaultBodyRecipes;
          const tailRecipes = defaultTailRecipes;

          const recipe = {
            pickup:
              pickupRecipes[
                Math.floor(PRNGManager.next() * pickupRecipes.length)
              ],
            body: bodyRecipes[
              Math.floor(PRNGManager.next() * bodyRecipes.length)
            ],
            tail: tailRecipes[
              Math.floor(PRNGManager.next() * tailRecipes.length)
            ],
          };

          motifs[baseLabel] = {
            rhythm: rhythm3D,
            rhythmOffsets,
            contour,
            recipe,
            noteCount: rhythmOffsets.length,
            phraseLengthBeats: sub.lengthBeats,
            isMutated: false,
          };
        }

        if (generateMotifsOnly) continue;

        // 🌟 Deep clone the template to avoid mutating the original motif across sentences
        const originalTemplate = motifs[baseLabel];
        let template: MotifTemplate = { 
            ...originalTemplate,
            rhythmOffsets: [...originalTemplate.rhythmOffsets],
        };
        
        if (originalTemplate.recipe) {
            template.recipe = {
                pickup: originalTemplate.recipe.pickup ? [...originalTemplate.recipe.pickup] : [],
                body: originalTemplate.recipe.body ? [...originalTemplate.recipe.body] : [],
                tail: originalTemplate.recipe.tail ? [...originalTemplate.recipe.tail] : []
            };
        }
        
        if (originalTemplate.rhythm) {
            template.rhythm = {
                pickup: originalTemplate.rhythm.pickup ? [...originalTemplate.rhythm.pickup] : [],
                body: originalTemplate.rhythm.body ? [...originalTemplate.rhythm.body] : [],
                tail: originalTemplate.rhythm.tail ? [...originalTemplate.rhythm.tail] : []
            };
        }

        let currentContour = template.contour;
        let currentBasePitch = basePitch;
        let currentMacroTarget = macroTargetDegree;

        const callAndResponseProb = context?.style?.melody?.callAndResponseProbability ?? 0.4;
        const useCallAndResponse = PRNGManager.next() < callAndResponseProb;

        if (sub.isAnswer) {
          if (useCallAndResponse) {
            // 🌟 Call-and-Response Mechanics
            const crTechnique = PRNGManager.next();
            if (crTechnique < 0.33) {
                // Cousin Method: Keep rhythm, change tail contour and target
                template.contour = "Wandering"; // Force a different resolution
                currentMacroTarget = PRNGManager.next() > 0.5 ? 1 : 3;
            } else if (crTechnique < 0.66) {
                // Neighbor Method: Octave shift
                currentBasePitch += PRNGManager.next() > 0.5 ? 12 : -12;
                // Keep the same contour to make the octave shift obvious
            } else {
                // Q&A Method: Invert contour
                if (currentContour === "Ascending") template.contour = "Descending";
                else if (currentContour === "Descending") template.contour = "Ascending";
                else if (currentContour === "Arch") template.contour = "Bowl";
                else if (currentContour === "Bowl") template.contour = "Arch";
                else template.contour = "Descending";
            }
          } else {
            // Default fallback logic
            if (currentContour === "Ascending") currentContour = "Arch";
            else if (currentContour === "Arch") currentContour = "Descending";
            else if (currentContour === "Wandering") currentContour = "Descending";
            template.contour = currentContour;
          }
        } else {
          if (currentContour === "Descending") currentContour = "Bowl";
          else if (currentContour === "Static") currentContour = "Ascending";
          else if (currentContour === "Bowl") currentContour = "Ascending";
          template.contour = currentContour;
        }

        if (sub.isSeq) {
          const shiftOptions = [2, 4, 5, -2, -4, -5];
          currentBasePitch +=
            shiftOptions[Math.floor(PRNGManager.next() * shiftOptions.length)];
        } else if (sub.isPrime) {
          // 🌟 Hook Engineering: Non-linear Reinforcement (A -> A')
          const primeTechnique = PRNGManager.next();
          
          if (primeTechnique < 0.33) {
            // Technique 1: Rhythmic Densification (Split) - 情绪递进，字数变多
            if (template.rhythmOffsets.length > 0) {
                const newOffsets = [];
                for (let j = 0; j < template.rhythmOffsets.length; j++) {
                    newOffsets.push(template.rhythmOffsets[j]);
                    // Split the note if there's enough gap (>= 1.0 beat)
                    if (j < template.rhythmOffsets.length - 1) {
                        const gap = template.rhythmOffsets[j+1] - template.rhythmOffsets[j];
                        if (gap >= 1.0 && PRNGManager.next() > 0.5) {
                            newOffsets.push(template.rhythmOffsets[j] + gap / 2);
                            if (template.recipe) {
                                template.recipe.body.push(template.recipe.body[template.recipe.body.length - 1] || 0); // Duplicate last recipe step
                            }
                        }
                    }
                }
                template.rhythmOffsets = newOffsets;
                template.noteCount = newOffsets.length;
            }
          } else if (primeTechnique < 0.66) {
            // Technique 2: Syncopation Shift (Anticipation) - 抢拍，增加律动推力
            const shiftAmount = PRNGManager.next() > 0.5 ? -0.5 : -0.25;
            template.rhythmOffsets = template.rhythmOffsets.map(o => Math.max(0, o + shiftAmount));
          } else {
            // Technique 3: Melodic Up-turn (Tail Upward) - 尾音上扬，制造悬念
            template.contour = "Ascending";
            currentMacroTarget = (currentMacroTarget || 1) + 4; // Target a higher degree (e.g., 5th or Octave)
            if (currentMacroTarget > 7) currentMacroTarget -= 7;
            currentBasePitch += 2; // Slight upward lift
          }
        }

        const isLastPhraseOfIntro =
          isIntro &&
          sentenceIdx === totalSentences - 1 &&
          i === subPhrases.length - 1;
        const isClimax =
          section.name.includes("Chorus") && sentenceIdx === 0 && i === 0;

        // 骨架音：Chorus 的每个 sentence 的最后一个子乐句（answer/Z）用骨架音
        const useSkeletonForThisPhrase = skeleton && skeleton[sentenceIdx] !== undefined && sub.isAnswer;
        const phraseSkeletonPitch = useSkeletonForThisPhrase ? skeleton[sentenceIdx] : undefined;

        const phraseResult = this.realizeMotif(
          template,
          currentPhraseStart,
          chords,
          tonality,
          sub.isAnswer,
          currentBasePitch,
          isLastPhraseOfIntro,
          section.name,
          currentPreviousPitch,
          forceStrongResolution,
          isClimax,
          maxPitchBeforeChorus,
          false,
          currentMacroTarget,
          isOctaveShiftTriggered && sentenceIdx === 0 && i === 0,
          phraseSkeletonPitch
        );

        // 🌟 Voice Leading (平滑过渡与经过音)
        if (currentPreviousPitch !== null && phraseResult.notes.length > 0) {
          const firstNote = phraseResult.notes[0];
          const pitchDiff = firstNote.pitch - currentPreviousPitch;

          // 如果跨度大于小三度 (3个半音)，且中间有足够的时间空隙 (> 0.5拍)
          if (Math.abs(pitchDiff) > 3) {
            const lastNoteInSec =
              sectionMelody.length > 0
                ? sectionMelody[sectionMelody.length - 1]
                : null;
            const gapTime = lastNoteInSec
              ? firstNote.onset - (lastNoteInSec.onset + lastNoteInSec.duration)
              : 1.0;

            if (gapTime >= 0.5 && PRNGManager.next() > 0.3) {
              // 插入经过音
              const passingPitch =
                currentPreviousPitch + Math.round(pitchDiff / 2);
              // 确保经过音在音阶内
              const safeScalePcs = HarmonyCore.getScalePitches(tonality).map(p => p % 12);
              let bestPassingPitch = passingPitch;
              let minDiff = 100;
              for (let oct = -1; oct <= 1; oct++) {
                for (const pc of safeScalePcs) {
                  const p = pc + (Math.floor(passingPitch / 12) + oct) * 12;
                  const diff = Math.abs(p - passingPitch);
                  if (diff < minDiff) {
                    minDiff = diff;
                    bestPassingPitch = p;
                  }
                }
              }

              const passingOnset = firstNote.onset - 0.25;
              sectionMelody.push({
                pitch: bestPassingPitch,
                onset: passingOnset,
                duration: 0.25,
                velocity: firstNote.velocity * 0.8,
              });
            }
          }
        }

        currentPreviousPitch = phraseResult.lastPitch;
        const phraseNotes = phraseResult.notes;

        if (isOutro) {
          const fadeOutFactor = 1.0 - (sentenceIdx / totalSentences) * 0.6;
          phraseNotes.forEach((n) => (n.velocity *= fadeOutFactor));
        }

        // Mood 调制：力度 + 时值 + 叹息感后处理
        this.applyMoodArticulation(phraseNotes, moodId);

        sectionMelody.push(...phraseNotes);
        currentPhraseStart += sub.lengthBeats;
      }
    }

    if (generateMotifsOnly) {
      return {
        notes: [],
        motifs,
        lastPitch: null,
        unresolvedCount: consecutiveUnresolved,
      };
    }

    if (section.name.includes("Chorus") && sectionMelody.length > 0) {
      let maxPitch = -1;
      sectionMelody.forEach((n) => {
        if (n.pitch > maxPitch) maxPitch = n.pitch;
      });

      const maxNotes = sectionMelody.filter((n) => n.pitch === maxPitch);
      if (maxNotes.length > 1) {
        maxNotes.sort((a, b) => {
          const aStrong = Math.abs(a.onset % 1) < 1e-6 ? 1 : 0;
          const bStrong = Math.abs(b.onset % 1) < 1e-6 ? 1 : 0;
          if (aStrong !== bStrong) return bStrong - aStrong;
          return b.duration - a.duration;
        });

        const goldenNote = maxNotes[0];

        sectionMelody.forEach((n) => {
          if (n.pitch === maxPitch && n !== goldenNote) {
            const activeChord =
              chords.find(
                (c) => n.onset >= c.startBeat && n.onset < c.endBeat,
              ) || chords[0];
            const safeScalePcs = HarmonyCore.getSafeScalePitches(
              activeChord,
              tonality,
            );
            n.pitch = HarmonyCore.shiftDiatonic(n.pitch, safeScalePcs, -1);
          }
        });

        goldenNote.velocity = Math.min(1.0, goldenNote.velocity * 1.2);
        goldenNote.duration = Math.max(goldenNote.duration, 1.0);
      }
    }

    const humanizedMelody = sectionMelody;
    return {
      notes: humanizedMelody,
      motifs,
      lastPitch: currentPreviousPitch,
      unresolvedCount: consecutiveUnresolved,
    };
  }

  // 🌟 核心升级 2 实现：基于分形理论 (Fractal Rhythm) 生成具体节奏点
  private static generateMotifRhythm(
    groove: number[],
    targetNoteCount: number,
    phraseLengthBeats: number,
    sectionDensity: number,
    isFirstPhraseOfSection: boolean,
    context?: MusicContext,
    section?: SectionMetadata,
  ): { pickup: number[]; body: number[]; tail: number[] } {
    const energyLevel = section?.energyLevel || 5;
    // 优先段落级 mood（叙事弧线），回退全曲 mood
    const moodId = section?.moodOverride ?? context?.moodId ?? MoodId.Neutral;
    const mood = MoodRegistry[moodId] || MoodRegistry[MoodId.Neutral];

    let sparsityScore = 0;
    if (context?.ensemble) {
      sparsityScore =
        (context.ensemble.drumSound ? 0 : 0.5) +
        (context.ensemble.bassSound ? 0 : 0.5);
    }
    // sectionDensity 已在 StructureEngine 中乘过 mood.densityMultiplier，这里不再重复
    // 仅应用乐器稀疏度惩罚
    const finalDensity = sectionDensity * (1.0 - 0.5 * sparsityScore);
    // Mood 调制切分概率：Melancholic 更少切分（更平稳），Energetic 更多
    const baseSyncopation = energyLevel >= 7 ? 0.4 : 0.2;
    const syncopation = moodId === MoodId.Melancholic ? baseSyncopation * 0.5
      : moodId === MoodId.Chill ? baseSyncopation * 0.7
      : moodId === MoodId.Aggressive ? baseSyncopation * 1.5
      : baseSyncopation;

    // 1. 分形细分 (Fractal Subdivision)
    let currentGrid = [phraseLengthBeats];
    const maxDepth = Math.max(1, Math.floor(Math.log2(phraseLengthBeats / 0.25)));
    
    for (let depth = 0; depth < maxDepth; depth++) {
      let nextGrid: number[] = [];
      for (let i = 0; i < currentGrid.length; i++) {
        let noteLen = currentGrid[i];
        
        // 只有当音符长度大于最小粒度，且满足密度概率时才继续细分
        if (noteLen > 0.25 && PRNGManager.next() < finalDensity) {
          const rand = PRNGManager.next();
          if (noteLen >= 1.0 && rand < syncopation * 0.5) {
            // 附点细分 (Dotted: 3/4 + 1/4)
            nextGrid.push(noteLen * 0.75, noteLen * 0.25);
          } else if (noteLen >= 1.0 && rand < syncopation) {
            // 反向附点细分 (Reverse Dotted: 1/4 + 3/4)
            nextGrid.push(noteLen * 0.25, noteLen * 0.75);
          } else if (noteLen >= 1.0 && rand < syncopation + 0.1) {
            // 切分细分 (Syncopated: 1/4 + 1/2 + 1/4)
            nextGrid.push(noteLen * 0.25, noteLen * 0.5, noteLen * 0.25);
          } else {
            // 均匀细分 (Even: 1/2 + 1/2)
            nextGrid.push(noteLen / 2.0, noteLen / 2.0);
          }
        } else {
          nextGrid.push(noteLen);
        }
      }
      currentGrid = nextGrid;
    }
    
    // 2. 节奏合并 (Rhythmic Merging / Tie) 制造切分
    let finalSeed: number[] = [];
    for (let i = 0; i < currentGrid.length; i++) {
      if (i < currentGrid.length - 1 && PRNGManager.next() < syncopation * 0.8) {
        finalSeed.push(currentGrid[i] + currentGrid[i+1]);
        i++; // 跳过下一个音符
      } else {
        finalSeed.push(currentGrid[i]);
      }
    }
    
    // 3. 呼吸空间 (Breathing Room) — Mood 调制
    // Melancholic/Chill：更多呼吸（叹息感），Energetic/Aggressive：更紧密
    const baseBreathingProb = context?.style?.melody?.breathingRoomProbability ?? 0.2;
    const moodBreathingBoost = moodId === MoodId.Melancholic ? 0.4
      : moodId === MoodId.Chill ? 0.3
      : moodId === MoodId.Aggressive ? -0.1
      : moodId === MoodId.Energetic ? -0.05
      : 0;
    const breathingProb = Math.max(0, Math.min(0.9, baseBreathingProb + moodBreathingBoost));
    const breathingRoom = PRNGManager.next() < breathingProb ? (energyLevel >= 7 ? 0.5 : 1.5) : 0;
    const maxBeats = Math.max(1.0, phraseLengthBeats - breathingRoom);
    
    // 4. 映射到时间轴 (Onset Mapping)
    let interference: number[] = [];
    let currentOnset = 0;
    for (let dur of finalSeed) {
      if (currentOnset < maxBeats) {
        interference.push(currentOnset);
      }
      currentOnset += dur;
    }

    // 5. 音符数量裁剪 (Note Count Trimming) - 已移除
    // 之前这里会随机删掉中间的音符来强行匹配 targetNoteCount，导致旋律支离破碎、不连贯。
    // 现在完全由分形节奏 (Fractal Rhythm) 自然决定音符密度。

    // 6. 结构化拆分 (Pickup, Body, Tail)
    const pickup: number[] = [];
    const body: number[] = [];
    const tail: number[] = [];

    let bodyStartIdx = 0;
    if (
      interference.length > 2 &&
      interference[0] < 1.0 &&
      PRNGManager.next() > 0.5
    ) {
      pickup.push(interference[0]);
      if (interference[1] < 1.0 && PRNGManager.next() > 0.5) {
        pickup.push(interference[1]);
        bodyStartIdx = 2;
      } else {
        bodyStartIdx = 1;
      }
    }

    let bodyEndIdx = interference.length - 1;
    if (interference.length > bodyStartIdx + 1 && PRNGManager.next() > 0.3) {
      tail.push(interference[interference.length - 1]);
      bodyEndIdx = interference.length - 2;
    }

    for (let i = bodyStartIdx; i <= bodyEndIdx; i++) {
      body.push(interference[i]);
    }

    // 首句处理：移除弱起，确保强拍进入
    if (isFirstPhraseOfSection) {
      if (pickup.length > 0) pickup.length = 0;
      if (body.length > 0 && body[0] < 1.0) {
        body.shift();
      }
      if (body.length === 0) body.push(1.0); // 兜底
    }

    return { pickup, body, tail };
  }

  // 🌟 核心升级 4 & 5 实现：结合和弦、线型、起承转合生成音高
  private static realizeMotif(
    template: MotifTemplate,
    phraseStart: number,
    chords: GeneratedChord[],
    tonality: Tonality,
    isAnswer: boolean,
    basePitch: number,
    isLastPhraseOfIntro: boolean = false,
    sectionName: string = "",
    incomingPreviousPitch: number | null = null,
    forceStrongResolution: boolean = false,
    isClimax: boolean = false,
    maxPitchBeforeChorus: number = 0,
    isUserMotif: boolean = false,
    macroTargetDegree?: number,
    isOctaveShiftTriggered: boolean = false,
    skeletonPitch?: number // 骨架音：如果提供，用作该乐句的引力锚点
  ): { notes: NoteData[]; lastPitch: number | null } {
    const notes: NoteData[] = [];
    let targetCenter = basePitch;

    if (isClimax && maxPitchBeforeChorus > 0) {
      const targetClimaxPitch = Math.min(maxPitchBeforeChorus + (PRNGManager.next() > 0.5 ? 3 : 5), 70); // 不超过 Bb4
      if (targetCenter < targetClimaxPitch - 5) {
        targetCenter = targetClimaxPitch - 5;
      }
    }

    const { rhythmOffsets, contour } = template;
    const totalNotes = rhythmOffsets.length;
    if (totalNotes === 0) return { notes: [], lastPitch: incomingPreviousPitch };

    // 1. Generate Envelope Curve based on contour
    const envelopeCurve: number[] = [];
    for (let i = 0; i < totalNotes; i++) {
        let progress = totalNotes > 1 ? i / (totalNotes - 1) : 0;
        let val = 0;
        switch (contour) {
            case "Ascending": val = progress; break;
            case "Descending": val = 1.0 - progress; break;
            case "Arch": val = Math.sin(progress * Math.PI); break;
            case "Bowl": val = -Math.sin(progress * Math.PI); break;
            case "Static": val = 0; break;
            case "Wandering": val = PRNGManager.next() * 2 - 1; break;
            default: val = 0; break;
        }
        envelopeCurve.push(val);
    }

    // 2. Determine Target Anchor（骨架音优先）
    const lastOnset = phraseStart + rhythmOffsets[totalNotes - 1];
    const lastChord = chords.find((c) => lastOnset >= c.startBeat && lastOnset < c.endBeat) || chords[chords.length - 1];
    const lastChordTones = HarmonyCore.getChordTones(lastChord, targetCenter);

    let targetAnchor = targetCenter;
    if (skeletonPitch !== undefined) {
        // 🌟 骨架优先：有骨架音时直接用它做锚点（不再随机选和弦音）
        targetAnchor = this.getNearestOctave(skeletonPitch, targetCenter);
        // 消耗 PRNG 保持序列对齐（原来这里有 2 次 next()）
        PRNGManager.next(); PRNGManager.next();
    } else if (isAnswer || forceStrongResolution) {
        targetAnchor = lastChordTones[0]; // Root
        if (PRNGManager.next() > 0.5 && lastChordTones.length > 1) {
            targetAnchor = lastChordTones[1]; // Third
        }
    } else {
        targetAnchor = lastChordTones.length > 2 ? lastChordTones[2] : lastChordTones[0]; // Fifth
        if (PRNGManager.next() > 0.5 && lastChordTones.length > 3) {
            targetAnchor = lastChordTones[3]; // Seventh
        }
    }
    if (skeletonPitch === undefined) {
        targetAnchor = this.getNearestOctave(targetAnchor, targetCenter);
    }

    // 3. Gravity Pitch Engine
    let currentPitch = incomingPreviousPitch !== null ? incomingPreviousPitch : targetCenter;
    let rawMelody: number[] = [];

    for (let i = 0; i < totalNotes; i++) {
        const onset = phraseStart + rhythmOffsets[i];
        let duration = i < totalNotes - 1 ? rhythmOffsets[i + 1] - rhythmOffsets[i] : (isAnswer ? 2.0 : 1.0);
        
        // Quantize duration — 偏向较长值（避免截断尾音）
        const validDurations = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0];
        let closestDuration = validDurations[0];
        for (const vd of validDurations) {
            if (vd >= duration * 0.85) { closestDuration = vd; break; } // 选 ≥ 85% 的最小合法值
            closestDuration = vd;
        }
        duration = closestDuration;

        let progress = totalNotes > 1 ? i / (totalNotes - 1) : 0;

        if (i === totalNotes - 1) {
            // 钳制最终锚点音高
            while (targetAnchor > 76) targetAnchor -= 12;
            while (targetAnchor < 43) targetAnchor += 12;
            rawMelody.push(targetAnchor);
            notes.push({ pitch: targetAnchor, onset, duration, velocity: 80 });
            break;
        }

        const activeChord = chords.find((c) => onset >= c.startBeat && onset < c.endBeat) || chords[0];
        const safeScalePcs = HarmonyCore.getSafeScalePitches(activeChord, tonality);
        
        let candidates: number[] = [];
        for (let oct = -1; oct <= 1; oct++) {
            for (let pc of safeScalePcs) {
                candidates.push(pc + (Math.floor(targetCenter / 12) + oct) * 12);
            }
        }

        if (i === 0 && isOctaveShiftTriggered) {
            // Force the first note to be Root or Fifth for maximum impact after an octave shift
            const rootPc = activeChord.root % 12;
            const fifthPc = (rootPc + 7) % 12;
            candidates = candidates.filter(c => c % 12 === rootPc || c % 12 === fifthPc);
            if (candidates.length === 0) {
                candidates = [targetCenter, targetCenter + 7]; // Fallback
            }
        }

        let idealMacroPitch = targetCenter + (envelopeCurve[i] * 12); // range of 1 octave

        let bestPitch = currentPitch;
        let highestScore = -9999;

        // 物理向量参数
        const timeToTarget = 1.0 - progress; // 距离目标的剩余时间比例 (1.0 -> 0.0)
        const gravityStrength = Math.pow(progress, 2) * 5.0; // 引力随时间呈指数增长
        const elasticity = 1.5; // 包络线弹性系数
        const momentumWeight = 1.0; // 惯性权重

        // 计算当前动量 (Momentum)
        let currentMomentum = 0;
        if (rawMelody.length >= 2) {
            currentMomentum = rawMelody[rawMelody.length - 1] - rawMelody[rawMelody.length - 2];
        } else if (rawMelody.length === 1 && incomingPreviousPitch !== null) {
            currentMomentum = rawMelody[0] - incomingPreviousPitch;
        }

        for (let candidate of candidates) {
            let score = 0;

            // 1. 弹性势能 (Elasticity): 拟合宏观包络线
            score -= Math.abs(candidate - idealMacroPitch) * elasticity;

            // 2. 引力势能 (Gravity): 被目标锚点吸引
            // 距离目标越近，引力越强
            score -= Math.abs(candidate - targetAnchor) * gravityStrength;

            // 3. 动能/惯性 (Momentum): 保持运动趋势
            let proposedJump = candidate - currentPitch;
            if (currentMomentum !== 0) {
                // 如果方向一致，给予奖励；如果方向相反，给予惩罚 (除非是为了解决大跳)
                if (Math.sign(proposedJump) === Math.sign(currentMomentum)) {
                    score += momentumWeight;
                } else if (Math.abs(currentMomentum) >= 5) {
                    // 大跳后的反向解决 (Voice Leading Rule)
                    score += momentumWeight * 2.0; 
                } else {
                    score -= momentumWeight;
                }
            }

            // 4. 摩擦力/平滑度 (Friction): 惩罚过大的跳跃
            if (Math.abs(proposedJump) > 7) {
                score -= Math.abs(proposedJump) * 1.5; // 超过五度的大跳严惩
            } else if (Math.abs(proposedJump) > 4) {
                score -= 2.0; // 三度到五度的跳跃轻微惩罚
            }

            // 5. 磁力场 (Magnetic Field): 张力音渴望 (Tension-Tone Yearning)
            const rootPc = activeChord.root % 12;
            const intervalFromRoot = (candidate % 12 - rootPc + 12) % 12;
            
            const isStableTone = intervalFromRoot === 0 || intervalFromRoot === 4 || intervalFromRoot === 3 || intervalFromRoot === 7; // 1, b3, 3, 5
            const isTensionTone = intervalFromRoot === 2 || intervalFromRoot === 11 || intervalFromRoot === 10 || intervalFromRoot === 5 || intervalFromRoot === 9; // 9, Maj7, m7, 11, 13
            
            const isStrongBeat = (Math.abs(onset % 1) < 1e-6) || (Math.abs(onset % 0.5) < 1e-6 && duration >= 0.5);
            
            if (isAnswer || forceStrongResolution) {
                // 解决句 (Response): 渴望稳定 (Crave stability)
                if (isStableTone) {
                    score += isStrongBeat ? 5.0 : 2.0;
                } else if (isStrongBeat) {
                    score -= 4.0; // 强拍必须稳定
                }
            } else {
                // 提问句 (Call): 张力音渴望 (Tension-Tone Yearning)
                if (isTensionTone) {
                    // 鼓励在提问句使用张力音，制造悬念和物理拉扯感
                    score += isStrongBeat ? 4.5 : 2.5;
                } else if (isStableTone) {
                    // 稳定音也可以，但奖励较少，避免太平淡
                    score += isStrongBeat ? 2.0 : 1.0;
                } else if (isStrongBeat) {
                    score -= 2.0; // 强拍避开完全不和谐的音 (如 b9, #11 除非特定曲风)
                }
            }

            // 6. 随机微扰 (Thermal Noise)
            score += PRNGManager.next() * 1.5;

            if (score > highestScore) {
                highestScore = score;
                bestPitch = candidate;
            }
        }
        
        // 硬上下限：将最终音高钳制在 MIDI 43 (G2) ~ 76 (E5)
        // 超出范围时做八度折叠，保持音级不变
        while (bestPitch > 76) bestPitch -= 12;
        while (bestPitch < 43) bestPitch += 12;

        rawMelody.push(bestPitch);
        notes.push({ pitch: bestPitch, onset, duration, velocity: 80 });
        currentPitch = bestPitch;
    }

    // 4. Vocal Guardrails (Phase 3)
    const scale = HarmonyCore.getScalePitches(tonality).map(p => p % 12);
    
    let safeMelody = [rawMelody[0]];
    for (let i = 1; i < rawMelody.length; i++) {
        let prevNote = safeMelody[i - 1];
        let currentNote = rawMelody[i];

        if (i >= 2) {
            let lastInterval = prevNote - safeMelody[i - 2];
            if (Math.abs(lastInterval) >= 5) {
                let expectedDirection = Math.sign(lastInterval) * -1;
                let stepCandidates: number[] = [];
                for (let oct = -1; oct <= 1; oct++) {
                    for (let pc of scale) {
                        stepCandidates.push(pc + (Math.floor(prevNote / 12) + oct) * 12);
                    }
                }
                let bestStep = currentNote;
                let minStepDiff = 999;
                for (let c of stepCandidates) {
                    let diff = c - prevNote;
                    if (Math.sign(diff) === expectedDirection && Math.abs(diff) > 0 && Math.abs(diff) <= 4) {
                        if (Math.abs(c - currentNote) < minStepDiff) {
                            minStepDiff = Math.abs(c - currentNote);
                            bestStep = c;
                        }
                    }
                }
                if (minStepDiff !== 999) {
                    currentNote = bestStep;
                }
            }
        }

        let currentInterval = currentNote - prevNote;
        if (i >= 2 && Math.abs(currentInterval) >= 4) {
             let lastInterval = prevNote - safeMelody[i - 2];
             if (Math.sign(currentInterval) === Math.sign(lastInterval) && Math.abs(lastInterval) >= 4) {
                 const onset = phraseStart + rhythmOffsets[i];
                 const activeChord = chords.find((c) => onset >= c.startBeat && onset < c.endBeat) || chords[0];
                 const chordTones = HarmonyCore.getChordTones(activeChord, prevNote);
                 let nearest = currentNote;
                 let minDist = 999;
                 for (let ct of chordTones) {
                     if (Math.abs(ct - prevNote) < minDist) {
                         minDist = Math.abs(ct - prevNote);
                         nearest = ct;
                     }
                 }
                 currentNote = nearest;
             }
        }
        safeMelody.push(currentNote);
        notes[i].pitch = currentNote;
    }

    return { notes, lastPitch: safeMelody[safeMelody.length - 1] };
  }

  /**
   * 骨架音生成 (Chorus Skeleton)
   *
   * 在 Chorus 生成前，先规划每个 Sentence 的"目标落音"。
   * 骨架音从和弦音中选取，形成有方向感的弧线。
   * 最后一个骨架音必须是主和弦 root（解决感）。
   *
   * @returns MIDI pitch 数组，每个 sentence 一个骨架音
   */
  private static generateChorusSkeleton(
    chords: GeneratedChord[],
    totalSentences: number,
    basePitch: number,
    tensionArc: 'frontLoose' | 'frontTight' | 'symmetric'
  ): number[] {
    if (totalSentences <= 0) return [];

    const skeleton: number[] = [];
    let prevPitch = basePitch;

    for (let s = 0; s < totalSentences; s++) {
      // 从和弦中选取骨架音
      const progress = totalSentences > 1 ? s / (totalSentences - 1) : 0;
      // 找到当前 sentence 对应的和弦（按比例分配）
      const chordIdx = Math.min(Math.floor(progress * chords.length), chords.length - 1);
      const chord = chords[chordIdx];
      const chordTones = HarmonyCore.getChordTones(chord, basePitch);

      let targetPitch: number;

      if (s === totalSentences - 1) {
        // 最后一个骨架音：必须是根音（解决感）
        targetPitch = chordTones[0];
      } else {
        // 根据张力弧线选择音：
        // frontLoose: 前半选低/稳定音，后半选高/张力音
        // frontTight: 前半选高音，后半选低/稳定音
        // symmetric: 中间选高音，两端选稳定音
        let tensionLevel: number;
        if (tensionArc === 'frontLoose') {
          tensionLevel = progress; // 0→1 递增
        } else if (tensionArc === 'frontTight') {
          tensionLevel = 1 - progress; // 1→0 递减
        } else {
          tensionLevel = Math.sin(progress * Math.PI); // 拱形
        }

        // 低张力→root/5th，高张力→3rd/7th
        if (tensionLevel < 0.3) {
          targetPitch = chordTones[0]; // Root
        } else if (tensionLevel < 0.6) {
          targetPitch = chordTones.length > 2 ? chordTones[2] : chordTones[0]; // 5th
        } else {
          targetPitch = chordTones.length > 1 ? chordTones[1] : chordTones[0]; // 3rd
          if (chordTones.length > 3 && PRNGManager.next() < 0.3) {
            targetPitch = chordTones[3]; // 7th（偶尔，增加色彩）
          }
        }
      }

      // 保持在合理音域，且与前一个骨架音级进（≤7 半音）
      targetPitch = this.getNearestOctave(targetPitch, prevPitch);
      while (targetPitch > 76) targetPitch -= 12;
      while (targetPitch < 48) targetPitch += 12;
      // 如果跳太远，折叠八度靠近
      if (Math.abs(targetPitch - prevPitch) > 7 && s > 0) {
        if (targetPitch > prevPitch) targetPitch -= 12;
        else targetPitch += 12;
        while (targetPitch > 76) targetPitch -= 12;
        while (targetPitch < 48) targetPitch += 12;
      }

      skeleton.push(targetPitch);
      prevPitch = targetPitch;
    }

    return skeleton;
  }

  /**
   * 从骨架音提取音程序列（用于 Verse 动机继承）
   * @returns 相邻骨架音的半音差数组（如 [+3, -2, +5]）
   */
  private static extractSkeletonIntervals(skeleton: number[]): number[] {
    const intervals: number[] = [];
    for (let i = 1; i < skeleton.length; i++) {
      intervals.push(skeleton[i] - skeleton[i - 1]);
    }
    return intervals;
  }

  private static getNearestOctave(pc: number, target: number): number {
    const octave = Math.floor(target / 12);
    let pitch = (pc % 12) + octave * 12;
    if (Math.abs(pitch + 12 - target) < Math.abs(pitch - target)) pitch += 12;
    if (Math.abs(pitch - 12 - target) < Math.abs(pitch - target)) pitch -= 12;
    return pitch;
  }

  /**
   * Mood 驱动的旋律演绎调制 (Mood-Driven Articulation)
   *
   * 同一条旋律线在不同 Mood 下听起来完全不同：
   * - Melancholic: 长音 + 弱力度 + 淡出尾音（叹息感）
   * - Chill: 中等延长 + 柔和力度
   * - Energetic: 短促 + 强力度
   * - Aggressive: 更短 + 更强 + 重音加倍
   * - Euphoric: 稍长 + 明亮力度
   *
   * max ~50 notes 输入 (C-4 compliance)
   */
  private static applyMoodArticulation(notes: NoteData[], moodId: MoodId): void {
    if (notes.length === 0 || moodId === MoodId.Neutral) return;

    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const isLast = i === notes.length - 1;
      const isLongNote = n.duration >= 1.0;

      switch (moodId) {
        case MoodId.Melancholic: {
          // 力度整体降低，长音更柔
          n.velocity *= isLongNote ? 0.75 : 0.85;
          // 时值延长（叹息/延音感）
          n.duration *= 1.3;
          // 乐句末尾加 fadeOut 标记（如果支持）
          if (isLast && n.duration >= 0.5) {
            n.fadeOutDuration = n.duration * 0.4;
          }
          break;
        }
        case MoodId.Chill: {
          n.velocity *= 0.88;
          n.duration *= 1.15;
          break;
        }
        case MoodId.Energetic: {
          // 力度增加，短音更弹跳
          n.velocity *= isLongNote ? 1.05 : 1.15;
          // 时值略微缩短（紧凑感）
          n.duration *= 0.9;
          break;
        }
        case MoodId.Aggressive: {
          // 力度大幅增加
          n.velocity *= 1.2;
          // 时值缩短（断奏/攻击感）
          n.duration *= 0.8;
          break;
        }
        case MoodId.Euphoric: {
          // 明亮但不刺耳
          n.velocity *= 1.08;
          n.duration *= 1.05;
          break;
        }
      }

      // Clamp
      n.velocity = Math.max(1, Math.min(127, n.velocity));
      n.duration = Math.max(0.1, n.duration);
    }
  }
}
