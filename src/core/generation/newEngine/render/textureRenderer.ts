// ============================================================
// newEngine · render · TextureRenderer(rich textureCase → comp 事件)
// ------------------------------------------------------------
// 忠实 port 自 melodygenerative/src/lib/musicEngine.ts 的 rich textureCase 渲染分发
// (源 case 'Lyrical_Felt_Piano_Sparse' … 'Piano_CommonTone_Soft_Roll')。
// ★ 边界:源每个 texture 同时出 bass + chord 事件;newEngine bass 由 bassRenderer 独立渲染,
//   此处【只出 chord 部分】(voiced = comp 的真 voicing,对应源 cM)。
// 返回相对 span 起点的 hit(tRel/dur 单位=拍,vel=0..1);comp renderer 落 NoteIR。
// 纯函数无 rng → 确定性。
// ============================================================

export interface TextureChordHit {
  tRel: number; // 相对 span 起点的拍偏移
  dur: number; // 时值(拍)
  midis: number[]; // 该 hit 的 voice 子集
  vel: number; // 0..1(comp renderer 映射到 0..127)
}

// ★ 纹理的 bass 声部 = 节奏 only(onset/dur/vel + voice 提示);音高由 bassRenderer 按 bassRole/anchor 填。
//   忠实源:同一 textureCase 的 bass 与 chord 合谱 → bass+comp 对拍/复调由作者写死在相对拍 t 上。
export interface TextureBassHit {
  tRel: number;
  dur: number;
  vel: number; // 0..1(bassRenderer 映射)
  voice: 'root' | 'fifth' | 'tenth'; // root=anchor pc / fifth=五度 / tenth=三度(bass 区)
}

/** 纹理的律动口袋(给 drum 跟):halftime=半拍重 / sparse=留白多 / normal。 */
export type TexturePocket = 'normal' | 'halftime' | 'sparse';
const POCKET_BY_CASE: Record<string, TexturePocket> = {
  HalfTime_Emotional_Pulse: 'halftime', Piano_HalfTime_Soft_Pulse: 'halftime',
  Ambient_Pad_Breath: 'sparse', Low_Pedal_Color_Wash: 'sparse', Ambient_Reverse_Swell: 'sparse',
  Lyrical_Felt_Piano_Sparse: 'sparse', Piano_Lofi_OneShot_Space: 'sparse', Piano_Ambient_Sustain_Wash: 'sparse',
  // ACG 留白系(电影钢琴氛围)
  Piano_TopVoice_Planing: 'sparse', ACG_Pedal_Wash_Color_Drops: 'sparse', ACG_Sakamoto_LH_Arp_RH_Penta: 'sparse',
};
export function texturePocket(textureCase: string): TexturePocket {
  return POCKET_BY_CASE[textureCase] ?? 'normal';
}

/** modern(POP/RNB/JAZZ)rich textureCase。 */
const MODERN_TEXTURE_CASES = new Set<string>([
  'Lyrical_Felt_Piano_Sparse', 'Lyrical_10th_Broken', 'Ambient_Pad_Breath', 'Ambient_Reverse_Swell',
  'Soft_Guitar_Pluck_8ths', 'Piano_Question_Answer', 'Low_Pedal_Color_Wash', 'HalfTime_Emotional_Pulse',
]);
/** LOFI rich textureCase(+ wide_color_motion 兼归此)。 */
const LOFI_TEXTURE_CASES = new Set<string>([
  'Piano_Lofi_OneShot_Space', 'Piano_Lofi_Late_Chord_Answer', 'Piano_Emo_Broken_10th', 'Piano_Ambient_Sustain_Wash',
  'Piano_HalfTime_Soft_Pulse', 'Piano_Lofi_Dusty_Chops', 'Piano_Lofi_Tape_Wobble_Arp', 'Piano_Wide_Color_Motion',
  'Piano_CommonTone_Soft_Roll',
]);
/** ★ ACG rich textureCase(久石让/坂本钢琴手势;MG 升级 Phase 2b)。10 个 case 走专属 acgChordHits/acgBassHits。
 *  忠实源【手势包络】(timing/velocity/bass shape),pitch 取我们的 voicing(voicing-first,非 bit-MG;贴 texture-decision②)。 */
const ACG_TEXTURE_CASES = new Set<string>([
  'Piano_TopVoice_Planing', 'ACG_Quartal_Arp_Wave', 'ACG_Sakamoto_LH_Arp_RH_Penta', 'ACG_Ostinato_Hook_Pulse',
  'ACG_Stride_Cantabile_Ballad', 'ACG_Anthem_Block_Push', 'ACG_Open_Broken_10th', 'ACG_Suspended_Block_Arrival',
  'ACG_Bass_Tremolo_Color', 'ACG_Pedal_Wash_Color_Drops',
]);

/** ★ ACG comp-air 修复(directive §3.1):是否 ACG 钢琴织体 case(键具体 textureCase,不键 style — 未来 ACG 也可复用非 ACG 织体)。 */
export function isAcgTextureCase(tc: string | undefined): boolean {
  return !!tc && ACG_TEXTURE_CASES.has(tc);
}

/** ★ ACG 和弦语境(directive §3.3):给 textureRenderer 真和弦根/类型 → 算真上方色音(非从已钳 voicing 顶部取)。 */
export interface AcgChordContext { rootPc: number; chordType: string; }

/**
 * Legacy textureCase 全量覆盖集(Loop 6,2026-06-09 用户决策「全量进可选择池/strict MG」)。
 *   = 源 musicEngine.applyTexture 的全部 legacy case。前 20 个进 TEXTURE_POOL(可选择,见 textureProfiles
 *     ._LEGACY_TEXTURE_STYLES);其余(Blues_* + bass/stab generics)仅【render 覆盖】(源里有但不在 pool)。
 *   渲染走 family interpreter(classifyLegacyFamily)→ CODEX「renderer/interpreter 或明确 fallback contract」。
 *   ★ 非 bit-MG:按 texture-decision②「采纳 MG 词汇但保留手感」,按 family 重新演绎(对拍贴格)。
 */
const LEGACY_TEXTURE_CASES = new Set<string>([
  // —— pool(可选择,源 primaryTextures)——
  'Pop_Alberti_Lyrical', 'Pop_Anthem_Pulse', 'Pop_Ballad_158_Sweep', 'Pop_Broken_8ths_Sync',
  'Pop_Half_Arp_Sweep', 'Pop_Piano_Arp_16ths', 'Pop_Wave_16ths', 'Block_Chord', 'Broken_Chord', 'Arpeggio_Flow',
  'Jazz_Charleston_Comp', 'Jazz_Drop_2_Comp', 'Jazz_Red_Garland_Block', 'Jazz_Waltz_Hemiola', 'Bossa_Piano_Arp',
  'RnB_16th_Funk_Stabs', 'RnB_Classic_Soul_Arp', 'RnB_Gospel_Triplets', 'RnB_Laid_Back_Groove', 'RnB_Neo_Soul_Roll',
  // —— render-only(源 applyTexture 有、不在 pool):BLUES + bass/stab generics ——
  'Blues_Boogie_Woogie', 'Blues_Chicago_Shuffle', 'Blues_Shuffle_Bass', 'Blues_Slow_12_8_Arp',
  'Blues_Slow_Chops', 'Blues_Stabs', 'Blues_Tremolo_Comp',
  'Arp_Seq', 'Block_Chord_Staccato', 'Bossa_Clave_Comping', 'Call_And_Response', 'Funk_Guitar_Scratch',
  'Jazz_Comping', 'Jazz_Walking_Bass', 'Ostinato_16s', 'Pop_Ostinato_Rock',
  'Root_5_7_5', 'Root_5_8', 'Root_7_5_8', 'Root_Fifth_Bass', 'Root_Octave_Pulse', 'Root_Octave',
  'Single_Root', 'Slap_Bass_Line', 'Stabs', 'Syncopated_Stabs',
]);

import { hasMgCompProfile, renderTextureCompDryStrictMg } from './mgTextureCompDry';
import { chordTypeIntervals, isKnownChordType } from '../knowledge/chords';

type LegacyFamily = 'block' | 'arp' | 'stab' | 'roll' | 'pulse' | 'comp' | 'bass';

/** legacy textureCase → 演绎 family(名字模式;顺序敏感:bass 名先于 arp/comp)。 */
function classifyLegacyFamily(tc: string): LegacyFamily {
  if (/Single_Root|^Root_|Slap_Bass|Walking_Bass|Boogie|Shuffle_Bass/i.test(tc)) return 'bass';
  if (/Stab|Scratch/i.test(tc)) return 'stab';
  if (/Roll/i.test(tc)) return 'roll';
  if (/Pulse|Ostinato|Anthem|Wave/i.test(tc)) return 'pulse';
  if (/Arp|Broken|Sweep|Alberti|158|Flow/i.test(tc)) return 'arp';
  if (/Comp|Charleston|Clave|Triplet|Laid_Back|Hemiola|Tremolo|Chops|Gospel|Shuffle/i.test(tc)) return 'comp';
  return 'block'; // Block_Chord / Red_Garland_Block / Drop_2 / Staccato / Call_And_Response / 兜底
}

/** 该 textureCase 有 render 实现吗(否则 comp 回退 compPattern)。 */
export function hasTextureRenderer(textureCase: string): boolean {
  return MODERN_TEXTURE_CASES.has(textureCase) || LOFI_TEXTURE_CASES.has(textureCase)
    || ACG_TEXTURE_CASES.has(textureCase) || LEGACY_TEXTURE_CASES.has(textureCase);
}

/** 全部已实现的 rich textureCase(测试遍历用)。 */
export const RENDERED_TEXTURE_CASES: readonly string[] = [...MODERN_TEXTURE_CASES, ...LOFI_TEXTURE_CASES, ...ACG_TEXTURE_CASES, ...LEGACY_TEXTURE_CASES];
/** ACG rich textureCase(测试遍历用)。 */
export const ACG_RENDERED_TEXTURE_CASES: readonly string[] = [...ACG_TEXTURE_CASES];

/** legacy 全量 case(测试用:pool 覆盖 + 渲染覆盖)。 */
export const LEGACY_RENDERED_TEXTURE_CASES: readonly string[] = [...LEGACY_TEXTURE_CASES];

/**
 * rich textureCase → chord hit 序列(忠实源每个 case 的 chord pushEvent)。
 * @param voicedRaw comp 真 voicing(= 源 cM);内部按升序处理(slice 语义依赖低→高)。
 * @param durationBeats span 时值(= 源 duration,拍)。
 */
export function renderTextureChordHits(
  textureCase: string,
  voicedRaw: readonly number[],
  durationBeats: number,
  acgChord?: AcgChordContext, // ★ ACG comp-air §3.3:仅 ACG case 用 → 真和弦上方色音(缺省=旧行为,从 voicing 取)
): TextureChordHit[] {
  const cM = [...voicedRaw].sort((a, b) => a - b);
  if (cM.length === 0) return [];
  const dur = durationBeats;
  const hits: TextureChordHit[] = [];
  const push = (midis: number[], tRel: number, d: number, vel: number) => {
    const ms = midis.filter((m) => Number.isFinite(m));
    if (ms.length === 0 || tRel >= dur) return;
    hits.push({ tRel, dur: d, midis: ms, vel });
  };
  const arpAt = (i: number) => {
    const arp = [cM[0], cM[1] ?? cM[0], cM[2] ?? cM[cM.length - 1], cM[1] ?? cM[0]];
    return arp[i % arp.length];
  };

  // ★ Gap B(2026-06-09):legacy comp/chord 走 MG 严格 dry(oracle 驱动)—— MG 的 onset 栅格/时值策略/
  //   力度比/每击音数语义,取代 Loop 6 的 family interpreter(产品手感版)。pitch 用我们的 voicing(Option B)。
  //   bass-only 织体(MG comp/chord=0)→ 空(comp 不发声,和声交 bass renderer)。product 贴格/pocket 在下游叠。
  if (LEGACY_TEXTURE_CASES.has(textureCase)) {
    return hasMgCompProfile(textureCase) ? renderTextureCompDryStrictMg(textureCase, cM, dur) : [];
  }
  // ★ ACG 钢琴手势(Phase 2b):专属 chord-hit 演绎(忠实 MG 包络)。§3.3:有和弦语境 → 真上方色音。
  if (ACG_TEXTURE_CASES.has(textureCase)) return acgChordHits(cM, dur, textureCase, acgChord);

  switch (textureCase) {
    // ——— modern lyrical / ambient ———
    case 'Lyrical_Felt_Piano_Sparse':
      push(cM, 0.15, 1.2, 0.42);
      if (dur >= 4) { push(cM.slice(-2), 2.25, 0.45, 0.36); push(cM.slice(0, 2), 3.25, 0.35, 0.30); }
      break;
    case 'Lyrical_10th_Broken':
      // ★ 重音对拍:arp 贴 8 分格(去掉 +0.05 统一晚拍 → 整拍上的音与 bass/drum 锁拍)
      for (let i = 0; i < dur * 2; i++) push([arpAt(i)], i * 0.5, 0.32, 0.34 + (i % 4 === 0 ? 0.08 : 0));
      break;
    case 'Ambient_Pad_Breath':
      push(cM, 0.05, Math.min(dur, 2.8), 0.34);
      if (dur >= 4) push(cM.slice(1), 2.6, 1.2, 0.28);
      break;
    case 'Ambient_Reverse_Swell':
      [1.75, 2.5, 3.0, 3.5].filter((t) => t < dur).forEach((t, i) => push(cM, t, 0.35, 0.22 + i * 0.08));
      break;
    case 'Soft_Guitar_Pluck_8ths': {
      const notes = [cM[0], cM[1], cM[2], cM[1], cM[3] ?? cM[2], cM[1]];
      [0.0, 0.5, 1.0, 1.5, 2.5, 3.0].forEach((t, i) => push([notes[i % notes.length]], t, 0.28, 0.34)); // ★ 重音对拍:8 分拨贴格
      break;
    }
    case 'Piano_Question_Answer':
      if (dur >= 4) { push(cM, 2.0, 0.5, 0.45); push(cM.slice(-2), 3.0, 0.35, 0.34); }
      else push(cM, dur * 0.5, 0.35, 0.38);
      break;
    case 'Low_Pedal_Color_Wash': // 源用 bMLow 过滤上层;comp 无 bass,voiced 即上层
      push(cM, 0.25, Math.min(dur, 3.2), 0.30);
      if (dur >= 4) push(cM.slice(1), 3.0, 0.8, 0.24);
      break;
    case 'HalfTime_Emotional_Pulse':
      push(cM, 0.0, 0.75, 0.48);
      if (dur >= 4) push(cM, 2.0, 0.75, 0.42);
      break;

    // ——— LOFI piano-only ———
    case 'Piano_Lofi_OneShot_Space':
      push(cM, 0.025, Math.min(dur * 0.5, 2.0), 0.38);
      break;
    case 'Piano_Lofi_Late_Chord_Answer':
      if (dur >= 4) { push(cM, 2.04, 0.65, 0.42); push(cM.slice(-2), 3.03, 0.4, 0.32); }
      else push(cM, dur * 0.55, 0.4, 0.38);
      break;
    case 'Piano_Emo_Broken_10th':
      for (let i = 0; i < dur * 2; i++) push([arpAt(i)], i * 0.5, 0.30, 0.32 + (i % 4 === 0 ? 0.06 : 0)); // ★ 重音对拍:arp 贴 8 分格
      break;
    case 'Piano_Ambient_Sustain_Wash':
      push(cM, 0.02, Math.min(dur, 3.5), 0.30);
      if (dur >= 4) push(cM.slice(1), 3.0, 0.95, 0.24);
      break;
    case 'Piano_HalfTime_Soft_Pulse':
      push(cM, 0.025, 0.75, 0.42);
      if (dur >= 4) push(cM, 2.025, 0.75, 0.38);
      break;
    case 'Piano_Lofi_Dusty_Chops':
      [0.58, 1.58, 2.58, 3.58].filter((t) => t < dur).forEach((t, i) => push(cM, t, 0.30, 0.35 + (i % 2 === 0 ? 0.08 : 0)));
      break;
    case 'Piano_Lofi_Tape_Wobble_Arp': {
      const arp = cM.slice(0, Math.min(cM.length, 4));
      for (let i = 0; i < dur * 2 && i < 8; i++) push([arp[i % arp.length]], i * 0.5 + 0.02, 0.35, i % 2 === 0 ? 0.32 : 0.24);
      break;
    }
    case 'Piano_Wide_Color_Motion': // 源 roll widePianoVoicing;voiced 即宽排列 → 强拍轻 roll
    case 'Piano_CommonTone_Soft_Roll':
      // ★ 重音对拍:roll 首声部【落在强拍上】(idx0=beat),其余声部向上 roll(spread 0.015);整个 roll 从拍点起,不再整体晚拍。
      [0, 2].forEach((beat) => {
        if (beat >= dur) return;
        cM.forEach((m, idx) => push([m], beat + idx * 0.015, Math.min(1.6, dur - beat - 0.1), 0.36 + idx * 0.02));
      });
      break;
  }
  return hits;
}

/**
 * rich textureCase → bass hit 序列(忠实源每个 case 的 bass pushEvent)。节奏 only,音高 bassRenderer 填。
 * 多数 = 根音持音;HalfTime 系列在 0+2 双脉冲;10th 系列中段补三度(tenth)。
 */
export function renderTextureBassHits(textureCase: string, durationBeats: number): TextureBassHit[] {
  const dur = durationBeats;
  const hits: TextureBassHit[] = [];
  const b = (tRel: number, d: number, vel: number, voice: TextureBassHit['voice'] = 'root') => {
    if (tRel < dur) hits.push({ tRel, dur: Math.min(d, dur - tRel), vel, voice });
  };

  // ★ Loop 6:legacy textureCase → family interpreter 的 bass 部分。
  if (LEGACY_TEXTURE_CASES.has(textureCase)) {
    renderLegacyBassHits(classifyLegacyFamily(textureCase), textureCase, dur, b);
    return hits;
  }
  // ★ ACG 钢琴手势(Phase 2b):专属 bass shape(pedal/ripple/arrival/stride/LH-arp/motif),voice 提示 root/fifth/tenth。
  if (ACG_TEXTURE_CASES.has(textureCase)) { acgBassHits(dur, textureCase, b); return hits; }

  switch (textureCase) {
    case 'Lyrical_Felt_Piano_Sparse': b(0, Math.min(dur, 3.8), 0.62); break;
    case 'Lyrical_10th_Broken': b(0, 1.5, 0.72); if (dur > 2) b(1.5, 0.6, 0.45, 'tenth'); break;
    case 'Ambient_Pad_Breath': b(0, dur, 0.48); break;
    case 'Ambient_Reverse_Swell': b(0, dur, 0.45); break;
    case 'Soft_Guitar_Pluck_8ths': b(0, 1.8, 0.58); break;
    case 'Piano_Question_Answer': b(0, Math.min(dur, 2.0), 0.65); break;
    case 'Low_Pedal_Color_Wash': b(0, dur, 0.58); break;
    case 'HalfTime_Emotional_Pulse': b(0, 2.0, 0.82); if (dur >= 4) b(2.0, 2.0, 0.70); break;
    case 'Piano_Lofi_OneShot_Space': b(0, dur, 0.55); break;
    case 'Piano_Lofi_Late_Chord_Answer': b(0, Math.min(dur, 2.0), 0.60); break;
    case 'Piano_Emo_Broken_10th': b(0, 1.5, 0.68); if (dur > 2) b(1.5, 0.55, 0.42, 'tenth'); break;
    case 'Piano_Ambient_Sustain_Wash': b(0, dur, 0.42); break;
    case 'Piano_HalfTime_Soft_Pulse': b(0, 1.85, 0.72); if (dur >= 4) b(2.0, 1.85, 0.62); break;
    case 'Piano_Lofi_Dusty_Chops': b(0, dur, 0.62); break;
    case 'Piano_Lofi_Tape_Wobble_Arp': b(0, dur, 0.55); break;
    case 'Piano_Wide_Color_Motion': b(0, Math.min(dur, 2.4), 0.58); break;
    case 'Piano_CommonTone_Soft_Roll': b(0, dur, 0.65); break;
  }
  return hits;
}

// ============================================================
// ACG 钢琴手势演绎(MG 升级 Phase 2b)
// ------------------------------------------------------------
// 忠实源 musicEngine applyTexture 的 10 个 ACG case【手势包络】(相对拍 timing / velocity / bass shape /
//   long-color-roll 上行绽放 + 下行回声)。★ pitch 取我们 voicing(voicing-first,非 bit-MG):
//   源的 acgUpperColorMidis(target)(和弦相对色音)在此【从 voicing 顶部取色音】,因 ACG 和弦=maj9/maj13
//   富色彩 voicing,顶部已含 9/11/13 色音 → 听感等价。bass shape 映射到 root/fifth/tenth voice 提示。
//   纯函数无 rng → 确定性。
// ============================================================
// ★ ACG comp-air §3.3:真和弦【上方色音】(adapt 自 musicEngine acgUpperColorMidis)。
//   chord 含该色音(9/maj7/b7/6/#11/5/3/root)→ 取近 target(高空气区 ~78)的八度 → 真高位 air,非从已钳 voicing 顶部取。
const ACG_COLOR_INTERVALS = [2, 11, 10, 9, 6, 7, 4, 3, 0]; // 9th/maj7/b7/6/#11/5/3/b3/root(色彩优先序)
function acgChordPcs(rootPc: number, chordType: string): Set<number> {
  const ivs = isKnownChordType(chordType) ? chordTypeIntervals(chordType) : [0, 4, 7];
  return new Set(ivs.map((iv) => (((rootPc + iv) % 12) + 12) % 12));
}
function acgMidiForPcNear(pc: number, target: number, low: number, high: number): number | null {
  let best: number | null = null;
  for (let m = (((pc % 12) + 12) % 12); m <= high; m += 12) {
    if (m < low) continue;
    if (best === null || Math.abs(m - target) < Math.abs(best - target)) best = m;
  }
  return best;
}
function acgUpperColorMidis(rootPc: number, chordType: string, target = 78, low = 62, high = 93): number[] {
  const pcs = acgChordPcs(rootPc, chordType);
  const out: number[] = [];
  for (const iv of ACG_COLOR_INTERVALS) {
    const pc = (((rootPc + iv) % 12) + 12) % 12;
    if (!pcs.has(pc)) continue;
    const m = acgMidiForPcNear(pc, target, low, high);
    if (m !== null) out.push(m);
  }
  return [...new Set(out)];
}

function acgChordHits(cMRaw: readonly number[], dur: number, tc: string, ctx?: AcgChordContext): TextureChordHit[] {
  const cM = [...cMRaw].sort((a, b) => a - b);
  const n = cM.length;
  const hits: TextureChordHit[] = [];
  if (n === 0) return hits;
  const uniqSorted = (xs: number[]) => Array.from(new Set(xs.filter((m) => Number.isFinite(m)))).sort((a, b) => a - b);
  const push = (midis: number[], tRel: number, d: number, vel: number) => {
    const ms = midis.filter((m) => Number.isFinite(m));
    if (ms.length === 0 || tRel < 0 || tRel >= dur) return;
    hits.push({ tRel, dur: Math.max(0.05, Math.min(d, dur - tRel - 0.02)), midis: ms, vel: Math.max(0.08, Math.min(0.95, vel)) });
  };
  // ★ §3.3:有和弦语境 → 真上方色音(高 air);否则回退从 voicing 顶部取(旧行为,无 ctx 的单测/兜底)。
  const airColor = ctx ? acgUpperColorMidis(ctx.rootPc, ctx.chordType, 78) : [];
  // 色音层:优先真 air 色音(>67 高空气);无 ctx → voicing 顶部 count 个。
  const colorTop = (count: number): number[] =>
    airColor.length > 0 ? airColor.slice(0, count) : uniqSorted(cM.slice(Math.max(0, n - count)));
  const top = cM[n - 1];
  const hiReach = Math.min(93, top < 74 ? top + 12 : top); // 高位绽放够亮(源 acgUpperColorMidis(81))
  // long-color-roll:升序铺开 + 顶音加亮 + 可选中段下行回声(源 pushAcgLongColorRoll)。
  const longColorRoll = (midisIn: number[], startT: number, span: number, vol: number, down: boolean) => {
    const ns = uniqSorted(midisIn);
    if (ns.length === 0) return;
    const availSpan = Math.max(0.22, Math.min(span, dur - startT - 0.25));
    const step = ns.length <= 1 ? 0 : availSpan / Math.max(1, ns.length - 1);
    ns.forEach((m, idx) => {
      const t = startT + idx * step;
      if (t >= dur - 0.18) return;
      const isTop = idx === ns.length - 1;
      push([m], t, isTop ? 0.88 : 0.58, isTop ? vol + 0.05 : Math.max(0.1, vol - idx * 0.012));
    });
    if (!down || dur < startT + availSpan + 0.80) return;
    ns.slice(1, -1).reverse().slice(0, 3).forEach((m, idx) => {
      const t = startT + availSpan + 0.48 + idx * 0.24;
      if (t >= dur - 0.20) return;
      push([m], t, 0.42, Math.max(0.16, vol - 0.08 - idx * 0.025));
    });
  };

  switch (tc) {
    case 'Piano_TopVoice_Planing': {
      const inner = uniqSorted(cM.slice(0, Math.min(3, n)));
      const support = cM.slice(3, Math.min(4, n));
      const colorTopArr = airColor.length > 0 ? airColor.slice(0, 2) : uniqSorted([top, hiReach]).slice(-2); // ★ §3.3:真高位 air

      const open = uniqSorted([...support, ...colorTopArr]).filter((m) => !inner.includes(m));
      longColorRoll(uniqSorted([...inner, ...open]), 0.10, 1.28, 0.27, true); // 上行绽放
      const echo = uniqSorted([...open, ...inner.slice(1)]).reverse().slice(0, 4); // 高→低回落
      echo.forEach((m, idx) => { const t = 2.5 + idx * 0.16; if (t < dur - 0.18) push([m], t, Math.min(0.55, dur - t), Math.max(0.1, 0.22 - idx * 0.025)); });
      if (dur > 3.7 && open.length > 0) { const t = Math.min(dur - 0.48, 3.20); push([open[open.length - 1]], t, Math.min(0.42, dur - t), 0.20); }
      break;
    }
    case 'ACG_Quartal_Arp_Wave': {
      const support = uniqSorted(cM.slice(0, Math.min(4, n)));
      const colors = colorTop(3);
      const wave = uniqSorted([...support.slice(0, 2), ...colors, ...support.slice(2, 3)]);
      longColorRoll(wave, 0.12, 1.64, 0.25, true);
      if (dur > 3.1 && colors.length > 0) push([colors[colors.length - 1]], 3.04, 0.44, 0.22);
      break;
    }
    case 'ACG_Sakamoto_LH_Arp_RH_Penta': { // 右手只落几颗五声色影,留旋律空间(左手 arp 在 bass)
      const shadow = colorTop(3);
      [1.18, 2.74, 3.34].forEach((t, idx) => { if (t < dur - 0.20 && shadow.length) push([shadow[idx % shadow.length]], t, 0.42, 0.20); });
      break;
    }
    case 'ACG_Ostinato_Hook_Pulse': { // 上方 hook 双音(motif 在 bass)
      const hook = uniqSorted([...cM.slice(0, Math.min(2, n)), ...colorTop(2)]).slice(0, 4);
      [0.74, 1.74, 2.74, 3.26].forEach((t, idx) => {
        if (t >= dur - 0.18 || hook.length === 0) return;
        push(uniqSorted([hook[idx % hook.length], hook[(idx + 1) % hook.length]]), t, 0.34, 0.20 + idx * 0.012);
      });
      break;
    }
    case 'ACG_Stride_Cantabile_Ballad': { // 上方和弦应答(bass 走 stride)
      const upperA = uniqSorted([...cM.slice(0, Math.min(3, n)), ...colorTop(1)]).slice(0, 4);
      const upperB = uniqSorted([...cM.slice(1, Math.min(4, n)), ...colorTop(2).slice(-1)]).slice(0, 4);
      if (upperA.length) push(upperA, 0.84, Math.min(1.0, dur - 0.86), 0.24);
      if (dur > 2.72) push(upperB.length ? upperB : upperA, 2.72, Math.min(0.86, dur - 2.74), 0.22);
      const highAnswer = colorTop(1)[0] ?? upperA[upperA.length - 1];
      if (Number.isFinite(highAnswer) && dur > 3.36) push([highAnswer], 3.36, 0.38, 0.19);
      break;
    }
    case 'ACG_Anthem_Block_Push': {
      const block = uniqSorted([...cM.slice(0, Math.min(3, n)), ...colorTop(1)]).slice(0, 4);
      const pushed = uniqSorted([...block.slice(1), ...colorTop(2).slice(-1)]).slice(0, 4);
      [0.00, 1.46, 2.00, 2.72, 3.46].forEach((t, idx) => {
        if (t >= dur - 0.16 || block.length === 0) return;
        push((idx % 2 === 0 || pushed.length === 0) ? block : pushed, t, 0.42, 0.25 + Math.min(0.05, idx * 0.012));
      });
      break;
    }
    case 'ACG_Open_Broken_10th': {
      const upper = uniqSorted([...cM.slice(0, Math.min(2, n)), ...colorTop(3)]);
      longColorRoll(upper, 0.20, 1.46, 0.25, true);
      if (dur > 3.2 && upper.length > 2) push([upper[1]], 3.18, 0.40, 0.19);
      break;
    }
    case 'ACG_Suspended_Block_Arrival': {
      const arrival = uniqSorted([...cM.slice(0, Math.min(3, n)), ...colorTop(3)]).slice(0, 5);
      longColorRoll(arrival, 0.08, 1.24, 0.28, false);
      const colorArr = colorTop(3);
      const topC = colorArr[colorArr.length - 1];
      const support = arrival[Math.max(0, arrival.length - 2)];
      if (Number.isFinite(support) && dur > 2.3) push([support], 2.32, 0.52, 0.21);
      if (Number.isFinite(topC) && dur > 3.2) push([topC], 3.24, 0.44, 0.25);
      break;
    }
    case 'ACG_Bass_Tremolo_Color': {
      const upper = colorTop(3);
      const bed = uniqSorted(cM.slice(0, Math.min(2, n)));
      longColorRoll(uniqSorted([...bed, ...upper]), 0.14, 1.22, 0.23, false);
      [2.18, 2.92, 3.46].forEach((t, idx) => { if (t < dur - 0.16 && upper.length) push([upper[idx % upper.length]], t, 0.36, 0.22); });
      break;
    }
    case 'ACG_Pedal_Wash_Color_Drops': {
      const bed = uniqSorted(cM.slice(0, Math.min(2, n)));
      if (bed.length) push(bed, 0.28, Math.min(1.60, dur - 0.32), 0.18);
      const colors = colorTop(3);
      [1.96, 2.94, 3.48].forEach((t, idx) => { if (t < dur - 0.18 && colors.length) push([colors[idx % colors.length]], t, 0.42, 0.20 + idx * 0.018); });
      break;
    }
  }
  return hits;
}

/** ACG bass shape → TextureBassHit(voice 提示 root/fifth/tenth;音高由 bassRenderer 落)。忠实源 pushAcgBrokenBass 等。 */
function acgBassHits(dur: number, tc: string, b: (tRel: number, d: number, vel: number, voice?: TextureBassHit['voice']) => void): void {
  switch (tc) {
    case 'Piano_TopVoice_Planing': // pedal
    case 'ACG_Pedal_Wash_Color_Drops':
      b(0, Math.max(0.5, dur - 0.08), 0.39); if (dur > 1.0) b(0.82, 0.74, 0.24, 'fifth'); if (dur > 2.7) b(2.46, 0.62, 0.22, 'tenth'); break;
    case 'ACG_Suspended_Block_Arrival': // arrival
      b(0, Math.max(0.5, dur - 0.08), 0.43); if (dur > 1.2) b(0.96, 0.78, 0.25, 'fifth'); if (dur > 3.0) b(2.72, 0.58, 0.21, 'fifth'); break;
    case 'ACG_Quartal_Arp_Wave': // ripple
    case 'ACG_Bass_Tremolo_Color': {
      const voices: TextureBassHit['voice'][] = ['root', 'fifth', 'fifth', 'fifth', 'tenth'];
      [0.00, 0.68, 1.34, 2.14, 3.02].forEach((t, idx) => { if (t >= dur - 0.18) return; b(t, idx === 0 ? 0.82 : 0.52, idx === 0 ? 0.47 : Math.max(0.16, 0.25 - idx * 0.015), voices[idx]); });
      break;
    }
    case 'ACG_Sakamoto_LH_Arp_RH_Penta': { // 左手法式印象派 arp
      const voices: TextureBassHit['voice'][] = ['root', 'fifth', 'root', 'tenth', 'fifth', 'root'];
      [0.00, 0.70, 1.36, 2.04, 2.74, 3.34].forEach((t, idx) => { if (t >= dur - 0.16) return; b(t, idx === 0 ? 0.62 : 0.44, idx === 0 ? 0.46 : 0.25, voices[idx]); });
      break;
    }
    case 'ACG_Ostinato_Hook_Pulse': { // 短重复 motif cell
      const voices: TextureBassHit['voice'][] = ['root', 'fifth', 'root', 'fifth', 'tenth'];
      [0.00, 0.50, 1.00, 1.50, 2.00, 2.50, 3.00, 3.50].forEach((t, idx) => { if (t >= dur - 0.12) return; b(t, idx === 0 ? 0.42 : 0.24, idx === 0 ? 0.44 : 0.24, voices[idx % voices.length]); });
      break;
    }
    case 'ACG_Stride_Cantabile_Ballad': // 微型 stride:bass 应答上方和弦
      b(0, 0.74, 0.45); if (dur > 2.05) b(2.0, 0.62, 0.34, 'fifth'); break;
    case 'ACG_Anthem_Block_Push':
      b(0, Math.min(1.48, dur), 0.48); if (dur > 2.0) b(2.0, Math.min(1.25, dur - 2.02), 0.34); break;
    case 'ACG_Open_Broken_10th': // root/10th 左手开放
      b(0, 0.82, 0.46); b(1.42, 0.58, 0.25, 'tenth'); if (dur > 2.8) b(2.78, 0.54, 0.26); break;
  }
}

// ============================================================
// Legacy family interpreter(Loop 6,2026-06-09)
// ------------------------------------------------------------
// 7 family × {chord, bass} 演绎。CODEX「renderer/interpreter 或明确 fallback contract」=此即 interpreter。
// 非 bit-MG:对拍贴 8 分格(强拍音锚),保留我们手感(texture-decision②)。纯函数无 rng → 确定性。
// ============================================================

// ★ 全部 family 按整拍网格【铺满整个 span】(span 可达 2+ 小节 = 8+ 拍;renderTextureChordHits 一次性
//   渲染全 span)→ 无 comp-continuity 空洞。每【拍位】落在 8 分格上(对拍)。
const BAR_BEATS = 4;

// ★ Gap B(2026-06-09):legacy comp/chord 的 family interpreter 已退役 —— comp 改走 MG 严格 dry
//   (mgTextureCompDry.renderTextureCompDryStrictMg,oracle 驱动)。此处只保留 bass family interpreter
//   (renderTextureBassHits 用;bass 不在 Gap B 范围,用户:只 comp/chord)。

/** legacy family → bass hit(节奏 only,音高 bassRenderer 填;铺满 span)。 */
function renderLegacyBassHits(
  family: LegacyFamily,
  textureCase: string,
  dur: number,
  b: (tRel: number, d: number, vel: number, voice?: TextureBassHit['voice']) => void,
): void {
  if (family === 'bass') {
    if (/Single_Root/i.test(textureCase)) { // 单音根音:每小节一击,铺满
      for (let off = 0; off < dur; off += BAR_BEATS) b(off, Math.min(BAR_BEATS, dur - off), 0.72);
      return;
    }
    // root/fifth 四分律动(root_octave / 5_8 / walking / boogie / slap / shuffle 等),铺满
    for (let i = 0; i < Math.ceil(dur); i++) {
      const onBeat = i % 2 === 0;
      b(i, 1, onBeat ? (i % BAR_BEATS === 0 ? 0.72 : 0.64) : 0.56, onBeat ? 'root' : 'fifth');
    }
    return;
  }
  // chord-families:根音锚(每 2 拍半音符),给 bass 托底、与强拍锁,铺满
  for (let t = 0; t < dur; t += 2) b(t, Math.min(2, dur - t), t % BAR_BEATS < 0.01 ? 0.62 : 0.56, 'root');
}
