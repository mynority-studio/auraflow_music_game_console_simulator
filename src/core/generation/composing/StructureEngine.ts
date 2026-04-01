import { PRNGManager } from '../../utils/PRNG';
import { SectionMetadata, StyleConfig } from "../types";
import { StyleId } from '../config/StyleFlags';

export class StructureEngine {
  public static generateFullSongStructure(timeSignature: [number, number], bpm: number, style: StyleConfig): SectionMetadata[] {
    const sections: SectionMetadata[] =[];
    let currentBeat = 0;
    const beatsPerBar = timeSignature[0];
    const styleId = style.id;

    const addSection = (name: string, bars: number, energy: number) => {
      // 🌟 临时屏蔽所有前奏，方便调试 (Temporarily disable all intros for debugging)
      if (name.startsWith("Intro")) {
        return;
      }

      // 🌟 Phase 1 & 2: Initialize decoupled state for each section
      const type = name.split('_')[0]; // e.g. "Verse", "Chorus"
      
      // Determine phrase template based on length
      let phraseTemplate = "A-B";
      if (bars === 8) phraseTemplate = "A-A-B-A'";
      else if (bars === 16) phraseTemplate = "A-A-B-A'-C-C-D-C'";
      else if (bars === 4) phraseTemplate = "A-B";

      // Base groove density scales with energy
      const density = Math.min(1.0, Math.max(0.1, (energy / 10) * 0.8 + 0.2));
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
          const possibleOverrides = [StyleId.BossaNova, StyleId.NeoSoul, StyleId.SmoothJazz, StyleId.Synthwave];
          // Pick an override that is DIFFERENT from the current style
          const filteredOverrides = possibleOverrides.filter(s => s !== styleId);
          if (filteredOverrides.length > 0) {
              localStyleOverride = filteredOverrides[Math.floor(PRNGManager.next() * filteredOverrides.length)];
              // console.log(`[StructureEngine] 🌪️ Genre-Bending Triggered! Section ${name} overridden with ${localStyleOverride}`);
          }
      }

      // 3. Fusion Profile (Music Fusion Refinement)
      let fusionProfile = undefined;
      // 40% chance to apply a fusion profile if not already overridden
      if (!localStyleOverride && PRNGManager.next() < 0.4) {
          const possibleFusions = [StyleId.SmoothJazz, StyleId.BossaNova, StyleId.PopRock, StyleId.Eurodance, StyleId.NeoSoul];
          const filteredFusions = possibleFusions.filter(s => s !== styleId);
          if (filteredFusions.length > 0) {
              const fusionStyle = filteredFusions[Math.floor(PRNGManager.next() * filteredFusions.length)];
              // Decide which roles get the fusion style (e.g., Rhythm Section vs Harmonic Section)
              const isRhythmFusion = PRNGManager.next() < 0.5;
              fusionProfile = {
                  primaryStyle: styleId,
                  fusionStyle: fusionStyle,
                  applyToDrums: isRhythmFusion,
                  applyToBass: isRhythmFusion,
                  applyToChords: !isRhythmFusion,
                  applyToMelody: !isRhythmFusion
              };
          }
      }

      // 4. Groove Mask (Rhythmic Skeleton)
      // Generate a 16-step mask for 4/4 time (16th notes)
      const grooveMask = {
          accents: Array.from({ length: 16 }, (_, i) => {
              // Strong beats (1, 2, 3, 4) have high probability
              if (i % 4 === 0) return PRNGManager.next() < 0.9 ? 1 : 0;
              // Upbeats (1 &, 2 &, 3 &, 4 &) have medium probability
              if (i % 2 === 0) return PRNGManager.next() < (syncopationProb * 0.8) ? 1 : 0;
              // 16th offbeats have lower probability, scaling with syncopation
              return PRNGManager.next() < (syncopationProb * 0.5) ? 1 : 0;
          }),
          resolution: 0.25
      };

      // 5. Texture Allocation
      const textureAllocation = {
          bassDensity: density * (isRiffDriven ? 1.2 : 1.0),
          chordDensity: density * (fusionProfile?.applyToChords ? 0.8 : 1.0),
          drumDensity: density * (fusionProfile?.applyToDrums ? 1.2 : 1.0),
          melodyDensity: density
      };

      sections.push({ 
        name, 
        startBeat: currentBeat, 
        endBeat: currentBeat + (bars * beatsPerBar), 
        energyLevel: energy,
        type,
        lengthBars: bars,
        phraseTemplate,
        localStyleOverride,
        isRiffDriven,
        fusionProfile,
        grooveMask,
        textureAllocation,
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
    const jazzStyles = [StyleId.SmoothJazz, StyleId.NeoSoul];
    const outroBars = jazzStyles.includes(styleId) ? 8 : 4; // Lo-Fi / 放松：8 小节，流行/电子：4 小节

    const addIntro = (bars: number, baseEnergy: number) => {
      if (bars >= 8) {
        addSection("Intro_A", bars / 2, Math.max(1, baseEnergy - 2));
        addSection("Intro_B", bars / 2, baseEnergy);
      } else {
        addSection("Intro", bars, baseEnergy);
      }
    };

    // 🌟 修复：结构模板池 (Structure Template Pool)
    const templates =[
      // 模板A：标准流行 (循序渐进)
      () => {
        addIntro(introBars * 2, 4);
        addSection("Verse_1", 16, 4);
        addSection("PreChorus_1", 8, 6);
        addSection("Chorus_1", 16, 8);
        addSection("Break", 8, 3);
        addSection("Verse_2", 16, 5);
        addSection("PreChorus_2", 8, 7);
        addSection("Chorus_Main", 16, 9);
        addSection("Bridge", 8, 7);
        addSection("Chorus_Epic", 16, 10);
      },
      // 模板B：副歌前置 (抓耳开局型)
      () => {
        addIntro(8, 6);
        addSection("Chorus_1", 16, 8); // 开局直接副歌！
        addSection("Verse_1", 16, 4);
        addSection("PreChorus_1", 8, 6);
        addSection("Chorus_Main", 16, 9);
        addSection("Solo_Bridge", 16, 10);
        addSection("Chorus_Epic", 16, 10);
      },
      // 模板C：短平快电音/舞曲结构
      () => {
        addIntro(introBars * 2, 4);
        addSection("Verse_1", 16, 5);
        addSection("Verse_2", 16, 6); // 连续主歌堆叠情绪
        addSection("Chorus_Main", 32, 9); // 超长副歌爽点
        addSection("Break", 8, 2); // 突然跌落
        addSection("Chorus_Epic", 16, 10);
      },
      // 模板D：连续副歌轰炸，干脆利落结尾
      () => {
        addIntro(introBars * 2, 4);
        addSection("Verse_1", 16, 5);
        addSection("PreChorus_1", 8, 7);
        addSection("Chorus_1", 16, 9);
        addSection("Chorus_Main", 16, 10);
        addSection("Chorus_Epic", 16, 10); // 连续3个Chorus
      }
    ];

    // 🌟 针对特定曲风的专属结构模板
    if (styleId === StyleId.BossaNova) {
      templates.push(
        // 模板E：Bossa Nova 专属 (开局即摇摆，无需漫长铺垫)
        () => {
          addIntro(8, 5); // 能量直接给到5，鼓组和Bass直接进
          addSection("Verse_1", 16, 6); // 主歌直接起飞
          addSection("Chorus_1", 16, 7);
          addSection("Solo_Bridge", 16, 8); // Bossa 必备的器乐 Solo 段落
          addSection("Verse_2", 16, 6);
          addSection("Chorus_Main", 16, 8);
        }
      );
    } else if (styleId === StyleId.SmoothJazz) {
      templates.push(
        // 模板F：Chill Jazzy 专属 (持续律动，不追求大起大落)
        () => {
          addSection("Intro", 8, 4); // 能量4，带鼓点进场
          addSection("Verse_1", 16, 5);
          addSection("Chorus_1", 16, 6);
          addSection("Verse_2", 16, 5);
          addSection("Solo_Bridge", 16, 7); // 爵士必备 Solo
          addSection("Chorus_Main", 16, 6);
        }
      );
    } else if (styleId === StyleId.Trance) {
      templates.push(
        // 模板G：Progressive House / EDM 专属 (The Journey)
        () => {
          addSection("Intro", 8, 2); // DJ Mix-in: 极简底鼓和踩镲
          addSection("Verse_1", 16, 4); // 加入Bass和简单琶音
          addSection("Breakdown", 16, 2); // 灵魂段落：突然抽走鼓点，只留空灵Pad和旋律
          addSection("BuildUp_1", 16, 7); // 情绪爬升：军鼓滚奏，能量线性递增
          addSection("Drop_1", 16, 10); // 高潮爆发：所有乐器火力全开，Four-on-the-floor
          addSection("Breakdown_2", 8, 3); // 再次跌落，给听众喘息
          addSection("BuildUp_2", 16, 8); // 第二次更猛烈的爬升
          addSection("Drop_2", 32, 10); // 终极高潮：超长32小节的狂欢
        }
      );
    }

    // 随机抽选一种曲式模板
    const selectedTemplate = templates[Math.floor(PRNGManager.next() * templates.length)];
    selectedTemplate();

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
