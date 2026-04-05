import { PRNGManager } from '../../utils/PRNG';
import { SectionMetadata, SectionType, GenerationParams } from "../types";
import { MoodId, MoodRegistry } from "../config/MoodFlags";

// T-1 合规：将段落名称前缀映射为 SectionType 枚举值
const SECTION_TYPE_MAP: Record<string, SectionType> = {
    'Intro': SectionType.Intro,
    'Verse': SectionType.Verse,
    'PreChorus': SectionType.PreChorus,
    'Chorus': SectionType.Chorus,
    'Bridge': SectionType.Bridge,
    'Outro': SectionType.Outro,
    'Break': SectionType.Break,
    'Breakdown': SectionType.Breakdown,
    'BuildUp': SectionType.BuildUp,
    'Drop': SectionType.Drop,
    'PreOutro': SectionType.PreOutro,
    'Solo': SectionType.Solo_Bridge,
};

function parseSectionType(name: string): SectionType {
    const prefix = name.split('_')[0];
    return SECTION_TYPE_MAP[prefix] ?? SectionType.Verse;
}

export class StructureEngine {
  public static generateFullSongStructure(timeSignature: [number, number], bpm: number, params: GenerationParams, moodId: MoodId = MoodId.Neutral): SectionMetadata[] {
    const sections: SectionMetadata[] =[];
    let currentBeat = 0;
    const beatsPerBar = timeSignature[0];
    const mood = MoodRegistry[moodId] || MoodRegistry[MoodId.Neutral];

    const addSection = (name: string, bars: number, rawEnergy: number) => {
      // Apply Mood Energy Cap
      const energy = Math.max(mood.energyCap[0], Math.min(mood.energyCap[1], rawEnergy));

      // 🌟 Phase 1 & 2: Initialize decoupled state for each section
      const type = parseSectionType(name);
      
      // Base groove density scales with energy, then modified by Mood
      let density = Math.min(1.0, Math.max(0.1, (energy / 10) * 0.8 + 0.2));
      density = Math.min(1.0, density * mood.densityMultiplier);
      const syncopationProb = params.rhythm.syncopationWeight || 0.5;

      // --- Riff-Driven Logic ---
      let isRiffDriven: boolean | undefined = undefined;

      // Use configured probability, default to 0 if not set
      const riffDrivenProb = params.melody.riffDrivenProbability ?? 0;
      if (PRNGManager.next() < riffDrivenProb) {
          isRiffDriven = true;
      }

      sections.push({ 
        name, 
        startBeat: currentBeat, 
        endBeat: currentBeat + (bars * beatsPerBar), 
        energyLevel: energy,
        type,
        lengthBars: bars,
        phraseTemplate: "", // Deprecated
        isRiffDriven,
        harmony: {
            baseProgression: [], // Will be filled by HarmonyEngine
            complexityProb: params.harmonyRules?.reharmProbability || 0.3,
            harmonicRhythm: 0.5
        },
        groove: {
            density,
            syncopationProb,
            swing: params.rhythm.swingRatio || 0.0
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

    const outroBars = 4;

    // 🌟 马尔可夫曲式状态机 (Markov Song Structure State Machine)
    // 动态段落长度（概率加权）
    const getDynamicLength = (state: string): number => {
      const roll = PRNGManager.next();
      if (state === 'Intro') return roll > 0.7 ? 8 : 4;
      if (state === 'Verse') return roll > 0.8 ? 8 : 16;
      if (state === 'PreChorus') return roll > 0.6 ? 4 : 8;
      if (state === 'Chorus') return roll > 0.7 ? 32 : 16;
      if (state === 'Bridge') return roll > 0.5 ? 4 : 8;
      if (state === 'Break') return roll > 0.5 ? 4 : 8;
      if (state === 'Solo') return roll > 0.5 ? 8 : 16;
      return 8;
    };

    // 宏观能量弧线模板（PRNG 选择，避免所有歌曲同一弧形）
    // 每个模板定义 [阈值, 最小能量, 能量跨度] 的分段
    // 格式：{ threshold: number, min: number, range: number }[]
    const energyCurveTemplates: Array<{ threshold: number, min: number, range: number }[]> = [
      // 模板 0：经典弧线 (Low→Mid→High→Drop→Peak) — 流行/摇滚标准叙事
      [{ threshold: 0.15, min: 2, range: 3 }, { threshold: 0.4, min: 4, range: 3 }, { threshold: 0.6, min: 7, range: 3 }, { threshold: 0.75, min: 3, range: 3 }, { threshold: 1.0, min: 8, range: 3 }],
      // 模板 1：持续攀升 (Low→Mid→High→Higher→Peak) — 史诗/电影感，无中间跌落
      [{ threshold: 0.2, min: 2, range: 2 }, { threshold: 0.4, min: 4, range: 2 }, { threshold: 0.6, min: 6, range: 2 }, { threshold: 0.8, min: 7, range: 2 }, { threshold: 1.0, min: 9, range: 2 }],
      // 模板 2：开头高能 (Mid→High→Mid→Low→High) — 抓耳开局，中段回落再爆发
      [{ threshold: 0.15, min: 5, range: 3 }, { threshold: 0.35, min: 7, range: 3 }, { threshold: 0.55, min: 4, range: 3 }, { threshold: 0.75, min: 2, range: 3 }, { threshold: 1.0, min: 8, range: 3 }],
      // 模板 3：平坦型 (Mid→Mid→Mid→Mid→High) — Chill/Lo-Fi，晚期爆发
      [{ threshold: 0.2, min: 3, range: 2 }, { threshold: 0.4, min: 4, range: 2 }, { threshold: 0.6, min: 4, range: 2 }, { threshold: 0.8, min: 5, range: 2 }, { threshold: 1.0, min: 7, range: 3 }],
    ];

    const curveIndex = Math.floor(PRNGManager.next() * energyCurveTemplates.length);
    const selectedCurve = energyCurveTemplates[curveIndex];

    const getBaseEnergy = (progress: number): number => {
      for (let z = 0; z < selectedCurve.length; z++) {
        if (progress < selectedCurve[z].threshold) {
          return selectedCurve[z].min + Math.floor(PRNGManager.next() * selectedCurve[z].range);
        }
      }
      // 最后一段兜底
      const last = selectedCurve[selectedCurve.length - 1];
      return last.min + Math.floor(PRNGManager.next() * last.range);
    };

    // 段落计数器（用于全局约束 + 命名）
    const counts: Record<string, number> = { Intro: 0, Verse: 0, PreChorus: 0, Chorus: 0, Bridge: 0, Break: 0, Solo: 0 };

    // 全局约束上限
    const maxCounts: Record<string, number> = { Verse: 3, PreChorus: 2, Chorus: 4, Bridge: 1, Break: 1, Solo: 1 };

    const targetTotalBars = 64 + Math.floor(PRNGManager.next() * 33); // 64~96 小节
    let totalBars = 0;

    // 状态机初始状态
    let currentState = 'Intro';

    while (totalBars < targetTotalBars) {
      // 段落长度
      const length = getDynamicLength(currentState);

      // 能量：基于宏观弧线 + 段落类型修正
      const progress = totalBars / targetTotalBars;
      let energy = getBaseEnergy(progress);
      // Break/Bridge 强制低能量
      if (currentState === 'Break' || currentState === 'Bridge') {
        energy = Math.min(energy, 2 + Math.floor(PRNGManager.next() * 3));
      }
      // Chorus 保底高能量
      if (currentState === 'Chorus') {
        energy = Math.max(energy, 7);
      }

      // 生成段落名称（带编号）
      counts[currentState] = (counts[currentState] || 0) + 1;
      const sectionName = counts[currentState] > 1 ? `${currentState}_${counts[currentState]}` : `${currentState}_1`;

      if (currentState === 'Intro') {
        // Intro 特殊处理：可能拆分为 A/B
        if (length >= 8) {
          addSection("Intro_A", length / 2, Math.max(1, energy - 2));
          addSection("Intro_B", length / 2, energy);
        } else {
          addSection("Intro", length, energy);
        }
      } else {
        addSection(sectionName, length, energy);
      }
      totalBars += length;

      // 马尔可夫状态转移（带全局约束守卫）
      const roll = PRNGManager.next();
      const canVerse = (counts['Verse'] || 0) < maxCounts['Verse'];
      const canChorus = (counts['Chorus'] || 0) < maxCounts['Chorus'];
      const canBridge = (counts['Bridge'] || 0) < maxCounts['Bridge'];
      const canBreak = (counts['Break'] || 0) < maxCounts['Break'];
      const canPreChorus = (counts['PreChorus'] || 0) < maxCounts['PreChorus'];
      const canSolo = (counts['Solo'] || 0) < maxCounts['Solo'];
      const chorusCount = counts['Chorus'] || 0;
      const nearEnd = totalBars >= targetTotalBars - 20;

      switch (currentState) {
        case 'Intro':
          // 20% 概率抓耳开局直接进副歌
          currentState = (roll < 0.2 && canChorus) ? 'Chorus' : 'Verse';
          break;
        case 'Verse':
          if (roll < 0.5 && canPreChorus) currentState = 'PreChorus';
          else if (roll < 0.85 && canChorus) currentState = 'Chorus';
          else if (canVerse) currentState = 'Verse'; // 连续 Verse（堆叠情绪）
          else currentState = canChorus ? 'Chorus' : 'PreChorus';
          break;
        case 'PreChorus':
          currentState = 'Chorus'; // PreChorus 必接 Chorus
          break;
        case 'Chorus':
          if (nearEnd && chorusCount >= 2) {
            break; // 跳出 while，进入 Outro 逻辑
          } else if (roll < 0.4 && canVerse) currentState = 'Verse';
          else if (roll < 0.6 && canBridge) currentState = 'Bridge';
          else if (roll < 0.75 && canBreak) currentState = 'Break';
          else if (roll < 0.85 && canSolo) currentState = 'Solo';
          else if (canVerse) currentState = 'Verse';
          else break; // 结束
          break;
        case 'Bridge':
        case 'Break':
        case 'Solo':
          // 跌落/Solo 后必然爆发
          currentState = (roll < 0.3 && canPreChorus) ? 'PreChorus' : 'Chorus';
          break;
        default:
          break;
      }

      // 如果 Chorus 已达上限且接近结尾，强制结束
      if (nearEnd && chorusCount >= 2 && currentState === 'Chorus' && !canChorus) {
        break;
      }
    }

    // 确保至少有 2 个 Chorus（全局约束）
    if ((counts['Chorus'] || 0) < 2) {
      addSection("Chorus_Epic", 16, 10);
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
