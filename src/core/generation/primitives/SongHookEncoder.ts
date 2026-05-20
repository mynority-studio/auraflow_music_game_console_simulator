/**
 * SongHookEncoder — 歌曲级副歌主题动机的编解码与投影器（Phase 7.1）
 *
 * 目标：把"商业 pop 歌副歌每次都唱同一句旋律"的语义注入引擎。
 *
 * 工作模式（在 Stage5Layering.layerInstruments 内）：
 *   - 第一次遇到 SectionType.Chorus → 渲染完成（含 splice 替换），扫该段 lead notes，
 *     提取带 motifName 的覆盖区间作为 hook 边界，整拍对齐 + clamp 到 [4, sectionDur×0.6]，
 *     encode 为 degree-encoded 骨架（不存绝对 pitch）。
 *   - 后续 Chorus → 同样跑完完整 PCFG/Topline（保 D-5 PRNG 对齐），然后用骨架按当前
 *     Chorus 的和弦序列 project 为新 NoteData[]，覆盖前 hook.totalBeats 的 lead 输出。
 *
 * 为什么不存绝对 pitch：用户 Q1=否 — 不同 Chorus 的和弦进行**不一定相同**（最后一段
 * 可能转调或加 IV-V push）。固定 pitch 序列会在新和弦上撞音；degree-encoded 骨架在
 * 新和弦上"重投影"得到对应度数的新 pitch — 这是商业歌的标准做法（harmonic re-skinning）。
 *
 * 编码策略：
 *   - chord 内拟合（pitch 的 PC ∈ chord 的 PC mask）→ 反查 degree（1/3/5/7/9/11/13）
 *   - 否则 → 存 pcAbsolute（colorTone / approach / chromatic neighbor）
 *   - octaveBias = round((pitch - anchorPitch) / 12)
 *
 * 投影策略（Q3=a）：
 *   - degree !== 0：用 ToplineEngine.degreeToInterval 算新和弦下的 PC，findNearestPitchByPc
 *   - degree === 0：检查 pcAbsolute 是否在新和弦的 localScaleMask 内
 *       - 在 → 用 pcAbsolute 投影
 *       - 不在 → 兜底到新和弦的 root（degree=1）— 保旋律完整，牺牲一点色彩
 *
 * 约束遵从（pipeline rule §4）：
 *   D-1 / D-5: 零 PRNG 消耗（纯查表 + 算术），不影响黄金种子
 *   D-3: 输出由 Stage5Layering 末尾的 sortNotesInPlace 统一排序
 *   K-1 / K-2 / K-5 / K-7: 全程 RELATIVE pitch space，从不读 GlobalContext
 *   T-3: 无 any
 *   T-5: motifName !== undefined 显式判定
 *   P-1: 数组线性扫描，无 Map/Set
 *   S-7: encode 输入 < 1 note 时静默返回空骨架；computeHookSpan 无 motif 返回 null
 *   C-portable: 纯函数 + 扁平数组 + 无递归 — 移植到 C 时为 struct array + 三个 for
 */

import { NoteData, GeneratedChord, CHORD_INTERVALS } from '../types';
import { ToplineEngine } from '../pipeline/ToplineEngine';

const EPSILON = 1e-6;
const PC_SIZE = 12;
const DEFAULT_MIN_BEATS = 4;
const DEFAULT_MAX_RATIO = 0.6;

/** 度级骨架单音 — 不存绝对 pitch，按和弦语义编码 */
export interface HookNote {
    /** 相对 hook 起拍的 onset（beats） */
    onset: number;
    duration: number;
    velocity: number;
    /**
     * 主编码：和弦度数（1/3/5/7/9/11/13），0 表示未拟合（投影时走 pcAbsolute 分支）。
     * "未拟合"意味着原 PC 不在原和弦的 PC mask 内 — 通常是 colorTone / approach / chromatic。
     */
    degree: number;
    /** 备用编码：原 PC（0..11），degree=0 时使用 */
    pcAbsolute: number;
    /** 相对 anchorPitch 的八度偏移（典型 -2..+2） */
    octaveBias: number;
}

export interface SongHookSkeleton {
    notes: HookNote[];
    /** Hook 时长（beats）— 投影时决定覆盖窗口 */
    totalBeats: number;
}

export class SongHookEncoderError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'SongHookEncoderError';
        this.context = context;
    }
}

export class SongHookEncoder {
    /**
     * 扫 section 内带 motifName 的 lead notes 覆盖区间，clamp + 整拍对齐 → hook 边界。
     *
     * 算法（零 PRNG）：
     *   1. 扫 notes，记录 motifName !== undefined 的 [firstOnset, lastEnd] 区间
     *   2. 无 motif → 返回 null（caller 走兜底策略：例如下次 Chorus 再试）
     *   3. startBeat = floor(firstOnset)，endBeat = ceil(lastEnd) — 整拍对齐（Q4=整拍）
     *   4. Clamp 长度：
     *      - 短于 minBeats → 强行扩展到 minBeats
     *      - 长于 sectionDur × maxRatio → 截短到 ratio 上限
     *   5. endBeat 不越过 sectionEnd；最终长度 < minBeats → 返回 null（段太短）
     */
    public static computeHookSpan(
        sectionLeadNotes: NoteData[],
        sectionStart: number,
        sectionEnd: number,
        minBeats: number = DEFAULT_MIN_BEATS,
        maxRatio: number = DEFAULT_MAX_RATIO,
    ): { startBeat: number; endBeat: number } | null {
        const sectionDur = sectionEnd - sectionStart;
        if (sectionDur < minBeats - EPSILON) return null;

        let firstOnset = Number.POSITIVE_INFINITY;
        let lastEnd = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < sectionLeadNotes.length; i++) {
            const n = sectionLeadNotes[i];
            if (n.motifName === undefined) continue;
            if (n.onset < firstOnset) firstOnset = n.onset;
            const end = n.onset + n.duration;
            if (end > lastEnd) lastEnd = end;
        }
        if (firstOnset === Number.POSITIVE_INFINITY) return null;

        // Q4=整拍对齐
        let startBeat = Math.floor(firstOnset + EPSILON);
        let endBeat = Math.ceil(lastEnd - EPSILON);
        if (startBeat < sectionStart) startBeat = Math.floor(sectionStart + EPSILON);

        // Clamp 长度
        const maxLen = sectionDur * maxRatio;
        let len = endBeat - startBeat;
        if (len < minBeats) {
            endBeat = startBeat + minBeats;
            len = minBeats;
        }
        if (len > maxLen) {
            endBeat = startBeat + Math.floor(maxLen + EPSILON);
            len = endBeat - startBeat;
        }
        if (endBeat > sectionEnd) endBeat = Math.floor(sectionEnd + EPSILON);
        if (endBeat - startBeat < minBeats - EPSILON) return null;

        return { startBeat, endBeat };
    }

    /**
     * 把 [hookStart, hookEnd) 区间内的 NoteData 编码为度级骨架。
     *
     * 每个 note：
     *   - 找 onset 所在的和弦
     *   - degree = fitDegree(pitch, chord) — 0 表示未拟合
     *   - pcAbsolute = pitch mod 12
     *   - octaveBias = round((pitch - anchorPitch) / 12)
     *   - onset 平移到 [0, totalBeats) 相对空间
     *
     * 无 chord 覆盖的 note（理论不会发生，因为 lead 渲染只在有和弦的段内）→
     * degree=0，pcAbsolute 仍存。
     */
    public static encode(
        sectionLeadNotes: NoteData[],
        chords: GeneratedChord[],
        hookStart: number,
        hookEnd: number,
        anchorPitch: number,
    ): SongHookSkeleton {
        if (hookEnd - hookStart < EPSILON) {
            return { notes: [], totalBeats: 0 };
        }
        const out: HookNote[] = [];
        for (let i = 0; i < sectionLeadNotes.length; i++) {
            const n = sectionLeadNotes[i];
            if (n.onset < hookStart - EPSILON) continue;
            if (n.onset >= hookEnd - EPSILON) continue;

            const chord = findChordAt(chords, n.onset);
            const pcAbsolute = ((n.pitch % PC_SIZE) + PC_SIZE) % PC_SIZE;
            const octaveBias = Math.round((n.pitch - anchorPitch) / PC_SIZE);
            const degree = chord !== null ? fitDegree(pcAbsolute, chord) : 0;

            out.push({
                onset: n.onset - hookStart,
                duration: n.duration,
                velocity: n.velocity,
                degree,
                pcAbsolute,
                octaveBias,
            });
        }
        return { notes: out, totalBeats: hookEnd - hookStart };
    }

    /**
     * 把骨架按新 Chorus 的和弦序列投影为 NoteData[]，onset 全局偏移到 targetStart。
     *
     * 三分支决策（每个骨架音）：
     *   Branch A — degree !== 0：
     *     targetPc = (chord.root + degreeToInterval(degree, chord.quality)) mod 12
     *     pitch = findNearestPitchByPc(targetPc, cursor, lo, hi)
     *   Branch B — degree === 0 且 pcAbsolute ∈ chord.localScaleMask：
     *     pitch = findNearestPitchByPc(pcAbsolute, cursor, lo, hi)
     *   Branch C — Q3=a 兜底（pcAbsolute 不在新和弦的 localScaleMask）：
     *     pitch = findNearestPitchByPc(chord.root mod 12, cursor, lo, hi) — 落到 root
     *
     * cursor = anchorPitch + octaveBias × 12 — 让投影保持原八度寄存器。
     *
     * 无 chord 覆盖（onset 越过段尾）→ 直接用 pcAbsolute 投影，找不到则跳过。
     */
    public static project(
        skeleton: SongHookSkeleton,
        chords: GeneratedChord[],
        targetStart: number,
        anchorPitch: number,
        pitchLo: number,
        pitchHi: number,
    ): NoteData[] {
        const out: NoteData[] = [];
        for (let i = 0; i < skeleton.notes.length; i++) {
            const h = skeleton.notes[i];
            const absoluteOnset = targetStart + h.onset;
            const chord = findChordAt(chords, absoluteOnset);
            const cursor = anchorPitch + h.octaveBias * PC_SIZE;

            let pitch = -1;

            if (chord !== null && h.degree !== 0) {
                // Branch A
                const interval = ToplineEngine.degreeToInterval(h.degree, chord.quality);
                const targetPc = (((chord.root + interval) % PC_SIZE) + PC_SIZE) % PC_SIZE;
                pitch = ToplineEngine.findNearestPitchByPc(targetPc, cursor, pitchLo, pitchHi);
            }

            if (pitch < 0 && chord !== null) {
                const localMask = ToplineEngine.buildLocalScaleMask(chord);
                if ((localMask & (1 << h.pcAbsolute)) !== 0) {
                    // Branch B
                    pitch = ToplineEngine.findNearestPitchByPc(h.pcAbsolute, cursor, pitchLo, pitchHi);
                } else {
                    // Branch C：Q3=a 兜底，落到新和弦 root
                    const rootPc = ((chord.root % PC_SIZE) + PC_SIZE) % PC_SIZE;
                    pitch = ToplineEngine.findNearestPitchByPc(rootPc, cursor, pitchLo, pitchHi);
                }
            }

            if (pitch < 0) {
                // 无和弦覆盖（边界）— 直接按原 PC 投，仍失败就跳过这个音
                pitch = ToplineEngine.findNearestPitchByPc(h.pcAbsolute, cursor, pitchLo, pitchHi);
            }
            if (pitch < 0) continue;

            out.push({
                pitch,
                onset: absoluteOnset,
                duration: h.duration,
                velocity: h.velocity,
                motifName: 'SongHook',
            });
        }
        return out;
    }
}

// ============================================================
// helpers — 文件局部，纯函数
// ============================================================

function findChordAt(chords: GeneratedChord[], beat: number): GeneratedChord | null {
    for (let i = 0; i < chords.length; i++) {
        const c = chords[i];
        if (beat >= c.startBeat - EPSILON && beat < c.endBeat - EPSILON) return c;
    }
    if (chords.length > 0) {
        const last = chords[chords.length - 1];
        if (Math.abs(beat - last.endBeat) < EPSILON) return last;
    }
    return null;
}

/**
 * 拟合 pitch PC 到当前和弦的 degree。
 *
 * 算法：扫 CHORD_INTERVALS[chord.quality]，找出 PC 严格等于 pcInput 的 interval，
 * 然后按 interval 的"原始值"（未模 12）反查 degree：
 *   - 0           → 1
 *   - 2 / 14      → 9
 *   - 17          → 11
 *   - 21          → 13
 *   - mod∈[3..5]  → 3
 *   - mod∈[6..8]  → 5
 *   - mod∈[9..11] → 7
 *
 * 找不到匹配（pc ∉ chord PC mask）→ 返回 0，由 caller 走 pcAbsolute 路径。
 *
 * 注意：本函数严格判定 chord-tone — colorTone / chromatic neighbor / approach 都走 0 分支。
 */
function fitDegree(pcInput: number, chord: GeneratedChord): number {
    const intervals = CHORD_INTERVALS[chord.quality];
    if (intervals === undefined) return 0;
    for (let i = 0; i < intervals.length; i++) {
        const raw = intervals[i];
        const pc = (((chord.root + raw) % PC_SIZE) + PC_SIZE) % PC_SIZE;
        if (pc !== pcInput) continue;
        return intervalRawToDegree(raw);
    }
    return 0;
}

function intervalRawToDegree(raw: number): number {
    if (raw === 0) return 1;
    if (raw === 2 || raw === 14) return 9;
    if (raw === 17) return 11;
    if (raw === 21) return 13;
    const m = raw % PC_SIZE;
    if (m >= 3 && m <= 5) return 3;
    if (m >= 6 && m <= 8) return 5;
    if (m >= 9 && m <= 11) return 7;
    return 0;
}
