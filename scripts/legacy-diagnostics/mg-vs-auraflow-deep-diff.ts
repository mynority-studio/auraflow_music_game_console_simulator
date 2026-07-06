/**
 * 深度对账 — 针对 mg-vs-auraflow-compare.ts 发现的失配 case,
 * 打印逐事件 first-N diff,定位是哪个 part / 哪个 onset / 哪个 pitch 偏移
 */

import {
    Engine as MgEngine,
    Random as MgRandom,
    type NoteEvent as MgNoteEvent,
} from '../../melodygenerative/src/lib/musicEngine';

import {
    Engine as AfEngine,
    Random as AfRandom,
    type NoteEvent as AfNoteEvent,
} from '../src/core/generation/harmony-engine/musicEngine';

function evSig(e: MgNoteEvent | AfNoteEvent): string {
    return `${e.part.padEnd(6)} n=${String(e.noteNumber).padStart(3)} t=${e.time.toFixed(4).padStart(8)} d=${e.duration.toFixed(4).padStart(7)} v=${String(e.velocity).padStart(3)}${e.origin ? ` o=${e.origin}` : ''}`;
}

function run(seed: string, style: 'POP' | 'JAZZ' | 'RNB', bars: number) {
    const harmonySeed = `${seed}::harmony`;
    const mgConfig: any = { seed: harmonySeed, style, key: 'C', mode: 'Major', emotion: 'auto', barsOverride: bars };
    const afConfig: any = { seed: harmonySeed, style, key: 'C', mode: 'Major', emotion: 'auto', barsOverride: bars };

    const mgEng = new MgEngine(new MgRandom(harmonySeed));
    const mgChords = mgEng.generateProgressions(mgConfig);
    const mgEvents = mgEng.generateArrangement(mgChords, mgConfig).events;

    const afEng = new AfEngine(new AfRandom(harmonySeed));
    const afChords = afEng.generateProgressions(afConfig);
    const afEvents = afEng.generateArrangement(afChords, afConfig).events;

    console.log(`\n=== ${seed} / ${style} / bars=${bars} ===`);
    console.log(`mg: ${mgChords.length} chords, ${mgEvents.length} events`);
    console.log(`af: ${afChords.length} chords, ${afEvents.length} events`);
    console.log(`bars match: ${mgChords.length === afChords.length}`);

    // 逐事件对齐对比 (取 min length 走完,溢出部分单独标注)
    const minLen = Math.min(mgEvents.length, afEvents.length);
    const diffs: { i: number; mg: string; af: string }[] = [];
    for (let i = 0; i < minLen; i++) {
        const ms = evSig(mgEvents[i]);
        const as = evSig(afEvents[i]);
        if (ms !== as) diffs.push({ i, mg: ms, af: as });
    }

    console.log(`\n首 ${Math.min(diffs.length, 10)} 个对齐事件 diff:`);
    if (diffs.length === 0) {
        console.log('  (前 minLen 个事件 bit-exact 一致)');
    } else {
        for (const d of diffs.slice(0, 10)) {
            console.log(`  [${String(d.i).padStart(4)}]`);
            console.log(`    mg: ${d.mg}`);
            console.log(`    af: ${d.af}`);
        }
        console.log(`  ...共 ${diffs.length} 处对齐 diff`);
    }

    // 溢出部分
    if (mgEvents.length !== afEvents.length) {
        console.log(`\n溢出事件 (${Math.abs(mgEvents.length - afEvents.length)} 个):`);
        const longer = mgEvents.length > afEvents.length ? mgEvents : afEvents;
        const which = mgEvents.length > afEvents.length ? 'mg' : 'af';
        for (let i = minLen; i < Math.min(longer.length, minLen + 5); i++) {
            console.log(`  ${which}[${i}]: ${evSig(longer[i])}`);
        }
    }

    // chord 进行打印
    console.log('\nChord progression (mg side, 截断 12):');
    for (let i = 0; i < Math.min(mgChords.length, 12); i++) {
        const c = mgChords[i];
        console.log(`  [${String(i).padStart(2)}] ${c.roman.padEnd(8)} ${(c.chordSymbol ?? c.root + c.type).padEnd(12)} dur=${c.duration} voicing=[${(c.notesMidi ?? []).join(',')}]`);
    }
}

// 针对脚本输出的具体失配 case 深查
console.log('======================================================');
console.log(' 深度对账:42 / RNB / 16 (bars=16 路径中唯一 1-event 失配)');
console.log('======================================================');
run('42', 'RNB', 16);

console.log('\n\n======================================================');
console.log(' 对照:42 / POP / 16 (bit-exact PASS,作为对照)');
console.log('======================================================');
run('42', 'POP', 16);
