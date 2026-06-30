// ============================================================
// runPipeline — Q+N 兼容外观(qn_main_engine_takeover §6)
// ============================================================
// ★ Q+N 升格为主引擎:runPipeline 不再调 mgEngine/runMgEngine,内部改调 MusicGenerationService。
//   - 返回值带【完整 MusicGenerationResult】(result):真正播放走 AudioEngine.playMusicGeneration(result)。
//   - {track, context} 仅【UI/Jam 兼容投影】(来自 uiSnapshot),不再是音频事实来源。
//   - 新开发代码优先直接调 MusicGenerationService.generateMusic();本外观只服务尚未迁移的旧调用方。
// ============================================================

import { GeneratedTrack, GenerationOptions, MusicContext } from '../types';
import { StyleId } from '../config/StyleFlags';
import { generateMusicSync } from '../musicGeneration/MusicGenerationService';
import type { MusicGenerationResult } from '../musicGeneration/types';
import { MusicGenerationStyleStore } from '../../../state/MusicGenerationStyleStore';
import { MusicGenerationKeyStore } from '../../../state/MusicGenerationKeyStore';
import { MusicGenerationSeedStore } from '../../../state/MusicGenerationSeedStore';
import { QnBandSelectionStore } from '../../../state/QnBandSelectionStore';

// ★ 仅留 Q+N facade 兼容字段(legacy 调用方未传 → 全部走默认);不再暴露任何 GM 音色 override 语义。
export interface PipelineRunOptions {
    allowedStyleIds?: StyleId[];
    forcedStyleId?: StyleId;
    generation?: GenerationOptions;
}

export interface PipelineResult { track: GeneratedTrack; context: MusicContext; result: MusicGenerationResult; }

export function runPipeline(_options: PipelineRunOptions = {}): PipelineResult {
    const result = generateMusicSync({
        seed: MusicGenerationSeedStore.getSeedNumber(),
        styleHint: MusicGenerationStyleStore.getStyleHint(),
        mood: 'build',
        targetDuration: 120,
        key: MusicGenerationKeyStore.getKey(),
        // ★ Band Selection 新语义:参与乐手/职能(QnBandSelectionStore;不含 GM 音色,音色由器配层定)。
        bandParticipants: QnBandSelectionStore.getParticipants(),
    });
    const ui = result.uiSnapshot;
    // 兼容投影(UI/Jam only,非音频源):标量字段来自 uiSnapshot,音符轨留空(音频走 playMusicGeneration)。
    const track = {
        chords: [], melody: [], bpm: result.bpm, key: ui.key, keyOffset: 0,
        tonality: ui.tonality, timeSignature: ui.timeSignature, sections: [],
        blockIndex: 0, absoluteStartBeat: 0, hasIntro: false,
    } as unknown as GeneratedTrack;
    const context = {
        keyOffset: 0, tonality: ui.tonality, bpm: result.bpm, timeSignature: ui.timeSignature, grooveDNA: [],
    } as unknown as MusicContext;
    return { track, context, result };
}
