import { PRNGManager } from '../../utils/PRNG';
import { SectionMetadata, StyleConfig, StructureTemplate, SectionType } from "../types";
import { StyleId } from '../config/StyleFlags';
import { MoodId, MoodRegistry } from "../config/MoodFlags";

/**
 * 段落密度乘数堆栈 (Density Multiplier Stack) — 单一计算入口
 *
 * 取代原本散布的三套密度系统：
 *   - style.rhythm.densityBase（风格给定的密度区间，原先未被消费）
 *   - energy（段落能量 1~10，原先用 (energy/10)*0.8+0.2 写死）
 *   - mood.densityMultiplier（情绪乘数）
 *
 * 计算公式：
 *   t = (energy - 1) / 9                           // 0..1 normalized energy
 *   baseDensity = lerp(densityBase[0], densityBase[1], t)
 *   final = clamp(baseDensity × moodMultiplier, 0..1)
 *
 * 这样三个来源以确定的乘数堆栈方式合成，调音单一可控。
 */
function computeSectionDensity(
    energyLevel: number,
    densityBase: [number, number],
    moodMultiplier: number
): number {
    const t = Math.max(0, Math.min(1, (energyLevel - 1) / 9));
    const baseDensity = densityBase[0] + t * (densityBase[1] - densityBase[0]);
    const final = baseDensity * moodMultiplier;
    return Math.min(1.0, Math.max(0.0, final));
}

/**
 * 从段落显示名（如 "Verse_1" / "PreChorus_2" / "Chorus_Main"）推断数值 SectionType。
 * 顺序敏感：更具体的前缀必须放在前面（PreChorus 在 Chorus 之前，Breakdown 在 Break 之前）。
 */
function inferSectionType(name: string): SectionType {
    if (name.startsWith('PreChorus'))  return SectionType.PreChorus;
    if (name.startsWith('PreOutro'))   return SectionType.PreOutro;
    if (name.startsWith('Solo_Bridge'))return SectionType.Solo_Bridge;
    if (name.startsWith('Breakdown'))  return SectionType.Breakdown;
    if (name.startsWith('BuildUp'))    return SectionType.BuildUp;
    if (name.startsWith('Chorus'))     return SectionType.Chorus;
    if (name.startsWith('Verse'))      return SectionType.Verse;
    if (name.startsWith('Bridge'))     return SectionType.Bridge;
    if (name.startsWith('Intro'))      return SectionType.Intro;
    if (name.startsWith('Outro'))      return SectionType.Outro;
    if (name.startsWith('Break'))      return SectionType.Break;
    if (name.startsWith('Drop'))       return SectionType.Drop;
    return SectionType.Verse;
}

// 兜底默认结构模板池（当 style.global.structureTemplates 缺失时使用）
// 4 个标准流行结构，与历史硬编码版本完全一致
const FALLBACK_STRUCTURE_TEMPLATES: StructureTemplate[] = [
  {
    id: 'standard-pop',
    introBarsMultiplier: 2,
    introBaseEnergy: 4,
    sections: [
      { name: 'Verse_1',      bars: 16, energy: 4 },
      { name: 'PreChorus_1',  bars: 8,  energy: 6 },
      { name: 'Chorus_1',     bars: 16, energy: 8 },
      { name: 'Break',        bars: 8,  energy: 3 },
      { name: 'Verse_2',      bars: 16, energy: 5 },
      { name: 'PreChorus_2',  bars: 8,  energy: 7 },
      { name: 'Chorus_Main',  bars: 16, energy: 9 },
      { name: 'Bridge',       bars: 8,  energy: 7 },
      { name: 'Chorus_Epic',  bars: 16, energy: 10 },
    ],
  },
  {
    id: 'chorus-first',
    introBarsMultiplier: 1,        // 8-bar intro 不依赖 bpm 阈值（直接 introBarsHighBpm × 2 在原版中是固定 8）
    introBaseEnergy: 6,
    sections: [
      { name: 'Chorus_1',     bars: 16, energy: 8 },
      { name: 'Verse_1',      bars: 16, energy: 4 },
      { name: 'PreChorus_1',  bars: 8,  energy: 6 },
      { name: 'Chorus_Main',  bars: 16, energy: 9 },
      { name: 'Solo_Bridge',  bars: 16, energy: 10 },
      { name: 'Chorus_Epic',  bars: 16, energy: 10 },
    ],
  },
  {
    id: 'edm-stack',
    introBarsMultiplier: 2,
    introBaseEnergy: 4,
    sections: [
      { name: 'Verse_1',      bars: 16, energy: 5 },
      { name: 'Verse_2',      bars: 16, energy: 6 },
      { name: 'Chorus_Main',  bars: 32, energy: 9 },
      { name: 'Break',        bars: 8,  energy: 2 },
      { name: 'Chorus_Epic',  bars: 16, energy: 10 },
    ],
  },
  {
    id: 'triple-chorus',
    introBarsMultiplier: 2,
    introBaseEnergy: 4,
    sections: [
      { name: 'Verse_1',      bars: 16, energy: 5 },
      { name: 'PreChorus_1',  bars: 8,  energy: 7 },
      { name: 'Chorus_1',     bars: 16, energy: 9 },
      { name: 'Chorus_Main',  bars: 16, energy: 10 },
      { name: 'Chorus_Epic',  bars: 16, energy: 10 },
    ],
  },
];

export class StructureEngine {
  public static generateFullSongStructure(timeSignature: [number, number], bpm: number, style: StyleConfig, moodId: MoodId = MoodId.Neutral): SectionMetadata[] {
    const sections: SectionMetadata[] = [];
    let currentBeat = 0;
    const beatsPerBar = timeSignature[0];
    const styleId = style.id;
    const mood = MoodRegistry[moodId] || MoodRegistry[MoodId.Neutral];

    // 🌟 BPM 驱动的前奏长度（从 style 读取，不再硬编码 90 阈值）
    const introBpmThreshold = style.global.introBarsBpmThreshold ?? 90;
    const introBarsLow = style.global.introBarsLowBpm ?? 8;
    const introBarsHigh = style.global.introBarsHighBpm ?? 4;
    const introBars = bpm < introBpmThreshold ? introBarsLow : introBarsHigh;
    const outroBars = style.global.outroBars ?? 4;

    const addSection = (name: string, bars: number, rawEnergy: number) => {
      // 🌟 临时屏蔽所有前奏，方便调试 (保留旧行为)
      if (name.startsWith("Intro")) {
        return;
      }

      // Apply Mood Energy Cap
      const energy = Math.max(mood.energyCap[0], Math.min(mood.energyCap[1], rawEnergy));

      const type = name.split('_')[0]; // e.g. "Verse", "Chorus" — 保留作为遗留显示字段
      const sectionType = inferSectionType(name); // 数值枚举，T-1 合规的对外接口

      // 🌟 密度乘数堆栈：style.densityBase × energy(1-10) × mood.densityMultiplier
      // 三套密度来源在 computeSectionDensity 内统一合成，调音单一可控
      const densityBase = style.rhythm.densityBase || [0.4, 0.6];
      const density = computeSectionDensity(energy, densityBase, mood.densityMultiplier);
      const syncopationProb = style.rhythm.syncopationWeight || 0.5;

      // --- Phase 3 & 4: Genre-Bending & Riff-Driven Logic ---
      let localStyleOverride: StyleId | undefined = undefined;
      let isRiffDriven: boolean | undefined = undefined;

      const riffDrivenProb = style.melody.riffDrivenProbability ?? 0;
      if (PRNGManager.next() < riffDrivenProb) {
          isRiffDriven = true;
      }

      const genreBendingProb = style.harmonyRules?.genreBendingProbability ?? 0;
      if ((type === 'PreChorus' || type === 'Bridge' || type === 'Break') && PRNGManager.next() < genreBendingProb) {
          const possibleOverrides = style.harmonyRules?.genreBendingOverrides ?? [];
          const filteredOverrides = possibleOverrides.filter(s => s !== styleId);
          if (filteredOverrides.length > 0) {
              localStyleOverride = filteredOverrides[Math.floor(PRNGManager.next() * filteredOverrides.length)];
          }
      }

      sections.push({
        name,
        startBeat: currentBeat,
        endBeat: currentBeat + (bars * beatsPerBar),
        energyLevel: energy,
        type,
        sectionType,
        lengthBars: bars,
        phraseTemplate: "",
        localStyleOverride,
        isRiffDriven,
        harmony: {
            baseProgression: [],
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

    const addIntro = (bars: number, baseEnergy: number) => {
      if (bars >= 8) {
        addSection("Intro_A", bars / 2, Math.max(1, baseEnergy - 2));
        addSection("Intro_B", bars / 2, baseEnergy);
      } else {
        addSection("Intro", bars, baseEnergy);
      }
    };

    // 🌟 数据驱动的结构模板池：从 style 读取，缺失时使用兜底
    const templates: StructureTemplate[] = (style.global.structureTemplates && style.global.structureTemplates.length > 0)
      ? style.global.structureTemplates
      : FALLBACK_STRUCTURE_TEMPLATES;

    // 随机抽选一种结构模板
    const selectedTemplate = templates[Math.floor(PRNGManager.next() * templates.length)];

    // 执行模板：先 intro 再 sections
    if (selectedTemplate.introBarsMultiplier && selectedTemplate.introBarsMultiplier > 0) {
      const baseEnergy = selectedTemplate.introBaseEnergy ?? 4;
      addIntro(introBars * selectedTemplate.introBarsMultiplier, baseEnergy);
    }
    for (let i = 0; i < selectedTemplate.sections.length; i++) {
      const sec = selectedTemplate.sections[i];
      addSection(sec.name, sec.bars, sec.energy);
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
