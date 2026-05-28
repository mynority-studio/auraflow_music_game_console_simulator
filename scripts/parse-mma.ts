// ============================================================
// parse-mma.ts — 122 MMA stdlib 文件 → 结构化 JSON
// ============================================================
//
// 抽取每个 style 的 canonical groove(第一个 DefGroove)及其所有 track 的
// 关键字段(voice / sequence / voicing / octave / articulate / accent /
// humanization 等)。
//
// 输出:
//   scripts/output/mma-corpus.json — 全量解析数据
//   stdout — 跨 122 文件维度分布统计
//
// 注意:Sequence 字段保留原 raw 字符串,不递归解析引用(B13 / Bmain 等命名
// 模式定义在 Begin Drum/Bass/Chord Define 里,Phase 2 不展开)。
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

const MMA_STDLIB = '/Users/mynority/vibe_coding/mma/lib/stdlib';

interface MmaTrack {
    type: string;
    voice?: string;
    tone?: string;
    sequence?: string;
    volume?: string;
    articulate?: number;
    octave?: number;
    voicingMode?: string;
    strum?: number;
    accent?: string;
    rtime?: number;
    rvolume?: number;
    rskip?: number;
    harmony?: string;
    direction?: string;
    seqRnd?: boolean;
    range?: number;
    unify?: boolean;
    copy?: string;
    /** density 粗估:inline sequence 内 ';' + '{' 计数 */
    seqEventCount?: number;
}

interface MmaGroove {
    name: string;
    seqSize?: number;
    tracks: MmaTrack[];
}

interface MmaFile {
    name: string;
    timesig: [number, number];
    grooves: MmaGroove[];
}

// ─────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────

function parseFile(filePath: string): MmaFile | null {
    const raw = fs.readFileSync(filePath, 'utf-8');
    // 去掉单行 // 注释
    const lines = raw.split(/\r?\n/).map(l => {
        const idx = l.indexOf('//');
        return idx >= 0 ? l.substring(0, idx) : l;
    });

    const fileName = path.basename(filePath, '.mma');
    const out: MmaFile = { name: fileName, timesig: [4, 4], grooves: [] };

    // 解析顶层 Timesig 等
    for (const l of lines) {
        const m = l.match(/^\s*Timesig\s+(\d+)\s+(\d+)/i);
        if (m) {
            out.timesig = [parseInt(m[1], 10), parseInt(m[2], 10)];
            break;
        }
    }

    // currentTracks:跨 DefGroove 累积的 track 状态(MMA 是命令式,Groove
    // 切换时保留前面 Begin/End 设置)。我们只需 capture 当前快照在每个
    // DefGroove 时刻。
    let currentSeqSize = 4;
    const currentTracks = new Map<string, MmaTrack>();

    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();
        i++;
        if (!line) continue;

        // SeqSize
        const ssMatch = line.match(/^SeqSize\s+(\d+)/i);
        if (ssMatch) {
            currentSeqSize = parseInt(ssMatch[1], 10);
            continue;
        }

        // DefGroove <name> [desc] — 把当前 currentTracks 快照存为一个 groove
        const dgMatch = line.match(/^DefGroove\s+(\S+)/i);
        if (dgMatch) {
            const grooveName = dgMatch[1];
            out.grooves.push({
                name: grooveName,
                seqSize: currentSeqSize,
                tracks: Array.from(currentTracks.values()).map(t => ({ ...t })),
            });
            continue;
        }

        // Begin <TrackName>
        const beginMatch = line.match(/^Begin\s+([A-Za-z][A-Za-z0-9_-]*)/i);
        if (beginMatch) {
            const trackType = beginMatch[1];

            // 跳过 Define block(Begin Drum Define / Begin Bass Define / Begin Chord Define)
            // Doc / Doc Define / 其他非 track block
            if (/(Define|Doc)$/i.test(trackType) || /Define\s*$/i.test(line) || trackType.toLowerCase() === 'doc') {
                // 跳到对应 End
                while (i < lines.length && !/^\s*End\s*$/i.test(lines[i].trim())) i++;
                i++;
                continue;
            }
            // 处理 `Begin <Track> Define` 格式
            if (/\bDefine\b/i.test(line)) {
                while (i < lines.length && !/^\s*End\s*$/i.test(lines[i].trim())) i++;
                i++;
                continue;
            }

            // 真正的 track block
            const track: MmaTrack = currentTracks.get(trackType) ?? { type: trackType };
            currentTracks.set(trackType, track);

            // 解析到 End
            while (i < lines.length) {
                const fieldLine = lines[i].trim();
                i++;
                if (/^End\s*$/i.test(fieldLine)) break;
                if (!fieldLine) continue;

                parseTrackField(track, fieldLine);
            }
            continue;
        }
    }

    // 文件结尾若 currentTracks 非空但没 DefGroove(罕见),也算一个 unnamed groove
    if (out.grooves.length === 0 && currentTracks.size > 0) {
        out.grooves.push({
            name: fileName,
            seqSize: currentSeqSize,
            tracks: Array.from(currentTracks.values()).map(t => ({ ...t })),
        });
    }

    return out;
}

function parseTrackField(track: MmaTrack, line: string): void {
    const lower = line.toLowerCase();
    const m = (re: RegExp) => line.match(re);

    let mm: RegExpMatchArray | null;
    if ((mm = m(/^Voice\s+(\S+)/i)))         { track.voice = mm[1]; return; }
    if ((mm = m(/^Tone\s+(.+)$/i)))          { track.tone = mm[1].trim(); return; }
    if ((mm = m(/^Sequence\s+(.+)$/i)))      {
        track.sequence = mm[1].trim();
        // density 粗估:数 ';' 分隔的事件数(inline `{ ... ; ... ; ... }` 风格)
        const seqStr = track.sequence;
        const semicolons = (seqStr.match(/;/g) ?? []).length;
        const braces = (seqStr.match(/\{/g) ?? []).length;
        // 简单估算:有 N 个 ';' 大约 N+1 个 event
        track.seqEventCount = semicolons > 0 ? semicolons + braces : undefined;
        return;
    }
    if ((mm = m(/^Volume\s+(\S+)/i)))        { track.volume = mm[1]; return; }
    if ((mm = m(/^Articulate\s+(\d+)/i)))    { track.articulate = parseInt(mm[1], 10); return; }
    if ((mm = m(/^Octave\s+(\d+)/i)))        { track.octave = parseInt(mm[1], 10); return; }
    if ((mm = m(/^Voicing\s+(.+)$/i)))       {
        const v = mm[1].trim();
        const modeMatch = v.match(/Mode\s*=\s*(\S+)/i);
        track.voicingMode = modeMatch ? modeMatch[1] : v;
        return;
    }
    if ((mm = m(/^Strum\s+(\d+)/i)))         { track.strum = parseInt(mm[1], 10); return; }
    if ((mm = m(/^Accent\s+(.+)$/i)))        { track.accent = mm[1].trim(); return; }
    if ((mm = m(/^Rtime\s+(\d+)/i)))         { track.rtime = parseInt(mm[1], 10); return; }
    if ((mm = m(/^Rvolume\s+(\d+)/i)))       { track.rvolume = parseInt(mm[1], 10); return; }
    if ((mm = m(/^Rskip\s+(\d+)/i)))         { track.rskip = parseInt(mm[1], 10); return; }
    if ((mm = m(/^Harmony\s+(.+)$/i)))       { track.harmony = mm[1].trim(); return; }
    if ((mm = m(/^Direction\s+(\S+)/i)))     { track.direction = mm[1]; return; }
    if ((mm = m(/^SeqRnd\s+(\S+)/i)))        { track.seqRnd = mm[1].toLowerCase() === 'on'; return; }
    if ((mm = m(/^Range\s+([\d.]+)/i)))      { track.range = parseFloat(mm[1]); return; }
    if ((mm = m(/^Unify\s+(\S+)/i)))         { track.unify = mm[1].toLowerCase() === 'on'; return; }
    if ((mm = m(/^Copy\s+(\S+)/i)))          { track.copy = mm[1]; return; }
    void lower;
}

// ─────────────────────────────────────────────────────────────────
// Main + analysis
// ─────────────────────────────────────────────────────────────────

const files = fs.readdirSync(MMA_STDLIB).filter(f => f.endsWith('.mma'));
console.log(`scanning ${files.length} .mma files...`);

const corpus: MmaFile[] = [];
for (const f of files) {
    try {
        const result = parseFile(path.join(MMA_STDLIB, f));
        if (result) corpus.push(result);
    } catch (e) {
        console.warn(`failed to parse ${f}:`, e);
    }
}

console.log(`parsed ${corpus.length} files, ${corpus.reduce((s, f) => s + f.grooves.length, 0)} total grooves`);

// 写 corpus JSON
const outPath = '/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/scripts/output/mma-corpus.json';
fs.writeFileSync(outPath, JSON.stringify(corpus, null, 2));
console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);

// ─────────────────────────────────────────────────────────────────
// Dimension distribution analysis(只统计 canonical groove = 第一个)
// ─────────────────────────────────────────────────────────────────

interface DimStats {
    voicingModes: Record<string, number>;
    voices: Record<string, number>;
    octaves: Record<string, number>;
    articulates: number[];
    volumes: Record<string, number>;
    strums: number[];
    rvolumes: number[];
    rtimes: number[];
    rskips: number[];
    harmonies: Record<string, number>;
    seqRnds: { on: number; off: number };
    seqEventCounts: number[];
    trackTypes: Record<string, number>;
    timesigs: Record<string, number>;
}

const stats: DimStats = {
    voicingModes: {}, voices: {}, octaves: {}, articulates: [],
    volumes: {}, strums: [], rvolumes: [], rtimes: [], rskips: [],
    harmonies: {}, seqRnds: { on: 0, off: 0 }, seqEventCounts: [],
    trackTypes: {}, timesigs: {},
};

const inc = (r: Record<string, number>, k: string | undefined) => { if (k) r[k] = (r[k] ?? 0) + 1; };

for (const f of corpus) {
    inc(stats.timesigs, `${f.timesig[0]}/${f.timesig[1]}`);
    const g = f.grooves[0];  // canonical
    if (!g) continue;
    for (const t of g.tracks) {
        inc(stats.trackTypes, t.type);
        inc(stats.voicingModes, t.voicingMode);
        inc(stats.voices, t.voice);
        if (t.octave !== undefined) inc(stats.octaves, `oct${t.octave}`);
        if (t.articulate !== undefined) stats.articulates.push(t.articulate);
        inc(stats.volumes, t.volume);
        if (t.strum !== undefined) stats.strums.push(t.strum);
        if (t.rvolume !== undefined) stats.rvolumes.push(t.rvolume);
        if (t.rtime !== undefined) stats.rtimes.push(t.rtime);
        if (t.rskip !== undefined) stats.rskips.push(t.rskip);
        inc(stats.harmonies, t.harmony);
        if (t.seqRnd !== undefined) (t.seqRnd ? stats.seqRnds.on++ : stats.seqRnds.off++);
        if (t.seqEventCount !== undefined) stats.seqEventCounts.push(t.seqEventCount);
    }
}

function pct(r: Record<string, number>): Array<[string, number, string]> {
    const total = Object.values(r).reduce((s, n) => s + n, 0);
    return Object.entries(r).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, v, `${((v / total) * 100).toFixed(1)}%`] as [string, number, string]);
}

function summary(arr: number[]): string {
    if (arr.length === 0) return 'n=0';
    const sorted = arr.slice().sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const min = sorted[0]; const max = sorted[sorted.length - 1];
    const avg = arr.reduce((s, n) => s + n, 0) / arr.length;
    return `n=${arr.length} min=${min} med=${med} avg=${avg.toFixed(1)} max=${max}`;
}

console.log('\n========== Dimension Distribution (canonical groove only) ==========\n');
console.log(`Timesigs: ${Object.entries(stats.timesigs).map(([k,v]) => `${k}=${v}`).join(' ')}`);
console.log(`\nTrack types (top 15):`);
pct(stats.trackTypes).slice(0, 15).forEach(([k, v, p]) => console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)} (${p})`));
console.log(`\nVoicing Modes:`);
pct(stats.voicingModes).forEach(([k, v, p]) => console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)} (${p})`));
console.log(`\nVoices (top 15):`);
pct(stats.voices).slice(0, 15).forEach(([k, v, p]) => console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)} (${p})`));
console.log(`\nOctaves:`);
pct(stats.octaves).forEach(([k, v, p]) => console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)} (${p})`));
console.log(`\nVolumes:`);
pct(stats.volumes).forEach(([k, v, p]) => console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)} (${p})`));
console.log(`\nHarmony doublings:`);
pct(stats.harmonies).forEach(([k, v, p]) => console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)} (${p})`));
console.log(`\nArticulate: ${summary(stats.articulates)}`);
console.log(`Strum:      ${summary(stats.strums)}`);
console.log(`Rvolume:    ${summary(stats.rvolumes)}`);
console.log(`Rtime:      ${summary(stats.rtimes)}`);
console.log(`Rskip:      ${summary(stats.rskips)}`);
console.log(`SeqEvents:  ${summary(stats.seqEventCounts)} (density 粗估)`);
console.log(`\nSeqRnd: on=${stats.seqRnds.on} off=${stats.seqRnds.off}`);
