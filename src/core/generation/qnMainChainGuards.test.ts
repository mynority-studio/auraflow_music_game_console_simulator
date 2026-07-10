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

  it('产品路径不 import 已删除的旧数据结构(GeneratedTrack/ArrangedTrack/MusicContext)/旧播放壳(PlaybackEngine/MidiConverter/AbsoluteTransposer)', () => {
    const forbidden = /import[^;]*\b(GeneratedTrack|ArrangedTrack|MusicContext)\b|from\s+['"][^'"]*(PlaybackEngine|MidiConverter|AbsoluteTransposer)['"]/;
    const hits = sources.filter((s) => forbidden.test(s.live)).map((s) => s.path);
    expect(hits, `旧数据结构/播放壳 import 命中:${hits.join(', ')}`).toEqual([]);
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

  it('guitarist selected → 最终有 guitar 家族轨,roster 归属 guitarist', async () => {
    const { instrumentInfo } = await import('./newEngine/knowledge/instruments');
    const r = gen([{ role: 'guitarist', state: 'selected' }]);
    const guitarTracks = r.ir!.tracks.filter((t) => instrumentInfo(t.program).family === 'guitar');
    expect(guitarTracks.length).toBeGreaterThan(0);
    expect(r.uiSnapshot.roster.some((row) => row.participant === 'guitarist' && instrumentInfo(row.program).family === 'guitar')).toBe(true);
  });
});

// ============================================================
// 跨源 onTrackEnd 劫持防回归(#1 superseded-start race)
// ------------------------------------------------------------
// 根因:globalMidiScheduler.onTrackEnd 全局 listener 无 unsubscribe,radio/jam/pipeline 各靠自己的
//   generationId/seed 守卫,不感知其它播放源超越 → 上传 MIDI 曲终会触发它们续播/停止(劫持)。
// 修复:playMusicGeneration 返回本次【实际启动】的会话 id(failed/被超越返回 null);manager 用返回值
//   捕获 playId(而非事后读全局 currentPlaybackId,那会错绑超越者会话),onTrackEnd 守卫附加 playId 校验。
// AudioEngine 是 node 环境不可 import 的单例(SynthManager 触 Web Audio),故以源码形状静态锁死修复。
// ============================================================
describe('generation/qnMainChainGuards — 跨源 onTrackEnd 劫持防回归(#1 race)', () => {
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
  const AE = read('src/core/audio/AudioEngine.ts');
  const MANAGERS: [string, string][] = [
    ['radio', read('src/apps/AuraBar/EndlessRadioManager.ts')],
    ['jam', read('src/apps/AuraJam/JamSessionManager.ts')],
    ['pipeline', read('src/components/PipelineMonitor.tsx')],
  ];

  it('playMusicGeneration 返回本次会话 id(Promise<number | null>)+ 成功路径 return currentSession', () => {
    expect(AE).toMatch(/playMusicGeneration\([^)]*\)\s*:\s*Promise<\s*number\s*\|\s*null\s*>/);
    expect(AE).toMatch(/return\s+currentSession\s*;/);
  });

  for (const [name, code] of MANAGERS) {
    it(`${name}:从 playMusicGeneration 返回值捕获 playId + 守卫含 playId 校验 + null 早退`, () => {
      // 必须从返回值捕获（await 赋值）
      expect(code, `${name} 未用返回值捕获 playId`).toMatch(/const\s+playId\s*=\s*await\s+AudioEngine\.playMusicGeneration\(/);
      // 禁止 racy 事后快照形（const playId = AudioEngine.currentPlaybackId()）——会错绑超越者会话
      expect(code, `${name} 残留事后快照 playId(race)`).not.toMatch(/const\s+playId\s*=\s*AudioEngine\.currentPlaybackId\(\)/);
      // 曲终守卫附加 playId 校验（跨源劫持防线）
      expect(code, `${name} onTrackEnd 守卫缺 playId 校验`).toMatch(/AudioEngine\.currentPlaybackId\(\)\s*===\s*playId/);
      // playId===null（被超越/failed）早退，不注册续播
      expect(code, `${name} 缺 playId===null 早退`).toMatch(/playId\s*===\s*null/);
    });
  }
});
