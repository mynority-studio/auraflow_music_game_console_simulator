/**
 * Cross-Part Reconciler — 跨乐器后置校验。
 *
 * v1 = WEAK VERSION(当前实现目标)
 *   只做: 检测 + velocity damp + 重复音剔除
 *   不做: 反向要求 Realizer 重生成
 *
 * v2 = STRONG VERSION(未来升级,触发条件见下)
 *   会做: 消费 unresolvedIssues + BandPlan,调度某个 Realizer 用新约束重生成
 *
 * ─────────────────────────────────────────────────────────────────────
 * UPGRADE TRIGGER(什么时候必须做 v2):
 *
 *   触发条件 A: 编制里和声乐器从 2 个增到 3 个及以上
 *     原因: 用例 1(和声化学反应)、用例 2(声部交叉)、用例 4(终止式集合缺失)
 *           会从"偶发"变成"频发",weak 版本兜不住。
 *
 *   触发条件 B: 听感测试反复出现"糊"/"乱"/"撞"的人工标注 ≥3 次
 *     原因: 大概率是用例 3(Low Interval Limit)或用例 5(solo+comping 留白)。
 *
 *   触发条件 C: 加入第二个 lead 乐器(如萨克斯 + 小号同时主奏段落)
 *     原因: 声部交叉成为必然问题,必须主动重写而非被动 damp。
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHY WEAK FIRST(不要预先实现 v2):
 *
 *   - 当前编制(钢琴/贝斯/鼓/Pad)只有 1 个和声乐器,用例 1/2/4 极少触发
 *   - 用例 3 的低音糊音可以靠 damp + 剔除 piano LH 应付
 *   - 用例 5 的留白可以靠 Casting 阶段的 intensity 字段预防,不必靠 Reconciler
 *   - v2 需要"调度 Realizer 重跑",会引入控制反转和 PRNG 重放问题,提前做会过度工程
 *
 * ─────────────────────────────────────────────────────────────────────
 * UPGRADE PATH(v1 → v2 时怎么改,只读这段就够):
 *
 *   1. ReconcilerReport schema 保持不动,只新增 v2-only 字段(如 regenerationRequests)
 *   2. v1 写满 `unresolvedIssues` 是给 v2 用的——v2 直接读这个数组分发
 *   3. Realizer 接口的 `realize()` 已经是纯函数(取 PRNG 子流),v2 重调它就行
 *   4. v2 的入口在 Conductor 里加一层 while 循环(max 2 轮),把 Realizer 重跑后的
 *      Track 重新喂回 Reconciler,直到 unresolvedIssues 为空或达上限
 *   5. 不要改 InstrumentRealizer / Casting / Harmony 任何接口——v2 是纯增量
 *
 *   反过来说: 如果你发现要改 Realizer 接口才能做 v2,说明 v2 的设计错了,
 *   重新看本注释——v1 的 unresolvedIssues 字段就是为 v2 准备的契约。
 */

import type { NoteData } from '../ir';

/** 浮点 onset 比较 epsilon — 同 D-4 约束 */
const EPSILON = 1e-6;
/** 同 (pitch, onset) 重复音的 velocity 衰减系数(40% 衰减,保留 60%) */
const REPEAT_DAMP_FACTOR = 0.6;
/** Low Interval Limit 触发阈值 — bass pitch 低于此值才检测 m9/m2 dyads */
const LIL_BASS_PITCH_THRESHOLD = 48;  // C3,低于此为典型低音区
/** Low Interval Limit "同时" 判定窗口 — onset 在此窗口内视为并发 */
const LIL_ONSET_WINDOW = 0.125;       // 1/8 拍

/** 参与 Reconciler 的轨道名(drums 不参与:GM Drum Map 第三空间,不与旋律轨撞 pitch) */
export type ReconcilerTrackName = 'melody' | 'bass' | 'accompaniment' | 'atmosphere';

export interface ReconcilerInput {
    melody: NoteData[];
    accompaniment: NoteData[];
    bass: NoteData[];
    atmosphere: NoteData[];
}

/** v1 应用的修复事件:同 (pitch, onset) 重复音,低优先级轨 velocity damp */
export interface CollisionEvent {
    pitch: number;
    onset: number;
    /** 优先级更高、保留原 velocity 的轨道 */
    keptTrack: ReconcilerTrackName;
    /** 优先级更低、velocity 被 damp 的轨道 */
    dampedTrack: ReconcilerTrackName;
    originalVelocity: number;
    appliedVelocity: number;
}

/**
 * v1 兜不住、但 v2 应该消费的问题。
 *
 * 即使 v1 没有任何使用者,也必须写满本字段——这是 v2 与 v1 的契约,
 * 没有 unresolvedIssues v2 就无米下锅。
 *
 * kind 字段定义见文件头 UPGRADE TRIGGER 与设计文档:
 *   - low_interval_limit_violation: bass 与 accomp/atmosphere 在低音区形成 m9/m2 dyad,
 *     无法靠 velocity damp 解决,需重新 voice
 *   - cross_track_minor_ninth: 跨轨 m9 撞音(非低音区),理论上 voicing 可以避免
 *   - voice_crossing: 两条旋律线穿越 — 需重写其中一条线的走向
 *   - cadence_chord_incomplete: V-I 终止处合奏成的 I 和弦缺关键音 / 重复导音
 *   - solo_comping_overlap: 主奏 lick 与 comping 在同小节重叠,comping 没让出空间
 */
export interface UnresolvedIssue {
    kind:
        | 'low_interval_limit_violation'
        | 'cross_track_minor_ninth'
        | 'voice_crossing'
        | 'cadence_chord_incomplete'
        | 'solo_comping_overlap';
    startBeat: number;
    endBeat: number;
    involvedTracks: ReconcilerTrackName[];
    /** 诊断字符串(给开发者读,不参与下游决策) */
    note: string;
}

export interface ReconcilerReport {
    collisions: CollisionEvent[];
    appliedFixes: {
        velocityDamps: number;
        notesRemoved: number;  // v1 不剔除,恒为 0;留给将来扩展
    };
    /** v1 检测到但未修复的问题,详见 UnresolvedIssue.kind */
    unresolvedIssues: UnresolvedIssue[];
}

export class Reconciler {
    /**
     * 执行 v1 弱版本的协调:
     *   1. 同 (pitch, onset) 重复音 → 低优先级轨 velocity ×REPEAT_DAMP_FACTOR
     *   2. bass × {accomp, atmosphere} 在低音区(< C3)形成 m9/m2 → 仅报告,不修
     *
     * **就地修改** input 数组的 NoteData.velocity 字段(其余字段不动)。
     * 返回 ReconcilerReport 供调用方观察。
     *
     * 优先级(高 → 低): melody > bass > accompaniment > atmosphere
     */
    public static reconcile(input: ReconcilerInput): ReconcilerReport {
        // 优先级从高到低,collision 时低优先级被 damp
        const tracks: { name: ReconcilerTrackName; notes: NoteData[] }[] = [
            { name: 'melody',        notes: input.melody },
            { name: 'bass',          notes: input.bass },
            { name: 'accompaniment', notes: input.accompaniment },
            { name: 'atmosphere',    notes: input.atmosphere },
        ];

        const collisions: CollisionEvent[] = [];
        const unresolvedIssues: UnresolvedIssue[] = [];

        // ─────────────────────────────────────────────
        // Pass 1: 同 (pitch, onset) 重复音 → velocity damp
        // ─────────────────────────────────────────────
        for (let i = 1; i < tracks.length; i++) {
            const lower = tracks[i];
            for (let n = 0; n < lower.notes.length; n++) {
                const note = lower.notes[n];
                let dampedBy: ReconcilerTrackName | null = null;
                for (let j = 0; j < i; j++) {
                    const higher = tracks[j];
                    for (let m = 0; m < higher.notes.length; m++) {
                        const other = higher.notes[m];
                        if (note.pitch === other.pitch &&
                            Math.abs(note.onset - other.onset) < EPSILON) {
                            dampedBy = higher.name;
                            break;
                        }
                    }
                    if (dampedBy !== null) break;
                }
                if (dampedBy !== null) {
                    const origVel = note.velocity;
                    note.velocity = note.velocity * REPEAT_DAMP_FACTOR;
                    collisions.push({
                        pitch: note.pitch,
                        onset: note.onset,
                        keptTrack: dampedBy,
                        dampedTrack: lower.name,
                        originalVelocity: origVel,
                        appliedVelocity: note.velocity,
                    });
                }
            }
        }

        // ─────────────────────────────────────────────
        // Pass 2: Low Interval Limit — bass × {accomp, atmosphere} 低音区 m9/m2
        //         (报告 only,不修;Phase 5 v2 触发条件 B 命中后再做)
        // ─────────────────────────────────────────────
        for (let n = 0; n < input.bass.length; n++) {
            const bassNote = input.bass[n];
            if (bassNote.pitch >= LIL_BASS_PITCH_THRESHOLD) continue;
            const upperTracks: { name: ReconcilerTrackName; notes: NoteData[] }[] = [
                { name: 'accompaniment', notes: input.accompaniment },
                { name: 'atmosphere',    notes: input.atmosphere },
            ];
            for (let t = 0; t < upperTracks.length; t++) {
                const upper = upperTracks[t];
                for (let m = 0; m < upper.notes.length; m++) {
                    const up = upper.notes[m];
                    if (Math.abs(up.onset - bassNote.onset) > LIL_ONSET_WINDOW) continue;
                    const interval = Math.abs(up.pitch - bassNote.pitch);
                    if (interval === 1 || interval === 13) {
                        unresolvedIssues.push({
                            kind: 'low_interval_limit_violation',
                            startBeat: bassNote.onset,
                            endBeat: bassNote.onset + bassNote.duration,
                            involvedTracks: ['bass', upper.name],
                            note: `bass=${bassNote.pitch}, ${upper.name}=${up.pitch}, interval=${interval} (m${interval === 1 ? '2' : '9'})`,
                        });
                    }
                }
            }
        }

        return {
            collisions,
            appliedFixes: {
                velocityDamps: collisions.length,
                notesRemoved: 0,
            },
            unresolvedIssues,
        };
    }
}
