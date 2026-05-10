// ============================================================
// GrooveEngine — 纯查表鼓组渲染器（数据外置改造 #1 + 拍号参数化 #4-A + GrooveDNA 回写 #3）
// ============================================================
// Pitch Space: ABSOLUTE-DRUM（GM Drum Map 物理键位，永不加 keyOffset）
//
// 算法零硬编码：所有鼓型来自 style.rhythm.drumPatterns。
// 对每个段落：
//   1) 按 energyLevel 选 pattern（落不到任何 pattern 区间则跳过该段）
//   2) 按 0.25 拍步长扫整段，每个网格点：
//      - 段首 crash（确定性，无 PRNG）
//      - fixedHits 命中位 → 触发（确定性，无 PRNG）
//      - densityHits 命中位 → PRNG<density 触发（PRNG ×1 trigger + ×1 velocity）
//      - 16 分鬼音网格 → energy/density 双门槛 + PRNG<ghost.probability（PRNG ×1 + ×1）
//   3) building-up 段落最后 1 小节后半段：drum fill（snare 滚奏 + 4 分 kick 铺底）
//   4) 全部段落生成完毕后，按段提炼 grooveDNA（16 分槽位权重指纹）回写到 sec.grooveDNA
//      —— 让 ToplineEngine 等下游消费同一份律动指纹，实现"全曲一致 groove"
// ============================================================

import { NoteData, SectionMetadata, StyleConfig, DrumPattern } from '../types';
import { PRNGManager } from '../../utils/PRNG';

const BEAT_EPS = 0.001;
const GRID_EPS = 0.01;
const POS_EPS = 0.01;

const FILL_LAST_BAR_BEATS = 4;     // 最后 1 小节
const FILL_START_BEAT = 2.0;       // 后半段（最后 2 拍）
const FILL_VEL_BASE = 0.5;
const FILL_VEL_RANGE = 0.5;
const FILL_HIT_DUR = 0.25;

const DEFAULT_TIME_SIGNATURE: [number, number] = [4, 4];

// GrooveDNA：每 0.25 拍一个槽位的权重 0~1
// 各 GM 鼓键位的"律动权重"（用于提炼指纹）：kick > snare > hihat > 其他
const GROOVE_WEIGHT_KICK = 1.0;
const GROOVE_WEIGHT_SNARE = 0.8;
const GROOVE_WEIGHT_HIHAT_CLOSED = 0.3;
const GROOVE_WEIGHT_HIHAT_OPEN = 0.4;
const GROOVE_WEIGHT_OTHER = 0.2;

function matchPosition(positions: number[], bInBar: number): boolean {
    for (let i = 0; i < positions.length; i++) {
        if (Math.abs(positions[i] - bInBar) < POS_EPS) return true;
    }
    return false;
}

function pickPattern(patterns: DrumPattern[] | undefined, energy: number): DrumPattern | null {
    if (!patterns || patterns.length === 0) return null;
    for (let i = 0; i < patterns.length; i++) {
        const p = patterns[i];
        if (energy >= p.energyMin && energy <= p.energyMax) return p;
    }
    return null;
}

function grooveWeight(pitch: number): number {
    if (pitch === 36) return GROOVE_WEIGHT_KICK;
    if (pitch === 38 || pitch === 37) return GROOVE_WEIGHT_SNARE;
    if (pitch === 42) return GROOVE_WEIGHT_HIHAT_CLOSED;
    if (pitch === 46) return GROOVE_WEIGHT_HIHAT_OPEN;
    return GROOVE_WEIGHT_OTHER;
}

export class GrooveEngine {
    public static generateDrums(
        sections: SectionMetadata[],
        style?: StyleConfig,
        timeSignature: [number, number] = DEFAULT_TIME_SIGNATURE,
    ): NoteData[] {
        const drums: NoteData[] = [];
        const density = 1.0;
        const patterns = style?.rhythm.drumPatterns;

        // 拍号驱动：4/4=4 拍/小节, 3/4=3, 6/8=3, 12/8=6
        const barBeats = (timeSignature[0] * 4) / timeSignature[1];

        for (let si = 0; si < sections.length; si++) {
            const sec = sections[si];
            const e = sec.energyLevel;

            const pattern = pickPattern(patterns, e);
            if (!pattern) continue;

            const nextSec = sections[si + 1];
            const isBuildingUp = !!(nextSec && nextSec.energyLevel > sec.energyLevel);

            const sectionFirstHitIdx = drums.length;

            for (let b = sec.startBeat; b < sec.endBeat - BEAT_EPS; b += 0.25) {
                const bInBar = (b - sec.startBeat) % barBeats;
                const isDownbeat = Math.abs(bInBar - 0) < GRID_EPS;
                const is8th = Math.abs((b * 2) % 1) < GRID_EPS;
                const isLastBar = b >= sec.endBeat - FILL_LAST_BAR_BEATS;

                // --- Drum Fill（building-up 段落末尾）---
                if (isBuildingUp && isLastBar) {
                    const fillBeat = b - (sec.endBeat - FILL_LAST_BAR_BEATS);
                    if (fillBeat >= FILL_START_BEAT) {
                        const swellVel =
                            FILL_VEL_BASE +
                            ((fillBeat - FILL_START_BEAT) / FILL_START_BEAT) * FILL_VEL_RANGE;
                        drums.push({ pitch: 38, onset: b, duration: FILL_HIT_DUR, velocity: swellVel });
                        if (
                            isDownbeat ||
                            Math.abs(bInBar - 1) < GRID_EPS ||
                            Math.abs(bInBar - 2) < GRID_EPS ||
                            Math.abs(bInBar - 3) < GRID_EPS
                        ) {
                            drums.push({ pitch: 36, onset: b, duration: FILL_HIT_DUR, velocity: 0.8 });
                        }
                        continue;
                    }
                }

                // 检测 16 分鬼音命中（先取，让 8 分跳过逻辑能照顾它）
                const ghostHit = pattern.ghost && matchPosition(pattern.ghost.positions, bInBar);

                if (!is8th && !ghostHit) continue;

                // --- 8 分网格主体击点 ---
                if (is8th) {
                    // 段首 crash（仅在该段第 1 拍 + 仅 pattern.crashOnSectionStart 存在时）
                    if (
                        pattern.crashOnSectionStart &&
                        isDownbeat &&
                        Math.abs(b - sec.startBeat) < GRID_EPS
                    ) {
                        drums.push({
                            pitch: pattern.crashOnSectionStart.pitch,
                            onset: b,
                            duration: pattern.crashOnSectionStart.duration,
                            velocity: pattern.crashOnSectionStart.velocity,
                        });
                    }

                    // 固定击点：deterministic，无 PRNG
                    for (let i = 0; i < pattern.fixedHits.length; i++) {
                        const layer = pattern.fixedHits[i];
                        if (matchPosition(layer.positions, bInBar)) {
                            drums.push({
                                pitch: layer.pitch,
                                onset: b,
                                duration: layer.duration,
                                velocity: layer.velocity,
                            });
                        }
                    }

                    // 概率击点：PRNG ×1 trigger + ×1 velocity
                    for (let i = 0; i < pattern.densityHits.length; i++) {
                        const layer = pattern.densityHits[i];
                        if (matchPosition(layer.positions, bInBar)) {
                            if (PRNGManager.nextFloat(0, 1) < density) {
                                drums.push({
                                    pitch: layer.pitch,
                                    onset: b,
                                    duration: layer.duration,
                                    velocity: PRNGManager.nextFloat(layer.velocityRange[0], layer.velocityRange[1]),
                                });
                            }
                        }
                    }
                }

                // --- 16 分鬼音 ---
                if (ghostHit && pattern.ghost) {
                    const g = pattern.ghost;
                    if (
                        e >= g.energyMin &&
                        density > g.densityThreshold &&
                        PRNGManager.nextFloat(0, 1) < g.probability
                    ) {
                        drums.push({
                            pitch: g.pitch,
                            onset: b,
                            duration: g.duration,
                            velocity: PRNGManager.nextFloat(g.velocityRange[0], g.velocityRange[1]),
                        });
                    }
                }
            }

            // --- GrooveDNA 提炼：扫该段内 hit 累加到 16 分槽位（按 barBeats×4），按 pitch 权重 + velocity 调权 ---
            const slotsPerBar = Math.max(1, Math.round(barBeats * 4));
            const dna: number[] = new Array(slotsPerBar);
            for (let i = 0; i < slotsPerBar; i++) dna[i] = 0;

            for (let i = sectionFirstHitIdx; i < drums.length; i++) {
                const hit = drums[i];
                const localBeat = hit.onset - sec.startBeat;
                const slot = ((Math.round(localBeat * 4) % slotsPerBar) + slotsPerBar) % slotsPerBar;
                const w = grooveWeight(hit.pitch) * hit.velocity;
                if (w > dna[slot]) dna[slot] = w;
            }
            sec.grooveDNA = dna;
        }

        return drums;
    }
}
