import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateMusicSync } from './musicGeneration/MusicGenerationService';

// ============================================================
// Q+N 主链路防回归护栏(qn_main_engine_replacement_final_audit_recommendations §4)
// ------------------------------------------------------------
// 锁死主引擎替换的边界:产品路径不得回退旧 mg 生成器 / GM override;Band Selection 语义;drum roster。
// ============================================================

const ROOT = process.cwd();
const PRODUCT_DIRS = [
  'src/components', 'src/apps', 'src/core/audio',
  'src/core/generation/pipeline', 'src/core/generation/musicGeneration', 'src/state',
];
const SINGLE_FILES = ['src/App.tsx'];

/** 递归收集产品路径下的 .ts/.tsx(排除测试文件)。 */
function collectSources(): { path: string; code: string }[] {
  const out: { path: string; code: string }[] = [];
  const pushFile = (p: string) => {
    if (!/\.(ts|tsx)$/.test(p) || p.endsWith('.test.ts') || p.endsWith('.test.tsx')) return;
    out.push({ path: p, code: readFileSync(join(ROOT, p), 'utf8') });
  };
  const walk = (dir: string) => {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs)) {
      const rel = `${dir}/${name}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else pushFile(rel);
    }
  };
  for (const d of PRODUCT_DIRS) walk(d);
  for (const f of SINGLE_FILES) if (existsSync(join(ROOT, f))) pushFile(f);
  return out;
}

/** 去掉行注释/块注释行(避免"已不再使用"类注释误命中 grep)。 */
function stripComments(code: string): string {
  return code
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

describe('generation/qnMainChainGuards — 静态边界(§4)', () => {
  const sources = collectSources().map((s) => ({ ...s, live: stripComments(s.code) }));

  it('产品路径不 import 旧 mg 引擎 / 旧 store / registry', () => {
    const forbidden = /from\s+['"][^'"]*(mgEngine|MgStyleStore|MgKeyStore|MgSeedStore|MusicianRegistry|GMSoundMap)['"]/;
    const hits = sources.filter((s) => forbidden.test(s.live)).map((s) => s.path);
    expect(hits, `旧引擎 import 命中:${hits.join(', ')}`).toEqual([]);
  });

  it('产品路径无 GM override 语义(forcedGmPrograms/gmOverrides/QnGmOverrides)+ 无 runMgEngine 调用', () => {
    const gmOverride = sources.filter((s) => /forcedGmPrograms|gmOverrides|QnGmOverrides/.test(s.live)).map((s) => s.path);
    expect(gmOverride, `GM override 命中:${gmOverride.join(', ')}`).toEqual([]);
    const runMg = sources.filter((s) => /runMgEngine\s*\(/.test(s.live)).map((s) => s.path);
    expect(runMg, `runMgEngine 调用命中:${runMg.join(', ')}`).toEqual([]);
  });

  it('App/组件/apps 不调用旧 AudioEngine.playSong(正式播放走 playMusicGeneration)', () => {
    const inApp = sources.filter((s) => /src\/(App\.tsx|components|apps)/.test(s.path) && /\.playSong\s*\(/.test(s.live)).map((s) => s.path);
    expect(inApp, `playSong 调用命中:${inApp.join(', ')}`).toEqual([]);
  });

  it('App.tsx 不重新挂载已退役的 NewEnginePanel', () => {
    const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
    expect(app).not.toContain('NewEnginePanel');
  });
});

describe('generation/qnMainChainGuards — Band Selection 行为(§4)', () => {
  const gen = (bandParticipants?: Parameters<typeof generateMusicSync>[0]['bandParticipants']) =>
    generateMusicSync({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 90, ...(bandParticipants ? { bandParticipants } : {}) });
  const roles = (r: ReturnType<typeof gen>) => new Set(r.ir!.tracks.map((t) => t.role));

  it('seed=7 POP 键盘手+贝斯手+鼓手 → 含 drum(selected 保证出声)', () => {
    const r = gen([{ role: 'keyboardist', state: 'selected' }, { role: 'bassist', state: 'selected' }, { role: 'drummer', state: 'selected' }]);
    expect(roles(r).has('drum')).toBe(true);
    expect(roles(r).has('bass')).toBe(true);
  });

  it('POP 仅鼓手 → drum + 自动补 lead', () => {
    const r = gen([{ role: 'drummer', state: 'selected' }]);
    expect(roles(r).has('drum')).toBe(true);
    expect(roles(r).has('lead')).toBe(true);
  });

  it('drum roster 显示 Drum Kit(不把 ch9 program 0 显示成 Acoustic Grand)', () => {
    const r = gen([{ role: 'drummer', state: 'selected' }]);
    const drumRow = r.uiSnapshot.roster.find((p) => p.role === 'drum');
    expect(drumRow?.instrumentName).toBe('Drum Kit');
  });

  it('synthPlayer 最终 pad 音色在 pad 家族;keyboardist 最终 lead/comp 在 keyboard 家族', async () => {
    const { instrumentInfo } = await import('./newEngine/knowledge/instruments');
    const synth = gen([{ role: 'synthPlayer', state: 'selected' }, { role: 'leadPlayer', state: 'selected' }]);
    const pad = synth.ir!.tracks.find((t) => t.role === 'pad');
    if (pad) expect(instrumentInfo(pad.program).family).toBe('pad');
    const kb = gen([{ role: 'keyboardist', state: 'selected' }, { role: 'bassist', state: 'selected' }]);
    for (const role of ['lead', 'comp'] as const) {
      const t = kb.ir!.tracks.find((x) => x.role === role);
      if (t) expect(instrumentInfo(t.program).family).toBe('keyboard');
    }
  });
});
