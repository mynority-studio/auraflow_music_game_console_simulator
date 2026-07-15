// ============================================================
// Layer 2 · Song Space Profile + Delay(CC95)(three-layer mix plan, Checkpoint 2)
// ------------------------------------------------------------
// 验收:SongSpaceProfile 器配-owned 确定性(ACG→popWarmRoom)· delay(CC95)极克制策略(拍板 D)· reverb/chorus 不变(保浏览器平衡)。
// ============================================================

import { describe, it, expect } from 'vitest';
import { songSpaceProfile, songSpaceProfileById, isSpaceProfile, delaySendForRole, mixForProgram, pickSpaceProfile } from './gmMixProfile';
import { musicalIRToMidiEvents } from '../../../audio/musicalIrToMidi';
import { generateMusicSync } from '../../musicGeneration/MusicGenerationService';

describe('Layer 2 · SongSpaceProfile(器配-owned 真源)', () => {
  it('确定性 + ACG→popWarmRoom(不 acgHall/不 dryFront)', () => {
    expect(songSpaceProfile('acg', undefined, false).id).toBe('popWarmRoom');
    expect(songSpaceProfile('acg', undefined, true).id).toBe('popWarmRoom');
    expect(songSpaceProfile('lofi', undefined, true).id).toBe('lofiTapeRoom');
    expect(songSpaceProfile('jazz', undefined, true).id).toBe('jazzClub');
    // id 与 pickSpaceProfile 单一真源一致
    expect(songSpaceProfile('rnb', undefined, true).id).toBe(pickSpaceProfile('rnb', undefined, true));
  });
  it('每空间有完整 FX 参数(ESP32 契约)', () => {
    const p = songSpaceProfile('rnb', undefined, true);
    expect(p.reverbTime).toBeGreaterThan(0);
    expect(p.delayMode).toBe('dotted-eighth');
  });
  it('播放/render 审计可按器配层已选 id 取回同一 SongSpaceProfile', () => {
    expect(isSpaceProfile('syntheticSoftRoom')).toBe(true);
    expect(songSpaceProfileById('syntheticSoftRoom')?.id).toBe('syntheticSoftRoom');
    expect(songSpaceProfileById('unknown-space')).toBeUndefined();
  });
});

describe('Layer 2 · delay(CC95)极克制策略(拍板 D)', () => {
  it('lead:rnb / lofi 有 delay;GM5键盘槽位/pop/jazz/acg/folk guitar lead 为 0', () => {
    expect(delaySendForRole('rnb', 'lead', 0)).toBe(26);   // rnb lead
    expect(delaySendForRole('pop', 'lead', 5)).toBe(0);    // GM5 键盘槽位尾音不再叠 delay,避免滋滋拖尾
    expect(delaySendForRole('lofi', 'lead', 0)).toBe(22);  // lofi lead
    expect(delaySendForRole('pop', 'lead', 25)).toBe(0);   // folk guitar 不走 clean-electric delay
    expect(delaySendForRole('pop', 'lead', 0)).toBe(0);    // pop 非 EP lead → off
    expect(delaySendForRole('jazz', 'lead', 0)).toBe(0);
    expect(delaySendForRole('jazz', 'lead', 5)).toBe(0);
    expect(delaySendForRole('acg', 'lead', 5)).toBe(0);
  });
  it('comp:lofi 有 delay;GM5键盘槽位与其余 0', () => {
    expect(delaySendForRole('lofi', 'comp', 0)).toBe(22);
    expect(delaySendForRole('lofi', 'comp', 24)).toBe(0);
    expect(delaySendForRole('lofi', 'comp', 25)).toBe(0);
    expect(delaySendForRole('pop', 'comp', 25)).toBe(0);
    expect(delaySendForRole('rnb', 'comp', 0)).toBe(0);
    expect(delaySendForRole('pop', 'comp', 5)).toBe(0);    // GM5 键盘槽位 comp 不进共享 delay
    expect(delaySendForRole('jazz', 'comp', 5)).toBe(0);
    expect(delaySendForRole('acg', 'comp', 5)).toBe(0);
  });
  it('bass/drum/pad 永远 0', () => {
    for (const s of ['pop', 'rnb', 'lofi', 'jazz']) {
      expect(delaySendForRole(s, 'bass', 0)).toBe(0);
      expect(delaySendForRole(s, 'drum', 0)).toBe(0);
      expect(delaySendForRole(s, 'pad', 0)).toBe(0);
    }
  });
});

describe('Layer 2 · delay 不改 reverb/chorus(保浏览器平衡)+ CC95 端到端', () => {
  it('mixForProgram:加 delay 不动 volume/pan/reverb/chorus', () => {
    const noDelay = mixForProgram({ style: 'pop', timbreWorld: undefined, role: 'lead', program: 0, hasPad: true, space: 'popWarmRoom' });
    const withDelay = mixForProgram({ style: 'rnb', timbreWorld: undefined, role: 'lead', program: 0, hasPad: true, space: 'rnbPlateRoom' });
    expect(noDelay.delay).toBeUndefined();      // pop 非 EP lead 无 delay
    expect(withDelay.delay).toBe(26);           // rnb lead 有 delay
    expect(withDelay.reverb).toBeGreaterThan(0); // reverb 仍在(未被 delay 影响)
  });
  it('生成曲:Dream GM128 硬件 MIDI 不发非标准 CC95 delay send', () => {
    const lofi = musicalIRToMidiEvents(generateMusicSync({ seed: 0, styleHint: 'lofi', mood: 'build', targetDuration: 90 }).ir!);
    const cc95 = lofi.filter((e) => e.type === 'cc' && e.data1 === 95);
    expect(cc95).toEqual([]);
  });
});
