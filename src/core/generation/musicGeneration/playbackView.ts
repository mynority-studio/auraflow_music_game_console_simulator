// ============================================================
// musicGeneration · playbackView(app 播放视图;取代旧 GeneratedTrack 兼容投影)
// ------------------------------------------------------------
// AuraBar/AuraJam 只需要【段(名/起止拍)+ bpm/key/拍号】做 jam 定时/段命中/显示。
// 过去它们把这些塞进一个假的 GeneratedTrack(旧 mg 数据结构)。这里改成【Q+N 自有结构】,
// 直接从 MusicGenerationResult.uiSnapshot 派生。音频事实仍是 MusicalIR(AudioEngine.playMusicGeneration)。
// ============================================================

import type { MusicGenerationResult } from './types';

/** 段(app 段命中/jam 定时用):name=段功能名(uiSnapshot.role),start/end 拍。
 *  energyLevel 保留为可选 —— 当前来源无(与旧投影一致:旧投影也没填,段能量判定走名字回退)。 */
export interface PlaybackSection {
  name: string;
  startBeat: number;
  endBeat: number;
  energyLevel?: number;
}

/** 一首歌的【播放视图】= app 消费的 Q+N 结构(取代旧 GeneratedTrack)。只带 app 真正读的字段。 */
export interface PlaybackSong {
  bpm: number;
  key: string;
  styleHint: string;
  tonality: string;            // uiSnapshot.tonality('major'/'minor'/调式名);melody-jam 备用
  keyOffset: number;           // Q+N 音高为绝对空间 → 恒 0(取代旧投影硬编码 keyOffset)
  timeSignature: [number, number];
  sections: PlaybackSection[];
}

/** MusicGenerationResult → PlaybackSong(段名=role,起止拍取自 uiSnapshot.sections 的 startBeat/endBeat)。 */
export function toPlaybackSong(result: MusicGenerationResult): PlaybackSong {
  const ui = result.uiSnapshot;
  return {
    bpm: result.bpm,
    key: ui.key,
    styleHint: result.styleHint,
    tonality: ui.tonality,
    keyOffset: 0,
    timeSignature: ui.timeSignature,
    sections: ui.sections.map((s) => ({ name: s.role, startBeat: s.startBeat, endBeat: s.endBeat })),
  };
}
