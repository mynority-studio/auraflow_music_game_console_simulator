#!/usr/bin/env node
// ============================================================
// precompile-grammars.mjs — Impro-Visor .grammar → 紧凑二进制 .rom
// ============================================================
//
// 目标:把 85 个 .grammar 文件(4.7 MB Lisp text)无损压缩成单个紧凑二进制
//      ROM(~991 KB),支持 ESP32-S3 byte-offset 随机访问 / 零运行时解压。
//
// 输入:src/core/generation/improCore/data/grammars/*.grammar
// 输出:
//   * src/core/generation/improCore/data/grammars.rom        ← 嵌入式二进制
//   * src/core/generation/improCore/data/grammars-rom-bytes.ts  ← web 端 base64 inline
//
// 无损保证:
//   * Token table 全收录(decode 后 atom 字面还原)
//   * Body 字面去重(同流共享 ID)
//   * Weight 用 index → f32 lookup table(精度无损)
//   * Head / params / builtin name 走 lookup table
//
// 用法:npm run precompile-grammars
//
// ROM Schema 文档见底部 ROM_LAYOUT 注释。
// ============================================================

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const GRAMMAR_DIR = join(PROJECT_ROOT, 'src/core/generation/improCore/data/grammars');
const ROM_PATH = join(PROJECT_ROOT, 'src/core/generation/improCore/data/grammars.rom');
const TS_PATH = join(PROJECT_ROOT, 'src/core/generation/improCore/data/grammars-rom-bytes.ts');

// ─────────────────────────────────────────────────────────────
// S-expression parser
// ─────────────────────────────────────────────────────────────
function stripComments(s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*;.*$/gm, '');
}
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
        // 对齐 Impro-Visor Tokenizer:整数/小数(含前导点 .9)/科学计数法(5.0E-4)
        if (!Number.isNaN(n) && /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(a)) return n;
        return a;
    }
    idx.i++;
    const list = [];
    while (idx.i < tokens.length && tokens[idx.i] !== ')') list.push(parseSexpr(tokens, idx));
    idx.i++;
    return list;
}

// ─────────────────────────────────────────────────────────────
// Parse 85 .grammar 文件
// ─────────────────────────────────────────────────────────────
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
            if (head === 'startsymbol' && item.length >= 2) {
                startSymbol = String(item[1]);
            } else if (head === 'parameter' && item.length >= 2 && Array.isArray(item[1])) {
                parameters.push([String(item[1][0]), String(item[1][1])]);
            } else if (head === 'terminals') {
                // (terminals X2 X4 ... slope) — 保序、保重复,逐字符串收录
                if (terminals.length > 0) throw new Error(`Multiple terminals forms in ${f}`);
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
    } catch (e) {
        console.warn(`Parse failed: ${f}: ${e.message}`);
    }
    grammars.push({ filename: f, startSymbol, parameters, terminals, rules });
}

console.log(`Parsed ${grammars.length} grammars,${grammars.reduce((s,g) => s + g.rules.length, 0)} rules`);

// ─────────────────────────────────────────────────────────────
// Token table(body 内所有 atomic / list-marker token)
// ─────────────────────────────────────────────────────────────
const tokenFreq = new Map();
function visitTokens(item, emit) {
    if (!Array.isArray(item)) { emit(String(item)); return; }
    if (item.length === 0) { emit('L_EMPTY'); return; }
    if (item.length === 3 && item[0] === 'X') {
        emit(`X:${item[1]}:${item[2]}`);
        return;
    }
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
for (const g of grammars) {
    for (const r of g.rules) visitTokens(r.body, (t) => tokenFreq.set(t, (tokenFreq.get(t)||0)+1));
}
const sortedTokens = Array.from(tokenFreq.entries()).sort((a,b) => b[1]-a[1]).map(([t]) => t);
const tokenIdMap = new Map(sortedTokens.map((t, i) => [t, i]));
console.log(`Token table: ${sortedTokens.length} unique`);

// Encode body → varint stream of token IDs + dedup
function varintEncode(n, out) {
    while (n >= 0x80) {
        out.push((n & 0x7f) | 0x80);
        n >>>= 7;
    }
    out.push(n);
}
function encodeBody(body) {
    const ids = [];
    visitTokens(body, (t) => ids.push(tokenIdMap.get(t)));
    const out = [];
    for (const id of ids) varintEncode(id, out);
    return Buffer.from(out);
}
const bodyKeyToId = new Map();
const bodyBlobs = [];
for (const g of grammars) {
    for (const r of g.rules) {
        const buf = encodeBody(r.body);
        const key = buf.toString('binary');
        if (!bodyKeyToId.has(key)) {
            bodyKeyToId.set(key, bodyBlobs.length);
            bodyBlobs.push(buf);
        }
        r.bodyId = bodyKeyToId.get(key);
    }
}
const totalBodyBytes = bodyBlobs.reduce((s, b) => s + b.length, 0);
console.log(`Body blobs: ${bodyBlobs.length} unique(去重 ${((1 - bodyBlobs.length / grammars.reduce((s,g)=>s+g.rules.length,0)) * 100).toFixed(1)}%),total ${(totalBodyBytes/1024).toFixed(1)} KB`);

// ─────────────────────────────────────────────────────────────
// Head signature table((head_name, params) → sigId)
// ─────────────────────────────────────────────────────────────
const PARAM_PATTERN_TO_ID = new Map([['', 0], ['Z', 1], ['Y', 2]]);
const globalHeadNames = [];
const globalHeadId = new Map();
const headSigList = []; // [{ headNameId, paramPatternId }]
const headSigId = new Map();
for (const g of grammars) {
    for (const r of g.rules) {
        if (!globalHeadId.has(r.head)) {
            globalHeadId.set(r.head, globalHeadNames.length);
            globalHeadNames.push(r.head);
        }
        const paramSig = r.headParams.join(',');
        if (!PARAM_PATTERN_TO_ID.has(paramSig)) throw new Error(`Unknown param pattern: [${paramSig}] for head ${r.head}`);
        const paramPatternId = PARAM_PATTERN_TO_ID.get(paramSig);
        const sigKey = `${r.head}|${paramSig}`;
        if (!headSigId.has(sigKey)) {
            headSigId.set(sigKey, headSigList.length);
            headSigList.push({ headNameId: globalHeadId.get(r.head), paramPatternId });
        }
        r.headSigId = headSigId.get(sigKey);
    }
}
if (globalHeadNames.length > 65535) throw new Error(`Global heads > 65535`);
if (headSigList.length > 65535) throw new Error(`Head sigs > 65535`);
console.log(`Head names: global ${globalHeadNames.length},signatures ${headSigList.length}`);

// ─────────────────────────────────────────────────────────────
// Builtin / Weight / ParamKey tables
// ─────────────────────────────────────────────────────────────
const builtinNames = [null];
const builtinId = new Map([[null, 0]]);
for (const g of grammars) {
    for (const r of g.rules) {
        if (r.builtinName && !builtinId.has(r.builtinName)) {
            builtinId.set(r.builtinName, builtinNames.length);
            builtinNames.push(r.builtinName);
        }
        r.builtinId = builtinId.get(r.builtinName ?? null);
    }
}
console.log(`Builtin names: ${builtinNames.length} (含 sentinel)`);

const weightSet = new Set();
for (const g of grammars) for (const r of g.rules) weightSet.add(r.weight);
const weightTable = Array.from(weightSet).sort((a,b) => a - b);
const weightId = new Map(weightTable.map((w, i) => [w, i]));
if (weightTable.length > 127) throw new Error(`Weight unique > 127: ${weightTable.length}`);
for (const g of grammars) for (const r of g.rules) r.weightId = weightId.get(r.weight);
console.log(`Weight table: ${weightTable.length} unique`);

const paramKeys = [];
const paramKeyId = new Map();
for (const g of grammars) {
    for (const [k] of g.parameters) {
        if (!paramKeyId.has(k)) {
            paramKeyId.set(k, paramKeys.length);
            paramKeys.push(k);
        }
    }
}
console.log(`Param keys: ${paramKeys.length} unique`);

// ─────────────────────────────────────────────────────────────
// Section IDs
// ─────────────────────────────────────────────────────────────
const SECTION_TOKEN_TABLE     = 1;
const SECTION_BODY_OFFSET     = 2;
const SECTION_BODY_DATA       = 3;
const SECTION_HEAD_NAME       = 4;
const SECTION_BUILTIN_NAME    = 5;
const SECTION_WEIGHT_TABLE    = 6;
const SECTION_PARAM_KEY_TABLE = 7;
const SECTION_GRAMMAR_INDEX   = 8;
const SECTION_RULE_INDEX      = 9;
const SECTION_HEAD_SIG        = 10;
const SECTION_TERMINALS       = 11;

// 字节 builder helpers
function writeStrU8Len(buf, s) {
    const b = Buffer.from(s, 'utf8');
    if (b.length > 255) throw new Error(`String > 255 bytes: ${s}`);
    buf.push(b.length, ...b);
}
function writeU16LE(buf, n) { buf.push(n & 0xff, (n>>>8) & 0xff); }
function writeU24LE(buf, n) { buf.push(n & 0xff, (n>>>8) & 0xff, (n>>>16) & 0xff); }
function writeU32LE(buf, n) { buf.push(n & 0xff, (n>>>8) & 0xff, (n>>>16) & 0xff, (n>>>24) & 0xff); }
function writeF32LE(buf, f) {
    const tmp = Buffer.alloc(4);
    tmp.writeFloatLE(f, 0);
    buf.push(...tmp);
}

// Section 1: TOKEN_TABLE
const tokenSect = [];
writeU32LE(tokenSect, sortedTokens.length);
for (const t of sortedTokens) writeStrU8Len(tokenSect, t);

// Section 2: BODY_OFFSET(cumulative u24 + sentinel)
const bodyOffsetSect = [];
writeU32LE(bodyOffsetSect, bodyBlobs.length);
let off = 0;
for (const b of bodyBlobs) {
    writeU24LE(bodyOffsetSect, off);
    off += b.length;
}
writeU24LE(bodyOffsetSect, off);

// Section 3: BODY_DATA
const bodyDataSect = [];
for (const b of bodyBlobs) bodyDataSect.push(...b);

// Section 4: HEAD_NAME
const headNameSect = [];
writeU16LE(headNameSect, globalHeadNames.length);
for (const n of globalHeadNames) writeStrU8Len(headNameSect, n);

// Section 5: BUILTIN_NAME
const builtinNameSect = [];
builtinNameSect.push(builtinNames.length);
for (const n of builtinNames) writeStrU8Len(builtinNameSect, n ?? '');

// Section 6: WEIGHT_TABLE
const weightSect = [];
weightSect.push(weightTable.length);
for (const w of weightTable) writeF32LE(weightSect, w);

// Section 7: PARAM_KEY_TABLE
const paramKeySect = [];
paramKeySect.push(paramKeys.length);
for (const k of paramKeys) writeStrU8Len(paramKeySect, k);

// Section 8: GRAMMAR_INDEX
const grammarIndexSect = [];
writeU16LE(grammarIndexSect, grammars.length);
let ruleCursor = 0;
for (const g of grammars) {
    writeStrU8Len(grammarIndexSect, g.filename);
    writeStrU8Len(grammarIndexSect, g.startSymbol);
    grammarIndexSect.push(g.parameters.length);
    for (const [k, v] of g.parameters) {
        grammarIndexSect.push(paramKeyId.get(k));
        writeStrU8Len(grammarIndexSect, String(v));
    }
    writeU32LE(grammarIndexSect, ruleCursor);
    ruleCursor += g.rules.length;
    writeU32LE(grammarIndexSect, ruleCursor);
}

// Section 9: RULE_INDEX(9 B/rule)
const ruleIndexSect = [];
let ruleCount = 0;
for (const g of grammars) {
    for (const r of g.rules) {
        writeU16LE(ruleIndexSect, r.headSigId);
        writeU16LE(ruleIndexSect, r.headFixedArg === null ? 0xffff : r.headFixedArg);
        writeU24LE(ruleIndexSect, r.bodyId);
        ruleIndexSect.push(r.builtinId);
        const w = r.weightId | (r.isBase ? 0x80 : 0);
        ruleIndexSect.push(w);
        ruleCount++;
    }
}

// Section 10: HEAD_SIG(u16 num + N × (u16 headNameId + u8 paramPatternId))
const headSigSect = [];
writeU16LE(headSigSect, headSigList.length);
for (const sig of headSigList) {
    writeU16LE(headSigSect, sig.headNameId);
    headSigSect.push(sig.paramPatternId);
}

// Section 11: TERMINALS(per-grammar,positional — 与 GRAMMAR_INDEX 同序)
const terminalsSect = [];
writeU16LE(terminalsSect, grammars.length);
for (const g of grammars) {
    if (g.terminals.length > 255) throw new Error(`Terminals count > 255 in ${g.filename}`);
    terminalsSect.push(g.terminals.length);
    for (const t of g.terminals) writeStrU8Len(terminalsSect, t);
}
const grammarsWithTerminals = grammars.filter(g => g.terminals.length > 0).length;
console.log(`Terminals: ${grammarsWithTerminals}/${grammars.length} grammars have a terminals form`);

// ─────────────────────────────────────────────────────────────
// Assemble ROM
// ─────────────────────────────────────────────────────────────
const sections = [
    { id: SECTION_TOKEN_TABLE,     data: Buffer.from(tokenSect) },
    { id: SECTION_BODY_OFFSET,     data: Buffer.from(bodyOffsetSect) },
    { id: SECTION_BODY_DATA,       data: Buffer.from(bodyDataSect) },
    { id: SECTION_HEAD_NAME,       data: Buffer.from(headNameSect) },
    { id: SECTION_BUILTIN_NAME,    data: Buffer.from(builtinNameSect) },
    { id: SECTION_WEIGHT_TABLE,    data: Buffer.from(weightSect) },
    { id: SECTION_PARAM_KEY_TABLE, data: Buffer.from(paramKeySect) },
    { id: SECTION_GRAMMAR_INDEX,   data: Buffer.from(grammarIndexSect) },
    { id: SECTION_RULE_INDEX,      data: Buffer.from(ruleIndexSect) },
    { id: SECTION_HEAD_SIG,        data: Buffer.from(headSigSect) },
    { id: SECTION_TERMINALS,       data: Buffer.from(terminalsSect) },
];

const HEADER_BYTES = 16;
const SECT_TABLE_ENTRY_BYTES = 12;
const sectTableBytes = sections.length * SECT_TABLE_ENTRY_BYTES;
let currentOff = HEADER_BYTES + sectTableBytes;

const headerBuf = Buffer.alloc(HEADER_BYTES);
headerBuf.write('GRM1', 0, 'ascii');
headerBuf.writeUInt32LE(2, 4); // v2: + SECTION_TERMINALS (11)
headerBuf.writeUInt32LE(sections.length, 8);
headerBuf.writeUInt32LE(ruleCount, 12);

const sectTableBuf = Buffer.alloc(sectTableBytes);
sections.forEach((s, i) => {
    sectTableBuf.writeUInt32LE(s.id, i * SECT_TABLE_ENTRY_BYTES);
    sectTableBuf.writeUInt32LE(currentOff, i * SECT_TABLE_ENTRY_BYTES + 4);
    sectTableBuf.writeUInt32LE(s.data.length, i * SECT_TABLE_ENTRY_BYTES + 8);
    currentOff += s.data.length;
});

const rom = Buffer.concat([headerBuf, sectTableBuf, ...sections.map(s => s.data)]);
writeFileSync(ROM_PATH, rom);
console.log(`\n→ wrote ${ROM_PATH} (${rom.length} bytes = ${(rom.length/1024).toFixed(2)} KB)`);

// ─────────────────────────────────────────────────────────────
// 同时输出 base64 inline TS module(web 端 sync import)
// ─────────────────────────────────────────────────────────────
const base64 = rom.toString('base64');
const tsContent = `// Auto-generated by scripts/precompile-grammars.mjs — DO NOT EDIT BY HAND.
// 85 .grammar files (4.7 MB Lisp) compiled to ${(rom.length/1024).toFixed(2)} KB binary ROM (lossless).
// Decoded by grammar-rom-reader.ts → GrammarData[] (drop-in for old grammar-parser.ts glob).

export const GRAMMARS_ROM_BASE64 = ${JSON.stringify(base64)};
`;
writeFileSync(TS_PATH, tsContent);
console.log(`→ wrote ${TS_PATH} (${tsContent.length} bytes, base64 inflate ${(base64.length/rom.length*100 - 100).toFixed(1)}%)`);

// ─────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────
console.log(`\n=== Section breakdown ===`);
sections.forEach(s => {
    const name = {
        [SECTION_TOKEN_TABLE]:     'TOKEN_TABLE',
        [SECTION_BODY_OFFSET]:     'BODY_OFFSET',
        [SECTION_BODY_DATA]:       'BODY_DATA',
        [SECTION_HEAD_NAME]:       'HEAD_NAME',
        [SECTION_BUILTIN_NAME]:    'BUILTIN_NAME',
        [SECTION_WEIGHT_TABLE]:    'WEIGHT_TABLE',
        [SECTION_PARAM_KEY_TABLE]: 'PARAM_KEY_TABLE',
        [SECTION_GRAMMAR_INDEX]:   'GRAMMAR_INDEX',
        [SECTION_RULE_INDEX]:      'RULE_INDEX',
        [SECTION_HEAD_SIG]:        'HEAD_SIG',
        [SECTION_TERMINALS]:       'TERMINALS',
    }[s.id];
    console.log(`  ${name.padEnd(20)} ${(s.data.length/1024).toFixed(2).padStart(8)} KB  (${(s.data.length*100/rom.length).toFixed(1)}%)`);
});
const origBytes = files.reduce((s, f) => s + readFileSync(join(GRAMMAR_DIR, f)).length, 0);
console.log(`\nOriginal corpus: ${(origBytes/1024).toFixed(1)} KB`);
console.log(`ROM:             ${(rom.length/1024).toFixed(1)} KB (${(rom.length*100/origBytes).toFixed(1)}% of orig)`);
console.log(`1 MB margin:     ${((1024*1024 - rom.length)/1024).toFixed(1)} KB ${rom.length > 1024*1024 ? '!!! OVER BUDGET !!!' : '✓'}`);

/*
ROM_LAYOUT(grammars.rom):

  Header(16 B):
    [0..4)   magic           = 'GRM1' (0x47 0x52 0x4D 0x31)
    [4..8)   version         = u32 LE (2 = + TERMINALS section)
    [8..12)  section_count   = u32 LE
    [12..16) total_rule_count= u32 LE

  Section Table(section_count × 12 B):
    [0..4)   section_id      = u32 LE (1..10)
    [4..8)   offset          = u32 LE
    [8..12)  length          = u32 LE

  Sections(顺序无关,通过 section table 寻址):
    1 TOKEN_TABLE:     u32 num + N × (u8 len + UTF-8)
    2 BODY_OFFSET:     u32 num + (num+1) × u24 cumulative offset (last = total)
    3 BODY_DATA:       concatenated varint streams (each = encoded token IDs)
    4 HEAD_NAME:       u16 num + N × (u8 len + UTF-8)
    5 BUILTIN_NAME:    u8 num + N × (u8 len + UTF-8) (index 0 = '' sentinel)
    6 WEIGHT_TABLE:    u8 num + N × f32 LE
    7 PARAM_KEY_TABLE: u8 num + N × (u8 len + UTF-8)
    8 GRAMMAR_INDEX:   u16 num + N × { u8+name, u8+startSym, u8 nP + nP×(u8 keyId+u8+val), u32 ruleStart, u32 ruleEnd }
    9 RULE_INDEX:      total_rule_count × 9 B { u16 sigId, u16 fixedArg(0xffff=none), u24 bodyId, u8 builtinId, u8 weightId|isBase }
   10 HEAD_SIG:        u16 num + N × (u16 headNameId + u8 paramPatternId)
                       paramPattern: 0=[] 1=[Z] 2=[Y]
   11 TERMINALS:       u16 num (= grammar count, GRAMMAR_INDEX order)
                       + num × { u8 count + count × (u8 len + UTF-8) }
                       count=0 = grammar 无 (terminals ...) 形式
*/
