// ============================================================
// runPipeline — Q+N 兼容外观(qn_main_engine_takeover §6)
// ============================================================
// ★ Q+N 升格为主引擎:runPipeline 不再调 mgEngine/runMgEngine,内部改调 MusicGenerationService。
//   - 返回值带【完整 MusicGenerationResult】(result):真正播放走 AudioEngine.playMusicGeneration(result)。
//   - {track, context} 仅【UI/Jam 兼容投影】(来自 uiSnapshot),不再是音频事实来源。
//   - 新开发代码优先直接调 MusicGenerationService.generateMusic();本外观只服务尚未迁移的旧调用方。
// ============================================================

import { GeneratedTrack, GenerationOptions, MusicContext, BandRole } from '../types';
import { StyleId } from '../config/StyleFlags';
import { generateMusicSync } from '../musicGeneration/MusicGenerationService';
import type { MusicGenerationResult, QnBandSelection, QnGmOverrides, QnRole } from '../musicGeneration/types';
import { MusicGenerationStyleStore } from '../../../state/MusicGenerationStyleStore';
import { MusicGenerationKeyStore } from '../../../state/MusicGenerationKeyStore';
import { MusicGenerationSeedStore } from '../../../state/MusicGenerationSeedStore';
import { QnBandSelectionStore } from '../../../state/QnBandSelectionStore';

export interface PipelineRunOptions {
    allowedStyleIds?: StyleId[];
    forcedStyleId?: StyleId;
    forcedBand?: Partial<Record<BandRole, string | null>>;
    forcedGmPrograms?: Partial<Record<BandRole, number>>;
    generation?: GenerationOptions;
}

/** 旧 BandRole → Q+N role(§8.2)。Vocal 无 Q+N 对应(禁用)。 */
const BANDROLE_TO_QN: Partial<Record<BandRole, QnRole>> = {
    [BandRole.MainInst]: 'lead',
    [BandRole.Accomp]: 'comp',
    [BandRole.Bass]: 'bass',
    [BandRole.Drums]: 'drum',
    [BandRole.Atmosphere]: 'pad',
};

/** forcedGmPrograms(BandRole→program)→ Q+N gmOverrides(QnRole→program)。 */
function toGmOverrides(forced?: Partial<Record<BandRole, number>>): QnGmOverrides | undefined {
    if (!forced) return undefined;
    const out: QnGmOverrides = {};
    for (const [role, prog] of Object.entries(forced)) {
        const qn = BANDROLE_TO_QN[role as unknown as BandRole];
        if (qn && typeof prog === 'number') out[qn] = prog;
    }
    return Object.keys(out).length ? out : undefined;
}

export interface PipelineResult { track: GeneratedTrack; context: MusicContext; result: MusicGenerationResult; }

export function runPipeline(options: PipelineRunOptions = {}): PipelineResult {
    const result = generateMusicSync({
        seed: MusicGenerationSeedStore.getSeedNumber(),
        styleHint: MusicGenerationStyleStore.getStyleHint(),
        mood: 'build',
        targetDuration: 120,
        key: MusicGenerationKeyStore.getKey(),
        gmOverrides: toGmOverrides(options.forcedGmPrograms),
        // ★ Q+N Band Selection 三态(QnBandSelectionStore;§8.4):auto/selected/disabled per role。
        bandSelection: QnBandSelectionStore.getSelection() as QnBandSelection,
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
