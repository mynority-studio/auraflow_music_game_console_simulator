import { NoteData, Tonality, SCALE_INTERVALS } from '@/src/core/generation/types';

type MotifRole = 'Foreground' | 'Middleground' | 'Background';

export interface MotifAnalysis {
    qualityScore: number;       // 0-1
    intervalProfile: 'stepwise' | 'jumpy' | 'static' | 'mixed';
    rhythmRegularity: number;   // 0-1
    suggestedRole: MotifRole;
    noteCount: number;
}

export interface PreprocessedMotif {
    motif: NoteData[] | null;   // null = 质量太低，不传 motif
    role: MotifRole;
    analysis: MotifAnalysis;
}

// ================================================================
// 阶段 1：质量分析
// ================================================================

function analyzeMotif(notes: NoteData[]): MotifAnalysis {
    const n = notes.length;

    if (n < 2) {
        return { qualityScore: 0.1, intervalProfile: 'static', rhythmRegularity: 0, suggestedRole: 'Background', noteCount: n };
    }

    // 1. 音程分析
    const intervals: number[] = [];
    let bigJumps = 0;
    let ups = 0;
    let downs = 0;
    let sames = 0;
    for (let i = 1; i < n; i++) {
        const interval = notes[i].pitch - notes[i - 1].pitch;
        intervals.push(interval);
        const abs = Math.abs(interval);
        if (abs > 7) bigJumps++;
        if (interval > 0) ups++;
        else if (interval < 0) downs++;
        else sames++;
    }

    const bigJumpRatio = bigJumps / intervals.length;
    const intervalScore = Math.max(0, 1.0 - bigJumpRatio * 2.5); // 大跳越多越扣分

    // 2. 节奏规律性（能否量化到 16th grid）
    const gridSize = 0.25;
    let totalDeviation = 0;
    for (let i = 0; i < n; i++) {
        const quantized = Math.round(notes[i].onset / gridSize) * gridSize;
        totalDeviation += Math.abs(notes[i].onset - quantized);
    }
    const avgDeviation = totalDeviation / n;
    const rhythmRegularity = Math.max(0, 1.0 - avgDeviation * 8); // 偏差越大越不规律

    // 3. 音域跨度
    let minPitch = 127;
    let maxPitch = 0;
    for (let i = 0; i < n; i++) {
        if (notes[i].pitch < minPitch) minPitch = notes[i].pitch;
        if (notes[i].pitch > maxPitch) maxPitch = notes[i].pitch;
    }
    const range = maxPitch - minPitch;
    const rangeScore = range <= 14 ? 1.0 : Math.max(0, 1.0 - (range - 14) * 0.08);

    // 4. 音符数量
    let countScore = 1.0;
    if (n < 3) countScore = 0.4;
    else if (n > 16) countScore = 0.5;
    else if (n >= 3 && n <= 12) countScore = 1.0;
    else countScore = 0.7;

    // 5. 方向变化（有起伏比纯单向好）
    const hasUps = ups > 0;
    const hasDowns = downs > 0;
    const directionScore = (hasUps && hasDowns) ? 1.0 : (sames > intervals.length * 0.5 ? 0.3 : 0.5);

    // 综合评分
    const qualityScore = intervalScore * 0.3 + rhythmRegularity * 0.25 + rangeScore * 0.2 + countScore * 0.15 + directionScore * 0.1;

    // 音程轮廓分类
    let intervalProfile: 'stepwise' | 'jumpy' | 'static' | 'mixed' = 'mixed';
    if (sames > intervals.length * 0.6) intervalProfile = 'static';
    else if (bigJumpRatio > 0.4) intervalProfile = 'jumpy';
    else if (bigJumpRatio < 0.15) intervalProfile = 'stepwise';

    // 角色推断
    let suggestedRole: MotifRole = 'Foreground';
    if (n <= 4 && sames >= intervals.length * 0.3) suggestedRole = 'Background';
    else if (n > 12) suggestedRole = 'Middleground';

    return { qualityScore, intervalProfile, rhythmRegularity, suggestedRole, noteCount: n };
}

// ================================================================
// 阶段 2：清洗
// ================================================================

function snapToScale(pitch: number, scalePcs: number[]): number {
    const pc = ((pitch % 12) + 12) % 12;
    const octave = Math.floor(pitch / 12);
    let bestDist = 99;
    let bestPc = pc;
    for (let i = 0; i < scalePcs.length; i++) {
        const dist = Math.min(Math.abs(pc - scalePcs[i]), 12 - Math.abs(pc - scalePcs[i]));
        if (dist < bestDist) { bestDist = dist; bestPc = scalePcs[i]; }
    }
    // 选择最近的八度
    const candidates = [bestPc + octave * 12, bestPc + (octave - 1) * 12, bestPc + (octave + 1) * 12];
    let best = candidates[0];
    let bestAbsDist = Math.abs(candidates[0] - pitch);
    for (let i = 1; i < candidates.length; i++) {
        const d = Math.abs(candidates[i] - pitch);
        if (d < bestAbsDist) { best = candidates[i]; bestAbsDist = d; }
    }
    return best;
}

function cleanMotif(notes: NoteData[], tonality: Tonality): NoteData[] {
    const intervals = SCALE_INTERVALS[tonality] || SCALE_INTERVALS[Tonality.Major];
    const scalePcs = intervals.map(i => i % 12);
    const gridSize = 0.25;

    const cleaned: NoteData[] = [];
    for (let i = 0; i < notes.length; i++) {
        const n = notes[i];

        // 节奏量化
        const quantizedOnset = Math.round(n.onset / gridSize) * gridSize;

        // 音高吸附到音阶
        let pitch = snapToScale(n.pitch, scalePcs);

        // 去除异常音（与前后音间距都 > 12 半音）
        if (i > 0 && i < notes.length - 1) {
            const prevPitch = cleaned[cleaned.length - 1].pitch;
            const nextPitch = snapToScale(notes[i + 1].pitch, scalePcs);
            if (Math.abs(pitch - prevPitch) > 12 && Math.abs(pitch - nextPitch) > 12) {
                pitch = snapToScale(prevPitch, scalePcs);
            }
        }

        // 时值归一化
        const duration = Math.max(0.125, Math.min(4.0, n.duration));

        cleaned.push({
            pitch,
            onset: quantizedOnset,
            duration,
            velocity: n.velocity,
            isUserMotif: true
        });
    }

    return cleaned;
}

// ================================================================
// 阶段 3：变奏扩展（A - A - A' - A'' 结构）
// 保留 75% 原始音符，让用户能清晰听到自己的 motif
// ================================================================

function expandMotif(cleaned: NoteData[], tonality: Tonality, beatsPerBar: number): NoteData[] {
    if (cleaned.length === 0) return [];

    const intervals = SCALE_INTERVALS[tonality] || SCALE_INTERVALS[Tonality.Major];
    const scalePcs = intervals.map(i => i % 12);

    // 计算 motif 原始长度，向上补齐到 beatsPerBar 的倍数
    let maxOnset = 0;
    for (let i = 0; i < cleaned.length; i++) {
        const end = cleaned[i].onset + cleaned[i].duration;
        if (end > maxOnset) maxOnset = end;
    }
    const motifLength = Math.max(beatsPerBar, Math.ceil(maxOnset / beatsPerBar) * beatsPerBar);

    // 如果 motif 太长（> 8 拍），截取前 2 小节
    const maxLength = beatsPerBar * 2;
    let core = cleaned;
    if (motifLength > maxLength) {
        core = cleaned.filter(n => n.onset < maxLength);
        if (core.length === 0) core = [cleaned[0]];
    }
    const coreLength = Math.min(motifLength, maxLength);

    const result: NoteData[] = [];

    // A: 原始 motif（第 1 遍，完全保留）
    for (let i = 0; i < core.length; i++) {
        result.push({ ...core[i] });
    }

    // A: 原始 motif（第 2 遍，完全重复 — 强化记忆点）
    for (let i = 0; i < core.length; i++) {
        result.push({ ...core[i], onset: core[i].onset + coreLength });
    }

    // A': 微调变奏 — 仅最后一个音做调内位移
    for (let i = 0; i < core.length; i++) {
        const note = { ...core[i], onset: core[i].onset + coreLength * 2 };
        if (i === core.length - 1) {
            note.pitch = shiftDiatonic(note.pitch, scalePcs, 1);
        }
        result.push(note);
    }

    // A'': 回归高潮 — 原始 motif + 最高音延长增强
    let highestIdx = 0;
    let highestPitch = -1;
    for (let i = 0; i < core.length; i++) {
        if (core[i].pitch > highestPitch) { highestPitch = core[i].pitch; highestIdx = i; }
    }
    for (let i = 0; i < core.length; i++) {
        const note = { ...core[i], onset: core[i].onset + coreLength * 3, isUserMotif: true };
        if (i === highestIdx) {
            note.duration = Math.min(4.0, note.duration * 1.5);
            note.velocity = Math.min(1.0, note.velocity * 1.2);
        }
        result.push(note);
    }

    return result;
}

function shiftDiatonic(pitch: number, scalePcs: number[], direction: number): number {
    const pc = ((pitch % 12) + 12) % 12;
    const octave = Math.floor(pitch / 12);
    // 找到当前 pc 在音阶中的位置
    let idx = -1;
    let minDist = 99;
    for (let i = 0; i < scalePcs.length; i++) {
        const d = Math.min(Math.abs(pc - scalePcs[i]), 12 - Math.abs(pc - scalePcs[i]));
        if (d < minDist) { minDist = d; idx = i; }
    }
    // 移动一个度
    let newIdx = idx + direction;
    let newOctave = octave;
    if (newIdx >= scalePcs.length) { newIdx = 0; newOctave++; }
    if (newIdx < 0) { newIdx = scalePcs.length - 1; newOctave--; }
    return scalePcs[newIdx] + newOctave * 12;
}

// ================================================================
// 阶段 4：质量门控 + 公开 API
// ================================================================

export function preprocessMotif(
    raw: NoteData[],
    tonality: Tonality
): PreprocessedMotif {
    if (raw.length === 0) {
        return {
            motif: null,
            role: 'Foreground',
            analysis: { qualityScore: 0, intervalProfile: 'static', rhythmRegularity: 0, suggestedRole: 'Foreground', noteCount: 0 }
        };
    }

    const analysis = analyzeMotif(raw);

    const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    console.log(`[MotifPreprocessor] Raw input: ${raw.length} notes, quality: ${analysis.qualityScore.toFixed(2)}, profile: ${analysis.intervalProfile}`);
    console.log(`[MotifPreprocessor] Raw pitches: ${raw.map(n => NOTE_NAMES[((n.pitch % 12) + 12) % 12] + Math.floor(n.pitch / 12)).join(', ')}`);
    console.log(`[MotifPreprocessor] Raw onsets: ${raw.map(n => n.onset.toFixed(2)).join(', ')}`);

    // 质量太低：不传 motif，回退到正常随机生成
    if (analysis.qualityScore < 0.25) {
        console.log(`[MotifPreprocessor] Quality too low, falling back to random generation`);
        return { motif: null, role: analysis.suggestedRole, analysis };
    }

    // 清洗
    const cleaned = cleanMotif(raw, tonality);
    console.log(`[MotifPreprocessor] After cleaning: ${cleaned.length} notes`);
    console.log(`[MotifPreprocessor] Cleaned pitches: ${cleaned.map(n => NOTE_NAMES[((n.pitch % 12) + 12) % 12] + Math.floor(n.pitch / 12)).join(', ')}`);

    // 变奏扩展
    const beatsPerBar = 4; // 默认 4/4
    const expanded = expandMotif(cleaned, tonality, beatsPerBar);
    console.log(`[MotifPreprocessor] After expansion: ${expanded.length} notes (${cleaned.length} × 4 sections)`);

    // 角色决定
    let role = analysis.suggestedRole;
    if (analysis.qualityScore < 0.5) role = 'Background';

    console.log(`[MotifPreprocessor] Quality: ${analysis.qualityScore.toFixed(2)}, Role: ${role}, Notes: ${raw.length}→${expanded.length}, Profile: ${analysis.intervalProfile}`);

    return { motif: expanded, role, analysis };
}
