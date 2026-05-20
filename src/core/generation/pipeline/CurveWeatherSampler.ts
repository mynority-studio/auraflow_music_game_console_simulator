// ============================================================
// CurveWeatherSampler — 5 维气象曲线采样器(Phase 2)
// ============================================================
//
// 替代 ConstantWeatherSampler:每段一个 anchor(WeatherSnapshot)+ 段间
// 80/20 持有/过渡线性插值。零 PRNG 消耗(纯派生自 section + style + persona)。
//
// 设计要点:
//   1. **加权和模型**(用户决策):每维 anchor = sectionBase·w1 + styleBase·w2 + personaBase·w3
//      权重对每维各异,详见 §K/T/S/R/G 各自函数
//   2. **80/20 段间插值**(用户决策):
//      段内前 80% 拍持有 anchor 不变;后 20% 拍线性过渡到 next section anchor。
//      段中段稳定,边界自然过渡。
//   3. **Anti-fossilization 噪声 Phase 3 加**(用户决策):Phase 2 是纯曲线 baseline。
//   4. **Pop R 硬钳到 ≤ 0.2**(防止 pop 歌突然 outside)。
//   5. **零 PRNG / 纯派生**:CurveWeatherSampler 构造期不消耗 PRNG,
//      不破 D-5 锁帧。所有"随机感"来自风格 × 段落 × persona 的组合多样性。
//
// Anti-pattern(已排除):
//   - 不用全段渐进(违反用户决策,Chorus 头一拍突变会让 hook 不锐利)
//   - 不用 PRNG noise(违反用户决策且破 D-5)
//   - 不在 sampler 内做 weather → mask 转换(那是 VoicingMask.computeChordMask 职责)
//
// Phase 3 演进:
//   - hash-based wobble 注入(deterministic anti-fossilization)
//   - Idiom 算法层全面消费 K/T/S/R/G
//   - per-section anchor 改为 per-musician-assignment anchor(同段不同乐手有不同 anchor)
//
// 关联规则:
//   - cross_sync_rule.md §1.8 RenderContext 字段(WeatherSnapshot 字段变更触发)
//   - cross_sync_rule.md §1.6 StyleId 顺序(STYLE_ANCHORS 索引需对齐)
// ============================================================

import {
    ActiveMusician, MusicianPersona, SectionMetadata, SectionType,
} from '../types';
import { StyleId } from '../config/StyleFlags';
import type { WeatherSampler, WeatherSnapshot } from '../ir/RenderContext';

// ============================================================
// 常量 — Style / Section anchor 表(Phase 2 凭直觉值,待听感调)
// ============================================================

/** 段内"过渡段比例"(0.8 = 后 20% 过渡) */
const TRANSITION_RATIO = 0.8;

/** Pop 风格 R 硬钳上限(防止 outside) */
const POP_R_CLAMP = 0.2;

/** persona 缺省值(数组为空 / 字段缺失时) */
const PERSONA_DEFAULT_K = 0.5;  // syncopationAssault 缺省
const PERSONA_DEFAULT_T = 0.5;  // colorBias 缺省
const PERSONA_DEFAULT_S = 1.0;  // pianoPedalRatio 缺省(钢琴族裔自然踏板)
const PERSONA_DEFAULT_R = 0.0;  // signatureLickProb 缺省
const PERSONA_DEFAULT_G = 0.5;  // bouncePreference 缺省

// Style anchor 表(索引按 StyleId enum:0=Pop, 1=Jazz, 2=NeoSoul)
// 改 StyleId 顺序需同步本表(cross_sync_rule §1.6)
const STYLE_K_BASE: readonly number[] = [0.55, 0.45, 0.50];
const STYLE_T_BASE: readonly number[] = [0.45, 0.60, 0.75];
const STYLE_S_BASE: readonly number[] = [0.35, 0.55, 0.65];
const STYLE_R_BASE: readonly number[] = [0.05, 0.50, 0.55];
const STYLE_G_BASE: readonly number[] = [0.35, 0.60, 0.78];

// ============================================================
// CurveWeatherSampler 主类
// ============================================================

interface SectionAnchor {
    snapshot: WeatherSnapshot;
    startBeat: number;
    endBeat: number;
}

export class CurveWeatherSampler implements WeatherSampler {
    private readonly anchors: SectionAnchor[];

    constructor(
        sections: SectionMetadata[],
        styleId: StyleId,
        activeMusicians: ActiveMusician[],
    ) {
        this.anchors = [];
        for (let i = 0; i < sections.length; i++) {
            this.anchors.push({
                snapshot: computeSectionAnchor(sections[i], styleId, activeMusicians),
                startBeat: sections[i].startBeat,
                endBeat: sections[i].endBeat,
            });
        }
    }

    public at(beat: number): WeatherSnapshot {
        const n = this.anchors.length;
        if (n === 0) return { k: 0.5, t: 0.5, s: 0.5, r: 0.3, g: 0.5 };

        // 找 beat 所属 section(线性扫,n 通常 ≤ 12 段)
        let sIdx = 0;
        for (let i = 0; i < n; i++) {
            if (beat < this.anchors[i].endBeat) { sIdx = i; break; }
            sIdx = i;  // 超过最后段尾,持最后段 anchor
        }
        const cur = this.anchors[sIdx];

        // 80/20 插值规则:前 80% 持有 cur.snapshot,后 20% 线性过渡到 next anchor
        // 若为最后一段,无 next,持有 anchor 到尾
        const sectionLen = cur.endBeat - cur.startBeat;
        if (sectionLen <= 1e-6 || sIdx === n - 1) return cur.snapshot;

        const beatInSection = beat - cur.startBeat;
        const holdEnd = sectionLen * TRANSITION_RATIO;
        if (beatInSection <= holdEnd) return cur.snapshot;

        // 处于过渡区:线性插值到下段 anchor
        const transitionLen = sectionLen - holdEnd;
        const t = (beatInSection - holdEnd) / transitionLen;  // [0, 1]
        const next = this.anchors[sIdx + 1].snapshot;
        return lerpSnapshot(cur.snapshot, next, t);
    }
}

// ============================================================
// Anchor 计算(每段一个 WeatherSnapshot,加权和模型)
// ============================================================

function computeSectionAnchor(
    section: SectionMetadata,
    styleId: StyleId,
    activeMusicians: ActiveMusician[],
): WeatherSnapshot {
    return {
        k: computeK(section, styleId, activeMusicians),
        t: computeT(section, styleId, activeMusicians),
        s: computeS(section, styleId, activeMusicians),
        r: computeR(section, styleId, activeMusicians),
        g: computeG(section, styleId, activeMusicians),
    };
}

// ─────────────────────────────────────────────────────────────
// K (Kinetic) — 时间密度
//   60% energyLevel/10
//   20% style base
//   20% activeMusicians.persona.syncopationAssault 平均
// ─────────────────────────────────────────────────────────────
function computeK(
    section: SectionMetadata,
    styleId: StyleId,
    activeMusicians: ActiveMusician[],
): number {
    const sectionBase = clamp01(section.energyLevel / 10);
    const styleBase = STYLE_K_BASE[styleId] ?? 0.5;
    const personaBase = avgPersona(activeMusicians, p => p.syncopationAssault ?? PERSONA_DEFAULT_K);
    return clamp01(0.6 * sectionBase + 0.2 * styleBase + 0.2 * personaBase);
}

// ─────────────────────────────────────────────────────────────
// T (Timbral) — 色彩明暗
//   50% section type 查表
//   25% style base
//   25% activeMusicians.persona.colorBias 平均
// ─────────────────────────────────────────────────────────────
function computeT(
    section: SectionMetadata,
    styleId: StyleId,
    activeMusicians: ActiveMusician[],
): number {
    const sectionBase = sectionTBase(section.sectionType, section.energyLevel);
    const styleBase = STYLE_T_BASE[styleId] ?? 0.5;
    const personaBase = avgPersona(activeMusicians, p => p.colorBias ?? PERSONA_DEFAULT_T);
    return clamp01(0.5 * sectionBase + 0.25 * styleBase + 0.25 * personaBase);
}

function sectionTBase(sectionType: SectionType | undefined, energyLevel: number): number {
    switch (sectionType) {
        case SectionType.Intro:
        case SectionType.Outro:
        case SectionType.PreOutro:    return 0.30;
        case SectionType.Verse:       return 0.50;
        case SectionType.Bridge:      return 0.60;
        case SectionType.Chorus:      return 0.75;
        case SectionType.Solo_Bridge: return 0.80;
        case SectionType.BuildUp:     return clamp01(0.40 + energyLevel / 25);  // 能量线性爬升
        case SectionType.Break:
        case SectionType.Breakdown:   return 0.35;
        default:                      return 0.50;
    }
}

// ─────────────────────────────────────────────────────────────
// S (Spatial) — 心理距离 / sustain
//   60% section type 查表
//   25% style base
//   15% activeMusicians.persona.pianoPedalRatio 平均(钢琴族裔有)
// ─────────────────────────────────────────────────────────────
function computeS(
    section: SectionMetadata,
    styleId: StyleId,
    activeMusicians: ActiveMusician[],
): number {
    const sectionBase = sectionSBase(section.sectionType);
    const styleBase = STYLE_S_BASE[styleId] ?? 0.5;
    // pianoPedalRatio 默认 1.0,归一化到 [0,1] 用 min(p, 1.0)
    const personaBase = avgPersona(activeMusicians, p => Math.min(p.pianoPedalRatio ?? PERSONA_DEFAULT_S, 1.0));
    return clamp01(0.6 * sectionBase + 0.25 * styleBase + 0.15 * personaBase);
}

function sectionSBase(sectionType: SectionType | undefined): number {
    switch (sectionType) {
        case SectionType.Intro:
        case SectionType.Outro:
        case SectionType.PreOutro:    return 0.70;  // 开阔
        case SectionType.Verse:       return 0.40;
        case SectionType.Chorus:      return 0.45;
        case SectionType.Bridge:      return 0.55;
        case SectionType.Break:
        case SectionType.Breakdown:   return 0.60;
        case SectionType.BuildUp:     return 0.50;
        case SectionType.Solo_Bridge: return 0.55;
        default:                      return 0.50;
    }
}

// ─────────────────────────────────────────────────────────────
// R (Risk) — 调外 / chromatic
//   60% style base
//   30% section type adjustment
//   10% activeMusicians.persona.signatureLickProb 平均
//   Pop 风格 hard clamp ≤ 0.2
// ─────────────────────────────────────────────────────────────
function computeR(
    section: SectionMetadata,
    styleId: StyleId,
    activeMusicians: ActiveMusician[],
): number {
    const styleBase = STYLE_R_BASE[styleId] ?? 0.3;
    const sectionBase = styleBase + sectionRDelta(section.sectionType);
    const personaBase = avgPersona(activeMusicians, p => p.signatureLickProb ?? PERSONA_DEFAULT_R);
    let r = clamp01(0.6 * styleBase + 0.3 * clamp01(sectionBase) + 0.1 * personaBase);
    // Pop 风格 hard clamp(防 outside)
    if (styleId === StyleId.POP) r = Math.min(r, POP_R_CLAMP);
    return r;
}

function sectionRDelta(sectionType: SectionType | undefined): number {
    switch (sectionType) {
        case SectionType.Solo_Bridge: return 0.20;
        case SectionType.Bridge:      return 0.10;
        case SectionType.Intro:
        case SectionType.Outro:       return -0.10;
        default:                      return 0.00;
    }
}

// ─────────────────────────────────────────────────────────────
// G (Groove) — 律动 / 人性化
//   70% style base
//   30% activeMusicians.persona.bouncePreference 平均
//   section 不参与(groove 是风格签名,不应段间波动)
// ─────────────────────────────────────────────────────────────
function computeG(
    _section: SectionMetadata,
    styleId: StyleId,
    activeMusicians: ActiveMusician[],
): number {
    const styleBase = STYLE_G_BASE[styleId] ?? 0.5;
    const personaBase = avgPersona(activeMusicians, p => p.bouncePreference ?? PERSONA_DEFAULT_G);
    return clamp01(0.7 * styleBase + 0.3 * personaBase);
}

// ============================================================
// 共享工具函数
// ============================================================

function clamp01(x: number): number {
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
}

function avgPersona(
    activeMusicians: ActiveMusician[],
    pick: (persona: MusicianPersona) => number,
): number {
    if (activeMusicians.length === 0) return 0.5;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < activeMusicians.length; i++) {
        const persona = activeMusicians[i].card.persona;
        if (persona === undefined) continue;
        sum += pick(persona);
        count++;
    }
    return count === 0 ? 0.5 : sum / count;
}

function lerpSnapshot(a: WeatherSnapshot, b: WeatherSnapshot, t: number): WeatherSnapshot {
    const tt = clamp01(t);
    return {
        k: a.k + (b.k - a.k) * tt,
        t: a.t + (b.t - a.t) * tt,
        s: a.s + (b.s - a.s) * tt,
        r: a.r + (b.r - a.r) * tt,
        g: a.g + (b.g - a.g) * tt,
    };
}
