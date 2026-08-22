// ============================================================
// audio · playbackTypes(播放/视觉共享类型)
// ------------------------------------------------------------
// 这里只保留仍在用的中性类型:视觉事件(LedMatrix)+ 单轨名(mute)。
// ============================================================

/** 视觉事件(播放/交互 → LedMatrix 灯效)。aura_cue* = 光律漫游引导呼吸灯。 */
export interface VisualEvent {
    type: 'melody' | 'accomp' | 'bass' | 'drums' | 'counterMelody' | 'confirm' | 'custom_particle' | 'fn_key_active'
        | 'aura_cue' | 'aura_cue_hit' | 'aura_cue_clear';
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
    /** aura_cue/aura_cue_hit:提示 id(hit 用于提前收灯)。 */
    cueId?: number;
    /** aura_cue:呼吸包络时序(performance.now() 时基,峰值已含提前量)。 */
    peakAtMs?: number;
    riseMs?: number;
    holdMs?: number;
    fadeMs?: number;
}

export type VisualEventListener = (event: VisualEvent) => void;

/** 单轨名(PipelineMonitor 单轨 mute 用;Q+N 映射见 AudioEngine.qnPartChannel)。 */
export type PartName =
    | 'vocal' | 'melody' | 'chord' | 'bass' | 'drums'
    | 'secondaryMelody' | 'counterMelody';
