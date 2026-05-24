/**
 * TopologyMutator — 拓扑变换器
 *
 * 移植参考：ImproVisor
 *   - InvertCommand.java       → invert()
 *   - ReverseCommand.java      → reverse()
 *   - ShiftPitchesCommand.java → sideSlip()
 *   - TimeWarpCommand.java     → expand()
 *
 * 职责：对 NoteData 序列执行纯数学拓扑变换（倒影 / 逆行 / 移调 / 时间扩展）。
 * 原子变换不消耗 PRNG；applyTopologyChain 通过传入的 prng 回调按 TopologyConfig 概率链式调度。
 *
 * Pitch Space: RELATIVE in → RELATIVE out
 *   - 只做纯数学运算 + [0, 127] 的硬 clamp
 *   - 禁止读取或叠加 keyOffset（K-5）
 *
 * 设计约束（music_generation_pipeline_rule.md）：
 *   D-1 : 不调用 Math.random()，prng 由调用方注入
 *   D-4 / C-1 : 浮点比较使用 EPSILON
 *   P-1 : 输出使用预分配数组（new Array(n)），无 Map/Set
 *   S-3 : 全同步纯函数
 *   S-4 : 输出为可序列化 NoteData[]
 *   C-3 : 热循环内不使用 map/filter/reduce/spread-array
 *
 * @author AuraFlow Tap!
 */

import { NoteData, TopologyConfig } from '../../types';

export class TopologyMutator {
    private static readonly EPSILON = 1e-6;
    private static readonly PITCH_LO = 0;
    private static readonly PITCH_HI = 127;

    /**
     * 倒影 (Inversion)：以指定音高为对称轴进行镜像翻转。
     *   P_new = 2 * axisPitch - P_old
     * 若 axisPitch 未提供，以 notes[0].pitch 作为对称轴。
     * onset / duration / velocity 原样保留。
     *
     * Pitch Space: RELATIVE → RELATIVE（仅做 [0,127] 硬 clamp）
     */
    public static invert(notes: NoteData[], axisPitch?: number): NoteData[] {
        const n = notes.length;
        const out: NoteData[] = new Array(n);
        if (n === 0) return out;

        const axis = axisPitch !== undefined ? axisPitch : notes[0].pitch;
        const lo = TopologyMutator.PITCH_LO;
        const hi = TopologyMutator.PITCH_HI;

        for (let i = 0; i < n; i++) {
            const src = notes[i];
            let p = 2 * axis - src.pitch;
            if (p < lo) p = lo;
            else if (p > hi) p = hi;

            out[i] = {
                pitch: p,
                onset: src.onset,
                duration: src.duration,
                velocity: src.velocity,
                isGraceNote: src.isGraceNote,
                pitchBend: src.pitchBend,
                pitchBendDuration: src.pitchBendDuration,
                fadeOutDuration: src.fadeOutDuration,
                isUserMotif: src.isUserMotif,
                motifName: src.motifName,
            };
        }
        return out;
    }

    /**
     * 逆行 (Retrograde)：时间轴对称翻转。
     *   1. 音高序列倒序：p'[i] = p[n-1-i]
     *   2. 时值序列倒序：d'[i] = d[n-1-i]
     *   3. onset 从原数组起始 onset（notes[0].onset）累加重排，
     *      保证翻转后的第一个音符 onset 等于原数组的起始 onset。
     *
     * Pitch Space: RELATIVE → RELATIVE
     */
    public static reverse(notes: NoteData[]): NoteData[] {
        const n = notes.length;
        const out: NoteData[] = new Array(n);
        if (n === 0) return out;

        let cursor = notes[0].onset;

        for (let i = 0; i < n; i++) {
            const src = notes[n - 1 - i];
            out[i] = {
                pitch: src.pitch,
                onset: cursor,
                duration: src.duration,
                velocity: src.velocity,
                isGraceNote: src.isGraceNote,
                pitchBend: src.pitchBend,
                pitchBendDuration: src.pitchBendDuration,
                fadeOutDuration: src.fadeOutDuration,
                isUserMotif: src.isUserMotif,
                motifName: src.motifName,
            };
            cursor += src.duration;
        }
        return out;
    }

    /**
     * 侧滑 / 移调 (Side-Slip)：所有音高加一个半音标量。
     *   P_new = P_old + semitones
     * onset / duration / velocity 原样保留。
     *
     * Pitch Space: RELATIVE → RELATIVE（仅做 [0,127] 硬 clamp）
     */
    public static sideSlip(notes: NoteData[], semitones: number): NoteData[] {
        const n = notes.length;
        const out: NoteData[] = new Array(n);
        if (n === 0) return out;

        const lo = TopologyMutator.PITCH_LO;
        const hi = TopologyMutator.PITCH_HI;

        for (let i = 0; i < n; i++) {
            const src = notes[i];
            let p = src.pitch + semitones;
            if (p < lo) p = lo;
            else if (p > hi) p = hi;

            out[i] = {
                pitch: p,
                onset: src.onset,
                duration: src.duration,
                velocity: src.velocity,
                isGraceNote: src.isGraceNote,
                pitchBend: src.pitchBend,
                pitchBendDuration: src.pitchBendDuration,
                fadeOutDuration: src.fadeOutDuration,
                isUserMotif: src.isUserMotif,
                motifName: src.motifName,
            };
        }
        return out;
    }

    /**
     * 时间扩展 (Expand)：对 onset 与 duration 做倍数缩放。
     *   onset_new    = onset_old    * factor
     *   duration_new = duration_old * factor
     * pitch / velocity 原样保留。factor < EPSILON 视为 0（退化为同点零长音符簇）。
     */
    public static expand(notes: NoteData[], factor: number): NoteData[] {
        const n = notes.length;
        const out: NoteData[] = new Array(n);
        if (n === 0) return out;

        const f = Math.abs(factor) < TopologyMutator.EPSILON ? 0 : factor;

        for (let i = 0; i < n; i++) {
            const src = notes[i];
            out[i] = {
                pitch: src.pitch,
                onset: src.onset * f,
                duration: src.duration * f,
                velocity: src.velocity,
                isGraceNote: src.isGraceNote,
                pitchBend: src.pitchBend,
                pitchBendDuration: src.pitchBendDuration,
                fadeOutDuration: src.fadeOutDuration,
                isUserMotif: src.isUserMotif,
                motifName: src.motifName,
            };
        }
        return out;
    }

    /**
     * 抢拍 / 拖拍 (BarLineShift)：所有音符的 onset 沿时间轴整体偏移。
     *   onset_new = max(0, onset_old + offsetBeats)
     * pitch / duration / velocity 原样保留。负 offset = 抢拍，正 offset = 拖拍。
     *
     * 时间空间：onset 相对段落起拍（不含全局 startBeat）；caller 负责钳到段落边界。
     */
    public static shiftTime(notes: NoteData[], offsetBeats: number): NoteData[] {
        const n = notes.length;
        const out: NoteData[] = new Array(n);
        if (n === 0) return out;
        for (let i = 0; i < n; i++) {
            const src = notes[i];
            out[i] = { ...src, onset: Math.max(0, src.onset + offsetBeats) };
        }
        return out;
    }

    /**
     * 核心算法折叠链：根据 TopologyConfig 的概率，对输入的 notes 进行链式拓扑形变。
     */
    public static applyTopologyChain(
        notes: NoteData[],
        config: TopologyConfig,
        prngNext: () => number,
        prngNextInt: (min: number, max: number) => number
    ): NoteData[] {
        if (notes.length === 0) return notes;
        let currentNotes = notes;

        // 1. Invert
        if (config.probInvert > 0 && prngNext() < config.probInvert) {
            currentNotes = this.invert(currentNotes, currentNotes[0].pitch);
        }

        // 2. Reverse
        if (config.probReverse > 0 && prngNext() < config.probReverse) {
            currentNotes = this.reverse(currentNotes);
        }

        // 3. Expand (默认扩展 2 倍)
        if (config.probExpand > 0 && prngNext() < config.probExpand) {
            currentNotes = this.expand(currentNotes, 2.0);
        }

        // 4. Side-Slip
        if (config.probSideSlip > 0 && prngNext() < config.probSideSlip) {
            // 在 [-sideSlipRange, sideSlipRange] 之间抽取一个非 0 偏移
            let slip = 0;
            while (slip === 0) {
                slip = prngNextInt(-config.sideSlipRange, config.sideSlipRange);
            }
            currentNotes = this.sideSlip(currentNotes, slip);
        }

        // 5. Time-Shift (BarLineShift)
        if (config.probTimeShift !== undefined && config.probTimeShift > 0 && prngNext() < config.probTimeShift) {
            const offset = config.timeShiftBeats !== undefined ? config.timeShiftBeats : 0.25;
            const direction = prngNext() < 0.5 ? -1 : 1;
            currentNotes = this.shiftTime(currentNotes, offset * direction);
        }

        return currentNotes;
    }
}
