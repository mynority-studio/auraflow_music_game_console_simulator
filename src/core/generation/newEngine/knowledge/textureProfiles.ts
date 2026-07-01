// ============================================================
// newEngine · knowledge · TextureProfiles(段落织体选择,B-port 纯规则)
// ------------------------------------------------------------
// Provenance:port 自 melodygenerative/src/lib/styleDictionary.ts 织体段:
//   PhraseCellRole / phraseCellRole(密度曲线)/ densityForCell / energyForCell /
//   TextureProfile / _MODERN_+_LOFI_ profiles / pickTextureForBar。
// ★ Loop 6(2026-06-09,用户决策「全量进可选择池/strict MG」):TEXTURE_POOL 现含
//   _legacyTexturesAsPool()(忠实 port 自源同名函数)→ legacy 与 modern/lofi 同权重参与
//   pickTextureForBar,每首歌织体随之变化(curated 集被 legacy 稀释,用户已确认接受)。
//   render 侧由 textureRenderer 的 family interpreter 覆盖全部 legacy case(CODEX「renderer/fallback contract」)。
// render 层按 pickTextureForBar 结果选织体,不在此写事件。
// ============================================================

export type TextureStyleName = 'POP' | 'JAZZ' | 'BLUES' | 'RNB' | 'LOFI' | 'ACG';
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
  { id: 'lofi_piano_oneshot_space', textureCase: 'Piano_Lofi_OneShot_Space', styles: ['LOFI'], mood: 'dusty', phraseRoles: ['establish', 'cadence'], densityRange: [0.08, 0.42], energyRange: [0.10, 0.55], maxRepeatBars: 8, preferOnLoopBack: true, partPolicy: { bass: 'required', chord: 'sparse', melodySpace: 'high' }, timing: { chordLateMs: [8, 30], bassLateMs: [-2, 6], velocityHumanize: 0.12 }, subStyles: ['Lofi Warm Piano', 'Lofi Study Loop', 'Lofi Piano Hiphop'] },
  { id: 'lofi_late_chord_answer', textureCase: 'Piano_Lofi_Late_Chord_Answer', styles: ['LOFI'], mood: 'lyrical', phraseRoles: ['develop', 'cadence'], densityRange: [0.12, 0.45], energyRange: [0.15, 0.65], maxRepeatBars: 6, partPolicy: { bass: 'required', chord: 'sparse', melodySpace: 'high' }, timing: { chordLateMs: [12, 40], bassLateMs: [-2, 6], velocityHumanize: 0.14 }, subStyles: ['Lofi Emo Piano', 'Lofi Bedroom Pop', 'Lofi Rainy Rhodes'] },
  { id: 'lofi_emo_broken_10th', textureCase: 'Piano_Emo_Broken_10th', styles: ['LOFI'], mood: 'emo', phraseRoles: ['develop', 'lift'], densityRange: [0.25, 0.62], energyRange: [0.25, 0.72], maxRepeatBars: 8, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'medium' }, timing: { chordLateMs: [6, 24], bassLateMs: [-2, 6], velocityHumanize: 0.10 }, subStyles: ['Lofi Emo Piano', 'Lofi Soft Canon', 'Lofi Melancholy Minor'] },
  { id: 'lofi_ambient_sustain_wash', textureCase: 'Piano_Ambient_Sustain_Wash', styles: ['LOFI'], mood: 'ambient', phraseRoles: ['establish', 'cadence'], densityRange: [0.05, 0.30], energyRange: [0.05, 0.45], maxRepeatBars: 4, avoidOnDominantChain: true, partPolicy: { bass: 'required', chord: 'sparse', melodySpace: 'high' }, timing: { chordLateMs: [0, 22], bassLateMs: [-2, 5], velocityHumanize: 0.08 }, subStyles: ['Lofi Ambient Intro', 'Lofi Modal Float', 'Lofi Night Drive'] },
  { id: 'lofi_halftime_soft_pulse', textureCase: 'Piano_HalfTime_Soft_Pulse', styles: ['LOFI'], mood: 'pocket', phraseRoles: ['lift'], densityRange: [0.28, 0.65], energyRange: [0.45, 0.82], maxRepeatBars: 8, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'medium' }, timing: { chordLateMs: [8, 28], bassLateMs: [-4, 5], velocityHumanize: 0.13 }, subStyles: ['Lofi Piano Hiphop', 'Lofi Night Drive', 'Lofi Bedroom Pop'] },
  { id: 'lofi_dusty_chops', textureCase: 'Piano_Lofi_Dusty_Chops', styles: ['LOFI'], mood: 'dusty', phraseRoles: ['establish', 'develop'], densityRange: [0.15, 0.52], energyRange: [0.18, 0.60], maxRepeatBars: 8, partPolicy: { bass: 'required', chord: 'sparse', melodySpace: 'high' }, timing: { chordLateMs: [8, 32], bassLateMs: [-3, 6], velocityHumanize: 0.15 }, subStyles: ['Lofi Rainy Rhodes', 'Lofi Piano Hiphop', 'Lofi Warm Piano'] },
  { id: 'lofi_tape_wobble_arp_sparse', textureCase: 'Piano_Lofi_Tape_Wobble_Arp', styles: ['LOFI'], mood: 'ambient', phraseRoles: ['develop', 'lift'], densityRange: [0.25, 0.58], energyRange: [0.25, 0.70], maxRepeatBars: 4, avoidOnDominantChain: true, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'medium' }, timing: { chordLateMs: [6, 28], bassLateMs: [-3, 6], velocityHumanize: 0.16 }, subStyles: ['Lofi Minor Tape', 'Lofi Rainy Rhodes'] },
  { id: 'lofi_common_tone_soft_roll', textureCase: 'Piano_CommonTone_Soft_Roll', styles: ['LOFI'], mood: 'lyrical', phraseRoles: ['develop', 'lift', 'cadence'], densityRange: [0.22, 0.60], energyRange: [0.25, 0.70], maxRepeatBars: 6, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'medium' }, timing: { chordLateMs: [8, 30], bassLateMs: [-3, 6], velocityHumanize: 0.13 }, subStyles: ['Lofi Neo Soul Soft', 'Lofi Rainy Rhodes', 'Lofi Dorian Chill'] },
  { id: 'wide_color_motion_lofi_pop', textureCase: 'Piano_Wide_Color_Motion', styles: ['LOFI', 'POP'], mood: 'lyrical', phraseRoles: ['develop', 'lift', 'cadence'], densityRange: [0.30, 0.75], energyRange: [0.30, 0.75], maxRepeatBars: 8, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'medium' }, timing: { chordLateMs: [6, 24], bassLateMs: [-3, 6], velocityHumanize: 0.10 }, subStyles: ['Lofi Warm Piano', 'Lofi Emo Piano', 'Lofi Rainy Rhodes', 'Lofi Neo Soul Soft', 'Lofi Soft Canon', 'Pop Ballad', 'Max Martin Pop'] },
];

// ★ ACG 显式 profile(久石让/坂本电影钢琴;MG 升级 Phase 2b。10 个钢琴手势 texture,忠实源 styleDictionary ACG profiles)。
const _ACG_TEXTURE_PROFILES: TextureProfile[] = [
  { id: 'topvoice_planing_roll', textureCase: 'Piano_TopVoice_Planing', styles: ['ACG'], mood: 'ambient', phraseRoles: ['establish', 'develop'], densityRange: [0.05, 0.45], energyRange: [0.05, 0.55], maxRepeatBars: 4, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'high' }, timing: { chordLateMs: [0, 18], bassLateMs: [-1, 4], velocityHumanize: 0.08 } },
  { id: 'acg_quartal_arp_wave', textureCase: 'ACG_Quartal_Arp_Wave', styles: ['ACG'], mood: 'lyrical', phraseRoles: ['develop', 'lift'], densityRange: [0.28, 0.78], energyRange: [0.25, 0.80], maxRepeatBars: 4, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'high' }, timing: { chordLateMs: [0, 16], bassLateMs: [-1, 4], velocityHumanize: 0.08 } },
  { id: 'acg_sakamoto_lh_arp_rh_penta', textureCase: 'ACG_Sakamoto_LH_Arp_RH_Penta', styles: ['ACG'], mood: 'lyrical', phraseRoles: ['establish', 'develop'], densityRange: [0.18, 0.62], energyRange: [0.15, 0.65], maxRepeatBars: 4, partPolicy: { bass: 'required', chord: 'sparse', melodySpace: 'high' }, timing: { chordLateMs: [0, 14], bassLateMs: [-1, 4], velocityHumanize: 0.08 } },
  { id: 'acg_ostinato_hook_pulse', textureCase: 'ACG_Ostinato_Hook_Pulse', styles: ['ACG'], mood: 'groove', phraseRoles: ['establish', 'develop', 'lift'], densityRange: [0.18, 0.78], energyRange: [0.18, 0.85], maxRepeatBars: 3, partPolicy: { bass: 'required', chord: 'sparse', melodySpace: 'high' }, timing: { chordLateMs: [0, 12], bassLateMs: [0, 4], velocityHumanize: 0.07 } },
  { id: 'acg_stride_cantabile_ballad', textureCase: 'ACG_Stride_Cantabile_Ballad', styles: ['ACG'], mood: 'lyrical', phraseRoles: ['establish', 'develop', 'cadence'], densityRange: [0.12, 0.70], energyRange: [0.12, 0.72], maxRepeatBars: 3, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'high' }, timing: { chordLateMs: [0, 18], bassLateMs: [-1, 4], velocityHumanize: 0.08 } },
  { id: 'acg_anthem_block_push', textureCase: 'ACG_Anthem_Block_Push', styles: ['ACG'], mood: 'drive', phraseRoles: ['develop', 'lift', 'cadence'], densityRange: [0.38, 0.95], energyRange: [0.42, 0.98], maxRepeatBars: 3, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'medium' }, timing: { chordLateMs: [0, 10], bassLateMs: [0, 3], velocityHumanize: 0.06 } },
  { id: 'acg_open_broken_10th', textureCase: 'ACG_Open_Broken_10th', styles: ['ACG'], mood: 'lyrical', phraseRoles: ['develop', 'lift'], densityRange: [0.35, 0.82], energyRange: [0.35, 0.82], maxRepeatBars: 4, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'high' }, timing: { chordLateMs: [0, 14], bassLateMs: [-1, 4], velocityHumanize: 0.08 } },
  { id: 'acg_suspended_block_arrival', textureCase: 'ACG_Suspended_Block_Arrival', styles: ['ACG'], mood: 'cadence', phraseRoles: ['develop', 'lift', 'cadence'], densityRange: [0.35, 0.88], energyRange: [0.35, 0.90], preferOnCadence: true, maxRepeatBars: 3, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'high' }, timing: { chordLateMs: [0, 18], bassLateMs: [-1, 4], velocityHumanize: 0.08 } },
  { id: 'acg_bass_tremolo_color', textureCase: 'ACG_Bass_Tremolo_Color', styles: ['ACG'], mood: 'drive', phraseRoles: ['develop', 'lift', 'cadence'], densityRange: [0.48, 0.95], energyRange: [0.50, 0.95], preferOnLoopBack: true, maxRepeatBars: 3, partPolicy: { bass: 'required', chord: 'sparse', melodySpace: 'high' }, timing: { chordLateMs: [0, 12], bassLateMs: [-1, 4], velocityHumanize: 0.07 } },
  { id: 'acg_pedal_wash_color_drops', textureCase: 'ACG_Pedal_Wash_Color_Drops', styles: ['ACG'], mood: 'ambient', phraseRoles: ['establish', 'develop', 'cadence'], densityRange: [0.10, 0.58], energyRange: [0.10, 0.62], maxRepeatBars: 4, partPolicy: { bass: 'required', chord: 'sparse', melodySpace: 'high' }, timing: { chordLateMs: [0, 18], bassLateMs: [-1, 4], velocityHumanize: 0.08 } },
];

// ★ MG full-parity Phase E(directive §3.6):当前 MG 有、simulator 缺的 POP/RNB 色彩织体 profile
//   (源 styleDictionary.ts:3340 expensive add9/quartal + drop2 color answer + inner-tight wide + quartal breath roll)。
//   metadata 忠实源(styles/mood/phraseRoles/density/energy/maxRepeatBars);partPolicy/timing 为 simulator 侧补全
//   (源无,按同类 RNB/LOFI 织体约定派生)。render 见 textureRenderer RNB_COLOR_TEXTURE_CASES(voicing-first 演绎)。
const _RNB_COLOR_TEXTURE_PROFILES: TextureProfile[] = [
  { id: 'expensive_add9_quartal_stack', textureCase: 'Pop_Rnb_Expensive_Add9_Quartal', styles: ['POP', 'RNB'], mood: 'lyrical', phraseRoles: ['establish', 'develop', 'lift', 'cadence'], densityRange: [0.20, 0.85], energyRange: [0.20, 0.85], maxRepeatBars: 8, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'medium' }, timing: { chordLateMs: [0, 16], bassLateMs: [-1, 5], velocityHumanize: 0.09 } },
  { id: 'rnb_drop2_color_answer', textureCase: 'RnB_Drop2_Color_Answer', styles: ['RNB'], mood: 'pocket', phraseRoles: ['establish', 'develop', 'lift', 'cadence'], densityRange: [0.18, 0.72], energyRange: [0.18, 0.78], maxRepeatBars: 4, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'high' }, timing: { chordLateMs: [4, 20], bassLateMs: [-1, 5], velocityHumanize: 0.10 } },
  { id: 'rnb_inner_tight_wide_color', textureCase: 'RnB_InnerTight_Wide_Color', styles: ['RNB'], mood: 'lyrical', phraseRoles: ['establish', 'develop', 'lift', 'cadence'], densityRange: [0.12, 0.62], energyRange: [0.12, 0.70], maxRepeatBars: 4, partPolicy: { bass: 'required', chord: 'sparse', melodySpace: 'high' }, timing: { chordLateMs: [4, 22], bassLateMs: [-1, 5], velocityHumanize: 0.10 } },
  { id: 'rnb_quartal_breath_roll', textureCase: 'RnB_Quartal_Breath_Roll', styles: ['RNB'], mood: 'pocket', phraseRoles: ['establish', 'develop', 'lift', 'cadence'], densityRange: [0.20, 0.80], energyRange: [0.18, 0.82], maxRepeatBars: 4, partPolicy: { bass: 'required', chord: 'required', melodySpace: 'high' }, timing: { chordLateMs: [4, 18], bassLateMs: [-1, 5], velocityHumanize: 0.10 } },
];

// ============================================================
// Legacy 织体池(Loop 6,2026-06-09)—— 忠实 port 自 styleDictionary._legacyTexturesAsPool()。
//   源:STYLE_DICTIONARY[POP/JAZZ/LOFI/RNB].primaryTextures 里【未被 modern profile 覆盖】的
//   legacy textureCase,每个派生 1 个 broad-metadata TextureProfile(任意 phraseRole / density[0,1] /
//   energy[0,1] / maxRepeatBars 16)→ 永远过 pickTextureForBar 的 filter。
//   ★ 源只迭代 POP/JAZZ/LOFI/RNB(不含 BLUES)→ Blues_* 不进池(仅由 textureRenderer 覆盖)。
//   ★ styles:各 legacy textureCase 在源 primaryTextures 里均属【单一 macro】(prefix-specific
//     或 generic-但只被一个 sub-style 引用),故各 → 单一 style(与源 merge 行为一致)。
//   mood 由名字模式近似(忠实源 _legacyTexturesAsPool 的同款判据)。
// ============================================================

/** legacy textureCase → 出现的 macro 风格(源 STYLE_DICTIONARY[*].primaryTextures 派生)。 */
const _LEGACY_TEXTURE_STYLES: Record<string, TextureStyleName[]> = {
  Pop_Alberti_Lyrical: ['POP'], Pop_Anthem_Pulse: ['POP'], Pop_Ballad_158_Sweep: ['POP'],
  Pop_Broken_8ths_Sync: ['POP'], Pop_Half_Arp_Sweep: ['POP'], Pop_Piano_Arp_16ths: ['POP'],
  Pop_Wave_16ths: ['POP'], Block_Chord: ['POP'], Broken_Chord: ['POP'], Arpeggio_Flow: ['POP'],
  Jazz_Charleston_Comp: ['JAZZ'], Jazz_Drop_2_Comp: ['JAZZ'], Jazz_Red_Garland_Block: ['JAZZ'],
  Jazz_Waltz_Hemiola: ['JAZZ'], Bossa_Piano_Arp: ['JAZZ'],
  RnB_16th_Funk_Stabs: ['RNB'], RnB_Classic_Soul_Arp: ['RNB'], RnB_Gospel_Triplets: ['RNB'],
  RnB_Laid_Back_Groove: ['RNB'], RnB_Neo_Soul_Roll: ['RNB'],
};

/** 忠实 port:源 _legacyTexturesAsPool() —— 每个 legacy textureCase 派生 broad-metadata profile。 */
function _legacyTexturesAsPool(): TextureProfile[] {
  const modernCases = new Set([..._MODERN_TEXTURE_PROFILES, ..._LOFI_TEXTURE_PROFILES].map((p) => p.textureCase));
  const out: TextureProfile[] = [];
  for (const [textureCase, styles] of Object.entries(_LEGACY_TEXTURE_STYLES)) {
    if (modernCases.has(textureCase)) continue; // 已被 modern profile 覆盖 → 跳过
    const mood: TextureProfile['mood'] =
      /^Ambient_|^Pad_|Pedal/i.test(textureCase) ? 'ambient' :
      /Stab|Funk|Boogie|Walking/i.test(textureCase) ? 'groove' :
      /Block|Arp|Piano|Roll/i.test(textureCase) ? 'lyrical' :
      'groove';
    out.push({
      id: `legacy_${textureCase.toLowerCase()}`,
      textureCase,
      styles,
      mood,
      phraseRoles: ['establish', 'develop', 'lift', 'cadence'], // broad
      densityRange: [0, 1],
      energyRange: [0, 1],
      maxRepeatBars: 16,
    });
  }
  return out;
}

const _LEGACY_TEXTURE_PROFILES: TextureProfile[] = _legacyTexturesAsPool();

/** 公开池 = modern + LOFI + ACG + RNB-color + legacy(★ Loop 6:全量 strict MG,见顶部横幅;Phase 2b 加 ACG;Phase E 加 RNB-color)。 */
export const TEXTURE_POOL: TextureProfile[] = [..._MODERN_TEXTURE_PROFILES, ..._LOFI_TEXTURE_PROFILES, ..._ACG_TEXTURE_PROFILES, ..._RNB_COLOR_TEXTURE_PROFILES, ..._LEGACY_TEXTURE_PROFILES];

/**
 * 该 textureCase 是否【设计内稀疏】(comp 连续性审计据此放宽阈值:稀疏织体的呼吸不算断层)。
 *   判据:mood ∈ {ambient, dusty}(留白型)或 densityRange 上限 ≤ 0.5(本就疏)。
 *   ★ 用于 musicalityAuditor Rule 5:稀疏织体段(如 Lyrical_Felt_Piano_Sparse / Ambient_*)
 *     的固有 1.5–2.5 拍呼吸是作者意图,不应误报 comp-continuity-gap。
 */
const _SPARSE_TEXTURE_MOODS: ReadonlySet<string> = new Set(['ambient', 'dusty']);
export function isSparseTexture(textureCase: string | undefined): boolean {
  if (!textureCase) return false;
  const p = TEXTURE_POOL.find((x) => x.textureCase === textureCase);
  if (!p) return false;
  return _SPARSE_TEXTURE_MOODS.has(p.mood) || p.densityRange[1] <= 0.5;
}

/**
 * 该 textureCase 是否【固有呼吸型】(comp 连续性放宽:稀疏 or 单音织体)。
 *   = isSparseTexture(留白/低密度) ∪ arp/roll family(逐音呼吸 —— 单音织体一次一音,
 *     pad 在场时与 pad-avoid 让位叠加 → 固有 ≤2.5 拍间隙是织体本性,非 comp 断层)。
 *   ★ 只【放宽】不收紧:block/comp/pulse/stab 等密集织体仍按基础阈值严判。
 */
export function isBreathingTexture(textureCase: string | undefined): boolean {
  if (!textureCase) return false;
  if (isSparseTexture(textureCase)) return true;
  const fam = TEXTURE_BEHAVIOR[textureCase]?.family;
  return fam === 'arp' || fam === 'roll';
}

// ============================================================
// 织体行为元数据(第二期:texture-switch 兼容性判据,docs/texture_switch_musicality_directive §3.1)
//   family/continuity/firstOnsetBeat 量化自 textureRenderer 的真实 hit 序列。
//   段级下发用 isDelayedEntryTexture 排除(首击 > 0.75 拍 = 段级常驻会每小节留洞)。
//   transition gate 用 rateTextureTransition(切换是否兼容 + 需要哪种 bridge)。
// ============================================================
export type TextureFamily = 'block' | 'arp' | 'pluck' | 'sustain' | 'answer' | 'chop' | 'roll' | 'wash';
export type TextureContinuity = 'continuous' | 'semiContinuous' | 'sparse' | 'delayedEntry';

export interface TextureBehaviorProfile {
  textureCase: string;
  family: TextureFamily;
  continuity: TextureContinuity;
  firstOnsetBeat: number; // 该织体在每个 span 内的首击拍(量化自 textureRenderer)
}

export const TEXTURE_BEHAVIOR: Record<string, TextureBehaviorProfile> = {
  // —— modern(POP/RNB/JAZZ)——
  Lyrical_Felt_Piano_Sparse: { textureCase: 'Lyrical_Felt_Piano_Sparse', family: 'block', continuity: 'semiContinuous', firstOnsetBeat: 0.15 },
  Lyrical_10th_Broken: { textureCase: 'Lyrical_10th_Broken', family: 'arp', continuity: 'continuous', firstOnsetBeat: 0.05 },
  Ambient_Pad_Breath: { textureCase: 'Ambient_Pad_Breath', family: 'wash', continuity: 'continuous', firstOnsetBeat: 0.05 },
  Ambient_Reverse_Swell: { textureCase: 'Ambient_Reverse_Swell', family: 'wash', continuity: 'delayedEntry', firstOnsetBeat: 1.75 },
  Soft_Guitar_Pluck_8ths: { textureCase: 'Soft_Guitar_Pluck_8ths', family: 'pluck', continuity: 'semiContinuous', firstOnsetBeat: 0.02 },
  Piano_Question_Answer: { textureCase: 'Piano_Question_Answer', family: 'answer', continuity: 'delayedEntry', firstOnsetBeat: 2.0 },
  Low_Pedal_Color_Wash: { textureCase: 'Low_Pedal_Color_Wash', family: 'wash', continuity: 'continuous', firstOnsetBeat: 0.25 },
  HalfTime_Emotional_Pulse: { textureCase: 'HalfTime_Emotional_Pulse', family: 'block', continuity: 'semiContinuous', firstOnsetBeat: 0.0 },
  // —— LOFI ——
  Piano_Lofi_OneShot_Space: { textureCase: 'Piano_Lofi_OneShot_Space', family: 'sustain', continuity: 'sparse', firstOnsetBeat: 0.025 },
  Piano_Lofi_Late_Chord_Answer: { textureCase: 'Piano_Lofi_Late_Chord_Answer', family: 'answer', continuity: 'delayedEntry', firstOnsetBeat: 2.04 },
  Piano_Emo_Broken_10th: { textureCase: 'Piano_Emo_Broken_10th', family: 'arp', continuity: 'continuous', firstOnsetBeat: 0.02 },
  Piano_Ambient_Sustain_Wash: { textureCase: 'Piano_Ambient_Sustain_Wash', family: 'wash', continuity: 'continuous', firstOnsetBeat: 0.02 },
  Piano_HalfTime_Soft_Pulse: { textureCase: 'Piano_HalfTime_Soft_Pulse', family: 'block', continuity: 'semiContinuous', firstOnsetBeat: 0.025 },
  Piano_Lofi_Dusty_Chops: { textureCase: 'Piano_Lofi_Dusty_Chops', family: 'chop', continuity: 'sparse', firstOnsetBeat: 0.58 },
  Piano_Lofi_Tape_Wobble_Arp: { textureCase: 'Piano_Lofi_Tape_Wobble_Arp', family: 'arp', continuity: 'semiContinuous', firstOnsetBeat: 0.02 },
  Piano_Wide_Color_Motion: { textureCase: 'Piano_Wide_Color_Motion', family: 'roll', continuity: 'continuous', firstOnsetBeat: 0.05 },
  Piano_CommonTone_Soft_Roll: { textureCase: 'Piano_CommonTone_Soft_Roll', family: 'roll', continuity: 'continuous', firstOnsetBeat: 0.05 },
  // —— legacy(Loop 6,2026-06-09):family/firstOnset 量化自 textureRenderer 的 family interpreter;
  //    全部首击 ≤ 0.5 拍(非 delayed-entry)→ 段级常驻不留洞,可与 modern/lofi 同样下发。 ——
  Pop_Alberti_Lyrical: { textureCase: 'Pop_Alberti_Lyrical', family: 'arp', continuity: 'continuous', firstOnsetBeat: 0.0 },
  Pop_Anthem_Pulse: { textureCase: 'Pop_Anthem_Pulse', family: 'block', continuity: 'continuous', firstOnsetBeat: 0.0 },
  // ★ Gap B(2026-06-09):firstOnsetBeat 同步到 MG oracle 实采首击(strict-dry comp 真实首拍)。
  Pop_Ballad_158_Sweep: { textureCase: 'Pop_Ballad_158_Sweep', family: 'arp', continuity: 'delayedEntry', firstOnsetBeat: 1.5 },
  Pop_Broken_8ths_Sync: { textureCase: 'Pop_Broken_8ths_Sync', family: 'arp', continuity: 'continuous', firstOnsetBeat: 0.5 },
  Pop_Half_Arp_Sweep: { textureCase: 'Pop_Half_Arp_Sweep', family: 'arp', continuity: 'continuous', firstOnsetBeat: 0.0 },
  Pop_Piano_Arp_16ths: { textureCase: 'Pop_Piano_Arp_16ths', family: 'arp', continuity: 'continuous', firstOnsetBeat: 0.5 },
  Pop_Wave_16ths: { textureCase: 'Pop_Wave_16ths', family: 'block', continuity: 'continuous', firstOnsetBeat: 0.0 },
  Block_Chord: { textureCase: 'Block_Chord', family: 'block', continuity: 'semiContinuous', firstOnsetBeat: 0.0 },
  Broken_Chord: { textureCase: 'Broken_Chord', family: 'arp', continuity: 'continuous', firstOnsetBeat: 0.0 },
  Arpeggio_Flow: { textureCase: 'Arpeggio_Flow', family: 'arp', continuity: 'continuous', firstOnsetBeat: 0.0 },
  Jazz_Charleston_Comp: { textureCase: 'Jazz_Charleston_Comp', family: 'chop', continuity: 'semiContinuous', firstOnsetBeat: 0.0 },
  Jazz_Drop_2_Comp: { textureCase: 'Jazz_Drop_2_Comp', family: 'chop', continuity: 'semiContinuous', firstOnsetBeat: 0.0 },
  Jazz_Red_Garland_Block: { textureCase: 'Jazz_Red_Garland_Block', family: 'block', continuity: 'semiContinuous', firstOnsetBeat: 0.0 },
  Jazz_Waltz_Hemiola: { textureCase: 'Jazz_Waltz_Hemiola', family: 'chop', continuity: 'semiContinuous', firstOnsetBeat: 0.0 },
  Bossa_Piano_Arp: { textureCase: 'Bossa_Piano_Arp', family: 'arp', continuity: 'semiContinuous', firstOnsetBeat: 0.5 },
  RnB_16th_Funk_Stabs: { textureCase: 'RnB_16th_Funk_Stabs', family: 'chop', continuity: 'semiContinuous', firstOnsetBeat: 0.25 },
  RnB_Classic_Soul_Arp: { textureCase: 'RnB_Classic_Soul_Arp', family: 'arp', continuity: 'continuous', firstOnsetBeat: 0.0 },
  RnB_Gospel_Triplets: { textureCase: 'RnB_Gospel_Triplets', family: 'chop', continuity: 'semiContinuous', firstOnsetBeat: 0.0 },
  RnB_Laid_Back_Groove: { textureCase: 'RnB_Laid_Back_Groove', family: 'chop', continuity: 'semiContinuous', firstOnsetBeat: 0.0 },
  RnB_Neo_Soul_Roll: { textureCase: 'RnB_Neo_Soul_Roll', family: 'roll', continuity: 'continuous', firstOnsetBeat: 0.05 },
  // —— RNB-color(Phase E,directive §3.6):firstOnset=0(chord 从拍点起,非 delayed-entry)→ 可段级常驻。 ——
  Pop_Rnb_Expensive_Add9_Quartal: { textureCase: 'Pop_Rnb_Expensive_Add9_Quartal', family: 'block', continuity: 'continuous', firstOnsetBeat: 0.0 },
  RnB_Drop2_Color_Answer: { textureCase: 'RnB_Drop2_Color_Answer', family: 'answer', continuity: 'semiContinuous', firstOnsetBeat: 0.0 },
  RnB_InnerTight_Wide_Color: { textureCase: 'RnB_InnerTight_Wide_Color', family: 'answer', continuity: 'semiContinuous', firstOnsetBeat: 0.0 },
  RnB_Quartal_Breath_Roll: { textureCase: 'RnB_Quartal_Breath_Roll', family: 'roll', continuity: 'continuous', firstOnsetBeat: 0.0 },
  // —— ACG(MG 升级 Phase 2b):firstOnset = 织体最早出声(bass 全从 0 起 → 无 delayed-entry 留洞);
  //    稀疏型靠 mood/density 走 isSparseTexture 放宽 comp 连续性审计。 ——
  Piano_TopVoice_Planing: { textureCase: 'Piano_TopVoice_Planing', family: 'roll', continuity: 'sparse', firstOnsetBeat: 0.10 },
  ACG_Quartal_Arp_Wave: { textureCase: 'ACG_Quartal_Arp_Wave', family: 'arp', continuity: 'continuous', firstOnsetBeat: 0.12 },
  ACG_Sakamoto_LH_Arp_RH_Penta: { textureCase: 'ACG_Sakamoto_LH_Arp_RH_Penta', family: 'arp', continuity: 'sparse', firstOnsetBeat: 0.0 },
  ACG_Ostinato_Hook_Pulse: { textureCase: 'ACG_Ostinato_Hook_Pulse', family: 'arp', continuity: 'continuous', firstOnsetBeat: 0.0 },
  ACG_Stride_Cantabile_Ballad: { textureCase: 'ACG_Stride_Cantabile_Ballad', family: 'block', continuity: 'semiContinuous', firstOnsetBeat: 0.0 },
  ACG_Anthem_Block_Push: { textureCase: 'ACG_Anthem_Block_Push', family: 'block', continuity: 'continuous', firstOnsetBeat: 0.0 },
  ACG_Open_Broken_10th: { textureCase: 'ACG_Open_Broken_10th', family: 'arp', continuity: 'continuous', firstOnsetBeat: 0.0 },
  ACG_Suspended_Block_Arrival: { textureCase: 'ACG_Suspended_Block_Arrival', family: 'block', continuity: 'semiContinuous', firstOnsetBeat: 0.0 },
  ACG_Bass_Tremolo_Color: { textureCase: 'ACG_Bass_Tremolo_Color', family: 'roll', continuity: 'continuous', firstOnsetBeat: 0.0 },
  ACG_Pedal_Wash_Color_Drops: { textureCase: 'ACG_Pedal_Wash_Color_Drops', family: 'wash', continuity: 'sparse', firstOnsetBeat: 0.0 },
};

export function textureBehavior(textureCase: string): TextureBehaviorProfile | undefined {
  return TEXTURE_BEHAVIOR[textureCase];
}
export function firstOnsetBeat(textureCase: string): number {
  return TEXTURE_BEHAVIOR[textureCase]?.firstOnsetBeat ?? 0;
}
/** 首击 > 0.75 拍 = delayed-entry:段级常驻会每小节留洞 → 器配层段级下发排除。 */
export function isDelayedEntryTexture(textureCase: string): boolean {
  return firstOnsetBeat(textureCase) > 0.75;
}

// delayed-entry 织体集(从 behavior 派生:含 Q&A / Reverse_Swell / Lofi_Late_Chord_Answer)。
export const DELAYED_ENTRY_TEXTURES: ReadonlySet<string> = new Set(
  Object.values(TEXTURE_BEHAVIOR).filter((b) => b.firstOnsetBeat > 0.75).map((b) => b.textureCase),
);

export type TextureTransitionRating = 'allow' | 'allowWithBridge' | 'avoid';
export type TextureBridge = 'none' | 'carryTail' | 'pickupChord' | 'downbeatAnchor';
export interface TextureTransitionVerdict { rating: TextureTransitionRating; bridge: TextureBridge }

/**
 * 织体切换兼容性(directive §3.1 硬规则):
 *   · → delayedEntry:首击晚 → allowWithBridge(downbeatAnchor 在新段首拍补轻 shell)。
 *   · wash/sustain → chop/pluck:断点风险 → allowWithBridge(carryTail 延上一击到边界)。
 *   · 其余(continuous↔continuous / arp→arp/roll …)→ allow。
 */
export function rateTextureTransition(from: string, to: string): TextureTransitionVerdict {
  const bf = textureBehavior(from);
  const bt = textureBehavior(to);
  if (!bf || !bt) return { rating: 'allow', bridge: 'none' };
  if (from === to) return { rating: 'allow', bridge: 'none' };
  if (bt.continuity === 'delayedEntry') return { rating: 'allowWithBridge', bridge: 'downbeatAnchor' };
  if ((bf.family === 'wash' || bf.family === 'sustain') && (bt.family === 'chop' || bt.family === 'pluck')) {
    return { rating: 'allowWithBridge', bridge: 'carryTail' };
  }
  return { rating: 'allow', bridge: 'none' };
}

/** 按 style·cell 角色·density·energy·dominant chain·repeat 过滤选织体;无匹配回退同 style 全集,再无 → null。 */
export function pickTextureForBar(args: {
  style: TextureStyleName;
  phraseRole: PhraseCellRole;
  density: number;
  energy: number;
  isDominantChain: boolean;
  prevTextureId?: string;
  repeatCount?: number;
  exclude?: ReadonlySet<string>; // 排除的 textureCase(段级下发排除 delayed-entry)
  random: { pick<T>(xs: readonly T[]): T };
}): TextureProfile | null {
  const allowed = (t: TextureProfile) => !args.exclude || !args.exclude.has(t.textureCase);
  const candidates = TEXTURE_POOL.filter((t) => {
    if (!allowed(t)) return false;
    if (!t.styles.includes(args.style)) return false;
    if (!t.phraseRoles.includes(args.phraseRole)) return false;
    if (args.density < t.densityRange[0] || args.density > t.densityRange[1]) return false;
    if (args.energy < t.energyRange[0] || args.energy > t.energyRange[1]) return false;
    if (t.avoidOnDominantChain && args.isDominantChain) return false;
    if (t.id === args.prevTextureId && (args.repeatCount ?? 0) >= (t.maxRepeatBars ?? 8)) return false;
    return true;
  });
  const pool = candidates.length > 0 ? candidates : TEXTURE_POOL.filter((t) => t.styles.includes(args.style) && allowed(t));
  if (pool.length === 0) return null;
  return args.random.pick(pool);
}

// ============================================================
// ★ MG full-parity Phase E(directive §3.7)— GrooveContract-aware texture 选择
// ------------------------------------------------------------
// 当前 MG 用 pickTextureForBarWithGroove / pickAcgTextureForBar 让 texture 选择消费 GrooveContract 的
//   preferred/allowed/forbidden + density/grid 偏好。simulator 段级 texture 选择此前走 plain pickTextureForBar
//   (忽略 contract → 选中可能违背偏好甚至撞 forbidden)。这里港 MG contract-aware 打分 + 加权抽样:
//   · 非 allowed → 0;forbidden → 0;preferred → +3;density/grid×mood 匹配 → +1。
//   · 加权抽样【恰一次 .next() draw】(与 pickTextureForBar 的 .pick 同为一步 gen)→ 不扰下游 rng 序列,只改选中织体。
//   ★ ACG 走同一 API(非 ACG-only):ACG GrooveContract 的 allowed 集 = 久石让/坂本宽松钢琴织体 →
//     contract-aware 天然把 ACG 限制在 spacious 集,不回退 generic dense comp(§3.7 验收)。
//     MG 的 per-bar pickAcgTextureForBar(逐和弦功能偏好)在 simulator【段级】texture 架构下折叠进
//     contract preferred/allowed + 段级 isDominantChain(架构差异:simulator 段级非逐 bar)。
//   ★ legacy contract(BLUES/无 rng,无 preferred/allowed)→ 全 score=1 → uniform = 旧行为(零洗牌兼容)。
// ============================================================

/** GrooveContract 中 texture 选择需要的字段(结构化,避免 knowledge 内循环 import;GrooveContract 结构兼容)。 */
export interface GrooveTextureContract {
  preferredTextureCases?: readonly string[];
  allowedTextureCases?: readonly string[];
  forbiddenTextureCases?: readonly string[];
  density?: string; // 'sparse' | 'medium' | 'active'
  grid?: string;    // GrooveGrid('straight'|'swing'|'shuffle'|'dilla'|'rubato'…)
}

/** texture 对 contract 的契合分(忠实 MG grooveTextureScore):非 allowed/forbidden=0;preferred +3;density/grid×mood +1。 */
export function grooveTextureScore(contract: GrooveTextureContract, texture: Pick<TextureProfile, 'textureCase' | 'mood'>): number {
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

/** contract 加权抽样【恰一次 .next() draw】;全 0(都非 allowed/被 forbidden)→ uniform 兜底(仍一次 draw)。 */
export function pickGrooveTexture(
  pool: readonly TextureProfile[],
  contract: GrooveTextureContract,
  random: { next(): number },
): TextureProfile | null {
  if (pool.length === 0) return null;
  const scored = pool.map((t) => ({ t, s: grooveTextureScore(contract, t) })).filter((x) => x.s > 0);
  if (scored.length === 0) return pool[Math.floor(random.next() * pool.length)]; // 全被排除 → uniform(1 draw)
  const total = scored.reduce((sum, x) => sum + x.s, 0);
  let roll = random.next() * total; // ★ 恰一次 draw(与 pickTextureForBar .pick 同步)
  for (const x of scored) { roll -= x.s; if (roll <= 0) return x.t; }
  return scored[scored.length - 1].t;
}

/** contract-aware texture 选择(同 pickTextureForBar 的 strict 过滤 + 同 style 回退,但用 contract 加权抽样)。
 *  无 contract → 退回 plain pickTextureForBar(向后兼容)。恰一次 rng draw,不扰下游序列。 */
export function pickTextureForBarWithGroove(args: {
  style: TextureStyleName;
  phraseRole: PhraseCellRole;
  density: number;
  energy: number;
  isDominantChain: boolean;
  contract?: GrooveTextureContract;
  prevTextureId?: string;
  repeatCount?: number;
  exclude?: ReadonlySet<string>;
  random: { next(): number; pick<T>(xs: readonly T[]): T };
}): TextureProfile | null {
  if (!args.contract) return pickTextureForBar(args);
  const allowed = (t: TextureProfile) => !args.exclude || !args.exclude.has(t.textureCase);
  const candidates = TEXTURE_POOL.filter((t) => {
    if (!allowed(t)) return false;
    if (!t.styles.includes(args.style)) return false;
    if (!t.phraseRoles.includes(args.phraseRole)) return false;
    if (args.density < t.densityRange[0] || args.density > t.densityRange[1]) return false;
    if (args.energy < t.energyRange[0] || args.energy > t.energyRange[1]) return false;
    if (t.avoidOnDominantChain && args.isDominantChain) return false;
    if (t.id === args.prevTextureId && (args.repeatCount ?? 0) >= (t.maxRepeatBars ?? 8)) return false;
    return true;
  });
  const pool = candidates.length > 0 ? candidates : TEXTURE_POOL.filter((t) => t.styles.includes(args.style) && allowed(t));
  return pickGrooveTexture(pool, args.contract, args.random);
}

// ============================================================
// ★ ACG 逐-bar 织体选择器(MG bass/comp/lead fidelity directive §4)—— 忠实 port MG pickAcgTextureForBar。
// ------------------------------------------------------------
// MG ACG comp 是【逐 bar 换钢琴手势】(每首 6-7 种循环:establish/develop/lift/cadence 相位 + T/S/D 功能 +
//   loop 边界 + 首句 air + 曲末 → 各有偏好 preferred 列表)。simulator 此前把它折叠成【段级 2 槽】(§3.7 架构差异)
//   → 听感与 MG 差最大。此函数把 per-bar 逻辑接回:每 span 按上下文选一个具名手势 → comp 逐-bar 呼吸。
// ============================================================

/** ACG 逐-bar fallback 手势(忠实 MG acgFallbackTextureForRole:loop 边界/功能/相位 → 具名 case)。 */
function acgFallbackTextureForRole(role: PhraseCellRole, func: 'T' | 'S' | 'D', isLoopBoundary: boolean): string {
  if (isLoopBoundary) return 'ACG_Suspended_Block_Arrival';
  if (func === 'D') return 'ACG_Suspended_Block_Arrival';
  if (func === 'S') return role === 'establish' ? 'ACG_Ostinato_Hook_Pulse' : 'ACG_Quartal_Arp_Wave';
  if (role === 'establish') return 'ACG_Stride_Cantabile_Ballad';
  if (role === 'develop') return 'ACG_Open_Broken_10th';
  if (role === 'lift') return 'ACG_Quartal_Arp_Wave';
  return 'ACG_Pedal_Wash_Color_Drops';
}

/** textureCase → TextureProfile(池内查;无则合成 fallback profile,保 render 能弹)。 */
function acgTextureProfileForCase(textureCase: string, role: PhraseCellRole): TextureProfile {
  return TEXTURE_POOL.find((t) => t.styles.includes('ACG') && t.textureCase === textureCase) ?? {
    id: `fallback_${textureCase}`, textureCase, styles: ['ACG'], mood: 'lyrical', phraseRoles: [role],
    densityRange: [0, 1], energyRange: [0, 1], timing: { chordLateMs: [4, 18], bassLateMs: [-2, 4], velocityHumanize: 0.1 },
  };
}

/** MG pickAcgTextureForBar 忠实 port:按 bar 相位 + 和声功能 + loop 边界 + 首句/曲末 选 ACG 具名手势。 */
export function pickAcgTextureForBar(args: {
  barIndex: number;
  totalBars: number;
  sectionLabel: SectionLabel;
  func: 'T' | 'S' | 'D';
  nextFunc: 'T' | 'S' | 'D' | null;
  prevTextureId?: string;
  repeatCount: number;
  contract?: GrooveTextureContract;
  random: { next(): number; pick<T>(xs: readonly T[]): T };
}): TextureProfile {
  const role = phraseCellRole(args.barIndex, args.totalBars);
  const density = densityForCell(role, args.sectionLabel);
  const energy = energyForCell(role, args.sectionLabel);
  const isSongEnd = args.barIndex === args.totalBars - 1;
  const isLoopBoundary = !isSongEnd && (((args.barIndex + 1) % 4 === 0) || ((args.barIndex + 1) % 8 === 0));
  const isDominantChain = args.func === 'D' || args.nextFunc === 'D';
  const firstPhraseAir = args.barIndex === 0 && !isSongEnd;

  const preferred =
    firstPhraseAir ? ['ACG_Stride_Cantabile_Ballad', 'ACG_Ostinato_Hook_Pulse', 'ACG_Pedal_Wash_Color_Drops', 'ACG_Sakamoto_LH_Arp_RH_Penta', 'Piano_TopVoice_Planing'] :
    isSongEnd ? ['ACG_Suspended_Block_Arrival', 'ACG_Pedal_Wash_Color_Drops', 'Piano_TopVoice_Planing'] :
    isLoopBoundary ? ['ACG_Bass_Tremolo_Color', 'ACG_Anthem_Block_Push', 'ACG_Suspended_Block_Arrival', 'ACG_Pedal_Wash_Color_Drops'] :
    args.func === 'D' ? ['ACG_Suspended_Block_Arrival', 'ACG_Anthem_Block_Push', 'ACG_Open_Broken_10th'] :
    args.func === 'S' ? ['ACG_Quartal_Arp_Wave', 'ACG_Ostinato_Hook_Pulse', 'ACG_Open_Broken_10th', 'Piano_TopVoice_Planing'] :
    role === 'establish' ? ['ACG_Stride_Cantabile_Ballad', 'ACG_Ostinato_Hook_Pulse', 'Piano_TopVoice_Planing', 'ACG_Pedal_Wash_Color_Drops', 'ACG_Sakamoto_LH_Arp_RH_Penta'] :
    role === 'develop' ? ['ACG_Open_Broken_10th', 'ACG_Ostinato_Hook_Pulse', 'ACG_Quartal_Arp_Wave', 'ACG_Sakamoto_LH_Arp_RH_Penta', 'ACG_Stride_Cantabile_Ballad'] :
    role === 'lift' ? ['ACG_Anthem_Block_Push', 'ACG_Quartal_Arp_Wave', 'ACG_Bass_Tremolo_Color', 'ACG_Open_Broken_10th', 'ACG_Ostinato_Hook_Pulse'] :
    ['ACG_Suspended_Block_Arrival', 'ACG_Anthem_Block_Push', 'ACG_Bass_Tremolo_Color', 'ACG_Pedal_Wash_Color_Drops'];

  const candidates = preferred
    .map((tc) => TEXTURE_POOL.find((t) => t.styles.includes('ACG') && t.textureCase === tc))
    .filter((t): t is TextureProfile => {
      if (!t) return false;
      if (!t.phraseRoles.includes(role)) return false;
      if (density < t.densityRange[0] || density > t.densityRange[1]) return false;
      if (energy < t.energyRange[0] || energy > t.energyRange[1]) return false;
      if (t.avoidOnDominantChain && isDominantChain) return false;
      if (t.id === args.prevTextureId && args.repeatCount >= (t.maxRepeatBars ?? 8)) return false;
      return true;
    });

  const groovePicked = args.contract ? pickGrooveTexture(candidates, args.contract as never, args.random) : null;
  const picked = candidates.length > 0
    ? (groovePicked ?? args.random.pick(candidates))
    : pickTextureForBarWithGroove({ style: 'ACG', phraseRole: role, density, energy, isDominantChain, contract: args.contract, prevTextureId: args.prevTextureId, repeatCount: args.repeatCount, random: args.random });
  return picked ?? acgTextureProfileForCase(acgFallbackTextureForRole(role, args.func, isLoopBoundary), role);
}

// ⚠️ LOFI 逐-bar 织体(MG pickLofiTextureForBar)暂不移植:LOFI 织体稀疏(OneShot/sparse),逐-bar 切会破
//   comp 连续性(comp-continuity-gap,即段级架构当初专门修的"伴奏突发洞")→ 需先港 MG bridge/carryTail
//   连续性处理(rateTextureTransition allowWithBridge/downbeatAnchor)才能安全逐-bar。次级待办,当前 LOFI 保段级。

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
