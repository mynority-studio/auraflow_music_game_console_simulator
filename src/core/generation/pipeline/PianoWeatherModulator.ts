// ============================================================
// PianoWeatherModulator — mg 钢琴输出的 weather post-modulation(C.5)
// ============================================================
//
// 出处:mg_engine_integration_plan.md §3 C.5 — auraflow 5 维气象接入 mg 钢琴。
//
// 设计哲学(plan §3 方案 E 轻量化):
//   - mg 完整输出 melody + chord stab(保留其 motif / cadence / 跨段连贯哲学)
//   - 不改 mg 代码(保留"原样保留"决策,C.6 壳化时再动)
//   - 不逐段调 mg(保留 motifStrategy='functional' 跨段重复语义)
//   - 只在 facade 输出后做**纯后处理调制** — 按每个 note onset 查 weather,
//     调制 velocity / duration,让钢琴跟段落能量起伏
//
// 5 维气象 → 钢琴调制映射:
//   K (Kinetic)  → velocity 乘子   — Verse(K低)钢琴轻,Chorus(K高)钢琴响
//   S (Spatial)  → duration 乘子   — Ambient(S高)钢琴长音,Build(S低)staccato
//   T (Timbral)  → 不用(影响 voicing register,但 mg 已固定 pitch)
//   R (Risk)     → 不用(影响 pitch 选择,mg 已生成)
//   G (Groove)   → 暂不用(C.6 可考虑加 onset 微抖动)
//
// 调制公式(避免极端衰减/放大):
//   velocityScale = K_VELOCITY_FLOOR + (1 - K_VELOCITY_FLOOR) * weather.k
//   durationScale = S_DURATION_FLOOR + (1 - S_DURATION_FLOOR) * weather.s
//
// 默认 K_VELOCITY_FLOOR = 0.5(K=0 时仍保留 50% velocity,不至于"完全静音"),
// 默认 S_DURATION_FLOOR = 0.7(S=0 时仍 70% duration,不至于过分 staccato)。
//
// PRNG:0(纯后处理,无随机决策)
// 输入/输出契约:NoteData[] in / NoteData[] out(同长度,velocity + duration 调制)
// ============================================================

import type { NoteData } from '../ir';
import type { RenderContext } from '../ir/RenderContext';

const K_VELOCITY_FLOOR = 0.5;   // K=0 时 velocity 不衰减到 0,保留 50%
const S_DURATION_FLOOR = 0.7;   // S=0 时 duration 不衰减到 0,保留 70%

/**
 * 给定 mg 钢琴 NoteData[] + RenderContext,返回 weather-modulated NoteData[]。
 *
 * 不修改 input 数组(避免副作用),返回新数组。
 */
export function modulatePianoByWeather(
    notes: NoteData[],
    context: RenderContext,
): NoteData[] {
    const out: NoteData[] = new Array(notes.length);
    for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        const w = context.weather.at(note.onset);

        // velocity:K 主导,floor 防止过弱
        const velScale = K_VELOCITY_FLOOR + (1 - K_VELOCITY_FLOOR) * w.k;
        let newVel = note.velocity * velScale;
        if (newVel < 0) newVel = 0;
        if (newVel > 1) newVel = 1;

        // duration:S 主导,floor 防止过 staccato
        const durScale = S_DURATION_FLOOR + (1 - S_DURATION_FLOOR) * w.s;
        const newDur = note.duration * durScale;

        // 保留 origin / motifName / 等元数据
        out[i] = {
            ...note,
            velocity: newVel,
            duration: newDur,
        };
    }
    return out;
}
