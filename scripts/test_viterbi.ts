/**
 * PR #1 — Viterbi Chord Selector 纯数学验证脚本
 *
 * 目的：在不接入管道的前提下，验证下面三件事：
 *   1. ChordMask 位运算正确（chordToMask / popcount / commonTones）
 *   2. ChordScoreTable 评分符合 top-voice 直觉
 *   3. ViterbiChordSelector 能在给定骨架音下选出听感合理的和弦流
 *
 * 运行：`npx tsx scripts/test_viterbi.ts`
 */

import { ChordQuality, CHORD_INTERVALS, ChordQualityName } from '../src/core/generation/types';
import { chordToMask, commonTones, ChordMask } from '../src/core/generation/harmony/ChordMask';
import { topVoiceScore, SCORE_TABLE } from '../src/core/generation/harmony/ChordScoreTable';
import {
    selectChords,
    makeCandidate,
    HarmonicFunction,
    ChordCandidate,
} from '../src/core/generation/harmony/ViterbiChordSelector';
import { PRNGManager } from '../src/core/utils/PRNG';

// ============================================================
// 工具(test-only debug helpers,本地定义避免污染生产代码)
// ============================================================

const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pcName = (pc: number) => PC[((pc % 12) + 12) % 12];

function maskToPcArray(mask: ChordMask): number[] {
    const result: number[] = [];
    for (let pc = 0; pc < 12; pc++) {
        if (mask & (1 << pc)) result.push(pc);
    }
    return result;
}

const CHORD_SUFFIX: Record<string, string> = {
    Major: '', Minor: 'm', Diminished: 'dim', Diminished7: 'dim7',
    Augmented: 'aug', Dominant7: '7', Minor7: 'm7', Major7: 'maj7',
    HalfDiminished: 'm7b5', Sus4: 'sus4', Dominant7Sus4: '7sus4',
    Add9: 'add9', Minor9: 'm9', Major9: 'maj9', Dominant9: '9',
    Minor11: 'm11', Dominant13: '13',
};
function formatChord(rootPc: number, quality: ChordQuality): string {
    const root = PC[((rootPc % 12) + 12) % 12];
    const q = ChordQualityName[quality] || `Q${quality}`;
    return root + (CHORD_SUFFIX[q] ?? q);
}

function section(title: string) {
    console.log('\n' + '='.repeat(72));
    console.log('  ' + title);
    console.log('='.repeat(72));
}

function subsection(title: string) {
    console.log('\n── ' + title + ' ' + '─'.repeat(Math.max(0, 68 - title.length)));
}

// ============================================================
// 1. ChordMask 基础验证
// ============================================================

function testChordMask() {
    section('1. ChordMask 位运算验证');

    // 主调 C 大调，I 级 = C major，根音 pc=0
    const Cmaj = chordToMask(0, ChordQuality.Major);
    console.log(`C Major    mask = 0x${Cmaj.toString(16).padStart(3, '0')}  pcs = [${maskToPcArray(Cmaj).map(pcName).join(', ')}]  预期 [C, E, G]`);

    // vi 级 = A minor，根音 pc=9
    const Am = chordToMask(9, ChordQuality.Minor);
    console.log(`A Minor    mask = 0x${Am.toString(16).padStart(3, '0')}  pcs = [${maskToPcArray(Am).map(pcName).join(', ')}]  预期 [C, E, A]`);

    // V7 = G7，根音 pc=7
    const G7 = chordToMask(7, ChordQuality.Dominant7);
    console.log(`G Dom7     mask = 0x${G7.toString(16).padStart(3, '0')}  pcs = [${maskToPcArray(G7).map(pcName).join(', ')}]  预期 [D, F, G, B]`);

    // Secondary Dominant V/vi = E7，根音 pc=4
    const E7 = chordToMask(4, ChordQuality.Dominant7);
    console.log(`E Dom7     mask = 0x${E7.toString(16).padStart(3, '0')}  pcs = [${maskToPcArray(E7).map(pcName).join(', ')}]  预期 [D, E, G#, B]`);

    // Minor11（跨八度 interval 折叠测试，maskToPcArray 按 pc 升序输出）
    const Dm11 = chordToMask(2, ChordQuality.Minor11);
    console.log(`D Minor11  mask = 0x${Dm11.toString(16).padStart(3, '0')}  pcs = [${maskToPcArray(Dm11).map(pcName).join(', ')}]  预期 [C, D, E, F, G, A]`);

    subsection('共同音 popcount 验证');
    const cases: [string, number, number, number][] = [
        ['C → Am (同族, 期望 2)',   Cmaj, Am, 2],
        ['C → F (下属, 期望 1)',   Cmaj, chordToMask(5, ChordQuality.Major), 1],
        ['C → G7 (属, 期望 1 G共享)', Cmaj, G7, 1],
        ['C → E7 (V/vi, 期望 1 E共享)', Cmaj, E7, 1],
        // F#7 = F# A# C# E，与 C major 共享 E（C 的 3, F#7 的 b7）
        ['C → F#7 (远关系，仅共享 E)', Cmaj, chordToMask(6, ChordQuality.Dominant7), 1],
        ['Am → Dm7 (小环, 期望 2 A,C)', Am, chordToMask(2, ChordQuality.Minor7), 2],
    ];
    for (const [label, a, b, expected] of cases) {
        const got = commonTones(a, b);
        const ok = got === expected ? 'OK ' : 'FAIL';
        console.log(`  [${ok}] ${label.padEnd(40)} got=${got}`);
    }
}

// ============================================================
// 2. ChordScoreTable 评分直觉验证
// ============================================================

function testScoreTable() {
    section('2. ChordScoreTable Top Voice 直觉验证');

    console.log('\n验证规则：');
    console.log('  - 旋律音是和弦 root/3/5 → 应得正分');
    console.log('  - 旋律音是 maj7 和弦的 7 音 → 应得最高正分（+4）');
    console.log('  - 旋律音是 major 和弦的 b3 音 → 应得负分（半音相撞）');
    console.log('  - 旋律音是 dom7 和弦的 b7 音 → 应得最高正分（+4）\n');

    const cases: [string, number, ChordQuality, number, number][] = [
        //  描述                                         根pc    quality               旋律pc  期望分
        ['Cmaj7 上旋律 B (maj7 灵魂)',                    0, ChordQuality.Major7,       11, +4],
        ['Cmaj7 上旋律 E (3音)',                          0, ChordQuality.Major7,        4, +4],
        ['Cmaj7 上旋律 F (avoid 11)',                     0, ChordQuality.Major7,        5, -2],
        ['C major 上旋律 Eb (b3 冲突)',                   0, ChordQuality.Major,         3, -3],
        ['G7 上旋律 F (b7 灵魂)',                         7, ChordQuality.Dominant7,     5, +4],
        ['G7 上旋律 B (3音)',                             7, ChordQuality.Dominant7,    11, +4],
        ['Am7 上旋律 D (11 甜音)',                        9, ChordQuality.Minor7,        2, +3],
        ['Dm11 上旋律 G (11 核心)',                       2, ChordQuality.Minor11,       7, +4],
        ['Csus4 上旋律 E (3 被挂起)',                     0, ChordQuality.Sus4,          4, -3],
        ['Cadd9 上旋律 D (9 灵魂)',                       0, ChordQuality.Add9,          2, +4],
    ];

    for (const [label, rootPc, quality, melodyPc, expected] of cases) {
        const got = topVoiceScore(rootPc, quality, melodyPc);
        const ok = got === expected ? 'OK ' : 'FAIL';
        const melodyName = pcName(melodyPc);
        console.log(`  [${ok}] ${label.padEnd(40)} melody=${melodyName.padEnd(2)} expected=${String(expected).padStart(3)} got=${String(got).padStart(3)}`);
    }

    subsection('score table 总和（每一行应接近 0，体现分数平衡）');
    for (let q = 0; q < 17; q++) {
        const sum = SCORE_TABLE[q].reduce((a, b) => a + b, 0);
        const qname = ChordQuality[q];
        const bar = '+'.repeat(Math.max(0, sum)) + '-'.repeat(Math.max(0, -sum));
        console.log(`  ${String(q).padStart(2)} ${qname.padEnd(16)} sum=${String(sum).padStart(3)}  ${bar}`);
    }
}

// ============================================================
// 3. 构建 C 大调候选池（K ≤ MAX_K）
// ============================================================

/**
 * 主调 C 大调的标准候选池。
 * 包括 7 个自然级 + 4 个常用色彩 + 4 个借调离调 ≈ 28 个候选
 */
function buildCMajorPool(): ChordCandidate[] {
    const T = HarmonicFunction.Tonic;
    const S = HarmonicFunction.Subdominant;
    const D = HarmonicFunction.Dominant;

    const pool: ChordCandidate[] = [
        // --- 自然音级三和弦/七和弦 ---
        makeCandidate(0,  ChordQuality.Major,      T),  // I    C
        makeCandidate(0,  ChordQuality.Major7,     T),  // Imaj7
        makeCandidate(0,  ChordQuality.Major9,     T),  // Imaj9
        makeCandidate(2,  ChordQuality.Minor,      S),  // ii   Dm
        makeCandidate(2,  ChordQuality.Minor7,     S),  // ii7  Dm7
        makeCandidate(4,  ChordQuality.Minor,      T),  // iii  Em (T 代理)
        makeCandidate(4,  ChordQuality.Minor7,     T),  // iii7 Em7
        makeCandidate(5,  ChordQuality.Major,      S),  // IV   F
        makeCandidate(5,  ChordQuality.Major7,     S),  // IVmaj7
        makeCandidate(7,  ChordQuality.Major,      D),  // V    G
        makeCandidate(7,  ChordQuality.Dominant7,  D),  // V7   G7
        makeCandidate(7,  ChordQuality.Dominant7Sus4, D), // V7sus4
        makeCandidate(9,  ChordQuality.Minor,      T),  // vi   Am (T 代理)
        makeCandidate(9,  ChordQuality.Minor7,     T),  // vi7  Am7

        // --- 色彩扩展 ---
        makeCandidate(2,  ChordQuality.Minor9,     S),  // ii9  Dm9
        makeCandidate(9,  ChordQuality.Minor9,     T),  // vi9  Am9

        // --- 副属（Secondary Dominants）---
        makeCandidate(2,  ChordQuality.Dominant7,  D),  // V/V = D7
        makeCandidate(4,  ChordQuality.Dominant7,  D),  // V/vi = E7
        makeCandidate(9,  ChordQuality.Dominant7,  D),  // V/ii = A7
        makeCandidate(11, ChordQuality.Dominant7,  D),  // V/iii = B7

        // --- 借调（Modal Mixture）---
        makeCandidate(3,  ChordQuality.Major,      S),  // bIII Eb
        makeCandidate(8,  ChordQuality.Major,      S),  // bVI  Ab
        makeCandidate(10, ChordQuality.Major,      S),  // bVII Bb
        makeCandidate(5,  ChordQuality.Minor,      S),  // iv   Fm (同主小借)

        // --- sus/add 色彩 ---
        makeCandidate(0,  ChordQuality.Sus4,       T),  // Isus4
        makeCandidate(0,  ChordQuality.Add9,       T),  // Cadd9
        makeCandidate(7,  ChordQuality.Sus4,       D),  // Vsus4 Gsus4
    ];

    return pool;
}

// ============================================================
// 4. Viterbi 端到端测试
// ============================================================

function formatCandidate(c: ChordCandidate): string {
    return formatChord(c.rootPc, c.quality);
}

function runViterbiCase(
    title: string,
    anchors: number[],
    functionConstraint?: HarmonicFunction[],
) {
    subsection(title);
    console.log(`  骨架音:   [${anchors.map(pcName).join(', ')}]`);
    if (functionConstraint) {
        const fname = (f: HarmonicFunction) => ['T', 'S', 'D'][f];
        console.log(`  功能约束: [${functionConstraint.map(fname).join(', ')}]`);
    }

    const pool = buildCMajorPool();
    console.log(`  候选池大小: ${pool.length}`);

    const result = selectChords({
        anchors,
        pool,
        functionConstraint,
        initialPrev: null,
    }, /* withBreakdown */ true);

    console.log(`\n  选中和弦流 (total score = ${result.totalScore}):`);
    console.log(`  ${'slot'.padStart(4)} ${'anchor'.padStart(7)} ${'chord'.padEnd(10)} ${'func'.padEnd(5)} ${'common'.padStart(6)} ${'topV'.padStart(5)} ${'la1'.padStart(4)} ${'la2'.padStart(4)}`);

    let prev: ChordCandidate | null = null;
    for (let i = 0; i < result.selection.length; i++) {
        const c = result.selection[i];
        const b = result.breakdown?.[i];
        const common = prev ? commonTones(c.mask, prev.mask) : 0;
        const fname = ['T', 'S', 'D'][c.functionClass];
        console.log(
            `  ${String(i).padStart(4)} ${pcName(anchors[i]).padStart(7)} ${formatCandidate(c).padEnd(10)} ${fname.padEnd(5)} ${String(common).padStart(6)} ${String(b?.topVoice ?? 0).padStart(5)} ${String(b?.lookAhead1 ?? 0).padStart(4)} ${String(b?.lookAhead2 ?? 0).padStart(4)}`,
        );
        prev = c;
    }
}

function testViterbi() {
    section('3. ViterbiChordSelector 端到端验证 (C 大调)');

    // === 种子 1：稳定的 Verse 骨架 ===
    PRNGManager.setSeed(42);
    runViterbiCase(
        'Case A — 稳定级进骨架 (E → D → C → B → C → D → E → C)',
        [4, 2, 0, 11, 0, 2, 4, 0],
        // 典型 Verse 功能走向 T → S → T → D → T → S → T → T
        [
            HarmonicFunction.Tonic,
            HarmonicFunction.Subdominant,
            HarmonicFunction.Tonic,
            HarmonicFunction.Dominant,
            HarmonicFunction.Tonic,
            HarmonicFunction.Subdominant,
            HarmonicFunction.Tonic,
            HarmonicFunction.Tonic,
        ],
    );

    // === 种子 2：跳跃的 Chorus 骨架 ===
    PRNGManager.setSeed(42);
    runViterbiCase(
        'Case B — 跳跃骨架 (G → E → A → D → G → B → C → G)',
        [7, 4, 9, 2, 7, 11, 0, 7],
        // 副歌 T-T-T-S-D-D-T-T（故意让 ii-V-I 出现）
        [
            HarmonicFunction.Tonic,
            HarmonicFunction.Tonic,
            HarmonicFunction.Tonic,
            HarmonicFunction.Subdominant,
            HarmonicFunction.Dominant,
            HarmonicFunction.Dominant,
            HarmonicFunction.Tonic,
            HarmonicFunction.Tonic,
        ],
    );

    // === 种子 3：没有功能约束，纯由旋律 top voice 主导 ===
    PRNGManager.setSeed(123);
    runViterbiCase(
        'Case C — 无功能约束，纯旋律驱动 (G → A → B → C → E → D → G → C)',
        [7, 9, 11, 0, 4, 2, 7, 0],
        // 不传 functionConstraint
    );

    // === 种子 4：极端 ii-V-I 骨架（期望看到 Dm7 → G7 → Cmaj7）===
    PRNGManager.setSeed(999);
    runViterbiCase(
        'Case D — ii-V-I 经典骨架 (F → B → E)',
        [5, 11, 4],
        [HarmonicFunction.Subdominant, HarmonicFunction.Dominant, HarmonicFunction.Tonic],
    );

    // === 种子 5：决定论验证 —— 同 seed 必得同结果 ===
    subsection('Case E — 决定论验证 (同 seed 连跑 3 次)');
    const anchors = [0, 4, 7, 0];
    const pool = buildCMajorPool();
    for (let trial = 0; trial < 3; trial++) {
        PRNGManager.setSeed(12345);
        const r = selectChords({ anchors, pool, initialPrev: null });
        const seq = r.selection.map(formatCandidate).join(' → ');
        console.log(`  trial ${trial + 1}: ${seq}  (score=${r.totalScore})`);
    }

    subsection('Case F — 不同 seed 的分岔');
    const seeds = [1, 2, 3, 4, 5];
    for (const seed of seeds) {
        PRNGManager.setSeed(seed);
        const r = selectChords({ anchors, pool, initialPrev: null });
        const seq = r.selection.map(formatCandidate).join(' → ');
        console.log(`  seed=${seed}: ${seq}  (score=${r.totalScore})`);
    }
}

// ============================================================
// 5. 性能基准（可选）
// ============================================================

function benchViterbi() {
    section('4. 性能基准 (N=32, K=28)');

    const pool = buildCMajorPool();
    const anchors = new Array(32).fill(0).map((_, i) => (i * 7) % 12);

    PRNGManager.setSeed(42);
    const iterations = 100;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
        selectChords({ anchors, pool, initialPrev: null });
    }
    const t1 = performance.now();

    const perRun = (t1 - t0) / iterations;
    console.log(`  ${iterations} 次 Viterbi 调用平均耗时: ${perRun.toFixed(3)} ms/run`);
    console.log(`  N × K × K = ${32 * pool.length * pool.length} 次转移评分`);
    console.log(`  ESP32 预算对比: 目标 < 5 ms/section ${perRun < 5 ? 'OK' : 'WARN'}`);
}

// ============================================================
// 入口
// ============================================================

function main() {
    console.log('\n🎵 PR #1 — Viterbi Chord Selector Validation\n');
    testChordMask();
    testScoreTable();
    testViterbi();
    benchViterbi();
    console.log('\n✅ 全部测试完成\n');
}

main();
