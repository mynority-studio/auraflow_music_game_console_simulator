// ============================================================
// MusicGenerationKeyStore — Q+N 音乐生成调中心(qn_main_engine_takeover §7.3)
// ------------------------------------------------------------
// 取代旧 MgKeyStore。PipelineMonitor 下拉写入 → service 转 Q+N PitchClass。
// ============================================================

export type MusicGenKey = 'C' | 'Db' | 'D' | 'Eb' | 'E' | 'F' | 'Gb' | 'G' | 'Ab' | 'A' | 'Bb' | 'B';

export const MUSIC_GEN_KEY_OPTIONS: ReadonlyArray<MusicGenKey> = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

let _key: MusicGenKey = 'C';

export const MusicGenerationKeyStore = {
    getKey(): MusicGenKey { return _key; },
    setKey(key: MusicGenKey): void { _key = key; },
};
