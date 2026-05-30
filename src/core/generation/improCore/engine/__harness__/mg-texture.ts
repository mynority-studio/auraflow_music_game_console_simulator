// mg-texture.ts — 验证 SmartGen 同源的 mg engine 伴奏织体(renderMgTexture):
//   同源 ctx / 时基对齐 / 低音区 / 确定性 / 风格切换。
//   跑:npx tsx src/core/generation/improCore/engine/__harness__/mg-texture.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseVocab, setActiveVocab, parseScales, setActiveScales } from '../vocab';
import { smartGen, getMgContext, renderMgTexture, clearMgContext } from '../../sandbox/smartGen';

const here = dirname(fileURLToPath(import.meta.url));
const vocText = readFileSync(join(here, '../vocab/My.voc'), 'utf8');
setActiveVocab(parseVocab(vocText));
setActiveScales(parseScales(vocText));

let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, x = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${x ? '  ' + x : ''}`); ok ? pass++ : fail++; };

// 1) 上下文生命周期
clearMgContext();
ck('clear 后 getMgContext=null', getMgContext() === null);

const r = smartGen();
const ctx = getMgContext();
ck('SmartGen 后 ctx 非空', ctx !== null);
ck('ctx.style 与 SmartGen 一致', ctx!.style === r.style, `${ctx!.style}=${r.style}`);
ck('ctx.chords 数 = SmartGen count', ctx!.chords.length === r.count);

// 2) 织体渲染:chord+bass 双轨,时基对齐
const tex = renderMgTexture(ctx!);
ck('texture chord 非空', tex.chords.length > 0, `${tex.chords.length}音`);
ck('texture bass 非空', tex.bass.length > 0, `${tex.bass.length}音`);
const totalBeats = ctx!.chords.reduce((s, c) => s + c.duration, 0);
ck('totalSlots = 总拍×120', tex.totalSlots === totalBeats * 120);
const maxEnd = Math.max(...[...tex.chords, ...tex.bass].map(n => n.startSlot + n.durationSlots));
ck('音符不超总时长(+1拍容差)', maxEnd <= tex.totalSlots + 120);
ck('pitch 合法 MIDI', [...tex.chords, ...tex.bass].every(n => n.pitch >= 0 && n.pitch <= 127));
ck('velocity 1-127', [...tex.chords, ...tex.bass].every(n => (n.velocity ?? 0) >= 1 && (n.velocity ?? 0) <= 127));
ck('bass 在低音区(<64)', tex.bass.every(n => n.pitch < 64));

// 3) 确定性(同 ctx 渲染两次逐字节一致)
ck('同 ctx 渲染确定性一致', JSON.stringify(renderMgTexture(ctx!)) === JSON.stringify(tex));

// 4) 风格切换:多次 SmartGen 覆盖多风格、织体规模不同
const styles = new Set<string>(); const sizes = new Set<number>();
for (let i = 0; i < 8; i++) { smartGen(); const c = getMgContext()!; styles.add(c.style); sizes.add(renderMgTexture(c).chords.length); }
ck('多次 SmartGen 覆盖多风格', styles.size >= 2, [...styles].join(','));
ck('不同风格织体规模不同', sizes.size >= 2, `${[...sizes].sort((a, b) => a - b).join(',')}音`);

console.log(`\n${fail === 0 ? '🟢 全绿' : '🔴 有失败'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
