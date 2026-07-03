// ============================================================
// newEngine · instrumental · Sax expression MIDI CC plan
// ------------------------------------------------------------
// Sax 的真实感先放在器配/表演层:不改音源、不拼接样本,只给 lead sax 轨写标准 MIDI CC。
// CC11 是主响度包络,CC2 给 breath controller 兼容实现,CC1 只在长音上轻开 vibrato。
// ============================================================

import { ticks, type Ticks } from '../foundation';
import type { NoteIR } from '../ir/MusicalIR';

export const SAX_CC = {
  modulation: 1,
  breath: 2,
  expression: 11,
} as const;

export interface SaxCcEvent {
  atTick: Ticks;
  controller: number;
  value: number;
}

export interface SaxExpressionOptions {
  ppq?: number;
  maxConnectIoiTicks?: number;
  overlapTicks?: number;
}

const clampCc = (v: number): number => Math.max(0, Math.min(127, Math.round(v)));

function clampInsideNote(tick: number, start: number, end: number): number {
  return Math.max(start, Math.min(Math.max(start, end - 1), Math.round(tick)));
}

function stableAccent(note: NoteIR, index: number): number {
  const start = note.startTick as number;
  const pitch = note.pitch as number;
  return ((((start * 31 + pitch * 17 + index * 13) >>> 0) % 9) - 4);
}

function sustainExpression(note: NoteIR, index: number): number {
  const pitch = note.pitch as number;
  const lowBody = pitch <= 58 ? 4 : pitch >= 70 ? -4 : 0;
  return clampCc(86 + (note.velocity - 64) * 0.38 + lowBody + stableAccent(note, index));
}

function breathFromExpression(expr: number): number {
  return clampCc(expr - 12);
}

function controllerSort(a: SaxCcEvent, b: SaxCcEvent): number {
  if ((a.atTick as number) !== (b.atTick as number)) return (a.atTick as number) - (b.atTick as number);
  return a.controller - b.controller;
}

function noteStart(note: NoteIR): number { return note.startTick as number; }
function noteDur(note: NoteIR): number { return note.durationTicks as number; }
function noteEnd(note: NoteIR): number { return noteStart(note) + noteDur(note); }

/** GM sax family:64 soprano,65 alto,66 tenor,67 baritone. */
export function isSaxProgram(program: number): boolean {
  return program >= 64 && program <= 67;
}

/** Sax 连吹换指:不同音高的连续音允许极短 overlap,让采样器少一点逐音断裂感。 */
export function shapeSaxLegatoNotes(notes: readonly NoteIR[], opts: SaxExpressionOptions = {}): NoteIR[] {
  const ppq = opts.ppq ?? 480;
  const maxIoi = opts.maxConnectIoiTicks ?? Math.round(ppq * 1.10);
  const overlap = opts.overlapTicks ?? Math.max(1, Math.round(ppq * 0.045));
  const out = notes.map((n) => ({ ...n }));
  const order = out.map((_, i) => i).sort((a, b) => noteStart(out[a]) - noteStart(out[b]));

  for (let k = 0; k < order.length - 1; k++) {
    const i = order[k], j = order[k + 1];
    const ioi = noteStart(out[j]) - noteStart(out[i]);
    if (ioi <= 0 || ioi > maxIoi) continue;
    if (out[i].pitch === out[j].pitch) {
      const cap = Math.max(1, ioi - 1);
      if (noteDur(out[i]) > cap) out[i].durationTicks = ticks(cap);
      continue;
    }
    const target = ioi + overlap;
    if (noteDur(out[i]) < target) out[i].durationTicks = ticks(target);
  }
  return out;
}

/**
 * 生成 sax 的吹奏包络:
 * - 每个音从较低气压爬到 sustain,避免采样一触即满导致的刺/硬。
 * - 中长音在尾部收气,减少机械 note-off。
 * - 长音中段轻开 CC1 vibrato,模拟吹管乐手自然颤音。
 */
export function buildSaxBreathCcEvents(notes: readonly NoteIR[], opts: SaxExpressionOptions = {}): SaxCcEvent[] {
  const ppq = opts.ppq ?? 480;
  const maxIoi = opts.maxConnectIoiTicks ?? Math.round(ppq * 1.10);
  const joinGap = Math.max(1, Math.round(ppq * 0.08));
  const raw: SaxCcEvent[] = [];
  const push = (atTick: number, controller: number, value: number): void => {
    raw.push({ atTick: ticks(Math.max(0, Math.round(atTick))), controller, value: clampCc(value) });
  };

  const sorted = [...notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
  sorted.forEach((note, index) => {
    const start = note.startTick as number;
    const dur = Math.max(1, note.durationTicks as number);
    const end = start + dur;
    const prev = index > 0 ? sorted[index - 1] : undefined;
    const next = index + 1 < sorted.length ? sorted[index + 1] : undefined;
    const prevIoi = prev ? start - (prev.startTick as number) : Infinity;
    const nextIoi = next ? (next.startTick as number) - start : Infinity;
    const fromPrev = !!prev && prev.pitch !== note.pitch && prevIoi > 0 && prevIoi <= maxIoi && start - noteEnd(prev) <= joinGap;
    const toNext = !!next && next.pitch !== note.pitch && nextIoi > 0 && nextIoi <= maxIoi && (next.startTick as number) - end <= joinGap;
    const sustain = sustainExpression(note, index);
    const shortNote = dur < ppq * 0.22;
    const attackTicks = shortNote ? 0 : Math.min(Math.round(ppq * 0.16), Math.max(1, Math.round(dur * 0.34)));
    const releaseTicks = Math.min(Math.round(ppq * 0.18), Math.max(1, Math.round(dur * 0.28)));
    const startExpr = fromPrev ? sustain - 3 : shortNote ? sustain - 8 : sustain - 24;
    const releaseExpr = sustain - (dur >= ppq * 0.65 ? 20 : 12);

    push(start, SAX_CC.expression, startExpr);
    push(start, SAX_CC.breath, breathFromExpression(startExpr));

    if (!shortNote && !fromPrev) {
      const attackAt = clampInsideNote(start + attackTicks, start, end);
      push(attackAt, SAX_CC.expression, sustain);
      push(attackAt, SAX_CC.breath, breathFromExpression(sustain));
    }

    if (dur >= ppq * 0.75) {
      const vib = clampCc(7 + Math.max(0, sustain - 92) * 0.12);
      push(clampInsideNote(start + dur * 0.38, start, end), SAX_CC.modulation, vib);
      push(clampInsideNote(start + dur * 0.62, start, end), SAX_CC.modulation, Math.max(3, vib - 3));
    }

    if (dur >= ppq * 0.35 && !toNext) {
      const releaseAt = clampInsideNote(end - releaseTicks, start, end);
      push(releaseAt, SAX_CC.expression, releaseExpr);
      push(releaseAt, SAX_CC.breath, breathFromExpression(releaseExpr));
      if (dur >= ppq * 0.75) push(releaseAt, SAX_CC.modulation, 0);
    }
  });

  raw.sort(controllerSort);
  const byTickController = new Map<string, SaxCcEvent>();
  for (const event of raw) byTickController.set(`${event.atTick as number}:${event.controller}`, event);
  return [...byTickController.values()].sort(controllerSort);
}
