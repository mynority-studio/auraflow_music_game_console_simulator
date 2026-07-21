import { describe, it, expect } from 'vitest';
import { generateMusicSync } from './MusicGenerationService';
import { toPlaybackSong } from './playbackView';

// ============================================================
// playbackView 安全网:锁 toPlaybackSong 与 app 段落公式一致。
// AuraBar/AuraJam 段公式:{ name: s.role, startBeat: s.startBeat, endBeat: s.startBeat + s.bars * tsBpb }
// 本测保证段命中/jam 定时行为稳定。
// ============================================================

describe('musicGeneration/playbackView · toPlaybackSong 段落视图', () => {
  it('段 name=role、start/end 拍与 app 段公式逐段一致(pop/acg/jazz/rnb/lofi)', () => {
    for (const styleHint of ['pop', 'acg', 'jazz', 'rnb', 'lofi']) {
      const r = generateMusicSync({ seed: 11, styleHint, mood: 'build', targetDuration: 90 });
      const song = toPlaybackSong(r);
      const tsBpb = r.uiSnapshot.timeSignature[0] || 4;

      expect(song.bpm).toBe(r.bpm);
      expect(song.styleHint).toBe(styleHint);
      expect(song.sections.length).toBe(r.uiSnapshot.sections.length);

      r.uiSnapshot.sections.forEach((ui, i) => {
        const expected = { name: ui.role, startBeat: ui.startBeat, endBeat: ui.startBeat + ui.bars * tsBpb };
        expect(song.sections[i]).toEqual(expected);
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
