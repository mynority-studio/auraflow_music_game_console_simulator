import { PRNGManager } from '../utils/PRNG';
import { GeneratedTrack, StyleConfig, MusicContext } from "./types";
import { getStyleConfig } from "./config/styles/StyleRegistry";
import { StyleId } from "./config/StyleFlags";
import { StructureEngine } from "./composing/StructureEngine";
import { HarmonyEngine, HarmonyCore } from "./composing/HarmonyCore";
import { ToplineEngine } from "./composing/ToplineEngine";
import { GlobalContext } from "./GlobalContext";
import { EnsembleDrafter } from "./arrangement/EnsembleDrafter";
import { GenerationOptions } from "./types";

import { GlobalReviewer } from "./review/GlobalReviewer";
import { SingerPersona } from "./performance/SingerPersona";

import { MoodId, MoodRegistry } from "./config/MoodFlags";

export class MelodyEngine {

  public generateFullSong(styleId: StyleId, options: GenerationOptions = {}): { track: GeneratedTrack, context: MusicContext } {
    // 🌟 ACVE §5.1 — 模块入口快照点 B（generateFullSong 开始时的 PRNG state）
    PRNGManager.recordSnapshot('B');

    const style = getStyleConfig(styleId);
    const {
        userMotifRoot,
        processedUserMotif,
        motifRole = 'Foreground',
        detectedTimeSignature,
        detectedTonality,
        moodId
    } = options;
    
    if (!style.global) {
      console.error("Style is missing global config:", style);
      throw new Error(`Style ${styleId} is missing global config`);
    }

    // 🌟 决定 Mood
    const finalMoodId = moodId !== undefined ? moodId : (PRNGManager.next() > 0.5 ? Math.floor(PRNGManager.next() * 5) + 1 : MoodId.Neutral);
    const mood = MoodRegistry[finalMoodId as MoodId] || MoodRegistry[MoodId.Neutral];

    // 🌟 真正的随机 BPM (区间内取值)
    const minBpm = style.global.bpmRange[0];
    const maxBpm = style.global.bpmRange[1];
    const baseBpm = Math.floor(PRNGManager.next() * (maxBpm - minBpm + 1)) + minBpm;
    let bpm = Math.round(baseBpm * (mood.bpmMultiplier[0] + PRNGManager.next() * (mood.bpmMultiplier[1] - mood.bpmMultiplier[0])));
    bpm = Math.max(60, Math.min(190, bpm)); // Clamp to reasonable extremes

    // 🌟 真正的随机真实调号与 UI 映射
    // 如果外部传入了 Motif Root，则强制使用该 Root 作为歌曲的 Key
    let keyOffset = Math.floor(PRNGManager.next() * 12);
    if (userMotifRoot !== undefined) {
        keyOffset = userMotifRoot % 12;
    }
    const keyNames =["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
    const actualKey = keyNames[keyOffset];

    // 🌟 根据权重抽取绝对调式 (大调/小调)
    let tonality = style.global.tonalityPool[0].tonality;
    if (detectedTonality) {
        tonality = detectedTonality;
    } else {
        const tonalityPool = mood.tonalityBias || style.global.tonalityPool;
        const tRoll = PRNGManager.next();
        let tSum = 0;
        for (const t of tonalityPool) {
            tSum += t.weight;
            if (tRoll < tSum) { tonality = t.tonality; break; }
        }
    }

    let timeSig = style.global.timeSignaturePool[0].signature;
    if (detectedTimeSignature) {
        timeSig = detectedTimeSignature;
    } else {
        const tsRoll = PRNGManager.next();
        let tsSum = 0;
        for (const ts of style.global.timeSignaturePool) {
            tsSum += ts.weight;
            if (tsRoll < tsSum) { timeSig = ts.signature; break; }
        }
    }
    
    GlobalContext.initializeNewEra(style, bpm, keyOffset, tonality, timeSig, finalMoodId);

    // 1. 生成宏观结构
    const sections = StructureEngine.generateFullSongStructure(timeSig, bpm, style, finalMoodId);
    
    // 2. 生成全曲和声轨道 (带过渡和弦引擎)
    const chords = HarmonyEngine.generateHarmonyTimeline(sections, style, timeSig);

    // 3. 抽卡决定乐器编制与主唱性格
    const instrumentPalette = EnsembleDrafter.draft(style);

    // 🌟 Persona 选择：从 style.performance.allowedPersonas 中 PRNG 抽取
    const personaPool = style.performance?.allowedPersonas || ['neutral'];
    const personaKey = personaPool[Math.floor(PRNGManager.next() * personaPool.length)];

    const context: MusicContext = {
        keyOffset,
        tonality,
        bpm,
        timeSignature: timeSig,
        grooveDNA: [],
        moodId: finalMoodId,
        ensemble: instrumentPalette,
        style: style
    };

    // 4. 生成旋律（此时会将各段落独有的 GrooveDNA 写入 Sections）
    const toplineMotif = motifRole === 'Foreground' ? processedUserMotif : undefined;
    const leadInstrument = instrumentPalette.leadSound;
    let vocal: any[] | undefined = undefined;
    let melody: any[] = [];

    // 解析 persona：从 SingerPersona.PERSONAS 查找，'neutral' 传 null（不做后处理）
    const persona = personaKey !== 'neutral' ? (SingerPersona.PERSONAS[personaKey] || null) : null;

    if (instrumentPalette.vocalSound) {
        vocal = ToplineEngine.generateTrackMelody(
            sections, chords, style, tonality, persona, instrumentPalette.vocalSound, toplineMotif, false, context
        );
        melody = ToplineEngine.generateTrackMelody(
            sections, chords, style, tonality, persona, leadInstrument, undefined, true, context
        );
    } else {
        melody = ToplineEngine.generateTrackMelody(
            sections, chords, style, tonality, persona, leadInstrument, toplineMotif, false, context
        );
    }

    // 5. 基于旋律进行重配和弦 (Re-harmonization)
    const finalChords = HarmonyEngine.reharmonize(chords, melody, style);

    // 6. 全局检查与修复 (Global Review & Nudge)
    const reviewed = GlobalReviewer.reviewAndFix(
        vocal, melody, finalChords, style, tonality
    );

    const track: GeneratedTrack = {
      chords: reviewed.chords, melody: reviewed.melody, vocal: reviewed.vocal, bpm, key: actualKey, keyOffset, tonality,
      timeSignature: timeSig, sections,
      blockIndex: 0, absoluteStartBeat: 0, hasIntro: true,
      preSelectedPalette: instrumentPalette,
      processedUserMotif,
      motifRole
    };

    return { track, context };
  }
}