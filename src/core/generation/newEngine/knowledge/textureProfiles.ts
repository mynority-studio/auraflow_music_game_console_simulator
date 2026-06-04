// ============================================================
// newEngine · knowledge · TextureProfiles(段落织体选择,B-port 纯规则)
// ------------------------------------------------------------
// Provenance:port 自 melodygenerative/src/lib/styleDictionary.ts 织体段:
//   PhraseCellRole / phraseCellRole(密度曲线)/ densityForCell / energyForCell /
//   TextureProfile / _MODERN_+_LOFI_ profiles / pickTextureForBar。
// ★ 计划 §9 明示:只迁 explicit modern/lofi profile,**不迁 legacy**
//   → TEXTURE_POOL 不含 _legacyTexturesAsPool()(源里有,此处删)。
// render 层按 pickTextureForBar 结果选织体,不在此写事件。
// ============================================================

export type TextureStyleName = 'POP' | 'JAZZ' | 'BLUES' | 'RNB' | 'LOFI';
export type SectionLabel = 'INTRO' | 'VERSE' | 'PRECHORUS' | 'CHORUS' | 'BRIDGE' | 'OUTRO';

export type PhraseCellRole = 'establish' | 'develop' | 'lift' | 'cadence';

/** (barIndex,totalBars) → cell 角色。16:4×4;12:3 cell;8:2 cell;≤4:全 cadence。 */
export function phraseCellRole(barIndex: number, totalBars: number): PhraseCellRole {
  if (totalBars <= 4) return 'cadence';
  if (totalBars <= 8) {
    const half = Math.ceil(totalBars / 2);
    return barIndex < half ? 'establish' : 'cadence';
  }
  if (totalBars <= 12) {
    const third = Math.ceil(totalBars / 3);
    if (barIndex < third) return 'establish';
    if (barIndex < third * 2) return 'develop';
    return 'cadence';
  }
  const quarter = Math.floor(totalBars / 4);
  if (barIndex < quarter) return 'establish';
  if (barIndex < quarter * 2) return 'develop';
  if (barIndex < quarter * 3) return 'lift';
  return 'cadence';
}

export function phraseCellRole16(barIndex: number): PhraseCellRole {
  return phraseCellRole(barIndex, 16);
}

/** cell 角色 + 段落 → 目标密度(0.10..0.95)。 */
export function densityForCell(role: PhraseCellRole, section: SectionLabel): number {
  const base = role === 'establish' ? 0.25 : role === 'develop' ? 0.45 : role === 'lift' ? 0.65 : 0.50;
  const secMod = section === 'INTRO' ? -0.15 : section === 'OUTRO' ? -0.15 : section === 'PRECHORUS' ? 0.08 : section === 'CHORUS' ? 0.10 : section === 'BRIDGE' ? 0.05 : 0;
  return Math.max(0.10, Math.min(0.95, base + secMod));
}

export function energyForCell(role: PhraseCellRole, section: SectionLabel): number {
  return densityForCell(role, section);
}

export interface TextureProfile {
  id: string;
  textureCase: string;
  styles: TextureStyleName[];
  mood: 'ambient' | 'lyrical' | 'groove' | 'drive' | 'cadence' | 'dusty' | 'emo' | 'pocket';
  phraseRoles: PhraseCellRole[];
  densityRange: [number, number];
  energyRange: [number, number];
  avoidOnDominantChain?: boolean;
  preferOnCadence?: boolean;
  maxRepeatBars?: number;
  subStyles?: string[];
  partPolicy?: {
    bass: 'required' | 'optional' | 'silent';
    chord: 'required' | 'optional' | 'sparse';
    melodySpace: 'high' | 'medium' | 'low';
  };
  timing?: { chordLateMs: [number, number]; bassLateMs: [number, number]; velocityHumanize: number };
  preferOnLoopBack?: boolean;
}

// modern(POP/RNB/JAZZ)显式 profile。
const _MODERN_TEXTURE_PROFILES: TextureProfile[] = [
  { id: 'lyrical_felt_sparse', textureCase: 'Lyrical_Felt_Piano_Sparse', styles: ['POP', 'RNB'], mood: 'lyrical', phraseRoles: ['establish', 'develop'], densityRange: [0.15, 0.45], energyRange: [0.15, 0.50], maxRepeatBars: 8 },
  { id: 'lyrical_10th_broken', textureCase: 'Lyrical_10th_Broken', styles: ['POP'], mood: 'lyrical', phraseRoles: ['develop', 'lift'], densityRange: [0.35, 0.70], energyRange: [0.35, 0.75], maxRepeatBars: 8 },
  { id: 'ambient_pad_breath', textureCase: 'Ambient_Pad_Breath', styles: ['POP', 'RNB', 'JAZZ'], mood: 'ambient', phraseRoles: ['establish'], densityRange: [0.10, 0.35], energyRange: [0.10, 0.45], avoidOnDominantChain: true, maxRepeatBars: 4 },
  { id: 'ambient_reverse_swell', textureCase: 'Ambient_Reverse_Swell', styles: ['POP', 'RNB'], mood: 'ambient', phraseRoles: ['lift', 'cadence'], densityRange: [0.25, 0.55], energyRange: [0.40, 0.75], preferOnCadence: true, maxRepeatBars: 2 },
  { id: 'soft_guitar_pluck', textureCase: 'Soft_Guitar_Pluck_8ths', styles: ['POP', 'RNB'], mood: 'lyrical', phraseRoles: ['establish', 'develop'], densityRange: [0.25, 0.55], energyRange: [0.25, 0.60], maxRepeatBars: 8 },
  { id: 'piano_question_answer', textureCase: 'Piano_Question_Answer', styles: ['POP', 'RNB', 'JAZZ'], mood: 'lyrical', phraseRoles: ['develop', 'cadence'], densityRange: [0.15, 0.50], energyRange: [0.25, 0.65], maxRepeatBars: 4 },
  { id: 'low_pedal_wash', textureCase: 'Low_Pedal_Color_Wash', styles: ['POP', 'RNB'], mood: 'ambient', phraseRoles: ['establish', 'lift'], densityRange: [0.10, 0.40], energyRange: [0.10, 0.55], avoidOnDominantChain: true, maxRepeatBars: 4 },
  { id: 'halftime_emotional_pulse', textureCase: 'HalfTime_Emotional_Pulse', styles: ['POP', 'RNB'], mood: 'drive', phraseRoles: ['lift', 'cadence'], densityRange: [0.45, 0.80], energyRange: [0.55, 0.90], maxRepeatBars: 8 },
];

// LOFI 显式 profile(含 partPolicy/timing/subStyles 元数据 + wide-color-motion 引用)。
const _LOFI_TEXTURE_PROFILES: TextureProfile[] = [
  { id: 'lofi_piano_oneshot_space', textureCase: 'Piano_Lofi_OneShot_Space', styles: ['LOFI'], mood: 'dusty', phraseRoles: ['establish', 'cadence'], densityRange: [0.08, 0.42], energyRange: [0.10, 0.55], maxRepeatBars: 8, preferOnLoopBack: true, partPolicy: { bass: 'required', chord: 'sparse', melodySpace: 'high' }, timing: { chordLateMs: [20, 65], bassLateMs: [-8, 12], velocityHumanize: 0.12 }, subStyles: ['Lofi Warm Piano', 'Lofi Study Loop', 'Lofi Piano Hiphop'] },
  { id: 'lofi_late_chord_answer', textureCase: 'Piano_Lofi_Late_Chord_Answer', styles: ['LOFI'], mood: 'lyrical', phraseRoles: ['develop', 'cadence'], densityRange: [0.12, 0.45], energyRange: [0.15, 0.65], maxRepeatBars: 6, partPolicy: { bass: 'required', chord: 'sparse', melodySpace: 'high' }, timing: { chordLateMs: [35, 80], bassLateMs: [-5, 15], velocityHumanize: 0.14 }, subStyles: ['Lofi Emo Piano', 'Lofi Bedroom Pop', 'Lofi Rainy Rhodes'] },
  { id: 'lofi_emo_broken_10th', textureCase: 'Piano_Emo_Broken_10th', styles: ['LOFI'], mood: 'emo', phraseRoles: ['develop', 'lift'], densityRange: [0.25, 0.62], energyRange: [0.25, 0.72], maxRepeatBars: 8, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'medium' }, timing: { chordLateMs: [10, 35], bassLateMs: [-4, 10], velocityHumanize: 0.10 }, subStyles: ['Lofi Emo Piano', 'Lofi Soft Canon', 'Lofi Melancholy Minor'] },
  { id: 'lofi_ambient_sustain_wash', textureCase: 'Piano_Ambient_Sustain_Wash', styles: ['LOFI'], mood: 'ambient', phraseRoles: ['establish', 'cadence'], densityRange: [0.05, 0.30], energyRange: [0.05, 0.45], maxRepeatBars: 4, avoidOnDominantChain: true, partPolicy: { bass: 'required', chord: 'sparse', melodySpace: 'high' }, timing: { chordLateMs: [0, 35], bassLateMs: [-5, 10], velocityHumanize: 0.08 }, subStyles: ['Lofi Ambient Intro', 'Lofi Modal Float', 'Lofi Night Drive'] },
  { id: 'lofi_halftime_soft_pulse', textureCase: 'Piano_HalfTime_Soft_Pulse', styles: ['LOFI'], mood: 'pocket', phraseRoles: ['lift'], densityRange: [0.28, 0.65], energyRange: [0.45, 0.82], maxRepeatBars: 8, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'medium' }, timing: { chordLateMs: [25, 55], bassLateMs: [-10, 8], velocityHumanize: 0.13 }, subStyles: ['Lofi Piano Hiphop', 'Lofi Night Drive', 'Lofi Bedroom Pop'] },
  { id: 'lofi_dusty_chops', textureCase: 'Piano_Lofi_Dusty_Chops', styles: ['LOFI'], mood: 'dusty', phraseRoles: ['establish', 'develop'], densityRange: [0.15, 0.52], energyRange: [0.18, 0.60], maxRepeatBars: 8, partPolicy: { bass: 'required', chord: 'sparse', melodySpace: 'high' }, timing: { chordLateMs: [30, 75], bassLateMs: [-8, 12], velocityHumanize: 0.15 }, subStyles: ['Lofi Rainy Rhodes', 'Lofi Piano Hiphop', 'Lofi Warm Piano'] },
  { id: 'lofi_tape_wobble_arp_sparse', textureCase: 'Piano_Lofi_Tape_Wobble_Arp', styles: ['LOFI'], mood: 'ambient', phraseRoles: ['develop', 'lift'], densityRange: [0.25, 0.58], energyRange: [0.25, 0.70], maxRepeatBars: 4, avoidOnDominantChain: true, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'medium' }, timing: { chordLateMs: [10, 45], bassLateMs: [-6, 10], velocityHumanize: 0.16 }, subStyles: ['Lofi Minor Tape', 'Lofi Rainy Rhodes'] },
  { id: 'lofi_common_tone_soft_roll', textureCase: 'Piano_CommonTone_Soft_Roll', styles: ['LOFI'], mood: 'lyrical', phraseRoles: ['develop', 'lift', 'cadence'], densityRange: [0.22, 0.60], energyRange: [0.25, 0.70], maxRepeatBars: 6, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'medium' }, timing: { chordLateMs: [30, 70], bassLateMs: [-8, 12], velocityHumanize: 0.13 }, subStyles: ['Lofi Neo Soul Soft', 'Lofi Rainy Rhodes', 'Lofi Dorian Chill'] },
  { id: 'wide_color_motion_lofi_pop', textureCase: 'Piano_Wide_Color_Motion', styles: ['LOFI', 'POP'], mood: 'lyrical', phraseRoles: ['develop', 'lift', 'cadence'], densityRange: [0.30, 0.75], energyRange: [0.30, 0.75], maxRepeatBars: 8, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'medium' }, timing: { chordLateMs: [10, 30], bassLateMs: [-5, 8], velocityHumanize: 0.10 }, subStyles: ['Lofi Warm Piano', 'Lofi Emo Piano', 'Lofi Rainy Rhodes', 'Lofi Neo Soul Soft', 'Lofi Soft Canon', 'Pop Ballad', 'Max Martin Pop'] },
];

/** 公开池 = modern + LOFI(★ 不含 legacy,见 §9)。 */
export const TEXTURE_POOL: TextureProfile[] = [..._MODERN_TEXTURE_PROFILES, ..._LOFI_TEXTURE_PROFILES];

/** 按 style·cell 角色·density·energy·dominant chain·repeat 过滤选织体;无匹配回退同 style 全集,再无 → null。 */
export function pickTextureForBar(args: {
  style: TextureStyleName;
  phraseRole: PhraseCellRole;
  density: number;
  energy: number;
  isDominantChain: boolean;
  prevTextureId?: string;
  repeatCount?: number;
  random: { pick<T>(xs: readonly T[]): T };
}): TextureProfile | null {
  const candidates = TEXTURE_POOL.filter((t) => {
    if (!t.styles.includes(args.style)) return false;
    if (!t.phraseRoles.includes(args.phraseRole)) return false;
    if (args.density < t.densityRange[0] || args.density > t.densityRange[1]) return false;
    if (args.energy < t.energyRange[0] || args.energy > t.energyRange[1]) return false;
    if (t.avoidOnDominantChain && args.isDominantChain) return false;
    if (t.id === args.prevTextureId && (args.repeatCount ?? 0) >= (t.maxRepeatBars ?? 8)) return false;
    return true;
  });
  const pool = candidates.length > 0 ? candidates : TEXTURE_POOL.filter((t) => t.styles.includes(args.style));
  if (pool.length === 0) return null;
  return args.random.pick(pool);
}

// ============================================================
// 笼统织体(原 newEngine 引擎自带的 5 种)—— 用户定:搬进 KB 一起保存,
// 引擎本身不再带织体选择偏好。render 已能弹这 5 种;rich 17 种待 render 升级解析。
// ============================================================

/** newEngine 可渲染的 5 种笼统织体(原 InstrumentationPlan.TextureKind)。 */
export type GenericTextureKind = 'active-comp' | 'arpeggio' | 'pad' | 'sustained-block' | 'walking-bass';
export type GenericTextureYield = 'active' | 'floating';

/** 让位策略(原引擎 TEXTURE_YIELD,搬进 KB)。 */
export const GENERIC_TEXTURE_YIELD: Record<GenericTextureKind, GenericTextureYield> = {
  'active-comp': 'active', arpeggio: 'active', 'walking-bass': 'active',
  pad: 'floating', 'sustained-block': 'floating',
};

export type TextureSectionRole = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';

/** 笼统织体按段落功能的选择偏好(原引擎 TEXTURE_BY_ROLE,搬进 KB —— 引擎不再自带)。 */
const GENERIC_TEXTURE_BY_ROLE: Record<TextureSectionRole, GenericTextureKind> = {
  intro: 'pad', verse: 'arpeggio', chorus: 'active-comp', bridge: 'sustained-block', outro: 'pad',
};

/** 引擎查 KB 拿段落织体(取代引擎侧 TEXTURE_BY_ROLE)。阶段2 会换成 density/energy 驱动的 rich 选择。 */
export function pickGenericTexture(role: TextureSectionRole): GenericTextureKind {
  return GENERIC_TEXTURE_BY_ROLE[role] ?? 'active-comp';
}

/** 5 种笼统织体也以 profile 形态存进 KB(与 rich 一起),metadata 取中性宽匹配=通用兜底。 */
export const GENERIC_TEXTURE_PROFILES: TextureProfile[] = [
  { id: 'generic_active_comp', textureCase: 'active-comp', styles: ['POP', 'JAZZ', 'RNB', 'BLUES', 'LOFI'], mood: 'groove', phraseRoles: ['establish', 'develop', 'lift', 'cadence'], densityRange: [0, 1], energyRange: [0, 1] },
  { id: 'generic_arpeggio', textureCase: 'arpeggio', styles: ['POP', 'JAZZ', 'RNB', 'BLUES', 'LOFI'], mood: 'lyrical', phraseRoles: ['establish', 'develop', 'lift', 'cadence'], densityRange: [0, 1], energyRange: [0, 1] },
  { id: 'generic_pad', textureCase: 'pad', styles: ['POP', 'JAZZ', 'RNB', 'BLUES', 'LOFI'], mood: 'ambient', phraseRoles: ['establish', 'develop', 'lift', 'cadence'], densityRange: [0, 1], energyRange: [0, 1] },
  { id: 'generic_sustained_block', textureCase: 'sustained-block', styles: ['POP', 'JAZZ', 'RNB', 'BLUES', 'LOFI'], mood: 'ambient', phraseRoles: ['establish', 'develop', 'lift', 'cadence'], densityRange: [0, 1], energyRange: [0, 1] },
  { id: 'generic_walking_bass', textureCase: 'walking-bass', styles: ['POP', 'JAZZ', 'RNB', 'BLUES', 'LOFI'], mood: 'groove', phraseRoles: ['establish', 'develop', 'lift', 'cadence'], densityRange: [0, 1], energyRange: [0, 1] },
];

/** 统一织体目录 = 笼统 5 + rich 17(阶段2 的 per-bar 选择从这里挑;render 解析不了的回退笼统)。 */
export const ALL_TEXTURE_PROFILES: TextureProfile[] = [...GENERIC_TEXTURE_PROFILES, ...TEXTURE_POOL];
