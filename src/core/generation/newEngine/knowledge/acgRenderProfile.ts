// ============================================================
// newEngine · knowledge · ACG Render Profile(MG ACG 演奏身份 · docs/acg_render_layer_mg_feel_directive.md P1)
// ------------------------------------------------------------
// 架构铁律(用户 2026-07-02):arranger → 器配 → render 至高无上,所有链路 FOLLOW。本 profile 是【render 层数据】——
//   只【解释已排好的曲子】(arranger 的 chordTimeline + section plan),不选曲式、不改和声。render 据它把
//   SIM 给的任意和弦【用 MG ACG 钢琴语言演奏】。
//
// MG ACG 演奏身份(profile 编码的不变量,散落的 render 常量的单一真源锚点):
//   piano-only · melody-first · soft rolled comp · sparse-but-present bass · no pad fog ·
//   chord-roll after humanize · comp ducks/carves around lead · pedal supplies space ·
//   texture family 随 section 能量变(但不失 MG air)。
// ============================================================

import type { SectionLabel } from './textureProfiles';

/** 宏观 texture family bias:'sparse'=空旷/'drive'=推进/'character'=用本曲 per-song character。block 不作 bias(只局部)。 */
export type AcgFamilyBias = 'sparse' | 'drive' | 'character';

export interface AcgRenderProfile {
  // ★ P2:texture 宏观 family 随 section 能量 —— intro/outro 空(MG air);chorus 推进;verse/bridge 用本曲 character。
  //   block 【只作局部】(D-function/到达 bar 的 preferred list 自然给),永不作整段/整曲 bias → 防"J-pop 块床"。
  sectionFamilyBias: Record<SectionLabel, AcgFamilyBias>;
  characterBias: number;          // per-song character bias 强度(0.55 → 该 family ~50%,其余仍出现保 phrase 变化)
  allowBlockAsCharacter: boolean;  // false = block 不作 per-song character(deriveAcgTextureCharacter 只 drive/sparse)
}

/** MG ACG render profile(静态;knowledge 数据,render 消费)。不选曲式,只演奏身份 + 逐段 family 政策。 */
export function acgRenderProfile(): AcgRenderProfile {
  return {
    sectionFamilyBias: {
      INTRO: 'sparse',     // 开场留白 = MG air
      VERSE: 'character',  // 主歌跟本曲 character
      PRECHORUS: 'drive',  // 预副歌蓄势 = 推进
      CHORUS: 'drive',     // 副歌能量上抬 = 推进(不 block-heavy)
      BRIDGE: 'character',
      OUTRO: 'sparse',     // 收尾留白(修:此前落进 isSongEnd/loop-boundary 的 block preferred → 块75%,不像 MG)
    },
    characterBias: 0.55,
    allowBlockAsCharacter: false,
  };
}

/** 解析本 bar 的有效 family bias:section 能量优先,'character' → 用本曲 per-song character 兜底。 */
export function resolveAcgBarFamily(
  profile: AcgRenderProfile,
  label: SectionLabel,
  character: 'drive' | 'sparse',
): 'drive' | 'sparse' {
  const bias = profile.sectionFamilyBias[label];
  return bias === 'character' ? character : bias;
}
