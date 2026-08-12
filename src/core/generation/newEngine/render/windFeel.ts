// ============================================================
// newEngine · render · 管乐 feel(第一层,MG 链内 → parity 天然安全)
// ------------------------------------------------------------
// 用户诊断:管乐"全力吹奏"。气流乐器的表情单位是每个音和每一口气:
//   1) 乐句力度成形:天花板压到 [65,105],起句 -15%、句尾收气 -20%,
//      峰值落在乐句最高/最长音 —— GM 音色的软吹 velocity 层得以发声;
//   2) 呼吸:连续吹奏 ≥8 拍 → 就近收气(缩短当前音留 0.25 拍换气口);
//   3) 爬音(scoop):句首长音前置低力度装饰音(下方大二度,~0.09 拍),
//      装饰音方案零硬件风险(pitch bend 滑音待板测后二期)。
// 只动 melody part;确定性;乐句 = gap ≥1 拍切分。
// ============================================================

import type { MgNoteEvent } from './mgMelodyRealizer';

/** GM 管乐族:brass 56-63 + reed 64-71 + pipe 72-79。 */
export function isWindLeadProgram(program?: number): boolean {
  return program !== undefined && program >= 56 && program <= 79;
}

const clampVel = (v: number): number => Math.max(1, Math.min(127, Math.round(v)));
const PHRASE_GAP_BEATS = 1;
const BREATH_SPAN_BEATS = 8;
const BREATH_GAP_BEATS = 0.25;

export function applyWindLeadFeel(events: readonly MgNoteEvent[]): MgNoteEvent[] {
  const melody = events.filter((e) => e.part === 'melody').sort((a, b) => a.time - b.time);
  const others = events.filter((e) => e.part !== 'melody');
  if (melody.length === 0) return [...events];

  // —— 切乐句(gap ≥1 拍)——
  const phrases: MgNoteEvent[][] = [];
  let current: MgNoteEvent[] = [];
  for (const e of melody) {
    const prev = current[current.length - 1];
    if (prev && e.time - (prev.time + prev.duration) >= PHRASE_GAP_BEATS) {
      phrases.push(current);
      current = [];
    }
    current.push({ ...e });
  }
  if (current.length > 0) phrases.push(current);

  const out: MgNoteEvent[] = [];
  for (const phrase of phrases) {
    // 1) 力度成形:天花板 [65,105] + 乐句弧(峰值 = 最高且最长的音)
    let peakIndex = 0;
    let peakScore = -Infinity;
    phrase.forEach((e, i) => {
      const score = e.noteNumber + e.duration * 4;
      if (score > peakScore) { peakScore = score; peakIndex = i; }
    });
    const last = phrase.length - 1;
    phrase.forEach((e, i) => {
      const base = 65 + (Math.max(1, Math.min(127, e.velocity)) / 127) * 40; // 全力 → 有余量
      const arc = i === 0 && phrase.length > 1 ? 0.85
        : i === last && phrase.length > 1 ? 0.8
        : i === peakIndex ? 1.06
        : 1;
      e.velocity = clampVel(base * arc);
    });
    // 2) 呼吸:连续吹奏超过 BREATH_SPAN_BEATS → 缩短该音留换气口
    let blownSince = phrase[0].time;
    for (let i = 0; i < phrase.length; i++) {
      const e = phrase[i];
      const next = phrase[i + 1];
      const gapAfter = next ? next.time - (e.time + e.duration) : Infinity;
      if (gapAfter >= BREATH_GAP_BEATS) { blownSince = next ? next.time : e.time; continue; }
      if (e.time + e.duration - blownSince >= BREATH_SPAN_BEATS && next) {
        e.duration = Math.max(0.25, next.time - e.time - BREATH_GAP_BEATS); // 收气
        blownSince = next.time;
      }
    }
    // 3) 爬音:句首长音(≥0.75 拍)前置装饰(下方大二度,低力度)
    const head = phrase[0];
    if (head.duration >= 0.75 && head.time >= 0.15) {
      out.push({
        ...head,
        noteNumber: head.noteNumber - 2,
        time: head.time - 0.1,
        duration: 0.09,
        velocity: clampVel(head.velocity * 0.55),
        origin: 'develop',
      });
    }
    out.push(...phrase);
  }
  return [...others, ...out].sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
}
