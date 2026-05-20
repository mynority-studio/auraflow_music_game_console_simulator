/**
 * Cross-Part Reconciler — 跨乐器后置校验。
 *
 * v1 = WEAK VERSION(Phase 1-3 实装)
 *   只做: 检测 + velocity damp + 重复音剔除
 *
 * v2 = STRONG VERSION(Phase 4 实装,本文件已升级)
 *   现做: 消费 unresolvedIssues 做"声部重排"(local repair):
 *     - LIL violation → 上声部 note pitch+=12 octave 解开 m9/m2 dyad
 *   未做(留 v3+): 调度 Realizer 用新约束完整重生成
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
import { NoteOrigin } from '../ir';

/** 浮点 onset 比较 epsilon — 同 D-4 约束 */
const EPSILON = 1e-6;
/** 同 (pitch, onset) 重复音的 velocity 衰减系数(40% 衰减,保留 60%) */
const REPEAT_DAMP_FACTOR = 0.6;
/** Low Interval Limit 触发阈值 — bass pitch 低于此值才检测 m9/m2 dyads */
const LIL_BASS_PITCH_THRESHOLD = 48;  // C3,低于此为典型低音区
/** Low Interval Limit "同时" 判定窗口 — onset 在此窗口内视为并发 */
const LIL_ONSET_WINDOW = 0.125;       // 1/8 拍
/** Phase 8b — deliberate doubling 阈值:钢琴 LH(< 48 = C3)与 bass 同 pitch + onset 视为故意八度加厚,不 damp */
const LOW_REGISTER_DOUBLING_THRESHOLD = 48;  // C3

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
        /** Phase 4 v2 — LIL 修复:上声部 note pitch+=12 octave 解开 m9/m2 dyad 的次数 */
        liftedNotes: number;
    };
    /** Phase 8b — 检测到但**故意不 damp** 的 doubling(钢琴 LH + bass 低音区八度加厚),
     *  仅作为诊断 metric。这种 doubling 是音乐家明确意图,Reconciler 不应误伤。 */
    deliberateDoublings: number;
    /** 检测到但未修复的问题,详见 UnresolvedIssue.kind。
     *  Phase 4 v2 起 LIL 主动修复后从本数组移除;其他 kind(cross_track / voice_crossing 等)仍留作 v3 接力。 */
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
        let deliberateDoublings = 0;

        // ─────────────────────────────────────────────
        // Pass 1: 同 (pitch, onset) 重复音 → velocity damp
        //   Phase 8b 白名单:钢琴 LH(pitch < C3=48)与 bass 同根音 → deliberate
        //   八度加厚,**不 damp**(钢琴 LH bass 同根音是经典编曲手法,误伤就听感糊)
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
                    // Phase 8b — deliberate doubling 白名单
                    const isLowRegisterBassPianoDoubling =
                        dampedBy === 'bass' &&
                        lower.name === 'accompaniment' &&
                        note.pitch < LOW_REGISTER_DOUBLING_THRESHOLD;

                    if (isLowRegisterBassPianoDoubling) {
                        deliberateDoublings++;
                        continue;  // 不 damp,跳过本 note
                    }

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

        // ─────────────────────────────────────────────
        // Pass 3 (Phase 4 v2): 主动解决 LIL 违规
        //   上声部 note pitch+=12(octave lift)→ m9/m2 dyad 散开,声学上不再撞
        //   若上提后越界(> 96 = C7)→ 留作 unresolved(放回数组)
        //   注意:LIL onset window 内可能多个 upper note,只移目标 note(pitch matching)
        // ─────────────────────────────────────────────
        const stillUnresolved: UnresolvedIssue[] = [];
        let liftedNotes = 0;
        for (let i = 0; i < unresolvedIssues.length; i++) {
            const issue = unresolvedIssues[i];
            if (issue.kind !== 'low_interval_limit_violation') {
                stillUnresolved.push(issue);
                continue;
            }
            // 从 note 字符串解析 upper pitch 与 track(已写为 'bass=X, name=Y, ...' 格式)
            // 直接遍历 atmosphere + accompaniment 找匹配 (track, pitch, onset) 的 note,
            // pitch+=12 解开。
            const involvedUpper = issue.involvedTracks.find(t => t !== 'bass');
            if (involvedUpper === undefined) {
                stillUnresolved.push(issue);
                continue;
            }
            const targetTrack = involvedUpper === 'accompaniment'
                ? input.accompaniment
                : involvedUpper === 'atmosphere' ? input.atmosphere : null;
            if (targetTrack === null) {
                stillUnresolved.push(issue);
                continue;
            }
            // 找 onset 在 issue 窗口内的 upper notes,逐个尝试上提
            let resolved = false;
            for (let n = 0; n < targetTrack.length; n++) {
                const note = targetTrack[n];
                if (Math.abs(note.onset - issue.startBeat) > LIL_ONSET_WINDOW) continue;
                // Batch 7 — Sacred boundary 守卫:motif 来源的音不允许 LIL lift。
                // 原因:LIL lift 跨八度改 pitch,会破坏 motif 投影的 interval-pattern 完整性。
                // 这种 violation 留作 unresolved,后续由 mixing / lead 选择降低 damping ratio 弥补。
                if (note.origin === NoteOrigin.Motif) continue;
                // 检测 note 与 bass 是否仍构成 m9/m2 — 解析需要 bass pitch
                // 简化:任何 upper track note 在窗口内 + 与该段任一 bass note 间距 1/13 半音,即提
                let isViolating = false;
                for (let b = 0; b < input.bass.length; b++) {
                    if (Math.abs(input.bass[b].onset - note.onset) > LIL_ONSET_WINDOW) continue;
                    const interval = Math.abs(note.pitch - input.bass[b].pitch);
                    if (interval === 1 || interval === 13) {
                        isViolating = true; break;
                    }
                }
                if (!isViolating) continue;
                const lifted = note.pitch + 12;
                if (lifted > 96) continue;  // 越界放弃,issue 留作 unresolved
                note.pitch = lifted;
                liftedNotes++;
                resolved = true;
            }
            if (!resolved) stillUnresolved.push(issue);
        }

        return {
            collisions,
            appliedFixes: {
                velocityDamps: collisions.length,
                notesRemoved: 0,
                liftedNotes,
            },
            deliberateDoublings,
            unresolvedIssues: stillUnresolved,
        };
    }
}
