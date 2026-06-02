// ============================================================
// ImproCore engine — VoicingGenerator(加权随机和弦 voicing + voice leading)
// imp/voicing/VoicingGenerator.java + AutomaticVoicingSettings(.fv 缩放 /10)
// ============================================================
//
// 算法:128 个 MIDI 音各赋权重 —— priority(和弦)音重、color(张力)音轻;
//   偏置上一个 voicing(及其 ±半/全步)做 voice leading;在音域内按权重(复制份数
//   随机)逐音抽取,抽中后清零本音、衰减邻音、按 repeatMultiplier 衰减其它八度、
//   enforce min-interval;可选去小九度(invertM9)、rootless。
//
// 与 comp.ts 集成:替换原 close voicing,跨和弦传 previousVoicing 做平滑连接。
// 简化:单手覆盖 chord 音域(IMP 支持双手);设置用 Closed-High.fv 缩放后的默认。
// ============================================================

export interface VoicingSettings {
    previousVoicingMultiplier: number;  // .fv /10
    halfStepAwayMultiplier: number;
    fullStepAwayMultiplier: number;
    colorPriority: number;              // 原始 int(×10 成权重)
    maxPriority: number;                // 原始 int(×10)
    priorityMultiplier: number;         // .fv /10
    repeatMultiplier: number;           // .fv /10
    halfStepReducer: number;            // .fv /10
    fullStepReducer: number;            // .fv /10
    minInterval: number;                // 原始 int
    invertM9: boolean;
    rootless: boolean;
}

// Closed-High.fv 缩放后 + 适合 rootless comping 的默认
export const DEFAULT_VOICING_SETTINGS: VoicingSettings = {
    previousVoicingMultiplier: 3.4,
    halfStepAwayMultiplier: 2.3,
    fullStepAwayMultiplier: 2.3,
    colorPriority: 1,        // 色彩音权重 10,让 9/13 进得来
    maxPriority: 10,
    priorityMultiplier: 0.7,
    repeatMultiplier: 0.5,
    halfStepReducer: 0.5,
    fullStepReducer: 0.7,
    minInterval: 2,          // voicing 内不留半音簇
    invertM9: true,
    rootless: true,
};

export interface VoicingRequest {
    priority: number[];                 // 和弦音 MIDI(优先序)
    color: number[];                    // 色彩音 MIDI
    rootMidi: number;
    low: number;                        // 左手(或单手)音域
    high: number;
    numNotes: number;                   // 左手音数
    rightLow?: number;                  // 右手音域(给则双手)
    rightHigh?: number;
    numNotesRight?: number;             // 右手音数
    previousVoicing: number[] | null;
    settings?: VoicingSettings;
}

const clampIdx = (i: number): boolean => i >= 0 && i < 128;

/** 生成一个 voicing(升序 MIDI 列表);给 rightLow/rightHigh/numNotesRight 则双手交替抽 */
export function generateVoicing(req: VoicingRequest): number[] {
    const s = req.settings ?? DEFAULT_VOICING_SETTINGS;
    const w = new Int32Array(128); // allMidiValues

    const setupNote = (midi: number, pri: number) => {
        const pc = ((midi % 12) + 12) % 12;
        for (let i = pc; i < 128; i += 12) w[i] = pri;
    };
    const multiplyNotes = (midi: number, mult: number) => {
        const pc = ((midi % 12) + 12) % 12;
        for (let i = pc; i < 128; i += 12) w[i] = Math.floor(w[i]! * mult);
    };

    // initAllMidiValues
    for (const c of req.color) setupNote(c, s.colorPriority * 10);
    req.priority.forEach((p, idx) => setupNote(p, Math.round(s.maxPriority * 10 - idx * 10 * s.priorityMultiplier)));
    if (s.rootless) setupNote(req.rootMidi, 0);

    // voice leading:偏置上一个 voicing
    if (req.previousVoicing) {
        const mul = (n: number, m: number) => { if (clampIdx(n)) w[n] = Math.floor(w[n]! * m); };
        for (const n of req.previousVoicing) mul(n, s.previousVoicingMultiplier);
        for (const n of req.previousVoicing) { mul(n + 1, s.halfStepAwayMultiplier); mul(n - 1, s.halfStepAwayMultiplier); }
        for (const n of req.previousVoicing) { mul(n + 2, s.fullStepAwayMultiplier); mul(n - 2, s.fullStepAwayMultiplier); }
    }

    // 在 [low,high] 内按权重随机抽一个音并衰减/清理;成功返回该音,否则 null
    const pickFrom = (low: number, high: number): number | null => {
        const pool: number[] = [];
        for (let m = low; m <= high; m++) for (let j = 0; j < w[m]!; j++) pool.push(m);
        if (pool.length === 0) return null;
        const noteToAdd = pool[Math.floor(Math.random() * pool.length)]!;
        w[noteToAdd] = 0;
        const red = (n: number, m: number) => { if (clampIdx(n)) w[n] = Math.floor(w[n]! * m); };
        red(noteToAdd + 1, s.halfStepReducer); red(noteToAdd - 1, s.halfStepReducer);
        red(noteToAdd + 2, s.fullStepReducer); red(noteToAdd - 2, s.fullStepReducer);
        multiplyNotes(noteToAdd, s.repeatMultiplier);
        for (let j = 0; j < s.minInterval; j++) {
            if (clampIdx(noteToAdd + j)) w[noteToAdd + j] = 0;
            if (clampIdx(noteToAdd - j)) w[noteToAdd - j] = 0;
        }
        return noteToAdd;
    };

    const left: number[] = [];
    const right: number[] = [];
    const numRight = req.numNotesRight ?? 0;
    const rLow = req.rightLow ?? req.low;
    const rHigh = req.rightHigh ?? req.high;
    const iters = Math.max(req.numNotes, numRight);
    for (let i = 0; i < iters; i++) {
        if (left.length < req.numNotes) { const n = pickFrom(req.low, req.high); if (n !== null) left.push(n); }
        if (right.length < numRight) { const n = pickFrom(rLow, rHigh); if (n !== null) right.push(n); }
    }

    const hand = [...left, ...right];
    if (s.invertM9) invertMinorNinth(hand);
    return [...new Set(hand)].sort((a, b) => a - b);
}

/** 去小九度(13 半音)→ 翻成大七度:把低音升半音(VoicingGenerator.invertM9th 精神) */
function invertMinorNinth(notes: number[]): void {
    notes.sort((a, b) => a - b);
    for (let i = 0; i < notes.length; i++) {
        for (let j = i + 1; j < notes.length; j++) {
            if (notes[j]! - notes[i]! === 13) { notes[i] = notes[i]! + 1; }
        }
    }
}
