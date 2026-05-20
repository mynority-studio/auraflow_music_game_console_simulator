/**
 * Phase 4 — AbsoluteTransposer + MidiConverter 静态验证
 *
 * 不启动 AudioContext / 不真正播放，仅验算法正确性。
 * 真正的听感验证靠 `npm run dev` 启 web 端实弹试听。
 *
 * 验证矩阵：
 *
 *   Test 1 — AbsoluteTransposer
 *     a. keyOffset=0 → pitch 不变
 *     b. keyOffset=3 (Eb) → 所有 pitch +3
 *     c. keyOffset=9 (A)  → 所有 pitch +9
 *     d. 输入 RELATIVE 范围 [36, 96] → 输出 ABSOLUTE 仍在 [0, 127]
 *     e. 三轨映射正确：melody→melody / accompaniment→pianoRH / bass→pianoLH
 *     f. 非破坏性：原 track.melody 数组不变
 *     g. keyOffset 越界（如 12）抛 AbsoluteTransposerError
 *
 *   Test 2 — MidiConverter
 *     a. ticks 严格升序
 *     b. 同 tick 时 priority 顺序：programChange → cc → noteOff → noteOn
 *     c. tick=0 处每个非空轨都有 programChange + CC7 + CC10 + CC91
 *     d. 通道映射：melody=1 / pianoRH=4 / pianoLH=5
 *     e. tick 转换：beat=2.5 → tick=1200（2.5×480）
 *     f. velocity 整数化 + clamp [1, 127]
 *     g. pitch clamp [0, 127]
 *     h. 退化音符（duration=0 / startTick==endTick）被丢弃
 *     i. 完整端到端：runPipeline → AbsoluteTransposer → MidiConverter → 一致性 cross-check
 *
 * 运行：npx tsx scripts/test-phase4.ts
 */

import { PRNGManager } from '../src/core/utils/PRNG';
import { runPipeline } from '../src/core/generation/pipeline';
import { AbsoluteTransposer, AbsoluteTransposerError } from '../src/core/generation/pipeline/AbsoluteTransposer';
import {
    MidiConverter,
    CHANNEL_MELODY, CHANNEL_PIANO_RH, CHANNEL_PIANO_LH,
} from '../src/core/audio/MidiConverter';
import { StyleId } from '../src/core/generation/config/StyleFlags';
import {
    ArrangedTrack, GeneratedTrack, NoteData, MusicContext, Tonality,
} from '../src/core/generation/types';
import type { MidiEvent } from '../src/core/audio/MidiScheduler';

const SEED = 12345;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail?: string): void {
    if (cond) {
        passed++;
        console.log(`  ✓ ${label}`);
    } else {
        failed++;
        const msg = detail !== undefined ? `${label}  — ${detail}` : label;
        failures.push(msg);
        console.log(`  ✗ ${label}${detail !== undefined ? `  — ${detail}` : ''}`);
    }
}

function header(title: string): void {
    console.log(`\n${'═'.repeat(82)}`);
    console.log(`  ${title}`);
    console.log(`${'═'.repeat(82)}`);
}

// ============================================================
// Test 1 — AbsoluteTransposer
// ============================================================

function makeMockTrack(keyOffset: number): GeneratedTrack {
    const melody: NoteData[] = [
        { pitch: 72, onset: 0, duration: 0.5, velocity: 0.8 },
        { pitch: 76, onset: 0.5, duration: 0.5, velocity: 0.7 },
    ];
    const accompaniment: NoteData[] = [
        { pitch: 60, onset: 0, duration: 1.0, velocity: 0.65 },
        { pitch: 64, onset: 0, duration: 1.0, velocity: 0.65 },
        { pitch: 67, onset: 0, duration: 1.0, velocity: 0.65 },
    ];
    const bass: NoteData[] = [
        { pitch: 36, onset: 0, duration: 2.0, velocity: 0.9 },
    ];
    return {
        chords: [],
        melody,
        accompaniment,
        bass,
        bpm: 120,
        key: 'C',
        keyOffset,
        tonality: Tonality.Major,
        timeSignature: [4, 4],
        sections: [],
        blockIndex: 0,
        absoluteStartBeat: 0,
        hasIntro: false,
    };
}

const mockContext: MusicContext = {
    keyOffset: 0,
    tonality: Tonality.Major,
    bpm: 120,
    timeSignature: [4, 4],
    grooveDNA: [],
};

function testAbsoluteTransposer(): void {
    header('Test 1 — AbsoluteTransposer (RELATIVE → ABSOLUTE, K-2)');

    // 1a: keyOffset=0 → pitch 不变
    const track0 = makeMockTrack(0);
    const a0 = AbsoluteTransposer.arrange(track0, StyleId.ModernPop, mockContext);
    check('keyOffset=0: melody pitch 不变', a0.melody[0].pitch === 72 && a0.melody[1].pitch === 76);
    check('keyOffset=0: pianoRH pitch 不变', a0.pianoRH[0].pitch === 60);
    check('keyOffset=0: pianoLH pitch 不变', a0.pianoLH[0].pitch === 36);

    // 1b: keyOffset=3 (Eb) → 所有 pitch +3
    const track3 = makeMockTrack(3);
    const a3 = AbsoluteTransposer.arrange(track3, StyleId.ModernPop, mockContext);
    check('keyOffset=3: melody[0].pitch = 72+3 = 75', a3.melody[0].pitch === 75);
    check('keyOffset=3: pianoRH[0].pitch = 60+3 = 63', a3.pianoRH[0].pitch === 63);
    check('keyOffset=3: pianoLH[0].pitch = 36+3 = 39', a3.pianoLH[0].pitch === 39);

    // 1c: keyOffset=9 (A) → +9
    const track9 = makeMockTrack(9);
    const a9 = AbsoluteTransposer.arrange(track9, StyleId.ModernPop, mockContext);
    check('keyOffset=9: melody[1].pitch = 76+9 = 85', a9.melody[1].pitch === 85);
    check('keyOffset=9: pianoLH[0].pitch = 36+9 = 45', a9.pianoLH[0].pitch === 45);

    // 1d: ABSOLUTE 仍在 [0, 127]
    let allInRange = true;
    for (const arr of [a9.melody, a9.pianoRH, a9.pianoLH]) {
        for (const n of arr) {
            if (n.pitch < 0 || n.pitch > 127) { allInRange = false; break; }
        }
        if (!allInRange) break;
    }
    check('keyOffset=9: 全部输出 pitch ∈ [0, 127]', allInRange);

    // 1e: 三轨映射正确
    check('映射: melody → arranged.melody', a3.melody.length === track3.melody.length);
    check('映射: accompaniment → arranged.pianoRH', a3.pianoRH.length === track3.accompaniment!.length);
    check('映射: bass → arranged.pianoLH', a3.pianoLH.length === track3.bass!.length);

    // 1f: 非破坏性
    check('非破坏: 原 track.melody[0].pitch 仍为 72', track3.melody[0].pitch === 72);
    check('非破坏: 原 track.accompaniment[0].pitch 仍为 60', track3.accompaniment![0].pitch === 60);

    // 1g: keyOffset 越界 → 抛异常
    let threwOOB = false;
    try {
        const bad = makeMockTrack(12);
        AbsoluteTransposer.arrange(bad, StyleId.ModernPop, mockContext);
    } catch (e) {
        threwOOB = e instanceof AbsoluteTransposerError;
    }
    check('keyOffset=12 (越界) 抛 AbsoluteTransposerError', threwOOB);

    // 1h: 其他字段透传
    check('透传: bpm', a3.bpm === 120);
    check('透传: timeSignature', a3.timeSignature?.[0] === 4 && a3.timeSignature?.[1] === 4);
    check('透传: styleId', a3.styleId === StyleId.ModernPop);
}

// ============================================================
// Test 2 — MidiConverter
// ============================================================

function makeMockArranged(keyOffset: number): ArrangedTrack {
    const track = makeMockTrack(keyOffset);
    return AbsoluteTransposer.arrange(track, StyleId.ModernPop, mockContext);
}

function testMidiConverter(): void {
    header('Test 2 — MidiConverter (ArrangedTrack → MidiEvent[])');

    const arranged = makeMockArranged(0);
    const events = MidiConverter.convert(arranged);

    console.log(`\n  Total events: ${events.length}`);
    console.log('  First 12 events:');
    for (let i = 0; i < Math.min(12, events.length); i++) {
        const e = events[i];
        console.log(
            `     [${String(i).padStart(2)}] tick=${String(e.ticks).padStart(5)}  ` +
            `type=${e.type.padEnd(13)} ch=${e.channel}  ` +
            `d1=${String(e.data1).padStart(3)} d2=${String(e.data2).padStart(3)}`,
        );
    }

    // 2a: ticks 严格升序（含同 tick 容差）
    let sortedTicks = true;
    for (let i = 1; i < events.length; i++) {
        if (events[i].ticks < events[i - 1].ticks) { sortedTicks = false; break; }
    }
    check('events ticks 全局升序', sortedTicks);

    // 2b: 同 tick 时 priority 顺序
    const priority = (t: MidiEvent['type']): number => {
        switch (t) {
            case 'programChange': return 0;
            case 'cc':            return 1;
            case 'noteOff':       return 2;
            case 'noteOn':        return 3;
            case 'pitchBend':     return 4;
            case 'visual':        return 5;
            default:              return 6;
        }
    };
    let prioritySorted = true;
    for (let i = 1; i < events.length; i++) {
        if (events[i].ticks === events[i - 1].ticks) {
            if (priority(events[i].type) < priority(events[i - 1].type)) {
                prioritySorted = false; break;
            }
        }
    }
    check('同 tick 时 priority 顺序 (programChange < cc < noteOff < noteOn)', prioritySorted);

    // 2c: tick=0 处每个非空轨都有 programChange + 3 个 CC
    const tickZero = events.filter(e => e.ticks === 0);
    function countAt0(channel: number, type: MidiEvent['type']): number {
        return tickZero.filter(e => e.channel === channel && e.type === type).length;
    }
    function countCcAt0(channel: number, ccNumber: number): number {
        return tickZero.filter(e => e.channel === channel && e.type === 'cc' && e.data1 === ccNumber).length;
    }
    check(`melody (ch${CHANNEL_MELODY}): tick=0 有 programChange`,
        countAt0(CHANNEL_MELODY, 'programChange') === 1);
    check(`melody (ch${CHANNEL_MELODY}): tick=0 有 CC7 (Volume)`, countCcAt0(CHANNEL_MELODY, 7) === 1);
    check(`melody (ch${CHANNEL_MELODY}): tick=0 有 CC10 (Pan)`, countCcAt0(CHANNEL_MELODY, 10) === 1);
    check(`melody (ch${CHANNEL_MELODY}): tick=0 有 CC91 (Reverb)`, countCcAt0(CHANNEL_MELODY, 91) === 1);
    check(`pianoRH (ch${CHANNEL_PIANO_RH}): tick=0 有 programChange`,
        countAt0(CHANNEL_PIANO_RH, 'programChange') === 1);
    check(`pianoLH (ch${CHANNEL_PIANO_LH}): tick=0 有 programChange`,
        countAt0(CHANNEL_PIANO_LH, 'programChange') === 1);

    // CLAUDE.md 混音对齐
    const melVol = tickZero.find(e => e.channel === CHANNEL_MELODY && e.type === 'cc' && e.data1 === 7);
    const rhVol  = tickZero.find(e => e.channel === CHANNEL_PIANO_RH && e.type === 'cc' && e.data1 === 7);
    const lhVol  = tickZero.find(e => e.channel === CHANNEL_PIANO_LH && e.type === 'cc' && e.data1 === 7);
    check('Mix 对齐: melody CC7 = 122', melVol?.data2 === 122);
    check('Mix 对齐: pianoRH CC7 = 102', rhVol?.data2 === 102);
    check('Mix 对齐: pianoLH CC7 = 57', lhVol?.data2 === 57);

    // 2e: tick 转换 — beat=0.5 → tick=240，beat=1.0 → 480
    const noteOnEvents = events.filter(e => e.type === 'noteOn');
    // melody[0]: onset=0 → tick=0; melody[1]: onset=0.5 → tick=240
    const mel0 = noteOnEvents.find(e => e.channel === CHANNEL_MELODY && e.data1 === 72);
    const mel1 = noteOnEvents.find(e => e.channel === CHANNEL_MELODY && e.data1 === 76);
    check('tick: melody[onset=0] → ticks=0', mel0?.ticks === 0);
    check('tick: melody[onset=0.5] → ticks=240', mel1?.ticks === 240);
    // bass: onset=0, duration=2.0 → noteOff at tick=960
    const bassOff = events.find(e =>
        e.channel === CHANNEL_PIANO_LH && e.type === 'noteOff' && e.data1 === 36,
    );
    check('tick: bass[onset=0, dur=2.0] → noteOff ticks=960', bassOff?.ticks === 960);

    // 2f: velocity 整数 + clamp
    let velocityOK = true;
    for (const e of noteOnEvents) {
        if (e.data2 < 1 || e.data2 > 127 || !Number.isInteger(e.data2)) {
            velocityOK = false; break;
        }
    }
    check('velocity ∈ [1, 127] 整数', velocityOK);

    // 2g: pitch ∈ [0, 127] 整数
    let pitchOK = true;
    for (const e of [...noteOnEvents, ...events.filter(e => e.type === 'noteOff')]) {
        if (e.data1 < 0 || e.data1 > 127 || !Number.isInteger(e.data1)) {
            pitchOK = false; break;
        }
    }
    check('pitch ∈ [0, 127] 整数', pitchOK);

    // 2h: 退化音符被丢弃
    const arrangedDegen: ArrangedTrack = {
        bpm: 120, key: 'C', absoluteStartBeat: 0, timeSignature: [4, 4],
        melody: [
            { pitch: 60, onset: 0, duration: 0, velocity: 0.8 },     // duration=0
            { pitch: 60, onset: 0, duration: -1, velocity: 0.8 },    // duration<0
            { pitch: 60, onset: 0, duration: 0.0001, velocity: 0.8 }, // round → tick == tick
        ],
        pianoRH: [], pianoLH: [],
    };
    const degenEvents = MidiConverter.convert(arrangedDegen);
    const degenNoteOns = degenEvents.filter(e => e.type === 'noteOn');
    check('退化音符 (dur≤0, dur≈0) 被过滤', degenNoteOns.length === 0,
        `noteOns=${degenNoteOns.length}`);

    // 2i: 空轨不污染输出
    const arrangedEmpty: ArrangedTrack = {
        bpm: 120, key: 'C', absoluteStartBeat: 0,
        melody: [], pianoRH: [], pianoLH: [],
    };
    const emptyEvents = MidiConverter.convert(arrangedEmpty);
    check('空轨 → 0 个 MidiEvent', emptyEvents.length === 0);
}

// ============================================================
// Test 3 — 端到端：runPipeline → AbsoluteTransposer → MidiConverter
// ============================================================

function testEndToEnd(): void {
    header('Test 3 — E2E: runPipeline → AbsoluteTransposer → MidiConverter');

    for (const styleId of [StyleId.ModernPop, StyleId.ChillJazz, StyleId.NeoSoul]) {
        const name = StyleId[styleId];
        PRNGManager.setSeed(SEED);
        const { track, context } = runPipeline({ forcedStyleId: styleId });

        // RELATIVE pitch 范围（Phase 3 测试已验，这里只做 sanity）
        const melodyRel = track.melody;
        const accompRel = track.accompaniment ?? [];
        const bassRel = track.bass ?? [];

        // AbsoluteTransposer 转 ABSOLUTE
        const arranged = AbsoluteTransposer.arrange(track, styleId, context);

        // 一致性：absolute = relative + keyOffset
        const kOff = track.keyOffset;
        let pitchMathOK = true;
        for (let i = 0; i < melodyRel.length; i++) {
            if (arranged.melody[i].pitch !== Math.min(127, Math.max(0, melodyRel[i].pitch + kOff))) {
                pitchMathOK = false; break;
            }
        }
        for (let i = 0; i < accompRel.length && pitchMathOK; i++) {
            if (arranged.pianoRH[i].pitch !== Math.min(127, Math.max(0, accompRel[i].pitch + kOff))) {
                pitchMathOK = false; break;
            }
        }
        for (let i = 0; i < bassRel.length && pitchMathOK; i++) {
            if (arranged.pianoLH[i].pitch !== Math.min(127, Math.max(0, bassRel[i].pitch + kOff))) {
                pitchMathOK = false; break;
            }
        }
        check(`${name}: absolute = relative + keyOffset(${kOff}) 全轨成立`, pitchMathOK);

        // MidiConverter 转事件流
        const events = MidiConverter.convert(arranged);
        check(`${name}: MidiConverter 输出非空`, events.length > 0, `events=${events.length}`);

        // 三轨各有 noteOn
        const noteOnsByChannel = (ch: number) =>
            events.filter(e => e.type === 'noteOn' && e.channel === ch).length;
        const melOn = noteOnsByChannel(CHANNEL_MELODY);
        const rhOn  = noteOnsByChannel(CHANNEL_PIANO_RH);
        const lhOn  = noteOnsByChannel(CHANNEL_PIANO_LH);
        check(`${name}: ch1 (melody) noteOn 数 = ${melOn}`, melOn > 0);
        check(`${name}: ch4 (pianoRH) noteOn 数 = ${rhOn}`, rhOn > 0);
        check(`${name}: ch5 (pianoLH) noteOn 数 = ${lhOn}`, lhOn > 0);

        // noteOn / noteOff 配对
        const offCounts = {
            ch1: events.filter(e => e.type === 'noteOff' && e.channel === CHANNEL_MELODY).length,
            ch4: events.filter(e => e.type === 'noteOff' && e.channel === CHANNEL_PIANO_RH).length,
            ch5: events.filter(e => e.type === 'noteOff' && e.channel === CHANNEL_PIANO_LH).length,
        };
        check(`${name}: ch1 noteOn(${melOn}) === noteOff(${offCounts.ch1})`, melOn === offCounts.ch1);
        check(`${name}: ch4 noteOn(${rhOn}) === noteOff(${offCounts.ch4})`, rhOn === offCounts.ch4);
        check(`${name}: ch5 noteOn(${lhOn}) === noteOff(${offCounts.ch5})`, lhOn === offCounts.ch5);

        // 同 seed 两次跑事件字节一致
        PRNGManager.setSeed(SEED);
        const { track: t2, context: c2 } = runPipeline({ forcedStyleId: styleId });
        const events2 = MidiConverter.convert(AbsoluteTransposer.arrange(t2, styleId, c2));
        let bytesEqual = events.length === events2.length;
        if (bytesEqual) {
            for (let i = 0; i < events.length; i++) {
                const a = events[i], b = events2[i];
                if (a.ticks !== b.ticks || a.type !== b.type || a.channel !== b.channel ||
                    a.data1 !== b.data1 || a.data2 !== b.data2) {
                    bytesEqual = false; break;
                }
            }
        }
        check(`${name}: 同 seed 两次跑全管线 → MidiEvent 字节一致`, bytesEqual);
    }
}

// ============================================================
// Main
// ============================================================

function main(): void {
    console.log(`\n${'■'.repeat(82)}`);
    console.log(`  Phase 4 — AbsoluteTransposer + MidiConverter Verification   seed=${SEED}`);
    console.log(`${'■'.repeat(82)}`);

    testAbsoluteTransposer();
    testMidiConverter();
    testEndToEnd();

    console.log(`\n${'═'.repeat(82)}`);
    console.log(`  SUMMARY:  ${passed} passed,  ${failed} failed   (total ${passed + failed})`);
    console.log(`${'═'.repeat(82)}`);
    if (failed > 0) {
        console.log('\n  Failures:');
        for (const f of failures) console.log(`    - ${f}`);
        process.exit(1);
    } else {
        console.log('\n  ✓ All Phase 4 algorithm checks passed.');
        console.log('  → Next: 跑 `npm run dev` 实弹试听三风格三轨发声效果');
    }
}

main();
