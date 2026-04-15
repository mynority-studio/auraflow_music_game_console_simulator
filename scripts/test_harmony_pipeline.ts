/**
 * PR #2 — HarmonyPipeline 端到端验证脚本
 *
 * 不接入音频，只验证：
 *   1. ChordNumeral 反查表正确（pitchClass + quality → 罗马数字字符串）
 *   2. ShadowSkeletonGenerator 能根据 SectionType 选模板
 *   3. SkeletonMelodyGenerator 能在 diatonic 内选音 + smoothing
 *   4. HarmonyPipeline 端到端能输出合理的 GeneratedChord[] 全曲
 *   5. 与 HarmonyCore.parseRomanNumeral 双向对账（往返一致）
 *
 * 运行：`npx tsx scripts/test_harmony_pipeline.ts`
 */

import { PRNGManager } from '../src/core/utils/PRNG';
import {
    SectionMetadata,
    SectionType,
    Tonality,
    ChordQuality,
} from '../src/core/generation/types';

import { pitchClassToNumeral } from '../src/core/generation/harmony/ChordNumeral';

// Inline self-test cases(test-only,避免污染生产代码)
function numeralSelfTest(): { passed: number; failed: number; cases: string[] } {
    const cases: Array<[number, ChordQuality, string]> = [
        [0,  ChordQuality.Major,        'I'],
        [0,  ChordQuality.Major7,       'Imaj7'],
        [2,  ChordQuality.Minor,        'ii'],
        [2,  ChordQuality.Minor7,       'ii7'],
        [4,  ChordQuality.Minor7,       'iii7'],
        [5,  ChordQuality.Major,        'IV'],
        [5,  ChordQuality.Major7,       'IVmaj7'],
        [7,  ChordQuality.Major,        'V'],
        [7,  ChordQuality.Dominant7,    'V7'],
        [9,  ChordQuality.Minor,        'vi'],
        [9,  ChordQuality.Minor7,       'vi7'],
        [3,  ChordQuality.Major,        'bIII'],
        [8,  ChordQuality.Major,        'bVI'],
        [10, ChordQuality.Major,        'bVII'],
        [4,  ChordQuality.Dominant7,    'III7'],
        [2,  ChordQuality.Dominant7,    'II7'],
    ];
    const results: string[] = [];
    let passed = 0, failed = 0;
    for (const [pc, q, expected] of cases) {
        const got = pitchClassToNumeral(pc, q);
        const ok = got === expected;
        if (ok) passed++; else failed++;
        results.push(`${ok ? 'OK ' : 'FAIL'} pc=${pc} q=${ChordQuality[q]} → "${got}" (expected "${expected}")`);
    }
    return { passed, failed, cases: results };
}
import { generateShadowSkeleton } from '../src/core/generation/harmony/ShadowSkeletonGenerator';
import { generateSkeletonMelody } from '../src/core/generation/harmony/SkeletonMelodyGenerator';
import {
    generateHarmonyViaPipeline,
    generateHarmonyViaPipelineWithDebug,
} from '../src/core/generation/harmony/HarmonyPipeline';
import { HarmonyCore } from '../src/core/generation/composing/HarmonyCore';

// ============================================================
// 工具
// ============================================================

const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pcName = (pc: number) => PC[((pc % 12) + 12) % 12];
const FN = ['T', 'S', 'D'];

function section(title: string) {
    console.log('\n' + '='.repeat(72));
    console.log('  ' + title);
    console.log('='.repeat(72));
}

function subsection(title: string) {
    console.log('\n── ' + title + ' ' + '─'.repeat(Math.max(0, 68 - title.length)));
}

// ============================================================
// 1. ChordNumeral 反查表自检
// ============================================================

function testNumeral() {
    section('1. ChordNumeral 反查表自检');
    const result = numeralSelfTest();
    for (const c of result.cases) console.log('  ' + c);
    console.log(`\n  小计：passed=${result.passed} failed=${result.failed}`);
}

// ============================================================
// 2. ChordNumeral 双向对账
// ============================================================

function testNumeralRoundTrip() {
    section('2. ChordNumeral ↔ parseRomanNumeral 双向对账');
    console.log('\n  对每个 (pc, quality) 组合：先反查为 numeral，再用 HarmonyCore 解析回去，');
    console.log('  验证 root 一致（quality 可能因 parseRomanNumeral 兼容字串集合而退化）。\n');

    const cases: Array<[number, ChordQuality]> = [
        [0, ChordQuality.Major],
        [0, ChordQuality.Major7],
        [0, ChordQuality.Add9],
        [2, ChordQuality.Minor7],
        [4, ChordQuality.Minor7],
        [5, ChordQuality.Major7],
        [7, ChordQuality.Dominant7],
        [9, ChordQuality.Minor7],
        // 借调
        [3, ChordQuality.Major],
        [8, ChordQuality.Major],
        [10, ChordQuality.Major],
        // 副属
        [4, ChordQuality.Dominant7],
        [2, ChordQuality.Dominant7],
    ];

    let passed = 0, failed = 0;
    for (const [pc, q] of cases) {
        const numeral = pitchClassToNumeral(pc, q, Tonality.Major);
        const parsed = HarmonyCore.parseRomanNumeral(numeral, Tonality.Major);
        const rootMatch = parsed.root === pc;
        const ok = rootMatch ? 'OK ' : 'FAIL';
        if (rootMatch) passed++; else failed++;
        console.log(`  [${ok}] pc=${pc}(${pcName(pc)}) q=${ChordQuality[q].padEnd(12)} → "${numeral.padEnd(8)}" → parsed root=${parsed.root} quality=${parsed.quality}`);
    }
    console.log(`\n  小计：passed=${passed} failed=${failed}`);
}

// ============================================================
// 3. ShadowSkeleton 与 SkeletonMelody 单元测试
// ============================================================

function buildMockSections(): SectionMetadata[] {
    // 模拟一首小型流行歌曲：Verse(8 bars) + Chorus(8 bars)
    return [
        {
            name: 'Verse_1',
            startBeat: 0,
            endBeat: 32,        // 8 bars × 4 beats
            energyLevel: 4,
            sectionType: SectionType.Verse,
        },
        {
            name: 'Chorus_1',
            startBeat: 32,
            endBeat: 64,
            energyLevel: 8,
            sectionType: SectionType.Chorus,
        },
    ];
}

function testShadowAndSkeleton() {
    section('3. ShadowSkeleton + SkeletonMelody（中间产物验证）');

    const sections = buildMockSections();

    PRNGManager.setSeed(42);
    const shadow = generateShadowSkeleton(sections, [4, 4]);
    const anchors = generateSkeletonMelody(shadow, Tonality.Major);

    console.log(`\n  生成的影子骨架槽位数：${shadow.length}（预期 16 = 8+8 小节）`);
    console.log(`  anchor 数：${anchors.length}\n`);

    console.log('  slot │ section │ func │ sugRoot │ startBeat │ strong │ anchor');
    console.log('  ─────┼─────────┼──────┼─────────┼───────────┼────────┼───────');
    for (let i = 0; i < shadow.length; i++) {
        const s = shadow[i];
        const sec = sections.find(sec => s.startBeat >= sec.startBeat && s.startBeat < sec.endBeat);
        const secName = sec?.name.padEnd(7) ?? '???    ';
        console.log(
            `  ${String(i).padStart(4)} │ ${secName} │  ${FN[s.function]}   │ ${String(s.suggestedRootPc).padStart(7)} │ ${String(s.startBeat).padStart(9)} │ ${(s.isStrong ? 'Y' : ' ').padStart(6)} │ ${pcName(anchors[i]).padStart(6)}`,
        );
    }

    // 验证 anchor 全部在大调 diatonic 内
    const majorScale = new Set([0, 2, 4, 5, 7, 9, 11]);
    let outOfScale = 0;
    for (const a of anchors) {
        if (!majorScale.has(a)) outOfScale++;
    }
    console.log(`\n  Diatonic 验证：${anchors.length - outOfScale}/${anchors.length} 在调内 ${outOfScale === 0 ? 'OK' : 'FAIL'}`);
}

// ============================================================
// 4. HarmonyPipeline 端到端
// ============================================================

function testEndToEnd() {
    section('4. HarmonyPipeline 端到端（Verse + Chorus）');

    const sections = buildMockSections();

    PRNGManager.setSeed(42);
    const debug = generateHarmonyViaPipelineWithDebug(sections, Tonality.Major, [4, 4]);

    console.log(`\n  最终和弦数：${debug.chords.length}（合并后，原始槽位 ${debug.shadow.length}）\n`);
    console.log('  i  │ startBeat~endBeat │ numeral │ root │ quality');
    console.log('  ───┼───────────────────┼─────────┼──────┼─────────');
    for (let i = 0; i < debug.chords.length; i++) {
        const c = debug.chords[i];
        console.log(
            `  ${String(i).padStart(2)} │ ${String(c.startBeat).padStart(7)}~${String(c.endBeat).padEnd(8)} │ ${c.numeral.padEnd(7)} │ ${String(c.root).padStart(4)} │ ${c.quality}`,
        );
    }

    // 段落分解
    subsection('按段落组合可视化');
    for (const sec of sections) {
        const sectionChords = debug.chords.filter(c => c.startBeat >= sec.startBeat && c.startBeat < sec.endBeat);
        const seq = sectionChords.map(c => c.numeral).join(' → ');
        console.log(`  [${sec.name}]: ${seq}`);
    }
}

// ============================================================
// 5. 决定论验证
// ============================================================

function testDeterminism() {
    section('5. 决定论验证（同 seed × 3 trials）');

    const sections = buildMockSections();

    for (let trial = 0; trial < 3; trial++) {
        PRNGManager.setSeed(2024);
        const chords = generateHarmonyViaPipeline(sections, Tonality.Major, [4, 4]);
        const seq = chords.map(c => c.numeral).join(' → ');
        console.log(`  trial ${trial + 1}: ${chords.length} chords | ${seq}`);
    }

    subsection('不同 seed 的分岔');
    for (const seed of [1, 2, 3, 12345]) {
        PRNGManager.setSeed(seed);
        const chords = generateHarmonyViaPipeline(sections, Tonality.Major, [4, 4]);
        const seq = chords.map(c => c.numeral).slice(0, 10).join(' → ');
        console.log(`  seed=${String(seed).padStart(5)}: ${seq}${chords.length > 10 ? ' …' : ''}`);
    }
}

// ============================================================
// 6. parseRomanNumeral 兼容性烟雾测试
// ============================================================

function testParseCompat() {
    section('6. parseRomanNumeral 兼容性（确保 ToplineEngine/Reharmonize 能消费）');

    const sections = buildMockSections();
    PRNGManager.setSeed(42);
    const chords = generateHarmonyViaPipeline(sections, Tonality.Major, [4, 4]);

    let passed = 0, failed = 0;
    for (const c of chords) {
        const parsed = HarmonyCore.parseRomanNumeral(c.numeral, Tonality.Major);
        const rootOk = parsed.root === c.root;
        if (rootOk) passed++; else failed++;
        if (!rootOk) {
            console.log(`  [FAIL] numeral="${c.numeral}" stored root=${c.root} parsed root=${parsed.root}`);
        }
    }
    console.log(`  共 ${chords.length} 个和弦，root 解析一致 ${passed}/${chords.length} ${failed === 0 ? 'OK' : 'FAIL'}`);
}

// ============================================================
// 入口
// ============================================================

function main() {
    console.log('\n🎵 PR #2 — HarmonyPipeline Validation\n');
    testNumeral();
    testNumeralRoundTrip();
    testShadowAndSkeleton();
    testEndToEnd();
    testDeterminism();
    testParseCompat();
    console.log('\n✅ 全部测试完成\n');
}

main();
