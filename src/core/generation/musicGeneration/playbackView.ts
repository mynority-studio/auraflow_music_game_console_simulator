// ============================================================
// musicGeneration · playbackView(app 播放视图)
// ------------------------------------------------------------
// AuraBar/AuraJam 只需要【段(名/起止拍)+ bpm/key/拍号】做 jam 定时/段命中/显示。
// 这里直接从 MusicGenerationResult.uiSnapshot 派生。音频事实仍是 MusicalIR(AudioEngine.playMusicGeneration)。
// ============================================================

import type { MusicGenerationResult } from './types';

/** 段(app 段命中/jam 定时用):name=段功能名(uiSnapshot.role),start/end 拍。
 *  energyLevel 保留为可选;当前来源无,段能量判定走名字回退。 */
export interface PlaybackSection {
  name: string;
  startBeat: number;
  endBeat: number;
  energyLevel?: number;
}

/** 一首歌的【播放视图】= app 消费的 Q+N 结构。只带 app 真正读的字段。 */
export interface PlaybackSong {
  bpm: number;
  key: string;
  styleHint: string;
  tonality: string;            // uiSnapshot.tonality('major'/'minor'/调式名);melody-jam 备用
  keyOffset: number;           // Q+N 音高为绝对空间 → 恒 0
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
