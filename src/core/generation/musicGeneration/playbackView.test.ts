import { describe, it, expect } from 'vitest';
import { generateMusicSync } from './MusicGenerationService';
import { toPlaybackSong } from './playbackView';

// ============================================================
// playbackView 安全网(legacy 壳移除 Phase 0):锁 toPlaybackSong 与【旧 GeneratedTrack 内联投影】等价。
// 旧 AuraBar/AuraJam 都这样构段:{ name: s.role, startBeat: s.startBeat, endBeat: s.startBeat + s.bars * tsBpb }
// 迁移后走 toPlaybackSong;本测证两者逐段一致 → 段命中/jam 定时行为不变。
// ============================================================

describe('musicGeneration/playbackView · toPlaybackSong 等价旧投影', () => {
  it('段 name=role、start/end 拍与旧内联公式逐段一致(pop/acg/jazz/rnb/lofi)', () => {
    for (const styleHint of ['pop', 'acg', 'jazz', 'rnb', 'lofi']) {
      const r = generateMusicSync({ seed: 11, styleHint, mood: 'build', targetDuration: 90 });
      const song = toPlaybackSong(r);
      const tsBpb = r.uiSnapshot.timeSignature[0] || 4;

      expect(song.bpm).toBe(r.bpm);
      expect(song.styleHint).toBe(styleHint);
      expect(song.sections.length).toBe(r.uiSnapshot.sections.length);

      r.uiSnapshot.sections.forEach((ui, i) => {
        const legacy = { name: ui.role, startBeat: ui.startBeat, endBeat: ui.startBeat + ui.bars * tsBpb };
        expect(song.sections[i]).toEqual(legacy); // 逐段等价旧 GeneratedTrack 投影
      });
    }
  });

  it('段连续且覆盖全曲(startBeat 单调、段间无缝)', () => {
    const song = toPlaybackSong(generateMusicSync({ seed: 5, styleHint: 'pop', mood: 'build', targetDuration: 120 }));
    expect(song.sections[0].startBeat).toBe(0);
    for (let i = 1; i < song.sections.length; i++) {
      expect(song.sections[i].startBeat).toBe(song.sections[i - 1].endBeat);
    }
  });
});
