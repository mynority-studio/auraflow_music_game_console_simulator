import { NoteData, Tonality, SCALE_INTERVALS, TopologyConfig } from '@/src/core/generation/types';
import { PRNGManager } from '@/src/core/utils/PRNG';

// Motif 预处理只保留 identity topology stub;变奏 block 直接复用 core。
const TopologyMutator = {
    applyTopologyChain(
        core: NoteData[],
        _config: TopologyConfig,
        _next: () => number,
        _nextInt: (min: number, max: number) => number,
    ): NoteData[] {
        void _config; void _next; void _nextInt;
        return core.map((n) => ({ ...n }));
    },
};

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
    const intervalCount = n - 1;
    const intervals: number[] = new Array(intervalCount);
    let bigJumps = 0;
    let ups = 0;
    let downs = 0;
    let sames = 0;
    for (let i = 1; i < n; i++) {
        const interval = notes[i].pitch - notes[i - 1].pitch;
        intervals[i - 1] = interval;
        const abs = Math.abs(interval);
        if (abs > 7) bigJumps++;
        if (interval > 0) ups++;
        else if (interval < 0) downs++;
        else sames++;
    }

    const bigJumpRatio = bigJumps / intervalCount;
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
    const directionScore = (hasUps && hasDowns) ? 1.0 : (sames > intervalCount * 0.5 ? 0.3 : 0.5);

    // 综合评分
    const qualityScore = intervalScore * 0.3 + rhythmRegularity * 0.25 + rangeScore * 0.2 + countScore * 0.15 + directionScore * 0.1;

    // 音程轮廓分类
    let intervalProfile: 'stepwise' | 'jumpy' | 'static' | 'mixed' = 'mixed';
    if (sames > intervalCount * 0.6) intervalProfile = 'static';
    else if (bigJumpRatio > 0.4) intervalProfile = 'jumpy';
    else if (bigJumpRatio < 0.15) intervalProfile = 'stepwise';

    // 角色推断
    let suggestedRole: MotifRole = 'Foreground';
    if (n <= 4 && sames >= intervalCount * 0.3) suggestedRole = 'Background';
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
    // 选择最近的八度（3 个候选：当前 / 上 / 下）
    const cand0 = bestPc + octave * 12;
    const cand1 = bestPc + (octave - 1) * 12;
    const cand2 = bestPc + (octave + 1) * 12;
    let best = cand0;
    let bestAbsDist = Math.abs(cand0 - pitch);
    const d1 = Math.abs(cand1 - pitch);
    if (d1 < bestAbsDist) { best = cand1; bestAbsDist = d1; }
    const d2 = Math.abs(cand2 - pitch);
    if (d2 < bestAbsDist) { best = cand2; bestAbsDist = d2; }
    return best;
}

function cleanMotif(notes: NoteData[], tonality: Tonality): NoteData[] {
    const intervals = SCALE_INTERVALS[tonality] || SCALE_INTERVALS[Tonality.Major];
    const scalePcs: number[] = new Array(intervals.length);
    for (let i = 0; i < intervals.length; i++) scalePcs[i] = intervals[i] % 12;
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
// 阶段 3：拓扑形变扩展（Original - Invert - Original - Retrograde）
// 用纯数学拓扑变换发展用户动机，无需任何乐理知识。
// ================================================================

function expandMotif(cleaned: NoteData[], _tonality: Tonality, beatsPerBar: number, topologyConfig?: TopologyConfig): NoteData[] {
    if (cleaned.length === 0) return [];

    // 计算 motif 原始长度，向上补齐到 beatsPerBar 的倍数
    let maxOnset = 0;
    for (let i = 0; i < cleaned.length; i++) {
        const end = cleaned[i].onset + cleaned[i].duration;
        if (end > maxOnset) maxOnset = end;
    }
    const motifLength = Math.max(beatsPerBar, Math.ceil(maxOnset / beatsPerBar) * beatsPerBar);

    // 如果 motif 太长（> 8 拍），截取前 2 小节
    const maxLength = beatsPerBar * 2;
    let core: NoteData[] = cleaned;
    if (motifLength > maxLength) {
        const trimmed: NoteData[] = [];
        for (let i = 0; i < cleaned.length; i++) {
            if (cleaned[i].onset < maxLength) trimmed.push(cleaned[i]);
        }
        core = trimmed.length === 0 ? [cleaned[0]] : trimmed;
    }
    const coreLength = Math.min(motifLength, maxLength);

    const configToUse: TopologyConfig = topologyConfig ?? {
        probInvert: 0.4, probReverse: 0.2, probExpand: 0.0, probSideSlip: 0.3, sideSlipRange: 2, colorBias: 0, probTimeShift: 0.3, timeShiftBeats: 0.25
    };

    const result: NoteData[] = [];
    for (let b = 0; b < 4; b++) {
        let blockNotes: NoteData[];
        if (b === 0 || b === 2) {
            // 听觉锚定：原形复现
            blockNotes = core;
        } else {
            // 变奏：应用拓扑变异（直接消耗 PRNGManager 安全 —
            // 本函数在 pipeline runPipeline 之前执行，B 快照尚未捕获）
            blockNotes = TopologyMutator.applyTopologyChain(
                core, configToUse,
                () => PRNGManager.next(),
                (min, max) => PRNGManager.nextInt(min, max)
            );
        }
        for (let i = 0; i < blockNotes.length; i++) {
            result.push({
                ...blockNotes[i],
                onset: blockNotes[i].onset + coreLength * b,
                isUserMotif: true
            });
        }
    }
    return result;
}

// ================================================================
// 阶段 4：质量门控 + 公开 API
// ================================================================

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function formatPitchNames(notes: NoteData[]): string {
    const names: string[] = new Array(notes.length);
    for (let i = 0; i < notes.length; i++) {
        const p = notes[i].pitch;
        names[i] = NOTE_NAMES[((p % 12) + 12) % 12] + Math.floor(p / 12);
    }
    return names.join(', ');
}

function formatOnsets(notes: NoteData[]): string {
    const out: string[] = new Array(notes.length);
    for (let i = 0; i < notes.length; i++) out[i] = notes[i].onset.toFixed(2);
    return out.join(', ');
}

export function preprocessMotif(
    raw: NoteData[],
    tonality: Tonality,
    topologyConfig?: TopologyConfig
): PreprocessedMotif {
    if (raw.length === 0) {
        return {
            motif: null,
            role: 'Foreground',
            analysis: { qualityScore: 0, intervalProfile: 'static', rhythmRegularity: 0, suggestedRole: 'Foreground', noteCount: 0 }
        };
    }

    const analysis = analyzeMotif(raw);

    console.log(`[MotifPreprocessor] Raw input: ${raw.length} notes, quality: ${analysis.qualityScore.toFixed(2)}, profile: ${analysis.intervalProfile}`);
    console.log(`[MotifPreprocessor] Raw pitches: ${formatPitchNames(raw)}`);
    console.log(`[MotifPreprocessor] Raw onsets: ${formatOnsets(raw)}`);

    // 质量太低：不传 motif，回退到正常随机生成
    if (analysis.qualityScore < 0.25) {
        console.log(`[MotifPreprocessor] Quality too low, falling back to random generation`);
        return { motif: null, role: analysis.suggestedRole, analysis };
    }

    // 清洗
    const cleaned = cleanMotif(raw, tonality);
    console.log(`[MotifPreprocessor] After cleaning: ${cleaned.length} notes`);
    console.log(`[MotifPreprocessor] Cleaned pitches: ${formatPitchNames(cleaned)}`);

    // 拓扑形变扩展（拓扑链由 Persona.topologyConfig 注入；缺省时回退到内置默认）
    const beatsPerBar = 4; // 默认 4/4
    const expanded = expandMotif(cleaned, tonality, beatsPerBar, topologyConfig);
    console.log(`[MotifPreprocessor] After expansion: ${expanded.length} notes (${cleaned.length} × 4 blocks: Anchor/Variation/Anchor/Variation via TopologyChain)`);

    // 角色决定
    let role = analysis.suggestedRole;
    if (analysis.qualityScore < 0.5) role = 'Background';

    console.log(`[MotifPreprocessor] Quality: ${analysis.qualityScore.toFixed(2)}, Role: ${role}, Notes: ${raw.length}→${expanded.length}, Profile: ${analysis.intervalProfile}`);

    return { motif: expanded, role, analysis };
}
