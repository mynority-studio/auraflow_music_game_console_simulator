// ============================================================
// newEngine · render · Gap B 织体覆盖 parity(musicgenerative_remaining_strict_migration_gaps.md)
// ------------------------------------------------------------
// 锁:① modern rich / LOFI / legacy pool 织体都在 KB 表示 ② render-only legacy 都有 renderer
//   ③ 没有可选 textureCase 缺 renderer ④ MG oracle 覆盖的 chord-producing case 都能在 newEngine 查到。
// ============================================================

import { describe, it, expect } from 'vitest';
import { TEXTURE_POOL } from '../knowledge/textureProfiles';
import { hasTextureRenderer, RENDERED_TEXTURE_CASES, LEGACY_RENDERED_TEXTURE_CASES } from './textureRenderer';
import { hasMgCompProfile } from './mgTextureCompDry';
import oracle from './__mgTextureOracle__/comp_cmaj7.json';

const MODERN = ['Lyrical_Felt_Piano_Sparse', 'Lyrical_10th_Broken', 'Ambient_Pad_Breath', 'Ambient_Reverse_Swell', 'Soft_Guitar_Pluck_8ths', 'Piano_Question_Answer', 'Low_Pedal_Color_Wash', 'HalfTime_Emotional_Pulse'];
const LOFI = ['Piano_Lofi_OneShot_Space', 'Piano_Lofi_Late_Chord_Answer', 'Piano_Emo_Broken_10th', 'Piano_Ambient_Sustain_Wash', 'Piano_HalfTime_Soft_Pulse', 'Piano_Lofi_Dusty_Chops', 'Piano_Lofi_Tape_Wobble_Arp', 'Piano_Wide_Color_Motion', 'Piano_CommonTone_Soft_Roll'];

describe('Gap B — 织体覆盖 parity', () => {
  it('① modern + LOFI rich 织体都在 KB 有 renderer', () => {
    for (const tc of [...MODERN, ...LOFI]) expect(hasTextureRenderer(tc), tc).toBe(true);
  });

  it('② legacy pool 织体都在 TEXTURE_POOL + 有 renderer', () => {
    const poolCases = new Set(TEXTURE_POOL.map((p) => p.textureCase));
    const poolLegacy = ['Pop_Alberti_Lyrical', 'Pop_Anthem_Pulse', 'Pop_Ballad_158_Sweep', 'Pop_Broken_8ths_Sync', 'Pop_Half_Arp_Sweep', 'Pop_Piano_Arp_16ths', 'Pop_Wave_16ths', 'Block_Chord', 'Broken_Chord', 'Arpeggio_Flow', 'Jazz_Charleston_Comp', 'Jazz_Drop_2_Comp', 'Jazz_Red_Garland_Block', 'Jazz_Waltz_Hemiola', 'Bossa_Piano_Arp', 'RnB_16th_Funk_Stabs', 'RnB_Classic_Soul_Arp', 'RnB_Gospel_Triplets', 'RnB_Laid_Back_Groove', 'RnB_Neo_Soul_Roll'];
    for (const tc of poolLegacy) { expect(poolCases.has(tc), `pool 缺 ${tc}`).toBe(true); expect(hasTextureRenderer(tc), `renderer 缺 ${tc}`).toBe(true); }
  });

  it('③ render-only legacy(Blues/bass/stab)都有 renderer', () => {
    const renderOnly = ['Blues_Boogie_Woogie', 'Blues_Chicago_Shuffle', 'Blues_Stabs', 'Arp_Seq', 'Jazz_Comping', 'Jazz_Walking_Bass', 'Root_Octave', 'Single_Root', 'Slap_Bass_Line', 'Stabs', 'Syncopated_Stabs', 'Ostinato_16s', 'Pop_Ostinato_Rock'];
    for (const tc of renderOnly) expect(hasTextureRenderer(tc), tc).toBe(true);
  });

  it('④ 每个 RENDERED textureCase 都有 renderer(无缺口)', () => {
    for (const tc of RENDERED_TEXTURE_CASES) expect(hasTextureRenderer(tc), tc).toBe(true);
    expect(LEGACY_RENDERED_TEXTURE_CASES.length).toBe(46);
  });

  it('⑤ MG oracle 里【有 comp/chord 语义】的 case,newEngine 都有 comp profile;bass-only 的没有', () => {
    const dur4 = oracle.dur4 as Record<string, { onsetCount: number }>;
    let chordCases = 0, bassOnly = 0;
    for (const [tc, p] of Object.entries(dur4)) {
      if (p.onsetCount > 0) { chordCases++; expect(hasMgCompProfile(tc), `${tc} 应有 comp profile`).toBe(true); }
      else { bassOnly++; expect(hasMgCompProfile(tc), `${tc} 应无 comp profile(bass-only)`).toBe(false); }
    }
    expect(chordCases).toBeGreaterThanOrEqual(50); // MG 53 chord-producing
    expect(bassOnly).toBeGreaterThanOrEqual(8);    // MG ~10 bass-only
  });
});
