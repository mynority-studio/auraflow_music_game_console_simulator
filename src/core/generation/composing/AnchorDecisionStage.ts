// Pitch Space: RELATIVE
//
// AnchorDecisionStage — 关键音/非关键音分化阶段（P0）
//
// 职责：为 ToplineEngine 生成的 phrase 级 NoteData[] 打上 isAnchor 标注。
// Anchor 定义：小节首末音 / 局部极值 / 大跳端点 / 长音 / 附点起音 / 乐句终止音。
// Anchor 必须是和弦音；若不是，则 snapToScale 吸附（位移 > 3 半音时降级为非 anchor）。
//
// 设计契约（见 /.claude/rules/music_generation_pipeline_rule.md）：
//   - 纯确定性：规则全部基于 onset/pitch/duration/chord 查表，不消耗 PRNG
//   - 相对空间：在 Orchestrator.applyOffset 之前调用，pitch 处于相对空间（K-1）
//   - 原地修改：直接改 notes[i].isAnchor / notes[i].pitch，不新建数组（M-1、C-4）
//   - 上界：max ~40 notes per phrase（C-4），max 8 chords active per phrase
//   - 浮点比较：全部用 Math.abs(a-b) < EPSILON（C-1、D-4）
//   - 禁止 Map/Set/spread/map/filter（P-1、C-3）
//
// PRNG 影响：零消耗 — stateA/B/C/D 快照值不变。但 melody[*].pitch 可能被 snap 改动 →
// golden JSON snapshot 需一次性重录（见 ACVE §5.2）。

import { NoteData, GeneratedChord } from '../types';
import { HarmonyCore } from './HarmonyCore';

const EPSILON = 1e-6;
const LEAP_SEMITONES = 5;         // 规则 4：≥ 4 度 (纯四度 = 5 半音) 视为跳进
const LONG_NOTE_BEATS = 1.5;       // 规则 5：时长 ≥ 1.5 拍视为长音（收紧：原 1.0 → 1.5，避免普通四分音符都成 anchor）
const EXTREMUM_MIN_DUR = 0.5;      // 规则 3 收紧：极值音的 duration 需 ≥ 0.5 拍，短促极值（16 分跑句冲高）不算骨架
const SNAP_MAX_SHIFT = 3;          // 吸附安全带：位移 > 3 半音时降级为非 anchor（见 §9 回滚风险）

export class AnchorDecisionStage {
    /**
     * 为一段 phrase 旋律原地打 anchor 标 + 和弦音校验。
     *
     * @param notes        phrase 的 NoteData（相对空间，applyOffset 之前）。原地修改
     * @param chords       全曲和弦列表，用于和弦音校验
     * @param beatsPerBar  拍号分子（4/4 = 4）
     * @param phraseStart  phrase 绝对起拍（用于 bar boundary 计算）
     * @param isPhraseLast 此 phrase 是否为段落末（强制末音为 anchor）
     */
    public static annotate(
        notes: NoteData[],
        chords: GeneratedChord[],
        beatsPerBar: number,
        phraseStart: number,
        isPhraseLast: boolean,
    ): void {
        const n = notes.length;
        if (n === 0) return;

        // 初始化：默认全部 false（但 P6a 前置 anchor 保留为 true）
        for (let i = 0; i < n; i++) {
            if (notes[i].isPreBuiltAnchor === true) {
                notes[i].isAnchor = true; // 强制保留 P6a 决策
            } else {
                notes[i].isAnchor = false;
            }
        }

        // ── 规则 1 & 2：每小节的首音、末音（需 duration ≥ EXTREMUM_MIN_DUR）
        // 收紧：16 分音符的小节首末音是 riff/run 的一部分，不是骨架，不标 anchor
        let firstOfBarIdx = 0;
        let currentBarIdx = Math.floor((notes[0].onset - phraseStart) / beatsPerBar);
        for (let i = 1; i < n; i++) {
            const barIdx = Math.floor((notes[i].onset - phraseStart) / beatsPerBar);
            if (barIdx !== currentBarIdx) {
                if (notes[firstOfBarIdx].duration >= EXTREMUM_MIN_DUR - EPSILON) {
                    notes[firstOfBarIdx].isAnchor = true;
                }
                if (notes[i - 1].duration >= EXTREMUM_MIN_DUR - EPSILON) {
                    notes[i - 1].isAnchor = true;
                }
                firstOfBarIdx = i;
                currentBarIdx = barIdx;
            }
        }
        // 最后一小节的首末音（同样加门槛）
        if (notes[firstOfBarIdx].duration >= EXTREMUM_MIN_DUR - EPSILON) {
            notes[firstOfBarIdx].isAnchor = true;
        }
        if (notes[n - 1].duration >= EXTREMUM_MIN_DUR - EPSILON) {
            notes[n - 1].isAnchor = true;
        }

        // ── 规则 3：局部极值（整 phrase 的最高 / 最低音，需 duration ≥ 0.5 拍）
        // 收紧：短促极值（16 分跑句顶点）不算骨架，避免 rip/run 中间音被误标
        let maxPitchIdx = 0;
        let minPitchIdx = 0;
        for (let i = 1; i < n; i++) {
            if (notes[i].pitch > notes[maxPitchIdx].pitch) maxPitchIdx = i;
            if (notes[i].pitch < notes[minPitchIdx].pitch) minPitchIdx = i;
        }
        if (notes[maxPitchIdx].duration >= EXTREMUM_MIN_DUR - EPSILON) {
            notes[maxPitchIdx].isAnchor = true;
        }
        if (notes[minPitchIdx].duration >= EXTREMUM_MIN_DUR - EPSILON) {
            notes[minPitchIdx].isAnchor = true;
        }

        // ── 规则 4：大跳（≥ 纯四度）目的地（收紧：只标跳进目的地，不标起始点）
        // 音乐学上"决定旋律走向"的是落在的那个音（目的地），跳出去的起始点只是过渡角色。
        // 装饰音不参与跳进计算（教程：装饰音是非关键音，不影响骨架轮廓）。
        for (let i = 1; i < n; i++) {
            if (notes[i].isGraceNote === true) continue;
            if (notes[i - 1].isGraceNote === true) continue;
            const leap = Math.abs(notes[i].pitch - notes[i - 1].pitch);
            if (leap >= LEAP_SEMITONES) {
                notes[i].isAnchor = true;
            }
        }

        // ── 规则 5：长音（duration ≥ 1 拍）────────────────────
        for (let i = 0; i < n; i++) {
            if (notes[i].duration >= LONG_NOTE_BEATS - EPSILON) {
                notes[i].isAnchor = true;
            }
        }

        // ── 规则 6：附点节奏的起音（0.75 / 1.5 / 3.0 拍 且 落在强拍）
        // 仅在强拍（整拍）上触发，避免 3 连音 0.75 误判
        for (let i = 0; i < n; i++) {
            const d = notes[i].duration;
            const isDotted =
                Math.abs(d - 0.75) < EPSILON ||
                Math.abs(d - 1.5) < EPSILON ||
                Math.abs(d - 3.0) < EPSILON;
            if (!isDotted) continue;
            // 起音需落在整拍（beatInBar 小数部分 < EPSILON）
            const beatInBar = ((notes[i].onset - phraseStart) % beatsPerBar + beatsPerBar) % beatsPerBar;
            const beatFrac = beatInBar - Math.floor(beatInBar);
            if (Math.abs(beatFrac) < EPSILON) {
                notes[i].isAnchor = true;
            }
        }

        // ── 规则 7：段落末 phrase 末音强制 anchor（已在规则 1&2 覆盖，但显式保留契约）
        if (isPhraseLast) {
            notes[n - 1].isAnchor = true;
        }

        // 装饰音永远不是 anchor — 覆盖上面所有规则
        for (let i = 0; i < n; i++) {
            if (notes[i].isGraceNote === true) notes[i].isAnchor = false;
        }

        // ── 和弦音校验 + snap 吸附 ────────────────────────────
        // 每个 anchor 必须是当前活动和弦的和弦音；不是则 snapToScale 吸附到最近和弦音。
        // 位移 > SNAP_MAX_SHIFT 半音时降级为非 anchor（避免轮廓崩坏）。
        // 🌟 P6a: isPreBuiltAnchor 跳过 snap（信任 AnchorBackbone 已选 chord tone，避免 snap 撕裂 P6a 决策）
        for (let i = 0; i < n; i++) {
            if (notes[i].isAnchor !== true) continue;
            if (notes[i].isPreBuiltAnchor === true) continue; // P6a 信任前置决策

            const chord = findActiveChord(chords, notes[i].onset);
            if (chord === null) continue; // 无活动和弦（极端边界情形），保持 anchor 原状

            // chordTones 是绝对 pitch（在 60 附近），用 % 12 转 pc 做比较
            const chordTones = HarmonyCore.getChordTones(chord, 60);
            const chordPcs: number[] = [];
            for (let j = 0; j < chordTones.length; j++) {
                chordPcs.push(((chordTones[j] % 12) + 12) % 12);
            }

            const notePc = ((notes[i].pitch % 12) + 12) % 12;
            let isChordTone = false;
            for (let j = 0; j < chordPcs.length; j++) {
                if (chordPcs[j] === notePc) { isChordTone = true; break; }
            }
            if (isChordTone) continue;

            // 尝试 snap 到最近和弦音
            const originalPitch = notes[i].pitch;
            const snapped = HarmonyCore.snapToScale(originalPitch, chordPcs);
            const shift = Math.abs(snapped - originalPitch);

            if (shift <= SNAP_MAX_SHIFT) {
                notes[i].pitch = snapped;
            } else {
                // 位移过大：降级为非 anchor，保留原 pitch 不撕裂轮廓
                notes[i].isAnchor = false;
            }
        }
    }
}

/**
 * 二分查找活动和弦。chords 按 startBeat 升序（ToplineEngine 的契约）。
 * 找不到返回 null（phrase 起始早于第一个和弦时）。
 */
function findActiveChord(chords: GeneratedChord[], onset: number): GeneratedChord | null {
    const len = chords.length;
    if (len === 0) return null;
    for (let i = 0; i < len; i++) {
        const c = chords[i];
        if (onset >= c.startBeat - EPSILON && onset < c.endBeat - EPSILON) {
            return c;
        }
    }
    // 边界 fallback：onset 恰好等于最后一个和弦的 endBeat
    const last = chords[len - 1];
    if (onset >= last.startBeat - EPSILON) return last;
    return null;
}
