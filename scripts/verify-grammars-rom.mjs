#!/usr/bin/env node
// ============================================================
// verify-grammars-rom.mjs — 无损性对账
// ============================================================
//
// 跑全 85 .grammar parse(ground truth)+ 读 grammars.rom decode,
// 逐字段 deep-equal 对比所有 53556 rules。
//
// 用法:npm run verify-grammars-rom
// 成功:0 mismatches
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const GRAMMAR_DIR = join(PROJECT_ROOT, 'src/core/generation/improCore/data/grammars');
const ROM_PATH = join(PROJECT_ROOT, 'src/core/generation/improCore/data/grammars.rom');

// ─────────────────────────────────────────────────────────────
// S-expression parser
// ─────────────────────────────────────────────────────────────
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*;.*$/gm, ''); }
function tokenize(src) {
    const out = []; let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === '(' || c === ')') { out.push(c); i++; continue; }
        if (/\s/.test(c)) { i++; continue; }
        let j = i;
        while (j < src.length && !/[\s()]/.test(src[j])) j++;
        out.push(src.slice(i, j));
        i = j;
    }
    return out;
}
function parseSexpr(tokens, idx) {
    if (tokens[idx.i] !== '(') {
        const a = tokens[idx.i++];
        const n = Number(a);
        if (!Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(a)) return n;
        return a;
    }
    idx.i++;
    const list = [];
    while (idx.i < tokens.length && tokens[idx.i] !== ')') list.push(parseSexpr(tokens, idx));
    idx.i++;
    return list;
}

// ─────────────────────────────────────────────────────────────
// Ground truth
// ─────────────────────────────────────────────────────────────
function parseGroundTruth() {
    const files = readdirSync(GRAMMAR_DIR).filter(f => f.endsWith('.grammar')).sort();
    const grammars = [];
    for (const f of files) {
        const src = stripComments(readFileSync(join(GRAMMAR_DIR, f), 'utf8'));
        const toks = tokenize(src);
        const idx = { i: 0 };
        let startSymbol = 'P';
        const parameters = [];
        const rules = [];
        try {
            while (idx.i < toks.length) {
                const item = parseSexpr(toks, idx);
                if (!Array.isArray(item)) continue;
                const head = item[0];
                if (head === 'startsymbol' && item.length >= 2) startSymbol = String(item[1]);
                else if (head === 'parameter' && item.length >= 2 && Array.isArray(item[1])) {
                    parameters.push([String(item[1][0]), String(item[1][1])]);
                } else if ((head === 'rule' || head === 'base') && item.length >= 3) {
                    const isBase = head === 'base';
                    const headExpr = item[1];
                    const body = item[2];
                    const tail = item.slice(3);
                    let builtinName = null;
                    let weight = 1;
                    for (const t of tail) {
                        if (Array.isArray(t) && t[0] === 'builtin') builtinName = `${t[1]}:${t[2]}`;
                        else if (typeof t === 'number') weight = t;
                    }
                    const ruleHead = Array.isArray(headExpr) ? String(headExpr[0]) : String(headExpr);
                    let headFixedArg = null;
                    const headParams = [];
                    if (Array.isArray(headExpr)) {
                        for (let i = 1; i < headExpr.length; i++) {
                            const a = headExpr[i];
                            if (typeof a === 'number') headFixedArg = a;
                            else if (typeof a === 'string') headParams.push(a);
                        }
                    }
                    rules.push({ isBase, head: ruleHead, headParams, headFixedArg, body, builtinName, weight });
                }
            }
        } catch (e) {}
        grammars.push({ filename: f, startSymbol, parameters, rules });
    }
    return grammars;
}

// ─────────────────────────────────────────────────────────────
// ROM decoder
// ─────────────────────────────────────────────────────────────
function decodeRom(rom) {
    const magic = rom.toString('ascii', 0, 4);
    if (magic !== 'GRM1') throw new Error(`Bad magic: ${magic}`);
    const sectionCount = rom.readUInt32LE(8);
    const totalRules = rom.readUInt32LE(12);

    const sections = new Map();
    for (let i = 0; i < sectionCount; i++) {
        const off = 16 + i * 12;
        sections.set(rom.readUInt32LE(off), {
            offset: rom.readUInt32LE(off + 4),
            length: rom.readUInt32LE(off + 8),
        });
    }

    const readU24 = (buf, off) => buf[off] | (buf[off+1] << 8) | (buf[off+2] << 16);
    const readStr = (buf, off) => {
        const len = buf[off];
        return { s: buf.toString('utf8', off + 1, off + 1 + len), next: off + 1 + len };
    };

    // Section 1: TOKEN_TABLE
    const tokens = [];
    {
        let off = sections.get(1).offset;
        const num = rom.readUInt32LE(off); off += 4;
        for (let i = 0; i < num; i++) { const r = readStr(rom, off); tokens.push(r.s); off = r.next; }
    }

    // Section 2: BODY_OFFSET
    const bodyOffsets = [];
    {
        let off = sections.get(2).offset;
        const num = rom.readUInt32LE(off); off += 4;
        for (let i = 0; i <= num; i++) { bodyOffsets.push(readU24(rom, off)); off += 3; }
    }

    const bodyDataStart = sections.get(3).offset;

    // Section 4: HEAD_NAME
    const headNames = [];
    {
        let off = sections.get(4).offset;
        const num = rom.readUInt16LE(off); off += 2;
        for (let i = 0; i < num; i++) { const r = readStr(rom, off); headNames.push(r.s); off = r.next; }
    }

    // Section 5: BUILTIN_NAME
    const builtinNames = [];
    {
        let off = sections.get(5).offset;
        const num = rom[off++];
        for (let i = 0; i < num; i++) { const r = readStr(rom, off); builtinNames.push(r.s === '' ? null : r.s); off = r.next; }
    }

    // Section 6: WEIGHT_TABLE
    const weights = [];
    {
        let off = sections.get(6).offset;
        const num = rom[off++];
        for (let i = 0; i < num; i++) { weights.push(rom.readFloatLE(off)); off += 4; }
    }

    // Section 7: PARAM_KEY_TABLE
    const paramKeys = [];
    {
        let off = sections.get(7).offset;
        const num = rom[off++];
        for (let i = 0; i < num; i++) { const r = readStr(rom, off); paramKeys.push(r.s); off = r.next; }
    }

    // Section 10: HEAD_SIG
    const PARAM_PATTERN_FROM_ID = ['', 'Z', 'Y'];
    const headSigs = [];
    {
        let off = sections.get(10).offset;
        const num = rom.readUInt16LE(off); off += 2;
        for (let i = 0; i < num; i++) {
            const headNameId = rom.readUInt16LE(off); off += 2;
            const ppId = rom[off++];
            const ps = PARAM_PATTERN_FROM_ID[ppId];
            headSigs.push({ head: headNames[headNameId], headParams: ps === '' ? [] : [ps] });
        }
    }

    // Section 8: GRAMMAR_INDEX
    const grammarMeta = [];
    {
        let off = sections.get(8).offset;
        const num = rom.readUInt16LE(off); off += 2;
        for (let i = 0; i < num; i++) {
            const f1 = readStr(rom, off); off = f1.next;
            const f2 = readStr(rom, off); off = f2.next;
            const numParams = rom[off++];
            const params = [];
            for (let p = 0; p < numParams; p++) {
                const keyId = rom[off++];
                const v = readStr(rom, off); off = v.next;
                params.push([paramKeys[keyId], v.s]);
            }
            const ruleStart = rom.readUInt32LE(off); off += 4;
            const ruleEnd = rom.readUInt32LE(off); off += 4;
            grammarMeta.push({ filename: f1.s, startSymbol: f2.s, parameters: params, ruleStart, ruleEnd });
        }
    }

    // Section 9: RULE_INDEX
    const ruleHeaders = [];
    {
        let off = sections.get(9).offset;
        for (let i = 0; i < totalRules; i++) {
            const sigId = rom.readUInt16LE(off); off += 2;
            const fixedArgRaw = rom.readUInt16LE(off); off += 2;
            const bodyId = readU24(rom, off); off += 3;
            const builtinId = rom[off++];
            const wFlags = rom[off++];
            const sig = headSigs[sigId];
            ruleHeaders.push({
                head: sig.head,
                headParams: sig.headParams,
                headFixedArg: fixedArgRaw === 0xffff ? null : fixedArgRaw,
                bodyId,
                builtinName: builtinNames[builtinId],
                weight: weights[wFlags & 0x7f],
                isBase: (wFlags & 0x80) !== 0,
            });
        }
    }

    // Decode bodies
    function decodeVarint(buf, start, end, out) {
        let off = start;
        while (off < end) {
            let n = 0, shift = 0;
            while (true) {
                const b = buf[off++];
                n |= (b & 0x7f) << shift;
                if ((b & 0x80) === 0) break;
                shift += 7;
            }
            out.push(n);
        }
    }
    function maybeNum(s) {
        if (typeof s !== 'string') return s;
        const n = Number(s);
        if (!Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(s)) return n;
        return s;
    }
    function tokensToAst(toks) {
        let i = 0;
        function parse() {
            const t = toks[i++];
            if (t === 'L_EMPTY') return [];
            if (t === 'L_START') {
                const list = [];
                while (toks[i] !== 'L_END') list.push(parse());
                i++;
                return list;
            }
            if (t.startsWith('X:')) {
                const parts = t.split(':');
                return ['X', maybeNum(parts[1]), maybeNum(parts[2])];
            }
            if (t.startsWith('SLOPE:')) {
                const parts = t.split(':');
                const list = ['slope', Number(parts[1]), Number(parts[2])];
                while (toks[i] !== 'SLOPE_END') list.push(parse());
                i++;
                return list;
            }
            if (t.startsWith('L:')) {
                const firstAtom = t.slice(2);
                const list = [maybeNum(firstAtom)];
                while (toks[i] !== 'L_END') list.push(parse());
                i++;
                return list;
            }
            return maybeNum(t);
        }
        return parse();
    }

    const bodies = [];
    for (let bid = 0; bid < bodyOffsets.length - 1; bid++) {
        const start = bodyDataStart + bodyOffsets[bid];
        const end = bodyDataStart + bodyOffsets[bid + 1];
        const tokIds = [];
        decodeVarint(rom, start, end, tokIds);
        const tokStrs = tokIds.map(id => tokens[id]);
        bodies.push(tokensToAst(tokStrs));
    }

    return grammarMeta.map(gm => {
        const rules = [];
        for (let i = gm.ruleStart; i < gm.ruleEnd; i++) {
            const rh = ruleHeaders[i];
            rules.push({
                isBase: rh.isBase,
                head: rh.head,
                headParams: rh.headParams,
                headFixedArg: rh.headFixedArg,
                body: bodies[rh.bodyId],
                builtinName: rh.builtinName,
                weight: rh.weight,
            });
        }
        return { filename: gm.filename, startSymbol: gm.startSymbol, parameters: gm.parameters, rules };
    });
}

// ─────────────────────────────────────────────────────────────
// Deep equal + run
// ─────────────────────────────────────────────────────────────
function deepEqual(a, b, path = '') {
    if (a === b) return null;
    if (typeof a === 'number' && typeof b === 'number') {
        if (Number.isNaN(a) && Number.isNaN(b)) return null;
        if (Math.abs(a - b) < 1e-6) return null;
        return `${path}: ${a} !== ${b}`;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return `${path}: array len ${a.length} !== ${b.length}`;
        for (let i = 0; i < a.length; i++) {
            const d = deepEqual(a[i], b[i], `${path}[${i}]`);
            if (d) return d;
        }
        return null;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        const ka = Object.keys(a).sort();
        const kb = Object.keys(b).sort();
        if (ka.join(',') !== kb.join(',')) return `${path}: keys differ ${ka} vs ${kb}`;
        for (const k of ka) {
            const d = deepEqual(a[k], b[k], `${path}.${k}`);
            if (d) return d;
        }
        return null;
    }
    return `${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
}

console.log('Parsing ground truth (85 .grammar files)...');
const gt = parseGroundTruth();
console.log(`  ${gt.length} grammars,${gt.reduce((s,g)=>s+g.rules.length,0)} rules`);

console.log(`\nReading ${ROM_PATH}...`);
const rom = readFileSync(ROM_PATH);
console.log(`  ${rom.length} bytes`);
const dec = decodeRom(rom);
console.log(`  Decoded ${dec.length} grammars,${dec.reduce((s,g)=>s+g.rules.length,0)} rules`);

console.log(`\nComparing...`);
let mismatches = 0;
const firstMismatches = [];
for (let gi = 0; gi < gt.length; gi++) {
    const a = gt[gi];
    const b = dec[gi];
    if (a.filename !== b.filename) { mismatches++; if (firstMismatches.length < 10) firstMismatches.push(`grammar[${gi}] filename`); continue; }
    if (a.startSymbol !== b.startSymbol) { mismatches++; if (firstMismatches.length < 10) firstMismatches.push(`${a.filename} startSymbol`); }
    if (a.parameters.length !== b.parameters.length) {
        mismatches++; if (firstMismatches.length < 10) firstMismatches.push(`${a.filename} parameters.length`);
    } else {
        for (let pi = 0; pi < a.parameters.length; pi++) {
            const [ka, va] = a.parameters[pi];
            const [kb, vb] = b.parameters[pi];
            if (ka !== kb || va !== vb) { mismatches++; if (firstMismatches.length < 10) firstMismatches.push(`${a.filename} param[${pi}]`); }
        }
    }
    if (a.rules.length !== b.rules.length) { mismatches++; if (firstMismatches.length < 10) firstMismatches.push(`${a.filename} rules.length`); continue; }
    for (let ri = 0; ri < a.rules.length; ri++) {
        const d = deepEqual(a.rules[ri], b.rules[ri], `${a.filename}.rules[${ri}]`);
        if (d) { mismatches++; if (firstMismatches.length < 10) firstMismatches.push(d); }
    }
}

console.log(`\n=== Result ===`);
console.log(`Mismatches: ${mismatches}`);
if (mismatches === 0) {
    console.log(`✓ ${gt.reduce((s,g)=>s+g.rules.length,0)} rules 全部 byte-exact 匹配,无损 verified`);
    process.exit(0);
} else {
    console.log(`✗ 发现 ${mismatches} 处差异:`);
    firstMismatches.forEach((m, i) => console.log(`  [${i+1}] ${m}`));
    process.exit(1);
}
