import { PRNGManager } from '../utils/PRNG';
import { GeneratedTrack, StyleConfig, MusicContext } from "./types";
import { getStyleConfig } from "./config/styles/StyleRegistry";
import { StyleId } from "./config/StyleFlags";
import { StructureEngine } from "./composing/StructureEngine";
import { HarmonyEngine, HarmonyCore } from "./composing/HarmonyCore";
import { ToplineEngine } from "./composing/ToplineEngine";
import { SingerPersona } from "./performance/SingerPersona";
import { GlobalContext } from "./GlobalContext";
import { EnsembleDrafter } from "./arrangement/EnsembleDrafter";

export interface GenerationOptions {
    userMotifRoot?: number;
    processedUserMotif?: any[];
    motifRole?: 'Foreground' | 'Middleground' | 'Background';
    detectedTimeSignature?: [number, number];
    detectedTonality?: 'Major' | 'Minor';
}

import { GlobalReviewer } from "./review/GlobalReviewer";

export class MelodyEngine {

  public generateFullSong(styleId: StyleId, options: GenerationOptions = {}): { track: GeneratedTrack, context: MusicContext } {
    // 自动记录快照
    const startState = PRNGManager.getState();
    
    const style = getStyleConfig(styleId);
    const {
        userMotifRoot,
        processedUserMotif,
        motifRole = 'Foreground',
        detectedTimeSignature,
        detectedTonality
    } = options;
    
    if (!style.global) {
      console.error("Style is missing global config:", style);
      throw new Error(`Style ${styleId} is missing global config`);
    }

    // 🌟 真正的随机 BPM (区间内取值)
    const minBpm = style.global.bpmRange[0];
    const maxBpm = style.global.bpmRange[1];
    const bpm = Math.floor(PRNGManager.next() * (maxBpm - minBpm + 1)) + minBpm;

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
        const tRoll = PRNGManager.next();
        let tSum = 0;
        for (const t of style.global.tonalityPool) {
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
    
    GlobalContext.initializeNewEra(style, bpm, keyOffset, tonality, timeSig);

    // 1. 生成宏观结构
    const sections = StructureEngine.generateFullSongStructure(timeSig, bpm, style);
    
    // 2. 生成全曲和声轨道 (带过渡和弦引擎)
    const chords = HarmonyEngine.generateHarmonyTimeline(sections, style, timeSig);

    // 3. 抽卡决定乐器编制与主唱性格
    const instrumentPalette = EnsembleDrafter.draft(style);
    
    const personaId = style.performance.allowedPersonas[Math.floor(PRNGManager.next() * style.performance.allowedPersonas.length)];
    const persona = SingerPersona.PERSONAS[personaId];

    // 4. 生成旋律（此时会将各段落独有的 GrooveDNA 写入 Sections）
    const toplineMotif = motifRole === 'Foreground' ? processedUserMotif : undefined;
    const leadInstrument = instrumentPalette.melodySound;
    let vocal: any[] | undefined = undefined;
    let melody: any[] = [];

    if (instrumentPalette.vocalSound) {
        vocal = ToplineEngine.generateTrackMelody(
            sections, chords, style, tonality, persona, instrumentPalette.vocalSound, toplineMotif
        );
        // Generate a sparser instrumental melody as accompaniment
        melody = ToplineEngine.generateTrackMelody(
            sections, chords, style, tonality, persona, leadInstrument, undefined, true
        );
    } else {
        melody = ToplineEngine.generateTrackMelody(
            sections, chords, style, tonality, persona, leadInstrument, toplineMotif
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

    const context: MusicContext = {
        keyOffset,
        tonality,
        bpm,
        timeSignature: timeSig,
        grooveDNA: [], // This will be populated per section, but keeping it here for global context if needed
        singerPersona: persona
    };

    return { track, context };
  }
}