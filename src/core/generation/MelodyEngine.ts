import { globalPRNG } from '../utils/PRNG';
import { GeneratedTrack, StyleConfig } from "./types";
import { getStyleConfig } from "./config/styles/StyleRegistry";
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
    motifExpertise?: string;
    detectedTimeSignature?: [number, number];
    detectedTonality?: 'Major' | 'Minor';
}

export class MelodyEngine {

  public generateFullSong(styleId: string, options: GenerationOptions = {}): GeneratedTrack {
    const style = getStyleConfig(styleId);
    const {
        userMotifRoot,
        processedUserMotif,
        motifRole = 'Foreground',
        motifExpertise = 'Seed',
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
    const bpm = Math.floor(globalPRNG.next() * (maxBpm - minBpm + 1)) + minBpm;

    // 🌟 真正的随机真实调号与 UI 映射
    // 如果外部传入了 Motif Root，则强制使用该 Root 作为歌曲的 Key
    let keyOffset = Math.floor(globalPRNG.next() * 12);
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
        const tRoll = globalPRNG.next();
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
        const tsRoll = globalPRNG.next();
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
    
    const personaId = style.performance.allowedPersonas[Math.floor(globalPRNG.next() * style.performance.allowedPersonas.length)];
    const persona = SingerPersona.PERSONAS[personaId];

    // 4. 生成旋律（此时会将各段落独有的 GrooveDNA 写入 Sections）
    const toplineMotif = motifRole === 'Foreground' ? processedUserMotif : undefined;
    const leadInstrument = instrumentPalette.melodySound;
    const melody = ToplineEngine.generateTrackMelody(
      sections, chords, style, tonality, persona, leadInstrument, toplineMotif
    );

    // 5. 基于旋律进行重配和弦 (Re-harmonization)
    const finalChords = HarmonyEngine.reharmonize(chords, melody, style);

    return {
      chords: finalChords, melody, bpm, key: actualKey, keyOffset, tonality,
      timeSignature: timeSig, sections,
      blockIndex: 0, absoluteStartBeat: 0, hasIntro: true,
      preSelectedPalette: instrumentPalette,
      processedUserMotif,
      motifRole,
      motifExpertise
    } as any;
  }
}