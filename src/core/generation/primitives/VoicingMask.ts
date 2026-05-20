// ============================================================
// VoicingMask — 声部角色 bitmask 过滤(Phase 1b)
// ============================================================
//
// 设计动机:
//   PEAA 理论中"信息遮罩"(Information Masking)的工程落地。
//   Generator(HarmonyCore)永远输出完整 SATB voicing(全员就位),
//   Arranger(Conductor)按段落能量/气象决定该段允许哪些声部角色穿透。
//   实现"Intro 自然显影"等渐进效果:开头只 root,逐步解锁 3rd/5th/7th/extensions。
//
// 核心数据结构:
//   VoicingMask = number(8 位 bitmask)
//   bit 偏移即 VoiceRole 枚举值:
//     bit 0 = Root        bit 4 = Ninth
//     bit 1 = Third       bit 5 = Eleventh
//     bit 2 = Fifth       bit 6 = Thirteenth
//     bit 3 = Seventh     bit 7 = Tension
//
// 应用方式(O(n),n ≤ 7):
//   applyVoicingMask(VoicedPitch[], mask) → VoicedPitch[]
//   按位检测每 voice 的 role 是否被允许;不允许的 voice 直接丢弃。
//
// 演进时间线:
//   Phase 1b(本模块): sectionType + energyLevel 静态规则表
//   Phase 2: weather.k/t 接入(T 维度决定 ext 解锁阈值)
//   Phase 3: weather.r/g 接入(R 维度允许 Tension 偶发穿透)
//   Phase 5+: Live 模式按滚动估计动态切 mask(per-bar 而非 per-section)
//
// 约束遵从:
//   - applyVoicingMask 必须保持顺序稳定(VoicedPitch[] 升序 → 输出升序)
//   - 零 PRNG(纯位运算 + 数组过滤)
//   - 零依赖 GlobalContext
// ============================================================

import {
    GeneratedChord, SectionMetadata, SectionType, VoiceRole, VoicedPitch,
} from '../types';
import type { WeatherSampler } from '../ir/RenderContext';

// ============================================================
// VoicingMask 类型与常量
// ============================================================

/**
 * 8 位 bitmask,bit 偏移 = VoiceRole 枚举值。
 * - 1 = 该角色 voice 允许穿透
 * - 0 = 该角色 voice 被 mask 掉(从 voicing 中过滤)
 *
 * Phase 1b 起 chord.voicingMask 携带,Idiom 渲染时按此过滤 voicingTagged。
 */
export type VoicingMask = number;

/** 仅 Root 穿透 — Intro 最寒冷的"无和声"状态(C-only 单音) */
export const MASK_ROOT_ONLY: VoicingMask  = 0b00000001;

/** Root + Fifth — 早期 Intro,开放五度,无第三决定大小调色彩 */
export const MASK_ROOT_FIFTH: VoicingMask = 0b00000101;

/** Triad — Root + 3rd + 5th(大调/小调色彩显形) */
export const MASK_TRIAD: VoicingMask      = 0b00000111;

/** + 7th(爵士基础,Verse / Bridge 主力) */
export const MASK_SEVENTH: VoicingMask    = 0b00001111;

/** + 9 / 11 / 13(完整 ext,Chorus / Solo 色彩满载) */
export const MASK_EXTENDED: VoicingMask   = 0b01111111;

/** 全 8 角色允许(含 Tension 改变音)— 最大色彩 */
export const MASK_ALL: VoicingMask        = 0b11111111;

// ============================================================
// Mask 应用函数
// ============================================================

/**
 * 按 mask 过滤 VoicedPitch[](Phase 1b 主入口)。
 *
 * 复杂度: O(n),n = voicing 长度(≤ 7)。
 * 保序: 输入升序 → 输出升序(只是删除不符合 mask 的项)。
 *
 * 安全保证:即使 mask = 0(任何 voice 都不允许),也返回空数组而非崩溃。
 * 调用方负责对空结果做 fallback(Atmosphere ≥ 2 / Piano root+5th 等)。
 */
export function applyVoicingMask(
    tagged: VoicedPitch[], mask: VoicingMask,
): VoicedPitch[] {
    const out: VoicedPitch[] = [];
    for (let i = 0; i < tagged.length; i++) {
        if (((mask >> tagged[i].role) & 1) === 1) {
            out.push(tagged[i]);
        }
    }
    return out;
}

// ============================================================
// 每和弦 Mask 计算 — sectionType + energyLevel + weather
// ============================================================

/**
 * 按 sectionType + energyLevel + weather.t 决定该和弦的 voicing mask。
 *
 * 两步式:
 *   1. **基础 mask**(sectionType + energyLevel 查表):
 *      Intro/Outro/PreOutro: e≤3 ROOT_FIFTH / e 4-6 TRIAD / e 7+ SEVENTH
 *      Verse:                e≤3 TRIAD / else SEVENTH
 *      Chorus/Solo_Bridge:   e≤5 SEVENTH / else EXTENDED
 *      Bridge:               SEVENTH
 *      BuildUp:              e≤5 TRIAD / else SEVENTH
 *      Break/Breakdown:      ALL(段落级 ConductorMask 已压制)
 *      default:              SEVENTH
 *
 *   2. **Phase 2 — T 维硬切档**(用户决策):
 *      weather.t < 0.40 → 收缩一档(EXTENDED → SEVENTH → TRIAD → ROOT_FIFTH)
 *      weather.t > 0.60 → 扩展一档(ROOT_FIFTH → TRIAD → SEVENTH → EXTENDED)
 *      0.40 ≤ T ≤ 0.60  → 维持基础 mask
 *
 *      阈值选择(Phase 2 起点,待听感调):默认 4 人乐队 colorBias 平均 ~0.225
 *      (bass/drums = 0.0),T 计算后落在 [0.32, 0.62];0.40/0.60 阈值能覆盖:
 *        - Intro/Outro(T~0.32-0.38)→ tierDown(更稀疏)
 *        - NeoSoul Chorus(T~0.62)→ tierUp(EXTENDED)
 *        - Pop Verse/Chorus(T~0.42-0.54)中段保持不变
 *
 *      听感调参建议(若需要更激进):0.42/0.55;若需要更保守:0.35/0.65。
 *
 * Phase 3: weather.r(冒险)解锁 Tension bit;weather.g(律动)不影响 voicing。
 */
export function computeChordMask(
    section: SectionMetadata,
    weather: WeatherSampler,
    beatInSection: number,
): VoicingMask {
    // ① 基础 mask:sectionType × energyLevel
    const baseMask = computeBaseMask(section);

    // ② Phase 2: T 维硬切档(阈值 0.40/0.60,待听感调)
    const beat = section.startBeat + beatInSection;
    const t = weather.at(beat).t;
    if (t < 0.40) return tierDown(baseMask);
    if (t > 0.60) return tierUp(baseMask);
    return baseMask;
}

/** 第一步:不含 T 维的基础 mask 查表(便于单元测试和 Phase 3 拆解) */
function computeBaseMask(section: SectionMetadata): VoicingMask {
    const energy = section.energyLevel;
    const sectionType = section.sectionType;

    switch (sectionType) {
        case SectionType.Intro:
        case SectionType.Outro:
        case SectionType.PreOutro:
            if (energy <= 3) return MASK_ROOT_FIFTH;
            if (energy <= 6) return MASK_TRIAD;
            return MASK_SEVENTH;

        case SectionType.Verse:
            if (energy <= 3) return MASK_TRIAD;
            return MASK_SEVENTH;

        case SectionType.Chorus:
        case SectionType.Solo_Bridge:
            if (energy <= 5) return MASK_SEVENTH;
            return MASK_EXTENDED;

        case SectionType.Bridge:
            return MASK_SEVENTH;

        case SectionType.BuildUp:
            if (energy <= 5) return MASK_TRIAD;
            return MASK_SEVENTH;

        case SectionType.Break:
        case SectionType.Breakdown:
            return MASK_ALL;

        default:
            return MASK_SEVENTH;
    }
}

/**
 * Mask 等级阶梯(从稀疏到丰满,Phase 2 T 切档用):
 *   ROOT_ONLY → ROOT_FIFTH → TRIAD → SEVENTH → EXTENDED → ALL
 *
 * 切档逻辑:tierUp 升一级,tierDown 降一级。已到极值则保持。
 *
 * 注意 — 用 mask 值精确匹配做 switch,而非"或多于"(避免误升降)。
 * 非档位 mask(如自定义组合)保持原 mask。
 */
function tierUp(mask: VoicingMask): VoicingMask {
    switch (mask) {
        case MASK_ROOT_ONLY:   return MASK_ROOT_FIFTH;
        case MASK_ROOT_FIFTH:  return MASK_TRIAD;
        case MASK_TRIAD:       return MASK_SEVENTH;
        case MASK_SEVENTH:     return MASK_EXTENDED;
        case MASK_EXTENDED:    return MASK_ALL;
        default:               return mask;  // 已极值或非档位
    }
}

function tierDown(mask: VoicingMask): VoicingMask {
    switch (mask) {
        case MASK_ALL:         return MASK_EXTENDED;
        case MASK_EXTENDED:    return MASK_SEVENTH;
        case MASK_SEVENTH:     return MASK_TRIAD;
        case MASK_TRIAD:       return MASK_ROOT_FIFTH;
        case MASK_ROOT_FIFTH:  return MASK_ROOT_ONLY;
        default:               return mask;  // 已极值或非档位
    }
}

// ============================================================
// 批量应用 — Conductor 入口
// ============================================================

/**
 * 为整个 chord 序列计算并附加 voicingMask 字段(in-place 写入)。
 *
 * Phase 1b: 不在此处过滤 chord.voicingTagged / chord.voicing — mask 信息附在
 * chord 上,各 Idiom 渲染时按需 applyVoicingMask(可保留 fallback 访问完整 voicing 能力)。
 *
 * 这意味着:
 *   - chord.voicing(number[])保持 unmasked(老 Idiom 行为不变)
 *   - chord.voicingTagged(VoicedPitch[])保持 unmasked(可用作 fallback 源)
 *   - chord.voicingMask 是"建议 mask",Idiom 自行决定如何/是否消费
 *
 * 对应 Phase 1b 消费策略:
 *   - PianoAccompIdiom tertian: 读 voicingTagged.slice(1) → applyMask → fallback ≥ 1 voice
 *   - PianoAccompIdiom rootless: 读 buildRootlessRH → applyMask → fallback root+5th
 *   - AtmosphereRenderer: 读 voicingTagged.slice(1, voiceCount) → applyMask → fallback ≥ 2
 *   - 其他 Idiom(Bass/Drums)不消费 mask
 */
export function attachVoicingMasks(
    chords: GeneratedChord[],
    sections: SectionMetadata[],
    weather: WeatherSampler,
): void {
    if (chords.length === 0 || sections.length === 0) return;

    let sectionIdx = 0;
    for (let i = 0; i < chords.length; i++) {
        const chord = chords[i];
        // 推进到 chord 起点所属段落(段落按 startBeat 升序排列)
        while (sectionIdx + 1 < sections.length
            && chord.startBeat >= sections[sectionIdx + 1].startBeat) {
            sectionIdx++;
        }
        const section = sections[sectionIdx];
        const beatInSection = chord.startBeat - section.startBeat;
        chord.voicingMask = computeChordMask(section, weather, beatInSection);
    }
}
