// ============================================================
// ImprovisationStrategy — Solo 引擎(Phase 6b 核心)
// ============================================================
//
// PEAA "Solo 高光时刻"工程落地。承接 Phase 5 NCT 趋近公式库,本模块负责:
//   ① Plateau detection:在 weather.k 高原区域识别 Solo 触发区间
//   ② Solo 音符生成:Tension Accumulator + NCT 路由 + 调内 / 和弦内音
//   ③ Landing Gear:每和弦最后一音解析到下和弦 chord tone
//   ④ Lead 替换:Solo 区间内剔除原 melody,注入 solo notes
//
// 设计哲学(Miles Davis):"no wrong notes, only wrong resolutions" —
//   逆向锚定 + 趋近公式 + 节拍权重 + 张力成本 = 高级 NCT 即兴。
//
// 触发条件(Phase 6b 起点,听感后调):
//   ① K plateau ≥ 8 拍持续 K ≥ 0.65
//   ② OR sectionType === Solo_Bridge(类型驱动 — 强制 Solo)
//
// 设计要点(承前 Phase 4-6a):
//   - Soloist 动态选(MainInst 优先 / Accomp fallback)— 用 musician.persona 调 velocity
//   - 用 Phase 5 NCT_APPROACH_PATTERNS(R 维度路由 — Pop 拒绝 Enclosure 等高 risk 模式)
//   - 末端 GrooveHumanizer 仍会处理 onset / velocity 微扰
//   - 零 PRNG(所有选择 deterministic hash from onset + soloist hash)
//
// 关联规则:
//   cross_sync_rule §1.17(本 phase 新登记):Solo 区间 ↔ Conductor 替换 ↔ NCT 数据库
// ============================================================

import {
    GeneratedChord, MusicianPersona, NoteData, SectionMetadata, SectionType,
    ActiveMusician, BandRole, ChordQuality, CHORD_INTERVALS, CHORD_SCALE_INTERVALS, Tonality,
} from '../types';
import type { WeatherSampler } from './RenderContext';
import {
    NCT_APPROACH_PATTERNS, ApproachPatternId, pickApproachPattern,
} from '../data/NCTApproachPatterns';

// ============================================================
// 常量(Phase 6b 起点,听感后调)
// ============================================================

/** Plateau K 阈值 — K ≥ 此值连续 ≥ MIN_PLATEAU_BEATS 触发 Solo */
const PLATEAU_K_THRESHOLD = 0.65;
/** Plateau 最小持续时长(beats) */
const MIN_PLATEAU_BEATS = 8;

/** Tension 阈值 — 超过此值强制下一音必须 chord tone */
const TENSION_FORCE_THRESHOLD = 5;
/** Tension 增量表 */
const TENSION_CHORD_TONE = 0;
const TENSION_SCALE_TONE = 1;
const TENSION_NCT_DIATONIC = 1;
const TENSION_NCT_CHROMATIC = 3;

/** Solo 音域(钢琴 Solo 默认范围,与 LEAD_ANCHOR 对齐) */
const SOLO_RANGE_LO = 60;   // C4
const SOLO_RANGE_HI = 84;   // C6
const SOLO_DEFAULT_ANCHOR = 72;  // C5

/** Solo velocity 范围(高于普通 lead 强调 Solo 主角)*/
const SOLO_VELOCITY_BASE = 0.82;
const SOLO_VELOCITY_RANGE = 0.12;  // 与 lastPitch 远近 / tension 联动

// ============================================================
// 类型
// ============================================================

export interface SoloRegion {
    /** Solo 起始 beat(绝对) */
    fromBeat: number;
    /** Solo 结束 beat(绝对) */
    toBeat: number;
    /** 触发来源(debug 用) */
    trigger: 'plateau' | 'solo_bridge';
}

// ============================================================
// 主入口:Plateau detection
// ============================================================

/**
 * 扫描所有 sections,识别 K plateau / Solo_Bridge 触发的 Solo 区间。
 *
 * 算法:
 *   - 对每段 beat-by-beat 扫描 K(整数 beat 步,1 拍精度)
 *   - 连续 K ≥ PLATEAU_K_THRESHOLD 持续 ≥ MIN_PLATEAU_BEATS → 标 plateau Solo 区间
 *   - sectionType === Solo_Bridge → 强制整段为 Solo 区间(覆盖 K 判定)
 *
 * 返回:SoloRegion[] 按 fromBeat 升序。
 *
 * 零 PRNG。
 */
export function findPlateauRegions(
    sections: SectionMetadata[],
    weather: WeatherSampler,
): SoloRegion[] {
    const out: SoloRegion[] = [];

    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
        const s = sections[sIdx];
        // ① 类型驱动:Solo_Bridge 强制整段
        if (s.sectionType === SectionType.Solo_Bridge) {
            out.push({ fromBeat: s.startBeat, toBeat: s.endBeat, trigger: 'solo_bridge' });
            continue;
        }
        // ② K 驱动:beat-by-beat plateau 扫描
        let plateauStart: number | undefined = undefined;
        const beatStart = Math.floor(s.startBeat);
        const beatEnd = Math.ceil(s.endBeat);
        for (let beat = beatStart; beat < beatEnd; beat++) {
            const k = weather.at(beat).k;
            if (k >= PLATEAU_K_THRESHOLD) {
                if (plateauStart === undefined) plateauStart = beat;
            } else {
                if (plateauStart !== undefined && beat - plateauStart >= MIN_PLATEAU_BEATS) {
                    out.push({ fromBeat: plateauStart, toBeat: beat, trigger: 'plateau' });
                }
                plateauStart = undefined;
            }
        }
        // 段末未关闭 plateau
        if (plateauStart !== undefined && beatEnd - plateauStart >= MIN_PLATEAU_BEATS) {
            out.push({ fromBeat: plateauStart, toBeat: beatEnd, trigger: 'plateau' });
        }
    }

    return out;
}

// ============================================================
// 选择 Soloist(用户决策 Q3 = d: 动态选)
// ============================================================

/**
 * 优先 MainInst,fallback 到 Accomp。
 * 返回 undefined 时调用方应跳过 Solo 生成。
 */
export function pickSoloist(activeMusicians: ActiveMusician[]): ActiveMusician | undefined {
    let mainInst: ActiveMusician | undefined;
    let accomp: ActiveMusician | undefined;
    for (let i = 0; i < activeMusicians.length; i++) {
        const am = activeMusicians[i];
        if (am.assignedRole === BandRole.MainInst) mainInst = am;
        else if (am.assignedRole === BandRole.Accomp) accomp = am;
    }
    return mainInst ?? accomp;
}

// ============================================================
// Solo 音符生成 — Tension Accumulator + NCT 路由 + Landing Gear
// ============================================================

interface SoloGenerationState {
    tension: number;
    lastPitch: number;
}

/**
 * 为单个 Solo 区间生成 NoteData[]。
 *
 * 算法(每和弦):
 *   1. 取 chord tones(CHORD_INTERVALS) + chord scale tones(CHORD_SCALE_INTERVALS)
 *   2. K-driven onset 网格:K > 0.9 → 16分(0.25 拍) / K ≤ 0.9 → 8 分(0.5 拍)
 *   3. 每 onset:
 *      a. 若 tension ≥ TENSION_FORCE_THRESHOLD → 强制 chord tone(landing-style)
 *      b. 否则 hash 选(chord tone 40% / scale tone 30% / NCT 30%):
 *         - chord tone:tension = 0
 *         - scale tone:tension += 1
 *         - NCT(R 驱动从 NCT_APPROACH_PATTERNS 抽 pattern,vector[0] 作偏移):
 *             diatonic → +1 tension / chromatic → +3 tension
 *   4. Landing Gear(每和弦最后 1 音):
 *      - 找下和弦 root/3rd/5th/7th 中距 lastPitch 最近的
 *      - 强制该位置 = 最近 target,tension 清零
 *   5. velocity:基础 0.82 + tension/10 微涨 + ±hash(humanize)
 *
 * 零 PRNG(hash from onset 派生)。
 */
export function generateSoloNotes(
    region: SoloRegion,
    chordsInRegion: GeneratedChord[],
    weather: WeatherSampler,
    soloist: ActiveMusician | undefined,
    prevPitch: number | undefined,
): NoteData[] {
    const out: NoteData[] = [];
    if (chordsInRegion.length === 0) return out;

    const state: SoloGenerationState = {
        tension: 0,
        lastPitch: prevPitch ?? SOLO_DEFAULT_ANCHOR,
    };

    const persona: MusicianPersona | undefined = soloist?.card.persona;
    const veloHi = persona?.dynamicRange[1] ?? 100;
    const baseVelocity = (veloHi / 127);  // [0, 1]

    for (let cIdx = 0; cIdx < chordsInRegion.length; cIdx++) {
        const chord = chordsInRegion[cIdx];
        const nextChord = cIdx + 1 < chordsInRegion.length ? chordsInRegion[cIdx + 1] : undefined;
        const chordStart = Math.max(chord.startBeat, region.fromBeat);
        const chordEnd = Math.min(chord.endBeat, region.toBeat);
        const chordDur = chordEnd - chordStart;
        if (chordDur < 1e-6) continue;

        // K-driven onset grid
        const k = weather.at(chordStart).k;
        const stepDur = k > 0.9 ? 0.25 : 0.5;
        const stepCount = Math.floor(chordDur / stepDur);
        if (stepCount === 0) continue;

        const chordTones = computeChordTonePitches(chord, state.lastPitch);
        const scaleTones = computeScaleTonePitches(chord, state.lastPitch);

        for (let s = 0; s < stepCount; s++) {
            const isLastInChord = (s === stepCount - 1);
            const onset = chordStart + s * stepDur;
            const r = weather.at(onset).r;

            let pitch: number;
            let velocityBoost = 0;

            // Landing Gear:每和弦末音强制 land 到下和弦 chord tone
            if (isLastInChord && nextChord !== undefined) {
                const nextChordTones = computeChordTonePitches(nextChord, state.lastPitch);
                pitch = pickNearest(state.lastPitch, nextChordTones);
                state.tension = 0;
                velocityBoost = 0.05;  // landing 加重
            }
            // 强制 chord tone 坍缩
            else if (state.tension >= TENSION_FORCE_THRESHOLD) {
                pitch = pickNearest(state.lastPitch, chordTones);
                state.tension = 0;
            }
            // 正常路径:hash 决定 chord / scale / NCT
            else {
                const choice = hashChoice(onset, state.lastPitch);
                if (choice < 0.40) {
                    pitch = pickNearest(state.lastPitch, chordTones);
                    state.tension = TENSION_CHORD_TONE;
                } else if (choice < 0.70) {
                    pitch = pickNearest(state.lastPitch, scaleTones);
                    state.tension += TENSION_SCALE_TONE;
                } else {
                    // NCT:用 NCT_APPROACH_PATTERNS 选模式(R 维度路由)
                    const hashF = hash01(onset, state.lastPitch ^ 0x5A5A);
                    const pattern = pickApproachPattern(hashF, r);
                    // 用 pattern.vector[0] 偏移最近 chord tone(下一步) → 当前 onset 的"前置音"
                    const targetChordTone = pickNearest(state.lastPitch, chordTones);
                    const offset = pattern.vector[0];
                    // diatonic offset 用 scale tone 替代;chromatic 直接 ± 半音
                    pitch = pattern.useDiatonic[0]
                        ? findNearestScaleTone(targetChordTone + offset, scaleTones)
                        : clampPitch(targetChordTone + offset);
                    state.tension += pattern.useDiatonic[0]
                        ? TENSION_NCT_DIATONIC : TENSION_NCT_CHROMATIC;
                    velocityBoost = 0.03;  // NCT 微强调
                    // 占位:pattern.id 数值标记(避免 unused warning)
                    void ApproachPatternId;
                }
            }

            pitch = clampPitch(pitch);
            const velocity = clamp01(
                baseVelocity * SOLO_VELOCITY_BASE + velocityBoost
                + state.tension * 0.01
                + hash01(onset, pitch) * SOLO_VELOCITY_RANGE * 0.5,
            );
            out.push({
                pitch,
                onset,
                duration: stepDur * 0.9,  // staccato gap
                velocity,
            });

            state.lastPitch = pitch;
        }
    }

    return out;
}

// ============================================================
// 工具:chord tone / scale tone 派生 → pitch 数组
// ============================================================

function computeChordTonePitches(chord: GeneratedChord, anchor: number): number[] {
    const rootPc = ((chord.bassOverride ?? chord.root) % 12 + 12) % 12;
    const intervals = CHORD_INTERVALS[chord.quality] ?? CHORD_INTERVALS[ChordQuality.Major];
    return intervalsToPitches(rootPc, intervals, anchor);
}

function computeScaleTonePitches(chord: GeneratedChord, anchor: number): number[] {
    const rootPc = ((chord.bassOverride ?? chord.root) % 12 + 12) % 12;
    const scale = CHORD_SCALE_INTERVALS[chord.quality] ?? CHORD_SCALE_INTERVALS[ChordQuality.Major];
    return intervalsToPitches(rootPc, scale ?? [0, 2, 4, 5, 7, 9, 11], anchor);
}

function intervalsToPitches(rootPc: number, intervals: number[], anchor: number): number[] {
    const out: number[] = [];
    const anchorOct = Math.floor((anchor - rootPc) / 12) * 12 + rootPc;
    for (let oct = -12; oct <= 24; oct += 12) {
        for (let i = 0; i < intervals.length; i++) {
            const p = anchorOct + oct + intervals[i];
            if (p >= SOLO_RANGE_LO && p <= SOLO_RANGE_HI) out.push(p);
        }
    }
    return out;
}

function pickNearest(target: number, candidates: number[]): number {
    if (candidates.length === 0) return clampPitch(target);
    let best = candidates[0];
    let bestDist = Math.abs(candidates[0] - target);
    for (let i = 1; i < candidates.length; i++) {
        const d = Math.abs(candidates[i] - target);
        if (d < bestDist) { bestDist = d; best = candidates[i]; }
    }
    return best;
}

function findNearestScaleTone(target: number, scaleTones: number[]): number {
    return pickNearest(target, scaleTones);
}

function clampPitch(p: number): number {
    if (p < SOLO_RANGE_LO) return SOLO_RANGE_LO + ((p - SOLO_RANGE_LO) % 12 + 12) % 12;
    if (p > SOLO_RANGE_HI) return SOLO_RANGE_HI - ((SOLO_RANGE_HI - p) % 12 + 12) % 12;
    return p;
}

function clamp01(x: number): number { return x < 0 ? 0 : (x > 1 ? 1 : x); }

// ============================================================
// Deterministic hash(零 PRNG)
// ============================================================

function hash01(onset: number, salt: number): number {
    const o = Math.floor(onset * 1000);
    let h = (o ^ (salt * 2654435761)) >>> 0;
    h = ((h ^ (h >>> 16)) * 0x85ebca6b) >>> 0;
    return (h / 0x100000000);
}

function hashChoice(onset: number, lastPitch: number): number {
    return hash01(onset, lastPitch * 73856093);
}

// ============================================================
// 占位 — Tonality 引用避免 unused(暂未消费但 Phase 7+ 会用)
// ============================================================
void ({} as Tonality);
void NCT_APPROACH_PATTERNS;
