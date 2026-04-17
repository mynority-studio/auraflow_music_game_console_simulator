// AnchorBackbone — 骨架优先生成（P6a）
//
// Pitch Space: RELATIVE（与 NoteData.pitch / chord.root 一致，applyOffset 之前）
//
// 设计来源：
// - Luis 提案 #1：Bresenham + 线性插值寻路（避免在 ESP32 跑 A*）
// - 拓展：anchor 数量按 phrase 长度自适应；末位 anchor 由 cadenceType 决定
//
// 职责：
//   - 为每个 PhraseGroup 生成 PhraseSkeleton（2-5 个 anchor onset + pitch）
//   - 每个 anchor 必须是当前 chord 的 chord tone
//   - 相邻 anchor 间最大音程：纯五度（7 半音）
//   - 末位 anchor 由 cadenceType 决定（Closed→root/3, Open→5/2，复用 precomputedCadenceDegree）
//   - 高张力位置 anchor 倾向高音区（来自 PhraseContour.at()）
//
// 设计契约：
//   - 零 PRNG 消耗（D-1）— 所有"选哪个 chord tone"的决策复用现有抽签结果（precomputedCadenceDegree）
//     或确定性规则（最近距离 / 张力调制）
//   - 不读 GlobalContext（S-2）
//   - 不引入 Map/Set（P-1）
//   - 浮点比较用 epsilon（C-1）
//   - C 移植友好：max ~6 anchors per phrase，max ~80 phrases per song

import { GeneratedChord, PhraseGroup, SectionMetadata, Tonality, CadenceType, SubMotifRole } from '../types';
import { HarmonyCore } from './HarmonyCore';
import { TensionEnvelope } from './PhraseContourPlanner';

const EPSILON = 1e-6;
const MAX_ANCHOR_INTERVAL = 7;  // 相邻 anchor 间最大音程（纯五度）
const MIN_PHRASE_LEN_FOR_3_ANCHORS = 5;  // ≥5 拍用 3+ anchor
const MIN_PHRASE_LEN_FOR_4_ANCHORS = 9;  // ≥9 拍用 4+ anchor
const MIN_PHRASE_LEN_FOR_5_ANCHORS = 13; // ≥13 拍用 5 anchor

/**
 * PhraseSkeleton — 一个 PhraseGroup 的 anchor 骨架
 * max ~6 anchors per skeleton（C-4 上界）
 */
export interface PhraseSkeleton {
    anchorOnsets: number[];      // 绝对拍位（与 NoteData.onset 同坐标系）
    anchorPitches: number[];     // 相对空间 MIDI（围绕 60）
    anchorTensions: number[];    // 来自 TensionEnvelope.at() 的查值
    cadenceTarget: number;       // = anchorPitches[last]，单独存便于 realizeMotif 引用
    sourceGroupIndex: number;    // 调试：属于哪个 PhraseGroup
}

export type SectionSkeleton = PhraseSkeleton[];

export class AnchorBackbone {
    /**
     * 为整个 section 构建 anchor 骨架（per group）
     *
     * @param section            当前段落
     * @param phraseGroups       该段的 PhraseGroup 列表（已含 precomputedCadenceDegree）
     * @param chords             全曲 chord 列表（绝对 onset）
     * @param tonality           调式
     * @param tensionEnv         全曲张力封套
     * @param previousLastAnchor 上一段末 anchor 的 pitch（连贯性，null = 首段）
     * @param targetCenter       目标中心音（来自 pitchOffset，60 + offset）
     * @param instrumentRange    乐器音域 [minPitch, maxPitch]（绝对 MIDI - keyOffset = 相对范围）
     */
    public static buildForSection(
        section: SectionMetadata,
        phraseGroups: PhraseGroup[],
        chords: GeneratedChord[],
        tonality: Tonality,
        tensionEnv: TensionEnvelope,
        previousLastAnchor: number | null,
        targetCenter: number,
        instrumentRange: [number, number],
        preferExtension: boolean = false,  // F-APR1: Persona 偏好（R&B/Neo-Soul 倾向 7/9/11）
    ): SectionSkeleton {
        const skeletons: SectionSkeleton = [];
        let runningPrevAnchor = previousLastAnchor;

        for (let gIdx = 0; gIdx < phraseGroups.length; gIdx++) {
            const group = phraseGroups[gIdx];
            const skel = this.buildForPhrase(
                group,
                chords,
                tonality,
                tensionEnv,
                runningPrevAnchor,
                targetCenter,
                instrumentRange,
                gIdx,
                preferExtension,
            );
            skeletons.push(skel);
            runningPrevAnchor = skel.anchorPitches[skel.anchorPitches.length - 1];
        }

        return skeletons;
    }

    /**
     * 单个 phrase 的 skeleton 生成
     */
    private static buildForPhrase(
        group: PhraseGroup,
        chords: GeneratedChord[],
        tonality: Tonality,
        tensionEnv: TensionEnvelope,
        prevAnchor: number | null,
        targetCenter: number,
        instrumentRange: [number, number],
        sourceGroupIndex: number,
        preferExtension: boolean = false,  // F-APR1
    ): PhraseSkeleton {
        // ── 1. 决定 anchor 数量与位置 ─────────────────────
        const lengthBeats = group.lengthBeats;
        let anchorCount: number;
        if (lengthBeats >= MIN_PHRASE_LEN_FOR_5_ANCHORS) anchorCount = 5;
        else if (lengthBeats >= MIN_PHRASE_LEN_FOR_4_ANCHORS) anchorCount = 4;
        else if (lengthBeats >= MIN_PHRASE_LEN_FOR_3_ANCHORS) anchorCount = 3;
        else anchorCount = 2;

        const anchorOnsets: number[] = [];
        for (let k = 0; k < anchorCount; k++) {
            const ratio = anchorCount === 1 ? 0 : k / (anchorCount - 1);
            // 末位 anchor 不能正好在 group.endBeat（会跨 chord 边界），留 0.25 拍余量
            let onset = group.startBeat + ratio * lengthBeats;
            if (k === anchorCount - 1) {
                onset = Math.min(onset, group.startBeat + lengthBeats - 0.25);
            }
            anchorOnsets.push(onset);
        }

        // ── 2. 决定末位 anchor pitch（由 cadenceType + precomputedCadenceDegree 决定）─
        const lastSlot = group.subMotifs[group.subMotifs.length - 1];
        const cadenceDegree = lastSlot.precomputedCadenceDegree !== undefined
            ? lastSlot.precomputedCadenceDegree
            : (group.cadenceType === CadenceType.Closed ? 1 : 5);

        const lastChord = this.findActiveChord(chords, anchorOnsets[anchorCount - 1]);
        const cadencePitch = this.pickPitchForDegree(
            lastChord, cadenceDegree, tonality, targetCenter, prevAnchor, instrumentRange
        );

        // ── 3. 决定首位 anchor pitch（连贯性）─────────────
        const firstChord = this.findActiveChord(chords, anchorOnsets[0]);
        const firstPitch = this.pickFirstAnchorPitch(
            firstChord, tonality, prevAnchor, targetCenter, instrumentRange
        );

        // ── 4. 决定中间 anchor pitches（chord-tone 内 + 张力调制）
        const anchorPitches: number[] = [firstPitch];
        for (let k = 1; k < anchorCount - 1; k++) {
            const chord = this.findActiveChord(chords, anchorOnsets[k]);
            const tension = tensionEnv.at(anchorOnsets[k], group.startBeat, lengthBeats);
            // desiredCenter：高张力倾向高音区（±3 半音偏移）
            const desiredCenter = targetCenter + (tension - 0.5) * 6;
            const prevP = anchorPitches[k - 1];
            const midPitch = this.pickMidAnchorPitch(
                chord, tonality, prevP, desiredCenter, instrumentRange, preferExtension
            );
            anchorPitches.push(midPitch);
        }
        anchorPitches.push(cadencePitch);

        // ── 5. 收集 tensions ──────────────────────────────
        const anchorTensions: number[] = [];
        for (let k = 0; k < anchorCount; k++) {
            anchorTensions.push(tensionEnv.at(anchorOnsets[k], group.startBeat, lengthBeats));
        }

        return {
            anchorOnsets,
            anchorPitches,
            anchorTensions,
            cadenceTarget: cadencePitch,
            sourceGroupIndex,
        };
    }

    /**
     * 找当前 onset 对应的活动和弦（线性扫描，max ~100 chords per song，C-4 合规）
     */
    private static findActiveChord(chords: GeneratedChord[], onset: number): GeneratedChord {
        for (let i = 0; i < chords.length; i++) {
            const c = chords[i];
            if (onset >= c.startBeat - EPSILON && onset < c.endBeat - EPSILON) {
                return c;
            }
        }
        // 边界 fallback：onset 等于最后一个 chord 的 endBeat
        return chords[chords.length - 1] || chords[0];
    }

    /**
     * 在 chord 的 chord tones 中按"度数"选音
     * degree: 1 = root, 3 = 3rd, 5 = 5th, 7 = 7th, 2 / 4 / 6 = scale tones（fallback）
     * 选择"距 prevAnchor 最近"的八度位置
     */
    private static pickPitchForDegree(
        chord: GeneratedChord,
        degree: number,
        tonality: Tonality,
        targetCenter: number,
        prevAnchor: number | null,
        instrumentRange: [number, number],
    ): number {
        const chordTones = HarmonyCore.getChordTones(chord, targetCenter);
        // chordTones[0]=root, [1]=3rd, [2]=5th, [3]=7th 等
        let candidate: number;
        if (degree === 1 && chordTones.length > 0) candidate = chordTones[0];
        else if (degree === 3 && chordTones.length > 1) candidate = chordTones[1];
        else if (degree === 5 && chordTones.length > 2) candidate = chordTones[2];
        else if (degree === 7 && chordTones.length > 3) candidate = chordTones[3];
        else if (chordTones.length > 0) {
            // fallback: 使用 scale tone（度数 2/4/6 等通过 getSafeScalePitches 找）
            const safeScalePcs = HarmonyCore.getSafeScalePitches(chord, tonality);
            candidate = HarmonyCore.snapToScale(targetCenter, safeScalePcs);
        } else {
            candidate = targetCenter;
        }

        // 调整到 prevAnchor 附近的最佳八度（如果有 prevAnchor）
        if (prevAnchor !== null) {
            candidate = this.nearestOctave(candidate, prevAnchor);
        }

        // 范围 clamp（给 ±3 半音余量避开 instrument 边界）
        candidate = this.clampToRange(candidate, instrumentRange);
        return candidate;
    }

    /**
     * 首位 anchor 选择策略：
     * - 有 prevAnchor → 在 chord tones 中选距 prevAnchor 最近的（≤5 半音）
     * - 无 prevAnchor → 选距 targetCenter 最近的 chord tone
     */
    private static pickFirstAnchorPitch(
        chord: GeneratedChord,
        _tonality: Tonality,
        prevAnchor: number | null,
        targetCenter: number,
        instrumentRange: [number, number],
    ): number {
        const chordTones = HarmonyCore.getChordTones(chord, targetCenter);
        if (chordTones.length === 0) return this.clampToRange(targetCenter, instrumentRange);

        const reference = prevAnchor !== null ? prevAnchor : targetCenter;
        let bestPitch = chordTones[0];
        let bestDist = 999;
        for (let i = 0; i < chordTones.length; i++) {
            const adjusted = this.nearestOctave(chordTones[i], reference);
            const dist = Math.abs(adjusted - reference);
            if (dist < bestDist) {
                bestDist = dist;
                bestPitch = adjusted;
            }
        }

        // 如果距离 > 5 半音，强制 shiftDiatonic 一步靠近
        if (prevAnchor !== null && bestDist > 5) {
            const sign = bestPitch > prevAnchor ? -1 : 1;
            // 简单半音级进（不走 scale，避免引入额外参数）
            bestPitch = prevAnchor + sign * 3;
        }

        return this.clampToRange(bestPitch, instrumentRange);
    }

    /**
     * 中间 anchor 选择：
     * - 候选：chord tones（按 |c - prevAnchor| ≤ MAX_ANCHOR_INTERVAL 过滤）
     * - 在候选中选距 desiredCenter 最近的
     * - 🌟 F-APR1 Persona 偏好：extensionTargeting=true（R&B/Neo-Soul/Jazz）时优先 7/9/11 度
     *   普通 Pop 优先 root/3/5。通过 weight 系数实现，不破坏确定性
     * - 候选为空 → 用 prevAnchor + sign × 3 半音 fallback
     */
    private static pickMidAnchorPitch(
        chord: GeneratedChord,
        _tonality: Tonality,
        prevAnchor: number,
        desiredCenter: number,
        instrumentRange: [number, number],
        preferExtension: boolean = false,  // F-APR1
    ): number {
        const chordTones = HarmonyCore.getChordTones(chord, desiredCenter);
        // 候选 + Persona 权重（chordTones[0]=root, [1]=3rd, [2]=5th, [3]=7th, [4]=9th, [5]=11th）
        const candidates: { pitch: number, weight: number }[] = [];
        for (let i = 0; i < chordTones.length; i++) {
            const adjusted = this.nearestOctave(chordTones[i], prevAnchor);
            if (Math.abs(adjusted - prevAnchor) <= MAX_ANCHOR_INTERVAL) {
                // F-APR1 weight：
                //  Pop: root/3/5 高权重 (1.0/1.0/0.8)，7/9/11 低 (0.4/0.3/0.2)
                //  R&B: 3/5/7/9 高权重 (0.6/0.7/1.0/1.0)，root 中 (0.5)
                let w = 0.5;
                if (preferExtension) {
                    if (i === 0) w = 0.5;        // root
                    else if (i === 1) w = 0.6;   // 3rd
                    else if (i === 2) w = 0.7;   // 5th
                    else if (i === 3) w = 1.0;   // 7th
                    else if (i === 4) w = 1.0;   // 9th
                    else if (i === 5) w = 0.8;   // 11th
                } else {
                    if (i === 0) w = 1.0;        // root
                    else if (i === 1) w = 1.0;   // 3rd
                    else if (i === 2) w = 0.8;   // 5th
                    else if (i === 3) w = 0.4;   // 7th
                    else if (i === 4) w = 0.3;   // 9th
                    else w = 0.2;                // 11th+
                }
                candidates.push({ pitch: adjusted, weight: w });
            }
        }

        if (candidates.length === 0) {
            const dir = desiredCenter > prevAnchor ? 1 : -1;
            return this.clampToRange(prevAnchor + dir * 3, instrumentRange);
        }

        // 选 weight × 距 desiredCenter 反距离 最高的（确定性最优）
        let best = candidates[0].pitch;
        let bestScore = -Infinity;
        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            const distance = Math.abs(c.pitch - desiredCenter);
            // score = weight × (1 / (distance + 1))，距离越近 + 权重越高 = 越优
            const score = c.weight / (distance + 1);
            if (score > bestScore) {
                bestScore = score;
                best = c.pitch;
            }
        }
        return this.clampToRange(best, instrumentRange);
    }

    /**
     * 把 pitch 移到 reference 附近的最佳八度
     */
    private static nearestOctave(pitch: number, reference: number): number {
        let p = pitch;
        while (p - reference > 6) p -= 12;
        while (reference - p > 6) p += 12;
        return p;
    }

    /**
     * 范围 clamp（给 ±3 半音余量避开 instrument 边界）
     */
    private static clampToRange(pitch: number, range: [number, number]): number {
        const lo = range[0] + 3;
        const hi = range[1] - 3;
        let p = pitch;
        while (p > hi) p -= 12;
        while (p < lo) p += 12;
        return p;
    }
}

// SubMotifRole 仅为类型导入对齐，此处 export none
export type { SubMotifRole };
