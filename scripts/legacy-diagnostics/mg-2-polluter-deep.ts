/**
 * 关键实验:
 * 在 1-polluter 后 RNB 16 = 350, 2-polluter 后 RNB 16 = 349
 * 让我们看 RNB 16 call 开始前,Engine 实例状态在 1-polluter 之后 vs 2-polluter 之后有何差异
 *
 * 还要:全 globalThis / global 属性 hash 对比
 */

import {
    Engine as MgEngine,
    Random as MgRandom,
} from '../../melodygenerative/src/lib/musicEngine';

import * as crypto from 'crypto';

function runCase(seed: string, style: string, bars: number): number {
    const cfg: any = { seed: `${seed}::harmony`, style, key: 'C', mode: 'Major', emotion: 'auto', barsOverride: bars };
    const eng = new MgEngine(new MgRandom(cfg.seed));
    const chords = eng.generateProgressions(cfg);
    const events = eng.generateArrangement(chords, cfg).events;
    return events.length;
}

function hash(s: string): string {
    return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

// 测各 mg 子模块导出的 const 在 1/2 polluter 后是否变化
import * as MG_MUSIC_ENGINE from '../../melodygenerative/src/lib/musicEngine';
import * as MG_MUSIC_THEORY from '../../melodygenerative/src/lib/musicTheory';
import * as MG_STYLE_DICT from '../../melodygenerative/src/lib/styleDictionary';
import * as MG_DYNAMIC_HARMONY from '../../melodygenerative/src/lib/dynamicHarmony';
import * as MG_BASSLINE_RULES from '../../melodygenerative/src/lib/basslineRules';
import * as MG_MOTIF_TRANSFORM from '../../melodygenerative/src/lib/motifTransform';
import * as MG_RHYTHM_PATTERN from '../../melodygenerative/src/lib/rhythmPattern';

const MODULES = {
    musicEngine: MG_MUSIC_ENGINE,
    musicTheory: MG_MUSIC_THEORY,
    styleDictionary: MG_STYLE_DICT,
    dynamicHarmony: MG_DYNAMIC_HARMONY,
    basslineRules: MG_BASSLINE_RULES,
    motifTransform: MG_MOTIF_TRANSFORM,
    rhythmPattern: MG_RHYTHM_PATTERN,
};

function snapshotModuleExports(): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    for (const [modName, mod] of Object.entries(MODULES)) {
        out[modName] = {};
        for (const key of Object.keys(mod)) {
            const v = (mod as any)[key];
            if (typeof v === 'function') {
                out[modName][key] = `fn:${v.name || 'anon'}`;
                continue;
            }
            try {
                out[modName][key] = hash(JSON.stringify(v, (k, val) => {
                    if (typeof val === 'function') return `__fn:${val.name || 'anon'}`;
                    if (val instanceof Map) return Array.from(val.entries());
                    if (val instanceof Set) return Array.from(val.values());
                    return val;
                }));
            } catch {
                out[modName][key] = '[unserializable]';
            }
        }
    }
    return out;
}

function diffSnapshots(a: Record<string, Record<string, string>>, b: Record<string, Record<string, string>>): string[] {
    const diffs: string[] = [];
    for (const modName of Object.keys(a)) {
        for (const key of Object.keys(a[modName])) {
            if (a[modName][key] !== b[modName][key]) {
                diffs.push(`${modName}.${key}: ${a[modName][key]} → ${b[modName][key]}`);
            }
        }
    }
    return diffs;
}

console.log('=== 测量:1-polluter 之后 vs 2-polluter 之后,modules 是否变 ===\n');

// 步骤 1:抽 baseline snapshot
const snap0 = snapshotModuleExports();

// 步骤 2:跑 1 个 polluter
runCase('42', 'JAZZ', 24);
const snap1 = snapshotModuleExports();

// 步骤 3:跑 2 个 polluter
runCase('42', 'JAZZ', 24);
const snap2 = snapshotModuleExports();

// 步骤 4:跑 3 个 polluter
runCase('42', 'JAZZ', 24);
const snap3 = snapshotModuleExports();

console.log('snapshot 0 → 1 diffs:');
const d01 = diffSnapshots(snap0, snap1);
if (d01.length === 0) console.log('  (none)');
else for (const d of d01) console.log('  ' + d);

console.log('\nsnapshot 1 → 2 diffs:');
const d12 = diffSnapshots(snap1, snap2);
if (d12.length === 0) console.log('  (none)');
else for (const d of d12) console.log('  ' + d);

console.log('\nsnapshot 2 → 3 diffs:');
const d23 = diffSnapshots(snap2, snap3);
if (d23.length === 0) console.log('  (none)');
else for (const d of d23) console.log('  ' + d);

// 最终验证
console.log('\n=== 验证 RNB 16 此刻输出 ===');
console.log('(当前 process 已 run 3 polluters)');
const result = runCase('42', 'RNB', 16);
console.log(`RNB 16 events: ${result}`);
