/**
 * Phase 2.B — HarmonyCore 脱机听感/视觉验收
 *
 * seed=12345 固定，三风格各跑 4 段 × 4 和弦 = 16 chord，打印：
 *   - 罗马数字 numeral + (root, quality)
 *   - voicing：4 voices 升序，按相对空间 MIDI 转 pitch class 名（C 主音参考）
 *
 * 同步做 sanity check：
 *   - voicings 必须升序（防 voice crossing 越线 bug）
 *   - 每个 voice 在 voiceRange 内
 *   - chord/voicing 数量匹配
 *
 * 运行：npx tsx scripts/test-harmony-core.ts
 */

import { PRNGManager } from '../src/core/utils/PRNG';
import {
    HarmonyCore, HarmonyCoreInput, HarmonyResult,
    VoiceLeadingConfig,
} from '../src/core/generation/pipeline/HarmonyCore';
import { HarmonyRulesConfig } from '../src/core/generation/pipeline/MacroProgressionEngine';
import {
    Tonality, SectionType, SectionMetadata,
    ChordQuality, ChordQualityName,
} from '../src/core/generation/types';

import {
    MODERN_POP_HARMONY_RULES,
    MODERN_POP_VOICE_LEADING,
} from '../src/core/generation/config/styles/ModernPop';
import {
    NEO_SOUL_HARMONY_RULES,
    NEO_SOUL_VOICE_LEADING,
} from '../src/core/generation/config/styles/NeoSoul';
import {
    CHILL_JAZZ_HARMONY_RULES,
    CHILL_JAZZ_VOICE_LEADING,
} from '../src/core/generation/config/styles/ChillJazz';

const SEED = 12345;
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function pcName(pitch: number): string {
    const pc = ((pitch % 12) + 12) % 12;
    const octave = Math.floor(pitch / 12) - 1;
    return `${PITCH_NAMES[pc]}${octave}`;
}

function buildSections(): SectionMetadata[] {
    return [
        { name: 'Intro_1',  sectionType: SectionType.Intro,  startBeat: 0,  endBeat: 16, energyLevel: 3 },
        { name: 'Verse_1',  sectionType: SectionType.Verse,  startBeat: 16, endBeat: 32, energyLevel: 4 },
        { name: 'Chorus_1', sectionType: SectionType.Chorus, startBeat: 32, endBeat: 48, energyLevel: 7 },
        { name: 'Outro_1',  sectionType: SectionType.Outro,  startBeat: 48, endBeat: 64, energyLevel: 5 },
    ];
}

interface SanityReport {
    style: string;
    chordCount: number;
    voicingCount: number;
    ascendingViolations: number;
    rangeViolations: number;
    qualityCounts: Record<string, number>;
    tendencyToneFollowThrough: { detected: number; resolved: number };
    /** 每和弦 unique PC 数的统计：bucket[i] = 出现 i 个 unique PC 的和弦数 */
    uniquePcBuckets: number[];
    /** 4-voice 和弦中 unique PC < 3 的"漏风的壳"数 */
    sparseVoicingCount: number;
    /** Bass voice 是否成功锚定根音的次数（root PC 命中） */
    bassRootHits: number;
}

function runStyle(
    name: string,
    rules: HarmonyRulesConfig,
    voiceLeading: VoiceLeadingConfig,
): SanityReport {
    PRNGManager.setSeed(SEED);
    PRNGManager.recordSnapshot('B');

    const input: HarmonyCoreInput = {
        sections: buildSections(),
        tonality: Tonality.Major,
        harmonyRules: rules,
        voiceLeadingConfig: voiceLeading,
        chordsPerSection: 4,
    };
    const result: HarmonyResult = HarmonyCore.generate(input);

    // Phase 1a:result.voicings 是 VoicedPitch[][];本脚本所有 numeric 校验(升序 / range /
    // PC 抽取等)在 pitch-only 视图下工作,转换零成本。
    const voicings: number[][] = result.voicings.map(v => v.map(p => p.pitch));

    // 标题
    console.log(`\n${'═'.repeat(86)}`);
    console.log(`  ${name}   seed=${SEED}   ${result.chords.length} chords / ${voiceLeading.voiceCount} voices`);
    console.log(`${'═'.repeat(86)}`);
    console.log('  idx  beat       numeral       quality           voicing (relative space)');
    console.log(`  ${'-'.repeat(82)}`);

    // 输出每和弦
    for (let i = 0; i < result.chords.length; i++) {
        const c = result.chords[i];
        const v = voicings[i];
        const voicingStr = v.length > 0
            ? v.map((p) => `${pcName(p).padEnd(4)}`).join(' ')
            : '(empty)';
        const beatStr = `${c.startBeat.toFixed(0)}-${c.endBeat.toFixed(0)}`.padEnd(8);
        const numeralStr = c.numeral.padEnd(12);
        const qualityStr = (ChordQualityName[c.quality] ?? '?').padEnd(16);
        console.log(`  [${i.toString().padStart(2)}] ${beatStr}  ${numeralStr} ${qualityStr}  ${voicingStr}`);
    }

    // Sanity check
    const report: SanityReport = {
        style: name,
        chordCount: result.chords.length,
        voicingCount: voicings.length,
        ascendingViolations: 0,
        rangeViolations: 0,
        qualityCounts: {},
        tendencyToneFollowThrough: { detected: 0, resolved: 0 },
        uniquePcBuckets: [0, 0, 0, 0, 0],  // bucket[0..4] — unique PC count distribution
        sparseVoicingCount: 0,
        bassRootHits: 0,
    };

    for (let i = 0; i < voicings.length; i++) {
        const v = voicings[i];
        for (let j = 1; j < v.length; j++) {
            if (v[j] <= v[j - 1]) report.ascendingViolations++;
        }
        for (let j = 0; j < v.length; j++) {
            if (v[j] < voiceLeading.voiceRangeLo || v[j] > voiceLeading.voiceRangeHi) {
                report.rangeViolations++;
            }
        }
        // 统计 unique PC
        const pcSeen = new Set<number>();
        for (let j = 0; j < v.length; j++) pcSeen.add(((v[j] % 12) + 12) % 12);
        const uniqueCount = pcSeen.size;
        if (uniqueCount < report.uniquePcBuckets.length) {
            report.uniquePcBuckets[uniqueCount]++;
        }
        if (v.length === 4 && uniqueCount < 3) report.sparseVoicingCount++;

        // Bass voice root 锚定校验：voicing[0] 的 PC === chord.root（mod 12）
        if (v.length > 0) {
            const bassPc = ((v[0] % 12) + 12) % 12;
            const expectedRootPc = ((result.chords[i].root % 12) + 12) % 12;
            if (bassPc === expectedRootPc) report.bassRootHits++;
        }
    }

    for (let i = 0; i < result.chords.length; i++) {
        const q = result.chords[i].quality;
        const qn = ChordQualityName[q] ?? '?';
        report.qualityCounts[qn] = (report.qualityCounts[qn] ?? 0) + 1;
    }

    // 倾向音解决跟踪：V7 / Dim 后是否真的解决
    for (let i = 0; i < result.chords.length - 1; i++) {
        const cur = result.chords[i];
        if (cur.quality === ChordQuality.Dominant7 ||
            cur.quality === ChordQuality.Dominant9 ||
            cur.quality === ChordQuality.Dominant13) {
            report.tendencyToneFollowThrough.detected++;
            const next = result.chords[i + 1];
            // 解决目标：Dom7 root + 5 = next root（或 next root + 5 = cur root + 5 也可能）
            // 简化校验：next.root === (cur.root + 5) % 12（正解决）或差异 % 12 === 1（半音替代解决）
            const expectedResolveRoot = (cur.root + 5) % 12;
            const altResolveRoot = (cur.root + 1) % 12;  // bII-I 之类
            if (next.root === expectedResolveRoot || next.root === altResolveRoot) {
                report.tendencyToneFollowThrough.resolved++;
            }
        }
    }

    return report;
}

function printReport(r: SanityReport): void {
    console.log(`\n  ── sanity ── ${r.style}`);
    console.log(`     chords=${r.chordCount}  voicings=${r.voicingCount}`);
    console.log(`     ascending violations: ${r.ascendingViolations} (must be 0)`);
    console.log(`     range violations:     ${r.rangeViolations} (must be 0)`);
    console.log(`     quality histogram:    ${JSON.stringify(r.qualityCounts)}`);
    console.log(`     V7 detected/resolved: ${r.tendencyToneFollowThrough.detected} → ${r.tendencyToneFollowThrough.resolved}`);
    console.log(`     unique PC buckets:    1-PC=${r.uniquePcBuckets[1]}  2-PC=${r.uniquePcBuckets[2]}  3-PC=${r.uniquePcBuckets[3]}  4-PC=${r.uniquePcBuckets[4]}`);
    console.log(`     sparse 4-voice (<3 unique PCs): ${r.sparseVoicingCount}  ← Phase 2.5 目标 = 0`);
    console.log(`     bass = root anchor: ${r.bassRootHits}/${r.chordCount}  ← 期望接近 100%`);
}

function main(): void {
    const reports: SanityReport[] = [];
    reports.push(runStyle(
        'Modern Pop',
        MODERN_POP_HARMONY_RULES,
        MODERN_POP_VOICE_LEADING,
    ));
    reports.push(runStyle(
        'Neo-Soul',
        NEO_SOUL_HARMONY_RULES,
        NEO_SOUL_VOICE_LEADING,
    ));
    reports.push(runStyle(
        'Chill Jazz',
        CHILL_JAZZ_HARMONY_RULES,
        CHILL_JAZZ_VOICE_LEADING,
    ));

    console.log(`\n${'═'.repeat(86)}`);
    console.log('  SANITY SUMMARY');
    console.log(`${'═'.repeat(86)}`);
    let totalAscViol = 0;
    let totalRangeViol = 0;
    for (const r of reports) {
        printReport(r);
        totalAscViol += r.ascendingViolations;
        totalRangeViol += r.rangeViolations;
    }
    console.log(`\n  TOTAL ascending violations: ${totalAscViol}`);
    console.log(`  TOTAL range violations:     ${totalRangeViol}`);
    if (totalAscViol === 0 && totalRangeViol === 0) {
        console.log('\n  ✓ Voice leading 几何约束全部通过（升序 + 音域）');
    } else {
        console.log('\n  ✗ 约束违反 — 需要排查 HarmonyCore.computeChordVoicing');
        process.exit(1);
    }
}

main();
