/**
 * Golden Seed Recorder — 黄金种子录制
 *
 * 跑一批固定 seed，把每个 seed 下的 PRNG 快照 + Track 元数据 +
 * Arranged 计数 + MidiEvent 摘要写到 scripts/golden-seed-output.json，
 * 供 json2c.py 翻译成 C 端可消费的头文件（ESP32 移植对账参照物）。
 *
 * 用法：npm run golden-seed
 *       → scripts/golden-seed-output.json
 *       后续：python3 scripts/json2c.py → scripts/golden_seed_data.h
 */

import { createHash } from 'crypto';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { PRNGManager } from '../src/core/utils/PRNG';
import { runPipeline } from '../src/core/generation/pipeline';
import { AbsoluteTransposer } from '../src/core/generation/pipeline/AbsoluteTransposer';
import { MidiConverter } from '../src/core/audio/MidiConverter';
import { StyleId, StyleIdName } from '../src/core/generation/config/StyleFlags';
import type { MidiEvent } from '../src/core/audio/MidiScheduler';

const PPQ = 480;
const SEEDS = [1, 7, 42, 12345, 99999, 314159, 271828];
const STYLES: StyleId[] = [StyleId.ModernPop, StyleId.ChillJazz, StyleId.NeoSoul];

function eventSha256(events: MidiEvent[]): string {
    const h = createHash('sha256');
    for (const e of events) {
        h.update(`${e.ticks}|${e.type}|${e.channel}|${e.data1}|${e.data2}\n`);
    }
    return h.digest('hex');
}

function summarizeEvents(events: MidiEvent[]) {
    let noteOn = 0;
    let noteOff = 0;
    let cc = 0;
    for (const e of events) {
        if (e.type === 'noteOn') noteOn++;
        else if (e.type === 'noteOff') noteOff++;
        else if (e.type === 'cc') cc++;
    }
    return {
        totalCount: events.length,
        noteOnCount: noteOn,
        noteOffCount: noteOff,
        ccCount: cc,
        sha256: eventSha256(events),
        first10Events: events.slice(0, 10).map(e => ({
            ticks: e.ticks,
            type: e.type,
            channel: e.channel,
            data1: e.data1,
            data2: e.data2,
        })),
    };
}

function runOneSeed(seed: number) {
    PRNGManager.setSeed(seed);
    const stateA = PRNGManager.getState();

    // 主管线（内部消耗 PRNG: Stage1 选风格 → Stage2 基本参数 → Stage3 和声 → Stage5 织体）
    // stateB 取自 Stage 1 之后（与风格抽样对齐）— 复用 runPipeline 内 recordSnapshot('B') 之后
    // 自然推进出来的 state：Stage 1 消费 1 次 PRNG 后即定型 styleId，再读取 state 即得 stateB。
    const { track, context } = runPipeline({});
    // stateC: pipeline 完结（覆盖到 Stage 5 末尾）
    const stateC = PRNGManager.getState();

    // 选风格 ID 透传（runPipeline 内已固定，无独立 getter — 用 track.bpm/styleConfig 推断不可靠）
    // 直接走 context.style.id 拿（StyleConfig 暴露 id）
    const selectedStyleId = (context.style as any)?.id ?? -1;

    // stateB: runPipeline 入口的 recordSnapshot('B') 保留了 setSeed 后的初值（与 stateA 等同），
    // 真正风格抽样后的 state 没有显式 snapshot 点 — 用 recordSnapshot('C') 替代作为
    // "Stage1/2 完成后的状态" 锚点。
    const snapshots = PRNGManager.getAllSnapshots();
    const stateB = snapshots.B ?? stateA;

    // 编排：AbsoluteTransposer.arrange 是无 PRNG 纯转换（D-1）
    const arranged = AbsoluteTransposer.arrange(track, selectedStyleId, context);
    const stateD = PRNGManager.getState();  // arrange 不消费 PRNG，应等于 stateC

    // MidiConverter 同样零 PRNG（D-5）
    const events = MidiConverter.convert(arranged);

    return {
        seed,
        stateA,
        selectedStyleId,
        stateB,
        stateC,
        stateD,
        track: {
            bpm: track.bpm,
            keyOffset: track.keyOffset,
            tonality: track.tonality,
            timeSignature: track.timeSignature,
            sectionCount: track.sections.length,
            melodyNoteCount: track.melody?.length ?? 0,
            chordCount: track.chords?.length ?? 0,
        },
        arranged: {
            melodyNoteCount: arranged.melody?.length ?? 0,
            pianoLHNoteCount: arranged.pianoLH?.length ?? 0,
            pianoRHNoteCount: arranged.pianoRH?.length ?? 0,
            drumsNoteCount: arranged.drums?.length ?? 0,
            secondaryMelodyNoteCount: arranged.secondaryMelody?.length ?? 0,
            counterMelodyNoteCount: arranged.counterMelody?.length ?? 0,
            vocalNoteCount: arranged.vocal?.length ?? 0,
        },
        midiEvents: summarizeEvents(events),
    };
}

function main() {
    const generatedAt = new Date().toISOString();
    const availableStyles = STYLES.map(id => ({ id, name: StyleIdName[id] }));

    const seeds = SEEDS.map(s => {
        const out = runOneSeed(s);
        console.log(`  seed=${s.toString().padStart(7)}  style=${out.selectedStyleId}  ` +
            `melody=${out.track.melodyNoteCount}  midi=${out.midiEvents.totalCount}  ` +
            `sha=${out.midiEvents.sha256.slice(0, 12)}…`);
        return out;
    });

    const data = {
        generatedAt,
        prngAlgorithm: 'LCG: state = (state * 1664525 + 1013904223) mod 2^32',
        ppq: PPQ,
        styleCount: STYLES.length,
        availableStyles,
        seeds,
    };

    const outPath = resolve(__dirname, 'golden-seed-output.json');
    writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`\nWrote ${seeds.length} seeds → ${outPath}`);
}

main();
