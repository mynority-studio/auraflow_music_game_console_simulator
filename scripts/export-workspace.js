#!/usr/bin/env node
/**
 * export-workspace.js — 一键打包全量项目 → 单一 Markdown 上下文
 *
 * 用途：把整个项目根（含隐藏目录、flash、docs、根配置）聚合为 ALL_SOURCE_CODE.md，
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
 *   2. 全量优先 — 黑名单驱动（仅排 .git / node_modules / dist 等已知噪声）
 *   3. 安全兜底 — 文件级 null-byte 二进制检测 + 单文件 size cap，自动跳过非文本
 *   4. 字节精确 — Source Dump 段不省略不裁剪，含 ``` 时自动加长 fence
 *   5. 确定性 — 目录遍历有固定排序（先目录后文件，字典序），便于 diff
 *   6. 隐藏文件全收 — .claude / .github / .env.example / .gitignore 默认进
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

/** 目录黑名单 — 这些目录里的内容全部跳过（含其下隐藏内容） */
const EXCLUDED_DIRS = new Set([
    // 版本控制
    '.git', '.svn', '.hg',
    // 依赖与构建产物
    'node_modules',
    'dist', 'build', 'out', '.next', '.nuxt', '.output',
    // 缓存
    '.cache', '.turbo', '.vite', '.parcel-cache', '.swc', '.rollup.cache',
    // 测试覆盖率
    'coverage', '.nyc_output',
    // 编辑器
    '.vscode', '.idea',
    // 注：public/ 已从黑名单移除 — 文件级 binary/size 检测会自动跳过 SF2 等二进制
]);

/** 文件名级别黑名单（防 lockfile / build artifact 等大文件混入） */
const EXCLUDED_FILES = new Set([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lockb',
    'tsconfig.tsbuildinfo',
    '.DS_Store',
    'ALL_SOURCE_CODE.md',  // 防自包含
]);

/**
 * 文本扩展白名单（小写）— 用于决定哪些后缀进 dump。
 * 隐藏文件（.gitignore / .env.example / .npmrc 等）通过 EXTRA_NAMES 单独识别。
 */
const INCLUDED_EXTS = new Set([
    // 源代码
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.c', '.h', '.cpp', '.hpp', '.cc', '.hh', '.ino',
    '.py', '.rs', '.go', '.java', '.kt', '.swift',
    '.lua', '.rb',
    // 数据 / 配置
    '.json', '.jsonc', '.json5',
    '.yaml', '.yml',
    '.toml',
    '.xml', '.plist',
    '.ini', '.conf',
    // 标记 / 文档
    '.md', '.mdx', '.txt', '.rst',
    // 前端样式与模板
    '.html', '.htm', '.css', '.scss', '.sass', '.less', '.styl',
    '.vue', '.svelte', '.astro',
    // 脚本
    '.sh', '.bash', '.zsh', '.fish', '.ps1',
    // 文本图形 / 模板
    '.svg', '.tex',
    // 工程基础
    '.mk', '.cmake',
    // 环境与示例
    '.env', '.env.example', '.env.local', '.env.development', '.env.production',
]);

/**
 * 无扩展名 / 特殊命名的文本文件白名单（exact basename match）。
 * 包括 dotfiles 与无后缀工程文件。
 */
const EXTRA_NAMES = new Set([
    // 构建系统
    'Dockerfile', 'Makefile', 'CMakeLists.txt', 'Procfile', 'Rakefile', 'Gemfile',
    // 项目元数据
    'LICENSE', 'LICENCE', 'NOTICE', 'AUTHORS', 'CONTRIBUTORS', 'CODEOWNERS',
    'README', 'CHANGELOG', 'HISTORY',
    // 工具配置（dotfiles）
    '.gitignore', '.gitattributes', '.gitmodules',
    '.editorconfig',
    '.npmrc', '.nvmrc', '.yarnrc', '.pnpmfile.cjs',
    '.eslintrc', '.eslintignore',
    '.prettierrc', '.prettierignore',
    '.stylelintrc', '.stylelintignore',
    '.babelrc',
    '.browserslistrc',
    '.dockerignore',
    '.flowconfig',
    '.python-version', '.ruby-version', '.node-version',
]);

/** Markdown code fence 语言标签 */
const LANG_MAP = {
    '.ts':   'ts',     '.tsx':  'tsx',
    '.js':   'js',     '.jsx':  'jsx',
    '.mjs':  'js',     '.cjs':  'js',
    '.c':    'c',      '.h':    'c',
    '.cpp':  'cpp',    '.hpp':  'cpp',   '.cc': 'cpp', '.hh': 'cpp',
    '.ino':  'cpp',
    '.py':   'python', '.rs':   'rust',  '.go': 'go',
    '.java': 'java',   '.kt':   'kotlin','.swift': 'swift',
    '.lua':  'lua',    '.rb':   'ruby',
    '.json': 'json',   '.jsonc':'json',  '.json5':'json5',
    '.yaml': 'yaml',   '.yml':  'yaml',
    '.toml': 'toml',
    '.xml':  'xml',    '.plist':'xml',   '.svg': 'xml',
    '.ini':  'ini',    '.conf': 'ini',
    '.md':   'md',     '.mdx':  'mdx',
    '.txt':  'text',   '.rst':  'rst',
    '.html': 'html',   '.htm':  'html',
    '.css':  'css',    '.scss': 'scss',  '.sass':'sass', '.less':'less', '.styl':'stylus',
    '.vue':  'vue',    '.svelte':'svelte','.astro':'astro',
    '.sh':   'bash',   '.bash': 'bash',  '.zsh': 'bash', '.fish':'fish', '.ps1':'powershell',
    '.tex':  'latex',
    '.mk':   'makefile','.cmake':'cmake',
    '.env':  'bash',   '.env.example':'bash', '.env.local':'bash',
    '.env.development':'bash', '.env.production':'bash',
};

/** 无扩展名特殊文件的 fence 语言映射 */
const EXTRA_NAME_LANG = {
    'Dockerfile':    'dockerfile',
    'Makefile':      'makefile',
    'CMakeLists.txt':'cmake',
    'Procfile':      'text',
    'Rakefile':      'ruby',
    'Gemfile':       'ruby',
    '.gitignore':    'gitignore',
    '.gitattributes':'text',
    '.gitmodules':   'ini',
    '.editorconfig': 'ini',
    '.npmrc':        'ini',
    '.nvmrc':        'text',
    '.yarnrc':       'yaml',
    '.eslintrc':     'json',
    '.prettierrc':   'json',
    '.babelrc':      'json',
    '.dockerignore': 'text',
    '.browserslistrc':'text',
};

/** 单文件大小上限（字节）— 超过则 skip + warn，避免大 fixture / minified bundle 撑爆 markdown */
const MAX_FILE_BYTES = 2 * 1024 * 1024;  // 2 MB

/** 二进制嗅探扫描窗口（字节）— 文件前 N 字节出现 0x00 视为二进制 */
const BINARY_SNIFF_BYTES = 8192;

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
    if (EXTRA_NAMES.has(name)) return true;
    const ext = extname(name).toLowerCase();
    if (ext.length > 0 && INCLUDED_EXTS.has(ext)) return true;
    // 处理 .env / .env.example 这种"整个文件名都是扩展"的 dotfile
    if (name.startsWith('.') && INCLUDED_EXTS.has(name.toLowerCase())) return true;
    return false;
}

/**
 * 编码嗅探 — 优先识别已知 BOM，回落到 utf8。
 *   返回：'utf8-bom' | 'utf16le' | 'utf16be' | 'utf8'
 */
function detectEncoding(buf) {
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return 'utf8-bom';
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return 'utf16le';
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return 'utf16be';
    return 'utf8';
}

/**
 * 二进制嗅探 — 前 BINARY_SNIFF_BYTES 字节出现 0x00 视为二进制。
 * 已识别到 BOM 的 UTF-16 文本豁免（UTF-16 文本本身就有大量 0x00）。
 */
function isBinary(buf) {
    const enc = detectEncoding(buf);
    if (enc === 'utf16le' || enc === 'utf16be') return false;
    const start = enc === 'utf8-bom' ? 3 : 0;
    const limit = Math.min(buf.length, start + BINARY_SNIFF_BYTES);
    for (let i = start; i < limit; i++) {
        if (buf[i] === 0) return true;
    }
    return false;
}

/**
 * 按 BOM 选编码解码 buffer 为字符串；UTF-16 BE 在 Node 无原生支持，手动 byte-swap 后用 utf16le。
 */
function decodeBuffer(buf) {
    const enc = detectEncoding(buf);
    if (enc === 'utf16le') return buf.toString('utf16le', 2);  // 跳过 BOM
    if (enc === 'utf16be') {
        const swapped = Buffer.alloc(buf.length - 2);
        for (let i = 2; i < buf.length - 1; i += 2) {
            swapped[i - 2]     = buf[i + 1];
            swapped[i - 2 + 1] = buf[i];
        }
        return swapped.toString('utf16le');
    }
    if (enc === 'utf8-bom') return buf.toString('utf8', 3);
    return buf.toString('utf8');
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
        const absPath = join(absDir, entry.name);
        if (entry.isDirectory()) {
            // 隐藏目录与噪声目录统一通过 EXCLUDED_DIRS 黑名单控制
            if (isExcludedDir(entry.name)) continue;
            walkDir(absPath, out);
        } else if (entry.isFile() && isIncludedFile(entry.name)) {
            out.push(absPath);
        }
    }
}

/**
 * 从 PROJECT_ROOT 起递归收集所有"应进 dump"的文件。
 * 黑名单驱动：除 EXCLUDED_DIRS / EXCLUDED_FILES 外，任何扩展名命中 INCLUDED_EXTS
 * 或文件名命中 EXTRA_NAMES 的文件都进队列；隐藏目录（.claude / .github 等）默认收。
 */
function collectFiles() {
    const files = [];
    walkDir(PROJECT_ROOT, files);
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
    const rootName = basename(PROJECT_ROOT) || '.';
    const lines = [rootName + '/'];
    buildTree(PROJECT_ROOT, '', lines);
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
    const name = basename(absPath);
    if (EXTRA_NAME_LANG[name]) return EXTRA_NAME_LANG[name];
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
    console.log(`[scan] ${files.length} candidates collected under ${PROJECT_ROOT}`);

    // Header 延后到 entries/skipped 都填完后再 unshift，让 "Files indexed" 反映真实 dump 数。
    const out = [];

    // ─── §2. Directory Tree ─────────────────────────────────
    out.push('---');
    out.push('');
    out.push(`## 1. Directory Tree — \`${basename(PROJECT_ROOT)}/\``);
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
    // 文件级安全门：超出 MAX_FILE_BYTES 或被 isBinary 判定为二进制的，记入 skipped 列表，不进 entries。
    const entries = [];
    const skipped = [];  // { rel, reason, bytes? }
    const codeExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
                              '.c', '.h', '.cpp', '.hpp', '.cc', '.hh', '.ino',
                              '.py', '.rs', '.go', '.java', '.kt', '.swift', '.lua', '.rb']);

    for (const abs of files) {
        const rel = toPosixRel(abs);
        const name = basename(abs);

        let buf;
        try {
            buf = readFileSync(abs);
        } catch (err) {
            console.warn(`[skip] read failed: ${rel} (${err.code})`);
            skipped.push({ rel, reason: `read failed (${err.code})` });
            continue;
        }

        if (buf.length > MAX_FILE_BYTES) {
            const mb = (buf.length / 1024 / 1024).toFixed(2);
            console.warn(`[skip] oversize ${mb} MB: ${rel}`);
            skipped.push({ rel, reason: `oversize (${mb} MB > ${MAX_FILE_BYTES / 1024 / 1024} MB cap)`, bytes: buf.length });
            continue;
        }

        if (isBinary(buf)) {
            console.warn(`[skip] binary content: ${rel}`);
            skipped.push({ rel, reason: 'binary (null byte detected)', bytes: buf.length });
            continue;
        }

        const content = decodeBuffer(buf);
        const lines   = countLines(content);
        const ext     = extname(abs).toLowerCase();

        let desc;
        if (codeExts.has(ext)) {
            desc = extractHeaderDescription(content) || 'No description available.';
        } else if (ext === '.json' || ext === '.jsonc' || ext === '.json5') {
            desc = '(JSON resource)';
        } else if (ext === '.md' || ext === '.mdx' || ext === '.rst') {
            const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#'));
            desc = firstLine ? firstLine.trim().slice(0, MAX_DESC_CHARS) : '(Markdown document)';
        } else if (ext === '.txt') {
            const firstLine = content.split('\n').find(l => l.trim());
            desc = firstLine ? firstLine.trim().slice(0, MAX_DESC_CHARS) : '(Text file)';
        } else if (ext === '.html' || ext === '.htm') {
            desc = '(HTML entry / template)';
        } else if (ext === '.css' || ext === '.scss' || ext === '.sass' || ext === '.less' || ext === '.styl') {
            desc = '(Stylesheet)';
        } else if (ext === '.yaml' || ext === '.yml') {
            desc = '(YAML config)';
        } else if (ext === '.toml' || ext === '.ini' || ext === '.conf') {
            desc = '(Config file)';
        } else if (ext === '.xml' || ext === '.plist' || ext === '.svg') {
            desc = '(XML / SVG document)';
        } else if (ext === '.sh' || ext === '.bash' || ext === '.zsh' || ext === '.fish' || ext === '.ps1') {
            desc = '(Shell script)';
        } else if (EXTRA_NAMES.has(name)) {
            desc = `(${name})`;
        } else {
            desc = extractHeaderDescription(content) || 'No description available.';
        }

        entries.push({ rel, abs, content, lines, desc });
    }

    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        out.push(`| ${i + 1} | \`${mdEscape(e.rel)}\` | ${e.lines} | ${mdEscape(e.desc)} |`);
    }
    out.push('');

    // ─── §3.5 Skipped Files（透明日志：哪些文件因安全门跳过及原因） ───
    if (skipped.length > 0) {
        out.push('---');
        out.push('');
        out.push('## 2.5 Skipped Files (binary / oversize)');
        out.push('');
        out.push('> 以下文件被安全门自动跳过。原因：null-byte 二进制嗅探命中 或 单文件超过 size cap。');
        out.push('');
        out.push('| # | File | Reason |');
        out.push('|---|------|--------|');
        for (let i = 0; i < skipped.length; i++) {
            const s = skipped[i];
            out.push(`| ${i + 1} | \`${mdEscape(s.rel)}\` | ${mdEscape(s.reason)} |`);
        }
        out.push('');
    }

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

    // ─── §1. Header & Meta（最后 unshift 到顶部，让数字反映真实结果） ──
    const headerLines = [
        `# ${projectName} — Full Source Workspace Snapshot`,
        '',
        `- **Project:** \`${projectName}\``,
        `- **Root:** \`${PROJECT_ROOT}\``,
        `- **Generated:** ${timestamp}`,
        `- **Files dumped:** ${entries.length}`,
        `- **Files skipped:** ${skipped.length} (binary / oversize, see §2.5)`,
        `- **Size cap:** ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(1)} MB / file`,
        '',
        '> Auto-generated by `scripts/export-workspace.js`. Do not edit by hand — regenerate via `node scripts/export-workspace.js`.',
        '',
    ];
    for (let i = headerLines.length - 1; i >= 0; i--) out.unshift(headerLines[i]);

    // ─── 写入 ───────────────────────────────────────────────
    const markdown = out.join('\n');
    writeFileSync(OUTPUT_FILE, markdown, 'utf8');

    const elapsedMs = Date.now() - startTs;
    const sizeKb    = (Buffer.byteLength(markdown, 'utf8') / 1024).toFixed(1);
    const skipNote  = skipped.length > 0 ? `, ${skipped.length} skipped` : '';
    console.log(`[done] wrote ${toPosixRel(OUTPUT_FILE)} — ${entries.length} files${skipNote}, ${sizeKb} KB, ${elapsedMs} ms`);
}

main();
