/**
 * PianoAccompIdiom — 钢琴伴奏专属渲染器（Step 3 MVP）
 *
 * 替代旧 RhythmMutator + TextureMapper 通用渲染路径。专为"钢琴"这一物理乐器
 * 设计，能驱动钢琴特有的左右手分工 + 多种织体 + 协作模式。
 *
 * 设计哲学（与"路径 A — 真钢琴"对齐）：
 *   - LH + RH 输出合并为同一条 NoteData[]（"一架钢琴"，共享 mix/reverb/pedal 条件）
 *   - 当 BandRoster 配有 Bass 乐手 → 钢琴 LH 让位（M4 模式，LH Tacit）
 *   - 当 BandRoster 无 Bass 乐手 → 钢琴 LH 接管低音（M1 模式，LH Sustained Root）
 *
 * MVP 范围（V1）：
 *   - LH 织体（2）：L1 Sustained Root, L8 Tacit
 *   - RH 织体（3）：R1 Block（柱式齐砸）, R2 Broken（分解和弦循环）, R3 Comping Stab（切分塞音）
 *   - 协作模式（2）：M1 (LH Sustained + RH 织体), M4 (LH Tacit + RH 织体)
 *
 * V2 扩展（推迟）：
 *   - L4 Walking Tenths（需 BasslineCore 模块）, L5 Stride
 *   - R4 Rootless Voicing（爵士现代风）, R5 Quartal, R6 Single Counter Line
 *   - M2 Walking + Stab, M5 Two-Handed Voicing（需 HarmonyCore voicing 重分布）
 *
 * 约束遵从（music_generation_pipeline_rule.md）：
 *   D-1: 零 PRNG（完全决定性 grid 织体）
 *   D-3: 输出 sort (onset ASC, pitch ASC)
 *   D-4: 浮点比较走 EPSILON
 *   P-1: 输出 NoteData[] 连续 array
 *   S-3: 全同步纯函数
 *   K-2: 严禁 +keyOffset
 *
 * Pitch Space: RELATIVE
 *
 * @author AuraFlow Tap! BandEngine MVP Step 3
 */

import {
    GeneratedChord, NoteData,
    ChordQuality, CQ_IS_MAJOR, CQ_IS_DOM, CQ_IS_MINOR, CQ_IS_DIM,
} from '../types';
import { getDrop2Voicing, snapToPool, getChordTonePCs } from '../data/ScaleHelpers';
import { pickLickDeterministic, Lick } from '../idioms/LickDictionary';
import { SyncopationEvaluator } from './SyncopationEvaluator';
import {
    TextureRecipeId,
    getPianoTextureRecipe,
    legacyRhTextureToRecipe,
} from '../data/PianoTextureRecipes';
import {
    WalkPatternId, WalkRule, getWalkPattern,
} from '../data/BassWalkPatterns';
import {
    RhythmTopologyMutator,
    getUniversalPhraseChain,
} from './RhythmTopologyMutator';
import { MoodId, buildOperatorChain } from '../pipeline/MoodRouter';

const EPSILON = 1e-6;
const MIDI_MAX = 127;
const STEPS_PER_BEAT = 4;

// RH 音域下界（与 Stage5Layering ACCOMP_MIN_PITCH 一致）
// LH 用 voicing[0]，在 [48, 54) 区间（HarmonyCore voiceRange 等分），不与 Bass 轨 C1 锚位冲突
const RH_MIN_PITCH = 48;  // C3

// R3 Stab 最大 duration（保持塞音的"短促"感）
const STAB_MAX_DURATION_BEATS = 0.4;

// LH velocity 折扣系数（Sustained Root 比 RH 弱一些，让 RH 主导）
const LH_VELOCITY_SCALE = 0.85;

// ============================================================
// L4 Walking Tenths 常量
// ============================================================
//
// 锚位：C2 RELATIVE = 36（比 BassIdiom 的 C1=24 高一个八度，避免与独立 ElectricBass 撞）
// 仅在 bassActive=false 时激活 — 此时 BassIdiom 不渲染，piano LH 接管低音区
const PIANO_LH_BASS_ANCHOR = 36;  // C2 RELATIVE
const MAJOR_TENTH_INTERVAL = 16;  // 八度 + 大三度
const MINOR_TENTH_INTERVAL = 15;  // 八度 + 小三度
const WALKING_VELOCITY_SCALE = 0.9;  // Walking 比 Sustained 稍重（每拍都打底，强调律动）

// Walking bass voice-leading 安全区：[C1, B2] = [24, 47]
// 上限 47 紧贴 RH_MIN_PITCH=48，不撞 RH voicing[0]
// 下限 24 是钢琴 LH 极低音区，给 placeBassNear 足够候选做"近音原则"
const WALKING_BASS_MIN = 24;  // C1
const WALKING_BASS_MAX = 47;  // B2

// 改动 E — HandManager 物理约束：M1 Sustained 下 LH/RH 最小间距
// 3 半音 = 小三度。比 1 octave 更宽容，让 Drop-2 仍能呈现开放感（只挤掉真正撞音的 voice）
const MIN_HAND_SEPARATION = 3;

// ============================================================
// 织体 ID 枚举 — Sub-Phase 1 下沉到 data/PianoTextureEnums.ts，本文件 re-export 保持契约
// ============================================================
export { LHTexture, RHTexture, CoordMode } from '../data/PianoTextureEnums';
import { LHTexture, RHTexture, CoordMode } from '../data/PianoTextureEnums';

// ============================================================
// 16-step bar 织体网格（4/4 默认；3/4 / 6/8 也兼容因为按 mod 取）
// ============================================================
//
// Sub-Phase 1 改造：网格数据已下沉到 data/PianoTextureRecipes.ts。
// 本文件不再保留硬编码 GRID_BLOCK / GRID_BROKEN / GRID_STAB；改由 recipeId 查表。
// 兼容路径：params.recipeId 缺省时 legacyRhTextureToRecipe(rhTexture) 落到等价 recipe，
// 保证旧调用方（如 smoke-band-engine 内手写 PianoAccompParams）听感零回归。
//
// 索引含义（4/4 拍 16-step bar）：
//   step:   0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
//   beat:   1     &  e  2     &  e  3     &  e  4     &  e
//   weight: 4  0  1  0  2  0  1  0  3  0  1  0  2  0  1  0
//
// ============================================================

// ============================================================
// 公开 API
// ============================================================

export interface PianoAccompParams {
    lhTexture: LHTexture;
    rhTexture: RHTexture;
    coordMode: CoordMode;
    /** 力度范围（来自 musician.persona.dynamicRange，0~127 整数） */
    velocityRange: [number, number];
    /** 段落能量乘子 ∈ [0, 1]（BandEngine 从 section.energyLevel 归一化） */
    intensityScale: number;
    /** 声部跨度 ∈ [0, 1]（BandEngine 从 persona.colorBias 派生，默认 0.5）
     *  > 0.6 触发爵士 Drop-2 开放排列（次高音降八度） */
    voicingSpan?: number;
    /** 抢拍/推拍概率 ∈ [0, 1]（V3.3 BandEngine 从 persona.syncopationAssault 派生，默认 0）
     *  > 0 时按 chordIndex 确定性抽样，在 chord 末尾前 0.25 拍插 push hit */
    anticipationProb?: number;
    /** 稀疏倾向 ∈ [0, 1]（V3.3 BandEngine 从 persona.sparsityTendency 派生，默认 0）
     *  > 0 时按 hit 序号确定性抽样 drop 部分击点（消除"打字机感"） */
    sparsity?: number;
    /** 签名乐句触发概率 ∈ [0, 1]（V3.5 BandEngine 从 persona.signatureLickProb 派生，默认 0）
     *  > 0 时按 chordIndex 确定性抽样，整和弦渲染替换为 LickDictionary 中的乐句 */
    signatureLickProb?: number;
    /** V3.8 物理约束求解器开关 — 高 syncopationAssault (>0.5) 时启用，否则走 grid
     *  solver 用 per-step scoring + 动态阈值替换固定 grid pattern */
    useSolver?: boolean;
    /** V5.2 Swing 比例 ∈ [0.5, 0.67] — 0.5=直拍, 0.55=微 swing, 0.67=triplet swing
     *  应用于 8th offbeat 位置（16-grid 的 step 2/6/10/14）的 onset 偏移 */
    swingRatio?: number;
    /**
     * Sub-Phase 1（Piano Texture Renaissance）：织体配方 ID。
     *
     * 提供时直接走 PIANO_TEXTURE_RECIPES[recipeId].baseGrid。
     * 缺省时回落到 legacyRhTextureToRecipe(rhTexture) → 等价旧 grid，保持向后兼容。
     * Sub-Phase 3（MoodRouter）会成为 BandEngine 选 recipe 的唯一入口。
     */
    recipeId?: TextureRecipeId;
    /**
     * Sub-Phase 3：本和弦/段落所处的情绪桶。
     *
     * 提供时 PianoAccompIdiom 用 MoodRouter.buildOperatorChain(mood, barInPhrase)
     * 取对应 mood 的 4-bar phrase 算子链；缺省时回落到 Sub-Phase 2 通用剧本。
     *
     * 一次决策、整段稳定：BandEngine 按段落决定 mood 并塞进 RoleAssignment.params。
     */
    mood?: MoodId;
    /**
     * 改动 B（Piano LH Walk Pattern）：LH walking 字母语法配方 ID。
     *
     * 仅当 lhTexture === WalkingTenths 时生效。提供时走 `renderLHWalkPattern`
     * 解释器（B/5/3/A/N/= 规则）；缺省时回落到旧 `renderLHWalkingTenths`
     * 硬编码 4 拍序列（保证 smoke #11 手写 params 不回归）。
     *
     * BandEngine 在 walking 路由分支调用 `MoodRouter.pickWalkPattern(mood, styleId)`
     * 填入，让不同 mood × style 听感差异化。
     */
    walkPatternId?: WalkPatternId;
}

const DROP2_THRESHOLD = 0.6;
const ANTICIPATION_OFFSET_BEATS = 0.25;
const ANTICIPATION_MIN_CHORD_DUR = 2.0;

export interface PianoAccompRenderInput {
    /** 段落内的和弦序列（已带 voicing[]，RELATIVE 空间） */
    chords: GeneratedChord[];
    params: PianoAccompParams;
    /** 拍号第一位（小节内拍数），决定 stepsPerBar */
    beatsPerBar: number;
}

export class PianoAccompIdiom {
    /**
     * 渲染钢琴伴奏 — LH + RH 合并输出。
     *
     * 输出最大长度（C-4 文档化）：
     *   - RH Block / Stab: ≤ chords.length × (totalSteps × voiceCount)
     *   - RH Broken:        ≤ chords.length × (totalSteps × 1)
     *   - LH Sustained:     ≤ chords.length × 1
     *   - LH Tacit:         0
     *
     * PRNG 消耗：0（完全决定性）
     */
    public static render(input: PianoAccompRenderInput): NoteData[] {
        const { chords, params } = input;
        const out: NoteData[] = [];
        if (chords.length === 0) return out;

        const stepLen = 1 / STEPS_PER_BEAT;
        const beatsPerBar = input.beatsPerBar;

        // Sub-Phase 1：recipeId 优先；缺省时按 legacy 映射 rhTexture → 等价 recipe
        const recipeId = params.recipeId !== undefined
            ? params.recipeId
            : legacyRhTextureToRecipe(params.rhTexture);
        const baseGrid = getPianoTextureRecipe(recipeId).baseGrid;

        // L4 Walking Tenths voice-leading 状态 — 跨 chord 边界保持连贯
        // ImproVisor 风格：每个新 walking 音通过 placePitchNear(lastBass) 选最近八度，
        // 而不是每个 chord 都从 anchor + rootPc 起音（旧实现的"4 拍一跳回 C2"呆板感根因）
        let lastLhBass: number | undefined = undefined;

        for (let i = 0; i < chords.length; i++) {
            const chord = chords[i];
            const dur = chord.endBeat - chord.startBeat;
            if (dur < EPSILON) continue;
            if (!chord.voicing || chord.voicing.length < 2) continue;

            // V3.6 Phantom Vocal Mask — 按"bar-within-phrase"位置调制 params
            //   bar 0/1：主唱主场（钢琴让路，加 sparsity）
            //   bar 2：主唱喘息（钢琴切分回应，加 anticipationProb）
            //   bar 3：20% fill zone（确定性伪随机，强制 anticipation push）
            // 假设 4/4 拍 + 4-bar phrase
            const effectiveParams = applyPhantomVocalMask(params, chord.startBeat);

            // M5 模式独占分支 — 不走 RH grid / LH texture，直接合成 spread voicing 一次性发声
            if (effectiveParams.coordMode === CoordMode.M5_TwoHandedVoicing) {
                renderM5TwoHandedVoicing(out, chord, effectiveParams);
                continue;
            }

            // M6 Oom-Pah Bounce 独占分支 — LH 强拍 root/5 + RH 反拍 chord stab
            if (effectiveParams.coordMode === CoordMode.M6_OomPahBounce) {
                let bounceVoicing: number[] = [];
                for (let v = 1; v < chord.voicing.length; v++) {
                    if (chord.voicing[v] >= RH_MIN_PITCH) bounceVoicing.push(chord.voicing[v]);
                }
                if (bounceVoicing.length === 0) bounceVoicing = chord.voicing.slice(1);
                renderBounceM6(out, chord, bounceVoicing, effectiveParams);
                continue;
            }

            // V3.5 Signature Lick injection — 整和弦时长替换 grid 渲染
            //   触发：signatureLickProb > 0 + 确定性 chordIndex hash 命中
            //   仅 chord >= 2 beat 时才触发（短和弦塞不下完整 lick）
            const lickProb = effectiveParams.signatureLickProb ?? 0;
            if (lickProb > 0 && dur >= 2.0 - EPSILON
                && ((i * 67) % 100) / 100 < lickProb) {
                const lick = pickLickDeterministic(i);
                renderLick(out, chord, lick, effectiveParams);
                continue;
            }

            // V3.4 Anticipation push — chord 末尾前 0.25 拍插 push hit（仅 Block/Stab，Broken 已密集）
            // 触发条件：anticipationProb > 0 + chord ≥ 2 拍 + 非最后一个 chord + 确定性 chordIndex 抽样
            const anticipationProb = effectiveParams.anticipationProb ?? 0;
            const enableAnticipation = anticipationProb > 0
                && dur >= ANTICIPATION_MIN_CHORD_DUR
                && i < chords.length - 1
                && effectiveParams.rhTexture !== RHTexture.Broken
                && ((i * 41) % 100) / 100 < anticipationProb;

            // RH voicing：丢掉 voicing[0]（bass voice 归 LH 或独立 Bass 轨），过滤 ≥ C3
            let rhVoicing: number[] = [];
            for (let v = 1; v < chord.voicing.length; v++) {
                if (chord.voicing[v] >= RH_MIN_PITCH) rhVoicing.push(chord.voicing[v]);
            }

            // V3.7 Drop-2：voicingSpan > 0.6 + voicing 至少 3 voice 时套爵士开放排列
            const voicingSpan = effectiveParams.voicingSpan ?? 0.5;
            if (voicingSpan > DROP2_THRESHOLD && rhVoicing.length >= 3) {
                rhVoicing = getDrop2Voicing(rhVoicing);
                // Drop-2 后最低音可能降到 < C3（48）— 不再过滤，让 Drop-2 的"开放"听感完整呈现
            }

            // 改动 E — HandManager 物理约束：M1 模式下强制 RH 最低音离 LH ≥ MIN_HAND_SEPARATION
            //   触发场景：
            //     M1 + Sustained → lhFloor = voicing[0]（LH 持续 sustain）
            //     M1 + WalkingTenths → lhFloor = WALKING_BASS_MAX (47)（walking bass 物理上限）
            //   不触发：M4 (LH=Tacit 不发声) / M5 (自己合谱) / M6 (LH/RH 错时间) / M1 + Tacit
            //   移植自 ImproVisor HandManager.repositionHands（doc:7250 附近），简化版
            if (effectiveParams.coordMode === CoordMode.M1_SustainedRoot
                && effectiveParams.lhTexture !== LHTexture.Tacit
                && rhVoicing.length > 0) {
                const lhFloor = effectiveParams.lhTexture === LHTexture.WalkingTenths
                    ? WALKING_BASS_MAX
                    : chord.voicing[0];
                rhVoicing = enforceHandSeparation(rhVoicing, lhFloor);
            }

            // ---- 改动 C：voicePattern 精化织体（Alberti / Montuno / Ragtime 等）----
            //   提供时完全替代 baseGrid + mutator + Block/Broken 旧逻辑，跳过 sparsity 与 anticipation
            //   仍享受 swing offset / velocity / intensity 参数
            const recipe = getPianoTextureRecipe(recipeId);
            if (recipe.voicePattern !== undefined && rhVoicing.length > 0) {
                renderRHByVoicePattern(out, chord, rhVoicing, recipe.voicePattern, stepLen, effectiveParams);

                // ---- LH 渲染（与下面 grid 分支共享逻辑） ----
                if (effectiveParams.coordMode === CoordMode.M1_SustainedRoot) {
                    if (effectiveParams.lhTexture === LHTexture.Sustained) {
                        renderLHSustained(out, chord, effectiveParams);
                    } else if (effectiveParams.lhTexture === LHTexture.WalkingTenths) {
                        const nextChord = i + 1 < chords.length ? chords[i + 1] : undefined;
                        if (effectiveParams.walkPatternId !== undefined) {
                            lastLhBass = renderLHWalkPattern(out, chord, nextChord, effectiveParams, lastLhBass, i);
                        } else {
                            lastLhBass = renderLHWalkingTenths(out, chord, nextChord, effectiveParams, lastLhBass);
                        }
                    }
                }
                continue;  // voicePattern 分支已完成本和弦渲染，跳过下方 grid 路径
            }

            // ---- Sub-Phase 2/3：4-bar phrase 句法剧本 ----
            //   按和弦所在小节在 4-bar phrase 内的位置 (0/1/2/3) 取算子链。
            //   params.mood 提供 → MoodRouter.buildOperatorChain(mood, barInPhrase)
            //   缺省 → Sub-Phase 2 通用剧本（用于手写 params 的向后兼容场景）
            const barIndex = Math.floor(chord.startBeat / beatsPerBar + EPSILON);
            const barInPhrase = ((barIndex % 4) + 4) % 4;
            const phraseChain = effectiveParams.mood !== undefined
                ? buildOperatorChain(effectiveParams.mood, barInPhrase)
                : getUniversalPhraseChain(barInPhrase);
            const mutated = RhythmTopologyMutator.applyChain(baseGrid, rhVoicing, phraseChain);
            const effectiveGrid = mutated.grid;
            rhVoicing = mutated.voicing;

            // 改动 E（mutator 后再调一次）— mutator 可能用 OP_VOICING_INVERT/OPEN 重排 rhVoicing，
            // 导致 Drop-2 + 之前 E 的撞音修正失效。这里二次 enforce 保最终 RH 离 LH ≥ floor。
            if (effectiveParams.coordMode === CoordMode.M1_SustainedRoot
                && effectiveParams.lhTexture !== LHTexture.Tacit
                && rhVoicing.length > 0) {
                const lhFloor2 = effectiveParams.lhTexture === LHTexture.WalkingTenths
                    ? WALKING_BASS_MAX
                    : chord.voicing[0];
                rhVoicing = enforceHandSeparation(rhVoicing, lhFloor2);
            }

            // ---- RH 渲染 — V3.8 dispatch ----
            if (rhVoicing.length > 0) {
                if (effectiveParams.useSolver === true) {
                    renderRHSolver(out, chord, rhVoicing, stepLen, effectiveParams, i);
                } else {
                    renderRH(out, chord, rhVoicing, effectiveGrid, stepLen, effectiveParams, i);
                }

                // Anticipation push (V3.4)
                if (enableAnticipation) {
                    const pushOnset = chord.endBeat - ANTICIPATION_OFFSET_BEATS;
                    if (pushOnset > chord.startBeat + 0.5 - EPSILON) {
                        const pushVel = computeVelocity(effectiveParams.velocityRange, effectiveParams.intensityScale) * 1.08;
                        for (let v = 0; v < rhVoicing.length; v++) {
                            out.push({
                                pitch: rhVoicing[v],
                                onset: pushOnset,
                                duration: ANTICIPATION_OFFSET_BEATS,
                                velocity: pushVel > 1 ? 1 : pushVel,
                            });
                        }
                    }
                }
            }

            // ---- LH 渲染 ----
            if (effectiveParams.coordMode === CoordMode.M1_SustainedRoot) {
                if (effectiveParams.lhTexture === LHTexture.Sustained) {
                    renderLHSustained(out, chord, effectiveParams);
                } else if (effectiveParams.lhTexture === LHTexture.WalkingTenths) {
                    const nextChord = i + 1 < chords.length ? chords[i + 1] : undefined;
                    // 改动 B：walkPatternId 提供时走字母语法解释器；缺省回落到旧硬编码序列
                    if (effectiveParams.walkPatternId !== undefined) {
                        lastLhBass = renderLHWalkPattern(out, chord, nextChord, effectiveParams, lastLhBass, i);
                    } else {
                        lastLhBass = renderLHWalkingTenths(out, chord, nextChord, effectiveParams, lastLhBass);
                    }
                }
                // L8 Tacit：跳过
            }
            // M4：LH 永远 Tacit
        }

        // D-3：onset ASC, pitch ASC
        out.sort((a, b) => {
            const d = a.onset - b.onset;
            if (Math.abs(d) > EPSILON) return d;
            return a.pitch - b.pitch;
        });

        return out;
    }
}

// ============================================================
// 内部：RH grid → NoteData[]
// ============================================================

function renderRH(
    out: NoteData[],
    chord: GeneratedChord,
    rhVoicing: number[],
    pattern: ReadonlyArray<number>,
    stepLen: number,
    params: PianoAccompParams,
    chordIndex: number,
): void {
    const totalSteps = Math.floor((chord.endBeat - chord.startBeat) * STEPS_PER_BEAT + 0.5);
    if (totalSteps <= 0) return;

    const startStep = Math.floor(chord.startBeat * STEPS_PER_BEAT + 0.5);

    // 收集本和弦内的击点（绝对 step 偏移）
    const hits: number[] = [];
    for (let s = 0; s < totalSteps; s++) {
        if (pattern[(startStep + s) % pattern.length] === 1) hits.push(s);
    }
    if (hits.length === 0) return;

    // V3.4 Anti-typewriter sparsity drop — sparsity > 0 时按确定性 hash 删击点（防机械感）
    const sparsity = params.sparsity ?? 0;
    if (sparsity > 0) {
        const filtered: number[] = [];
        for (let h = 0; h < hits.length; h++) {
            // 强拍始终保留（hit 0 = chord 头）；弱拍按 sparsity 比例丢
            if (h === 0) {
                filtered.push(hits[h]);
                continue;
            }
            const hash = ((chordIndex * 73 + h * 31) % 100) / 100;
            if (hash >= sparsity) filtered.push(hits[h]);
        }
        hits.length = 0;
        for (let h = 0; h < filtered.length; h++) hits.push(filtered[h]);
        if (hits.length === 0) return;
    }

    const velocity = computeVelocity(params.velocityRange, params.intensityScale);
    const n = rhVoicing.length;

    // V5.2 Swing 偏移参数（仅影响 8th offbeat = 16-grid step 2/6/10/14）
    const swingRatio = params.swingRatio ?? 0.5;
    const swingShift = swingRatio > 0.5 ? (swingRatio - 0.5) * 0.5 : 0;

    for (let h = 0; h < hits.length; h++) {
        const step = hits[h];
        let onset = chord.startBeat + step * stepLen;
        const nextStep = h + 1 < hits.length ? hits[h + 1] : totalSteps;
        let duration = (nextStep - step) * stepLen;

        // Swing offset — 仅 8th offbeat 推后
        if (swingShift > 0 && (step % 4) === 2) {
            onset += swingShift;
            // duration 不变（让下个击点接管接续）
        }

        // R3 Stab：强制短 duration（保持塞音的"点状"感）
        if (params.rhTexture === RHTexture.Stab && duration > STAB_MAX_DURATION_BEATS) {
            duration = STAB_MAX_DURATION_BEATS;
        }

        // 兜底：不超 chord 边界
        const maxDur = chord.endBeat - onset;
        if (duration > maxDur) duration = maxDur;
        if (duration <= EPSILON) continue;

        if (params.rhTexture === RHTexture.Broken) {
            // 单音琶音 — voice 循环
            const pitch = rhVoicing[h % n];
            out.push({ pitch, onset, duration, velocity });
        } else {
            // Block / Stab — 全 voicing 齐砸
            for (let v = 0; v < n; v++) {
                out.push({ pitch: rhVoicing[v], onset, duration, velocity });
            }
        }
    }
}

// ============================================================
// 内部：改动 C — voicePattern 精化织体渲染
// ============================================================
//
// 设计：
//   - voicePattern[step % 16] 决定该 step 弹哪些 voice index（rhVoicing 数组下标）
//   - null / [] → 该 step 静音
//   - voice index 越界（>= rhVoicing.length）→ mod 兜底
//   - 击点 duration 延续到下一个非空 step（保证 Alberti 这种 8th 单音不被截短）
//   - R3 Stab 风格仍触发 STAB_MAX_DURATION_BEATS 上限
//   - swing offset 仍施加于 step 2/6/10/14（8th offbeat）
//
// 不施加（与 voicePattern "精确指定"理念冲突）：
//   - sparsity 删击点
//   - anticipation push
//   - mutator phrase chain

function renderRHByVoicePattern(
    out: NoteData[],
    chord: GeneratedChord,
    rhVoicing: number[],
    voicePattern: ReadonlyArray<ReadonlyArray<number> | null>,
    stepLen: number,
    params: PianoAccompParams,
): void {
    const totalSteps = Math.floor((chord.endBeat - chord.startBeat) * STEPS_PER_BEAT + 0.5);
    if (totalSteps <= 0) return;

    const startStep = Math.floor(chord.startBeat * STEPS_PER_BEAT + 0.5);
    const patLen = voicePattern.length;
    const n = rhVoicing.length;

    // 先扫一遍 — 收集所有非空 step（决定每个击点的 duration 截至点）
    const hits: { step: number; voices: ReadonlyArray<number> }[] = [];
    for (let s = 0; s < totalSteps; s++) {
        const cell = voicePattern[(startStep + s) % patLen];
        if (cell !== null && cell !== undefined && cell.length > 0) {
            hits.push({ step: s, voices: cell });
        }
    }
    if (hits.length === 0) return;

    const velocity = computeVelocity(params.velocityRange, params.intensityScale);

    // Swing 偏移参数（仅影响 step 2/6/10/14）
    const swingRatio = params.swingRatio ?? 0.5;
    const swingShift = swingRatio > 0.5 ? (swingRatio - 0.5) * 0.5 : 0;

    for (let h = 0; h < hits.length; h++) {
        const { step, voices } = hits[h];
        let onset = chord.startBeat + step * stepLen;
        const nextStep = h + 1 < hits.length ? hits[h + 1].step : totalSteps;
        let duration = (nextStep - step) * stepLen;

        if (swingShift > 0 && (step % 4) === 2) {
            onset += swingShift;
        }

        // R3 Stab 风格 → 短 duration
        if (params.rhTexture === RHTexture.Stab && duration > STAB_MAX_DURATION_BEATS) {
            duration = STAB_MAX_DURATION_BEATS;
        }
        const maxDur = chord.endBeat - onset;
        if (duration > maxDur) duration = maxDur;
        if (duration <= EPSILON) continue;

        // 发射该 step 的所有 voice
        for (let v = 0; v < voices.length; v++) {
            const idx = ((voices[v] % n) + n) % n;
            out.push({
                pitch: rhVoicing[idx],
                onset,
                duration,
                velocity,
            });
        }
    }
}

// ============================================================
// 内部：LH Sustained Root → 1 NoteData / chord
// ============================================================

function renderLHSustained(
    out: NoteData[],
    chord: GeneratedChord,
    params: PianoAccompParams,
): void {
    if (!chord.voicing || chord.voicing.length === 0) return;
    const dur = chord.endBeat - chord.startBeat;
    if (dur <= EPSILON) return;

    const lhPitch = chord.voicing[0];  // HarmonyCore 的 bass voice（[48, 54) 区间）
    const rhVelocity = computeVelocity(params.velocityRange, params.intensityScale);
    const velocity = rhVelocity * LH_VELOCITY_SCALE;

    out.push({
        pitch: lhPitch,
        onset: chord.startBeat,
        duration: dur,
        velocity,
    });
}

// ============================================================
// 内部：L4 Walking Tenths → 4 拍每和弦 (root/5/root/approach) × 10th 双音
// ============================================================
//
// 算法（4/4 拍假设，每和弦 4 拍）：
//   Beat 1 (offset 0)   : root + 10th
//   Beat 2 (offset 1)   : 5th  + 10th
//   Beat 3 (offset 2)   : root（octave up 增加律动） + 10th
//   Beat 4 (offset 3)   : approach (下个和弦 root 的半音邻) + 10th
//                         无下个和弦时退回 root + 10th
//
// 短和弦（< 4 拍）：按比例发 floor(durBeats) 个 walking 点
// 长和弦（> 4 拍）：每 4 拍循环一次模式
//
// 10th interval：major/dom family → +16；minor/dim family → +15；sus → 跳过 10th（只打单音 root）

function renderLHWalkingTenths(
    out: NoteData[],
    chord: GeneratedChord,
    nextChord: GeneratedChord | undefined,
    params: PianoAccompParams,
    lastBassPitch: number | undefined,
): number | undefined {
    const dur = chord.endBeat - chord.startBeat;
    if (dur <= EPSILON) return lastBassPitch;

    const numBeats = Math.floor(dur + EPSILON);
    if (numBeats < 1) return lastBassPitch;

    const rootPc = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
    const rootPcNorm = ((rootPc % 12) + 12) % 12;
    const tenthInterval = pickTenthInterval(chord.quality);

    const rhVelocity = computeVelocity(params.velocityRange, params.intensityScale);
    const velocity = rhVelocity * WALKING_VELOCITY_SCALE;

    let currentLastBass = lastBassPitch;

    // 计算每拍的 bass PC
    // Beat 1: root / Beat 2: 5th / Beat 3: root / Beat 4: approach (下和弦 root - 1)
    for (let b = 0; b < numBeats; b++) {
        const phase = b % 4;
        let bassPc: number;
        switch (phase) {
            case 0:
                bassPc = rootPcNorm;
                break;
            case 1:
                bassPc = (rootPcNorm + 7) % 12;  // 5度
                break;
            case 2:
                bassPc = rootPcNorm;
                break;
            case 3: {
                // approach：下和弦 root 半音邻（默认上邻 -1 半音）；无下和弦时回 root
                if (nextChord !== undefined) {
                    const nextRootPc = nextChord.bassOverride !== undefined ? nextChord.bassOverride : nextChord.root;
                    const nextRootNorm = ((nextRootPc % 12) + 12) % 12;
                    bassPc = (nextRootNorm + 11) % 12;  // -1 半音
                } else {
                    bassPc = rootPcNorm;
                }
                break;
            }
            default:
                bassPc = rootPcNorm;
        }

        // voice-leading 选音：把 bassPc 落到距离 lastBass 最近的同 PC 八度
        // 首次（lastBass=undefined）回退到 PIANO_LH_BASS_ANCHOR 锚位
        const bassPitch = placeBassNear(bassPc, currentLastBass);
        // 10th 在 bass 上方（major +16 / minor +15）
        const tenthPitch = tenthInterval > 0 ? bassPitch + tenthInterval : -1;

        const onset = chord.startBeat + b;
        // duration = 1 拍 - 微小 staccato gap，让 walking 听起来有"行进感"
        const duration = 0.9;

        out.push({ pitch: bassPitch, onset, duration, velocity });
        // 10th 仅在 sus 之外的和弦发声
        if (tenthPitch > 0) {
            out.push({ pitch: tenthPitch, onset, duration, velocity: velocity * 0.85 });  // 10th 稍轻
        }

        currentLastBass = bassPitch;
    }

    return currentLastBass;
}

// ============================================================
// 内部：改动 B — Walk Pattern 字母语法解释器
// ============================================================
//
// 设计（移植自 ImproVisor BassPattern.applyRules，doc:2455）：
//   按 pattern.steps 循环消费 chord 内时长，每个 step 用 (rule, durationBeats) 决定：
//     - rule → 该步弹哪个 PC（B=root, 5=5度, 3=3度, A=approach, N=next, ==重复）
//     - durationBeats → 占多少拍
//     - 选 PC 后用 placeBassNear(pc, currentLastBass) 折到最近八度（继承改动 A）
//
// 与 renderLHWalkingTenths 的差异：
//   - 旧实现：硬编码 4 拍 B 5 B A 序列
//   - 新实现：pattern.steps 任意长度，按 chord 时长循环 + 自动截断
//
// staccato gap：duration = stepDur × 0.9（与旧实现的固定 0.9 拍对应缩放）

function renderLHWalkPattern(
    out: NoteData[],
    chord: GeneratedChord,
    nextChord: GeneratedChord | undefined,
    params: PianoAccompParams,
    lastBassPitch: number | undefined,
    chordIndex: number,
): number | undefined {
    const chordDur = chord.endBeat - chord.startBeat;
    if (chordDur <= EPSILON) return lastBassPitch;
    if (params.walkPatternId === undefined) return lastBassPitch;

    const pattern = getWalkPattern(params.walkPatternId);
    if (pattern.steps.length === 0) return lastBassPitch;

    const rootPc = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
    const rootPcNorm = ((rootPc % 12) + 12) % 12;
    const thirdPc = pickThirdPc(rootPcNorm, chord.quality);
    const fifthPc = (rootPcNorm + 7) % 12;
    const tenthInterval = pickTenthInterval(chord.quality);

    // 改动 F — Chord/Scale tone pool（按需 lazy 构造，避免不用 C/S 的 pattern 额外开销）
    let chordTonePool: number[] | undefined;
    let scaleTonePool: number[] | undefined;

    const rhVelocity = computeVelocity(params.velocityRange, params.intensityScale);
    const velocity = rhVelocity * WALKING_VELOCITY_SCALE;

    let currentLast = lastBassPitch;
    let cursor = 0;                  // chord 内累计拍数
    let stepIdx = 0;

    while (cursor < chordDur - EPSILON) {
        const step = pattern.steps[stepIdx % pattern.steps.length];
        const stepDur = step.durationBeats;
        if (stepDur <= EPSILON) { stepIdx++; continue; }

        // 选 PC（rule → bassPc，undefined 代表 Repeat 不重选）
        let bassPc: number | undefined;
        switch (step.rule) {
            case WalkRule.Root:
                bassPc = rootPcNorm;
                break;
            case WalkRule.Fifth:
                bassPc = fifthPc;
                break;
            case WalkRule.Third:
                bassPc = thirdPc;
                break;
            case WalkRule.Approach: {
                // 下一和弦根音 -1 半音（下邻 approach）；无下和弦时回 root
                if (nextChord !== undefined) {
                    const nextRootPc = nextChord.bassOverride !== undefined ? nextChord.bassOverride : nextChord.root;
                    const nextRootNorm = ((nextRootPc % 12) + 12) % 12;
                    bassPc = (nextRootNorm + 11) % 12;
                } else {
                    bassPc = rootPcNorm;
                }
                break;
            }
            case WalkRule.NextRoot: {
                if (nextChord !== undefined) {
                    const nextRootPc = nextChord.bassOverride !== undefined ? nextChord.bassOverride : nextChord.root;
                    bassPc = ((nextRootPc % 12) + 12) % 12;
                } else {
                    bassPc = rootPcNorm;
                }
                break;
            }
            case WalkRule.Repeat:
                bassPc = undefined;  // 不重选，直接复用 currentLast
                break;
            case WalkRule.ChordTone: {
                // 确定性 hash chord-tone pool（不依赖 PRNG）
                if (chordTonePool === undefined) chordTonePool = getChordTonePCs(chord);
                if (chordTonePool.length === 0) {
                    bassPc = rootPcNorm;
                } else {
                    const h = ((chordIndex * 31 + stepIdx * 17) % chordTonePool.length + chordTonePool.length) % chordTonePool.length;
                    bassPc = chordTonePool[h];
                }
                break;
            }
            case WalkRule.ScaleTone: {
                if (scaleTonePool === undefined) scaleTonePool = buildWalkScalePool(chord);
                if (scaleTonePool.length === 0) {
                    bassPc = rootPcNorm;
                } else {
                    const h = ((chordIndex * 41 + stepIdx * 19) % scaleTonePool.length + scaleTonePool.length) % scaleTonePool.length;
                    bassPc = scaleTonePool[h];
                }
                break;
            }
            default:
                bassPc = rootPcNorm;  // 兜底
        }

        // 解析为 pitch
        let bassPitch: number;
        if (bassPc === undefined) {
            // Repeat：复用上一个 bass pitch；若 currentLast 仍未定义则用 anchor + root
            bassPitch = currentLast !== undefined
                ? currentLast
                : placeBassNear(rootPcNorm, undefined);
        } else {
            bassPitch = placeBassNear(bassPc, currentLast);
        }

        // 控制 step 不超 chord 边界
        const remaining = chordDur - cursor;
        const playDur = (stepDur < remaining ? stepDur : remaining) * 0.9;  // staccato gap
        if (playDur > EPSILON) {
            const onset = chord.startBeat + cursor;
            out.push({ pitch: bassPitch, onset, duration: playDur, velocity });
            if (tenthInterval > 0) {
                const tenthPitch = bassPitch + tenthInterval;
                out.push({ pitch: tenthPitch, onset, duration: playDur, velocity: velocity * 0.85 });
            }
        }

        currentLast = bassPitch;
        cursor += stepDur;
        stepIdx++;
    }

    return currentLast;
}

/**
 * 改动 F — 构造 walking 用的 scale tone PC 池（chord-tone + 2nd + 6th 色彩音）。
 *
 * 不依赖 GlobalContext / tonality，仅按 chord.quality 选 nat6/b6：
 *   major / dom / augmented / add9 → 加 nat 2 (root+2) + nat 6 (root+9)
 *   minor / diminished / sus       → 加 nat 2 (root+2) + b 6  (root+8)
 *
 * 用 PC 集合存去重，输出升序。
 */
function buildWalkScalePool(chord: GeneratedChord): number[] {
    const chordTones = getChordTonePCs(chord);
    const rootPc = ((chord.root % 12) + 12) % 12;
    const qBit = 1 << chord.quality;
    const minorish = (qBit & CQ_IS_MINOR) !== 0 || (qBit & CQ_IS_DIM) !== 0
        || chord.quality === ChordQuality.Sus4
        || chord.quality === ChordQuality.Dominant7Sus4;
    const second = (rootPc + 2) % 12;
    const sixth = minorish ? (rootPc + 8) % 12 : (rootPc + 9) % 12;

    const seen: { [pc: number]: boolean } = {};
    for (let i = 0; i < chordTones.length; i++) seen[chordTones[i]] = true;
    seen[second] = true;
    seen[sixth] = true;

    const out: number[] = [];
    for (let pc = 0; pc < 12; pc++) {
        if (seen[pc]) out.push(pc);
    }
    return out;
}

/**
 * 按 ChordQuality 选 3rd 的 PC：
 *   major / dom / augmented / add9 → root + 4（major 3rd）
 *   minor / diminished family       → root + 3（minor 3rd）
 *   sus / dom7sus4                  → root + 5（fallback：sus 没有 3rd，用 4th 代替）
 */
function pickThirdPc(rootPcNorm: number, quality: ChordQuality): number {
    if (quality === ChordQuality.Sus4 || quality === ChordQuality.Dominant7Sus4) {
        return (rootPcNorm + 5) % 12;
    }
    const qBit = 1 << quality;
    if ((qBit & CQ_IS_MAJOR) !== 0) return (rootPcNorm + 4) % 12;
    if ((qBit & CQ_IS_DOM) !== 0) return (rootPcNorm + 4) % 12;
    if ((qBit & CQ_IS_MINOR) !== 0) return (rootPcNorm + 3) % 12;
    if ((qBit & CQ_IS_DIM) !== 0) return (rootPcNorm + 3) % 12;
    if (quality === ChordQuality.Augmented || quality === ChordQuality.Add9) return (rootPcNorm + 4) % 12;
    return (rootPcNorm + 4) % 12;
}

/**
 * 改动 E — HandManager 物理约束：把过低的 RH voice 上推 12 半音，保证 RH 最低 ≥ lhPitch + MIN_HAND_SEPARATION。
 *
 * 算法：对每个 rhVoicing[i]，如果 < lhPitch + MIN_HAND_SEPARATION，循环 +12 直到达标。
 * 然后重新排序（升序），让后续 Block/Broken/voicePattern 渲染按索引取音的语义不变。
 *
 * 仅触发：M1_SustainedRoot + LHTexture.Sustained（LH voicing[0] 持续 sustain 的场景）。
 * 不触发：Walking / Tacit / M5 / M6（短促击点或 LH 不发声，撞音听感影响小或不存在）。
 *
 * 移植自 ImproVisor HandManager.repositionHands / resetLH（doc:7250）— 不实装完整 spread 检测，
 * 只做"避免 RH 跌入 LH 区"的最小集，保 Drop-2 开放感 vs 撞音整洁的平衡。
 *
 * @param rhVoicing 升序排列的 RH voice 数组
 * @param lhPitch LH sustain pitch（chord.voicing[0]）
 * @returns 升序排列的新数组（可能与输入相同 — 无需调整时直接返回 .slice()）
 */
function enforceHandSeparation(rhVoicing: number[], lhPitch: number): number[] {
    const floor = lhPitch + MIN_HAND_SEPARATION;
    const out: number[] = [];
    let adjusted = false;
    for (let i = 0; i < rhVoicing.length; i++) {
        let p = rhVoicing[i];
        while (p < floor) { p += 12; adjusted = true; }
        if (p <= MIDI_MAX) out.push(p);
    }
    if (!adjusted) return rhVoicing.slice();
    out.sort((a, b) => a - b);
    return out;
}

/**
 * 把 pitch class 折到距离 lastPitch 最近的同 PC 八度（"近音原则" voice leading）。
 *
 * 算法：solve x ≡ pc (mod 12), minimize |x - lastPitch|，再 clamp 到 LH 安全区。
 * 当 |delta| 等于半八度（6 半音）时，倾向上行（delta=6 不翻转）。
 *
 * @param pc 目标 pitch class (0~11，自动 mod)
 * @param lastPitch 上一拍 bass MIDI 值；undefined 时回退到 PIANO_LH_BASS_ANCHOR 锚位
 * @returns LH 安全区 [WALKING_BASS_MIN, WALKING_BASS_MAX] 内的 MIDI 值
 */
function placeBassNear(pc: number, lastPitch: number | undefined): number {
    const pcNorm = ((pc % 12) + 12) % 12;
    const ref = lastPitch !== undefined ? lastPitch : PIANO_LH_BASS_ANCHOR;
    // 上方最近同 PC：delta ∈ [0, 11]
    const delta = ((pcNorm - ref) % 12 + 12) % 12;
    // delta > 6 时下方更近（=6 时保留上行倾向）
    let candidate = delta > 6 ? ref + delta - 12 : ref + delta;
    // Clamp 到 LH 安全区
    while (candidate < WALKING_BASS_MIN) candidate += 12;
    while (candidate > WALKING_BASS_MAX) candidate -= 12;
    return candidate;
}

// ============================================================
// 内部：V4.1 M6 Oom-Pah Bounce — LH 强拍 root/5 交替 + RH 反拍 chord stab
// ============================================================
//
// 设计（移植自 SampleDEMO BouncePianoIdiom，但归入通用 PianoAccompIdiom）：
//   每 8 分音符迭代：
//     - downbeat (beat 0, 1, 2, 3) : LH 弹 bass note
//         · 偶数拍 (0, 2) = root
//         · 奇数拍 (1, 3) = 5th
//         · 高能量段 → staccato (duration 0.3)，低能量 → legato (duration 0.5)
//     - upbeat (beat 0.5, 1.5, 2.5, 3.5) : RH 弹 chord stab
//         · 全 voicing 短 duration (0.25)
//         · 顶音稍重 (× 1.05)，其他 voice ×0.9
//
// 约束：仅 bassActive=false 时由 BandEngine 路由到 M6；否则与 ElectricBass 撞 bass 频段

const BOUNCE_DOWNBEAT_DUR_LEGATO = 0.5;
const BOUNCE_DOWNBEAT_DUR_STACCATO = 0.3;
const BOUNCE_UPBEAT_DUR = 0.25;
const BOUNCE_TOP_VEL_BOOST = 1.05;
const BOUNCE_INNER_VEL_SCALE = 0.9;
const BOUNCE_PRIMARY_VEL = 0.75;
const BOUNCE_ALTERNATE_VEL = 0.65;
const BOUNCE_STACCATO_THRESHOLD = 0.6;  // intensityScale 超此 → staccato

function renderBounceM6(
    out: NoteData[],
    chord: GeneratedChord,
    rhVoicing: number[],
    params: PianoAccompParams,
): void {
    const dur = chord.endBeat - chord.startBeat;
    if (dur <= EPSILON) return;

    const rootPc = ((chord.bassOverride !== undefined ? chord.bassOverride : chord.root) % 12 + 12) % 12;
    const fifthPc = (rootPc + 7) % 12;
    const isHighEnergy = params.intensityScale > BOUNCE_STACCATO_THRESHOLD;
    const lhDur = isHighEnergy ? BOUNCE_DOWNBEAT_DUR_STACCATO : BOUNCE_DOWNBEAT_DUR_LEGATO;

    const baseVelocity = computeVelocity(params.velocityRange, params.intensityScale);

    // 8th-note iteration
    for (let b = 0; b < dur - EPSILON; b += 0.5) {
        const onset = chord.startBeat + b;
        const isDownbeat = Math.abs(b - Math.round(b)) < EPSILON;  // 整数拍

        if (isDownbeat) {
            // LH "oom" — alternating root/5
            const isPrimary = Math.abs((b | 0) % 2) < EPSILON;
            const lhPc = isPrimary ? rootPc : fifthPc;
            const lhPitch = PIANO_LH_BASS_ANCHOR + lhPc;
            const lhVel = baseVelocity * (isPrimary ? BOUNCE_PRIMARY_VEL : BOUNCE_ALTERNATE_VEL);
            out.push({
                pitch: lhPitch,
                onset,
                duration: lhDur,
                velocity: clamp01PianoVel(lhVel),
            });
        } else {
            // RH "pah" — chord stab on offbeat
            const n = rhVoicing.length;
            for (let v = 0; v < n; v++) {
                const isTop = v === n - 1;
                const velMul = isTop ? BOUNCE_TOP_VEL_BOOST : BOUNCE_INNER_VEL_SCALE;
                out.push({
                    pitch: rhVoicing[v],
                    onset,
                    duration: BOUNCE_UPBEAT_DUR,
                    velocity: clamp01PianoVel(baseVelocity * velMul),
                });
            }
        }
    }
}

// ============================================================
// 内部：V3.8 物理约束求解器 — per-step scoring 替换固定 grid pattern
// ============================================================
//
// 设计哲学（移植自 SampleDEMO BaseAccompIdiom.ts 1656-1747）：
//   不再"grid 该步是 0 或 1"，而是给每个 16th step 计算 playScoreRH 累加：
//     - 强拍 (metric weight ≥ 2) → +30
//     - 8 分拍 (weight = 1)       → +15
//     - 16 分弱拍 (weight = 0)    → 仅当 syncopationAssault 高时 +10（切分倾向）
//     - 抢拍位（距 chord 末尾 ≤0.5 拍 + offbeat）→ +20 × anticipationProb
//     - phantom vocal active 减分 (bar 0/1 静默)
//     - sparsity penalty: × (1 - sparsity)
//     - anti-typewriter: consecutivePlays^2 * 10 减分（连续 ≥3 击后递增惩罚）
//
//   动态阈值: threshold = 25 - intensityScale * 10（高能量更易开火）
//   超过阈值 → 发声（Block 风格全 voicing；Broken 单音琶音）
//
// 仅 RH 实装（LH 走原 M1/M4 路径），简化首版 scope

const SOLVER_STRONG_BEAT_SCORE = 30;
const SOLVER_EIGHTH_BEAT_SCORE = 15;
const SOLVER_OFFBEAT_BONUS = 10;
const SOLVER_ANTICIPATION_BONUS = 20;
const SOLVER_PHANTOM_VOCAL_PENALTY = 15;
const SOLVER_TYPEWRITER_PENALTY_BASE = 10;
const SOLVER_TYPEWRITER_FATIGUE_THRESHOLD = 3;
const SOLVER_BASE_THRESHOLD = 25;
const SOLVER_INTENSITY_THRESHOLD_SCALE = 10;
const SOLVER_DEFAULT_STEP_DUR = 0.25;
const STEPS_PER_BAR = STEPS_PER_BEAT * 4;

function renderRHSolver(
    out: NoteData[],
    chord: GeneratedChord,
    rhVoicing: number[],
    stepLen: number,
    params: PianoAccompParams,
    chordIndex: number,
): void {
    const totalSteps = Math.floor((chord.endBeat - chord.startBeat) * STEPS_PER_BEAT + 0.5);
    if (totalSteps <= 0) return;

    const startStep = Math.floor(chord.startBeat * STEPS_PER_BEAT + 0.5);
    const baseVelocity = computeVelocity(params.velocityRange, params.intensityScale);
    const intensityScale = params.intensityScale;
    const sparsity = params.sparsity ?? 0;
    const anticipationProb = params.anticipationProb ?? 0;
    const syncAssault = anticipationProb;  // 共享同一个 driver（来自 persona.syncopationAssault）

    const threshold = SOLVER_BASE_THRESHOLD - intensityScale * SOLVER_INTENSITY_THRESHOLD_SCALE;

    let consecutivePlays = 0;

    // 决定本和弦每一步是否发声 — 收集 fired hits
    const firedSteps: number[] = [];
    for (let s = 0; s < totalSteps; s++) {
        const absStep = startStep + s;
        const stepInBar = absStep % STEPS_PER_BAR;
        const metricWeight = SyncopationEvaluator.getMetricalWeight(stepInBar, STEPS_PER_BAR);
        const isOffBeat16th = stepInBar % 2 !== 0;
        const beatInChord = s * stepLen;
        const timeToEnd = (chord.endBeat - chord.startBeat) - beatInChord;
        const isAnticipationStep = timeToEnd > 0 && timeToEnd <= 0.5 && isOffBeat16th;

        let score = 0;

        // 节拍权重打底
        if (metricWeight >= 2) score += SOLVER_STRONG_BEAT_SCORE;
        else if (metricWeight === 1) score += SOLVER_EIGHTH_BEAT_SCORE;
        else if (isOffBeat16th) score += SOLVER_OFFBEAT_BONUS * syncAssault;

        // 抢拍奖励
        if (isAnticipationStep) score += SOLVER_ANTICIPATION_BONUS * anticipationProb;

        // sparsity 整体减分
        score *= (1 - sparsity * 0.5);

        // anti-typewriter fatigue
        if (consecutivePlays >= SOLVER_TYPEWRITER_FATIGUE_THRESHOLD) {
            score -= consecutivePlays * consecutivePlays * SOLVER_TYPEWRITER_PENALTY_BASE;
        }

        // phantom vocal mask（已经在 effectiveParams 里被调制，这里复用 sparsity 间接体现）
        // 显式 penalty for bar 0/1 弱拍：避免主唱主场时还乱弹 16th
        const absoluteMeasure = Math.floor(chord.startBeat / 4) + Math.floor(beatInChord / 4);
        const barWithin = ((absoluteMeasure % 4) + 4) % 4;
        if ((barWithin === 0 || barWithin === 1) && metricWeight === 0) {
            score -= SOLVER_PHANTOM_VOCAL_PENALTY;
        }

        // 决策
        if (score >= threshold) {
            firedSteps.push(s);
            consecutivePlays++;
        } else {
            consecutivePlays = 0;
        }
    }

    if (firedSteps.length === 0) return;

    // 发射 — Block 风格全 voicing；R3 Stab 短 duration；R2 Broken 单音琶音
    const n = rhVoicing.length;
    for (let h = 0; h < firedSteps.length; h++) {
        const step = firedSteps[h];
        const onset = chord.startBeat + step * stepLen;
        const nextStep = h + 1 < firedSteps.length ? firedSteps[h + 1] : totalSteps;
        let duration = (nextStep - step) * stepLen;
        if (params.rhTexture === RHTexture.Stab && duration > STAB_MAX_DURATION_BEATS) {
            duration = STAB_MAX_DURATION_BEATS;
        }
        const maxDur = chord.endBeat - onset;
        if (duration > maxDur) duration = maxDur;
        if (duration <= EPSILON) continue;

        if (params.rhTexture === RHTexture.Broken) {
            const pitch = rhVoicing[h % n];
            out.push({ pitch, onset, duration, velocity: baseVelocity });
        } else {
            for (let v = 0; v < n; v++) {
                out.push({ pitch: rhVoicing[v], onset, duration, velocity: baseVelocity });
            }
        }
        // 标记暂时静默 chordIndex 影响 — 用 chordIndex hash 给 PRNG-free 微差异
        void chordIndex;
    }
}

// ============================================================
// 内部：V3.6 Phantom Vocal Mask — 4-bar phrase 剧本式 params 调制
// ============================================================
//
// 设想（移植自 SampleDEMO BaseAccompIdiom.ts 1597-1618）：
//   即使没有真实 vocal，也假装有一个主唱在唱，按 4-bar phrase 剧本铺设：
//     bar 0/1: 主唱主场 — 钢琴让路（sparsity 上升 0.15，density 下降）
//     bar 2:   主唱喘息 — 钢琴切分回应（anticipationProb 上升 0.2）
//     bar 3:   20% 概率 fill zone（用 (absoluteMeasure * 137) % 100 > 80 触发，强 push）
//
// 这是当前 grid 渲染体系下"per-chord 调制"的近似实现 — V3.8 求解器会做更细的 per-step 修正

const PHANTOM_VOCAL_SPARSITY_BOOST = 0.15;
const PHANTOM_VOCAL_ANTICIPATION_BOOST = 0.20;
const PHANTOM_VOCAL_FILL_PROB_THRESHOLD = 80;  // (measure * 137) % 100 > 80 → 20% 命中
const PHANTOM_VOCAL_FILL_ANTICIPATION = 0.95;

function applyPhantomVocalMask(params: PianoAccompParams, chordStartBeat: number): PianoAccompParams {
    const absoluteMeasure = Math.floor(chordStartBeat / 4);
    const barWithinPhrase = ((absoluteMeasure % 4) + 4) % 4;

    let sparsity = params.sparsity ?? 0;
    let anticipationProb = params.anticipationProb ?? 0;

    if (barWithinPhrase === 0 || barWithinPhrase === 1) {
        sparsity = clamp01PianoVel(sparsity + PHANTOM_VOCAL_SPARSITY_BOOST);
    } else if (barWithinPhrase === 2) {
        anticipationProb = clamp01PianoVel(anticipationProb + PHANTOM_VOCAL_ANTICIPATION_BOOST);
    } else if (barWithinPhrase === 3) {
        // Fill zone 20%：(measure * 137) % 100 > 80 时强制 push
        const fillSeed = ((absoluteMeasure * 137) % 100 + 100) % 100;
        if (fillSeed > PHANTOM_VOCAL_FILL_PROB_THRESHOLD) {
            anticipationProb = PHANTOM_VOCAL_FILL_ANTICIPATION;
        }
    }

    return {
        ...params,
        sparsity,
        anticipationProb,
    };
}

// ============================================================
// 内部：V3.5 Signature Lick 渲染 — 把 LickDictionary 数据按当前 chord-root 投射，吸附到合法音池
// ============================================================
//
// 算法：
//   对 lick.rh / lick.lh 每个 LickNote：
//     1. 计算 onset = chord.startBeat + note.offset
//     2. 计算 raw pitch = chord.root + note.pitchOffset
//     3. 把 raw pitch 落到合理 register：
//          RH lick → 中央 C 附近（60~84 / C4~C6）
//          LH lick → bass register（36~54 / C2~F#3）
//     4. snapToPool 吸附到 chord-tone PC 池（避免大小三度撞音）
//     5. velocity = lick velocity × intensity factor × 持票折扣（0.65 减弱"死"力度）
//
// 跨 chord 边界裁剪：onset >= chord.endBeat 的音直接丢弃

const LICK_VELOCITY_DAMPING = 0.65;
const RH_LICK_CENTER = 64;  // E4 — 中央 C 上方
const LH_LICK_CENTER = 40;  // E2 — bass register

function renderLick(
    out: NoteData[],
    chord: GeneratedChord,
    lick: Lick,
    params: PianoAccompParams,
): void {
    const rootPc = ((chord.root % 12) + 12) % 12;
    const chordTonePcs = getChordTonePCs(chord);
    const baseVelocity = computeVelocity(params.velocityRange, params.intensityScale);

    // RH lick — 中央 C 附近
    for (let k = 0; k < lick.rh.length; k++) {
        const note = lick.rh[k];
        const onset = chord.startBeat + note.offset;
        if (onset >= chord.endBeat - EPSILON) continue;
        const dur = Math.min(note.duration, chord.endBeat - onset);
        if (dur <= EPSILON) continue;

        // raw pitch = chord root PC 落到 RH 中心 + pitchOffset
        let raw = RH_LICK_CENTER + (note.pitchOffset | 0) + rootPc;
        // 折叠到合理范围（C4 ~ C6）
        while (raw < 60) raw += 12;
        while (raw > 84) raw -= 12;
        // 吸附到 chord-tone 池（避免撞色）
        const snapped = snapToPool(raw, chordTonePcs);

        out.push({
            pitch: snapped,
            onset,
            duration: dur,
            velocity: clamp01PianoVel(note.velocity * baseVelocity * LICK_VELOCITY_DAMPING),
        });
    }

    // LH lick — bass register
    for (let k = 0; k < lick.lh.length; k++) {
        const note = lick.lh[k];
        const onset = chord.startBeat + note.offset;
        if (onset >= chord.endBeat - EPSILON) continue;
        const dur = Math.min(note.duration, chord.endBeat - onset);
        if (dur <= EPSILON) continue;

        let raw = LH_LICK_CENTER + (note.pitchOffset | 0) + rootPc;
        while (raw < 24) raw += 12;
        while (raw > 54) raw -= 12;
        const snapped = snapToPool(raw, chordTonePcs);

        out.push({
            pitch: snapped,
            onset,
            duration: dur,
            velocity: clamp01PianoVel(note.velocity * baseVelocity * LICK_VELOCITY_DAMPING * LH_VELOCITY_SCALE),
        });
    }
}

function clamp01PianoVel(v: number): number {
    return v < 0 ? 0 : (v > 1 ? 1 : v);
}

// ============================================================
// 内部：M5 Two-Handed Voicing → 单次 spread voicing 齐砸 sustain
// ============================================================
//
// 算法（MVP 保守版）：
//   LH 低音 = voicing[0] - 12（HarmonyCore voiceRange 最低 voice 再低一个八度）
//   + HarmonyCore voicing[0..3] 全部沿用
//   + 9th color tone（root + 14 PC）置于 voicing[top] 上方最近的 octave
//     仅当 chord 是 major / dominant 家族时加（minor/dim 不强行加 9，避免 minor 9th 撞音）
//
// 输出：5~6 个 NoteData，全部 onset = chord.startBeat，duration = chord 时长

const M5_VELOCITY_SCALE = 0.95;   // M5 spread voicing 略重于普通 RH
const NINTH_INTERVAL_PC = 2;       // 9th = root + 2 PC (大二度)
const PITCH_MAX = 127;

function renderM5TwoHandedVoicing(
    out: NoteData[],
    chord: GeneratedChord,
    params: PianoAccompParams,
): void {
    if (!chord.voicing || chord.voicing.length < 4) return;
    const dur = chord.endBeat - chord.startBeat;
    if (dur <= EPSILON) return;

    const rhVelocity = computeVelocity(params.velocityRange, params.intensityScale);
    const velocity = rhVelocity * M5_VELOCITY_SCALE;

    const v = chord.voicing;
    const pitches: number[] = [];

    // LH 低八度（voicing[0] 在 [48, 54)，-12 → [36, 42) = C2~F#2，piano LH 标准音域）
    const lhBass = v[0] - 12;
    if (lhBass >= 0) pitches.push(lhBass);

    // HarmonyCore 4-voice 沿用
    for (let i = 0; i < v.length; i++) pitches.push(v[i]);

    // 9th color tone — 仅 major / dom 家族
    const qBit = 1 << chord.quality;
    const isMajorish = (qBit & CQ_IS_MAJOR) !== 0 || (qBit & CQ_IS_DOM) !== 0
        || chord.quality === ChordQuality.Augmented
        || chord.quality === ChordQuality.Add9;
    if (isMajorish) {
        const rootPc = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
        const rootPcNorm = ((rootPc % 12) + 12) % 12;
        const ninthPc = (rootPcNorm + NINTH_INTERVAL_PC) % 12;
        const top = v[v.length - 1];
        const topPc = ((top % 12) + 12) % 12;
        let offset = (ninthPc - topPc + 12) % 12;
        if (offset === 0) offset = 12;  // 避开与 top voice 撞同音
        const ninthPitch = top + offset;
        if (ninthPitch <= PITCH_MAX) pitches.push(ninthPitch);
    }

    // 发射所有 voice — onset 一致，duration 整段
    for (let p = 0; p < pitches.length; p++) {
        const pitch = pitches[p];
        if (pitch < 0 || pitch > PITCH_MAX) continue;
        out.push({
            pitch,
            onset: chord.startBeat,
            duration: dur,
            velocity,
        });
    }
}

/**
 * 按 ChordQuality 决定 10th 间隔：
 *   major / dom / augmented / add9 → +16 (major 10th)
 *   minor / diminished family       → +15 (minor 10th)
 *   sus / dom7sus4                  → 0 (跳过 10th — sus 无 3rd)
 */
function pickTenthInterval(quality: ChordQuality): number {
    if (quality === ChordQuality.Sus4 || quality === ChordQuality.Dominant7Sus4) return 0;

    const qBit = 1 << quality;
    if ((qBit & CQ_IS_MAJOR) !== 0) return MAJOR_TENTH_INTERVAL;
    if ((qBit & CQ_IS_DOM) !== 0) return MAJOR_TENTH_INTERVAL;
    if ((qBit & CQ_IS_MINOR) !== 0) return MINOR_TENTH_INTERVAL;
    if ((qBit & CQ_IS_DIM) !== 0) return MINOR_TENTH_INTERVAL;
    // Augmented / Add9：major 10th
    if (quality === ChordQuality.Augmented || quality === ChordQuality.Add9) return MAJOR_TENTH_INTERVAL;
    return MAJOR_TENTH_INTERVAL;  // 兜底
}

// ============================================================
// 内部：velocity 计算
// ============================================================

function computeVelocity(velocityRange: [number, number], intensityScale: number): number {
    const [veloLo, veloHi] = velocityRange;
    const t = intensityScale < 0 ? 0 : (intensityScale > 1 ? 1 : intensityScale);
    const veloInt = Math.floor(veloLo + (veloHi - veloLo) * t + 0.5);
    const veloClamped = veloInt < 0 ? 0 : (veloInt > MIDI_MAX ? MIDI_MAX : veloInt);
    return veloClamped / MIDI_MAX;
}

// ============================================================
// Error
// ============================================================

export class PianoAccompIdiomError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'PianoAccompIdiomError';
        this.context = context;
    }
}
