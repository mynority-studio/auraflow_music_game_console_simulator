// ============================================================
// MusicTheory — 纯工具类（无状态、无 PRNG、无 IO）
// ============================================================
// Pitch Space: RELATIVE（所有输入/输出都在相对音高空间，主音 = 0）
// 仅做查表与最近邻吸附，不做 keyOffset 转换。
// ============================================================

import { Tonality, ChordQuality, SCALE_INTERVALS, CHORD_INTERVALS } from '../types';

// ★ 严格扩展后缀正则：覆盖 maj9/maj7/m11/m9/m7/m7b5/dim7/dim/aug/add9/7sus4/sus4/13/11/9/7/m/ø/+
//   长串优先（maj9 在 maj7 之前），避免 'IVadd9' 被部分截走 → 回退 root=0 的致命 bug。
const NUMERAL_REGEX =
    /^([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(maj9|maj7|m7b5|m11|m9|m7|dim7|dim|aug|add9|7sus4|sus4|13|11|9|7|ø|\+|m)?(?:\/([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i))?$/;

export class MusicTheory {
    /**
     * 获取相对音阶数组（半音偏移，相对主音）。
     * Pitch Space: RELATIVE
     */
    public static getScalePitches(tonality: Tonality): number[] {
        return SCALE_INTERVALS[tonality];
    }

    /**
     * 获取和弦相对音程（相对根音的半音偏移）。
     * Pitch Space: RELATIVE
     */
    public static getChordTones(quality: ChordQuality): number[] {
        return CHORD_INTERVALS[quality];
    }

    /**
     * 将给定的相对音高就近吸附到 tonality 音阶内。
     * 输入与输出都是相对音高（保留 octave，仅修正 pitch class）。
     * Pitch Space: RELATIVE → RELATIVE
     */
    public static snapToScale(pitch: number, tonality: Tonality): number {
        const scale = SCALE_INTERVALS[tonality];
        const octave = Math.floor(pitch / 12);
        const pc = pitch - octave * 12; // 0~11

        let bestNote = scale[0];
        let bestDist = Math.abs(pc - scale[0]);
        for (let i = 1; i < scale.length; i++) {
            const d = Math.abs(pc - scale[i]);
            if (d < bestDist) {
                bestDist = d;
                bestNote = scale[i];
            }
        }
        return octave * 12 + bestNote;
    }

    /**
     * 将给定的相对音高就近吸附到任意 pitch class 池内（环形音程距离）。
     * 与 snapToScale 的区别：
     *   - 池可以是任意 0~11 集合（如和弦音、五声音阶等）
     *   - 三个候选八度中选与原 pitch 绝对距离最小者，避免被强行拉到远八度
     * Pitch Space: RELATIVE → RELATIVE
     */
    public static snapToPool(pitch: number, poolPcs: number[]): number {
        if (poolPcs.length === 0) return pitch;

        const pc = ((pitch % 12) + 12) % 12;
        const octave = Math.floor(pitch / 12);

        // 1) 环形距离找最近 pc
        let bestPc = poolPcs[0];
        let firstDiff = Math.abs(pc - poolPcs[0]);
        let bestDist = Math.min(firstDiff, 12 - firstDiff);
        for (let i = 1; i < poolPcs.length; i++) {
            const diff = Math.abs(pc - poolPcs[i]);
            const d = Math.min(diff, 12 - diff);
            if (d < bestDist) {
                bestDist = d;
                bestPc = poolPcs[i];
            }
        }

        // 2) 三个候选八度中选与原 pitch 绝对距离最近的
        const cand0 = bestPc + (octave - 1) * 12;
        const cand1 = bestPc + octave * 12;
        const cand2 = bestPc + (octave + 1) * 12;

        let best = cand0;
        let bestAbs = Math.abs(pitch - cand0);

        const d1 = Math.abs(pitch - cand1);
        if (d1 < bestAbs) { bestAbs = d1; best = cand1; }

        const d2 = Math.abs(pitch - cand2);
        if (d2 < bestAbs) { bestAbs = d2; best = cand2; }

        return best;
    }

    /**
     * 平滑声部连接 + 反浑浊开放排列（Anti-Mud Open Voicing）。
     *
     * 第一阶段（声部平滑）：
     * - 第一个和弦（无 prevVoicing）：每个 pc 就近吸到 targetCenter 附近
     * - 后续和弦：每个 pc 就近吸到 prevVoicing 的平均高度附近
     *
     * 第二阶段（反浑浊，仅 chordPcs.length >= 4 时启用）：
     * - 排序后扫描相邻音对，凡距离 <= 2 半音（大/小二度）即把上方音拔高八度
     * - 拔高后立刻重新排序再扫，直到无相邻二度对或迭代上限 5
     * - 解决 Viterbi 引入 maj9 / m11 / 13 后挤压在同八度内的"音簇浑浊"问题
     *
     * Pitch Space: RELATIVE → RELATIVE
     */
    public static getSmoothVoicing(
        chordPcs: number[],
        prevVoicing: number[],
        targetCenter: number
    ): number[] {
        const result: number[] = [];
        let center = targetCenter;

        if (prevVoicing && prevVoicing.length > 0) {
            let sum = 0;
            for (let i = 0; i < prevVoicing.length; i++) sum += prevVoicing[i];
            center = sum / prevVoicing.length;
        }

        // 1) 初步就近吸附
        for (let i = 0; i < chordPcs.length; i++) {
            result.push(this.snapToPool(center, [chordPcs[i]]));
        }
        result.sort((a, b) => a - b);

        // 2) 反浑浊开放排列（七和弦及以上，强行拆解二度音簇让扩展音上八度）
        if (result.length >= 4) {
            let hasCluster = true;
            let iterations = 0;
            while (hasCluster && iterations < 5) {
                hasCluster = false;
                for (let i = 1; i < result.length; i++) {
                    if (result[i] - result[i - 1] <= 2) {
                        result[i] += 12;
                        hasCluster = true;
                        break;  // 打断，重新排序后再次从头扫描
                    }
                }
                if (hasCluster) result.sort((a, b) => a - b);
                iterations++;
            }
        }

        return result;
    }

    /**
     * Drop-2 开放排列：将升序 voicing 的次高音降一个八度，拉开和声空间防浑浊。
     * 三和弦（<4 音）原样返回。
     * Pitch Space: RELATIVE → RELATIVE
     */
    public static getDrop2Voicing(voicing: number[]): number[] {
        if (voicing.length < 4) return voicing;
        const result = [...voicing];
        result.sort((a, b) => a - b);
        const dropIdx = result.length - 2;
        result[dropIdx] -= 12;
        result.sort((a, b) => a - b);
        return result;
    }

    /**
     * 解析罗马数字和弦记号到 { root, quality }。
     *
     * 输入示例：'I' / 'vi' / 'V7' / 'IVmaj7' / 'iim7' / 'bVII' /
     *           'Vsus4' / 'Iadd9' / 'V9' / 'iim11' / 'IVaug' / 'viiø'。
     *
     * 解析规则（一次正则切分，杜绝 replace 残留导致的回退到 root=0）：
     *   1) `^([b#]?)(罗马字符)(扩展后缀?)$` —— 罗马串长串优先（VII>VI>V，III>II>I）
     *   2) 罗马字符大小写决定基础三和弦（大写=Major / 小写=Minor）
     *   3) 小调 tonality 下做自然小调级数适配（仅当无升降前缀时）
     *   4) 扩展后缀按"长串优先"严格枚举：maj9 / maj7 / m11 / m9 / m7b5 / m7 / dim7 / dim / aug / add9 / 7sus4 / sus4 / 13 / 11 / 9 / 7 / ø / + / m
     *
     * 解析失败（非法记号）回退 { root: 0, quality: Major } 并依赖上层日志记录。
     *
     * Pitch Space: RELATIVE
     */
    public static parseNumeral(numeral: string, tonality?: Tonality): { root: number; quality: ChordQuality; bassOverride?: number } {
        const m = numeral.match(NUMERAL_REGEX);
        if (!m) return { root: 0, quality: ChordQuality.Major };

        const accidental = m[1] ?? '';
        const roman = m[2];
        const suffix = (m[3] ?? '').toLowerCase();
        const upperRoman = roman.toUpperCase();
        const isMinorStr = roman === roman.toLowerCase();

        // 罗马 → root（半音偏移）
        let root = 0;
        if (upperRoman === 'I')        root = 0;
        else if (upperRoman === 'II')  root = 2;
        else if (upperRoman === 'III') root = 4;
        else if (upperRoman === 'IV')  root = 5;
        else if (upperRoman === 'V')   root = 7;
        else if (upperRoman === 'VI')  root = 9;
        else if (upperRoman === 'VII') root = 11;

        let offset = 0;
        if (accidental === 'b') offset = -1;
        else if (accidental === '#') offset = 1;
        let targetRoot = (root + offset + 12) % 12;

        // 基础 quality：大小写决定
        let quality = isMinorStr ? ChordQuality.Minor : ChordQuality.Major;

        // 小调适配（仅 natural diatonic，无升降前缀时）
        const isMinorTonality =
            tonality !== undefined &&
            (tonality === Tonality.Minor ||
                tonality === Tonality.Minor_Pentatonic ||
                tonality === Tonality.Melodic_Minor ||
                tonality === Tonality.Harmonic_Minor ||
                tonality === Tonality.Phrygian ||
                tonality === Tonality.Dorian ||
                tonality === Tonality.Blues);
        if (isMinorTonality && accidental === '') {
            if (upperRoman === 'I')        { quality = ChordQuality.Minor; }
            else if (upperRoman === 'II')  { quality = ChordQuality.Diminished; }
            else if (upperRoman === 'III') { targetRoot = 3; quality = ChordQuality.Major; }
            else if (upperRoman === 'IV')  { quality = ChordQuality.Minor; }
            else if (upperRoman === 'V')   { quality = ChordQuality.Minor; }
            else if (upperRoman === 'VI')  { targetRoot = 8; quality = ChordQuality.Major; }
            else if (upperRoman === 'VII') { targetRoot = 10; quality = ChordQuality.Major; }
        }

        // 扩展后缀：长串优先匹配（maj9 比 maj7 长，必须先匹配）
        if (suffix.length > 0) {
            if (suffix === 'ø' || suffix === 'm7b5') quality = ChordQuality.HalfDiminished;
            else if (suffix === 'dim7') quality = ChordQuality.Diminished7;
            else if (suffix === 'dim')  quality = ChordQuality.Diminished;
            else if (suffix === 'aug' || suffix === '+') quality = ChordQuality.Augmented;
            else if (suffix === 'maj9') quality = ChordQuality.Major9;
            else if (suffix === 'maj7') quality = ChordQuality.Major7;
            else if (suffix === 'm11')  quality = ChordQuality.Minor11;
            else if (suffix === 'm9')   quality = ChordQuality.Minor9;
            else if (suffix === 'm7')   quality = ChordQuality.Minor7;
            else if (suffix === 'm')    quality = ChordQuality.Minor;
            else if (suffix === 'add9') quality = ChordQuality.Add9;
            else if (suffix === '7sus4') quality = ChordQuality.Dominant7Sus4;
            else if (suffix === 'sus4') quality = ChordQuality.Sus4;
            else if (suffix === '13')   quality = ChordQuality.Dominant13;
            else if (suffix === '11')   quality = ChordQuality.Minor11;
            else if (suffix === '9') {
                quality = isMinorStr ? ChordQuality.Minor9 : ChordQuality.Dominant9;
            }
            else if (suffix === '7') {
                if (quality === ChordQuality.Major) quality = ChordQuality.Dominant7;
                else if (quality === ChordQuality.Minor) quality = ChordQuality.Minor7;
                else if (quality === ChordQuality.Diminished) quality = ChordQuality.Diminished7;
            }
        }

        let bassOverride: number | undefined = undefined;
        if (m[5]) {
            const bassAcc = m[4] ?? '';
            const bassRoman = m[5].toUpperCase();
            let bRoot = 0;
            if (bassRoman === 'I')        bRoot = 0;
            else if (bassRoman === 'II')  bRoot = 2;
            else if (bassRoman === 'III') bRoot = 4;
            else if (bassRoman === 'IV')  bRoot = 5;
            else if (bassRoman === 'V')   bRoot = 7;
            else if (bassRoman === 'VI')  bRoot = 9;
            else if (bassRoman === 'VII') bRoot = 11;

            let bOffset = 0;
            if (bassAcc === 'b') bOffset = -1;
            else if (bassAcc === '#') bOffset = 1;

            if (isMinorTonality && bassAcc === '') {
                if (bassRoman === 'III') bRoot = 3;
                else if (bassRoman === 'VI') bRoot = 8;
                else if (bassRoman === 'VII') bRoot = 10;
            }
            bassOverride = (bRoot + bOffset + 12) % 12;
        }

        return { root: targetRoot, quality, ...(bassOverride !== undefined ? { bassOverride } : {}) };
    }
}
