import { PRNGManager } from '../../utils/PRNG';
import { SectionMetadata, StyleConfig, SectionType as SectionTypeEnum } from "../types";
import { StyleId } from '../config/StyleFlags';
import { MoodId, MoodRegistry } from "../config/MoodFlags";

/**
 * 从段落名称解析出 SectionType 数值枚举。
 * 注意：检查顺序很重要 — PreChorus 必须在 Chorus 之前，Breakdown 必须在 Break 之前，
 * PreOutro 必须在 Outro 之前，Solo_Bridge 中的 Solo 必须在 Bridge 之前。
 */
function parseSectionType(name: string): SectionTypeEnum {
    if (name.includes('Intro')) return SectionTypeEnum.Intro;
    if (name.includes('PreChorus') || name.includes('Pre-Chorus') || name.includes('Pre_Chorus')) return SectionTypeEnum.PreChorus;
    if (name.includes('Chorus') || name.includes('Drop')) return SectionTypeEnum.Chorus;
    if (name.includes('Verse')) return SectionTypeEnum.Verse;
    if (name.includes('Solo')) return SectionTypeEnum.Solo_Bridge;
    if (name.includes('Breakdown')) return SectionTypeEnum.Breakdown;
    if (name.includes('BuildUp') || name.includes('Build')) return SectionTypeEnum.BuildUp;
    if (name.includes('Bridge')) return SectionTypeEnum.Bridge;
    if (name.includes('PreOutro')) return SectionTypeEnum.PreOutro;
    if (name.includes('Outro')) return SectionTypeEnum.Outro;
    if (name.includes('Break')) return SectionTypeEnum.Break;
    return SectionTypeEnum.Verse; // fallback
}

export class StructureEngine {
  public static generateFullSongStructure(timeSignature: [number, number], bpm: number, style: StyleConfig, moodId: MoodId = MoodId.Neutral): SectionMetadata[] {
    const sections: SectionMetadata[] =[];
    let currentBeat = 0;
    const beatsPerBar = timeSignature[0];
    const styleId = style.id;
    const mood = MoodRegistry[moodId] || MoodRegistry[MoodId.Neutral];

    const addSection = (name: string, bars: number, rawEnergy: number) => {
      // Apply Mood Energy Cap
      const energy = Math.max(mood.energyCap[0], Math.min(mood.energyCap[1], rawEnergy));

      // 🌟 Phase 1 & 2: Initialize decoupled state for each section
      const type = name.split('_')[0]; // e.g. "Verse", "Chorus"
      
      // Base groove density scales with energy, then modified by Mood
      let density = Math.min(1.0, Math.max(0.1, (energy / 10) * 0.8 + 0.2));
      density = Math.min(1.0, density * mood.densityMultiplier);
      const syncopationProb = style.rhythm.syncopationWeight || 0.5;

      // --- Phase 3 & 4: Genre-Bending & Riff-Driven Logic ---
      let localStyleOverride: StyleId | undefined = undefined;
      let isRiffDriven: boolean | undefined = undefined;

      // 1. Riff-Driven Logic (Option A)
      // Use configured probability, default to 0 if not set
      const riffDrivenProb = style.melody.riffDrivenProbability ?? 0;
      if (PRNGManager.next() < riffDrivenProb) {
          isRiffDriven = true;
      }

      // 2. Genre-Bending Logic (Option B)
      // Occasionally inject a different style into PreChorus or Bridge
      const genreBendingProb = style.harmonyRules?.genreBendingProbability ?? 0;
      if ((type === 'PreChorus' || type === 'Bridge' || type === 'Break') && PRNGManager.next() < genreBendingProb) {
          const possibleOverrides = style.harmonyRules?.genreBendingOverrides ?? [];
          // Pick an override that is DIFFERENT from the current style
          const filteredOverrides = possibleOverrides.filter(s => s !== styleId);
          if (filteredOverrides.length > 0) {
              localStyleOverride = filteredOverrides[Math.floor(PRNGManager.next() * filteredOverrides.length)];
              // console.log(`[StructureEngine] 🌪️ Genre-Bending Triggered! Section ${name} overridden with ${localStyleOverride}`);
          }
      }

      sections.push({
        name,
        startBeat: currentBeat,
        endBeat: currentBeat + (bars * beatsPerBar),
        energyLevel: energy,
        sectionType: parseSectionType(name),
        type,
        lengthBars: bars,
        phraseTemplate: "", // Deprecated
        localStyleOverride,
        isRiffDriven,
        harmony: {
            baseProgression: [], // Will be filled by HarmonyEngine
            complexityProb: style.harmonyRules?.reharmProbability || 0.3,
            harmonicRhythm: 0.5
        },
        groove: {
            density,
            syncopationProb,
            swing: style.rhythm.swingRatio || 0.0
        },
        tracks: [
            {
                id: "trk_drums",
                instrument: "drum_kit",
                role: "beat_foundation",
                activeEnergyThreshold: 3,
                behavior: { kickComplexity: density, hihatDensity: density }
            },
            {
                id: "trk_bass",
                instrument: "bass",
                role: "groove_follower",
                activeEnergyThreshold: 4,
                behavior: { lockToKickProb: 0.85, melodicFillProb: 0.15 }
            },
            {
                id: "trk_keys",
                instrument: "keys",
                role: "chord_comping",
                activeEnergyThreshold: 0,
                behavior: { grooveAdherence: 0.8, voiceLeadingStrictness: 0.9, arpeggiateProb: 0.3 }
            }
        ]
      });
      currentBeat += bars * beatsPerBar;
    };

    const introBars = bpm < 90 ? 8 : 4;
    const outroBars = 4; // Lo-Fi / 放松：8 小节，流行/电子：4 小节

    const addIntro = (bars: number, baseEnergy: number) => {
      if (bars >= 8) {
        addSection("Intro_A", bars / 2, Math.max(1, baseEnergy - 2));
        addSection("Intro_B", bars / 2, baseEnergy);
      } else {
        addSection("Intro", bars, baseEnergy);
      }
    };

    // 🌟 动态马尔可夫曲式状态机 (Markov Chain Structure State Machine)
    // 定义可能的状态
    type SectionType = 'Intro' | 'Verse' | 'PreChorus' | 'Chorus' | 'Bridge' | 'Break' | 'BuildUp' | 'Drop' | 'Outro';
    
    // 状态转移矩阵 (State Transition Matrix)
    // 格式: { 当前状态: { 下一个状态: 概率权重 } }
    const transitionMatrix: Record<SectionType, Partial<Record<SectionType, number>>> = {
        'Intro': { 'Verse': 0.7, 'Chorus': 0.3 }, // 70% 进主歌，30% 副歌前置
        'Verse': { 'Verse': 0.2, 'PreChorus': 0.5, 'Chorus': 0.3 }, // 主歌后可能接主歌、预副歌或直接副歌
        'PreChorus': { 'Chorus': 0.8, 'Drop': 0.2 }, // 预副歌绝大部分接副歌，少数接 Drop
        'Chorus': { 'Verse': 0.4, 'Break': 0.2, 'Bridge': 0.2, 'Chorus': 0.1, 'Outro': 0.1 }, // 副歌后的走向最丰富
        'Bridge': { 'Chorus': 0.7, 'BuildUp': 0.3 }, // 桥段后通常回副歌推向高潮
        'Break': { 'Verse': 0.5, 'BuildUp': 0.5 }, // 间奏后回主歌或开始爬升
        'BuildUp': { 'Drop': 0.9, 'Chorus': 0.1 }, // BuildUp 后几乎总是接 Drop
        'Drop': { 'Break': 0.4, 'Verse': 0.3, 'Outro': 0.3 }, // Drop 后的能量释放
        'Outro': {} // 终点状态
    };

    // 针对特定风格调整转移矩阵
    if (style.global.structureTemplate === 'edm') {
        transitionMatrix['Intro'] = { 'Verse': 0.5, 'BuildUp': 0.5 };
        transitionMatrix['Verse'] = { 'BuildUp': 0.8, 'Break': 0.2 };
        transitionMatrix['Chorus'] = { 'Drop': 1.0 }; // EDM 中 Chorus 往往直接引出 Drop
        transitionMatrix['Break'] = { 'BuildUp': 1.0 };
    } else if (style.global.structureTemplate === 'jazz' || style.global.structureTemplate === 'bossa') {
        transitionMatrix['Chorus'] = { 'Verse': 0.4, 'Bridge': 0.4, 'Outro': 0.2 }; // 爵士更倾向于器乐 Solo (Bridge)
        transitionMatrix['Bridge'] = { 'Verse': 0.5, 'Chorus': 0.5 };
    }

    // 辅助函数：根据权重随机选择下一个状态
    const getNextState = (currentState: SectionType): SectionType => {
        const transitions = transitionMatrix[currentState];
        if (!transitions || Object.keys(transitions).length === 0) return 'Outro';

        let totalWeight = 0;
        for (const weight of Object.values(transitions)) {
            totalWeight += weight as number;
        }

        let randomValue = PRNGManager.next() * totalWeight;
        for (const [nextState, weight] of Object.entries(transitions)) {
            randomValue -= weight as number;
            if (randomValue <= 0) {
                return nextState as SectionType;
            }
        }
        return 'Outro'; // Fallback
    };

    // 辅助函数：生成段落长度 (8, 16, 32 小节)
    const getSectionLength = (type: SectionType): number => {
        const rand = PRNGManager.next();
        if (type === 'Intro' || type === 'Outro' || type === 'Break' || type === 'PreChorus') {
            return rand > 0.7 ? 16 : 8; // 通常 8 小节，偶尔 16
        } else if (type === 'Chorus' || type === 'Drop') {
            return rand > 0.8 ? 32 : 16; // 通常 16 小节，偶尔 32 (Epic)
        } else {
            return 16; // Verse, Bridge 通常 16 小节
        }
    };

    // 辅助函数：获取段落能量等级
    const getSectionEnergy = (type: SectionType, occurrence: number): number => {
        const baseEnergies: Record<SectionType, number> = {
            'Intro': 3, 'Verse': 4, 'PreChorus': 6, 'Chorus': 8, 
            'Bridge': 7, 'Break': 3, 'BuildUp': 7, 'Drop': 10, 'Outro': 2
        };
        // 随着出现次数增加，能量略微提升 (情绪递进)
        let energy = baseEnergies[type] + (occurrence * 0.5);
        return Math.min(10, Math.max(1, Math.round(energy)));
    };

    // 状态机执行
    let currentState: SectionType = 'Intro';
    const sectionCounts: Record<string, number> = {};
    let totalSections = 0;
    const MAX_SECTIONS = 10; // 防止无限循环

    while (currentState !== 'Outro' && totalSections < MAX_SECTIONS) {
        sectionCounts[currentState] = (sectionCounts[currentState] || 0) + 1;
        const occurrence = sectionCounts[currentState];
        
        const length = getSectionLength(currentState);
        const energy = getSectionEnergy(currentState, occurrence);
        
        // 构造唯一的段落名称，例如 "Verse_1", "Chorus_Main", "Chorus_Epic"
        let sectionName = `${currentState}_${occurrence}`;
        if (currentState === 'Chorus') {
            if (occurrence === 1) sectionName = "Chorus_1";
            else if (occurrence === 2) sectionName = "Chorus_Main";
            else sectionName = "Chorus_Epic";
        }

        addSection(sectionName, length, energy);
        
        currentState = getNextState(currentState);
        totalSections++;
    }

    // 🌟 根据最后一个段落的能量，决定收尾方式 (Hard Stop vs Fade Out)
    const lastSection = sections[sections.length - 1];
    const lastEnergy = lastSection ? lastSection.energyLevel : 8;
    
    // 如果能量很高(>=8)，有 50% 概率直接 Hard Stop (戛然而止)
    // 如果能量较低，则大概率走 Fade Out (循序渐进)
    const isHighEnergy = lastEnergy >= 8;
    const useHardStop = isHighEnergy ? PRNGManager.next() > 0.5 : PRNGManager.next() > 0.8;

    if (useHardStop) {
      // 方式一：戛然而止 (Hard Stop)
      // 增加 1 或 2 个小节的 Outro，标记为 hard_stop
      // 能量保持高位，但在生成引擎里会特殊处理，只在第一拍发声，然后自然延音衰减
      addSection("Outro", 2, lastEnergy);
      sections[sections.length - 1].endingType = 'hard_stop';
    } else {
      // 方式二：循序渐进 (Gradual Fade)
      // 增加一个 Bridge/PreOutro 降温，再接 Outro 彻底消散
      const bridgeEnergy = Math.max(3, Math.floor(lastEnergy * 0.6));
      addSection("PreOutro", 4, bridgeEnergy); // 能量降到 60%
      
      const finalEnergy = Math.max(1, Math.floor(bridgeEnergy * 0.5));
      addSection("Outro", outroBars, finalEnergy); // 能量降到 30%
      sections[sections.length - 1].endingType = 'fade_out';
    }

    return sections;
  }
}
