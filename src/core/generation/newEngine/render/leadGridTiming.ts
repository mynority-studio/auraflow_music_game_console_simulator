// ============================================================
// newEngine · render · 快速线条网格所有者(fast-line grid owner)
// ------------------------------------------------------------
// CODEX directive: docs/jazz_16th_run_grid_owner_directive.md(2026-06-19)。
// 问题:旧 swing 对【任意 .5 拍位 onset】施加八分摆动 → 连续 16 分 run 里的 .5 也被推到 .67,
//   与 .75 挤成 0.08 拍 micro-IOI("rush/机关 stutter/错拍")。
// 本工具是【render 层 timing 策略】:判定某 .5 onset 是否【真八分反拍】(可摆动),还是处于
//   16 分/快速 run(保持笔直)。纯函数 / 确定性 / 无 DOM/audio/RNG/MIDI-IO。Q+N 与 Q+R 共用此决策。
// ★ 只决定【是否摆动 onset】;不连音(legato 仍在 timing 之后跑)、不改 pitch/数量、不量化全曲。
// ============================================================

export interface TimedLeadEvent {
  time: number;     // 拍(beat)
  duration: number; // 拍
}

const FAST_IOI = 0.375;       // ≤ 此 IOI = 快速 cell(16分0.25 / 三连八分0.333 / 16分三连0.166);排除 swing 八分(0.67/0.33)
const DEFAULT_EPS = 0.05;

/** 拍内相位 [0,1)。 */
export function beatFracOf(time: number, beatsPerMeasure: number): number {
  const b = ((time % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
  return b - Math.floor(b);
}

/** events[i] 是否处于【应保持笔直的快速 run】(16 分/快速三连等):
 *  ① 局部窗口(prev2..next2 的 4 个相邻 IOI)中 ≥3 个 ≤ 0.375 拍;或
 *  ② 16 分挤压形态:current 相位 ≈ .5,且 prev 相位 ≈ .25 或 next 相位 ≈ .75(摆动会撞 micro-IOI)。 */
export function isInProtectedFastRun(
  events: readonly TimedLeadEvent[],
  i: number,
  beatsPerMeasure = 4,
  eps = DEFAULT_EPS,
): boolean {
  const n = events.length;
  if (n < 2) return false;
  const ioiAt = (k: number): number => (k >= 0 && k + 1 < n ? events[k + 1].time - events[k].time : Infinity);
  // ① 局部 fast-run:窗口 i-2..i+2 的相邻 IOI 里 ≥3 个 ≤ 0.375
  let fast = 0;
  for (let k = i - 2; k <= i + 1; k++) { const d = ioiAt(k); if (d > 1e-9 && d <= FAST_IOI + eps) fast++; }
  if (fast >= 3) return true;
  // ② 16 分挤压形态:.25 → .5 → .75
  const frac = (k: number): number | null => (k >= 0 && k < n ? beatFracOf(events[k].time, beatsPerMeasure) : null);
  const near = (x: number | null, t: number): boolean => x != null && Math.abs(x - t) < eps;
  if (near(frac(i), 0.5) && (near(frac(i - 1), 0.25) || near(frac(i + 1), 0.75))) return true;
  return false;
}

/** Q+N .5 反拍 swing 门:仅在【真八分反拍】(相位 ≈ .5 且非快速 run)时返回 true。
 *  swingRatio=0.5(直)→ false;相位非 .5 → false;处于 16 分 run → false。 */
export function shouldSwingAsEighthOffbeat(
  events: readonly TimedLeadEvent[],
  i: number,
  swingRatio: number,
  beatsPerMeasure = 4,
  eps = DEFAULT_EPS,
): boolean {
  if (Math.abs(swingRatio - 0.5) < 1e-9) return false;
  if (Math.abs(beatFracOf(events[i].time, beatsPerMeasure) - 0.5) >= eps) return false;
  return !isInProtectedFastRun(events, i, beatsPerMeasure, eps);
}

export interface LeadGridMetrics {
  microIoiCount: number;        // 相邻 IOI < 0.12 拍 的对数(摆动挤压红旗)
  minIoi: number;               // 最小正 IOI(拍)
  squeezedSwing16thCount: number; // 疑似 .67→.75 挤压(一个 ~.67 相位音紧跟 < 0.2 拍另一个 onset)
  coherentFastRunCount: number; // 处于快速 run 的音数
}

/** 诊断/回归度量(拍制 events)。 */
export function leadGridMetrics(events: readonly TimedLeadEvent[], beatsPerMeasure = 4): LeadGridMetrics {
  const ev = [...events].sort((a, b) => a.time - b.time);
  let microIoiCount = 0, minIoi = Infinity, squeezed = 0, fastRun = 0;
  for (let i = 0; i < ev.length; i++) {
    if (isInProtectedFastRun(ev, i, beatsPerMeasure)) fastRun++;
    if (i + 1 >= ev.length) continue;
    const ioi = ev[i + 1].time - ev[i].time;
    if (ioi <= 1e-9) continue;
    if (ioi < minIoi) minIoi = ioi;
    if (ioi < 0.12) microIoiCount++;
    if (Math.abs(beatFracOf(ev[i].time, beatsPerMeasure) - 0.67) < 0.06 && ioi < 0.2) squeezed++;
  }
  return { microIoiCount, minIoi: minIoi === Infinity ? 0 : minIoi, squeezedSwing16thCount: squeezed, coherentFastRunCount: fastRun };
}
