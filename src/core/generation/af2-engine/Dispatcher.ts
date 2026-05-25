// ============================================================
// Dispatcher — 大脑分谱模块(用户 8 层架构 #5)
// ============================================================
//
// 职责:把 Score + SectionAssignment + Band 串成显式"按顺序分谱"流程:
//   1. Conductor 已决定 per-section role 分配
//   2. Dispatcher 按指定顺序调用 musicians.plan(),累积 peers
//   3. 后面的 musicians 可以看前面 musicians 已 emit 的 notes(cross-track 协调地基)
//
// 与 Conductor 区分:
//   Conductor:** "谁演什么"** 决策(SectionAssignment 输出)
//   Dispatcher:** "按顺序通知乐手"** 执行(peers 累积)
//
// 用户 ideal 流程映射:
//   - 大脑发谱 → Dispatcher.dispatchMusicians(score, assignments, steps)
//   - 乐手编自己 → step.plan(input) 返回 NoteData[]
//   - 后面的乐手能看前面乐手的演奏 → peers 累积传递
//
// 调用顺序推荐(rhythm-first → harmonic → melodic → ambient):
//   bass → accomp → drums → melody → pad
// caller 可任意指定。
// ============================================================

import type { Score } from './Score';
import type { MusicianPlanInput, SectionAssignment } from './Conductor';
import type { NoteData } from '../types';

/**
 * MusicianStep — Dispatcher 调度的单个 musician 步骤。
 *
 * `musicianId` 用于在 peers 中标识本 musician 的输出。
 * `plan` 接 MusicianPlanInput 返 NoteData[](该 musician 的演奏)。
 *
 * 与 MusicianPlanInput 解耦:Dispatcher 不关心 musician 用什么 idiom(PianoIdiom /
 * DrumGenerator / etc),只关心"按顺序调,把 notes 累积进 peers"。
 *
 * MusicianStep.plan 是 closure(由 caller 构造),内部可桥接到具体 idiom 实现
 * 并捕获该 musician 特有的参数(如 musician 卡 / 原料 notes / drum 的 rng)。
 */
export interface MusicianStep {
    readonly musicianId: string;
    plan(input: MusicianPlanInput): NoteData[];
}

/**
 * Dispatcher 主入口:按 steps 顺序调用 musicians,累积 peers。
 *
 * 输出 Map<musicianId, NoteData[]>:所有 musicians 的最终 notes,caller 自取
 * (例如 Af2EngineFacade 把 result.get(bassMusicianId) 装入 track.bass)。
 *
 * **顺序语义**:
 *   - 第 N 个 step 的 plan() 看到的 peers = 前 N-1 个 steps 的输出
 *   - peers Map 是只读引用(plan() 不应 mutate)
 *
 * peers 的 cross-track 协调用例(未来):
 *   - drums.plan 看 bass.notes → kick 对齐 bass onset
 *   - melody.plan 看 accomp.notes → 避撞顶音
 *   - pad.plan 看其他乐手 → 填空 / 静默
 */
export function dispatchMusicians(
    score: Score,
    assignments: ReadonlyArray<SectionAssignment>,
    steps: ReadonlyArray<MusicianStep>,
): Map<string, NoteData[]> {
    const peers = new Map<string, ReadonlyArray<NoteData>>();
    const out = new Map<string, NoteData[]>();
    for (const step of steps) {
        const input: MusicianPlanInput = {
            score,
            assignments,
            musicianId: step.musicianId,
            peers,
        };
        const notes = step.plan(input);
        out.set(step.musicianId, notes);
        peers.set(step.musicianId, notes);
    }
    return out;
}
