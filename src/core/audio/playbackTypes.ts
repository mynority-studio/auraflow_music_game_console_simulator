// ============================================================
// audio · playbackTypes(播放/视觉共享类型;中性,不含旧引擎播放逻辑)
// ------------------------------------------------------------
// 原在旧 PlaybackEngine.ts。旧 PlaybackEngine 类(基于 GeneratedTrack/MidiConverter 的旧播放壳)已删除,
// 这里只保留仍在用的中性类型:视觉事件(LedMatrix)+ 单轨名(mute)。
// ============================================================

/** 视觉事件(播放/交互 → LedMatrix 灯效)。 */
export interface VisualEvent {
    type: 'melody' | 'accomp' | 'bass' | 'drums' | 'counterMelody' | 'confirm' | 'custom_particle' | 'fn_key_active';
    midiNote?: number;
    velocity?: number;
    col?: number;
    row?: number;
    hue?: number;
    energy?: number;
    spread?: number;
    source?: 'playback' | 'gameplay';
    time?: number;
    onset?: number;
    isUserMotif?: boolean;
    active?: boolean;
}

export type VisualEventListener = (event: VisualEvent) => void;

/** 单轨名(PipelineMonitor 单轨 mute 用;Q+N 映射见 AudioEngine.qnPartChannel)。 */
export type PartName =
    | 'vocal' | 'melody' | 'chord' | 'bass' | 'drums'
    | 'secondaryMelody' | 'counterMelody';
