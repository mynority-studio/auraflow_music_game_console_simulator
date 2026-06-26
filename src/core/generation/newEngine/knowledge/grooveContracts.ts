// ============================================================
// newEngine · knowledge · Groove Contract(MG 增量升级 Phase 1,源 melodygenerative@24dfd6f)
// ------------------------------------------------------------
// Groove Contract = song/section-level 的编曲身份(grid/density/comp-melody 分开 swing/ms pocket/
//   accent/articulation/texture 偏好)。**数据 + 查询在 KB**;选择由 arranger(groovePlanner)调配,
//   render 只消费。比旧 `GrooveKind` 丰富。纯数据 / 纯函数 / 确定性。
// 注:① style 用 MG 的大写 union(POP/JAZZ/BLUES/RNB/LOFI/ACG);simulator 小写 style 在 groovePlanner
//   映射。② BLUES 无独立 pool → grooveContractsForStyle 回退 POP(Phase 1 零洗牌:非 ACG 走 legacy 派生)。
//   ③ ACG pool 引用的 ACG texture case 在 Phase 2 才进 KB;此处仅数据,Phase 1 不命中。
// ============================================================

import type { TextureProfile } from './textureProfiles';

export type GrooveStyleName = 'POP' | 'JAZZ' | 'BLUES' | 'RNB' | 'LOFI' | 'ACG';
export type GrooveGrid = 'straight' | 'swing' | 'shuffle' | 'dilla' | 'rubato';
export type GrooveDensity = 'sparse' | 'medium' | 'active';
export type GrooveArticulation = 'legato' | 'short' | 'bebop' | 'ballad';

export interface PickerRandom { next(): number }

export interface GrooveContract {
  id: string;
  name: string;
  style: GrooveStyleName;
  weight: number;
  grid: GrooveGrid;
  density: GrooveDensity;
  compSwingRatio: number;       // comp/bass/drum swing 真源
  melodySwingRatio: number;     // lead/MG melody swing 真源
  bassPocketMs: [number, number];
  chordPocketMs: [number, number];
  melodyStrongPocketMs: [number, number];
  melodyWeakPocketMs: [number, number];
  velocityHumanize: number;
  accentPattern: number[];
  articulation: GrooveArticulation;
  pushProbability?: number;
  bassPattern?: string;
  preferredTextureCases?: string[];
  allowedTextureCases?: string[];
  forbiddenTextureCases?: string[];
}

const POP_GROOVES: GrooveContract[] = [
  { id: 'pop_radio_straight', name: 'POP radio straight grid', style: 'POP', weight: 4, grid: 'straight', density: 'medium', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [0, 2], chordPocketMs: [0, 4], melodyStrongPocketMs: [0, 0], melodyWeakPocketMs: [0, 0], velocityHumanize: 0.03, accentPattern: [1.0, 0.9, 1.0, 0.9], articulation: 'legato', preferredTextureCases: ['Block_Chord', 'Broken_Chord', 'Pop_Broken_8ths_Sync', 'Pop_Alberti_Lyrical'], allowedTextureCases: ['Block_Chord', 'Broken_Chord', 'Pop_Broken_8ths_Sync', 'Pop_Alberti_Lyrical', 'Pop_Anthem_Pulse', 'Pop_Half_Arp_Sweep', 'Arpeggio_Flow'], forbiddenTextureCases: ['Ambient_Reverse_Swell', 'Low_Pedal_Color_Wash'] },
  { id: 'pop_jpop_push_8ths', name: 'POP/JPOP forward eighths', style: 'POP', weight: 3, grid: 'straight', density: 'active', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [-2, 2], chordPocketMs: [-2, 3], melodyStrongPocketMs: [0, 0], melodyWeakPocketMs: [0, 0], velocityHumanize: 0.04, accentPattern: [1.04, 0.92, 1.02, 0.9], articulation: 'legato', pushProbability: 0.12, preferredTextureCases: ['Pop_Broken_8ths_Sync', 'Pop_Wave_16ths', 'Pop_Anthem_Pulse', 'Pop_Half_Arp_Sweep'], allowedTextureCases: ['Pop_Broken_8ths_Sync', 'Pop_Wave_16ths', 'Pop_Anthem_Pulse', 'Pop_Half_Arp_Sweep', 'Pop_Piano_Arp_16ths', 'Soft_Guitar_Pluck_8ths'], forbiddenTextureCases: ['Ambient_Pad_Breath', 'Ambient_Reverse_Swell', 'Low_Pedal_Color_Wash'] },
  { id: 'pop_ballad_halftime', name: 'POP ballad half-time', style: 'POP', weight: 2, grid: 'straight', density: 'sparse', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [0, 4], chordPocketMs: [2, 12], melodyStrongPocketMs: [0, 0], melodyWeakPocketMs: [0, 0], velocityHumanize: 0.07, accentPattern: [1.0, 0.86, 0.98, 0.84], articulation: 'legato', preferredTextureCases: ['HalfTime_Emotional_Pulse', 'Lyrical_Felt_Piano_Sparse', 'Lyrical_10th_Broken', 'Piano_Question_Answer'], allowedTextureCases: ['HalfTime_Emotional_Pulse', 'Lyrical_Felt_Piano_Sparse', 'Lyrical_10th_Broken', 'Piano_Question_Answer', 'Pop_Ballad_158_Sweep', 'Piano_Wide_Color_Motion', 'Ambient_Pad_Breath', 'Low_Pedal_Color_Wash'], forbiddenTextureCases: ['Pop_Wave_16ths', 'Pop_Anthem_Pulse'] },
];

const LOFI_GROOVES: GrooveContract[] = [
  { id: 'lofi_lazy_dilla', name: 'LOFI lazy Dilla pocket', style: 'LOFI', weight: 4, grid: 'dilla', density: 'medium', compSwingRatio: 0.58, melodySwingRatio: 0.54, bassPocketMs: [-2, 5], chordPocketMs: [4, 20], melodyStrongPocketMs: [0, 5], melodyWeakPocketMs: [4, 18], velocityHumanize: 0.12, accentPattern: [0.96, 0.88, 0.94, 0.86], articulation: 'legato', preferredTextureCases: ['Piano_Lofi_Dusty_Chops', 'Piano_CommonTone_Soft_Roll', 'Piano_Lofi_Late_Chord_Answer'], allowedTextureCases: ['Piano_Lofi_Dusty_Chops', 'Piano_CommonTone_Soft_Roll', 'Piano_Lofi_Late_Chord_Answer', 'Piano_HalfTime_Soft_Pulse', 'Piano_Lofi_Tape_Wobble_Arp'], forbiddenTextureCases: ['Piano_Wide_Color_Motion'] },
  { id: 'lofi_tape_late_chords', name: 'LOFI tape-late chord answers', style: 'LOFI', weight: 3, grid: 'straight', density: 'sparse', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [-2, 4], chordPocketMs: [8, 26], melodyStrongPocketMs: [0, 4], melodyWeakPocketMs: [6, 18], velocityHumanize: 0.15, accentPattern: [0.94, 0.86, 0.92, 0.84], articulation: 'legato', preferredTextureCases: ['Piano_Lofi_Late_Chord_Answer', 'Piano_Ambient_Sustain_Wash', 'Piano_Lofi_OneShot_Space'], allowedTextureCases: ['Piano_Lofi_Late_Chord_Answer', 'Piano_Ambient_Sustain_Wash', 'Piano_Lofi_OneShot_Space', 'Piano_CommonTone_Soft_Roll', 'Piano_Wide_Color_Motion'], forbiddenTextureCases: ['Piano_Lofi_Dusty_Chops'] },
  { id: 'lofi_halftime_dusty', name: 'LOFI half-time dusty pulse', style: 'LOFI', weight: 2, grid: 'dilla', density: 'sparse', compSwingRatio: 0.56, melodySwingRatio: 0.53, bassPocketMs: [-3, 5], chordPocketMs: [5, 20], melodyStrongPocketMs: [0, 4], melodyWeakPocketMs: [5, 16], velocityHumanize: 0.13, accentPattern: [0.95, 0.84, 0.91, 0.82], articulation: 'legato', preferredTextureCases: ['Piano_HalfTime_Soft_Pulse', 'Piano_Emo_Broken_10th', 'Piano_Lofi_Tape_Wobble_Arp'], allowedTextureCases: ['Piano_HalfTime_Soft_Pulse', 'Piano_Emo_Broken_10th', 'Piano_Lofi_Tape_Wobble_Arp', 'Piano_Lofi_OneShot_Space', 'Piano_Ambient_Sustain_Wash'], forbiddenTextureCases: ['Piano_Wide_Color_Motion'] },
];

const RNB_GROOVES: GrooveContract[] = [
  { id: 'rnb_neo_soul_laidback', name: 'RNB neo-soul laid-back pocket', style: 'RNB', weight: 4, grid: 'dilla', density: 'medium', compSwingRatio: 0.56, melodySwingRatio: 0.53, bassPocketMs: [-1, 5], chordPocketMs: [4, 18], melodyStrongPocketMs: [0, 5], melodyWeakPocketMs: [6, 22], velocityHumanize: 0.10, accentPattern: [0.98, 0.9, 1.0, 0.88], articulation: 'legato', bassPattern: 'rnb_neo_soul_sparse', preferredTextureCases: ['RnB_Drop2_Color_Answer', 'RnB_Quartal_Breath_Roll', 'RnB_Neo_Soul_Roll', 'RnB_Laid_Back_Groove', 'Pop_Rnb_Expensive_Add9_Quartal'], allowedTextureCases: ['RnB_Drop2_Color_Answer', 'RnB_Quartal_Breath_Roll', 'RnB_InnerTight_Wide_Color', 'RnB_Neo_Soul_Roll', 'RnB_Laid_Back_Groove', 'Pop_Rnb_Expensive_Add9_Quartal', 'Piano_Question_Answer', 'Low_Pedal_Color_Wash'], forbiddenTextureCases: ['RnB_16th_Funk_Stabs'] },
  { id: 'rnb_dilla_pocket', name: 'RNB Dilla pocket', style: 'RNB', weight: 3, grid: 'dilla', density: 'active', compSwingRatio: 0.58, melodySwingRatio: 0.54, bassPocketMs: [-2, 6], chordPocketMs: [6, 22], melodyStrongPocketMs: [0, 4], melodyWeakPocketMs: [8, 24], velocityHumanize: 0.12, accentPattern: [0.96, 0.9, 1.0, 0.88], articulation: 'legato', bassPattern: 'dilla_pocket', preferredTextureCases: ['RnB_Quartal_Breath_Roll', 'RnB_Drop2_Color_Answer', 'RnB_Laid_Back_Groove', 'RnB_Neo_Soul_Roll'], allowedTextureCases: ['RnB_Quartal_Breath_Roll', 'RnB_Drop2_Color_Answer', 'RnB_InnerTight_Wide_Color', 'RnB_Laid_Back_Groove', 'RnB_Neo_Soul_Roll', 'Pop_Rnb_Expensive_Add9_Quartal', 'Piano_Question_Answer'], forbiddenTextureCases: ['RnB_16th_Funk_Stabs', 'HalfTime_Emotional_Pulse'] },
  { id: 'rnb_gospel_triplet', name: 'RNB gospel triplet pulse', style: 'RNB', weight: 2, grid: 'shuffle', density: 'active', compSwingRatio: 0.66, melodySwingRatio: 0.66, bassPocketMs: [0, 4], chordPocketMs: [0, 10], melodyStrongPocketMs: [0, 4], melodyWeakPocketMs: [3, 12], velocityHumanize: 0.09, accentPattern: [1.0, 0.92, 1.04, 0.9], articulation: 'legato', bassPattern: 'rnb_gospel_triplet', preferredTextureCases: ['RnB_Gospel_Triplets', 'RnB_Drop2_Color_Answer', 'RnB_Neo_Soul_Roll'], allowedTextureCases: ['RnB_Gospel_Triplets', 'RnB_Drop2_Color_Answer', 'RnB_InnerTight_Wide_Color', 'RnB_Neo_Soul_Roll', 'Piano_Question_Answer'] },
  { id: 'rnb_motown_backbeat', name: 'RNB Motown backbeat', style: 'RNB', weight: 1.5, grid: 'straight', density: 'active', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [0, 3], chordPocketMs: [0, 6], melodyStrongPocketMs: [0, 3], melodyWeakPocketMs: [0, 8], velocityHumanize: 0.06, accentPattern: [1.0, 0.94, 1.02, 0.94], articulation: 'short', bassPattern: 'rnb_motown_syncopated', preferredTextureCases: ['RnB_16th_Funk_Stabs', 'RnB_Classic_Soul_Arp', 'RnB_Drop2_Color_Answer'], allowedTextureCases: ['RnB_16th_Funk_Stabs', 'RnB_Classic_Soul_Arp', 'RnB_Drop2_Color_Answer', 'Soft_Guitar_Pluck_8ths'] },
  { id: 'rnb_trap_soul_halftime', name: 'RNB trap-soul half-time', style: 'RNB', weight: 1.5, grid: 'straight', density: 'sparse', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [0, 4], chordPocketMs: [2, 14], melodyStrongPocketMs: [0, 5], melodyWeakPocketMs: [4, 16], velocityHumanize: 0.08, accentPattern: [0.98, 0.86, 1.0, 0.84], articulation: 'legato', bassPattern: 'rnb_trap_soul_halftime', preferredTextureCases: ['RnB_InnerTight_Wide_Color', 'HalfTime_Emotional_Pulse', 'Low_Pedal_Color_Wash', 'Pop_Rnb_Expensive_Add9_Quartal'], allowedTextureCases: ['RnB_InnerTight_Wide_Color', 'RnB_Drop2_Color_Answer', 'HalfTime_Emotional_Pulse', 'Low_Pedal_Color_Wash', 'Pop_Rnb_Expensive_Add9_Quartal', 'Ambient_Reverse_Swell'] },
];

const JAZZ_GROOVES: GrooveContract[] = [
  { id: 'jazz_medium_swing', name: 'JAZZ medium swing', style: 'JAZZ', weight: 4, grid: 'swing', density: 'medium', compSwingRatio: 0.66, melodySwingRatio: 0.67, bassPocketMs: [0, 4], chordPocketMs: [0, 10], melodyStrongPocketMs: [0, 3], melodyWeakPocketMs: [0, 8], velocityHumanize: 0.08, accentPattern: [1.0, 0.85, 1.05, 0.85], articulation: 'bebop', preferredTextureCases: ['Jazz_Drop_2_Comp', 'Jazz_Charleston_Comp', 'Jazz_Red_Garland_Block'], allowedTextureCases: ['Jazz_Drop_2_Comp', 'Jazz_Charleston_Comp', 'Jazz_Red_Garland_Block', 'Piano_Question_Answer'], forbiddenTextureCases: ['Ambient_Pad_Breath'] },
  { id: 'jazz_ballad_loose', name: 'JAZZ ballad loose swing', style: 'JAZZ', weight: 2, grid: 'swing', density: 'sparse', compSwingRatio: 0.58, melodySwingRatio: 0.56, bassPocketMs: [0, 6], chordPocketMs: [4, 18], melodyStrongPocketMs: [0, 6], melodyWeakPocketMs: [4, 16], velocityHumanize: 0.10, accentPattern: [0.98, 0.84, 1.02, 0.84], articulation: 'ballad', preferredTextureCases: ['Jazz_Drop_2_Comp', 'Piano_Question_Answer', 'Ambient_Pad_Breath'], allowedTextureCases: ['Jazz_Drop_2_Comp', 'Piano_Question_Answer', 'Ambient_Pad_Breath', 'Jazz_Red_Garland_Block'], forbiddenTextureCases: ['Jazz_Charleston_Comp'] },
  { id: 'jazz_bossa_straight_latin', name: 'JAZZ bossa straight latin', style: 'JAZZ', weight: 2, grid: 'straight', density: 'medium', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [0, 3], chordPocketMs: [0, 8], melodyStrongPocketMs: [0, 4], melodyWeakPocketMs: [0, 8], velocityHumanize: 0.07, accentPattern: [1.0, 0.88, 0.98, 0.88], articulation: 'legato', preferredTextureCases: ['Bossa_Piano_Arp'], allowedTextureCases: ['Bossa_Piano_Arp', 'Jazz_Drop_2_Comp'] },
];

const ACG_GROOVES: GrooveContract[] = [
  { id: 'acg_hisaishi_rubato_arp', name: 'ACG Hisaishi rubato arpeggio', style: 'ACG', weight: 4, grid: 'rubato', density: 'medium', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [-1, 4], chordPocketMs: [0, 18], melodyStrongPocketMs: [0, 8], melodyWeakPocketMs: [4, 18], velocityHumanize: 0.09, accentPattern: [1.0, 0.9, 0.96, 0.88], articulation: 'ballad', preferredTextureCases: ['Piano_TopVoice_Planing', 'ACG_Quartal_Arp_Wave', 'ACG_Open_Broken_10th', 'ACG_Stride_Cantabile_Ballad'], allowedTextureCases: ['Piano_TopVoice_Planing', 'ACG_Quartal_Arp_Wave', 'ACG_Open_Broken_10th', 'ACG_Sakamoto_LH_Arp_RH_Penta', 'ACG_Ostinato_Hook_Pulse', 'ACG_Stride_Cantabile_Ballad', 'ACG_Anthem_Block_Push', 'ACG_Pedal_Wash_Color_Drops', 'ACG_Suspended_Block_Arrival', 'ACG_Bass_Tremolo_Color'] },
  { id: 'acg_planing_wash', name: 'ACG planing color wash', style: 'ACG', weight: 2.5, grid: 'rubato', density: 'sparse', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [-1, 4], chordPocketMs: [4, 22], melodyStrongPocketMs: [0, 10], melodyWeakPocketMs: [6, 22], velocityHumanize: 0.10, accentPattern: [0.96, 0.86, 0.92, 0.84], articulation: 'ballad', preferredTextureCases: ['Piano_TopVoice_Planing', 'ACG_Pedal_Wash_Color_Drops', 'ACG_Sakamoto_LH_Arp_RH_Penta', 'ACG_Stride_Cantabile_Ballad'], allowedTextureCases: ['Piano_TopVoice_Planing', 'ACG_Pedal_Wash_Color_Drops', 'ACG_Sakamoto_LH_Arp_RH_Penta', 'ACG_Ostinato_Hook_Pulse', 'ACG_Stride_Cantabile_Ballad', 'ACG_Anthem_Block_Push', 'ACG_Open_Broken_10th', 'ACG_Quartal_Arp_Wave', 'ACG_Suspended_Block_Arrival', 'ACG_Bass_Tremolo_Color'] },
  { id: 'acg_jpop_456_drive', name: 'ACG/JPOP 4-5-6 drive', style: 'ACG', weight: 2.5, grid: 'straight', density: 'active', compSwingRatio: 0.5, melodySwingRatio: 0.5, bassPocketMs: [0, 3], chordPocketMs: [0, 8], melodyStrongPocketMs: [-4, 3], melodyWeakPocketMs: [-2, 8], velocityHumanize: 0.06, accentPattern: [1.02, 0.9, 1.0, 0.9], articulation: 'legato', preferredTextureCases: ['ACG_Ostinato_Hook_Pulse', 'ACG_Anthem_Block_Push', 'ACG_Bass_Tremolo_Color', 'ACG_Quartal_Arp_Wave', 'ACG_Suspended_Block_Arrival'], allowedTextureCases: ['ACG_Ostinato_Hook_Pulse', 'ACG_Anthem_Block_Push', 'ACG_Bass_Tremolo_Color', 'ACG_Quartal_Arp_Wave', 'ACG_Suspended_Block_Arrival', 'ACG_Open_Broken_10th', 'Piano_TopVoice_Planing', 'ACG_Sakamoto_LH_Arp_RH_Penta', 'ACG_Stride_Cantabile_Ballad', 'ACG_Pedal_Wash_Color_Drops'] },
];

export const GROOVE_CONTRACT_POOL: GrooveContract[] = [...POP_GROOVES, ...LOFI_GROOVES, ...RNB_GROOVES, ...JAZZ_GROOVES, ...ACG_GROOVES];

/** 该 style 的 contract pool(空 → 回退 POP)。 */
export function grooveContractsForStyle(style: GrooveStyleName): GrooveContract[] {
  const pool = GROOVE_CONTRACT_POOL.filter((c) => c.style === style);
  return pool.length > 0 ? pool : POP_GROOVES;
}

/** 按 weight 加权挑一条 contract(确定性:random.next() ∈ [0,1))。 */
export function pickGrooveContract(style: GrooveStyleName, random: PickerRandom): GrooveContract {
  const pool = grooveContractsForStyle(style);
  const total = pool.reduce((s, c) => s + Math.max(0, c.weight), 0);
  let roll = random.next() * total;
  for (const c of pool) { roll -= Math.max(0, c.weight); if (roll <= 0) return c; }
  return pool[pool.length - 1];
}

/** id → contract(查询/派生用;未知 → undefined)。 */
export function grooveContractById(id: string): GrooveContract | undefined {
  return GROOVE_CONTRACT_POOL.find((c) => c.id === id);
}

/** contract 对某 texture 的兼容/偏好打分(0=不允许/被禁;>0=允许,preferred/grid/density 加分)。 */
export function grooveTextureScore(contract: GrooveContract, texture: Pick<TextureProfile, 'textureCase' | 'mood'>): number {
  if (contract.allowedTextureCases && !contract.allowedTextureCases.includes(texture.textureCase)) return 0;
  if (contract.forbiddenTextureCases?.includes(texture.textureCase)) return 0;
  let score = 1;
  if (contract.preferredTextureCases?.includes(texture.textureCase)) score += 3;
  if (contract.density === 'sparse' && (texture.mood === 'ambient' || texture.mood === 'lyrical')) score += 1;
  if (contract.density === 'active' && (texture.mood === 'drive' || texture.mood === 'groove' || texture.mood === 'pocket')) score += 1;
  if (contract.grid === 'dilla' && texture.mood === 'pocket') score += 1;
  if (contract.grid === 'rubato' && (texture.mood === 'ambient' || texture.mood === 'lyrical')) score += 1;
  return score;
}

/** 据 contract 加权挑一条 texture(score>0 才入池)。无可用 → null。 */
export function pickGrooveTexture(textures: readonly TextureProfile[], contract: GrooveContract, random: PickerRandom): TextureProfile | null {
  const scored = textures.map((t) => ({ texture: t, score: grooveTextureScore(contract, t) })).filter((x) => x.score > 0);
  if (scored.length === 0) return null;
  const total = scored.reduce((s, x) => s + x.score, 0);
  let roll = random.next() * total;
  for (const x of scored) { roll -= x.score; if (roll <= 0) return x.texture; }
  return scored[scored.length - 1].texture;
}
