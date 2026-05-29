#!/usr/bin/env node
// ============================================================
// fuzz-grammar-rom.mjs — ROM codec property-based / fuzz round-trip
// ============================================================
//
// 背景:verify-grammars-rom.mjs 是确定性的(真实 85 .grammar 穷举对账),
//      跑 N 遍结果恒等,覆盖不到语料里没出现的边界。本脚本随机造数据,
//      让真 codec(buildRom/decodeRom)round-trip:
//          random grammars → buildRom → decodeRom → deep-equal
//
// 自证 codec 等同性(关键):
//   STEP 1  真语料 → buildRom 必须逐字节 == 磁盘 grammars.rom
//           (证 本脚本的 buildRom == 真实 precompile 编码器)
//   STEP 2  decodeRom(磁盘 ROM) vs 真语料解析 必须 0 mismatch
//           (证 本脚本的 decodeRom == verify 解码器)
//   STEP 3  100 轮随机数据 round-trip,边界偏置
//
// 用法:npm run fuzz-grammar-rom  [rounds]
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const GRAMMAR_DIR = join(PROJECT_ROOT, 'src/core/generation/improCore/data/grammars');
const ROM_PATH = join(PROJECT_ROOT, 'src/core/generation/improCore/data/grammars.rom');
const ROUNDS = Number(process.argv[2]) || 100;

// ─────────────────────────────────────────────────────────────
// Parser(与 precompile/verify 同一份)
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
function parseGroundTruth() {
    const files = readdirSync(GRAMMAR_DIR).filter(f => f.endsWith('.grammar')).sort();
    const grammars = [];
    for (const f of files) {
        const src = stripComments(readFileSync(join(GRAMMAR_DIR, f), 'utf8'));
        const toks = tokenize(src);
        const idx = { i: 0 };
        let startSymbol = 'P';
        const parameters = [];
        const terminals = [];
        const rules = [];
        try {
            while (idx.i < toks.length) {
                const item = parseSexpr(toks, idx);
                if (!Array.isArray(item)) continue;
                const head = item[0];
                if (head === 'startsymbol' && item.length >= 2) startSymbol = String(item[1]);
                else if (head === 'parameter' && item.length >= 2 && Array.isArray(item[1])) {
                    parameters.push([String(item[1][0]), String(item[1][1])]);
                } else if (head === 'terminals') {
                    for (let i = 1; i < item.length; i++) terminals.push(String(item[i]));
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
        grammars.push({ filename: f, startSymbol, parameters, terminals, rules });
    }
    return grammars;
}

// ─────────────────────────────────────────────────────────────
// buildRom(grammars) → Buffer  — 真 precompile 编码器的纯函数拷贝
// ─────────────────────────────────────────────────────────────
function buildRom(grammars) {
    // mutate-safe:深拷贝 rule 引用承载的临时 id 字段不污染输入
    const tokenFreq = new Map();
    function visitTokens(item, emit) {
        if (!Array.isArray(item)) { emit(String(item)); return; }
        if (item.length === 0) { emit('L_EMPTY'); return; }
        if (item.length === 3 && item[0] === 'X') { emit(`X:${item[1]}:${item[2]}`); return; }
        if (item[0] === 'slope') {
            emit(`SLOPE:${item[1]}:${item[2]}`);
            for (let i = 3; i < item.length; i++) visitTokens(item[i], emit);
            emit(`SLOPE_END`);
            return;
        }
        if (!Array.isArray(item[0])) {
            emit(`L:${item[0]}`);
            for (let i = 1; i < item.length; i++) visitTokens(item[i], emit);
        } else {
            emit('L_START');
            for (let i = 0; i < item.length; i++) visitTokens(item[i], emit);
        }
        emit(`L_END`);
    }
    for (const g of grammars) for (const r of g.rules) visitTokens(r.body, (t) => tokenFreq.set(t, (tokenFreq.get(t) || 0) + 1));
    const sortedTokens = Array.from(tokenFreq.entries()).sort((a, b) => b[1] - a[1]).map(([t]) => t);
    const tokenIdMap = new Map(sortedTokens.map((t, i) => [t, i]));

    function varintEncode(n, out) { while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n >>>= 7; } out.push(n); }
    function encodeBody(body) {
        const ids = [];
        visitTokens(body, (t) => ids.push(tokenIdMap.get(t)));
        const out = [];
        for (const id of ids) varintEncode(id, out);
        return Buffer.from(out);
    }
    const bodyKeyToId = new Map();
    const bodyBlobs = [];
    const ruleBodyId = new Map();
    for (const g of grammars) {
        for (const r of g.rules) {
            const buf = encodeBody(r.body);
            const key = buf.toString('binary');
            if (!bodyKeyToId.has(key)) { bodyKeyToId.set(key, bodyBlobs.length); bodyBlobs.push(buf); }
            ruleBodyId.set(r, bodyKeyToId.get(key));
        }
    }

    const PARAM_PATTERN_TO_ID = new Map([['', 0], ['Z', 1], ['Y', 2]]);
    const globalHeadNames = [];
    const globalHeadId = new Map();
    const headSigList = [];
    const headSigId = new Map();
    const ruleHeadSigId = new Map();
    for (const g of grammars) {
        for (const r of g.rules) {
            if (!globalHeadId.has(r.head)) { globalHeadId.set(r.head, globalHeadNames.length); globalHeadNames.push(r.head); }
            const paramSig = r.headParams.join(',');
            if (!PARAM_PATTERN_TO_ID.has(paramSig)) throw new Error(`Unknown param pattern: [${paramSig}] for head ${r.head}`);
            const paramPatternId = PARAM_PATTERN_TO_ID.get(paramSig);
            const sigKey = `${r.head}|${paramSig}`;
            if (!headSigId.has(sigKey)) { headSigId.set(sigKey, headSigList.length); headSigList.push({ headNameId: globalHeadId.get(r.head), paramPatternId }); }
            ruleHeadSigId.set(r, headSigId.get(sigKey));
        }
    }
    if (globalHeadNames.length > 65535) throw new Error(`Global heads > 65535`);
    if (headSigList.length > 65535) throw new Error(`Head sigs > 65535`);

    const builtinNames = [null];
    const builtinId = new Map([[null, 0]]);
    const ruleBuiltinId = new Map();
    for (const g of grammars) {
        for (const r of g.rules) {
            if (r.builtinName && !builtinId.has(r.builtinName)) { builtinId.set(r.builtinName, builtinNames.length); builtinNames.push(r.builtinName); }
            ruleBuiltinId.set(r, builtinId.get(r.builtinName ?? null));
        }
    }

    const weightSet = new Set();
    for (const g of grammars) for (const r of g.rules) weightSet.add(r.weight);
    const weightTable = Array.from(weightSet).sort((a, b) => a - b);
    const weightId = new Map(weightTable.map((w, i) => [w, i]));
    if (weightTable.length > 127) throw new Error(`Weight unique > 127: ${weightTable.length}`);
    const ruleWeightId = new Map();
    for (const g of grammars) for (const r of g.rules) ruleWeightId.set(r, weightId.get(r.weight));

    const paramKeys = [];
    const paramKeyId = new Map();
    for (const g of grammars) for (const [k] of g.parameters) if (!paramKeyId.has(k)) { paramKeyId.set(k, paramKeys.length); paramKeys.push(k); }

    const SECTION_TOKEN_TABLE = 1, SECTION_BODY_OFFSET = 2, SECTION_BODY_DATA = 3, SECTION_HEAD_NAME = 4,
        SECTION_BUILTIN_NAME = 5, SECTION_WEIGHT_TABLE = 6, SECTION_PARAM_KEY_TABLE = 7, SECTION_GRAMMAR_INDEX = 8,
        SECTION_RULE_INDEX = 9, SECTION_HEAD_SIG = 10, SECTION_TERMINALS = 11;

    function writeStrU8Len(buf, s) { const b = Buffer.from(s, 'utf8'); if (b.length > 255) throw new Error(`String > 255 bytes: ${s}`); buf.push(b.length, ...b); }
    function writeU16LE(buf, n) { buf.push(n & 0xff, (n >>> 8) & 0xff); }
    function writeU24LE(buf, n) { buf.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff); }
    function writeU32LE(buf, n) { buf.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff); }
    function writeF32LE(buf, f) { const tmp = Buffer.alloc(4); tmp.writeFloatLE(f, 0); buf.push(...tmp); }

    const tokenSect = []; writeU32LE(tokenSect, sortedTokens.length); for (const t of sortedTokens) writeStrU8Len(tokenSect, t);
    const bodyOffsetSect = []; writeU32LE(bodyOffsetSect, bodyBlobs.length); let off = 0;
    for (const b of bodyBlobs) { writeU24LE(bodyOffsetSect, off); off += b.length; } writeU24LE(bodyOffsetSect, off);
    const bodyDataSect = []; for (const b of bodyBlobs) bodyDataSect.push(...b);
    const headNameSect = []; writeU16LE(headNameSect, globalHeadNames.length); for (const n of globalHeadNames) writeStrU8Len(headNameSect, n);
    const builtinNameSect = []; builtinNameSect.push(builtinNames.length); for (const n of builtinNames) writeStrU8Len(builtinNameSect, n ?? '');
    const weightSect = []; weightSect.push(weightTable.length); for (const w of weightTable) writeF32LE(weightSect, w);
    const paramKeySect = []; paramKeySect.push(paramKeys.length); for (const k of paramKeys) writeStrU8Len(paramKeySect, k);

    const grammarIndexSect = []; writeU16LE(grammarIndexSect, grammars.length); let ruleCursor = 0;
    for (const g of grammars) {
        writeStrU8Len(grammarIndexSect, g.filename);
        writeStrU8Len(grammarIndexSect, g.startSymbol);
        grammarIndexSect.push(g.parameters.length);
        for (const [k, v] of g.parameters) { grammarIndexSect.push(paramKeyId.get(k)); writeStrU8Len(grammarIndexSect, String(v)); }
        writeU32LE(grammarIndexSect, ruleCursor); ruleCursor += g.rules.length; writeU32LE(grammarIndexSect, ruleCursor);
    }

    const ruleIndexSect = []; let ruleCount = 0;
    for (const g of grammars) {
        for (const r of g.rules) {
            writeU16LE(ruleIndexSect, ruleHeadSigId.get(r));
            writeU16LE(ruleIndexSect, r.headFixedArg === null ? 0xffff : r.headFixedArg);
            writeU24LE(ruleIndexSect, ruleBodyId.get(r));
            ruleIndexSect.push(ruleBuiltinId.get(r));
            ruleIndexSect.push(ruleWeightId.get(r) | (r.isBase ? 0x80 : 0));
            ruleCount++;
        }
    }

    const headSigSect = []; writeU16LE(headSigSect, headSigList.length);
    for (const sig of headSigList) { writeU16LE(headSigSect, sig.headNameId); headSigSect.push(sig.paramPatternId); }

    const terminalsSect = []; writeU16LE(terminalsSect, grammars.length);
    for (const g of grammars) {
        if (g.terminals.length > 255) throw new Error(`Terminals count > 255 in ${g.filename}`);
        terminalsSect.push(g.terminals.length);
        for (const t of g.terminals) writeStrU8Len(terminalsSect, t);
    }

    const sections = [
        { id: SECTION_TOKEN_TABLE, data: Buffer.from(tokenSect) },
        { id: SECTION_BODY_OFFSET, data: Buffer.from(bodyOffsetSect) },
        { id: SECTION_BODY_DATA, data: Buffer.from(bodyDataSect) },
        { id: SECTION_HEAD_NAME, data: Buffer.from(headNameSect) },
        { id: SECTION_BUILTIN_NAME, data: Buffer.from(builtinNameSect) },
        { id: SECTION_WEIGHT_TABLE, data: Buffer.from(weightSect) },
        { id: SECTION_PARAM_KEY_TABLE, data: Buffer.from(paramKeySect) },
        { id: SECTION_GRAMMAR_INDEX, data: Buffer.from(grammarIndexSect) },
        { id: SECTION_RULE_INDEX, data: Buffer.from(ruleIndexSect) },
        { id: SECTION_HEAD_SIG, data: Buffer.from(headSigSect) },
        { id: SECTION_TERMINALS, data: Buffer.from(terminalsSect) },
    ];

    const HEADER_BYTES = 16, SECT_TABLE_ENTRY_BYTES = 12;
    const sectTableBytes = sections.length * SECT_TABLE_ENTRY_BYTES;
    let currentOff = HEADER_BYTES + sectTableBytes;
    const headerBuf = Buffer.alloc(HEADER_BYTES);
    headerBuf.write('GRM1', 0, 'ascii');
    headerBuf.writeUInt32LE(2, 4);
    headerBuf.writeUInt32LE(sections.length, 8);
    headerBuf.writeUInt32LE(ruleCount, 12);
    const sectTableBuf = Buffer.alloc(sectTableBytes);
    sections.forEach((s, i) => {
        sectTableBuf.writeUInt32LE(s.id, i * SECT_TABLE_ENTRY_BYTES);
        sectTableBuf.writeUInt32LE(currentOff, i * SECT_TABLE_ENTRY_BYTES + 4);
        sectTableBuf.writeUInt32LE(s.data.length, i * SECT_TABLE_ENTRY_BYTES + 8);
        currentOff += s.data.length;
    });
    return Buffer.concat([headerBuf, sectTableBuf, ...sections.map(s => s.data)]);
}

// ─────────────────────────────────────────────────────────────
// decodeRom(rom) → grammars[]  — verify 解码器拷贝
// ─────────────────────────────────────────────────────────────
function decodeRom(rom) {
    const magic = rom.toString('ascii', 0, 4);
    if (magic !== 'GRM1') throw new Error(`Bad magic: ${magic}`);
    const sectionCount = rom.readUInt32LE(8);
    const totalRules = rom.readUInt32LE(12);
    const sections = new Map();
    for (let i = 0; i < sectionCount; i++) {
        const off = 16 + i * 12;
        sections.set(rom.readUInt32LE(off), { offset: rom.readUInt32LE(off + 4), length: rom.readUInt32LE(off + 8) });
    }
    const readU24 = (buf, off) => buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16);
    const readStr = (buf, off) => { const len = buf[off]; return { s: buf.toString('utf8', off + 1, off + 1 + len), next: off + 1 + len }; };

    const tokens = [];
    { let off = sections.get(1).offset; const num = rom.readUInt32LE(off); off += 4; for (let i = 0; i < num; i++) { const r = readStr(rom, off); tokens.push(r.s); off = r.next; } }
    const bodyOffsets = [];
    { let off = sections.get(2).offset; const num = rom.readUInt32LE(off); off += 4; for (let i = 0; i <= num; i++) { bodyOffsets.push(readU24(rom, off)); off += 3; } }
    const bodyDataStart = sections.get(3).offset;
    const headNames = [];
    { let off = sections.get(4).offset; const num = rom.readUInt16LE(off); off += 2; for (let i = 0; i < num; i++) { const r = readStr(rom, off); headNames.push(r.s); off = r.next; } }
    const builtinNames = [];
    { let off = sections.get(5).offset; const num = rom[off++]; for (let i = 0; i < num; i++) { const r = readStr(rom, off); builtinNames.push(r.s === '' ? null : r.s); off = r.next; } }
    const weights = [];
    { let off = sections.get(6).offset; const num = rom[off++]; for (let i = 0; i < num; i++) { weights.push(rom.readFloatLE(off)); off += 4; } }
    const paramKeys = [];
    { let off = sections.get(7).offset; const num = rom[off++]; for (let i = 0; i < num; i++) { const r = readStr(rom, off); paramKeys.push(r.s); off = r.next; } }
    const PARAM_PATTERN_FROM_ID = ['', 'Z', 'Y'];
    const headSigs = [];
    { let off = sections.get(10).offset; const num = rom.readUInt16LE(off); off += 2; for (let i = 0; i < num; i++) { const headNameId = rom.readUInt16LE(off); off += 2; const ppId = rom[off++]; const ps = PARAM_PATTERN_FROM_ID[ppId]; headSigs.push({ head: headNames[headNameId], headParams: ps === '' ? [] : [ps] }); } }
    const terminalsPerGrammar = [];
    { let off = sections.get(11).offset; const num = rom.readUInt16LE(off); off += 2; for (let i = 0; i < num; i++) { const count = rom[off++]; const list = []; for (let t = 0; t < count; t++) { const r = readStr(rom, off); list.push(r.s); off = r.next; } terminalsPerGrammar.push(list); } }
    const grammarMeta = [];
    {
        let off = sections.get(8).offset; const num = rom.readUInt16LE(off); off += 2;
        for (let i = 0; i < num; i++) {
            const f1 = readStr(rom, off); off = f1.next;
            const f2 = readStr(rom, off); off = f2.next;
            const numParams = rom[off++]; const params = [];
            for (let p = 0; p < numParams; p++) { const keyId = rom[off++]; const v = readStr(rom, off); off = v.next; params.push([paramKeys[keyId], v.s]); }
            const ruleStart = rom.readUInt32LE(off); off += 4; const ruleEnd = rom.readUInt32LE(off); off += 4;
            grammarMeta.push({ filename: f1.s, startSymbol: f2.s, parameters: params, ruleStart, ruleEnd });
        }
    }
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
            ruleHeaders.push({ head: sig.head, headParams: sig.headParams, headFixedArg: fixedArgRaw === 0xffff ? null : fixedArgRaw, bodyId, builtinName: builtinNames[builtinId], weight: weights[wFlags & 0x7f], isBase: (wFlags & 0x80) !== 0 });
        }
    }
    function decodeVarint(buf, start, end, out) {
        let off = start;
        while (off < end) { let n = 0, shift = 0; while (true) { const b = buf[off++]; n |= (b & 0x7f) << shift; if ((b & 0x80) === 0) break; shift += 7; } out.push(n); }
    }
    function maybeNum(s) { if (typeof s !== 'string') return s; const n = Number(s); if (!Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(s)) return n; return s; }
    function tokensToAst(toks) {
        let i = 0;
        function parse() {
            const t = toks[i++];
            if (t === 'L_EMPTY') return [];
            if (t === 'L_START') { const list = []; while (toks[i] !== 'L_END') list.push(parse()); i++; return list; }
            if (t.startsWith('X:')) { const parts = t.split(':'); return ['X', maybeNum(parts[1]), maybeNum(parts[2])]; }
            if (t.startsWith('SLOPE:')) { const parts = t.split(':'); const list = ['slope', Number(parts[1]), Number(parts[2])]; while (toks[i] !== 'SLOPE_END') list.push(parse()); i++; return list; }
            if (t.startsWith('L:')) { const firstAtom = t.slice(2); const list = [maybeNum(firstAtom)]; while (toks[i] !== 'L_END') list.push(parse()); i++; return list; }
            return maybeNum(t);
        }
        return parse();
    }
    const bodies = [];
    for (let bid = 0; bid < bodyOffsets.length - 1; bid++) {
        const start = bodyDataStart + bodyOffsets[bid];
        const end = bodyDataStart + bodyOffsets[bid + 1];
        const tokIds = []; decodeVarint(rom, start, end, tokIds);
        bodies.push(tokensToAst(tokIds.map(id => tokens[id])));
    }
    return grammarMeta.map((gm, gi) => {
        const rules = [];
        for (let i = gm.ruleStart; i < gm.ruleEnd; i++) {
            const rh = ruleHeaders[i];
            rules.push({ isBase: rh.isBase, head: rh.head, headParams: rh.headParams, headFixedArg: rh.headFixedArg, body: bodies[rh.bodyId], builtinName: rh.builtinName, weight: rh.weight });
        }
        return { filename: gm.filename, startSymbol: gm.startSymbol, parameters: gm.parameters, terminals: terminalsPerGrammar[gi] ?? [], rules };
    });
}

// ─────────────────────────────────────────────────────────────
// deepEqual + 整套 grammar 对比(含 terminals)
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
        for (let i = 0; i < a.length; i++) { const d = deepEqual(a[i], b[i], `${path}[${i}]`); if (d) return d; }
        return null;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
        if (ka.join(',') !== kb.join(',')) return `${path}: keys differ ${ka} vs ${kb}`;
        for (const k of ka) { const d = deepEqual(a[k], b[k], `${path}.${k}`); if (d) return d; }
        return null;
    }
    return `${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
}
function compareGrammar(a, b) {
    if (a.filename !== b.filename) return `filename ${a.filename} !== ${b.filename}`;
    if (a.startSymbol !== b.startSymbol) return `${a.filename} startSymbol`;
    if (a.parameters.length !== b.parameters.length) return `${a.filename} parameters.length`;
    for (let pi = 0; pi < a.parameters.length; pi++) {
        if (a.parameters[pi][0] !== b.parameters[pi][0] || a.parameters[pi][1] !== b.parameters[pi][1]) return `${a.filename} param[${pi}]`;
    }
    if (a.terminals.length !== b.terminals.length) return `${a.filename} terminals.length ${a.terminals.length} !== ${b.terminals.length}`;
    for (let ti = 0; ti < a.terminals.length; ti++) if (a.terminals[ti] !== b.terminals[ti]) return `${a.filename} terminals[${ti}] ${a.terminals[ti]} !== ${b.terminals[ti]}`;
    if (a.rules.length !== b.rules.length) return `${a.filename} rules.length ${a.rules.length} !== ${b.rules.length}`;
    for (let ri = 0; ri < a.rules.length; ri++) { const d = deepEqual(a.rules[ri], b.rules[ri], `${a.filename}.rules[${ri}]`); if (d) return d; }
    return null;
}

// ─────────────────────────────────────────────────────────────
// Seeded PRNG(mulberry32)— 失败可复现
// ─────────────────────────────────────────────────────────────
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const ri = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const astDepth = (x) => Array.isArray(x) ? 1 + x.reduce((m, e) => Math.max(m, astDepth(e)), 0) : 0;
const astNodes = (x) => Array.isArray(x) ? 1 + x.reduce((s, e) => s + astNodes(e), 0) : 1;

// codec 支持域内的安全 atom:不撞 marker、不以 X:/SLOPE:/L: 开头、非纯数字字符串
const MARKERS = new Set(['L_START', 'L_END', 'L_EMPTY', 'SLOPE_END']);
const STR_ATOM_POOL = ['note', 'rest', 'c', 'd', 'e', 'f', 'g', 'a', 'b', 'swing', 'P_', 'tri', 'col',
    '音', 'café', 'Ω', 'naïve', 'Ø', 'D#', 'Bb', 'maj7'];
function isSafeAtomStr(s) {
    if (typeof s !== 'string') return true;
    if (MARKERS.has(s)) return false;
    if (s.startsWith('X:') || s.startsWith('SLOPE:') || s.startsWith('L:')) return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return false; // 数字字符串会被 maybeNum 转 number → 破坏 string 不变量
    return true;
}
function safeAtom(rng) {
    if (rng() < 0.45) return ri(rng, -50, 300);               // number atom
    // 边界:body atom 可能作 list 首位 → 编码成 `L:<atom>` token(+2 字节前缀)。
    // token 受 writeStrU8Len 的 255 字节上限约束,故首位 atom 最长 253 字节(L:+253=255)。
    if (rng() < 0.05) return 'z'.repeat(253);
    const s = pick(rng, STR_ATOM_POOL) + (rng() < 0.5 ? '' : ri(rng, 0, 99));
    return isSafeAtomStr(s) ? s : 'sym' + ri(rng, 0, 999);
}
// 生成 body(list);depth = 最大嵌套深;budget.n = 全树节点预算(防 deep×wide 指数爆炸,
// 也把单 body 字节数压在 u24 body-offset 上限 ~16MB 之下);bias 控制边界倾向。
function genBody(rng, depth, bias, budget) {
    if (bias.empty && rng() < 0.25) return [];
    const maxLen = bias.wide ? 30 : (bias.deep ? 5 : 6);
    const len = ri(rng, 0, maxLen);
    const recurseProb = bias.deep ? 0.7 : (bias.wide ? 0.1 : 0.25);
    const list = [];
    // 首元素:atom(走 L:)或 list(走 L_START)
    if (depth > 0 && budget.n > 0 && rng() < recurseProb) { budget.n--; list.push(genBody(rng, depth - 1, bias, budget)); }
    else list.push(safeAtom(rng));
    for (let i = 1; i < len; i++) {
        budget.n--;
        const r = rng();
        if (depth > 0 && budget.n > 0 && r < recurseProb) list.push(genBody(rng, depth - 1, bias, budget));
        else if (r < 0.55) list.push(safeAtom(rng));
        else if (r < 0.7) list.push(['X', ri(rng, 0, 64), ri(rng, 0, 64)]);                 // X 特殊形式
        else if (r < 0.8) { const sl = ['slope', ri(rng, -8, 8), ri(rng, -8, 8)]; const k = ri(rng, 0, 3); for (let j = 0; j < k; j++) sl.push(safeAtom(rng)); list.push(sl); } // slope
        else if (r < 0.85) list.push([]);                                                    // 空 list 元素
        else list.push(safeAtom(rng));
    }
    return list;
}
const HEAD_POOL = ['P', 'A', 'B', 'Sub', 'Q', 'Seg', 'Motif', 'BRICK', 'Phrase', 'V'];
function genRule(rng, bias, bodyCache, weightPool) {
    let body;
    if (bias.dupBody && bodyCache.length > 0 && rng() < 0.6) body = bodyCache[Math.floor(rng() * bodyCache.length)];
    else {
        // 维度分离:深嵌套走极深+窄+大预算;宽 body 走浅+极宽;多 rule 走浅+小预算;其余适中
        const depth = bias.deep ? ri(rng, 8, 18) : bias.wide ? 2 : bias.manyRules ? ri(rng, 0, 2) : ri(rng, 1, 4);
        const budgetN = bias.deep ? 2000 : bias.wide ? 2000 : bias.manyRules ? 24 : 200;
        body = genBody(rng, depth, bias, { n: budgetN });
        bodyCache.push(body);
    }
    return {
        isBase: rng() < 0.25,
        head: pick(rng, HEAD_POOL) + (rng() < 0.4 ? ri(rng, 0, 20) : ''),
        headParams: pick(rng, [[], [], ['Z'], ['Y']]),
        headFixedArg: rng() < 0.4 ? ri(rng, 0, 65534) : null,
        body,
        builtinName: rng() < 0.2 ? `bt${ri(rng, 0, 5)}:nm${ri(rng, 0, 9)}` : null,
        weight: pick(rng, weightPool),
    };
}
function genGrammarSet(rng, round) {
    // 按轮次切换边界偏置 mode
    const mode = round % 9;
    const bias = {
        empty: mode === 0, deep: mode === 1, wide: mode === 2, dupBody: mode === 3,
        maxTerm: mode === 4, manyWeights: mode === 5, unicode: mode === 6, manyRules: mode === 7,
        // mode 8 = mixed/default
    };
    // weight pool:manyWeights 模式逼近 127 上限
    const wn = bias.manyWeights ? ri(rng, 100, 127) : ri(rng, 1, 30);
    const weightPool = [];
    const wseen = new Set();
    while (weightPool.length < wn) { const w = rng() < 0.7 ? ri(rng, 1, 500) : Math.round(rng() * 1000) / 100; if (!wseen.has(w)) { wseen.add(w); weightPool.push(w); } }
    // manyRules 模式 grammar 数压小(单 grammar 塞极多 rule);其余适度放大到 ≤18
    const nG = bias.empty ? ri(rng, 1, 3) : bias.manyRules ? ri(rng, 1, 4) : ri(rng, 2, 18);
    const grammars = [];
    const bodyCache = [];
    for (let gi = 0; gi < nG; gi++) {
        const nR = bias.empty && rng() < 0.4 ? 0
            : bias.manyRules ? ri(rng, 200, 600)   // 每 grammar 极多 rule(原上限 60)
            : bias.deep ? ri(rng, 0, 10)
            : ri(rng, 0, 50);
        const rules = [];
        for (let r = 0; r < nR; r++) rules.push(genRule(rng, bias, bodyCache, weightPool));
        const nP = ri(rng, 0, 5);
        const parameters = [];
        for (let p = 0; p < nP; p++) parameters.push([`pk${ri(rng, 0, 40)}`, bias.unicode && rng() < 0.5 ? `值${ri(rng, 0, 99)}` : `${rng() < 0.5 ? ri(rng, 0, 999) : 'val' + ri(rng, 0, 99)}`]);
        // 去重 param key(编码器按 key 去重,但每 grammar 内重复 key 会被原样写两条;真解析也如此 → 保留)
        const tN = bias.maxTerm ? ri(rng, 200, 255) : ri(rng, 0, 12);
        const terminals = [];
        for (let t = 0; t < tN; t++) {
            // terminals 直接存储(无前缀)→ 可测 writeStrU8Len 的 255 字节精确边界
            if (rng() < 0.03) terminals.push('t'.repeat(255));
            else terminals.push(bias.unicode && rng() < 0.4 ? `终${t}` : pick(rng, ['X2', 'X4', 'X8', 'C4', 'A8', 'L4', 'R8', 'S16', 'slope', 'X4/3']) + (rng() < 0.3 ? '' : t));
        }
        grammars.push({
            filename: `fuzz_r${round}_g${gi}.grammar`,
            startSymbol: pick(rng, ['P', 'P_motif', 'Start', 'Q0']),
            parameters,
            terminals,
            rules,
        });
    }
    return grammars;
}

// ─────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────
let failed = false;

console.log('━━━ STEP 1 — buildRom(真语料) 必须逐字节 == 磁盘 grammars.rom ━━━');
const gt = parseGroundTruth();
const builtRom = buildRom(gt);
const diskRom = readFileSync(ROM_PATH);
if (builtRom.length === diskRom.length && builtRom.equals(diskRom)) {
    console.log(`  ✓ 逐字节一致 (${builtRom.length} B) — 本脚本 buildRom == 真实 precompile 编码器`);
} else {
    failed = true;
    console.log(`  ✗ 不一致: built ${builtRom.length} B vs disk ${diskRom.length} B`);
}

console.log('\n━━━ STEP 2 — decodeRom(磁盘 ROM) vs 真语料解析 必须 0 mismatch ━━━');
const decDisk = decodeRom(diskRom);
let step2mis = 0;
for (let i = 0; i < gt.length; i++) { const d = compareGrammar(gt[i], decDisk[i]); if (d) { step2mis++; if (step2mis <= 5) console.log(`  ✗ ${d}`); } }
if (step2mis === 0) console.log(`  ✓ 85 grammars / ${gt.reduce((s, g) => s + g.rules.length, 0)} rules 全 byte-exact — 本脚本 decodeRom == verify 解码器`);
else { failed = true; console.log(`  ✗ ${step2mis} mismatches`); }

console.log(`\n━━━ STEP 3 — ${ROUNDS} 轮随机数据 round-trip (random → buildRom → decodeRom → deep-equal) ━━━`);
const modeNames = ['empty/sparse', 'deep-nest', 'wide-body', 'dup-body', 'max-terminals(≤255)', 'many-weights(→127)', 'unicode', 'many-rules', 'mixed'];
let totalG = 0, totalR = 0, roundFail = 0;
let maxRules = 0, maxDepth = 0, maxNodes = 0;
for (let round = 0; round < ROUNDS; round++) {
    const rng = mulberry32(((0xC0FFEE + round * 2654435761) >>> 0) ^ 0x9E3779B9);
    let grammars;
    try { grammars = genGrammarSet(rng, round); } catch (e) { console.log(`  ✗ round ${round} gen error: ${e.message}`); failed = true; roundFail++; continue; }
    let rom, dec, mism = null;
    try {
        rom = buildRom(grammars);
        dec = decodeRom(rom);
        if (dec.length !== grammars.length) mism = `grammar count ${dec.length} !== ${grammars.length}`;
        else for (let i = 0; i < grammars.length && !mism; i++) mism = compareGrammar(grammars[i], dec[i]);
    } catch (e) { mism = `EXCEPTION: ${e.message}`; }
    const gN = grammars.length, rN = grammars.reduce((s, g) => s + g.rules.length, 0);
    totalG += gN; totalR += rN;
    for (const g of grammars) {
        if (g.rules.length > maxRules) maxRules = g.rules.length;
        for (const r of g.rules) { const d = astDepth(r.body); if (d > maxDepth) maxDepth = d; const n = astNodes(r.body); if (n > maxNodes) maxNodes = n; }
    }
    if (mism) {
        failed = true; roundFail++;
        console.log(`  ✗ round ${round} [${modeNames[round % 9]}] seed-derived: ${mism}`);
    } else if (round % 10 === 9 || round === ROUNDS - 1) {
        console.log(`  ✓ rounds 0..${round} ok  (cum ${totalG} grammars / ${totalR} rules; last mode=${modeNames[round % 9]}, ${gN}g/${rN}r)`);
    }
}

console.log('\n━━━ Result ━━━');
console.log(`STEP 3: ${ROUNDS - roundFail}/${ROUNDS} rounds passed,${totalG} random grammars / ${totalR} rules round-tripped`);
console.log(`极端规模触达: max ${maxRules} rules/grammar · max nesting depth ${maxDepth} · max ${maxNodes} nodes/body`);
if (!failed) { console.log('✓ 全部通过 — codec 在随机 + 边界数据上 round-trip 无损'); process.exit(0); }
else { console.log('✗ 存在失败(见上)'); process.exit(1); }
