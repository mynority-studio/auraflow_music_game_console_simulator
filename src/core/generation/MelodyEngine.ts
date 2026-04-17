import { PRNGManager } from '../utils/PRNG';
import { GeneratedTrack, StyleConfig, MusicContext, NoteData, Tonality } from "./types";
import { getStyleConfig } from "./config/styles/StyleRegistry";
import { StyleId } from "./config/StyleFlags";
import { StructureEngine } from "./composing/StructureEngine";
import { HarmonyEngine, HarmonyCore } from "./composing/HarmonyCore";
import { ToplineEngine } from "./composing/ToplineEngine";
import { GlobalContext } from "./GlobalContext";
import { EnsembleDrafter } from "./arrangement/EnsembleDrafter";
import { GenerationOptions } from "./types";

import { GlobalReviewer } from "./review/GlobalReviewer";
import { AnchorDecisionStage } from "./composing/AnchorDecisionStage";
import { MomentumStage } from "./composing/MomentumStage";
import { PhraseContourPlanner } from "./composing/PhraseContourPlanner";

import { MoodId, MoodRegistry } from "./config/MoodFlags";

// 🌟 PR #2: 双阶段 Viterbi 和声管线
import { generateHarmonyViaPipeline } from "./harmony/HarmonyPipeline";

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

    // 2. 生成全曲和声轨道
    // 🌟 PR #2: 双阶段 Viterbi 和声管线分支
    //   - useViterbiHarmony=true: 走新管线（影子骨架 → 骨架旋律 → Viterbi）
    //   - 否则回退到旧版 HarmonyEngine.generateHarmonyTimeline
    const useViterbiPipeline = style.useViterbiHarmony === true;
    const chords = useViterbiPipeline
        ? generateHarmonyViaPipeline(sections, tonality, timeSig)
        : HarmonyEngine.generateHarmonyTimeline(sections, style, timeSig);

    // 🌟 P5f: tonality vs chord-pool 不匹配修复（必须在 ToplineEngine 之前生效，否则旋律已用旧 tonality 生成）
    // 根因：parseRomanNumeral 在 Minor 调下不把 lowercase vi/iii/vii 自动降半音；chord pool 是 major 习惯写法。
    // 后果：tonality=Minor 但 chord 实际是 major 风格 → ToplineEngine 用 minor scale 生成与 chord tones 冲突的旋律。
    // 修法：扫所有 chord tones 的 pc 投票（major3=4 vs minor3=3 等），主导方决定真实 tonality；
    // 不匹配则覆盖 tonality + GlobalContext + context（确保下游一致使用）。
    if (chords.length > 0) {
      let major3Votes = 0;
      let minor3Votes = 0;
      for (let i = 0; i < chords.length; i++) {
        const tones = HarmonyCore.getChordTones(chords[i], 60);
        for (let t = 0; t < tones.length; t++) {
          const pc = ((tones[t] % 12) + 12) % 12;
          if (pc === 4) major3Votes++; else if (pc === 3) minor3Votes++;
          if (pc === 9) major3Votes++; else if (pc === 8) minor3Votes++;
          if (pc === 11) major3Votes++; else if (pc === 10) minor3Votes++;
        }
      }
      const isMinorChordContext = tonality === Tonality.Minor || tonality === Tonality.Minor_Pentatonic ||
                                   tonality === Tonality.Dorian || tonality === Tonality.Blues;
      const isMajorChordContext = tonality === Tonality.Major || tonality === Tonality.Major_Pentatonic ||
                                   tonality === Tonality.Mixolydian || tonality === Tonality.Lydian;
      if (major3Votes > minor3Votes * 1.5 && isMinorChordContext) {
        console.warn(`[P5f] tonality 与 chord pool 不匹配 (Minor→Major)：major3=${major3Votes} vs minor3=${minor3Votes}，覆盖 tonality=Major`);
        tonality = Tonality.Major;
        GlobalContext.currentTonality = Tonality.Major;
      } else if (minor3Votes > major3Votes * 1.5 && isMajorChordContext) {
        console.warn(`[P5f] tonality 与 chord pool 不匹配 (Major→Minor)：minor3=${minor3Votes} vs major3=${major3Votes}，覆盖 tonality=Minor`);
        tonality = Tonality.Minor;
        GlobalContext.currentTonality = Tonality.Minor;
      }
    }

    // 3. 抽卡决定乐器编制与主唱性格
    const instrumentPalette = EnsembleDrafter.draft(style);
    
    // Consume PRNG slot for persona selection alignment
    PRNGManager.next();

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
    const leadInstrument = instrumentPalette.melodySound;
    let vocal: any[] | undefined = undefined;
    let melody: any[] = [];

    if (instrumentPalette.vocalSound) {
        vocal = ToplineEngine.generateTrackMelody(
            sections, chords, style, tonality, instrumentPalette.vocalSound, toplineMotif, false, context
        );
        // Generate a sparser instrumental melody as accompaniment
        melody = ToplineEngine.generateTrackMelody(
            sections, chords, style, tonality, leadInstrument, undefined, true, context
        );
    } else {
        melody = ToplineEngine.generateTrackMelody(
            sections, chords, style, tonality, leadInstrument, toplineMotif, false, context
        );
    }

    // 5. 基于旋律进行重配和弦 (Re-harmonization)
    // 🌟 PR #2: Viterbi 管线下跳过 reharmonize —— Viterbi 已基于骨架旋律做了
    // 全局最优 voice leading，再跑贪心 reharmonize 会破坏长线连贯性。
    const finalChords = useViterbiPipeline
        ? chords
        : HarmonyEngine.reharmonize(chords, melody, style);


    // 6. 全局检查与修复 (Global Review & Nudge)
    const reviewed = GlobalReviewer.reviewAndFix(
        vocal, melody, finalChords, style, tonality
    );

    // 🌟 P5a/b/c 旋律后处理管道（反人类听感硬 bug 清除）
    //   P5a: maxJump 守卫 —— GlobalReviewer Phase 1 的 getNearestOctave 会产生 14-22 半音大跳
    //   P5b: 三全音（6 半音）/ 大七度（11 半音）拦截 —— 经典"魔鬼音程"
    //   P5c: 同音 ≥4 连续强制变化 —— 避免机关枪复读
    //
    // P5b/c 的音高微调必须沿**当前 chord 的 safeScalePcs**走 diatonic 级进，
    // 否则会引入 C 调的 C#4 这类非调内音（用户在 seed 2507347094 Verse_1 发现）。
    const globalMaxJump = style.melody?.maxJumpInterval ?? 12;

    // 为 onset 查找当前活动 chord 的 safeScalePcs（数组索引对齐，避免 Map / P-1 合规）
    // max chords.length ~100
    const safeScalePcsCache: (number[] | null)[] = new Array(reviewed.chords.length).fill(null);
    const getSafeScaleForOnset = (onset: number): number[] => {
      for (let i = 0; i < reviewed.chords.length; i++) {
        const c = reviewed.chords[i];
        if (onset >= c.startBeat - 1e-6 && onset < c.endBeat - 1e-6) {
          if (safeScalePcsCache[i] === null) {
            safeScalePcsCache[i] = HarmonyCore.getSafeScalePitches(c, tonality);
          }
          return safeScalePcsCache[i]!;
        }
      }
      return [];
    };

    const cleanMelodyPostProcessing = (notes: NoteData[]) => {
      if (notes.length < 2) return;
      notes.sort((a, b) => a.onset - b.onset);

      // P5a: 大跳 clamp（只降八度，不改 pitch class，天然调内安全）
      let refPitch = notes[0].pitch;
      let refIsGrace = notes[0].isGraceNote === true;
      for (let i = 1; i < notes.length; i++) {
        const n = notes[i];
        if (n.isGraceNote === true) continue;
        if (!refIsGrace) {
          const gap = n.pitch - refPitch;
          if (Math.abs(gap) > globalMaxJump) {
            const dir = gap > 0 ? 1 : -1;
            let newPitch = n.pitch;
            while (Math.abs(newPitch - refPitch) > globalMaxJump) newPitch -= dir * 12;
            n.pitch = newPitch;
          }
        }
        refPitch = n.pitch;
        refIsGrace = false;
      }

      // P5b: 三全音 / 大七度拦截（用 diatonic shiftDiatonic 级进到 scale 内的邻音）
      for (let i = 1; i < notes.length; i++) {
        const a = notes[i - 1], b = notes[i];
        if (a.isGraceNote === true || b.isGraceNote === true) continue;
        if (a.duration < 0.3 || b.duration < 0.3) continue;
        const interval = Math.abs(b.pitch - a.pitch);
        if (interval === 6 || interval === 11) {
          const dir = b.pitch > a.pitch ? 1 : -1; // b 相对 a 的方向
          const scalePcs = getSafeScaleForOnset(b.onset);
          if (scalePcs.length > 0) {
            // 把 b 向 a 方向级进 1 音阶步（调内），避免 ±1 半音产生非调内音
            const shifted = HarmonyCore.shiftDiatonic(b.pitch, scalePcs, -dir);
            // 若 shift 后仍保持三全音/大七度（scale 恰好产生同样 interval），多级进一步
            if (Math.abs(shifted - a.pitch) !== 6 && Math.abs(shifted - a.pitch) !== 11) {
              b.pitch = shifted;
            } else {
              b.pitch = HarmonyCore.shiftDiatonic(b.pitch, scalePcs, -dir * 2);
            }
          }
        }
      }

      // P5c: 连续 4+ 同音强制变化（diatonic 级进一个音阶步）
      let streak = 1;
      for (let i = 1; i < notes.length; i++) {
        if (notes[i].isGraceNote === true) continue;
        if (notes[i].pitch === notes[i - 1].pitch) {
          streak++;
          if (streak >= 4) {
            const adjDir = (streak % 2 === 0) ? 1 : -1;
            const scalePcs = getSafeScaleForOnset(notes[i].onset);
            if (scalePcs.length > 0) {
              notes[i].pitch = HarmonyCore.shiftDiatonic(notes[i].pitch, scalePcs, adjDir);
            }
            streak = 1; // 重置计数
          }
        } else {
          streak = 1;
        }
      }
    };
    cleanMelodyPostProcessing(reviewed.melody);
    if (reviewed.vocal) cleanMelodyPostProcessing(reviewed.vocal);

    // 🌟 V3.6 MomentumStage 阶段⑨.5：物理动量与阻尼（Luis #1）
    // 仅对主旋律 melody 应用（per design Q3 决策 a），vocal/counter 不动
    // 零 PRNG 消耗 — ACVE stateC/D 不变
    // 详见 docs/momentum_stage_design.md
    if (style.melody?.useMomentum !== false && reviewed.melody.length >= 2 && reviewed.chords.length > 0) {
      const tensionEnv = PhraseContourPlanner.buildForSong(sections);
      MomentumStage.smooth({
        notes: reviewed.melody,
        chords: reviewed.chords,
        tonality,
        tensionEnvelope: tensionEnv,
      });
    }

    // 🌟 P0 AnchorDecisionStage：按 section 为单位做全局 annotate
    // 放在 reharmonize + GlobalReviewer 之后 —— 保证 anchor 对齐最终 chord 和最终旋律
    // （裤带契约：annotate 的输入 chord/melody 就是 track 最终存储的数据）
    const beatsPerBar = timeSig[0];
    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];
      const isLastSection = si === sections.length - 1;
      const secMelody: NoteData[] = [];
      for (let ni = 0; ni < reviewed.melody.length; ni++) {
        const n = reviewed.melody[ni];
        if (n.onset >= sec.startBeat - 1e-6 && n.onset < sec.endBeat - 1e-6) {
          secMelody.push(n);
        }
      }
      if (secMelody.length > 0) {
        AnchorDecisionStage.annotate(
          secMelody, reviewed.chords, beatsPerBar, sec.startBeat, isLastSection
        );
      }
      // vocal 同样处理（如果存在）
      if (reviewed.vocal && reviewed.vocal.length > 0) {
        const secVocal: NoteData[] = [];
        for (let ni = 0; ni < reviewed.vocal.length; ni++) {
          const n = reviewed.vocal[ni];
          if (n.onset >= sec.startBeat - 1e-6 && n.onset < sec.endBeat - 1e-6) {
            secVocal.push(n);
          }
        }
        if (secVocal.length > 0) {
          AnchorDecisionStage.annotate(
            secVocal, reviewed.chords, beatsPerBar, sec.startBeat, isLastSection
          );
        }
      }
    }

    const track: GeneratedTrack = {
      chords: reviewed.chords, melody: reviewed.melody, vocal: reviewed.vocal, bpm, key: actualKey, keyOffset, tonality,
      timeSignature: timeSig, sections,
      blockIndex: 0, absoluteStartBeat: 0, hasIntro: true,
      preSelectedPalette: instrumentPalette,
      processedUserMotif,
      motifRole
    };

    // 🌟 P0 + P6 DEBUG: AnchorDecisionStage 占比 + P6 前置 anchor 占比
    if (track.melody.length > 0) {
      let anchorCount = 0;
      let prebuiltCount = 0;
      let chordToneAnchorCount = 0;
      let maxPitch = 0;
      let maxPitchOnset = 0;
      for (let i = 0; i < track.melody.length; i++) {
        const n = track.melody[i];
        if (n.pitch > maxPitch) { maxPitch = n.pitch; maxPitchOnset = n.onset; }
        if (n.isPreBuiltAnchor === true) prebuiltCount++;
        if (n.isAnchor !== true) continue;
        anchorCount++;
        const ch = track.chords.find(c => n.onset >= c.startBeat - 1e-6 && n.onset < c.endBeat - 1e-6) || track.chords[0];
        if (!ch) continue;
        const ctAbs = HarmonyCore.getChordTones(ch, 60);
        const pc = ((n.pitch % 12) + 12) % 12;
        let isCT = false;
        for (let j = 0; j < ctAbs.length; j++) {
          if ((((ctAbs[j] % 12) + 12) % 12) === pc) { isCT = true; break; }
        }
        if (isCT) chordToneAnchorCount++;
      }
      const ratio = anchorCount / track.melody.length;
      const chordTonePct = anchorCount > 0 ? chordToneAnchorCount / anchorCount : 1;
      let highCount = 0;
      let veryHighCount = 0;
      for (let i = 0; i < track.melody.length; i++) {
        if (track.melody[i].pitch >= 84) highCount++;
        if (track.melody[i].pitch >= 88) veryHighCount++;
      }
      console.log(`[AnchorStage] melody=${track.melody.length} anchors=${anchorCount} (${(ratio * 100).toFixed(1)}%) prebuilt=${prebuiltCount} chordTone=${(chordTonePct * 100).toFixed(1)}% maxPitch=${maxPitch}@${maxPitchOnset.toFixed(1)} p>=84=${highCount} p>=88=${veryHighCount}`);
    }

    return { track, context };
  }
}