// ============================================================
// motifSandbox · capture · 4 秒 motif 录制器
// ------------------------------------------------------------
// noteOn/noteOff → CapturedMidiNote[]。≤4 秒自动 stop;未关音符 stop 时补 duration;最小时值 clamp。
// 时钟可注入(now)→ 可测。raw 保留重叠;归一化交 analyzeAndNormalize。
// ============================================================

import type { CapturedMidiNote } from '../model/types';

const MIN_DUR_MS = 60;

export class MidiMotifRecorder {
  private startMs = 0;
  private maxMs = 4000;
  private active = false;
  private open = new Map<number, { onsetMs: number; velocity: number }>();
  private notes: CapturedMidiNote[] = [];
  private readonly now: () => number;

  constructor(now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    this.now = now;
  }

  isActive(): boolean { return this.active; }
  elapsedMs(): number { return this.active ? this.now() - this.startMs : 0; }

  start(opts: { maxMs?: number } = {}): void {
    this.startMs = this.now();
    this.maxMs = opts.maxMs ?? 4000;
    this.active = true;
    this.open.clear();
    this.notes = [];
  }

  /** @returns true 若已自动到时停止(调用方据此刷新 UI)。 */
  noteOn(midi: number, velocity: number): boolean {
    if (!this.active) return false;
    const t = this.elapsedMs();
    if (t >= this.maxMs) { this.stop(); return true; }
    this.open.set(midi, { onsetMs: t, velocity: Math.max(1, Math.min(127, velocity)) });
    return false;
  }

  noteOff(midi: number): void {
    if (!this.active) return;
    const o = this.open.get(midi);
    if (!o) return;
    this.open.delete(midi);
    this.commit(midi, o.onsetMs, o.velocity, this.elapsedMs());
  }

  /** 停止并返回录到的 CapturedMidiNote[](补全未关音符)。 */
  stop(): CapturedMidiNote[] {
    if (!this.active) return [...this.notes].sort((a, b) => a.onsetMs - b.onsetMs);
    const endT = Math.min(this.elapsedMs(), this.maxMs);
    for (const [midi, o] of this.open) this.commit(midi, o.onsetMs, o.velocity, endT);
    this.open.clear();
    this.active = false;
    return [...this.notes].sort((a, b) => a.onsetMs - b.onsetMs);
  }

  private commit(midi: number, onsetMs: number, velocity: number, endMs: number): void {
    this.notes.push({ midi, velocity, onsetMs, durationMs: Math.max(MIN_DUR_MS, endMs - onsetMs) });
  }
}
