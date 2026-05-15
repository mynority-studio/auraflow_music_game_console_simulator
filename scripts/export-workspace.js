#!/usr/bin/env node
/**
 * export-workspace.js — 一键打包全量源码 → 单一 Markdown 上下文
 *
 * 用途：把 src/ + scripts/ + 项目根配置文件聚合为 ALL_SOURCE_CODE.md，
 *      供 LLM 全量阅读 / 审计 / 重构对话使用。
 *
 * 用法：
 *   node scripts/export-workspace.js
 *
 * 输出：
 *   <repo-root>/ALL_SOURCE_CODE.md
 *
 * 设计原则：
 *   1. 零外部依赖 — 仅 node:fs / node:path / node:url（Node 18+ 内置）
 *   2. 健壮 — 任何 CWD 调用都解析到项目根；二进制 / lock 文件强过滤
 *   3. 字节精确 — Source Dump 段不省略不裁剪，含 ``` 时自动加长 fence
 *   4. 确定性 — 目录遍历有固定排序（先目录后文件，字典序），便于 diff
 */

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// 配置
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const OUTPUT_FILE  = join(PROJECT_ROOT, 'ALL_SOURCE_CODE.md');

/** 目录树仅渲染该子目录 */
const TREE_ROOT_REL = 'src';

/** 扫描根（相对 PROJECT_ROOT，递归遍历） */
const SCAN_ROOTS_REL = ['src', 'scripts'];

/** 项目根追加的单文件（不递归，仅按名取） */
const ROOT_FILES = [
    'package.json',
    'tsconfig.json',
    'tsconfig.node.json',
    'vite.config.ts',
    'vite.config.js',
    'index.html',
    'README.md',
    'CLAUDE.md',
];

const EXCLUDED_DIRS = new Set([
    'node_modules', '.git', '.svn', '.hg',
    'dist', 'build', 'out', '.next', '.nuxt', '.cache', '.turbo',
    'coverage', '.nyc_output',
    '.vscode', '.idea',
    '.vite', '.parcel-cache',
    'public',  // 通常含 SF2 / 图片 / 字体
]);

/** 文件名级别黑名单（防 lockfile / build artifact 等大文件混入） */
const EXCLUDED_FILES = new Set([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'tsconfig.tsbuildinfo',
    'ALL_SOURCE_CODE.md',  // 防自包含
]);

/** 文本扩展白名单（小写） */
const INCLUDED_EXTS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.json',
    '.html', '.css', '.scss',
    '.md',
]);

/** Markdown code fence 语言标签 */
const LANG_MAP = {
    '.ts':   'ts',
    '.tsx':  'tsx',
    '.js':   'js',
    '.jsx':  'jsx',
    '.mjs':  'js',
    '.cjs':  'js',
    '.json': 'json',
    '.html': 'html',
    '.css':  'css',
    '.scss': 'scss',
    '.md':   'md',
};

/** 表格中摘要的最大字符长度（在句号处优先断开） */
const MAX_DESC_CHARS = 240;

// ============================================================
// 路径与过滤
// ============================================================

function toPosixRel(absPath) {
    return relative(PROJECT_ROOT, absPath).split(sep).join('/');
}

function isExcludedDir(name) {
    return EXCLUDED_DIRS.has(name);
}

function isIncludedFile(name) {
    if (EXCLUDED_FILES.has(name)) return false;
    return INCLUDED_EXTS.has(extname(name).toLowerCase());
}

/**
 * 一对目录排序比较器 — 先目录后文件，组内字典序。
 * 用于目录树与文件枚举的确定性输出。
 */
function entrySort(a, b) {
    const da = a.isDirectory() ? 0 : 1;
    const db = b.isDirectory() ? 0 : 1;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
}

// ============================================================
// 文件枚举
// ============================================================

function walkDir(absDir, out) {
    let entries;
    try {
        entries = readdirSync(absDir, { withFileTypes: true });
    } catch (err) {
        console.warn(`[skip] cannot read dir: ${absDir} (${err.code})`);
        return;
    }
    entries.sort(entrySort);
    for (const entry of entries) {
        // 跳过隐藏文件 / 目录（.开头）— 用户可在 ROOT_FILES 显式补回
        if (entry.name.startsWith('.')) continue;

        const absPath = join(absDir, entry.name);
        if (entry.isDirectory()) {
            if (isExcludedDir(entry.name)) continue;
            walkDir(absPath, out);
        } else if (entry.isFile() && isIncludedFile(entry.name)) {
            out.push(absPath);
        }
    }
}

function collectFiles() {
    const files = [];
    for (const rel of SCAN_ROOTS_REL) {
        const abs = join(PROJECT_ROOT, rel);
        if (!existsSync(abs)) continue;
        const st = statSync(abs);
        if (st.isDirectory()) walkDir(abs, files);
        else if (st.isFile() && isIncludedFile(basename(abs))) files.push(abs);
    }
    for (const rel of ROOT_FILES) {
        const abs = join(PROJECT_ROOT, rel);
        if (!existsSync(abs)) continue;
        if (!statSync(abs).isFile()) continue;
        if (!isIncludedFile(basename(abs))) continue;
        files.push(abs);
    }
    // 去重 + 按相对路径排序（确定性输出）
    const seen = new Set();
    const out  = [];
    for (const f of files) {
        if (seen.has(f)) continue;
        seen.add(f);
        out.push(f);
    }
    out.sort((a, b) => toPosixRel(a).localeCompare(toPosixRel(b)));
    return out;
}

// ============================================================
// 目录树渲染
// ============================================================
//
// 输出风格：
//   src/
//   ├── apps/
//   │   ├── AuraRadio/
//   │   │   └── EndlessRadioManager.ts
//   │   └── index.ts
//   └── core/
//       └── ...

function buildTree(absDir, prefix, lines) {
    let entries;
    try {
        entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
        return;
    }
    const filtered = entries.filter(e => {
        if (e.name.startsWith('.')) return false;
        if (e.isDirectory()) return !isExcludedDir(e.name);
        if (e.isFile())      return isIncludedFile(e.name);
        return false;
    });
    filtered.sort(entrySort);

    const lastIdx = filtered.length - 1;
    for (let i = 0; i < filtered.length; i++) {
        const entry  = filtered[i];
        const isLast = (i === lastIdx);
        const branch = isLast ? '└── ' : '├── ';
        const childPrefix = isLast ? '    ' : '│   ';
        const suffix = entry.isDirectory() ? '/' : '';
        lines.push(prefix + branch + entry.name + suffix);
        if (entry.isDirectory()) {
            buildTree(join(absDir, entry.name), prefix + childPrefix, lines);
        }
    }
}

function renderDirectoryTree() {
    const absRoot = join(PROJECT_ROOT, TREE_ROOT_REL);
    if (!existsSync(absRoot)) {
        return `(no '${TREE_ROOT_REL}/' directory found)`;
    }
    const lines = [TREE_ROOT_REL + '/'];
    buildTree(absRoot, '', lines);
    return lines.join('\n');
}

// ============================================================
// 头部 JSDoc 摘要抓取
// ============================================================
//
// 策略：在文件前 4KB 范围内查找第一个 /** ... */ 块（容错 — 跳过 shebang /
// 'use strict' / import 等任何前置内容）。提取首段作为职责描述。
//
// 清洗：
//   - 移除每行前导 ` * `
//   - 取第一个 双换行 之前的内容（首段）
//   - 截断到 MAX_DESC_CHARS（优先在句号/中文句号处断开）
//   - 多余空白归一为单空格

const BLOCK_COMMENT_REGEX = /\/\*\*([\s\S]*?)\*\//;

function extractHeaderDescription(content) {
    const head = content.slice(0, 4000);  // 仅扫描前 4KB
    const m = head.match(BLOCK_COMMENT_REGEX);
    if (m === null) return null;

    const raw = m[1];
    const cleaned = raw
        .split('\n')
        .map(line => line.replace(/^\s*\*\s?/, '').trimEnd())
        .join('\n')
        .trim();
    if (cleaned.length === 0) return null;

    // 取首段（双换行前）
    const firstBlock = cleaned.split(/\n\s*\n/)[0].trim();
    const collapsed  = firstBlock.replace(/\s+/g, ' ');

    if (collapsed.length <= MAX_DESC_CHARS) return collapsed;

    // 截断 — 优先在句号 / 中文句号处断开
    const slice = collapsed.slice(0, MAX_DESC_CHARS);
    let cutAt = MAX_DESC_CHARS;
    for (const punct of ['。', '. ', '! ', '? ', '；', '，']) {
        const idx = slice.lastIndexOf(punct);
        if (idx > MAX_DESC_CHARS * 0.5 && idx + punct.length > cutAt - 40) {
            cutAt = idx + punct.length;
            break;
        }
    }
    return collapsed.slice(0, cutAt).trim() + ' …';
}

// ============================================================
// Markdown 辅助
// ============================================================

function countLines(content) {
    if (content.length === 0) return 0;
    let n = 1;
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === 10) n++;
    }
    return n;
}

/** 转义 Markdown 表格单元中的 | 和换行 */
function mdEscape(s) {
    return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function langTag(absPath) {
    return LANG_MAP[extname(absPath).toLowerCase()] || '';
}

/**
 * 选取一个比内容里最长连续 ` 序列更长的 fence。
 * 默认 ```（3 个反引号）— 若文件含 ``` 则用 ```` 或更长，保证 fence 不被破坏。
 */
function pickFence(content) {
    if (!content.includes('```')) return '```';
    let maxRun = 0;
    const matches = content.match(/`+/g) || [];
    for (const run of matches) {
        if (run.length > maxRun) maxRun = run.length;
    }
    return '`'.repeat(Math.max(maxRun + 1, 4));
}

function readProjectName() {
    const pkgPath = join(PROJECT_ROOT, 'package.json');
    if (!existsSync(pkgPath)) return basename(PROJECT_ROOT);
    try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        return pkg.name || basename(PROJECT_ROOT);
    } catch {
        return basename(PROJECT_ROOT);
    }
}

// ============================================================
// 主流程
// ============================================================

function main() {
    const startTs    = Date.now();
    const projectName = readProjectName();
    const timestamp  = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

    const files = collectFiles();
    console.log(`[scan] ${files.length} files collected under ${PROJECT_ROOT}`);

    const out = [];

    // ─── §1. Header & Meta ──────────────────────────────────
    out.push(`# ${projectName} — Full Source Workspace Snapshot`);
    out.push('');
    out.push(`- **Project:** \`${projectName}\``);
    out.push(`- **Root:** \`${PROJECT_ROOT}\``);
    out.push(`- **Generated:** ${timestamp}`);
    out.push(`- **Files indexed:** ${files.length}`);
    out.push('');
    out.push('> Auto-generated by `scripts/export-workspace.js`. Do not edit by hand — regenerate via `node scripts/export-workspace.js`.');
    out.push('');

    // ─── §2. Directory Tree ─────────────────────────────────
    out.push('---');
    out.push('');
    out.push(`## 1. Directory Tree — \`${TREE_ROOT_REL}/\``);
    out.push('');
    out.push('```');
    out.push(renderDirectoryTree());
    out.push('```');
    out.push('');

    // ─── §3. File Roles & Invocation Index ──────────────────
    out.push('---');
    out.push('');
    out.push('## 2. File Roles & Invocation Index');
    out.push('');
    out.push('| # | File | Lines | Role / Responsibility |');
    out.push('|---|------|------:|------------------------|');

    // 先读全部文件,顺便缓存内容供 §4 复用 — 避免重复 IO
    const entries = [];
    for (const abs of files) {
        const rel = toPosixRel(abs);
        let content;
        try {
            content = readFileSync(abs, 'utf8');
        } catch (err) {
            console.warn(`[skip] read failed: ${rel} (${err.code})`);
            continue;
        }
        const lines = countLines(content);
        const ext   = extname(abs).toLowerCase();

        let desc;
        if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
            desc = extractHeaderDescription(content) || 'No description available.';
        } else if (ext === '.json') {
            desc = '(JSON resource)';
        } else if (ext === '.md') {
            // 取第一个非空非标题行作为简介；否则给个占位
            const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#'));
            desc = firstLine ? firstLine.trim().slice(0, MAX_DESC_CHARS) : '(Markdown document)';
        } else if (ext === '.html') {
            desc = '(HTML entry / template)';
        } else if (ext === '.css' || ext === '.scss') {
            desc = '(Stylesheet)';
        } else {
            desc = 'No description available.';
        }

        entries.push({ rel, abs, content, lines, desc });
    }

    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        out.push(`| ${i + 1} | \`${mdEscape(e.rel)}\` | ${e.lines} | ${mdEscape(e.desc)} |`);
    }
    out.push('');

    // ─── §4. Full Source Code ───────────────────────────────
    out.push('---');
    out.push('');
    out.push('## 3. Full Source Code');
    out.push('');
    out.push('> Each file below is a **byte-exact** copy of its on-disk content. No omissions, no elisions, no truncation.');
    out.push('');

    for (const e of entries) {
        out.push(`### File: \`${e.rel}\``);
        out.push('');
        out.push(`- **Path:** \`${e.rel}\``);
        out.push(`- **Lines:** ${e.lines}`);
        out.push('');
        const fence = pickFence(e.content);
        const lang  = langTag(e.abs);
        out.push(fence + lang);
        // 内容末尾去掉单个尾换行，避免 fence 前出现空白行；其余字节原样输出
        const body = e.content.endsWith('\n') ? e.content.slice(0, -1) : e.content;
        out.push(body);
        out.push(fence);
        out.push('');
    }

    // ─── 写入 ───────────────────────────────────────────────
    const markdown = out.join('\n');
    writeFileSync(OUTPUT_FILE, markdown, 'utf8');

    const elapsedMs = Date.now() - startTs;
    const sizeKb    = (Buffer.byteLength(markdown, 'utf8') / 1024).toFixed(1);
    console.log(`[done] wrote ${toPosixRel(OUTPUT_FILE)} — ${entries.length} files, ${sizeKb} KB, ${elapsedMs} ms`);
}

main();
