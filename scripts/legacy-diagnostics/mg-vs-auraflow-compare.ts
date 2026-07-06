/**
 * mg 上游 vs auraflow harmony-engine 算法一致性对账脚本
 *
 * 用法:
 *   npx tsx scripts/mg-vs-auraflow-compare.ts
 *
 * 设计:
 *   - 完全绕过 runPipeline。直接 import mg 上游 ~/vibe_coding/melodygenerative
 *     的 Engine,跟 auraflow harmony-engine/musicEngine.ts 的 Engine 用同一份
 *     GenerationConfig 跑,逐项对比 chords[] + timeline.events[]。
 *   - 排除外部干扰因素(weather/conductor/reconciler/mute/混音 等),
 *     只回答一个问题:"算法层 mg 上游 vs auraflow-移植版,同 seed 是否 bit-exact?"
 *
 * 测试组合:3 seed × 3 style = 9 cases。每个 case 内还测 totalBars 16 / 24
 * 两种(覆盖 mg recommendedBars=16 路径 + auraflow barsOverride 扩展路径)。
 */

import {
    Engine as MgEngine,
    Random as MgRandom,
    type GenerationConfig as MgGenerationConfig,
    type ChordDef as MgChordDef,
    type NoteEvent as MgNoteEvent,
} from '../../melodygenerative/src/lib/musicEngine';

import {
    Engine as AfEngine,
    Random as AfRandom,
    type GenerationConfig as AfGenerationConfig,
    type ChordDef as AfChordDef,
    type NoteEvent as AfNoteEvent,
} from '../src/core/generation/harmony-engine/musicEngine';

import type { StyleName } from '../src/core/generation/harmony-engine/styleDictionary';

// ============================================================
// 测试矩阵
// ============================================================

const SEEDS = ['42', '7777', 'experiment_alpha'];
const STYLES: StyleName[] = ['POP', 'JAZZ', 'RNB'];
const BARS_OPTIONS = [16, 24];  // 16 = mg recommendedBars (无 barsOverride 路径); 24 = barsOverride 路径

// ============================================================
// 签名 (signature) — 紧凑一行表示一个对象
// ============================================================

function chordSig(c: MgChordDef | AfChordDef): string {
    const notes = (c.notesMidi ?? []).join(',');
    return [
        c.roman ?? '?',
        c.type ?? '?',
        c.root ?? '?',
        c.bass ?? '?',
        c.bassMidi ?? '?',
        `[${notes}]`,
        `d=${c.duration}`,
        `t=${c.tensionState ?? '?'}`,
        `f=${c.effectiveFunc ?? '?'}`,
        c.borrowedFrom ? `borrow=${c.borrowedFrom}` : '',
    ].filter(Boolean).join('|');
}

function eventSig(e: MgNoteEvent | AfNoteEvent): string {
    return [
        e.part,
        `n=${e.noteNumber}`,
        `t=${e.time.toFixed(4)}`,
        `d=${e.duration.toFixed(4)}`,
        `v=${e.velocity}`,
        e.origin ? `o=${e.origin}` : '',
    ].filter(Boolean).join('|');
}

// ============================================================
// 单次对比 — 一个 (seed, style, bars) 组合
// ============================================================

interface CaseResult {
    seed: string;
    style: StyleName;
    bars: number;
    chordsMatch: boolean;
    eventsMatch: boolean;
    mgChordCount: number;
    afChordCount: number;
    mgEventCount: number;
    afEventCount: number;
    firstChordDiff?: { idx: number; mg: string; af: string };
    firstEventDiff?: { idx: number; mg: string; af: string };
    mgError?: string;
    afError?: string;
}

function runOneCase(seed: string, style: StyleName, bars: number): CaseResult {
    const harmonySeed = `${seed}::harmony`;

    const mgConfig: MgGenerationConfig = {
        seed: harmonySeed,
        style,
        key: 'C',
        mode: 'Major',
        emotion: 'auto',
    };
    // mg 上游有未提交 WIP 已 sync,bars 通过 barsOverride 字段(types 含)。
    // mg 上游 ChordSkeletonSlot.beats 是 skeleton 层字段,不在 GenerationConfig。
    // mg 上游 musicEngine 我们刚同步进来已支持 barsOverride(WIP)。
    (mgConfig as any).barsOverride = bars;

    const afConfig: AfGenerationConfig = {
        seed: harmonySeed,
        style,
        key: 'C',
        mode: 'Major',
        emotion: 'auto',
        barsOverride: bars,
    };

    let mgChords: MgChordDef[] = [];
    let mgEvents: MgNoteEvent[] = [];
    let mgError: string | undefined;
    try {
        const mgEng = new MgEngine(new MgRandom(harmonySeed));
        mgChords = mgEng.generateProgressions(mgConfig);
        mgEvents = mgEng.generateArrangement(mgChords, mgConfig).events;
    } catch (e: any) {
        mgError = e?.message ?? String(e);
    }

    let afChords: AfChordDef[] = [];
    let afEvents: AfNoteEvent[] = [];
    let afError: string | undefined;
    try {
        const afEng = new AfEngine(new AfRandom(harmonySeed));
        afChords = afEng.generateProgressions(afConfig);
        afEvents = afEng.generateArrangement(afChords, afConfig).events;
    } catch (e: any) {
        afError = e?.message ?? String(e);
    }

    const result: CaseResult = {
        seed,
        style,
        bars,
        chordsMatch: false,
        eventsMatch: false,
        mgChordCount: mgChords.length,
        afChordCount: afChords.length,
        mgEventCount: mgEvents.length,
        afEventCount: afEvents.length,
        mgError,
        afError,
    };

    // chord 对账
    if (!mgError && !afError) {
        let chordsMatch = mgChords.length === afChords.length;
        if (chordsMatch) {
            for (let i = 0; i < mgChords.length; i++) {
                const mSig = chordSig(mgChords[i]);
                const aSig = chordSig(afChords[i]);
                if (mSig !== aSig) {
                    chordsMatch = false;
                    result.firstChordDiff = { idx: i, mg: mSig, af: aSig };
                    break;
                }
            }
        } else {
            result.firstChordDiff = {
                idx: -1,
                mg: `count=${mgChords.length}`,
                af: `count=${afChords.length}`,
            };
        }
        result.chordsMatch = chordsMatch;

        // event 对账
        let eventsMatch = mgEvents.length === afEvents.length;
        if (eventsMatch) {
            for (let i = 0; i < mgEvents.length; i++) {
                const mSig = eventSig(mgEvents[i]);
                const aSig = eventSig(afEvents[i]);
                if (mSig !== aSig) {
                    eventsMatch = false;
                    result.firstEventDiff = { idx: i, mg: mSig, af: aSig };
                    break;
                }
            }
        } else {
            result.firstEventDiff = {
                idx: -1,
                mg: `count=${mgEvents.length}`,
                af: `count=${afEvents.length}`,
            };
        }
        result.eventsMatch = eventsMatch;
    }

    return result;
}

// ============================================================
// 主循环 + 报表
// ============================================================

function main(): void {
    console.log('=== mg upstream vs auraflow harmony-engine 算法对账 ===\n');
    console.log(`矩阵:${SEEDS.length} seeds × ${STYLES.length} styles × ${BARS_OPTIONS.length} bars = ${SEEDS.length * STYLES.length * BARS_OPTIONS.length} cases\n`);

    const results: CaseResult[] = [];
    let allPass = true;

    for (const seed of SEEDS) {
        for (const style of STYLES) {
            for (const bars of BARS_OPTIONS) {
                const r = runOneCase(seed, style, bars);
                results.push(r);
                if (!r.chordsMatch || !r.eventsMatch || r.mgError || r.afError) {
                    allPass = false;
                }
            }
        }
    }

    // 列表式报表
    console.log('| seed | style | bars | chords | events | mg cnt (c/e) | af cnt (c/e) | note |');
    console.log('|------|-------|------|--------|--------|--------------|--------------|------|');
    for (const r of results) {
        const ch = r.mgError || r.afError ? 'ERROR' : (r.chordsMatch ? '✓' : '✗');
        const ev = r.mgError || r.afError ? 'ERROR' : (r.eventsMatch ? '✓' : '✗');
        const mgC = `${r.mgChordCount}/${r.mgEventCount}`;
        const afC = `${r.afChordCount}/${r.afEventCount}`;
        const note = r.mgError ?? r.afError ?? '';
        console.log(`| ${r.seed} | ${r.style} | ${r.bars} | ${ch} | ${ev} | ${mgC} | ${afC} | ${note} |`);
    }

    // 失配详情
    console.log('\n=== 失配详情(first diff)===');
    let hasFails = false;
    for (const r of results) {
        if (!r.chordsMatch && r.firstChordDiff) {
            hasFails = true;
            console.log(`\n[${r.seed} / ${r.style} / bars=${r.bars}] chord diff @ idx=${r.firstChordDiff.idx}`);
            console.log(`  mg: ${r.firstChordDiff.mg}`);
            console.log(`  af: ${r.firstChordDiff.af}`);
        }
        if (!r.eventsMatch && r.firstEventDiff) {
            hasFails = true;
            console.log(`\n[${r.seed} / ${r.style} / bars=${r.bars}] event diff @ idx=${r.firstEventDiff.idx}`);
            console.log(`  mg: ${r.firstEventDiff.mg}`);
            console.log(`  af: ${r.firstEventDiff.af}`);
        }
    }
    if (!hasFails && allPass) {
        console.log('(无失配 — 所有 cases 算法 bit-exact 一致)');
    }

    // 最终结论
    console.log('\n=== 最终结论 ===');
    if (allPass) {
        console.log('✅ mg 上游 vs auraflow harmony-engine 算法层 bit-exact 一致');
        console.log('   → 若 auraflow 听感与 mg 不同,问题必然在 harmony-engine 之外:');
        console.log('     - HarmonyEngine facade 的 seed/config 翻译(检查 pipeline/index.ts:153 harmonySeed 来源)');
        console.log('     - chordDefsToGeneratedChords / noteEventsToNoteData adapter');
        console.log('     - Conductor / Reconciler 后处理');
        console.log('     - AudioEngine / MidiConverter 混音');
    } else {
        console.log('❌ 存在算法层差异 — 检查上方失配详情');
        process.exitCode = 1;
    }
}

main();
