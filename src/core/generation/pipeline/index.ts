// ============================================================
// runPipeline — Q+N 外观(qn_main_engine_takeover §6)
// ============================================================
// ★ Q+N 主引擎:runPipeline 内部调 MusicGenerationService,返回【完整 MusicGenerationResult】。
//   - 播放走 AudioEngine.playMusicGeneration(result);UI 读 result.uiSnapshot。
//   - 已删旧 {track, context} 兼容投影(GeneratedTrack/MusicContext);新代码可直接调 generateMusic()。
// ============================================================

import { GenerationOptions } from '../types';
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

export interface PipelineResult { result: MusicGenerationResult; }

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
    return { result };
}
