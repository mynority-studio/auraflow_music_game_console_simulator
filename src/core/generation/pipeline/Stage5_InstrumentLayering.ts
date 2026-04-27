import { PRNGManager } from '../../utils/PRNG';
import { GlobalContext } from '../GlobalContext';
import { HarmonyEngine } from '../composing/HarmonyCore';
import { ToplineEngine } from '../composing/ToplineEngine';
import { GlobalReviewer } from '../review/GlobalReviewer';
import { GeneratedTrack, MusicContext, NoteData, GenerationOptions } from '../types';
import { Stage4Output, PipelineResult } from './types';

export function layerInstruments(
    stage4: Stage4Output,
    options: GenerationOptions = {},
): PipelineResult {
    const {
        style,
        styleId,
        moodId,
        tonality,
        keyOffset,
        keyName,
        bpm,
        timeSignature,
        sections,
        chords,
        ensemble,
        conductorPlan,
        cadentialBridges,
        trajectoryProfile,
    } = stage4;

    const {
        processedUserMotif,
        motifRole = 'Foreground',
    } = options;

    // 保持对现有 GlobalContext 的兼容（生成管道内已脱钩使用，仅 MelodyEngine 入口写入）
    GlobalContext.initializeNewEra(style, bpm, keyOffset, tonality, timeSignature, moodId);

    const context: MusicContext = {
        keyOffset,
        tonality,
        bpm,
        timeSignature,
        grooveDNA: [],
        moodId,
        ensemble,
        style,
        conductorPlan,
        cadentialBridges,
        trajectoryProfile,
    };

    // PRNG 槽位对齐（保留旧管道的 persona selection slot，避免快照失衡）
    PRNGManager.next();

    // 按 Stage 4 的 focus/support 产出旋律轨
    const toplineMotif = motifRole === 'Foreground' ? processedUserMotif : undefined;
    const leadInstrument = ensemble.melodySound;

    let vocal: NoteData[] | undefined = undefined;
    let melody: NoteData[] = [];

    if (ensemble.vocalSound) {
        vocal = ToplineEngine.generateTrackMelody(
            sections, chords, style, tonality, ensemble.vocalSound, toplineMotif, false, context,
        );
        melody = ToplineEngine.generateTrackMelody(
            sections, chords, style, tonality, leadInstrument, undefined, true, context,
        );
    } else {
        melody = ToplineEngine.generateTrackMelody(
            sections, chords, style, tonality, leadInstrument, toplineMotif, false, context,
        );
    }

    // Reharmonize（仅旧和声管线）
    const useViterbi = style.useViterbiHarmony === true;
    const finalChords = useViterbi
        ? chords
        : HarmonyEngine.reharmonize(chords, melody, style);

    // 全局检查与修复
    const reviewed = GlobalReviewer.reviewAndFix(vocal, melody, finalChords, style, tonality);

    const track: GeneratedTrack = {
        chords: reviewed.chords,
        melody: reviewed.melody,
        vocal: reviewed.vocal,
        bpm,
        key: keyName,
        keyOffset,
        tonality,
        timeSignature,
        sections,
        blockIndex: 0,
        absoluteStartBeat: 0,
        hasIntro: true,
        preSelectedPalette: ensemble,
        processedUserMotif,
        motifRole,
    };

    // 避免 unused 告警
    void styleId;

    return { track, context };
}
