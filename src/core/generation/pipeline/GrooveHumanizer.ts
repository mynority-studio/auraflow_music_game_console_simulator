// ============================================================
// GrooveHumanizer — G 维度微观律动末端调制(Phase 6a)
// ============================================================
//
// PEAA G 维度真消费 — 通过末端 onset / velocity 微扰打破"机械感"。
//
// 设计:
//   1. 对每 note 派生 deterministic hash(pitch + onset + track 标识)
//   2. onset offset 范围 ±(G × 30ms 折算成 beat,默认 BPM 100 ≈ 0.05 beat)
//   3. velocity offset 范围 ±(G × 0.08)
//   4. Drums 专属:hi-hat lay-back(onset 偏正)+ kick on-the-grid
//
// 调用时机:Reconciler 之后(所有 tracks 已确定),输出 sort 之前。
// D-3 重排:onset 变化后需重新 sort,本模块就地排序。
//
// 风险与缓解:
//   - Reconciler 已运行,velocity damp / collision 已应用 → G 不影响 v1
//   - kickAnchors 已被消费(Bass walking 已读完)→ G 不影响 interlock
//   - LIL Pass 3 已 lift → G 不破解决方案
//   - 同 pitch onset 撞音如果是"故意 doubling",原本就 ε 匹配;G 后仍 ε 匹配吗?
//     不一定 — 但 humanization 本就是音乐家手指自然微误差,撞音不再 ε 匹配是
//     正确行为。
//
// 零 PRNG(纯 hash)。
//
// 关联:cross_sync_rule §1.16(G 字段 ↔ humanization 应用点)
// ============================================================

import { NoteData } from '../types';
import type { WeatherSampler } from '../ir/RenderContext';

// ============================================================
// 常量
// ============================================================

/** onset 最大偏移(beat,默认 BPM 100 下约 30ms)。G=1 时达到此值。 */
const ONSET_OFFSET_MAX_BEATS = 0.05;
/** velocity 最大偏移(0-1 normalized)。G=1 时达到此值。 */
const VELOCITY_OFFSET_MAX = 0.08;
/** 鼓 hi-hat lay-back 偏移(beat,正向延迟,G=1 时达到此值)。Dilla / Neo-Soul 风。 */
const HIHAT_LAYBACK_MAX_BEATS = 0.04;
/** GM Drum Map 物理键位(对照 DrumIdiom)*/
const DRUM_KICK = 36;
const DRUM_HIHAT_CLOSED = 42;
const DRUM_HIHAT_OPEN = 46;

// ============================================================
// Deterministic hash:note 派生 [-1, 1] 浮点
// ============================================================

function hashTo11(seed: number): number {
    let h = (seed * 2654435761) >>> 0;
    h = ((h ^ (h >>> 16)) * 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return (h / 0x80000000) - 1.0;  // [-1, 1)
}

function noteHash(note: NoteData, salt: number): number {
    // pitch * P1 + Math.floor(onset * P2) + salt
    return ((note.pitch * 73856093) ^ (Math.floor(note.onset * 1000) * 19349663) ^ salt) >>> 0;
}

// ============================================================
// 主入口
// ============================================================

/**
 * 对单 track 应用 G 维度 humanization(就地修改 + 重排)。
 *
 * 参数:
 *   - notes: NoteData[] 输入轨(就地修改)
 *   - weather: WeatherSampler(每 note 按 onset 取 G)
 *   - trackSalt: 区分不同 track 的 hash 偏移(防 Bass / Piano 同 onset+pitch 走同样扰动)
 *   - isDrums: true → 应用鼓专属 lay-back 逻辑
 */
export function humanizeTrack(
    notes: NoteData[],
    weather: WeatherSampler,
    trackSalt: number,
    isDrums: boolean = false,
): void {
    if (notes.length === 0) return;

    for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const g = weather.at(n.onset).g;
        if (g <= 0.01) continue;  // G ≈ 0,humanization 关

        // 派生两个独立 hash:onset / velocity
        const baseHash = noteHash(n, trackSalt);
        const onsetH = hashTo11(baseHash);
        const veloH = hashTo11(baseHash ^ 0xA5A5A5A5);

        // velocity 微扰:±G × MAX
        const veloOffset = veloH * g * VELOCITY_OFFSET_MAX;
        n.velocity = clamp01(n.velocity + veloOffset);

        // onset 微扰
        if (isDrums) {
            // 鼓专属:hi-hat lay-back(正向延迟)/ kick on-the-grid
            if (n.pitch === DRUM_HIHAT_CLOSED || n.pitch === DRUM_HIHAT_OPEN) {
                // lay-back:onset += g × HIHAT_LAYBACK_MAX_BEATS × |onsetH|(始终正向)
                const layback = g * HIHAT_LAYBACK_MAX_BEATS * Math.abs(onsetH);
                n.onset += layback;
            } else if (n.pitch === DRUM_KICK) {
                // kick:不偏移(锁拍是律动的基础)
            } else {
                // snare / toms:正常 ±G 微扰
                n.onset += onsetH * g * ONSET_OFFSET_MAX_BEATS;
            }
        } else {
            // 旋律/和声:±G 微扰
            n.onset += onsetH * g * ONSET_OFFSET_MAX_BEATS;
        }
    }

    // D-3 重排:onset ASC, pitch ASC
    notes.sort((a, b) => {
        const d = a.onset - b.onset;
        if (Math.abs(d) > 1e-6) return d;
        return a.pitch - b.pitch;
    });
}

// ============================================================
// 工具
// ============================================================
function clamp01(x: number): number {
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
}
